// lib/worktree.js
// c5 team worktree 隔离（M3，spec R18 表 c5 行 / R7 每运行一树 / R14 全自动短生命周期）
// - 队长 run 启动 → `<stateDir>/worktrees/{run-id}`（gitignored，从当前 HEAD `git worktree add --detach`）
// - 两阶段拆除（时序断言面）：先 run-state CAS 写 disposed 终态 → 再删树（CAS 不成功绝不删树；
//   终态时间戳 < 删树时间）；Windows 文件锁恢复 = fs.rm maxRetries 释放句柄重试（S2 实证纪律）
// - 用户取消：删树前先列树内与 HEAD 差异文件（只提示不阻塞）
// - 崩溃恢复：下次队长 run 启动扫 worktrees/* 孤儿（run-state 非终态且无活跃会话）→ 提示处置绝不自动删
// - run-state.json 权威在主仓 `<stateDir>/state/run-state.json`（c6 将落七字段镜像契约；c8：树内只读参考）
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, open, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteJson, readJson } from '../mcp-server/lib/atomic.mjs'
import { assertSafeWorkspaceCwd as assertSafeCwd } from './cwd-guard.js'

/** 终态枚举（spec out-of-scope：c6 契约不含 disposed 之外新终态）。 */
export const TERMINAL_STATES = ['disposed']

const SAFE_RUN_ID = /^[A-Za-z0-9_-]+$/

/** runId 安全校验（进路径；限 [A-Za-z0-9_-]，路径分隔与 .. 天然不可达）。 */
function assertRunId(runId) {
  if (!SAFE_RUN_ID.test(runId ?? ''))
    throw new Error(`worktree: 非法 runId: ${String(runId)}（限 [A-Za-z0-9_-]）`)
  return runId
}

/** worktrees 根目录（每运行一树：`<stateDir>/worktrees/{run-id}`）。 */
export function worktreesPath(cwd, stateDir = '.omd') {
  return join(cwd, stateDir, 'worktrees')
}

/** run-state.json 权威路径（主仓 stateDir，树内只读参考 → 不落树内）。 */
export function runStatePath(cwd, stateDir = '.omd') {
  assertSafeCwd(cwd) // 直读面守卫（R2/R5 评审：team readMirror / hud readMirrorRunState / hud-route 均经此收口）
  return join(cwd, stateDir, 'state', 'run-state.json')
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** git check-ignore -q：exit 0 = 已忽略，exit 1 = 未忽略，其余 = 真错误。
 *  探测带尾斜杠（目录形态）——目录尚不存在时无尾斜杠的 check-ignore 恒不命中目录规则（实测）。 */
function isGitIgnored(cwd, rel) {
  try {
    execFileSync('git', ['check-ignore', '-q', `${rel}/`], { cwd, stdio: 'ignore' })
    return true
  } catch (e) {
    if (e.status === 1) return false
    throw e
  }
}

/**
 * 确保 `<stateDir>/worktrees/` 对 git 不可见（spec 约束 4：.gitignore 追加一行）。
 * 幂等：check-ignore 已命中（如整仓忽略 `.omd/` 的仓库）则零改动；未命中才追加一行。
 */
export async function ensureGitignored(cwd, stateDir = '.omd') {
  const rel = `${stateDir}/worktrees`
  if (isGitIgnored(cwd, rel)) return { appended: false, rel }
  await appendFile(join(cwd, '.gitignore'), `\n# omd team run worktrees（每运行一树，自动拆除）\n${rel}/\n`, 'utf8')
  return { appended: true, rel }
}

/**
 * 单调 ISO token（IC-23）：CAS token 单调严格递增——同毫秒双写时 toISOString() 串相同，
 * 「重打」即 no-op、旧 token 照样过 CAS（ABA 守门测试在 0.4.8 轮实测必现，IC-23 实证升格）。
 * prev 非法/缺席时按现状返回当前时间。
 */
export function monotonicIsoNow(prev) {
  const now = new Date().toISOString()
  if (Number.isFinite(Date.parse(prev)) && now <= prev) return new Date(Date.parse(prev) + 1).toISOString()
  return now
}

/**
 * 跨进程互斥锁（lockfile，open('wx') 原子创建=操作系统级 CAS 原语）。
 * 刻板审查修复（报告二：伪 CAS）——此前 casWriteRunState 的 读→校验→rename 跨进程
 * 是 check-then-act，双进程可持同一 expectUpdatedAt 双双通过校验后双写（后写静默覆盖）。
 * 现读-校验-写整体收进 lockfile 临界区；holder 崩溃遗留的 stale 锁（mtime > 60s）被接管删除。
 */
const LOCK_STALE_MS = 60_000
/** 通用跨进程文件锁（lockfile open('wx') 原子原语 + stale 接管）；R3-⑨ 泛化自 run-state 专用版。 */
export async function withCrossProcessFileLock(lockPath, fn) {
  await mkdir(join(lockPath, '..'), { recursive: true })
  let fh = null
  for (let i = 0; i < 200 && !fh; i++) {
    try { fh = await open(lockPath, 'wx') } // EEXIST=他人持有
    catch (e) {
      if (e.code !== 'EEXIST') throw e
      try { // stale 锁接管（holder 崩溃防线）
        const st = await stat(lockPath)
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) await rm(lockPath, { force: true })
      } catch { /* 竞态：他人已释放/接管 */ }
      await new Promise(r => setTimeout(r, 25))
    }
  }
  if (!fh) throw new Error(`worktree: 跨进程锁获取超时: ${lockPath}`)
  try { return await fn() }
  finally { try { await fh.close() } finally { await rm(lockPath, { force: true }).catch(() => {}) } }
}

