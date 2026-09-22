// tests/lib/runstate.test.js
// c6 CAS 状态写验收（台账 m3-advance S6，R18 表 c6 行双对断言逐行落槽）：
// 断言对①：两写者持同一 stale revision 并发写 → 恰一胜出；败方重读重试 ≤3 后以最新读值覆盖写+warning 日志行
// 断言对②：run 结束 → run-state 含 disposed 终态且写入时间戳先于删树时间（e2e 证据面，disposeRunWorktree 已落）
// 契约要素：七字段镜像/队长独占写/双时机/version 1 起步每写+1/todo=计数+首条标题
// G6：全部状态写落 OS 临时目录，零触碰日常 .omd。
import { test, expect } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import {
  RUN_STATE_FIELDS, assertSevenFields, buildTodoSummary, buildMirrorPatch, writeRunStateMirror,
} from '../../lib/runstate.js'
import { beginTeamRun, runStatePath, casWriteRunState } from '../../lib/worktree.js'
import { atomicWriteJson, readJson } from '../../mcp-server/lib/atomic.mjs'

/** 轻量夹具：直接播种 beginTeamRun 同形 run-state（v1 active），免 git 开销。 */
async function makeSeeded() {
  const dir = await mkdtemp(join(tmpdir(), 'omd-c6-'))
  const file = runStatePath(dir)
  const at = new Date().toISOString()
  await atomicWriteJson(file, { runId: 'run-t', status: 'active', createdAt: at, version: 1, updatedAt: at })
  return { dir, file, at }
}

/** git 夹具仓（beginTeamRun 集成用）。 */
async function makeFixtureRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'omd-c6-git-'))
  const g = (...args) => execFileSync('git', args.flat(), { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  g('init', '-q')
  g('config', 'user.email', 'omd-test@example.com')
  g('config', 'user.name', 'omd-test')
  g('config', 'commit.gpgsign', 'false')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(dir, 'README.md'), '# fixture\n', 'utf8')
  g('add', '.')
  g('commit', '-q', '-m', 'init')
  return { dir }
}

const cleanup = async dir => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })

test('RUN_STATE_FIELDS 七字段契约（五要素镜像+version+updatedAt）且 assertSevenFields 双态', () => {
  expect(RUN_STATE_FIELDS).toEqual(['mode', 'round', 'current_story', 'active_agents', 'todo', 'version', 'updatedAt'])
  expect(assertSevenFields({ mode: 'ralph', round: 1, current_story: 'S6', active_agents: [], todo: {}, version: 1, updatedAt: 'x' })).toBe(true)
  expect(() => assertSevenFields({ mode: 'ralph' })).toThrow(/缺字段/)
  expect(() => assertSevenFields(null)).toThrow(/缺字段/)
})

test('buildTodoSummary：三区计数+首条标题（working 优先，回退 priority/manual，全空 null）', () => {
  expect(buildTodoSummary({ stats: { working: 1, priority: 0, manual: 0 }, items: { working: ['实现 c6'], priority: [], manual: [] } }))
    .toEqual({ working: 1, priority: 0, manual: 0, firstTitle: '实现 c6' })
  expect(buildTodoSummary({ stats: {}, items: { priority: ['p1'] } }))
    .toEqual({ working: 0, priority: 0, manual: 0, firstTitle: 'p1' })
  expect(buildTodoSummary({ stats: { manual: 2 }, items: { manual: ['m1', 'm2'] } }))
    .toEqual({ working: 0, priority: 0, manual: 2, firstTitle: 'm1' })
  expect(buildTodoSummary()).toEqual({ working: 0, priority: 0, manual: 0, firstTitle: null })
})

test('buildMirrorPatch：五要素键齐备（currentStory→current_story 等映射）+审计键透传', () => {
  const p = buildMirrorPatch({ mode: 'ralph', round: 2, currentStory: 'S6', activeAgents: ['w1'], todo: { working: 1 }, fallback: true })
  expect(p).toMatchObject({ mode: 'ralph', round: 2, current_story: 'S6', active_agents: ['w1'], todo: { working: 1 }, fallback: true })
  expect(buildMirrorPatch({ mode: 'x' }).active_agents).toEqual([]) // 非数组兜底空数组
  expect(buildMirrorPatch({}).todo).toMatchObject({ working: 0, priority: 0, manual: 0, firstTitle: null })
})

