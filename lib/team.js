// lib/team.js
// team 领队运行时（v0.4.0 P2-C，对齐计划 M6）——把 OMC src/team 的核心概念落到 dsh 宿主原语：
// - 阶段状态机（phase-controller 对应）：team-plan→prd→exec→verify→fix(≤maxFixLoops)→terminal，
//   纯函数迁移校验，非法迁移显式拒绝；状态落 .omd/team/<runId>/phase.json
// - 队员生命周期 / UUID（team-identity + owner-epoch 对应）：workerId=UUID，runId 即 owner-epoch
//   等价物（registry 按 runId 分目录，旧 run 的 registry 天然隔离）；registry.json 记
//   dispatchId/agentId/role/tier/phase/status/心跳戳。终态（done/failed）不可复活。
// - leader-inbox / mailbox：文件邮箱 mailbox/{in,out}/<workerId>.jsonl（in=队员→领队，
//   out=领队→队员），append-only JSONL + ack 标记（ack 重写单文件，邮箱有界小文件）。
// - heartbeat：scanHeartbeat 按需扫描（确定性、可测）——超时未心跳且非终态 → 标 stale（粘性，
//   下次心跳复位），**绝不自动杀**，只上报领队处置（对齐 c5 孤儿哲学）。插件侧 cordis 定时器
//   （lib/index.js 注册，Config team.heartbeatIntervalMs）只做同语义的周期检测+日志告警；
//   催促动作由领队模型经 send_message 执行——插件无法替模型发言（dsh 无插件→subagent 消息缝）。
// - merge-orchestrator MVP：buildMergePlan 生成合并计划（树内 diff ∪ 主仓 diff、交集=冲突候选、
//   建议序=无冲突先行）；合并执行仍由领队/executor 模型驱动。
// 诚实边界：tmux pane 维持 🚫；实际 spawn 由领队模型经 omd_delegate/subagent 完成，本库管
// 生命周期登记与协调数据面，不替模型做派发决策。
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { atomicWriteJson, atomicWriteText, readJson } from '../mcp-server/lib/atomic.mjs'
import { withFileLock } from './runstate.js'
import { listTreeDiff } from './worktree.js'

const SAFE_ID = /^[A-Za-z0-9_-]+$/

function assertRunId(runId) {
  if (!SAFE_ID.test(runId ?? '')) throw new Error(`team: 非法 runId: ${String(runId)}（限 [A-Za-z0-9_-]）`)
  return runId
}
function assertWorkerId(workerId) {
  if (!SAFE_ID.test(workerId ?? '')) throw new Error(`team: 非法 workerId: ${String(workerId)}（限 [A-Za-z0-9_-]）`)
  return workerId
}

/** run 数据根：.omd/team/<runId>/（registry/phase/mailbox 同目录锚定，runId=owner-epoch）。 */
export function teamRunDir(cwd, runId, stateDir = '.omd') {
  return join(cwd, stateDir, 'team', assertRunId(runId))
}

// ---------------------------------------------------------------------------
// 1. 阶段状态机（phase-controller 对应）
// ---------------------------------------------------------------------------

export const TEAM_PHASES = ['team-plan', 'team-prd', 'team-exec', 'team-verify', 'team-fix']
export const TEAM_TERMINAL = ['complete', 'failed', 'cancelled']
export const DEFAULT_MAX_FIX_LOOPS = 3

/**
 * 合法迁移表：fix→exec 是唯一回边（fix 循环）；任何非终态可转 cancelled；
 * verify 可转 failed（verify 判死）；fixLoops 超限仅允许转 failed/cancelled。
 */
const TRANSITIONS = {
  'team-plan': ['team-prd', 'team-exec'],          // prd 可跳过（跳过理由记 history note）
  'team-prd': ['team-exec'],
  'team-exec': ['team-verify'],
  'team-verify': ['team-fix', 'complete', 'failed'],
  'team-fix': ['team-exec', 'failed'],
}