/** run-state 专用锁（泛化原语的便捷包装）。 */
export function withRunStateLock(cwd, stateDir, fn) {
  return withCrossProcessFileLock(runStatePath(cwd, stateDir) + '.lock', fn)
}

/**
 * CAS 写 run-state（state.mjs write 原语同款 expectUpdatedAt 冲突语义）：
 * expectUpdatedAt 与当前 updatedAt 不符即抛 conflict（不写不删）；version 每写 +1（c6 契约要素）。
 * 跨进程互斥由 withRunStateLock 提供（读-校验-写在同一 lockfile 临界区内）。
 */
export async function casWriteRunState({ cwd, stateDir = '.omd', expectUpdatedAt, mutate }) {
  return withRunStateLock(cwd, stateDir, async () => {
    const file = runStatePath(cwd, stateDir)
    const cur = await readJson(file, null)
    if (!cur) throw new Error('worktree: run-state.json 不存在（先 beginTeamRun）')
    if (expectUpdatedAt !== undefined && cur.updatedAt !== expectUpdatedAt)
      throw new Error(`conflict: run-state CAS 冲突：当前 updatedAt='${cur.updatedAt}'，你携带的是 '${expectUpdatedAt}'——先重读 run-state.json 取最新 updatedAt 再携新值重试`)
    const next = mutate({ ...cur })
    next.version = (cur.version ?? 0) + 1
    next.updatedAt = monotonicIsoNow(cur.updatedAt) // IC-23：同毫秒碰撞防线
    await atomicWriteJson(file, next)
    return next
  })
}

/**
 * 孤儿扫描（C3 崩溃恢复，beginTeamRun 启动时先跑）：
 * worktrees/* 逐一判定——孤儿 = 权威 run-state 非终态（或不存在/不描述该树）且无活跃会话。
 * 只报告，绝不自动删。isSessionActive = 生产的活跃会话判定注入点（如 state_list_active 投影）。
 */
export async function scanOrphans({ cwd, stateDir = '.omd', isSessionActive = async () => false } = {}) {
  const root = worktreesPath(cwd, stateDir)
  const state = await readJson(runStatePath(cwd, stateDir), null)
  let entries = []
  try { entries = await readdir(root, { withFileTypes: true }) } catch { return { orphans: [], lines: [] } }
  const orphans = []
  const lines = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const runId = e.name
    const status = state?.runId === runId ? state.status : 'unknown' // 权威文件不描述此树 = 按非终态论
    if (TERMINAL_STATES.includes(status)) continue
    if (await isSessionActive(runId)) continue
    const path = join(root, runId)
    orphans.push({ runId, status, path })
    lines.push(`[worktree] 孤儿候选: ${runId}（run-state=${status}，无活跃会话）→ 需人工处置，绝不自动删: ${path}。处置：确认无用后调 team_dispose({ cwd, runId: '${runId}', reason: 'orphan-cleanup' })（会先 CAS 写 disposed 终态再删树）；或手动删除该目录并清理 <stateDir>/state/run-state.json`)
  }
  return { orphans, lines }
}

