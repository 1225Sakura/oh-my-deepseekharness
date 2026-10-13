// tests/lib/graph-scheduler.test.js
// U4 S3 — lib/graph/scheduler.js 纯函数投影 unit 测试（计划
// .omd/plans/ralplan-u4-graph-runtime.md §5 Q4/Q5、§7 步骤 3、§4 unit 段；
// PRD S3 C1/C2）。覆盖：
//  ① simple-linear fixture 投影：空 journal → entry ready；逐提交推进；
//    全链 committed + run_finished → completed；
//  ② 恢复投影（node_committed 唯一完成判据不变量）：scheduled-uncommitted
//    → ready 重跑（attempt 续号、reason 'rerun'）；committed 零重跑；
//    node_failed retryable → 'retry' 续号；超限/不可重试 → failed；
//  ③ fanout-join fixture 投影：fan 提交 → cohort fan-coh0 + token tok0/tok1
//    （runner.ts L142-151 0-based 合成身份）；单边到达 join 仍 blocked；
//    双边到达 → join 确定性消解（resolveJoin 语义，consumed 恰好一次、
//    纯函数重放幂等）；term ready；
//  ④ gate：gate_waiting → waiting；approved → done 放行；denied → failed；
//  ⑤ agent_pending → waiting（带 attempt，供 graph_node_result 匹配）；
//  ⑥ UNSUPPORTED_EDGE：conditional/back_edge descriptor 入口拒绝
//    （exitCode 1 + 显式文案）；
//  ⑦ 记录流完整性闸：seq 乱序 / 未知 type / run_id 不匹配 / descriptor_hash
//    漂移（21）。
// 纯函数零 I/O：journal 记录全部为测试内字面量；fixture JSON 只读。

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  parseGraphDescriptor,
  sealGraphDescriptor,
} from '../../lib/graph/descriptor.js'
import {
  GraphSchedulerError,
  UnsupportedEdgeError,
  assertSupportedEdges,
  branchTokenIdFor,
  cohortIdFor,
  projectGraph,
} from '../../lib/graph/scheduler.js'

const here = dirname(fileURLToPath(import.meta.url))

function loadFixture(name) {
  return JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'))
}

function sealed(fixture) {
  return sealGraphDescriptor(parseGraphDescriptor(fixture))
}

/** 扁平 journal 记录字面量构造（ts 固定，投影不读时钟）。 */
function rec(seq, type, fields = {}) {
  return { seq, ts: '2026-10-13T00:00:00.000Z', type, ...fields }
}

function runStarted(descriptor, seq = 1) {
  return rec(seq, 'run_started', {
    run_id: descriptor.run_id,
    descriptor_hash: descriptor.descriptor_hash,
  })
}

function scheduled(seq, nodeId, attempt) {
  return rec(seq, 'node_scheduled', { node_id: nodeId, attempt })
}

function committed(seq, nodeId, attempt) {
  return rec(seq, 'node_committed', {
    node_id: nodeId,
    attempt,
    exit_code: 0,
  })
}

