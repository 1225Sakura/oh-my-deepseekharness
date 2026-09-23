// tests/lib/team.test.js
// v0.4.0 P2-C team 领队运行时验收：
// ① 阶段状态机迁移矩阵（合法链/非法拒绝/fix 循环上限/终态不可再迁移）
// ② 队员 registry UUID 生命周期（登记/状态流/终态不可复活/心跳复位 stale）
// ③ mailbox 双向收发/类型校验/ack/未处置汇总
// ④ heartbeat 扫描：stale 标记粘性 + 绝不自动杀（status 不被改写）
// ⑤ merge plan：树∩主仓冲突候选 + 建议序（真实 git 夹具仓）
import { test, expect } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import {
  initialPhaseState, transitionPhase, transitionPhasePersist, readPhaseState,
  registerWorker, updateWorker, heartbeatWorker, readRegistry,
  sendMail, readMail, ackMail, scanHeartbeat, buildMergePlan,
  TEAM_PHASES, TEAM_TERMINAL,
} from '../../lib/team.js'
import { beginTeamRun } from '../../lib/worktree.js'

async function tmp() { return { cwd: await mkdtemp(join(tmpdir(), 'omd-team-')) } }

// ---------------- ① 阶段状态机 ----------------

test('阶段机合法全链：plan→prd→exec→verify→fix→exec→verify→complete', () => {
  let s = initialPhaseState('2026-01-01T00:00:00Z')
  expect(s.phase).toBe('team-plan')
  expect(s.fixLoops).toBe(0)
  for (const to of ['team-prd', 'team-exec', 'team-verify', 'team-fix', 'team-exec', 'team-verify', 'complete'])
    s = transitionPhase(s, to, { note: `to ${to}` })
  expect(s.phase).toBe('complete')
  expect(s.fixLoops).toBe(1)
  expect(s.history).toHaveLength(8)
})

test('阶段机：prd 可跳过（plan→exec），history 记录', () => {
  const s = transitionPhase(initialPhaseState(), 'team-exec', { note: '范围明确，跳过 prd' })
  expect(s.phase).toBe('team-exec')
  expect(s.history[1].note).toContain('跳过')
})

test('阶段机非法迁移显式拒绝（plan→verify / exec→fix / 终态后再迁移）', () => {
  const s0 = initialPhaseState()
  expect(() => transitionPhase(s0, 'team-verify')).toThrow('非法阶段迁移')
  const sExec = transitionPhase(transitionPhase(s0, 'team-exec'), 'team-verify')
  expect(() => transitionPhase(sExec, 'team-exec')).toThrow('非法阶段迁移')
  const sDone = transitionPhase(sExec, 'complete')
  expect(() => transitionPhase(sDone, 'team-exec')).toThrow('已终态')
})

test('fix 循环上限：默认 3 次用尽后 fix→exec 拒绝，只能 failed/cancelled', () => {
  let s = initialPhaseState()
  for (const to of ['team-exec', 'team-verify', 'team-fix']) s = transitionPhase(s, to)
  for (let i = 0; i < 3; i++)
    for (const to of ['team-exec', 'team-verify', 'team-fix']) s = transitionPhase(s, to)
  expect(s.fixLoops).toBe(3)
  expect(() => transitionPhase(s, 'team-exec')).toThrow(/fix 循环超限/)
  const sFailed = transitionPhase(s, 'failed')
  expect(sFailed.phase).toBe('failed')
})