/**
 * 队长 run 启动（C1 断言①）：先崩溃恢复孤儿扫描（只提示）→ gitignore → 从当前 HEAD 建
 * `<stateDir>/worktrees/{run-id}` → run-state 写 active（无文件则 version 1 起步）。
 * 前一 run 非终态且其会话仍活跃时拒绝启动（防覆写存活 run；互斥层外的最小防线）。
 * @returns { path, runId, head, createdAt, orphans, orphanLines }
 */
export async function beginTeamRun({ cwd, runId, stateDir = '.omd', isSessionActive = async () => false }) {
  assertRunId(runId)
  const scan = await scanOrphans({ cwd, stateDir, isSessionActive })
  // F2 热修（主动深审轮 R3）：读守卫+建树+权威写收进 withRunStateLock 临界区——并发
  // begin×begin / begin×dispose 互踩会让先写者的树失去权威归属（孤儿误报，本会话实测）。
  return withRunStateLock(cwd, stateDir, async () => {
    const file = runStatePath(cwd, stateDir)
    const cur = await readJson(file, null)
    if (cur?.runId && !TERMINAL_STATES.includes(cur.status) && cur.runId !== runId
      && await isSessionActive(cur.runId))
      throw new Error(`worktree: run '${cur.runId}' 非终态且会话仍活跃，拒绝覆写 run-state（先处置或确认终止）`)
    await mkdir(worktreesPath(cwd, stateDir), { recursive: true })
    await ensureGitignored(cwd, stateDir)
    const head = git(cwd, ['rev-parse', 'HEAD'])
    const path = join(worktreesPath(cwd, stateDir), runId)
    git(cwd, ['worktree', 'add', '--detach', path, head])
    const at = new Date().toISOString()
    await atomicWriteJson(file, { ...(cur ?? {}), runId, status: 'active', createdAt: at, version: (cur?.version ?? 0) + 1, updatedAt: at })
    return { path, runId, head, createdAt: at, orphans: scan.orphans, orphanLines: scan.lines }
  })
}

/**
 * 树内与 HEAD 差异文件（C3 取消提示面，只读）：tracked 修改 ∪ untracked，排序去重。
 */