export function initialPhaseState(now = new Date().toISOString()) {
  return { phase: 'team-plan', fixLoops: 0, maxFixLoops: DEFAULT_MAX_FIX_LOOPS, history: [{ from: null, to: 'team-plan', at: now, note: 'run started' }] }
}

/**
 * 阶段迁移（纯函数）：非法迁移/fix 循环超限显式抛错；返回新 state（不改入参）。
 * @param state 当前 phase 状态（initialPhaseState 形状）
 * @param to 目标阶段或终态
 * @param opts.note 迁移理由（prd 跳过/循环升级必填，审计入 history）
 */
export function transitionPhase(state, to, { note, at } = {}) {
  if (!state || typeof state.phase !== 'string') throw new Error('team: phase state 缺失')
  if (TEAM_TERMINAL.includes(state.phase)) throw new Error(`team: run 已终态（${state.phase}），不可再迁移`)
  const atIso = at ?? new Date().toISOString()
  if (to === 'cancelled')
    return { ...state, phase: 'cancelled', history: [...state.history, { from: state.phase, to, at: atIso, note: note ?? 'cancelled' }] }
  const allowed = TRANSITIONS[state.phase] ?? []
  if (!allowed.includes(to))
    throw new Error(`team: 非法阶段迁移 ${state.phase} → ${to}（合法: ${[...allowed, 'cancelled'].join('/')}）`)
  // prd 跳过（plan→exec）必须留 note（评审修复文档漂移：「该决定记进 handoff」从注释升为强制）
  if (state.phase === 'team-plan' && to === 'team-exec' && !note?.trim())
    throw new Error('team: 跳过 team-prd 必须给 note（跳过理由——该决定同时记进 handoff）')
  let fixLoops = state.fixLoops
  if (state.phase === 'team-fix' && to === 'team-exec') {
    fixLoops = state.fixLoops + 1
    const max = state.maxFixLoops ?? DEFAULT_MAX_FIX_LOOPS
    if (fixLoops > max)
      throw new Error(`team: fix 循环超限（${state.fixLoops}/${max} 已用尽）——只能转 failed/cancelled，绝不无限循环`)
  }
  return { ...state, phase: to, fixLoops, history: [...state.history, { from: state.phase, to, at: atIso, note: note ?? '' }] }
}

/** 读 phase.json：ENOENT=新 run（返回 null 懒建）；解析失败=损坏（抛错，绝不静默重置状态机）。 */
export async function readPhaseState(cwd, runId, stateDir = '.omd') {
  const file = join(teamRunDir(cwd, runId, stateDir), 'phase.json')
  let text
  try { text = await readFile(file, 'utf8') } catch { return null } // 不存在=新 run
  try { return JSON.parse(text) }
  catch (e) { throw new Error(`team: phase.json 损坏，拒绝静默重置（状态机保证会失效）: ${file}（${e?.message ?? e}）——人工检视后修复或删除该文件再操作`) }
}

/** 迁移并持久化（MCP 工具面用）：run 首次迁移时懒建 initial 态；损坏文件显式拒绝（评审修复#6）。 */
export async function transitionPhasePersist({ cwd, runId, to, note, stateDir = '.omd' }) {
  const file = join(teamRunDir(cwd, runId, stateDir), 'phase.json')
  const cur = (await readPhaseState(cwd, runId, stateDir)) ?? initialPhaseState()
  const next = transitionPhase(cur, to, { note })
  await atomicWriteJson(file, next)
  return next
}

// ---------------------------------------------------------------------------
// 2. 队员 registry（UUID 生命周期；runId=owner-epoch）
// ---------------------------------------------------------------------------

export const WORKER_STATUSES = ['dispatched', 'running', 'blocked', 'done', 'failed']
const WORKER_TERMINAL = ['done', 'failed']

export function registryPath(cwd, runId, stateDir = '.omd') {
  return join(teamRunDir(cwd, runId, stateDir), 'registry.json')
}

export async function readRegistry(cwd, runId, stateDir = '.omd') {
  return await readJson(registryPath(cwd, runId, stateDir), null)
}

async function writeRegistry(cwd, runId, reg, stateDir) {
  await atomicWriteJson(registryPath(cwd, runId, stateDir), reg)
  return reg
}

