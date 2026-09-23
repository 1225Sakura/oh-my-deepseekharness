// lib/runstate.js
// c6 CAS 状态写——run-state.json 最小镜像契约（M3，spec R12 快照 CAS / R18 表 c6 行 / 台账 S6 双对断言）
// - 七字段镜像：mode/round/current_story/active_agents/todo（计数+首条标题）+version+updatedAt
//   （五要素与 c4 HUD 内容契约同名对齐；快照语义：每次写携带完整五要素镜像，R12 快照 CAS）
// - 队长独占写：单进程内 per-文件写互斥（读-expect-写为一个临界区，双写者并发恰一胜出）；
//   跨进程以 expectUpdatedAt CAS 兜底（复用 state.mjs 存量冲突语义 = lib/worktree.js casWriteRunState）
// - 双写时机：阶段边界（beginTeamRun 启动 active v1 / disposeRunWorktree 拆除 disposed，S5 已落）
//   + 派发前（与 c3 routeOnce 同临界区：先路由判定 → 快照镜像写 → 再派发）
// - 冲突语义（断言对①）：expectUpdatedAt 冲突 → 重读最新值重试 ≤3 次；预算耗尽 → 以最新读值
//   覆盖写（原子 tmp+rename）+ warning 日志行。version 1 起步每写 +1（写入方强制，调用方不可伪造）。
import { atomicWriteJson, readJson } from '../mcp-server/lib/atomic.mjs'
import { casWriteRunState, runStatePath } from './worktree.js'

/** 七字段镜像契约（c6）：五要素镜像 + version + updatedAt（字段名与 state_get_status 投影同名对齐）。 */
export const RUN_STATE_FIELDS = ['mode', 'round', 'current_story', 'active_agents', 'todo', 'version', 'updatedAt']

/** 快照写必须携带的五要素镜像键（version/updatedAt 由写入方管理，不在 patch 契约内）。 */
const MIRROR_SNAPSHOT_KEYS = ['mode', 'round', 'current_story', 'active_agents', 'todo']

/** 七字段契约校验：任一字段缺席（undefined）即抛错（不静默）。 */
export function assertSevenFields(state) {
  const missing = RUN_STATE_FIELDS.filter(f => state?.[f] === undefined)
  if (missing.length) throw new Error(`run-state: 七字段镜像契约缺字段: ${missing.join(',')}`)
  return true
}

/**
 * todo 摘要（契约要素：计数+首条标题）：三区计数与 c4/notepad_stats 同源对齐，
 * firstTitle=working 首条标题，缺席依次回退 priority/manual（全空 → null）。
 */
export function buildTodoSummary({ stats, items } = {}) {
  const count = v => (Number.isFinite(v) ? v : 0)
  const firstOf = (...lists) => {
    for (const l of lists) if (Array.isArray(l) && l.length) return String(l[0])
    return null
  }
  return {
    working: count(stats?.working),
    priority: count(stats?.priority),
    manual: count(stats?.manual),
    firstTitle: firstOf(items?.working, items?.priority, items?.manual),
  }
}

/**
 * 五要素快照构造（writeRunStateMirror 的 patch 形参走本构造器）：
 * mode/round/currentStory/activeAgents/todo → 镜像字段 mode/round/current_story/active_agents/todo；
 * 其余键（fallback/lastFallback 等 c3 审计面）随快照透传落盘。
 */
export function buildMirrorPatch({ mode, round, currentStory, activeAgents, todo, ...audit } = {}) {
  return {
    mode: mode ?? null,
    round: round ?? null,
    current_story: currentStory ?? null,
    active_agents: Array.isArray(activeAgents) ? activeAgents : [],
    todo: todo ?? buildTodoSummary(),
    ...audit,
  }
}

// ---- 队长独占写（单进程临界区）：per-文件 async 互斥队列（FIFO），读-expect-写为一个临界区 ----
const locks = new Map()
// F3/M1 评审后导出：fallback 审计（routing.recordFallback）纳入同一权威文件的互斥域。
export function withFileLock(key, fn) {
  const prev = locks.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn) // 前任失败不阻塞后任（锁只管互斥，不管错误传播）
  locks.set(key, run.catch(() => {}))
  return run
}