test('快照写 happy path：七字段齐备、version +1、五要素落盘', async () => {
  const { dir, file, at } = await makeSeeded()
  try {
    const r = await writeRunStateMirror({
      cwd: dir, expectUpdatedAt: at,
      patch: buildMirrorPatch({ mode: 'ralph', round: 4, currentStory: 'S6', activeAgents: ['captain'] }),
    })
    expect(r.ok).toBe(true)
    expect(r.wonFirst).toBe(true)
    expect(assertSevenFields(r.state)).toBe(true)
    const cur = await readJson(file)
    expect(cur).toMatchObject({ version: 2, mode: 'ralph', round: 4, current_story: 'S6', active_agents: ['captain'] })
    expect(cur.updatedAt).not.toBe(at)
  } finally { await cleanup(dir) }
})

// ---- 断言对①：两写者持同一 stale revision 并发 → 恰一胜出；败方重读重试恢复 + warning ----
test('C1 并发双写同 stale revision：恰一胜出，败方重读重试 ≤3 恢复（以最新读值合并）+warning 日志行', async () => {
  const { dir, file, at } = await makeSeeded()
  try {
    const logs = []
    const patchA = buildMirrorPatch({ mode: 'ralph', round: 2, currentStory: 'S6', activeAgents: ['captain'], keyA: 'from-A' })
    const patchB = buildMirrorPatch({ mode: 'ralph', round: 3, currentStory: 'S7', activeAgents: ['w1', 'w2'], keyB: 'from-B' })
    const [rA, rB] = await Promise.all([ // 同 stale revision（播种时的 updatedAt）并发写
      writeRunStateMirror({ cwd: dir, expectUpdatedAt: at, patch: patchA, log: l => logs.push(l) }),
      writeRunStateMirror({ cwd: dir, expectUpdatedAt: at, patch: patchB, log: l => logs.push(l) }),
    ])
    const winners = [rA, rB].filter(r => r.wonFirst)
    const losers = [rA, rB].filter(r => !r.wonFirst)
    expect(winners).toHaveLength(1) // 恰一胜出
    expect(winners[0].attempts).toBe(1)
    expect(losers).toHaveLength(1)
    expect(losers[0].conflicts).toBe(1)
    expect(losers[0].attempts).toBe(2) // 重读重试恰 1 次（≤3）
    expect(losers[0].recovered).toBe(true)
    expect(losers[0].warnings.join('\n')).toMatch(/warning/) // warning 日志行存在
    expect(logs.join('\n')).toMatch(/\[run-state\] warning: CAS 冲突/)
    const cur = await readJson(file)
    expect(cur.version).toBe(3) // 播种 1 → 胜者 2 → 败方重试 3（每写 +1）
    expect(cur.keyA).toBe('from-A') // 败方以最新读值（胜者产物）合并：胜者审计键保留
    expect(cur.keyB).toBe('from-B') // 败方快照落盘
    expect(cur.current_story).toBe(losers[0].state.current_story) // 快照语义：后写者五要素为准
    expect(assertSevenFields(cur)).toBe(true)
  } finally { await cleanup(dir) }
})