describe('simple-linear fixture 投影', () => {
  const descriptor = sealed(loadFixture('graph-simple-linear.json'))

  it('空 journal：entry ready，其余 blocked，in_progress', () => {
    const projection = projectGraph(descriptor, [runStarted(descriptor)])
    expect(projection.ready).toEqual([
      { node_id: 'n1', attempt: 1, reason: 'initial' },
    ])
    expect(projection.blocked).toEqual(['n2', 'n3', 'term'])
    expect(projection.done).toEqual([])
    expect(projection.waiting).toEqual([])
    expect(projection.failed).toEqual([])
    expect(projection.cohorts).toEqual([])
    expect(projection.status).toBe('in_progress')
    expect(projection.terminal_status).toBeNull()
    expect(projection.max_seq).toBe(1)
  })

  it('n1 committed → n2 ready（fixed 边放行）', () => {
    const projection = projectGraph(descriptor, [
      runStarted(descriptor),
      scheduled(2, 'n1', 1),
      committed(3, 'n1', 1),
    ])
    expect(projection.done).toEqual(['n1'])
    expect(projection.ready).toEqual([
      { node_id: 'n2', attempt: 1, reason: 'initial' },
    ])
    expect(projection.blocked).toEqual(['n3', 'term'])
  })

  it('全链 committed + run_finished → completed，run_finished 权威', () => {
    const projection = projectGraph(descriptor, [
      runStarted(descriptor),
      scheduled(2, 'n1', 1),
      committed(3, 'n1', 1),
      scheduled(4, 'n2', 1),
      committed(5, 'n2', 1),
      scheduled(6, 'n3', 1),
      committed(7, 'n3', 1),
      scheduled(8, 'term', 1),
      committed(9, 'term', 1),
      rec(10, 'run_finished', { terminal_status: 'completed' }),
    ])
    expect(projection.done).toEqual(['n1', 'n2', 'n3', 'term'])
    expect(projection.ready).toEqual([])
    expect(projection.status).toBe('completed')
    expect(projection.terminal_status).toBe('completed')
    expect(projection.max_seq).toBe(10)
  })
})

describe('恢复投影：node_committed 唯一完成判据', () => {
  const descriptor = sealed(loadFixture('graph-simple-linear.json'))

  it('scheduled-uncommitted → ready 重跑（attempt 续号，reason rerun）', () => {
    // 崩溃窗口：n2 已 scheduled（副作用可能已发生）但无 node_committed。
    const projection = projectGraph(descriptor, [
      runStarted(descriptor),
      scheduled(2, 'n1', 1),
      committed(3, 'n1', 1),
      scheduled(4, 'n2', 1),
    ])
    expect(projection.done).toEqual(['n1'])
    expect(projection.ready).toEqual([
      { node_id: 'n2', attempt: 2, reason: 'rerun' },
    ])
  })

  it('committed 节点零重跑；同输入两次投影逐位相等（确定性重放）', () => {
    const records = [
      runStarted(descriptor),
      scheduled(2, 'n1', 1),
      committed(3, 'n1', 1),
      scheduled(4, 'n2', 1),
      committed(5, 'n2', 1),
    ]
    const first = projectGraph(descriptor, records)
    const second = projectGraph(descriptor, records)
    expect(first).toEqual(second)
    expect(first.ready).toEqual([
      { node_id: 'n3', attempt: 1, reason: 'initial' },
    ])
    expect(first.done).toEqual(['n1', 'n2'])
    // n1/n2 不再出现在 ready（committed 零重跑）
    expect(first.ready.map((r) => r.node_id)).not.toContain('n1')
    expect(first.ready.map((r) => r.node_id)).not.toContain('n2')
  })

  it('node_failed retryable（attempt < max_attempts）→ ready 续号重试', () => {
    const projection = projectGraph(descriptor, [
      runStarted(descriptor),
      scheduled(2, 'n1', 1),
      rec(3, 'node_failed', {
        node_id: 'n1',
        attempt: 1,
        error: 'boom',
        retryable: true,
      }),
    ])
    expect(projection.ready).toEqual([
      { node_id: 'n1', attempt: 2, reason: 'retry' },
    ])
    expect(projection.failed).toEqual([])
    expect(projection.status).toBe('in_progress')
  })

  it('node_failed 超限（attempt == max_attempts）→ failed，run 派生 failed', () => {
    const records = []
    let seq = 1
    records.push(runStarted(descriptor, seq++))
    for (let attempt = 1; attempt <= 3; attempt++) {
      records.push(scheduled(seq++, 'n1', attempt))
      records.push(
        rec(seq++, 'node_failed', {
          node_id: 'n1',
          attempt,
          error: 'boom',
          retryable: attempt < 3,
        }),
      )
    }
    const projection = projectGraph(descriptor, records)
    expect(projection.ready).toEqual([])
    expect(projection.failed).toEqual([
      { node_id: 'n1', reason: 'attempts_exhausted' },
    ])
    expect(projection.status).toBe('failed')
  })

  it('retryable:false 记录 → non_retryable_failure（fail-closed 方向取与）', () => {
    const projection = projectGraph(descriptor, [
      runStarted(descriptor),
      scheduled(2, 'n1', 1),
      rec(3, 'node_failed', {
        node_id: 'n1',
        attempt: 1,
        error: 'fatal',
        retryable: false,
      }),
    ])
    expect(projection.failed).toEqual([
      { node_id: 'n1', reason: 'non_retryable_failure' },
    ])
    expect(projection.status).toBe('failed')
  })

  it('scheduled 悬挂且预算耗满 → attempts_exhausted（崩溃重跑也耗预算）', () => {
    const projection = projectGraph(descriptor, [
      runStarted(descriptor),
      scheduled(2, 'n1', 1),
      scheduled(3, 'n1', 2),
      scheduled(4, 'n1', 3), // max_attempts=3，第三次崩溃悬挂
    ])
    expect(projection.ready).toEqual([])
    expect(projection.failed).toEqual([
      { node_id: 'n1', reason: 'attempts_exhausted' },
    ])
  })
})

