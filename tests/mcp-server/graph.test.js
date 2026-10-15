// tests/mcp-server/graph.test.js
// U4 S5 integration（计划 .omd/plans/ralplan-u4-graph-runtime.md §4 integration、
// §6 验收 1/6/8）：六工具面经 makeGraphTools 直调（仿 tests/mcp-server/hud.test.js
// 模式）。fixture 图 command/agent/gate/join 各一，全部落在 mkdtemp 临时目录
// （cwd=tmp → runsRoot=tmp/.omd/graph-runs，仓库活 .omd 零触碰）。
// 覆盖：全链绿（验收 1）/ validate UNSUPPORTED_EDGE 与畸形拒绝（验收 6）/
// node_result 匹配·幂等·拒绝 + gate_resolve 错位拒绝（验收 8）/ Q7 护栏前缀
// 落快照 / status 投影+fence / 20 损坏 / bin 入口 smoke（含护栏 hash 双入口一致）。
import { test, expect } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { makeGraphTools, projectAfter, registerGraphTools } from '../../mcp-server/tools/graph.mjs'
import { JournalCorruptionError } from '../../lib/graph/journal.js'
import { AGENT_GUARDRAIL_PREFIX } from '../../lib/graph/guardrails.js'
import { JOURNAL_FILE_NAME } from '../../lib/graph/journal.js'

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-graph-mcp-'))
  return { cwd, graph: makeGraphTools({ stateDir: '.omd' }) }
}

function commandNode(id, cmd) {
  return {
    id,
    kind: 'command',
    title: id,
    timeout_ms: 60000,
    max_attempts: 2,
    effect_policy: { policy: 'side_effect_free' },
    command: cmd,
  }
}

/** fixture 图：command/agent/gate/join 各一（join 走 fan_out/join 对）。 */
function allKindsDescriptor(runId) {
  return {
    descriptor_version: 1,
    run_id: runId,
    revision_id: 'rev-mcp-integration',
    goal: 'mcp six-tool surface integration',
    nodes: [
      commandNode('prep', 'echo prep'),
      commandNode('fan', 'echo fan'),
      commandNode('b1', 'echo b1'),
      commandNode('b2', 'echo b2'),
      { id: 'join', kind: 'join', title: 'Join', fan_out_node_id: 'fan', input_branch_ids: ['br1', 'br2'] },
      { id: 'gate', kind: 'human-approval', title: 'Gate', prompt: 'Proceed?' },
      {
        id: 'agent1',
        kind: 'agent',
        title: 'Agent',
        timeout_ms: 120000,
        max_attempts: 2,
        effect_policy: { policy: 'side_effect_free' },
        instructions: 'research something',
      },
      commandNode('term', 'echo term'),
    ],
    edges: [
      { id: 'e-prep-fan', kind: 'fixed', from: 'prep', to: 'fan' },
      { id: 'e-fan-b1', kind: 'fan_out', from: 'fan', to: 'b1', branch_id: 'br1', owner_join_id: 'join' },
      { id: 'e-fan-b2', kind: 'fan_out', from: 'fan', to: 'b2', branch_id: 'br2', owner_join_id: 'join' },
      { id: 'e-b1-join', kind: 'fixed', from: 'b1', to: 'join' },
      { id: 'e-b2-join', kind: 'fixed', from: 'b2', to: 'join' },
      { id: 'e-join-gate', kind: 'fixed', from: 'join', to: 'gate' },
      { id: 'e-gate-agent', kind: 'fixed', from: 'gate', to: 'agent1' },
      { id: 'e-agent-term', kind: 'fixed', from: 'agent1', to: 'term' },
    ],
    entry_node_ids: ['prep'],
    concurrency_limit: 2,
    terminal_verification_node_id: 'term',
  }
}

function runDir(cwd, runId) {
  return join(cwd, '.omd', 'graph-runs', runId)
}

