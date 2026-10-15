// tests/lib/graph-runner.test.js
// U4 S4a — lib/graph/runner.js 推进循环 unit 测试（计划
// .omd/plans/ralplan-u4-graph-runtime.md §5 Q4/Q9/Q10、§7 步骤 4、§4 unit 段；
// e2e kill/resume 留 S4b）。覆盖：
//  ① 单 command 图跑通（exit 0 / run_finished completed / journal 行序 /
//     返回后 fence 已释放）；
//  ② 幂等恢复：已完成 run 重入零重跑（仅追加 fence_acquired 审计行）；
//  ③ command 非零退出 max_attempts=1 → node_failed{retryable:false} 不重试、
//     run failed exit 1（Q10 钉死 A 的另一端）；
//  ④ timeout_ms → taskkill 强杀 → node_failed{retryable:true} → 预算内重试
//     → 超限 run failed exit 1（真实 pwsh Start-Sleep，墙钟上界钉死强杀生效）；
//  ⑤ timeout 后重试成功（marker 文件首 attempt 睡、次 attempt 直通）；
//  ⑥ gate_waiting / ⑦ agent_pending 等待语义（exit 0 + status 'waiting' +
//     terminal_status null；恢复续问不重复追加 gate_waiting）；
//  ⑧ agent watchdog：agent_pending ts 超 timeout_ms → node_failed{retryable}；
//  ⑨ graph_run 幂等：fence 存活同 runId → exit 19；
//  ⑩ takeover：stalled 现场接管成功写 fence_acquired 并续跑；非 stalled → 19；
//  ⑪ 退出码映射：journal 坏行 20 / descriptor 快照篡改 21 / conditional 边
//     UNSUPPORTED_EDGE 1 / 未捕获异常兜底 70；
//  ⑫ concurrency_limit 闸在 ready-list 出队处（journal 行序确定性断言）。
// command 子进程为真实 pwsh（Windows 真实环境实证），fixture 全落
// os.tmpdir() mkdtemp 临时目录。

import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  parseGraphDescriptor,
  sealGraphDescriptor,
} from '../../lib/graph/descriptor.js'
import { FENCE_LOCK_NAME, OwnerFence } from '../../lib/graph/fence.js'
import { EXIT_CODES, runGraph } from '../../lib/graph/runner.js'

const temps = []

function makeRunsRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'omd-graph-runner-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop(), { recursive: true, force: true })
  }
})

let fixtureSeq = 0

function commandNode(id, command, overrides = {}) {
  return {
    id,
    kind: 'command',
    title: id,
    timeout_ms: 30_000,
    max_attempts: 1,
    effect_policy: { policy: 'side_effect_free' },
    command,
    ...overrides,
  }
}

/** 最小合法 descriptor 组装（sealed）。nodes/edges 须过 S1 结构校验。 */
function makeDescriptor({ nodes, edges, entries, terminal, concurrency = 1 }) {
  fixtureSeq += 1
  return sealGraphDescriptor(
    parseGraphDescriptor({
      descriptor_version: 1,
      run_id: 'runner-test-' + fixtureSeq,
      revision_id: 'rev-1',
      goal: 'runner unit test',
      nodes,
      edges,
      entry_node_ids: entries,
      concurrency_limit: concurrency,
      terminal_verification_node_id: terminal,
    }),
  )
}

function singleCommandDescriptor(command, overrides = {}) {
  return makeDescriptor({
    nodes: [commandNode('n1', command, overrides)],
    edges: [],
    entries: ['n1'],
    terminal: 'n1',
  })
}

function fixedEdge(from, to) {
  return { id: 'e-' + from + '-' + to, kind: 'fixed', from, to }
}