// ---- 断言对① 后半：重试预算耗尽 → 以最新读值覆盖写 + warning（竞态窗口经 retryBackoff 注入确定性构造）----
test('C1 预算耗尽：3 次重读重试全冲突 → 以最新读值覆盖写+warning；并发写入方产物经 merge 保留', async () => {
  const { dir, file, at } = await makeSeeded()
  try {
    // 先推进一步，使败方持有 stale revision
    await casWriteRunState({ cwd: dir, mutate: s => ({ ...s, advanced: true }) })
    const logs = []
    // 竞态对手 = 生产原语 casWriteRunState（锁外真实并发面），在每次重读与再尝试之间写入
    const competitor = async () => {
      await casWriteRunState({ cwd: dir, mutate: s => ({ ...s, competitorTick: (s.competitorTick ?? 0) + 1 }) })
    }
    const r = await writeRunStateMirror({
      cwd: dir, expectUpdatedAt: at, retries: 3,
      patch: buildMirrorPatch({ mode: 'ralph', round: 9, currentStory: 'S6', activeAgents: [], loserOnly: 'L' }),
      log: l => logs.push(l), retryBackoff: competitor,
    })
    expect(r.overwrote).toBe(true) // 预算耗尽走覆盖写
    expect(r.attempts).toBe(4) // 首次 + 3 次重试（≤3）
    expect(r.conflicts).toBe(4)
    expect(r.wonFirst).toBe(false)
    expect(r.warnings.filter(l => l.includes('重试预算耗尽'))).toHaveLength(1) // 耗尽 warning 日志行
    expect(logs.join('\n')).toMatch(/\[run-state\] warning: CAS 重试预算耗尽/)
    const cur = await readJson(file)
    expect(cur.version).toBe(6) // 播种1 → 推进2 → 对手 3/4/5 → 覆盖写 6（严格每写 +1）
    expect(cur.competitorTick).toBe(3) // 以最新读值覆盖写：对手 3 次写入产物经 merge 保留
    expect(cur.advanced).toBe(true)
    expect(cur.loserOnly).toBe('L')
    expect(cur.round).toBe(9)
    expect(assertSevenFields(cur)).toBe(true)
  } finally { await cleanup(dir) }
})

test('version/updatedAt 不可伪造：patch 携带假值被写入方强制重算', async () => {
  const { dir, file, at } = await makeSeeded()
  try {
    await writeRunStateMirror({
      cwd: dir, expectUpdatedAt: at,
      patch: { ...buildMirrorPatch({ mode: 'x' }), version: 999, updatedAt: '1999-01-01T00:00:00.000Z' },
    })
    const cur = await readJson(file)
    expect(cur.version).toBe(2)
    expect(cur.updatedAt).not.toBe('1999-01-01T00:00:00.000Z')
  } finally { await cleanup(dir) }
})

test('快照缺五要素镜像键 → 写入前抛错，文件零改动', async () => {
  const { dir, file, at } = await makeSeeded()
  try {
    await expect(writeRunStateMirror({ cwd: dir, expectUpdatedAt: at, patch: { mode: 'x' } }))
      .rejects.toThrow(/缺五要素镜像键/)
    expect(await readJson(file)).toMatchObject({ version: 1, updatedAt: at }) // 零改动
  } finally { await cleanup(dir) }
})

test('run-state 不存在 → 明确抛错（先 beginTeamRun）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omd-c6-empty-'))
  try {
    await expect(writeRunStateMirror({ cwd: dir, patch: buildMirrorPatch({ mode: 'x' }) }))
      .rejects.toThrow(/不存在/)
  } finally { await cleanup(dir) }
})

test('与 beginTeamRun 集成（生产路径）：阶段边界 v1 → 派发前快照写 v2，七字段契约全程成立', async () => {
  const { dir } = await makeFixtureRepo()
  try {
    await beginTeamRun({ cwd: dir, runId: 'run-c6' })
    const st1 = await readJson(runStatePath(dir))
    expect(st1.version).toBe(1)
    const todo = buildTodoSummary({ stats: { working: 1, priority: 0, manual: 0 }, items: { working: ['实现 c6 镜像写入'] } })
    const r = await writeRunStateMirror({
      cwd: dir, expectUpdatedAt: st1.updatedAt,
      patch: buildMirrorPatch({ mode: 'ralph', round: 4, currentStory: 'S6', activeAgents: ['omd-agent-executor'], todo }),
    })
    expect(r.ok).toBe(true)
    expect(assertSevenFields(r.state)).toBe(true)
    const cur = await readJson(runStatePath(dir))
    expect(cur).toMatchObject({
      runId: 'run-c6', status: 'active', version: 2, mode: 'ralph', round: 4, current_story: 'S6',
      active_agents: ['omd-agent-executor'],
    })
    expect(cur.todo).toEqual({ working: 1, priority: 0, manual: 0, firstTitle: '实现 c6 镜像写入' })
  } finally { await cleanup(dir) }
})