const isConflict = e => e instanceof Error && /^conflict:/.test(e.message)

/**
 * run-state 快照镜像写（c6 唯一写入口；断言对①的竞态恢复语义在此落地）：
 * ①CAS 尝试（expectUpdatedAt 契约，复用 casWriteRunState：冲突即抛、version 每写 +1）；
 * ②冲突 → warning 日志行 → 重读最新值重试 ≤retries 次（每次：读最新 → retryBackoff() → 持最新
 *   updatedAt 再 CAS；retryBackoff=重试退避注入点，生产默认零延迟）；
 * ③预算耗尽 → 以最新读值覆盖写（merge 快照后原子 tmp+rename，不经 expect 门禁）+ warning 日志行。
 * 调用方不可伪造 version/updatedAt（写入方每次强制重算）。
 * @returns { ok, state, attempts, conflicts, wonFirst, recovered, overwrote, warnings }
 */
export async function writeRunStateMirror({
  cwd, stateDir = '.omd', patch, expectUpdatedAt, retries = 3,
  log = () => {}, retryBackoff = async () => {}, readLatest,
}) {
  const missing = MIRROR_SNAPSHOT_KEYS.filter(k => patch?.[k] === undefined)
  if (missing.length)
    throw new Error(`run-state: 快照写缺五要素镜像键（经 buildMirrorPatch 构造）: ${missing.join(',')}`)
  const file = runStatePath(cwd, stateDir)
  const readCurrent = readLatest ?? (() => readJson(file, null))
  const warnings = []
  const conflictLine = n => {
    const line = `[run-state] warning: CAS 冲突 ×${n}（expected '${expectUpdatedAt}'）→ 重读最新值重试 ≤${retries}`
    warnings.push(line)
    log(line)
  }
  return withFileLock(file, async () => {
    let attempts = 0
    let conflicts = 0
    let expected = expectUpdatedAt
    const attempt = async () => {
      attempts++
      return casWriteRunState({ cwd, stateDir, expectUpdatedAt: expected, mutate: s => ({ ...s, ...patch }) })
    }
    try {
      const state = await attempt()
      assertSevenFields(state)
      return { ok: true, state, attempts, conflicts, wonFirst: true, recovered: false, overwrote: false, warnings }
    } catch (e) {
      if (!isConflict(e)) throw e
      conflicts++
      conflictLine(conflicts)
    }
    for (let i = 0; i < retries; i++) {
      const latest = await readCurrent() // 重读最新值
      if (!latest) throw new Error('run-state: run-state.json 不存在（先 beginTeamRun）')
      await retryBackoff() // 退避注入点：竞态窗口的确定性构造面（生产默认零延迟）
      expected = latest.updatedAt
      try {
        const state = await attempt()
        assertSevenFields(state)
        return { ok: true, state, attempts, conflicts, wonFirst: false, recovered: true, overwrote: false, warnings }
      } catch (e) {
        if (!isConflict(e)) throw e
        conflicts++
        conflictLine(conflicts)
      }
    }
    // 重试预算耗尽 → 以最新读值覆盖写（快照 merge 保底；镜像非权威真相，可审计性优先）
    const latest = await readCurrent()
    if (!latest) throw new Error('run-state: run-state.json 不存在（先 beginTeamRun）')
    const next = { ...latest, ...patch }
    next.version = (latest.version ?? 0) + 1
    next.updatedAt = new Date().toISOString()
    await atomicWriteJson(file, next)
    const line = `[run-state] warning: CAS 重试预算耗尽（${retries} 次重试后仍冲突）→ 以最新读值覆盖写 version=${next.version}`
    warnings.push(line)
    log(line)
    assertSevenFields(next)
    return { ok: true, state: next, attempts, conflicts, wonFirst: false, recovered: false, overwrote: true, warnings }
  })
}