function readJournal(runsRoot, runId) {
  return readFileSync(join(runsRoot, runId, 'journal.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
}

describe('command 推进', () => {
  it('单 command 图跑通：exit 0 / completed / journal 行序 / fence 释放', async () => {
    const runsRoot = makeRunsRoot()
    const descriptor = singleCommandDescriptor('Write-Output marker-hello')
    const result = await runGraph({ sealedDescriptor: descriptor, runsRoot })
    expect(result.exit_code).toBe(EXIT_CODES.OK)
    expect(result.terminal_status).toBe('completed')
    expect(result.status).toBe('completed')
    expect(result.epoch).toBe(1)

    const records = readJournal(runsRoot, descriptor.run_id)
    expect(records.map((r) => r.type)).toEqual([
      'run_started',
      'node_scheduled',
      'node_committed',
      'run_finished',
    ])
    expect(records.map((r) => r.seq)).toEqual([1, 2, 3, 4])
    expect(records[2]).toMatchObject({ node_id: 'n1', attempt: 1, exit_code: 0 })
    expect(records[2].output).toContain('marker-hello')
    // 快照落盘 + 返回后 fence 已释放（MCP 常驻进程语义，见 runner.js 头注）
    expect(existsSync(join(runsRoot, descriptor.run_id, 'descriptor.json'))).toBe(true)
    expect(existsSync(join(runsRoot, descriptor.run_id, FENCE_LOCK_NAME))).toBe(false)
  })

  it('幂等恢复：已完成 run 重入 → exit 0 且零重跑（仅 fence_acquired 审计行）', async () => {
    const runsRoot = makeRunsRoot()
    const descriptor = singleCommandDescriptor('Write-Output once')
    await runGraph({ sealedDescriptor: descriptor, runsRoot })
    const before = readJournal(runsRoot, descriptor.run_id).length
    const again = await runGraph({ sealedDescriptor: descriptor, runsRoot })
    expect(again.exit_code).toBe(EXIT_CODES.OK)
    expect(again.terminal_status).toBe('completed')
    const records = readJournal(runsRoot, descriptor.run_id)
    expect(records.length).toBe(before + 1)
    expect(records[records.length - 1]).toMatchObject({
      type: 'fence_acquired',
      owner_pid: process.pid,
    })
    expect(records.filter((r) => r.type === 'node_committed')).toHaveLength(1)
  })

  it('非零退出 max_attempts=1 → node_failed{retryable:false} 不重试、exit 1', async () => {
    const runsRoot = makeRunsRoot()
    const descriptor = singleCommandDescriptor('exit 3')
    const result = await runGraph({ sealedDescriptor: descriptor, runsRoot })
    expect(result.exit_code).toBe(EXIT_CODES.FAILED_TERMINAL)
    expect(result.terminal_status).toBe('failed')
    const records = readJournal(runsRoot, descriptor.run_id)
    const failed = records.filter((r) => r.type === 'node_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({ node_id: 'n1', attempt: 1, retryable: false })
    expect(failed[0].error).toContain('exit code 3')
    expect(records[records.length - 1]).toMatchObject({
      type: 'run_finished',
      terminal_status: 'failed',
    })
    expect(records.filter((r) => r.type === 'node_scheduled')).toHaveLength(1)
  })

  it('timeout → taskkill 强杀 → retryable 重试 → 超限 exit 1（墙钟钉死强杀）', async () => {
    const runsRoot = makeRunsRoot()
    const descriptor = singleCommandDescriptor('Start-Sleep 30', {
      timeout_ms: 100,
      max_attempts: 2,
    })
    const started = Date.now()
    const result = await runGraph({ sealedDescriptor: descriptor, runsRoot })
    const elapsed = Date.now() - started
    expect(result.exit_code).toBe(EXIT_CODES.FAILED_TERMINAL)
    expect(result.terminal_status).toBe('failed')
    // 两次 attempt 自然时长=60s；强杀生效则远低于此（留足 pwsh 启动余量）
    expect(elapsed).toBeLessThan(30_000)
    const records = readJournal(runsRoot, descriptor.run_id)
    const failed = records.filter((r) => r.type === 'node_failed')
    expect(failed).toHaveLength(2)
    expect(failed[0]).toMatchObject({ attempt: 1, retryable: true })
    expect(failed[1]).toMatchObject({ attempt: 2, retryable: false })
    expect(failed[0].error).toContain('timeout after 100ms')
    expect(records.filter((r) => r.type === 'node_scheduled')).toHaveLength(2)
  }, 40_000)

  it('timeout 后预算内重试成功（marker 文件：首 attempt 睡、次 attempt 直通）', async () => {
    const runsRoot = makeRunsRoot()
    const markerDir = mkdtempSync(join(tmpdir(), 'omd-graph-marker-'))
    temps.push(markerDir)
    const marker = join(markerDir, 'first-attempt.mark')
    const command =
      "if (Test-Path '" + marker + "') { Write-Output second-pass } " +
      "else { New-Item -Path '" + marker + "' -Force | Out-Null; Start-Sleep 30 }"
    // timeout 3000ms：大于 pwsh 启动耗时（实证 ~300-500ms）且远小于
    // Start-Sleep 30——首 attempt 被杀、次 attempt 直通。
    const descriptor = singleCommandDescriptor(command, {
      timeout_ms: 3_000,
      max_attempts: 2,
    })
    const result = await runGraph({ sealedDescriptor: descriptor, runsRoot })
    expect(result.exit_code).toBe(EXIT_CODES.OK)
    expect(result.terminal_status).toBe('completed')
    const records = readJournal(runsRoot, descriptor.run_id)
    expect(records.filter((r) => r.type === 'node_failed')).toHaveLength(1)
    const committed = records.filter((r) => r.type === 'node_committed')
    expect(committed).toHaveLength(1)
    expect(committed[0]).toMatchObject({ attempt: 2, exit_code: 0 })
    expect(committed[0].output).toContain('second-pass')
  }, 40_000)

  it('concurrency_limit=1：第二 entry 在第一 committed 后才 scheduled（行序钉死）', async () => {
    const runsRoot = makeRunsRoot()
    const descriptor = makeDescriptor({
      nodes: [
        commandNode('n1', 'Write-Output one'),
        commandNode('n2', 'Write-Output two'),
        commandNode('term', 'Write-Output done'),
      ],
      edges: [fixedEdge('n1', 'term'), fixedEdge('n2', 'term')],
      entries: ['n1', 'n2'],
      terminal: 'term',
      concurrency: 1,
    })
    const result = await runGraph({ sealedDescriptor: descriptor, runsRoot })
    expect(result.exit_code).toBe(EXIT_CODES.OK)
    const records = readJournal(runsRoot, descriptor.run_id)
    const seqOf = (type, nodeId) =>
      records.find((r) => r.type === type && r.node_id === nodeId)?.seq
    // ready 出队 code-unit 序：n1 先；闸=1 → n2 scheduled 晚于 n1 committed
    expect(seqOf('node_scheduled', 'n1')).toBeLessThan(seqOf('node_committed', 'n1'))
    expect(seqOf('node_committed', 'n1')).toBeLessThan(seqOf('node_scheduled', 'n2'))
  })

  it('concurrency_limit=2：两 entry 全部 scheduled 后才有首个 committed', async () => {
    const runsRoot = makeRunsRoot()
    const descriptor = makeDescriptor({
      nodes: [
        commandNode('n1', 'Write-Output one'),
        commandNode('n2', 'Write-Output two'),
        commandNode('term', 'Write-Output done'),
      ],
      edges: [fixedEdge('n1', 'term'), fixedEdge('n2', 'term')],
      entries: ['n1', 'n2'],
      terminal: 'term',
      concurrency: 2,
    })
    const result = await runGraph({ sealedDescriptor: descriptor, runsRoot })
    expect(result.exit_code).toBe(EXIT_CODES.OK)
    const records = readJournal(runsRoot, descriptor.run_id)
    // 只取并发对 n1/n2 的行（term 在汇合后调度，不参与本断言）
    const scheduledSeqs = records
      .filter((r) => r.type === 'node_scheduled' && (r.node_id === 'n1' || r.node_id === 'n2'))
      .map((r) => r.seq)
    const committedSeqs = records
      .filter((r) => r.type === 'node_committed' && (r.node_id === 'n1' || r.node_id === 'n2'))
      .map((r) => r.seq)
    expect(scheduledSeqs).toHaveLength(2)
    expect(committedSeqs).toHaveLength(2)
    expect(Math.max(...scheduledSeqs)).toBeLessThan(Math.min(...committedSeqs))
  })
})

describe('gate / agent 等待语义', () => {
  function gateDescriptor() {
    return makeDescriptor({
      nodes: [
        {
          id: 'gate',
          kind: 'human-approval',
          title: 'gate',
          prompt: 'Proceed?',
        },
        commandNode('term', 'Write-Output after-gate'),
      ],
      edges: [fixedEdge('gate', 'term')],
      entries: ['gate'],
      terminal: 'term',
    })
  }

  it('gate 节点 → gate_waiting 落 journal，exit 0 / status waiting / terminal null', async () => {
    const runsRoot = makeRunsRoot()
    const descriptor = gateDescriptor()
    const result = await runGraph({ sealedDescriptor: descriptor, runsRoot })
    expect(result.exit_code).toBe(EXIT_CODES.OK)
    expect(result.terminal_status).toBeNull()
    expect(result.status).toBe('waiting')
    expect(result.waiting).toEqual([{ node_id: 'gate', kind: 'gate_waiting' }])
    const records = readJournal(runsRoot, descriptor.run_id)
    expect(records.map((r) => r.type)).toEqual(['run_started', 'gate_waiting'])
    expect(records[1]).toMatchObject({ node_id: 'gate', prompt: 'Proceed?' })
    // parked 返回后 fence 释放（graph_resume/裁决提交可再入）
    expect(existsSync(join(runsRoot, descriptor.run_id, FENCE_LOCK_NAME))).toBe(false)
  })

  it('gate 无裁决恢复续问：重入不重复追加 gate_waiting', async () => {
    const runsRoot = makeRunsRoot()
    const descriptor = gateDescriptor()
    await runGraph({ sealedDescriptor: descriptor, runsRoot })
    const again = await runGraph({ sealedDescriptor: descriptor, runsRoot })
    expect(again.exit_code).toBe(EXIT_CODES.OK)
    expect(again.status).toBe('waiting')
    const records = readJournal(runsRoot, descriptor.run_id)
    expect(records.filter((r) => r.type === 'gate_waiting')).toHaveLength(1)
  })

  function agentDescriptor(overrides = {}) {
    return makeDescriptor({
      nodes: [
        {
          id: 'a1',
          kind: 'agent',
          title: 'a1',
          timeout_ms: 30_000,
          max_attempts: 1,
          effect_policy: { policy: 'side_effect_free' },
          instructions: 'read-only probe',
          ...overrides,
        },
        commandNode('term', 'Write-Output after-agent'),
      ],
      edges: [fixedEdge('a1', 'term')],
      entries: ['a1'],
      terminal: 'term',
    })
  }

  it('agent 节点 → agent_pending 带 attempt 落 journal，exit 0 / waiting', async () => {
    const runsRoot = makeRunsRoot()
    const descriptor = agentDescriptor()
    const result = await runGraph({ sealedDescriptor: descriptor, runsRoot })
    expect(result.exit_code).toBe(EXIT_CODES.OK)
    expect(result.terminal_status).toBeNull()
    expect(result.status).toBe('waiting')
    expect(result.waiting).toEqual([
      { node_id: 'a1', kind: 'agent_pending', attempt: 1 },
    ])
    const records = readJournal(runsRoot, descriptor.run_id)
    expect(records.map((r) => r.type)).toEqual(['run_started', 'agent_pending'])
    expect(records[1]).toMatchObject({ node_id: 'a1', attempt: 1 })
  })

  it('agent watchdog：agent_pending 超 timeout_ms → node_failed{retryable:false} → exit 1', async () => {
    const runsRoot = makeRunsRoot()
    const descriptor = agentDescriptor({ timeout_ms: 100, max_attempts: 1 })
    await runGraph({ sealedDescriptor: descriptor, runsRoot })
    // 拨回 agent_pending 的 ts（模拟等待已超时；seq/格式不动）
    const journalPath = join(runsRoot, descriptor.run_id, 'journal.jsonl')
    const lines = readFileSync(journalPath, 'utf8')
      .split('\n')
      .filter((l) => l.length > 0)
    const pending = JSON.parse(lines[lines.length - 1])
    expect(pending.type).toBe('agent_pending')
    pending.ts = '2020-01-01T00:00:00.000Z'
    lines[lines.length - 1] = JSON.stringify(pending)
    writeFileSync(journalPath, lines.join('\n') + '\n', 'utf8')

    const result = await runGraph({ sealedDescriptor: descriptor, runsRoot })
    expect(result.exit_code).toBe(EXIT_CODES.FAILED_TERMINAL)
    expect(result.terminal_status).toBe('failed')
    const records = readJournal(runsRoot, descriptor.run_id)
    const failed = records.filter((r) => r.type === 'node_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({ node_id: 'a1', attempt: 1, retryable: false })
    expect(failed[0].error).toContain('watchdog')
  })
})

describe('fence 幂等与接管', () => {
  it('fence 存活同 runId → exit 19（FENCED_OUT）', async () => {
    const runsRoot = makeRunsRoot()
    const descriptor = singleCommandDescriptor('Write-Output hi')
    const holder = new OwnerFence(runsRoot, descriptor.run_id)
    holder.acquire()
    const result = await runGraph({ sealedDescriptor: descriptor, runsRoot })
    expect(result.exit_code).toBe(EXIT_CODES.FENCED_OUT)
    expect(result.error).toContain('owned by another writer')
    holder.release()
  })

  it('takeover：stalled 现场接管成功写 fence_acquired 并续跑', async () => {
    const runsRoot = makeRunsRoot()
    const descriptor = makeDescriptor({
      nodes: [
        { id: 'gate', kind: 'human-approval', title: 'gate', prompt: 'Proceed?' },
        commandNode('term', 'Write-Output after-gate'),
      ],
      edges: [fixedEdge('gate', 'term')],
      entries: ['gate'],
      terminal: 'term',
    })
    // 先跑一趟落 journal（park 于 gate），再模拟旧主持锁崩溃现场
    await runGraph({ sealedDescriptor: descriptor, runsRoot })
    const staleHolder = new OwnerFence(runsRoot, descriptor.run_id)
    const acquired = staleHolder.acquire() // epoch 2（sidecar 续号）
    writeFileSync(
      join(runsRoot, descriptor.run_id, 'owner.json'),
      JSON.stringify({
        pid: 999999,
        started_at: '2020-01-01T00:00:00.000Z',
        lease_ts: '2020-01-01T00:00:00.000Z',
      }),
      'utf8',
    )
    const result = await runGraph({
      sealedDescriptor: descriptor,
      runsRoot,
      takeover: true,
      staleGraceMs: 1_000,
    })
    expect(result.exit_code).toBe(EXIT_CODES.OK)
    expect(result.status).toBe('waiting')
    const records = readJournal(runsRoot, descriptor.run_id)
    const fenceRows = records.filter((r) => r.type === 'fence_acquired')
    expect(fenceRows).toHaveLength(1)
    expect(fenceRows[0].epoch).toBe(acquired.epoch + 1)
    expect(fenceRows[0].owner_pid).toBe(process.pid)
    // 旧主失权释放不误删（新主已由 runner finally 正常释放）
    expect(staleHolder.release()).toBe(false)
  })

  it('非 stalled 现场 takeover:true → exit 19', async () => {
    const runsRoot = makeRunsRoot()
    const descriptor = singleCommandDescriptor('Write-Output hi')
    const holder = new OwnerFence(runsRoot, descriptor.run_id)
    holder.acquire()
    const result = await runGraph({
      sealedDescriptor: descriptor,
      runsRoot,
      takeover: true,
    })
    expect(result.exit_code).toBe(EXIT_CODES.FENCED_OUT)
    expect(result.error).toContain('stale grace')
    holder.release()
  })
})

describe('退出码映射', () => {
  it('journal 坏行 → 20', async () => {
    const runsRoot = makeRunsRoot()
    const descriptor = singleCommandDescriptor('Write-Output hi')
    await runGraph({ sealedDescriptor: descriptor, runsRoot })
    const journalPath = join(runsRoot, descriptor.run_id, 'journal.jsonl')
    writeFileSync(
      journalPath,
      readFileSync(journalPath, 'utf8') + '{"seq":99,"ts":',
      'utf8',
    )
    const result = await runGraph({ sealedDescriptor: descriptor, runsRoot })
    expect(result.exit_code).toBe(EXIT_CODES.CORRUPT_JOURNAL)
    expect(result.error).toContain('corrupt')
  })

  it('descriptor 快照篡改 → 21', async () => {
    const runsRoot = makeRunsRoot()
    const descriptor = singleCommandDescriptor('Write-Output hi')
    await runGraph({ sealedDescriptor: descriptor, runsRoot })
    const snapshotPath = join(runsRoot, descriptor.run_id, 'descriptor.json')
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))
    snapshot.goal = 'tampered goal'
    writeFileSync(snapshotPath, JSON.stringify(snapshot), 'utf8')
    const result = await runGraph({ sealedDescriptor: descriptor, runsRoot })
    expect(result.exit_code).toBe(EXIT_CODES.DESCRIPTOR_DRIFT)
  })

  it('conditional 边 → UNSUPPORTED_EDGE exit 1（入口 fail-fast）', async () => {
    const runsRoot = makeRunsRoot()
    const descriptor = sealGraphDescriptor(
      parseGraphDescriptor({
        descriptor_version: 1,
        run_id: 'runner-test-cond-' + fixtureSeq,
        revision_id: 'rev-1',
        goal: 'conditional rejected at entry',
        nodes: [
          commandNode('n1', 'Write-Output hi'),
          commandNode('term', 'Write-Output done'),
        ],
        edges: [
          { id: 'e-c', kind: 'conditional', from: 'n1', to: 'term', route: 'r1' },
        ],
        entry_node_ids: ['n1'],
        concurrency_limit: 1,
        terminal_verification_node_id: 'term',
      }),
    )
    const result = await runGraph({ sealedDescriptor: descriptor, runsRoot })
    expect(result.exit_code).toBe(EXIT_CODES.FAILED_TERMINAL)
    expect(result.error).toContain('UNSUPPORTED_EDGE')
  })

  it('未捕获异常兜底 → 70', async () => {
    const runsRoot = makeRunsRoot()
    const descriptor = singleCommandDescriptor('Write-Output hi')
    const result = await runGraph({
      sealedDescriptor: descriptor,
      runsRoot,
      onEvent: () => {
        throw new Error('kaboom')
      },
    })
    expect(result.exit_code).toBe(EXIT_CODES.CRASH)
    expect(result.error).toContain('kaboom')
  })
})

// ---------- IC-10 盲区③ + P2-1/P2-2 回归钉（轮 20 graph P2 批次） ----------

describe('IC-10/P2 回归钉', () => {
  it('盲区③：agent watchdog retryable:true → node_failed 后重排新 agent_pending（attempt 2），run 仍 parked', async () => {
    const runsRoot = makeRunsRoot()
    // agentDescriptor 是内层 describe 局部帮手，此处内联同款形状（a1 agent → term command）
    const descriptor = makeDescriptor({
      nodes: [
        { id: 'a1', kind: 'agent', title: 'a1', timeout_ms: 100, max_attempts: 2,
          effect_policy: { policy: 'side_effect_free' }, instructions: 'read-only probe' },
        commandNode('term', 'Write-Output after-agent'),
      ],
      edges: [fixedEdge('a1', 'term')],
      entries: ['a1'],
      terminal: 'term',
    })
    await runGraph({ sealedDescriptor: descriptor, runsRoot })
    const journalPath = join(runsRoot, descriptor.run_id, 'journal.jsonl')
    const lines = readFileSync(journalPath, 'utf8').split('\n').filter((l) => l.length > 0)
    const pending = JSON.parse(lines[lines.length - 1])
    expect(pending.type).toBe('agent_pending')
    pending.ts = '2020-01-01T00:00:00.000Z'
    lines[lines.length - 1] = JSON.stringify(pending)
    writeFileSync(journalPath, lines.join('\n') + '\n', 'utf8')

    const result = await runGraph({ sealedDescriptor: descriptor, runsRoot })
    expect(result.exit_code).toBe(EXIT_CODES.OK)
    expect(result.status).toBe('waiting')
    const records = readJournal(runsRoot, descriptor.run_id)
    const failed = records.filter((r) => r.type === 'node_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({ node_id: 'a1', attempt: 1, retryable: true })
    const pendings = records.filter((r) => r.type === 'agent_pending')
    expect(pendings).toHaveLength(2)
    expect(pendings[1]).toMatchObject({ node_id: 'a1', attempt: 2 })
  }, 20_000)

  it('P2-2：park 优先于 failed（设计定案）——返回体附 failed 摘要，消除 status 双读矛盾', async () => {
    const runsRoot = makeRunsRoot()
    const descriptor = makeDescriptor({
      nodes: [
        commandNode('bad', 'exit 1'),
        { id: 'gate', kind: 'human-approval', title: 'gate', prompt: 'Proceed?' },
        commandNode('term', 'Write-Output after-gate'),
      ],
      // bad 直达 term（结构校验要求可达终验），gate 独立 entry（无入边才首轮即 waiting）
      edges: [fixedEdge('bad', 'term'), fixedEdge('gate', 'term')],
      entries: ['bad', 'gate'],
      terminal: 'term',
    })
    const result = await runGraph({ sealedDescriptor: descriptor, runsRoot })
    expect(result.exit_code).toBe(EXIT_CODES.OK)
    expect(result.status).toBe('waiting')
    expect(Array.isArray(result.failed)).toBe(true)
    expect(result.failed.some((x) => x.node_id === 'bad')).toBe(true)
  }, 20_000)

  it('P2-1：运行中途失权（lock 外部消失）→ 错误路径收割在飞子进程（taskkill 实证）', async () => {
    const runsRoot = makeRunsRoot()
    const childA = { pid: 4242, stdout: null, stderr: null, on() {} }
    let closeB = null
    const childB = { pid: 4343, stdout: null, stderr: null, on(evt, cb) { if (evt === 'close') closeB = cb } }
    let spawnCount = 0
    const spawnImpl = () => (spawnCount++ === 0 ? childA : childB)
    const killed = []
    const execFileImpl = (cmd, args, opts, cb) => { killed.push(args); if (cb) cb() }
    const descriptor = makeDescriptor({
      nodes: [commandNode('a', 'sleep-A'), commandNode('b', 'sleep-B'), commandNode('term', 'Write-Output end')],
      edges: [fixedEdge('a', 'term'), fixedEdge('b', 'term')],
      entries: ['a', 'b'],
      terminal: 'term',
      concurrency: 2,
    })
    const lockPath = join(runsRoot, descriptor.run_id, 'owner.lock')
    const runPromise = runGraph({
      sealedDescriptor: descriptor, runsRoot, spawnImpl, execFileImpl,
    })
    for (let i = 0; i < 200; i++) {
      const recs = readJournal(runsRoot, descriptor.run_id).filter((r) => r.type === 'node_scheduled')
      if (recs.length >= 2) break
      await new Promise((r2) => setTimeout(r2, 25))
    }
    rmSync(lockPath, { force: true })
    closeB(0)
    const result = await runPromise
    expect(result.exit_code).toBe(EXIT_CODES.FENCED_OUT)
    expect(killed.some((args) => args.includes('4242'))).toBe(true)
  }, 20_000)
})