test('任意非终态可转 cancelled；持久化迁移懒建 initial 态', async () => {
  const { cwd } = await tmp()
  try {
    const s = await transitionPhasePersist({ cwd, runId: 'r1', to: 'team-exec', note: '跳过 prd' })
    expect(s.phase).toBe('team-exec')
    const read = await readPhaseState(cwd, 'r1')
    expect(read.history).toHaveLength(2)
    const s2 = await transitionPhasePersist({ cwd, runId: 'r1', to: 'cancelled' })
    expect(s2.phase).toBe('cancelled')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('TEAM_PHASES/TERMINAL 契约稳定', () => {
  expect(TEAM_PHASES).toEqual(['team-plan', 'team-prd', 'team-exec', 'team-verify', 'team-fix'])
  expect(TEAM_TERMINAL).toEqual(['complete', 'failed', 'cancelled'])
})

// ---------------- ② 队员 registry ----------------

test('registerWorker：自动 workerId、必填 role、重复 id 拒绝', async () => {
  const { cwd } = await tmp()
  try {
    const w = await registerWorker({ cwd, runId: 'r1', worker: { role: 'omd-agent-executor', tier: 'medium', phase: 'team-exec' } })
    expect(w.workerId).toMatch(/^w-[0-9a-f]{8}$/)
    expect(w.status).toBe('dispatched')
    expect(w.runId).toBe('r1')
    await expect(registerWorker({ cwd, runId: 'r1', worker: { workerId: w.workerId, role: 'x' } })).rejects.toThrow('已存在')
    await expect(registerWorker({ cwd, runId: 'r1', worker: {} })).rejects.toThrow('缺 role')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('updateWorker 状态流校验：合法链通过、跳态拒绝、终态不可复活', async () => {
  const { cwd } = await tmp()
  try {
    const w = await registerWorker({ cwd, runId: 'r1', worker: { role: 'x' } })
    const id = w.workerId
    await expect(updateWorker({ cwd, runId: 'r1', workerId: id, patch: { status: 'running' } })).resolves.toMatchObject({ status: 'running' })
    await updateWorker({ cwd, runId: 'r1', workerId: id, patch: { status: 'blocked' } })
    await updateWorker({ cwd, runId: 'r1', workerId: id, patch: { status: 'running' } }) // blocked→running 合法
    await updateWorker({ cwd, runId: 'r1', workerId: id, patch: { status: 'done' } })
    await expect(updateWorker({ cwd, runId: 'r1', workerId: id, patch: { status: 'running' } })).rejects.toThrow('不可复活')
    await expect(updateWorker({ cwd, runId: 'r1', workerId: 'nope', patch: { status: 'running' } })).rejects.toThrow('不存在')
    const w2 = await registerWorker({ cwd, runId: 'r1', worker: { role: 'y' } })
    await expect(updateWorker({ cwd, runId: 'r1', workerId: w2.workerId, patch: { status: 'bogus' } })).rejects.toThrow('非法 status')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('heartbeatWorker：复位 stale；终态队员心跳拒绝', async () => {
  const { cwd } = await tmp()
  try {
    const w = await registerWorker({ cwd, runId: 'r1', worker: { role: 'x', spawnedAt: '2026-01-01T00:00:00Z' } })
    await updateWorker({ cwd, runId: 'r1', workerId: w.workerId, patch: { status: 'running' } })
    const h = await heartbeatWorker({ cwd, runId: 'r1', workerId: w.workerId, at: '2026-01-01T01:00:00Z' })
    expect(h.lastHeartbeatAt).toBe('2026-01-01T01:00:00Z')
    expect(h.stale).toBe(false)
    await updateWorker({ cwd, runId: 'r1', workerId: w.workerId, patch: { status: 'done' } })
    await expect(heartbeatWorker({ cwd, runId: 'r1', workerId: w.workerId })).rejects.toThrow('已终态')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

// ---------------- ③ mailbox ----------------

test('mailbox：双向类型校验、读写、ack、unackedOnly', async () => {
  const { cwd } = await tmp()
  try {
    await sendMail({ cwd, runId: 'r1', direction: 'in', workerId: 'w-a', type: 'blocker', text: '卡在依赖 X' })
    await sendMail({ cwd, runId: 'r1', direction: 'in', workerId: 'w-a', type: 'progress', text: '已完成 50%' })
    await sendMail({ cwd, runId: 'r1', direction: 'out', workerId: 'w-a', type: 'nudge', text: '请汇报进度' })
    await expect(sendMail({ cwd, runId: 'r1', direction: 'in', workerId: 'w-a', type: 'nudge', text: 'x' })).rejects.toThrow('非法 mail type')
    await expect(sendMail({ cwd, runId: 'r1', direction: 'in', workerId: 'w-a', type: 'progress', text: ' ' })).rejects.toThrow('text 必填')

    const all = await readMail({ cwd, runId: 'r1' })
    expect(all).toHaveLength(3)
    const inbox = await readMail({ cwd, runId: 'r1', direction: 'in', workerId: 'w-a' })
    expect(inbox.map(m => m.type)).toEqual(['blocker', 'progress'])
    const unacked = await readMail({ cwd, runId: 'r1', direction: 'in', unackedOnly: true })
    expect(unacked).toHaveLength(2)
    const r = await ackMail({ cwd, runId: 'r1', direction: 'in', workerId: 'w-a', seqs: [1] })
    expect(r.acked).toBe(1)
    const unacked2 = await readMail({ cwd, runId: 'r1', direction: 'in', unackedOnly: true })
    expect(unacked2).toHaveLength(1)
    expect(unacked2[0].type).toBe('progress')
    await expect(ackMail({ cwd, runId: 'r1', direction: 'in', workerId: 'ghost', seqs: [1] })).rejects.toThrow('为空或不存在')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

// ---------------- ④ heartbeat 扫描 ----------------

test('scanHeartbeat：超时标 stale（粘性、不杀队员），心跳复位，outstanding 汇总', async () => {
  const { cwd } = await tmp()
  try {
    const t0 = '2026-01-01T00:00:00Z'
    const w1 = await registerWorker({ cwd, runId: 'r1', worker: { role: 'x', spawnedAt: t0 } })
    const w2 = await registerWorker({ cwd, runId: 'r1', worker: { role: 'y', spawnedAt: t0 } })
    await updateWorker({ cwd, runId: 'r1', workerId: w2.workerId, patch: { status: 'done' } })
    await sendMail({ cwd, runId: 'r1', direction: 'in', workerId: w1.workerId, type: 'blocker', text: '需要凭据' })

    const s1 = await scanHeartbeat({ cwd, runId: 'r1', now: '2026-01-01T00:10:00Z', staleAfterMs: 300_000 })
    expect(s1.stale).toHaveLength(1)                       // w2 终态不参与
    expect(s1.stale[0].workerId).toBe(w1.workerId)
    expect(s1.outstanding).toHaveLength(1)
    expect(s1.outstanding[0].type).toBe('blocker')
    const reg = await readRegistry(cwd, 'r1')
    expect(reg.workers[w1.workerId].stale).toBe(true)
    expect(reg.workers[w1.workerId].status).toBe('dispatched') // 绝不自动杀：status 不被改写

    await heartbeatWorker({ cwd, runId: 'r1', workerId: w1.workerId, at: '2026-01-01T00:11:00Z' })
    const s2 = await scanHeartbeat({ cwd, runId: 'r1', now: '2026-01-01T00:12:00Z', staleAfterMs: 300_000 })
    expect(s2.stale).toHaveLength(0)
    const reg2 = await readRegistry(cwd, 'r1')
    expect(reg2.workers[w1.workerId].stale).toBe(false)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('scanHeartbeat：无 registry 时报告而不崩', async () => {
  const { cwd } = await tmp()
  try {
    const s = await scanHeartbeat({ cwd, runId: 'ghost-run' })
    expect(s.stale).toEqual([])
    expect(s.lines[0]).toContain('无 registry')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

// ---------------- ⑤ merge plan（真实 git 夹具仓） ----------------

async function makeFixtureRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'omd-team-git-'))
  const g = (...args) => execFileSync('git', args.flat(), { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  g(['init', '-q'])
  g(['config', 'user.email', 'omd-test@example.com'])
  g(['config', 'user.name', 'omd-test'])
  g(['config', 'commit.gpgsign', 'false'])
  await writeFile(join(dir, 'a.txt'), 'a\n', 'utf8')
  await writeFile(join(dir, 'b.txt'), 'b\n', 'utf8')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'init'])
  return { dir, g }
}

test('buildMergePlan：树∩主仓交集=冲突候选，建议序无冲突先行', async () => {
  const { dir, g } = await makeFixtureRepo()
  try {
    await beginTeamRun({ cwd: dir, runId: 'r1' })
    const tree = join(dir, '.omd', 'worktrees', 'r1')
    await writeFile(join(tree, 'a.txt'), 'a tree\n', 'utf8')   // 树改 a（与主仓冲突）
    await writeFile(join(tree, 'c.txt'), 'c\n', 'utf8')        // 树加 c（无冲突）
    await writeFile(join(dir, 'a.txt'), 'a main\n', 'utf8')    // 主仓也改 a
    await writeFile(join(dir, 'd.txt'), 'd\n', 'utf8')         // 主仓加 d（与树无关）
    const plan = await buildMergePlan({ cwd: dir, runId: 'r1' })
    expect(plan.conflicts).toEqual(['a.txt'])
    expect(plan.clean).toEqual(['c.txt'])
    expect(plan.suggestedOrder).toEqual(['c.txt', 'a.txt'])    // 无冲突先行、冲突殿后
    expect(plan.mainFiles).toContain('d.txt')
    expect(plan.lines[0]).toContain('冲突候选 1')
  } finally {
    g(['worktree', 'remove', '--force', join(dir, '.omd', 'worktrees', 'r1')])
    await rm(dir, { recursive: true, force: true })
  }
})
