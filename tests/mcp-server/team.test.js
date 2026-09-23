// tests/mcp-server/team.test.js
// c5/c6/c8 MCP 工具接线测试（lib/{worktree,runstate,multirepo}.js → mcp-server/tools/team.mjs）
import { test, expect } from 'vitest'
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { makeTeamTools } from '../../mcp-server/tools/team.mjs'

async function freshRepo() {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-team-mcp-'))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd })
  await writeFile(join(cwd, 'README.md'), 'init\n')
  execFileSync('git', ['add', '.'], { cwd })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd })
  return cwd
}

function tools(cwd) {
  return makeTeamTools({ stateDir: '.omd' })
}

// ---------- team_begin / team_dispose / team_scan_orphans ----------

test('team_begin 建树 → run-state active；team_dispose 两阶段拆除；扫孤儿空', async () => {
  const cwd = await freshRepo()
  const t = tools(cwd)

  const begin = await t.begin({ cwd, runId: 'mcp-c5' })
  expect(begin.path).toBe(join(cwd, '.omd', 'worktrees', 'mcp-c5'))
  expect(existsSync(begin.path)).toBe(true)
  const state = JSON.parse(await readFile(join(cwd, '.omd', 'state', 'run-state.json'), 'utf8'))
  expect(state.runId).toBe('mcp-c5')
  expect(state.status).toBe('active')
  expect(state.version).toBeGreaterThanOrEqual(1)

  const dispose = await t.dispose({ cwd, runId: 'mcp-c5', reason: 'verified' })
  expect(dispose.removed).toBe(true)
  expect(dispose.state.status).toBe('disposed')
  expect(existsSync(join(cwd, '.omd', 'worktrees', 'mcp-c5'))).toBe(false)

  const scan = await t.scanOrphansTool({ cwd })
  expect(scan.orphans).toEqual([])
  await rm(cwd, { recursive: true, force: true })
})

// ---------- team_write_mirror：七字段镜像 + CAS ----------

test('team_write_mirror：七字段契约成立；mode/round/.../todo/version/updatedAt 齐备', async () => {
  const cwd = await freshRepo()
  const t = tools(cwd)
  await t.begin({ cwd, runId: 'mcp-c6' })

  const r1 = await t.writeMirror({
    cwd, stateDir: '.omd',
    patch: { mode: 'team', round: 1, current_story: 'S1', active_agents: [{ id: 'a1', role: 'executor' }] },
  })
  expect(r1.ok).toBe(true)
  expect(r1.state.mode).toBe('team')
  expect(r1.state.round).toBe(1)
  expect(r1.state.current_story).toBe('S1')
  expect(r1.state.active_agents).toEqual([{ id: 'a1', role: 'executor' }])
  expect(r1.state.version).toBeGreaterThanOrEqual(1)
  expect(r1.state.updatedAt).toBeDefined()
  expect(r1.state.todo).toBeDefined()

  const r2 = await t.writeMirror({
    cwd, stateDir: '.omd',
    patch: { round: 2, current_story: 'S2', active_agents: [{ id: 'a2', role: 'verifier' }] },
    expectUpdatedAt: r1.state.updatedAt,
  })
  expect(r2.ok).toBe(true)
  expect(r2.state.round).toBe(2)
  expect(r2.state.version).toBe(r1.state.version + 1)

  await t.dispose({ cwd, runId: 'mcp-c6', expectUpdatedAt: r2.state.updatedAt })
  await rm(cwd, { recursive: true, force: true })
})

test('team_write_mirror：stale expectUpdatedAt → CAS 冲突自动恢复（重读 ≤3 次成功）', async () => {
  const cwd = await freshRepo()
  const t = tools(cwd)
  await t.begin({ cwd, runId: 'mcp-c6-conflict' })

  const r1 = await t.writeMirror({ cwd, patch: { mode: 'team', round: 1 } })
  // 模拟并发：另一次写先把 updatedAt 改了
  const r2 = await t.writeMirror({ cwd, patch: { round: 2 } })
  expect(r2.ok).toBe(true)

  // 现在用 r1 时刻的 updatedAt 写 → expectUpdatedAt 冲突 → 自动重读最新值重试 → 成功
  const r3 = await t.writeMirror({
    cwd, patch: { round: 3 }, expectUpdatedAt: r1.state.updatedAt,
  })
  expect(r3.ok).toBe(true)
  expect(r3.state.round).toBe(3)
  expect(r3.wonFirst || r3.recovered || r3.overwrote).toBe(true)

  await t.dispose({ cwd, runId: 'mcp-c6-conflict' })
  await rm(cwd, { recursive: true, force: true })
})

// ---------- team_write_tree_state：c8 树内写 + 父仓零外溢 ----------