describe('fanout-join fixture 投影', () => {
  const descriptor = sealed(loadFixture('graph-fanout-join.json'))

  it('空 journal：fan ready，其余 blocked', () => {
    const projection = projectGraph(descriptor, [runStarted(descriptor)])
    expect(projection.ready).toEqual([
      { node_id: 'fan', attempt: 1, reason: 'initial' },
    ])
    expect(projection.blocked).toEqual(['b1', 'b2', 'join', 'term'])
  })

  it('fan committed → cohort fan-coh0 + token tok0/tok1，b1/b2 ready，join blocked', () => {
    const projection = projectGraph(descriptor, [
      runStarted(descriptor),
      scheduled(2, 'fan', 1),
      committed(3, 'fan', 1),
    ])
    expect(projection.ready.map((r) => r.node_id)).toEqual(['b1', 'b2'])
    expect(projection.cohorts).toEqual([
      {
        cohort_id: cohortIdFor('fan', 0),
        fan_out_node_id: 'fan',
        owner_join_id: 'join',
        token_ids: [
          branchTokenIdFor('fan-coh0', 0),
          branchTokenIdFor('fan-coh0', 1),
        ],
        arrived_token_ids: [],
        consumed: false,
      },
    ])
    expect(cohortIdFor('fan', 0)).toBe('fan-coh0')
    expect(branchTokenIdFor('fan-coh0', 0)).toBe('fan-coh0-tok0')
    expect(projection.blocked).toEqual(['join', 'term'])
  })

  it('单边到达（b1 committed）：join 仍 blocked，token tok0 arrived', () => {
    const projection = projectGraph(descriptor, [
      runStarted(descriptor),
      scheduled(2, 'fan', 1),
      committed(3, 'fan', 1),
      scheduled(4, 'b1', 1),
      committed(5, 'b1', 1),
    ])
    expect(projection.blocked).toEqual(['join', 'term'])
    expect(projection.ready.map((r) => r.node_id)).toEqual(['b2'])
    expect(projection.cohorts[0].arrived_token_ids).toEqual(['fan-coh0-tok0'])
    expect(projection.cohorts[0].consumed).toBe(false)
  })

  it('双边到达 → join 消解（done）、consumed 恰好一次、term ready', () => {
    const records = [
      runStarted(descriptor),
      scheduled(2, 'fan', 1),
      committed(3, 'fan', 1),
      scheduled(4, 'b1', 1),
      committed(5, 'b1', 1),
      scheduled(6, 'b2', 1),
      committed(7, 'b2', 1),
    ]
    const projection = projectGraph(descriptor, records)
    expect(projection.done).toEqual(['b1', 'b2', 'fan', 'join'])
    expect(projection.ready).toEqual([
      { node_id: 'term', attempt: 1, reason: 'initial' },
    ])
    expect(projection.cohorts[0].arrived_token_ids).toEqual([
      'fan-coh0-tok0',
      'fan-coh0-tok1',
    ])
    expect(projection.cohorts[0].consumed).toBe(true)
    // resolveJoin 恰好一次 ⇔ 纯函数投影幂等：同输入重放逐位相等
    expect(projectGraph(descriptor, records)).toEqual(projection)
  })

  it('全图完成 → status completed（含 join 派生 done）', () => {
    const projection = projectGraph(descriptor, [
      runStarted(descriptor),
      scheduled(2, 'fan', 1),
      committed(3, 'fan', 1),
      scheduled(4, 'b1', 1),
      committed(5, 'b1', 1),
      scheduled(6, 'b2', 1),
      committed(7, 'b2', 1),
      scheduled(8, 'term', 1),
      committed(9, 'term', 1),
    ])
    expect(projection.done).toEqual(['b1', 'b2', 'fan', 'join', 'term'])
    expect(projection.status).toBe('completed')
  })

  it('分支崩溃恢复：b1 scheduled-uncommitted 重跑，join 不误消解', () => {
    const projection = projectGraph(descriptor, [
      runStarted(descriptor),
      scheduled(2, 'fan', 1),
      committed(3, 'fan', 1),
      scheduled(4, 'b1', 1), // 崩溃悬挂
      scheduled(5, 'b2', 1),
      committed(6, 'b2', 1),
    ])
    expect(projection.ready).toEqual([
      { node_id: 'b1', attempt: 2, reason: 'rerun' },
    ])
    expect(projection.blocked).toEqual(['join', 'term'])
    expect(projection.cohorts[0].arrived_token_ids).toEqual(['fan-coh0-tok1'])
    expect(projection.cohorts[0].consumed).toBe(false)
  })
})