/**
 * registry 读-改-写临界区（v0.4.1 评审修复，实测竞态：20 并发 RMW 丢更新 16/20）：
 * 整段「读 → 改 → 写」包进 withFileLock（复用 runstate.js 的 per-文件 FIFO 互斥域，
 * F3/M1 先例）。锁必须包住读——只包写则窗口仍在。
 * 适用假设（写明）：withFileLock 是单进程内存锁，对所有 registry 写都经同一
 * mcp-server 进程的当前架构足够；若未来出现第二个直接写 registry 的进程，需升级
 * 跨进程文件锁。跨进程兜底同 runstate.js 头注（expectUpdatedAt CAS 哲学）。
 */
function withRegistryLock(cwd, runId, stateDir, fn) {
  return withFileLock(registryPath(cwd, runId, stateDir), fn)
}

/** ISO 时间戳校验（评审修复#7：NaN 心跳会使 stale 检测对该队员永久静默）。 */
function assertIsoTs(ts, what) {
  if (ts !== undefined && Number.isNaN(Date.parse(ts)))
    throw new Error(`team: ${what} 不是可解析时间戳: ${String(ts)}`)
  return ts
}

/**
 * 登记队员（实际 spawn 由领队经 omd_delegate/subagent 完成后调用本函数落账）。
 * workerId 省略时生成 `w-<uuid8>`；status 初始 dispatched。
 */
export async function registerWorker({ cwd, runId, stateDir = '.omd', worker }) {
  assertIsoTs(worker.spawnedAt, 'spawnedAt')
  return withRegistryLock(cwd, runId, stateDir, async () => {
    const now = new Date().toISOString()
    const cur = (await readRegistry(cwd, runId, stateDir)) ?? { runId, createdAt: now, workers: {} }
    const workerId = worker.workerId ?? `w-${randomUUID().replaceAll('-', '').slice(0, 8)}`
    assertWorkerId(workerId)
    if (cur.workers[workerId]) throw new Error(`team: workerId 已存在: ${workerId}`)
    if (!worker.role) throw new Error('team: registerWorker 缺 role（生命周期必须绑定角色）')
    const w = {
      workerId, runId,
      dispatchId: worker.dispatchId ?? null,
      agentId: worker.agentId ?? null,
      role: worker.role,
      tier: worker.tier ?? null,
      phase: worker.phase ?? null,           // 服务哪个阶段（team-exec 等）
      status: 'dispatched',
      stale: false,
      spawnedAt: worker.spawnedAt ?? now,
      lastHeartbeatAt: worker.spawnedAt ?? now,
      note: worker.note ?? '',
    }
    cur.workers[workerId] = w
    await writeRegistry(cwd, runId, cur, stateDir)
    return w
  })
}

const STATUS_FLOW = {
  dispatched: ['running', 'blocked', 'done', 'failed'],
  running: ['blocked', 'done', 'failed'],
  blocked: ['running', 'done', 'failed'],
}

/** 更新队员（状态迁移校验：终态不可复活；patch 仅允许 status/note/agentId/dispatchId/phase）。 */
export async function updateWorker({ cwd, runId, workerId, patch = {}, stateDir = '.omd' }) {
  return withRegistryLock(cwd, runId, stateDir, async () => {
    const reg = await readRegistry(cwd, runId, stateDir)
    const w = reg?.workers?.[workerId]
    if (!w) throw new Error(`team: worker 不存在: ${workerId}（run ${runId}）`)
    if (patch.status !== undefined) {
      if (!WORKER_STATUSES.includes(patch.status)) throw new Error(`team: 非法 status: ${patch.status}`)
      if (WORKER_TERMINAL.includes(w.status))
        throw new Error(`team: worker ${workerId} 已终态（${w.status}），不可复活——重新派发须 registerWorker 新 workerId`)
      if (w.status !== patch.status && !(STATUS_FLOW[w.status] ?? []).includes(patch.status))
        throw new Error(`team: 非法状态迁移 ${w.status} → ${patch.status}（合法: ${(STATUS_FLOW[w.status] ?? []).join('/') || '无'}）`)
      w.status = patch.status
      if (patch.status === 'running') {
        w.stale = false
        w.lastHeartbeatAt = new Date().toISOString() // 与 heartbeatWorker 语义对齐（评审修复：否则下轮立即重标 stale）
      }
    }
    for (const k of ['note', 'agentId', 'dispatchId', 'phase'])
      if (patch[k] !== undefined) w[k] = patch[k]
    await writeRegistry(cwd, runId, reg, stateDir)
    return w
  })
}