export async function listTreeDiff({ cwd, runId, stateDir = '.omd' }) {
  assertRunId(runId)
  const tree = join(worktreesPath(cwd, stateDir), runId)
  if (!existsSync(tree)) throw new Error(`worktree: 树不存在: ${tree}`)
  const tracked = git(tree, ['diff', '--name-only', 'HEAD']).split('\n').filter(Boolean)
  const untracked = git(tree, ['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)
  return [...new Set([...tracked, ...untracked])].sort()
}

/**
 * 两阶段拆除（C2 断言②）：①run-state 先 CAS 写 disposed 终态（expectUpdatedAt 契约，
 * CAS 不成功绝不删树）→ ②删树（fs.rm maxRetries=Windows 句柄释放重试）+ git worktree prune。
 * @returns { disposedAt, writeDoneAt, removedAt, removed, state }
 *   时序断言面：disposedAt ≤ run-state mtime ≤ writeDoneAt ≤ removedAt，且目录消失。
 */
export async function disposeRunWorktree({ cwd, runId, stateDir = '.omd', reason = 'verified', expectUpdatedAt, log = () => {} }) {
  assertRunId(runId)
  const tree = join(worktreesPath(cwd, stateDir), runId)
  const disposedAt = new Date().toISOString()
  const mutateDispose = s => ({ ...s, status: 'disposed', disposedAt, disposedReason: reason })
  let state
  try {
    state = await casWriteRunState({
      cwd, stateDir, expectUpdatedAt,
      // R3'（EL1-3 守卫精确化）：异 runId 一律拒绝（无论 incumbent 终态，防夺槽）——锁内原子，未写未删树
      mutate: s => {
        if (s.runId !== runId)
          throw new Error(`worktree: run-state 现归属 run '${s.runId}'（status=${s.status}），拒绝 dispose '${runId}'（异 runId 一律拒绝，防夺槽）`)
        return mutateDispose(s)
      },
    })
  } catch (e) {
    if (!/run-state\.json 不存在/.test(e?.message ?? '')) throw e
    // EL1-3 缺文件自愈（ralplan-u8-2 D4-A）：顺序获锁——进此分支时 casWriteRunState 已返回（其锁已释放），
    // 严禁在 casWriteRunState 锁内嵌套 withRunStateLock（open('wx') 非重入，嵌套=自锁 60s，Critic②）。
    const healed = await withRunStateLock(cwd, stateDir, async () => {
      const cur = await readJson(runStatePath(cwd, stateDir), null)
      if (!cur) {
        // 初始化写 disposed 墓碑：version:1 + warning + disposedReason=self-healed-missing-file
        // （warning+version:1+disposedReason 三元组承载留痕；revokedFrom 不加——Critic④ 终审裁决）
        const tombstone = {
          runId, status: 'disposed', disposedAt,
          disposedReason: 'self-healed-missing-file',
          version: 1, updatedAt: disposedAt,
          warning: `run-state.json 缺失（原归属丢失，疑被并行运行清理）→ dispose 自愈写此墓碑；调用方 reason='${reason}'`,
        }
        await atomicWriteJson(runStatePath(cwd, stateDir), tombstone)
        log(`[worktree] warning: run-state.json 缺失 → dispose 自愈写 disposed 墓碑（runId=${runId}，version:1，self-healed-missing-file）`)
        return { selfHealed: true, state: tombstone }
      }
      if (cur.runId !== runId)
        throw new Error(`worktree: run-state 现归属 run '${cur.runId}'（status=${cur.status}），拒绝 dispose '${runId}'（异 runId 一律拒绝，防夺槽）`)
      return { selfHealed: false } // 同 runId 文件被并行重建 → 幂等续行
    })
    if (healed.selfHealed) state = healed.state
    // 同 runId 幂等续行（R3'）：原 expectUpdatedAt 针对的文件已消失，重走 CAS 不再携带 expect；
    // 守卫与主 CAS 同款（p2-verify→u82-verify P3 闭环）：异 runId 一律拒绝，防自愈锁间隙被并行 begin 覆写
    else state = await casWriteRunState({
      cwd, stateDir,
      mutate: s => {
        if (s.runId !== runId)
          throw new Error(`worktree: run-state 现归属 run '${s.runId}'（status=${s.status}），拒绝 dispose '${runId}'（异 runId 一律拒绝，防夺槽）`)
        return mutateDispose(s)
      },
    })
  }
  const writeDoneAt = new Date() // 阶段①已持久化（rename 完成）后的观测点
  if (existsSync(tree)) {
    await rm(tree, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
  }
  // F3 热修（主动深审轮 R3）：树被手工 rm 时也要 prune——否则 .git/worktrees/<name> 幻影元数据残留（幂等）。
  git(cwd, ['worktree', 'prune'])
  if (existsSync(tree)) throw new Error(`worktree: 删树失败（重试后仍存在）: ${tree}`)
  return { disposedAt, writeDoneAt: writeDoneAt.toISOString(), removedAt: new Date().toISOString(), removed: true, state }
}

/**
 * 用户取消（C3 断言③前半）：删树前先列树内与 HEAD 差异文件（只提示不阻塞——差异非空也继续
 * 两阶段拆除，reason=cancelled）。log 注入提示面（队长协议负责展示）。
 */
export async function cancelTeamRun({ cwd, runId, stateDir = '.omd', expectUpdatedAt, log = () => {} }) {
  let diffs = []
  try {
    diffs = await listTreeDiff({ cwd, runId, stateDir })
  } catch (e) {
    // F3 评审：树已不存在（重复取消/手工删除）→ 状态收尾仍要完成，不因列差异失败中断
    log(`[worktree] 取消 run ${runId}：列差异失败（树可能已不存在）: ${e?.message ?? e}`)
  }
  const promptLines = diffs.length
    ? [`[worktree] 取消 run ${runId}：树内与 HEAD 差异 ${diffs.length} 个文件（只提示不阻塞）：`, ...diffs.map(f => `  - ${f}`)]
    : [`[worktree] 取消 run ${runId}：树内与 HEAD 无差异`]
  for (const l of promptLines) log(l)
  const r = await disposeRunWorktree({ cwd, runId, stateDir, reason: 'cancelled', expectUpdatedAt, log })
  return { diffs, promptLines, ...r }
}