describe('gate 与 agent_pending', () => {
  const gateDescriptor = sealed(
    parseGraphDescriptor({
      descriptor_version: 1,
      run_id: 'run-sched-gate',
      revision_id: 'rev-sched-gate',
      goal: 'gate projection',
      nodes: [
        {
          id: 'build',
          kind: 'command',
          title: 'Build',
          timeout_ms: 1000,
          max_attempts: 2,
          effect_policy: { policy: 'side_effect_free' },
          command: 'echo build',
        },
        { id: 'gate', kind: 'human-approval', title: 'Gate', prompt: 'Proceed?' },
        {
          id: 'term',
          kind: 'command',
          title: 'Term',
          timeout_ms: 1000,
          max_attempts: 1,
          effect_policy: { policy: 'side_effect_free' },
          command: 'echo term',
        },
      ],
      edges: [
        { id: 'e-build-gate', kind: 'fixed', from: 'build', to: 'gate' },
        { id: 'e-gate-term', kind: 'fixed', from: 'gate', to: 'term' },
      ],
      entry_node_ids: ['build'],
      concurrency_limit: 1,
      terminal_verification_node_id: 'term',
    }),
  )

  it('gate：ready → gate_waiting waiting → approved done 放行 / denied failed', () => {
    const waitingProjection = projectGraph(gateDescriptor, [
      runStarted(gateDescriptor),
      scheduled(2, 'build', 1),
      committed(3, 'build', 1),
      rec(4, 'gate_waiting', { node_id: 'gate', prompt: 'Proceed?' }),
    ])
    expect(waitingProjection.waiting).toEqual([
      { node_id: 'gate', kind: 'gate_waiting' },
    ])
    expect(waitingProjection.ready).toEqual([])
    expect(waitingProjection.blocked).toEqual(['term'])

    const approved = projectGraph(gateDescriptor, [
      runStarted(gateDescriptor),
      scheduled(2, 'build', 1),
      committed(3, 'build', 1),
      rec(4, 'gate_waiting', { node_id: 'gate', prompt: 'Proceed?' }),
      rec(5, 'gate_resolved', { node_id: 'gate', decision: 'approved' }),
    ])
    expect(approved.done).toEqual(['build', 'gate'])
    expect(approved.ready).toEqual([
      { node_id: 'term', attempt: 1, reason: 'initial' },
    ])

    const denied = projectGraph(gateDescriptor, [
      runStarted(gateDescriptor),
      scheduled(2, 'build', 1),
      committed(3, 'build', 1),
      rec(4, 'gate_waiting', { node_id: 'gate', prompt: 'Proceed?' }),
      rec(5, 'gate_resolved', { node_id: 'gate', decision: 'denied' }),
    ])
    expect(denied.failed).toEqual([{ node_id: 'gate', reason: 'gate_denied' }])
    expect(denied.status).toBe('failed')
  })

  it('gate 恢复：gate_waiting 无裁决 → 仍 waiting（恢复后续问由 runner 负责）', () => {
    const projection = projectGraph(gateDescriptor, [
      runStarted(gateDescriptor),
      scheduled(2, 'build', 1),
      committed(3, 'build', 1),
      rec(4, 'gate_waiting', { node_id: 'gate', prompt: 'Proceed?' }),
    ])
    expect(projection.waiting).toEqual([
      { node_id: 'gate', kind: 'gate_waiting' },
    ])
  })

  it('agent_pending → waiting（带 attempt）；node_committed → done', () => {
    const descriptor = sealed(loadFixture('graph-fanout-join.json'))
    const waiting = projectGraph(descriptor, [
      runStarted(descriptor),
      scheduled(2, 'fan', 1),
      rec(3, 'agent_pending', { node_id: 'fan', attempt: 1 }),
    ])
    expect(waiting.waiting).toEqual([
      { node_id: 'fan', kind: 'agent_pending', attempt: 1 },
    ])
    expect(waiting.ready).toEqual([])

    const doneProjection = projectGraph(descriptor, [
      runStarted(descriptor),
      scheduled(2, 'fan', 1),
      rec(3, 'agent_pending', { node_id: 'fan', attempt: 1 }),
      committed(4, 'fan', 1),
    ])
    expect(doneProjection.done).toEqual(['fan'])
    expect(doneProjection.waiting).toEqual([])
    expect(doneProjection.ready.map((r) => r.node_id)).toEqual(['b1', 'b2'])
  })
})