/** 队员心跳：复位 lastHeartbeatAt 与 stale 标记（blocked 心跳不变更 status）。 */
export async function heartbeatWorker({ cwd, runId, workerId, stateDir = '.omd', at }) {
  assertIsoTs(at, 'heartbeat at')
  return withRegistryLock(cwd, runId, stateDir, async () => {
    const reg = await readRegistry(cwd, runId, stateDir)
    const w = reg?.workers?.[workerId]
    if (!w) throw new Error(`team: worker 不存在: ${workerId}（run ${runId}）`)
    if (WORKER_TERMINAL.includes(w.status)) throw new Error(`team: worker ${workerId} 已终态（${w.status}），心跳无意义`)
    w.lastHeartbeatAt = at ?? new Date().toISOString()
    w.stale = false
    await writeRegistry(cwd, runId, reg, stateDir)
    return w
  })
}

// ---------------------------------------------------------------------------
// 3. Mailbox（leader-inbox 对应；in=队员→领队，out=领队→队员）
// ---------------------------------------------------------------------------

export const MAIL_DIRECTIONS = ['in', 'out']
export const MAIL_TYPES = {
  in: ['progress', 'blocker', 'done', 'question'],
  out: ['nudge', 'assign', 'answer'],
}

function mailboxFile(cwd, runId, direction, workerId, stateDir) {
  if (!MAIL_DIRECTIONS.includes(direction)) throw new Error(`team: 非法 mailbox direction: ${direction}`)
  return join(teamRunDir(cwd, runId, stateDir), 'mailbox', direction, `${assertWorkerId(workerId)}.jsonl`)
}

/**
 * 读 mailbox 文件：坏行容错（评审修复#2——此前一行畸形 JSONL 永久锁死整个邮箱）。
 * 坏行跳过并计数（_corrupt 标记行保留行号供审计），读路径永不因坏行抛错。
 */
async function readMailFile(file) {
  let text
  try { text = await readFile(file, 'utf8') } catch { return [] }
  const msgs = []
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    try { msgs.push(JSON.parse(line)) }
    catch { msgs.push({ _corrupt: true, line: i + 1, seq: -(i + 1), ts: '', text: `<corrupt line ${i + 1}>` }) }
  }
  return msgs
}

async function writeMailFile(file, msgs) {
  // 重写前剥离 _corrupt 标记行（不回流坏行；原坏行内容已不可还原，行号经返回值上报）
  const body = msgs.filter(m => !m._corrupt).map(m => JSON.stringify(m)).join('\n')
  await atomicWriteText(file, body ? body + '\n' : '')
}

/** 发信（append-only）：type 按 direction 校验；seq 为文件内递增（锁内算号，评审修复#1a）。 */
export async function sendMail({ cwd, runId, direction, workerId, type, text, from, stateDir = '.omd' }) {
  if (!(MAIL_TYPES[direction] ?? []).includes(type))
    throw new Error(`team: 非法 mail type '${type}'（direction=${direction} 合法: ${(MAIL_TYPES[direction] ?? []).join('/')}）`)
  if (typeof text !== 'string' || !text.trim()) throw new Error('team: mail text 必填')
  const file = mailboxFile(cwd, runId, direction, workerId, stateDir)
  return withFileLock(file, async () => {
    const msgs = await readMailFile(file)
    const msg = {
      seq: msgs.filter(m => !m._corrupt).length + 1, ts: new Date().toISOString(), direction,
      from: from ?? (direction === 'in' ? workerId : 'leader'),
      workerId, type, text, ack: false,
    }
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, JSON.stringify(msg) + '\n', 'utf8')
    return msg
  })
}