test('team_write_tree_state：在 c5 树内写 → 树内 .omd 懒创建，父仓 .omd 基线 hash 前后一致', async () => {
  const cwd = await freshRepo()
  const t = tools(cwd)
  await t.begin({ cwd, runId: 'mcp-c8' })

  // 父仓 .omd 基线 hash（豁免 worktrees/）
  const { hashDir } = await import('../../lib/multirepo.js')
  const baseline = hashDir(join(cwd, '.omd'), { skip: ['worktrees'] })

  const tree = join(cwd, '.omd', 'worktrees', 'mcp-c8')
  await t.writeTreeState({
    cwd: tree, rel: 'state/custom.json', data: { hello: 'tree' }, stateDir: '.omd',
  })

  expect(existsSync(join(tree, '.omd', 'state', 'custom.json'))).toBe(true)
  expect(hashDir(join(cwd, '.omd'), { skip: ['worktrees'] })).toBe(baseline) // 父仓零外溢

  await t.dispose({ cwd, runId: 'mcp-c8' })
  await rm(cwd, { recursive: true, force: true })
})

test('team_write_tree_state：非 c5 运行树（cwd 是主仓根）抛错', async () => {
  const cwd = await freshRepo()
  const t = tools(cwd)
  await expect(t.writeTreeState({
    cwd, rel: 'state/custom.json', data: { hello: 'x' }, stateDir: '.omd',
  })).rejects.toThrow(/非运行树|anchored/)
  await rm(cwd, { recursive: true, force: true })
})

// ---------- v0.4 领队运行时面（lib/team.js 接线）：阶段机/registry/mailbox/heartbeat ----------

test('team_phase_transition：合法迁移通过 + 持久化；非法迁移显式拒绝', async () => {
  const cwd = await freshRepo()
  const t = tools(cwd)
  try {
    const s1 = await t.phaseTransition({ cwd, runId: 'rt', to: 'team-exec', note: '跳过 prd' })
    expect(s1.phase).toBe('team-exec')
    const s2 = await t.phaseStatus({ cwd, runId: 'rt' })
    expect(s2.history).toHaveLength(2)
    await expect(t.phaseTransition({ cwd, runId: 'rt', to: 'team-fix' })).rejects.toThrow('非法阶段迁移')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('team_register_worker / worker_update / registry / heartbeat 全链', async () => {
  const cwd = await freshRepo()
  const t = tools(cwd)
  try {
    const w = await t.registerWorker({ cwd, runId: 'rt', worker: { role: 'omd-agent-executor', tier: 'medium', phase: 'team-exec', dispatchId: 'omdd-1' } })
    expect(w.workerId).toMatch(/^w-/)
    expect(w.status).toBe('dispatched')
    await t.workerUpdate({ cwd, runId: 'rt', workerId: w.workerId, patch: { status: 'running' } })
    await t.workerHeartbeat({ cwd, runId: 'rt', workerId: w.workerId })
    const reg = await t.registry({ cwd, runId: 'rt' })
    expect(reg.workers[w.workerId].status).toBe('running')
    expect(reg.workers[w.workerId].dispatchId).toBe('omdd-1')
    await expect(t.workerUpdate({ cwd, runId: 'rt', workerId: w.workerId, patch: { status: 'dispatched' } })).rejects.toThrow('非法状态迁移')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('team_mail_*：发信/读信/ack/未处置汇总 + heartbeat_scan 接线', async () => {
  const cwd = await freshRepo()
  const t = tools(cwd)
  try {
    const w = await t.registerWorker({ cwd, runId: 'rt', worker: { role: 'x', spawnedAt: '2026-01-01T00:00:00Z' } })
    await t.mailSend({ cwd, runId: 'rt', direction: 'in', workerId: w.workerId, type: 'blocker', text: '缺凭据' })
    const unread = await t.mailRead({ cwd, runId: 'rt', direction: 'in', unackedOnly: true })
    expect(unread).toHaveLength(1)
    const scan = await t.heartbeatScan({ cwd, runId: 'rt' })
    expect(scan.outstanding).toHaveLength(1)
    expect(scan.stale).toHaveLength(1) // spawnedAt 远旧于 now
    await t.mailAck({ cwd, runId: 'rt', direction: 'in', workerId: w.workerId, seqs: [1] })
    const scan2 = await t.heartbeatScan({ cwd, runId: 'rt' })
    expect(scan2.outstanding).toHaveLength(0)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('team_merge_plan：无冲突时 clean=全部树内改动', async () => {
  const cwd = await freshRepo()
  const t = tools(cwd)
  try {
    await t.begin({ cwd, runId: 'rt' })
    const tree = join(cwd, '.omd', 'worktrees', 'rt')
    await writeFile(join(tree, 'new-feature.js'), 'export {}\n')
    const plan = await t.mergePlan({ cwd, runId: 'rt' })
    expect(plan.conflicts).toEqual([])
    expect(plan.clean).toContain('new-feature.js')
  } finally {
    execFileSync('git', ['worktree', 'remove', '--force', join(cwd, '.omd', 'worktrees', 'rt')], { cwd, stdio: 'ignore' })
    await rm(cwd, { recursive: true, force: true })
  }
})