describe('UNSUPPORTED_EDGE 入口拒绝（exit 1 显式文案）', () => {
  const base = {
    descriptor_version: 1,
    run_id: 'run-sched-unsupported',
    revision_id: 'rev-sched-unsupported',
    goal: 'unsupported edges',
    nodes: [
      {
        id: 'a',
        kind: 'command',
        title: 'A',
        timeout_ms: 1000,
        max_attempts: 1,
        effect_policy: { policy: 'side_effect_free' },
        command: 'echo a',
      },
      {
        id: 'b',
        kind: 'command',
        title: 'B',
        timeout_ms: 1000,
        max_attempts: 1,
        effect_policy: { policy: 'side_effect_free' },
        command: 'echo b',
      },
      {
        id: 'term',
        kind: 'command',
        title: 'Term',
        timeout_ms: 1000,
        max_attempts: 1,
        effect_policy: { policy: 'side_effect_free' },
        command: 'echo term',
      },
    ],
    entry_node_ids: ['a'],
    concurrency_limit: 1,
    terminal_verification_node_id: 'term',
  }

  const conditionalDescriptor = sealGraphDescriptor(
    parseGraphDescriptor({
      ...base,
      edges: [
        { id: 'e-ab', kind: 'conditional', from: 'a', to: 'b', route: 'yes' },
        { id: 'e-b-term', kind: 'fixed', from: 'b', to: 'term' },
      ],
    }),
  )

  const backEdgeDescriptor = sealGraphDescriptor(
    parseGraphDescriptor({
      ...base,
      edges: [
        { id: 'e-ab', kind: 'fixed', from: 'a', to: 'b' },
        {
          id: 'e-ba',
          kind: 'back_edge',
          from: 'b',
          to: 'a',
          route: 'retry',
          max_traversals: 2,
        },
        { id: 'e-b-term', kind: 'conditional', from: 'b', to: 'term', route: 'done' },
      ],
    }),
  )

  it('conditional 边：assertSupportedEdges 抛 UnsupportedEdgeError（code/exitCode/文案）', () => {
    let caught
    try {
      assertSupportedEdges(conditionalDescriptor)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(UnsupportedEdgeError)
    expect(caught).toBeInstanceOf(GraphSchedulerError)
    expect(caught.code).toBe('UNSUPPORTED_EDGE')
    expect(caught.exitCode).toBe(1)
    expect(caught.message).toContain('UNSUPPORTED_EDGE')
    expect(caught.message).toContain('e-ab')
    expect(caught.message).toContain('conditional')
    expect(caught.edges).toEqual([
      { id: 'e-ab', kind: 'conditional', from: 'a', to: 'b' },
    ])
  })

  it('conditional 边：projectGraph 同样入口拒绝', () => {
    expect(() =>
      projectGraph(conditionalDescriptor, [runStarted(conditionalDescriptor)]),
    ).toThrowError(UnsupportedEdgeError)
  })

  it('back_edge 边：拒绝且文案列出全部不支持边', () => {
    let caught
    try {
      projectGraph(backEdgeDescriptor, [runStarted(backEdgeDescriptor)])
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(UnsupportedEdgeError)
    expect(caught.exitCode).toBe(1)
    expect(caught.message).toContain('e-ba')
    expect(caught.message).toContain('back_edge')
    expect(caught.edges.map((e) => e.id)).toEqual(['e-ba', 'e-b-term'])
  })

  it('supported descriptor 不抛', () => {
    expect(() =>
      assertSupportedEdges(sealed(loadFixture('graph-simple-linear.json'))),
    ).not.toThrow()
  })
})

describe('记录流完整性闸（fail-closed）', () => {
  const descriptor = sealed(loadFixture('graph-simple-linear.json'))

  it('seq 乱序 → GraphSchedulerError exitCode 20', () => {
    let caught
    try {
      projectGraph(descriptor, [
        runStarted(descriptor, 1),
        scheduled(3, 'n1', 1),
        committed(2, 'n1', 1),
      ])
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(GraphSchedulerError)
    expect(caught.code).toBe('JOURNAL_CORRUPT')
    expect(caught.exitCode).toBe(20)
  })

  it('未知 type → 20', () => {
    expect(() =>
      projectGraph(descriptor, [
        runStarted(descriptor),
        rec(2, 'node_teleported', { node_id: 'n1' }),
      ]),
    ).toThrowError(/not in the frozen vocabulary/)
  })

  it('run_started.run_id 不匹配 → RUN_MISMATCH exitCode 1', () => {
    let caught
    try {
      projectGraph(descriptor, [
        rec(1, 'run_started', {
          run_id: 'some-other-run',
          descriptor_hash: descriptor.descriptor_hash,
        }),
      ])
    } catch (error) {
      caught = error
    }
    expect(caught.code).toBe('RUN_MISMATCH')
    expect(caught.exitCode).toBe(1)
  })

  it('run_started.descriptor_hash 漂移 → DESCRIPTOR_DRIFT exitCode 21', () => {
    let caught
    try {
      projectGraph(descriptor, [
        rec(1, 'run_started', {
          run_id: descriptor.run_id,
          descriptor_hash: '0'.repeat(64),
        }),
      ])
    } catch (error) {
      caught = error
    }
    expect(caught.code).toBe('DESCRIPTOR_DRIFT')
    expect(caught.exitCode).toBe(21)
  })

  it('记录引用未知节点 → UNKNOWN_NODE', () => {
    let caught
    try {
      projectGraph(descriptor, [
        runStarted(descriptor),
        scheduled(2, 'ghost', 1),
      ])
    } catch (error) {
      caught = error
    }
    expect(caught.code).toBe('UNKNOWN_NODE')
    expect(caught.exitCode).toBe(1)
  })

  it('fence_acquired 行不进节点投影（审计行忽略）', () => {
    const projection = projectGraph(descriptor, [
      runStarted(descriptor),
      rec(2, 'fence_acquired', { epoch: 2, owner_pid: 1234 }),
    ])
    expect(projection.ready).toEqual([
      { node_id: 'n1', attempt: 1, reason: 'initial' },
    ])
    expect(projection.max_seq).toBe(2)
  })
})