/** 读信：direction 省略时双向都读（按 workerId 聚合）；unackedOnly 只回未 ack。 */
export async function readMail({ cwd, runId, direction, workerId, unackedOnly = false, stateDir = '.omd' }) {
  const directions = direction ? [direction] : MAIL_DIRECTIONS
  const out = []
  for (const dir of directions) {
    const boxDir = join(teamRunDir(cwd, runId, stateDir), 'mailbox', dir)
    let files = []
    try { files = (await readdir(boxDir)).filter(f => f.endsWith('.jsonl')) } catch { continue }
    for (const f of files) {
      const wid = f.slice(0, -6)
      if (workerId && wid !== workerId) continue
      for (const m of await readMailFile(join(boxDir, f))) {
        if (m._corrupt) continue // 坏行不是可行动邮件（行号经 ackMail/sendMail 返回值上报）
        if (unackedOnly && m.ack) continue
        out.push(m)
      }
    }
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts) || a.seq - b.seq)
}

/** ack 标记（锁内读-改-重写，评审修复#1b——此前与并发 append 互相覆盖丢信；返回 missed 供领队发现 ack 打错对象）。 */
export async function ackMail({ cwd, runId, direction, workerId, seqs, stateDir = '.omd' }) {
  if (!Array.isArray(seqs) || !seqs.length) throw new Error('team: ackMail 缺 seqs（要 ack 的消息序号）')
  const file = mailboxFile(cwd, runId, direction, workerId, stateDir)
  return withFileLock(file, async () => {
    const msgs = await readMailFile(file)
    if (!msgs.length) throw new Error(`team: 邮箱为空或不存在: ${direction}/${workerId}`)
    const want = new Set(seqs)
    let acked = 0
    for (const m of msgs) if (!m._corrupt && want.has(m.seq) && !m.ack) { m.ack = true; acked++ }
    const present = new Set(msgs.filter(m => !m._corrupt).map(m => m.seq))
    const missed = seqs.filter(s => !present.has(s))
    await writeMailFile(file, msgs)
    const corruptLines = msgs.filter(m => m._corrupt).map(m => m.line)
    return { ok: true, acked, ...(missed.length ? { missed } : {}), ...(corruptLines.length ? { corruptLines } : {}) }
  })
}

// ---------------------------------------------------------------------------
// 4. Heartbeat 扫描（检测+呈面；绝不自动杀）
// ---------------------------------------------------------------------------

export const DEFAULT_STALE_AFTER_MS = 300_000

/**
 * 心跳扫描（评审修复#3/#4/#7 修订版）：
 * - stale 是 `now - lastHeartbeatAt > staleAfterMs` 的**可推导量**——读时计算，**不再持久化
 *   stale 标记**（扫描侧从此零 registry 写，跨进程 RMW 竞态随之消除：插件定时器进程与
 *   MCP server 进程并发扫描/心跳不再互相覆盖；心跳写 lastHeartbeatAt 即天然复位）。
 * - NaN 心跳戳视为异常上报（不静默健康）。
 * - 返回值结构化区分 alertLines（告警：stale/未处置信件/异常）与 okLines（正常行）——
 *   调用方（lib/heartbeat.js）不再做子串嗅探（用户可控文本曾可吞掉告警）。
 * 只检测与呈面——不杀队员、不替领队发言。
 * @returns { stale, outstanding, warnings, lines, alertLines, scannedAt }
 */