async function readJournalRecords(cwd, runId) {
  const raw = await readFile(join(runDir(cwd, runId), JOURNAL_FILE_NAME), 'utf8')
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
}

test('validate：合法 descriptor 绿 + hash 确定性（护栏前缀幂等 → 双入口同 hash）', async () => {
  const { cwd, graph } = await setup()
  try {
    const draft = allKindsDescriptor('run-validate-ok')
    const first = await graph.validate({ cwd, descriptor: draft })
    expect(first.exit_code).toBe(0)
    expect(first.run_id).toBe('run-validate-ok')
    expect(first.descriptor_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.node_count).toBe(8)
    expect(first.edge_count).toBe(8)
    // 已带前缀的 draft 再验 → 同 hash（入口幂等，Q7；bin/MCP 双入口一致性基础）。
    const prefixed = structuredClone(draft)
    prefixed.nodes = prefixed.nodes.map((node) =>
      node.kind === 'agent'
        ? { ...node, instructions: AGENT_GUARDRAIL_PREFIX + '\n\n' + node.instructions }
        : node,
    )
    const second = await graph.validate({ cwd, descriptor: prefixed })
    expect(second.exit_code).toBe(0)
    expect(second.descriptor_hash).toBe(first.descriptor_hash)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('validate/run：UNSUPPORTED_EDGE fail-fast（验收 6）+ 畸形 descriptor 拒绝', async () => {
  const { cwd, graph } = await setup()
  try {
    // conditional 用例：最小图（2 节点，唯一出边是 conditional）——结构校验放行
    // （routed 出边合法、可达性经 conditional 成立），入口 UNSUPPORTED_EDGE 拒绝。
    const conditionalDraft = {
      descriptor_version: 1,
      run_id: 'run-unsupported',
      revision_id: 'rev-unsupported',
      goal: 'unsupported conditional',
      nodes: [commandNode('prep', 'exit 0'), commandNode('term', 'exit 0')],
      edges: [{ id: 'e-c1', kind: 'conditional', from: 'prep', to: 'term', route: 'route-a' }],
      entry_node_ids: ['prep'],
      concurrency_limit: 1,
      terminal_verification_node_id: 'term',
    }
    const validated = await graph.validate({ cwd, descriptor: conditionalDraft })
    expect(validated.exit_code).toBe(1)
    expect(validated.error).toMatch(/UNSUPPORTED_EDGE/)
    expect(validated.error).toContain('e-c1')
    const runResult = await graph.run({ cwd, descriptor: conditionalDraft })
    expect(runResult.exit_code).toBe(1)
    expect(runResult.error).toMatch(/UNSUPPORTED_EDGE/)
    expect(runResult.terminal_status).toBeNull()

    // back_edge 用例：结构合法（routed set=conditional+back_edge，无 fixed 混出）
    // 但依赖 back_edge → 入口 UNSUPPORTED_EDGE fail-fast。
    const backEdgeDraft = {
      descriptor_version: 1,
      run_id: 'run-backedge',
      revision_id: 'rev-backedge',
      goal: 'unsupported back_edge',
      nodes: [commandNode('prep', 'exit 0'), commandNode('mid', 'exit 0'), commandNode('term', 'exit 0')],
      edges: [
        { id: 'e-prep-mid', kind: 'fixed', from: 'prep', to: 'mid' },
        { id: 'e-mid-term', kind: 'conditional', from: 'mid', to: 'term', route: 'route-done' },
        { id: 'e-back', kind: 'back_edge', from: 'mid', to: 'prep', route: 'route-retry', max_traversals: 2 },
      ],
      entry_node_ids: ['prep'],
      concurrency_limit: 1,
      terminal_verification_node_id: 'term',
    }
    const backValidated = await graph.validate({ cwd, descriptor: backEdgeDraft })
    expect(backValidated.exit_code).toBe(1)
    expect(backValidated.error).toMatch(/UNSUPPORTED_EDGE/)
    expect(backValidated.error).toContain('e-back')

    const malformed = await graph.validate({
      cwd,
      descriptor: { descriptor_version: 1, run_id: 'run-malformed' },
    })
    expect(malformed.exit_code).toBe(1)
    expect(malformed.error).toBeTruthy()
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('全链绿（验收 1）：run→gate_resolve→resume→node_result→resume→completed', async () => {
  const { cwd, graph } = await setup()
  const runId = 'run-mcp-full-chain'
  try {
    // ① run：命令段（prep/fan/b1/b2）推进至 gate_waiting 首个等待点。
    const run1 = await graph.run({ cwd, descriptor: allKindsDescriptor(runId) })
    expect(run1.exit_code).toBe(0)
    expect(run1.terminal_status).toBeNull()
    expect(run1.status).toBe('waiting')
    expect(run1.waiting).toEqual([{ node_id: 'gate', kind: 'gate_waiting' }])

    // ② status：投影 + fence 观测（parked 后 fence 已释放，不占用不停滞）。
    const st1 = await graph.status({ cwd, run_id: runId })
    expect(st1.exit_code).toBe(0)
    expect(st1.status).toBe('in_progress')
    expect(st1.waiting).toEqual([{ node_id: 'gate', kind: 'gate_waiting' }])
    expect(st1.fence.occupied).toBe(false)
    expect(st1.fence.stalled).toBe(false)
    expect(st1.fence.epoch).toBeNull() // IC-10 盲区⑤：fence 字段形状钉死（parked 释放后 epoch=null）
    expect(st1.max_seq).toBeGreaterThan(0)

    // ③ gate_resolve 错位拒绝（Q6）：未知 node / 非法 decision。
    const badNode = await graph.gateResolve({ cwd, run_id: runId, node_id: 'nope', decision: 'approved' })
    expect(badNode.exit_code).toBe(1)
    expect(badNode.error).toMatch(/no gate_waiting found/)
    const badDecision = await graph.gateResolve({ cwd, run_id: runId, node_id: 'gate', decision: 'maybe' })
    expect(badDecision.exit_code).toBe(1)
    expect(badDecision.error).toMatch(/approved.*denied/)

    // ④ 裁决 approved → resume 推进至 agent_pending。
    const resolved = await graph.gateResolve({ cwd, run_id: runId, node_id: 'gate', decision: 'approved' })
    expect(resolved.exit_code).toBe(0)
    const run2 = await graph.resume({ cwd, run_id: runId })
    expect(run2.exit_code).toBe(0)
    expect(run2.status).toBe('waiting')
    expect(run2.waiting).toEqual([{ node_id: 'agent1', kind: 'agent_pending', attempt: 1 }])

    // ⑤ Q7：封印快照中 agent instructions 已带运行时护栏前缀。
    const snapshot = JSON.parse(await readFile(join(runDir(cwd, runId), 'descriptor.json'), 'utf8'))
    const agentNode = snapshot.nodes.find((node) => node.id === 'agent1')
    expect(agentNode.instructions.startsWith(AGENT_GUARDRAIL_PREFIX)).toBe(true)

    // ⑥ node_result 错位拒绝（Q11）：未知 node / attempt 不匹配。
    const wrongNode = await graph.nodeResult({ cwd, run_id: runId, node_id: 'nope', attempt: 1, exit_code: 0 })
    expect(wrongNode.exit_code).toBe(1)
    expect(wrongNode.error).toMatch(/no agent_pending found/)
    const wrongAttempt = await graph.nodeResult({ cwd, run_id: runId, node_id: 'agent1', attempt: 2, exit_code: 0 })
    expect(wrongAttempt.exit_code).toBe(1)
    expect(wrongAttempt.error).toMatch(/latest pending attempt is 1/)

    // ⑦ 提交 → node_committed 落 journal（带 output，小输出内联）。
    const journalBefore = await readJournalRecords(cwd, runId)
    const committed = await graph.nodeResult({
      cwd, run_id: runId, node_id: 'agent1', attempt: 1, exit_code: 0, output: 'agent report body',
    })
    expect(committed.exit_code).toBe(0)
    expect(committed.idempotent).toBe(false)
    const journalAfterCommit = await readJournalRecords(cwd, runId)
    expect(journalAfterCommit.length).toBe(journalBefore.length + 1)
    const commitRecord = journalAfterCommit[journalAfterCommit.length - 1]
    expect(commitRecord.type).toBe('node_committed')
    expect(commitRecord.node_id).toBe('agent1')
    expect(commitRecord.attempt).toBe(1)
    expect(commitRecord.output).toBe('agent report body')

    // ⑧ 幂等（Q11）：同 payload 幂等返回、journal 不动；异 payload 拒绝。
    const again = await graph.nodeResult({
      cwd, run_id: runId, node_id: 'agent1', attempt: 1, exit_code: 0, output: 'agent report body',
    })
    expect(again.exit_code).toBe(0)
    expect(again.idempotent).toBe(true)
    const journalAfterIdempotent = await readJournalRecords(cwd, runId)
    expect(journalAfterIdempotent.length).toBe(journalAfterCommit.length)
    const conflicting = await graph.nodeResult({
      cwd, run_id: runId, node_id: 'agent1', attempt: 1, exit_code: 3,
    })
    expect(conflicting.exit_code).toBe(1)
    expect(conflicting.error).toMatch(/different payload/)
    expect((await readJournalRecords(cwd, runId)).length).toBe(journalAfterCommit.length)

    // ⑨ gate 二次裁决拒绝（Q6 错位）。
    const doubleResolve = await graph.gateResolve({ cwd, run_id: runId, node_id: 'gate', decision: 'approved' })
    expect(doubleResolve.exit_code).toBe(1)
    expect(doubleResolve.error).toMatch(/already resolved/)

    // ⑩ resume → 终态 completed；journal seq 严格连续（observability 断言）。
    const run3 = await graph.resume({ cwd, run_id: runId })
    expect(run3.exit_code).toBe(0)
    expect(run3.terminal_status).toBe('completed')
    expect(run3.status).toBe('completed')
    const st2 = await graph.status({ cwd, run_id: runId })
    expect(st2.terminal_status).toBe('completed')
    expect(st2.done).toEqual(expect.arrayContaining(['prep', 'fan', 'b1', 'b2', 'gate', 'agent1', 'term']))
    const records = await readJournalRecords(cwd, runId)
    expect(records.map((record) => record.seq)).toEqual(
      records.map((_, index) => index + 1),
    )
    for (const record of records) {
      expect(typeof record.ts).toBe('string')
      expect(record.type).toBeTruthy()
    }
  } finally { await rm(cwd, { recursive: true, force: true }) }
}, 60000)

test('node_result/gate_resolve 前置拒绝：run 不存在 / journal 损坏 20', async () => {
  const { cwd, graph } = await setup()
  try {
    const missing = await graph.nodeResult({ cwd, run_id: 'run-absent', node_id: 'a', attempt: 1, exit_code: 0 })
    expect(missing.exit_code).toBe(1)
    expect(missing.error).toMatch(/graph run not found/)

    // 损坏 journal → status/gate_resolve fail-closed 20。
    const runId = 'run-corrupt'
    await mkdir(join(runDir(cwd, runId)), { recursive: true })
    await writeFile(
      join(runDir(cwd, runId), JOURNAL_FILE_NAME),
      '{"seq":1,"ts":"2026-01-01T00:00:00.000Z","type":"gate_waiting","node_id":"g","prompt":"p"}\nnot-json-at-all\n',
      'utf8',
    )
    const corruptStatus = await graph.status({ cwd, run_id: runId })
    expect(corruptStatus.exit_code).toBe(20)
    const corruptGate = await graph.gateResolve({ cwd, run_id: runId, node_id: 'g', decision: 'approved' })
    expect(corruptGate.exit_code).toBe(20)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('gate_resolve denied 一等结局：run 以 gate_denied 派生 failed', async () => {
  const { cwd, graph } = await setup()
  const runId = 'run-gate-denied'
  try {
    // 简化图：单 command → gate（entry gate 更短：直接 gate 为 entry）。
    const draft = allKindsDescriptor(runId)
    // 用最短路径：只留 gate → term，避免全链命令开销。
    draft.nodes = [
      { id: 'gate', kind: 'human-approval', title: 'Gate', prompt: 'Proceed?' },
      commandNode('term', 'exit 0'),
    ]
    draft.edges = [{ id: 'e-gate-term', kind: 'fixed', from: 'gate', to: 'term' }]
    draft.entry_node_ids = ['gate']
    draft.terminal_verification_node_id = 'term'
    const run1 = await graph.run({ cwd, descriptor: draft })
    expect(run1.status).toBe('waiting')
    const denied = await graph.gateResolve({ cwd, run_id: runId, node_id: 'gate', decision: 'denied' })
    expect(denied.exit_code).toBe(0)
    expect(denied.status).toBe('failed')
    expect(denied.waiting).toEqual([])
    const st = await graph.status({ cwd, run_id: runId })
    expect(st.failed).toEqual([{ node_id: 'gate', reason: 'gate_denied' }])
    expect(st.terminal_status).toBeNull() // 终结在下次 resume 落 run_finished
    const run2 = await graph.resume({ cwd, run_id: runId })
    expect(run2.exit_code).toBe(1)
    expect(run2.terminal_status).toBe('failed')
  } finally { await rm(cwd, { recursive: true, force: true }) }
}, 30000)

test('registerGraphTools：六工具注册 + 授权面诚实声明在 docstring', () => {
  const calls = []
  registerGraphTools({ registerTool: (name, def) => calls.push({ name, def }) }, { stateDir: '.omd' })
  const names = calls.map((call) => call.name)
  expect(names).toEqual([
    'graph_validate', 'graph_run', 'graph_status', 'graph_resume', 'graph_node_result', 'graph_gate_resolve',
  ])
  for (const call of calls) {
    expect(call.def.description.length).toBeGreaterThan(10)
  }
  expect(calls.find((call) => call.name === 'graph_gate_resolve').def.description).toContain('信任 MCP 调用者')
  expect(calls.find((call) => call.name === 'graph_node_result').def.description).toContain('最新 agent_pending')
  expect(calls.find((call) => call.name === 'graph_run').def.description).toContain('UNSUPPORTED_EDGE')
})

test('bin/graph-runner.mjs：agent 图 park（exit 0 waiting）+ 护栏前缀与 --takeover 幂等重入', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-graph-bin-'))
  try {
    const runsRoot = join(cwd, 'runs')
    const draft = {
      descriptor_version: 1,
      run_id: 'run-bin-smoke',
      revision_id: 'rev-bin',
      goal: 'bin entry smoke',
      nodes: [
        {
          id: 'agent1',
          kind: 'agent',
          title: 'Agent',
          timeout_ms: 120000,
          max_attempts: 1,
          effect_policy: { policy: 'side_effect_free' },
          instructions: 'read only research',
        },
        commandNode('term', 'exit 0'),
      ],
      edges: [{ id: 'e-agent-term', kind: 'fixed', from: 'agent1', to: 'term' }],
      entry_node_ids: ['agent1'],
      concurrency_limit: 1,
      terminal_verification_node_id: 'term',
    }
    const descriptorPath = join(cwd, 'draft.json')
    await writeFile(descriptorPath, JSON.stringify(draft), 'utf8')
    const binPath = new URL('../../bin/graph-runner.mjs', import.meta.url).pathname
      .replace(/^\/([A-Za-z]:)/, '$1') // win32 file URL → 盘符路径
    const spawnArgs = ['--descriptor', descriptorPath, '--runs-root', runsRoot, '--cwd', cwd]

    const first = spawnSync(process.execPath, [binPath, ...spawnArgs], {
      encoding: 'utf8',
      timeout: 30000,
    })
    expect(first.status).toBe(0)
    const lastLine1 = first.stdout.trim().split('\n').pop()
    expect(lastLine1.startsWith('GRAPH_RUN_RESULT ')).toBe(true)
    const result1 = JSON.parse(lastLine1.slice('GRAPH_RUN_RESULT '.length))
    expect(result1.exit_code).toBe(0)
    expect(result1.status).toBe('waiting')
    expect(result1.terminal_status).toBeNull()

    // 快照护栏前缀（bin 与 MCP 共用 lib/graph/guardrails.js）。
    const snapshot = JSON.parse(await readFile(join(runsRoot, 'run-bin-smoke', 'descriptor.json'), 'utf8'))
    expect(snapshot.nodes[0].instructions.startsWith(AGENT_GUARDRAIL_PREFIX)).toBe(true)

    // --takeover 幂等重入（parked 后 fence 空闲 → 仍 exit 0 waiting）。
    const second = spawnSync(process.execPath, [binPath, ...spawnArgs, '--takeover'], {
      encoding: 'utf8',
      timeout: 30000,
    })
    expect(second.status).toBe(0)
    const result2 = JSON.parse(
      second.stdout.trim().split('\n').pop().slice('GRAPH_RUN_RESULT '.length),
    )
    expect(result2.exit_code).toBe(0)
    expect(result2.status).toBe('waiting')

    // 用法错误（缺参）→ 顶层 catch 兜底 exit 70。
    const misuse = spawnSync(process.execPath, [binPath], { encoding: 'utf8', timeout: 30000 })
    expect(misuse.status).toBe(70)
    const crashResult = JSON.parse(
      misuse.stdout.trim().split('\n').pop().slice('GRAPH_RUN_RESULT '.length),
    )
    expect(crashResult.exit_code).toBe(70)
  } finally { await rm(cwd, { recursive: true, force: true }) }
}, 60000)

// ---------- IC-08/P2-10：projectAfter journal 损坏透传（轮 20 graph P2 批次） ----------

test('IC-08：projectAfter 遇 journal 损坏 → JournalCorruptionError 透传（不降级谎报 in_progress）', async () => {
  const { cwd, graph } = await setup()
  const runId = 'run-p2-10-corrupt'
  try {
    const run = await graph.run({ cwd, descriptor: allKindsDescriptor(runId) })
    expect(run.exit_code).toBe(0) // parked at gate_waiting
    const runsRoot = join(cwd, '.omd', 'graph-runs')
    // 提交已落账后 journal 损坏（追加截断半行）——修复前：提交回包谎报 status:in_progress
    await writeFile(join(runsRoot, runId, JOURNAL_FILE_NAME), '{"type":"broke', { flag: 'a' })
    expect(() => projectAfter(runsRoot, runId)).toThrowError(JournalCorruptionError)
  } finally { await rm(cwd, { recursive: true, force: true }) }
}, 20_000)

// ---------- IC-05/P2-5：wire 长度帽（轮 20 graph P2 批次） ----------

test('IC-05：node_id >128 / output_summary >8192 → 入口拒绝（wire 长度帽）', async () => {
  const { cwd, graph } = await setup()
  try {
    const longNode = 'n' + 'x'.repeat(128)
    const r1 = await graph.nodeResult({ cwd, run_id: 'run-none', node_id: longNode, attempt: 1, exit_code: 0 })
    expect(r1.exit_code).toBe(1)
    expect(r1.error).toMatch(/128/)
    const r2 = await graph.gateResolve({ cwd, run_id: 'run-none', node_id: 'g', decision: 'approved', output_summary: 's'.repeat(8193) })
    expect(r2.exit_code).toBe(1)
    expect(r2.error).toMatch(/8192/)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})