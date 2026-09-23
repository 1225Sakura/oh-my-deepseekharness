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
  const sExec = transitionPhase(transitionPhase(s0, 'team-exec', { note: '跳过 prd' }), 'team-verify')
  expect(() => transitionPhase(sExec, 'team-exec')).toThrow('非法阶段迁移')
  const sDone = transitionPhase(sExec, 'complete')
  expect(() => transitionPhase(sDone, 'team-exec')).toThrow('已终态')
})

test('fix 循环上限：默认 3 次用尽后 fix→exec 拒绝，只能 failed/cancelled', () => {
  let s = initialPhaseState()
  for (const to of ['team-exec', 'team-verify', 'team-fix']) s = transitionPhase(s, to, { note: to === 'team-exec' && s.phase === 'team-plan' ? '跳过 prd' : '' })
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

test('scanHeartbeat：超时派生 stale（不持久化、不杀队员），心跳复位，outstanding 汇总', async () => {
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
    expect(s1.alertLines.length).toBeGreaterThanOrEqual(2) // stale + outstanding 各一
    const reg = await readRegistry(cwd, 'r1')
    // 评审修复#3：stale 改为读时派生，扫描侧零 registry 写（跨进程竞态消除）
    expect(reg.workers[w1.workerId].stale).toBe(false)
    expect(reg.workers[w1.workerId].status).toBe('dispatched') // 绝不自动杀：status 不被改写

    await heartbeatWorker({ cwd, runId: 'r1', workerId: w1.workerId, at: '2026-01-01T00:11:00Z' })
    const s2 = await scanHeartbeat({ cwd, runId: 'r1', now: '2026-01-01T00:12:00Z', staleAfterMs: 300_000 })
    expect(s2.stale).toHaveLength(0)
    // blocker 未 ack → outstanding 告警仍在（stale 已复位）
    expect(s2.outstanding).toHaveLength(1)
    expect(s2.alertLines).toHaveLength(1)
    expect(s2.alertLines[0]).toContain('未处置 blocker')
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

// ---------------- 评审修复回归（v0.4.1，REQUEST CHANGES 闭环） ----------------

test('评审#1a：并发 sendMail 全部落信且 seq 唯一递增', async () => {
  const { cwd } = await tmp()
  try {
    await Promise.all(Array.from({ length: 20 }, (_, i) =>
      sendMail({ cwd, runId: 'r1', direction: 'in', workerId: 'w-a', type: 'progress', text: `msg-${i}` })))
    const msgs = await readMail({ cwd, runId: 'r1', direction: 'in', workerId: 'w-a' })
    expect(msgs).toHaveLength(20)
    expect(new Set(msgs.map(m => m.seq)).size).toBe(20) // 无重复 seq
    expect(new Set(msgs.map(m => m.text)).size).toBe(20) // 无丢信
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('评审#1b：sendMail 与 ackMail 并发不丢信', async () => {
  const { cwd } = await tmp()
  try {
    await sendMail({ cwd, runId: 'r1', direction: 'in', workerId: 'w-a', type: 'progress', text: 'm0' })
    await Promise.all([
      ...Array.from({ length: 5 }, (_, i) => sendMail({ cwd, runId: 'r1', direction: 'in', workerId: 'w-a', type: 'progress', text: `m${i + 1}` })),
      ackMail({ cwd, runId: 'r1', direction: 'in', workerId: 'w-a', seqs: [1] }),
    ])
    const msgs = await readMail({ cwd, runId: 'r1', direction: 'in', workerId: 'w-a' })
    expect(msgs).toHaveLength(6) // ack 重写不覆盖并发 append
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('评审#2：畸形 JSONL 行不锁死邮箱（跳过+计数，读写 ack 照常）', async () => {
  const { cwd } = await tmp()
  try {
    await sendMail({ cwd, runId: 'r1', direction: 'in', workerId: 'w-a', type: 'progress', text: 'good-1' })
    const { appendFile } = await import('node:fs/promises')
    await appendFile(join(cwd, '.omd', 'team', 'r1', 'mailbox', 'in', 'w-a.jsonl'), '{not json\n', 'utf8')
    // 读：坏行被跳过，好行可读
    const msgs = await readMail({ cwd, runId: 'r1', direction: 'in', workerId: 'w-a' })
    expect(msgs.map(m => m.text)).toEqual(['good-1'])
    // 发：照常追加
    await sendMail({ cwd, runId: 'r1', direction: 'in', workerId: 'w-a', type: 'progress', text: 'good-2' })
    expect((await readMail({ cwd, runId: 'r1', direction: 'in', workerId: 'w-a' })).map(m => m.text)).toEqual(['good-1', 'good-2'])
    // ack：照常且上报 corruptLines
    const r = await ackMail({ cwd, runId: 'r1', direction: 'in', workerId: 'w-a', seqs: [1] })
    expect(r.acked).toBe(1)
    expect(r.corruptLines).toEqual([2])
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('评审#3：registry 20 并发 update/heartbeat 混合全部留存', async () => {
  const { cwd } = await tmp()
  try {
    const workers = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      registerWorker({ cwd, runId: 'r1', worker: { role: `role-${i}` } })))
    await Promise.all(workers.flatMap((w, i) => [
      updateWorker({ cwd, runId: 'r1', workerId: w.workerId, patch: { status: 'running', note: `note-${i}` } }),
      heartbeatWorker({ cwd, runId: 'r1', workerId: w.workerId, at: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z` }),
    ]))
    const reg = await readRegistry(cwd, 'r1')
    for (const [i, w] of workers.entries()) {
      expect(reg.workers[w.workerId].note).toBe(`note-${i}`)
      expect(reg.workers[w.workerId].lastHeartbeatAt).toContain(`T00:${String(i).padStart(2, '0')}:`)
    }
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('评审#6：phase.json 损坏显式拒绝（不静默重置状态机）', async () => {
  const { cwd } = await tmp()
  try {
    await transitionPhasePersist({ cwd, runId: 'r1', to: 'team-exec', note: 'x' })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(cwd, '.omd', 'team', 'r1', 'phase.json'), '{corrupt!!!', 'utf8')
    await expect(transitionPhasePersist({ cwd, runId: 'r1', to: 'team-verify' })).rejects.toThrow('损坏')
    await expect(readPhaseState(cwd, 'r1')).rejects.toThrow('损坏')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('评审#7：非法时间戳入口拒绝；NaN 心跳戳扫描侧上报（不静默健康）', async () => {
  const { cwd } = await tmp()
  try {
    await expect(registerWorker({ cwd, runId: 'r1', worker: { role: 'x', spawnedAt: 'not-a-date' } })).rejects.toThrow('不是可解析时间戳')
    const w = await registerWorker({ cwd, runId: 'r1', worker: { role: 'x' } })
    await expect(heartbeatWorker({ cwd, runId: 'r1', workerId: w.workerId, at: 'bogus' })).rejects.toThrow('不是可解析时间戳')
    // 手工注入 NaN 心跳戳（绕过入口校验的损坏数据）→ 扫描上报 warnings
    const { atomicWriteJson } = await import('../../mcp-server/lib/atomic.mjs')
    const reg = await readRegistry(cwd, 'r1')
    reg.workers[w.workerId].lastHeartbeatAt = 'garbage'
    await atomicWriteJson(join(cwd, '.omd', 'team', 'r1', 'registry.json'), reg)
    const s = await scanHeartbeat({ cwd, runId: 'r1' })
    expect(s.warnings).toHaveLength(1)
    expect(s.warnings[0].issue).toContain('不可解析')
    expect(s.alertLines.some(l => l.includes('心跳异常'))).toBe(true)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('评审：跳过 prd 必须给 note（文档漂移升级为强制）', async () => {
  const { cwd } = await tmp()
  try {
    await expect(transitionPhasePersist({ cwd, runId: 'r1', to: 'team-exec' })).rejects.toThrow('必须给 note')
    const s = await transitionPhasePersist({ cwd, runId: 'r1', to: 'team-exec', note: '范围明确' })
    expect(s.phase).toBe('team-exec')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('评审LOW：ackMail 不存在的 seq 进 missed（不静默成功）', async () => {
  const { cwd } = await tmp()
  try {
    await sendMail({ cwd, runId: 'r1', direction: 'in', workerId: 'w-a', type: 'progress', text: 'm1' })
    const r = await ackMail({ cwd, runId: 'r1', direction: 'in', workerId: 'w-a', seqs: [1, 99] })
    expect(r.acked).toBe(1)
    expect(r.missed).toEqual([99])
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('评审#5：merge plan 排除 .omd/** 运行态（不假报冲突候选）', async () => {
  const { dir, g } = await makeFixtureRepo()
  try {
    await beginTeamRun({ cwd: dir, runId: 'r1' })
    const tree = join(dir, '.omd', 'worktrees', 'r1')
    // 树内懒建 .omd（c8）+ 主仓 .omd 运行态——都不应进 merge plan
    const { mkdir, writeFile: wf } = await import('node:fs/promises')
    await mkdir(join(tree, '.omd', 'state'), { recursive: true })
    await wf(join(tree, '.omd', 'state', 'x.json'), '{}')
    await wf(join(tree, 'feature.js'), 'export {}\n')
    const plan = await buildMergePlan({ cwd: dir, runId: 'r1' })
    expect(plan.treeFiles).toEqual(['feature.js'])
    expect(plan.mainFiles.every(f => !f.startsWith('.omd/'))).toBe(true)
    expect(plan.conflicts).toEqual([])
    expect(plan.clean).toEqual(['feature.js'])
  } finally {
    g(['worktree', 'remove', '--force', join(dir, '.omd', 'worktrees', 'r1')])
    await rm(dir, { recursive: true, force: true })
  }
})