export async function scanHeartbeat({ cwd, runId, stateDir = '.omd', now, staleAfterMs = DEFAULT_STALE_AFTER_MS }) {
  const nowMs = now ? Date.parse(now) : Date.now()
  const reg = await readRegistry(cwd, runId, stateDir)
  const scannedAt = new Date(nowMs).toISOString()
  if (!reg) return { stale: [], outstanding: [], warnings: [], lines: [`[team] run ${runId} 无 registry（尚未派发队员）`], alertLines: [], scannedAt }
  const stale = []
  const warnings = []
  for (const w of Object.values(reg.workers)) {
    if (WORKER_TERMINAL.includes(w.status)) continue
    const hbMs = Date.parse(w.lastHeartbeatAt)
    if (Number.isNaN(hbMs)) {
      warnings.push({ workerId: w.workerId, issue: `lastHeartbeatAt 不可解析: ${String(w.lastHeartbeatAt)}` })
      continue
    }
    const idle = nowMs - hbMs
    if (idle > staleAfterMs) stale.push({ workerId: w.workerId, role: w.role, status: w.status, idleMs: idle })
  }
  const unacked = await readMail({ cwd, runId, direction: 'in', unackedOnly: true, stateDir })
  const outstanding = unacked.filter(m => m.type === 'blocker' || m.type === 'question')
  const alertLines = [
    ...stale.map(s => `[team] stale 队员: ${s.workerId}（${s.role}，status=${s.status}，${Math.round(s.idleMs / 1000)}s 无心跳）→ 上报领队处置，绝不自动杀`),
    ...outstanding.map(m => `[team] 未处置 ${m.type}: ${m.workerId} seq=${m.seq}：${m.text.slice(0, 120)}`),
    ...warnings.map(w => `[team] 心跳异常: ${w.workerId}：${w.issue}（stale 检测对该队员不可用，须人工核查）`),
  ]
  const okLines = alertLines.length ? [] : [`[team] run ${runId} 心跳扫描正常（${Object.keys(reg.workers).length} 队员，无 stale/无未处置信件）`]
  return { stale, outstanding, warnings, lines: [...alertLines, ...okLines], alertLines, scannedAt }
}

// ---------------------------------------------------------------------------
// 5. Merge plan（merge-orchestrator MVP；生成计划，执行归模型）
// ---------------------------------------------------------------------------

function gitLines(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .split('\n').map(s => s.trim()).filter(Boolean)
}

/**
 * 合并计划：c5 树内与 HEAD 的差异 ∪ 主仓工作区与 HEAD 的差异，交集=冲突候选。
 * 两侧都过滤 `${stateDir}/` 前缀（评审修复#5：`.omd/team/**`、`.omd/state/**`、
 * `.omd/notepad.md` 是 untracked 运行态，曾混进 mainFiles 并把 `.omd/notepad.md`
 * 这类双侧同名路径报成假冲突候选——merge plan 只该管项目文件）。
 * 建议序：无冲突文件先行、冲突候选殿后（人工/领队逐一裁决）。只生成计划不执行合并。
 * @returns { runId, treeFiles, mainFiles, conflicts, clean, suggestedOrder, lines }
 */
export async function buildMergePlan({ cwd, runId, stateDir = '.omd' }) {
  assertRunId(runId)
  const statePrefix = `${stateDir}/`
  const isProjectFile = f => !f.startsWith(statePrefix)
  const treeFiles = (await listTreeDiff({ cwd, runId, stateDir })).filter(isProjectFile)
  const mainTracked = gitLines(cwd, ['diff', '--name-only', 'HEAD'])
  const mainUntracked = gitLines(cwd, ['ls-files', '--others', '--exclude-standard'])
  const mainFiles = [...new Set([...mainTracked, ...mainUntracked])].filter(isProjectFile).sort()
  const treeSet = new Set(treeFiles)
  const conflicts = mainFiles.filter(f => treeSet.has(f))
  const conflictSet = new Set(conflicts)
  const clean = treeFiles.filter(f => !conflictSet.has(f))
  const suggestedOrder = [...clean, ...conflicts]
  const lines = [
    `[team] merge plan run ${runId}：树内改动 ${treeFiles.length} 文件，主仓改动 ${mainFiles.length} 文件，冲突候选 ${conflicts.length}`,
    ...conflicts.map(f => `[team] 冲突候选（树∩主仓都改）: ${f} → 殿后逐一裁决`),
  ]
  return { runId, treeFiles, mainFiles, conflicts, clean, suggestedOrder, lines }
}
