// tests/lib/graph-schema.test.js
// U4 S1 — lib/graph/schema.js + lib/graph/descriptor.js unit 测试。
// 主体 = 上游 reference/oh-my-claudecode v5.7.0 src/graph/__tests__/descriptor.test.ts
// D1-D25 测试向量逐条移植（去 TS 类型标注；zod ^3.23.8→^4.6.5 漂移对照），
// 另加 M1 段：4 类节点 × 4 类边的 schema 层畸形拒绝矩阵（schema 层认识
// conditional/back_edge 但不拒——UNSUPPORTED_EDGE 拒绝在 validate/run 入口，S3/S5 范围）。

import { describe, expect, it } from 'vitest'
import {
  GraphDescriptorValidationError,
  canonicalJson,
  computeDescriptorHash,
  isGraphDescriptor,
  parseGraphDescriptor,
  parseSealedGraphDescriptor,
  sealGraphDescriptor,
  verifyDescriptorHash,
} from '../../lib/graph/descriptor.js'
import {
  graphApprovalDecisionSchema,
  graphBackEdgeSchema,
  graphConditionalEdgeSchema,
  graphEdgeSchema,
  graphEvidenceReferenceSchema,
  graphFanOutEdgeSchema,
  graphFixedEdgeSchema,
  graphNodeResultSchema,
  graphNodeSchema,
} from '../../lib/graph/schema.js'
import { AGENT_GUARDRAIL_PREFIX, applyAgentGuardrails } from '../../lib/graph/guardrails.js'

// ---------- fixtures（移植自上游 __tests__/fixtures.ts） ----------

/** Minimal valid executable (agent/command) node. */
function executableNode(id, kind) {
  const title = `Node ${id}`
  if (kind === 'agent') {
    return {
      id,
      kind,
      title,
      timeout_ms: 60_000,
      max_attempts: 3,
      effect_policy: { policy: 'side_effect_free' },
      instructions: `Instructions for ${id}`,
    }
  }
  return {
    id,
    kind,
    title,
    timeout_ms: 60_000,
    max_attempts: 3,
    effect_policy: { policy: 'side_effect_free' },
    command: `echo ${id}`,
  }
}

/** Fan-out → two branches → join → terminal verification. */
function forkJoinDescriptor() {
  return {
    descriptor_version: 1,
    run_id: 'run-fork-join',
    revision_id: 'rev-fork-join',
    goal: 'Verify fork/join orchestration',
    nodes: [
      { ...executableNode('fan', 'agent'), title: 'Fan out' },
      { ...executableNode('b1', 'agent'), title: 'Branch one' },
      { ...executableNode('b2', 'command'), title: 'Branch two' },
      {
        id: 'join',
        kind: 'join',
        title: 'Join',
        fan_out_node_id: 'fan',
        input_branch_ids: ['br1', 'br2'],
      },
      { ...executableNode('term', 'command'), title: 'Terminal' },
    ],
    edges: [
      { id: 'e-fan-b1', kind: 'fan_out', from: 'fan', to: 'b1', branch_id: 'br1', owner_join_id: 'join' },
      { id: 'e-fan-b2', kind: 'fan_out', from: 'fan', to: 'b2', branch_id: 'br2', owner_join_id: 'join' },
      { id: 'e-b1-join', kind: 'fixed', from: 'b1', to: 'join' },
      { id: 'e-b2-join', kind: 'fixed', from: 'b2', to: 'join' },
      { id: 'e-join-term', kind: 'fixed', from: 'join', to: 'term' },
    ],
    entry_node_ids: ['fan'],
    concurrency_limit: 2,
    terminal_verification_node_id: 'term',
  }
}

/**
 * Bounded retry loop: `work` retries itself via a back edge while a forward
 * `give-up` exit keeps the loop node from being back-edge-only.
 */
function loopDescriptor() {
  return {
    descriptor_version: 1,
    run_id: 'run-loop',
    revision_id: 'rev-loop',
    goal: 'Verify bounded retry loop',
    nodes: [
      { ...executableNode('start', 'agent'), title: 'Start' },
      { ...executableNode('work', 'command'), title: 'Work' },
      { ...executableNode('give_up', 'command'), title: 'Give up' },
      { ...executableNode('term', 'command'), title: 'Terminal' },
    ],
    edges: [
      { id: 'e-start-work', kind: 'fixed', from: 'start', to: 'work' },
      { id: 'e-work-retry', kind: 'back_edge', from: 'work', to: 'work', route: 'retry', max_traversals: 3 },
      { id: 'e-work-give-up', kind: 'conditional', from: 'work', to: 'give_up', route: 'give-up' },
      { id: 'e-work-term', kind: 'conditional', from: 'work', to: 'term', route: 'success' },
      { id: 'e-give-up-term', kind: 'fixed', from: 'give_up', to: 'term' },
    ],
    entry_node_ids: ['start'],
    concurrency_limit: 1,
    terminal_verification_node_id: 'term',
  }
}

/** Entry → human-approval → single fixed edge → terminal verification. */
function approvalDescriptor() {
  return {
    descriptor_version: 1,
    run_id: 'run-approval',
    revision_id: 'rev-approval',
    goal: 'Verify human approval gate',
    nodes: [
      { ...executableNode('entry', 'agent'), title: 'Entry' },
      { id: 'approval', kind: 'human-approval', title: 'Approve release', prompt: 'Approve the release?' },
      { ...executableNode('term', 'command'), title: 'Terminal' },
    ],
    edges: [
      { id: 'e-entry-approval', kind: 'fixed', from: 'entry', to: 'approval' },
      { id: 'e-approval-term', kind: 'fixed', from: 'approval', to: 'term' },
    ],
    entry_node_ids: ['entry'],
    concurrency_limit: 1,
    terminal_verification_node_id: 'term',
  }
}

/** Minimal linear descriptor: start --fixed--> terminal. */
function chainDescriptor(startId, edgeId, terminalId) {
  return {
    descriptor_version: 1,
    run_id: 'run-chain',
    revision_id: 'rev-chain',
    goal: 'chain',
    nodes: [executableNode(startId, 'command'), executableNode(terminalId, 'command')],
    edges: [{ id: edgeId, kind: 'fixed', from: startId, to: terminalId }],
    entry_node_ids: [startId],
    concurrency_limit: 1,
    terminal_verification_node_id: terminalId,
  }
}

/** Replace the single join node of a descriptor (assumes exactly one join). */
function replaceJoin(descriptor, mutate) {
  return {
    ...descriptor,
    nodes: descriptor.nodes.map((node) => (node.kind === 'join' ? mutate(node) : node)),
  }
}

// ---------- 上游 D1-D25 向量对照（zod v3→v4 漂移防护） ----------

describe('D1 - unknown fields at any depth rejected (.strict())', () => {
  it('rejects an unknown top-level descriptor field', () => {
    expect(() =>
      parseGraphDescriptor({ ...forkJoinDescriptor(), extra: true }),
    ).toThrow(/Unrecognized key/)
  })
  it('rejects an unknown node field', () => {
    expect(() =>
      parseGraphDescriptor({
        ...forkJoinDescriptor(),
        nodes: [{ ...forkJoinDescriptor().nodes[0], extra: true }],
      }),
    ).toThrow(/Unrecognized key/)
  })
  it('rejects an unknown edge field', () => {
    expect(() =>
      parseGraphDescriptor({
        ...forkJoinDescriptor(),
        edges: [{ ...forkJoinDescriptor().edges[0], extra: true }],
      }),
    ).toThrow(/Unrecognized key/)
  })
  it('rejects an unknown node-result field', () => {
    expect(() =>
      graphNodeResultSchema.parse({
        outcome: 'succeeded',
        attempt_id: 'a1',
        evidence_refs: [],
        extra: true,
      }),
    ).toThrow(/Unrecognized key/)
  })
  it('rejects an unknown approval-decision field', () => {
    expect(() =>
      graphApprovalDecisionSchema.parse({
        decision: 'approved',
        evidence_refs: [],
        extra: true,
      }),
    ).toThrow(/Unrecognized key/)
  })
  it('rejects an unknown evidence-reference field', () => {
    expect(() =>
      graphEvidenceReferenceSchema.parse({
        kind: 'file',
        ref: 'r1',
        extra: true,
      }),
    ).toThrow(/Unrecognized key/)
  })
})

describe('D2 - invalid stable IDs rejected; valid charset accepted', () => {
  it.each([
    ['', 'empty id'],
    ['bad!', 'bang'],
    ['bad id', 'whitespace'],
    ['a'.repeat(129), '>128 chars'],
  ])('rejects %s (%s)', (badId) => {
    expect(() =>
      parseGraphDescriptor(chainDescriptor(badId, 'e1', 'b')),
    ).toThrow()
  })
  it('accepts ids using the full stable charset', () => {
    expect(() =>
      parseGraphDescriptor(chainDescriptor('a.b_c:d-1', 'e.2', 'z9')),
    ).not.toThrow()
  })
})

describe('D3 - duplicate node IDs rejected', () => {
  it('rejects a repeated node id', () => {
    const input = {
      descriptor_version: 1,
      run_id: 'run-dup',
      revision_id: 'rev-dup',
      goal: 'dup',
      nodes: [
        executableNode('a', 'command'),
        executableNode('a', 'command'),
        executableNode('b', 'command'),
      ],
      edges: [{ id: 'e1', kind: 'fixed', from: 'a', to: 'b' }],
      entry_node_ids: ['a'],
      concurrency_limit: 1,
      terminal_verification_node_id: 'b',
    }
    expect(() => parseGraphDescriptor(input)).toThrow(
      /duplicate node ID\(s\): a/,
    )
  })
})

describe('D4 - duplicate edge IDs rejected', () => {
  it('rejects a repeated edge id', () => {
    const input = {
      descriptor_version: 1,
      run_id: 'run-dup-edge',
      revision_id: 'rev-dup-edge',
      goal: 'dup edge',
      nodes: [executableNode('a', 'command'), executableNode('b', 'command')],
      edges: [
        { id: 'e1', kind: 'fixed', from: 'a', to: 'b' },
        { id: 'e1', kind: 'fixed', from: 'a', to: 'b' },
      ],
      entry_node_ids: ['a'],
      concurrency_limit: 1,
      terminal_verification_node_id: 'b',
    }
    expect(() => parseGraphDescriptor(input)).toThrow(
      /duplicate edge ID\(s\): e1/,
    )
  })
})

describe('D5 - duplicate entry IDs rejected', () => {
  it('rejects a repeated entry node id', () => {
    expect(() =>
      parseGraphDescriptor({
        ...chainDescriptor('a', 'e1', 'b'),
        entry_node_ids: ['a', 'a'],
      }),
    ).toThrow(/duplicate entry node ID\(s\): a/)
  })
})

describe('D6 - dangling from/to references rejected', () => {
  it.each([
    ['missing source', 'missing', 'b', /references missing source node missing/],
    ['missing target', 'a', 'nope', /references missing target node nope/],
  ])('rejects an edge with a %s', (_name, from, to, pattern) => {
    expect(() =>
      parseGraphDescriptor({
        ...chainDescriptor('a', 'e1', 'b'),
        edges: [{ id: 'e1', kind: 'fixed', from, to }],
      }),
    ).toThrow(pattern)
  })
})

describe('D7 - terminal verification rules', () => {
  it('rejects a missing terminal verification node', () => {
    expect(() =>
      parseGraphDescriptor({
        ...forkJoinDescriptor(),
        terminal_verification_node_id: 'nope',
      }),
    ).toThrow(/terminal verification node nope does not exist/)
  })
  it('rejects a non-executable terminal kind (join)', () => {
    expect(() =>
      parseGraphDescriptor({
        ...forkJoinDescriptor(),
        terminal_verification_node_id: 'join',
      }),
    ).toThrow(
      /terminal verification must be an executable agent or command node/,
    )
  })
  it('rejects a terminal node with outgoing edges', () => {
    expect(() =>
      parseGraphDescriptor({
        ...forkJoinDescriptor(),
        terminal_verification_node_id: 'b1',
      }),
    ).toThrow(/terminal verification node b1 must not have outgoing edges/)
  })
})

describe('D8 - reachability: unreachable and terminal-unreachable nodes rejected', () => {
  it('rejects a node unreachable from any entry', () => {
    const d = forkJoinDescriptor()
    expect(() =>
      parseGraphDescriptor({
        ...d,
        nodes: [...d.nodes, executableNode('orphan', 'command')],
        edges: [
          ...d.edges,
          { id: 'e-orphan-term', kind: 'fixed', from: 'orphan', to: 'term' },
        ],
      }),
    ).toThrow(/unreachable node\(s\): orphan/)
  })
  it('rejects a reachable node that cannot reach terminal verification', () => {
    const d = loopDescriptor()
    expect(() =>
      parseGraphDescriptor({
        ...d,
        nodes: [...d.nodes, executableNode('sink', 'command')],
        edges: [
          ...d.edges,
          { id: 'e-work-sink', kind: 'conditional', from: 'work', to: 'sink', route: 'sink' },
        ],
      }),
    ).toThrow(/cannot reach terminal verification/)
  })
})

describe('D9 - cycles: non-back-edge forward cycle rejected; bounded back-edge return accepted', () => {
  it('rejects a forward cycle built from fixed edges', () => {
    const input = {
      descriptor_version: 1,
      run_id: 'run-cycle',
      revision_id: 'rev-cycle',
      goal: 'cycle',
      nodes: [
        executableNode('a', 'command'),
        executableNode('b', 'command'),
        executableNode('term', 'command'),
      ],
      edges: [
        { id: 'e-a-b', kind: 'fixed', from: 'a', to: 'b' },
        { id: 'e-b-a', kind: 'fixed', from: 'b', to: 'a' },
      ],
      entry_node_ids: ['a'],
      concurrency_limit: 1,
      terminal_verification_node_id: 'term',
    }
    expect(() => parseGraphDescriptor(input)).toThrow(
      /non-back-edge cycle detected/,
    )
  })
  it('accepts a bounded back-edge return (loop descriptor)', () => {
    expect(() => parseGraphDescriptor(loopDescriptor())).not.toThrow()
  })
})

describe('D10 - back-edge-only node rejected (wedging regression)', () => {
  it('rejects a node whose only outgoing edge is a back edge', () => {
    const input = {
      descriptor_version: 1,
      run_id: 'run-wedge',
      revision_id: 'rev-wedge',
      goal: 'wedge',
      nodes: [
        executableNode('start', 'command'),
        executableNode('work', 'command'),
        executableNode('term', 'command'),
      ],
      edges: [
        { id: 'e-start-work', kind: 'fixed', from: 'start', to: 'work' },
        { id: 'e-work-retry', kind: 'back_edge', from: 'work', to: 'work', route: 'retry', max_traversals: 3 },
      ],
      entry_node_ids: ['start'],
      concurrency_limit: 1,
      terminal_verification_node_id: 'term',
    }
    expect(() => parseGraphDescriptor(input)).toThrow(/no non-back-edge exit/)
  })
})

describe('D11 - fork/join region rules', () => {
  it('rejects a nested join inside a fork branch', () => {
    const input = {
      descriptor_version: 1,
      run_id: 'run-nested',
      revision_id: 'rev-nested',
      goal: 'nested join',
      nodes: [
        executableNode('fan', 'agent'),
        executableNode('b1', 'agent'),
        executableNode('b2', 'command'),
        { id: 'join', kind: 'join', title: 'Join', fan_out_node_id: 'fan', input_branch_ids: ['br1', 'br2'] },
        { id: 'nested', kind: 'join', title: 'Nested', fan_out_node_id: 'fan', input_branch_ids: ['br1', 'br2'] },
        executableNode('term', 'command'),
      ],
      edges: [
        { id: 'e-fan-b1', kind: 'fan_out', from: 'fan', to: 'b1', branch_id: 'br1', owner_join_id: 'join' },
        { id: 'e-fan-b2', kind: 'fan_out', from: 'fan', to: 'b2', branch_id: 'br2', owner_join_id: 'join' },
        { id: 'e-b1-nested', kind: 'fixed', from: 'b1', to: 'nested' },
        { id: 'e-nested-join', kind: 'fixed', from: 'nested', to: 'join' },
        { id: 'e-b2-join', kind: 'fixed', from: 'b2', to: 'join' },
        { id: 'e-join-term', kind: 'fixed', from: 'join', to: 'term' },
      ],
      entry_node_ids: ['fan'],
      concurrency_limit: 2,
      terminal_verification_node_id: 'term',
    }
    expect(() => parseGraphDescriptor(input)).toThrow(
      /nested join nested is not allowed inside fork region fan/,
    )
  })
  it('rejects overlapping branch regions', () => {
    const input = {
      descriptor_version: 1,
      run_id: 'run-overlap',
      revision_id: 'rev-overlap',
      goal: 'overlap',
      nodes: [
        executableNode('fan', 'agent'),
        executableNode('shared', 'command'),
        { id: 'join', kind: 'join', title: 'Join', fan_out_node_id: 'fan', input_branch_ids: ['br1', 'br2'] },
        executableNode('term', 'command'),
      ],
      edges: [
        { id: 'e-fan-shared-1', kind: 'fan_out', from: 'fan', to: 'shared', branch_id: 'br1', owner_join_id: 'join' },
        { id: 'e-fan-shared-2', kind: 'fan_out', from: 'fan', to: 'shared', branch_id: 'br2', owner_join_id: 'join' },
        { id: 'e-shared-join', kind: 'fixed', from: 'shared', to: 'join' },
        { id: 'e-join-term', kind: 'fixed', from: 'join', to: 'term' },
      ],
      entry_node_ids: ['fan'],
      concurrency_limit: 2,
      terminal_verification_node_id: 'term',
    }
    expect(() => parseGraphDescriptor(input)).toThrow(/overlap at shared/)
  })
  it('rejects region-crossing edges', () => {
    const d = forkJoinDescriptor()
    expect(() =>
      parseGraphDescriptor({
        ...d,
        edges: [
          ...d.edges,
          { id: 'e-fan-b1-extra', kind: 'fixed', from: 'fan', to: 'b1' },
        ],
      }),
    ).toThrow(/crosses into fork branch br1/)
  })
  it('rejects a branch that cannot reach its owning join', () => {
    const d = forkJoinDescriptor()
    expect(() =>
      parseGraphDescriptor({
        ...d,
        edges: d.edges.filter((edge) => edge.id !== 'e-b1-join'),
      }),
    ).toThrow(/fork branch br1 cannot reach owning join join/)
  })
  it('rejects a join without a matching fan-out node', () => {
    expect(() =>
      parseGraphDescriptor(
        replaceJoin(forkJoinDescriptor(), (join) => ({
          ...join,
          fan_out_node_id: 'nope',
        })),
      ),
    ).toThrow(/join join has no matching fan-out node nope/)
  })
  it('rejects mismatched input_branch_ids', () => {
    expect(() =>
      parseGraphDescriptor(
        replaceJoin(forkJoinDescriptor(), (join) => ({
          ...join,
          input_branch_ids: ['br1', 'brX'],
        })),
      ),
    ).toThrow(/join join input branches do not match fan-out fan/)
  })
  it('rejects duplicate branch IDs', () => {
    const d = forkJoinDescriptor()
    expect(() =>
      parseGraphDescriptor({
        ...d,
        edges: d.edges.map((edge) =>
          edge.kind === 'fan_out' ? { ...edge, branch_id: 'br1' } : edge,
        ),
      }),
    ).toThrow(/fan-out node fan repeats branch ID\(s\): br1/)
  })
})

describe('D12 - entry-node eligibility', () => {
  it('rejects a join node as an entry', () => {
    expect(() =>
      parseGraphDescriptor({
        ...forkJoinDescriptor(),
        entry_node_ids: ['join'],
      }),
    ).toThrow(/entry node join must not be a join node/)
  })
  it('rejects an interior fork-branch node as an entry', () => {
    expect(() =>
      parseGraphDescriptor({ ...forkJoinDescriptor(), entry_node_ids: ['b1'] }),
    ).toThrow(/entry node b1 must not be inside a fork branch region/)
  })
})

describe('D13 - seal round-trip', () => {
  it('produces a 64-hex hash, verifies, and round-trips through parseSealedGraphDescriptor', () => {
    const input = forkJoinDescriptor()
    const sealed = sealGraphDescriptor(input)
    expect(sealed.descriptor_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(verifyDescriptorHash(sealed)).toBe(true)
    expect(computeDescriptorHash(sealed)).toBe(sealed.descriptor_hash)
    expect(sealGraphDescriptor(input).descriptor_hash).toBe(
      sealed.descriptor_hash,
    )
    expect(parseGraphDescriptor(input)).toEqual(input)
    expect(
      parseSealedGraphDescriptor(JSON.parse(JSON.stringify(sealed))),
    ).toEqual(sealed)
  })
})

describe('D14 - canonicalJson', () => {
  it('produces compact, recursively key-sorted output with arrays in order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(canonicalJson({ a: [1, 2] })).toBe('{"a":[1,2]}')
    expect(canonicalJson([2, 1])).toBe('[2,1]')
    expect(canonicalJson({ outer: { z: [1], a: 'x' } })).toBe(
      '{"outer":{"a":"x","z":[1]}}',
    )
    expect(
      canonicalJson(Object.assign(Object.create(null), { b: 1, a: 2 })),
    ).toBe('{"a":2,"b":1}')
  })
  it('throws on undefined values and non-finite numbers', () => {
    expect(() => canonicalJson({ a: undefined })).toThrow(TypeError)
    expect(() => canonicalJson({ a: NaN })).toThrow(TypeError)
    expect(() => canonicalJson({ a: Infinity })).toThrow(TypeError)
  })
  it('rejects non-plain objects, unsupported primitives, and cycles', () => {
    class Custom {}
    const cyclicObj = {}
    cyclicObj.self = cyclicObj
    const cyclicArr = []
    cyclicArr.push(cyclicArr)
    const bad = [
      new Date(),
      new Map(),
      new Set(),
      /re/,
      new Custom(),
      Symbol('s'),
      () => {},
      1n,
      undefined,
      NaN,
      Infinity,
      cyclicObj,
      cyclicArr,
    ]
    for (const value of bad)
      expect(() => canonicalJson(value)).toThrow(TypeError)
    expect(() => canonicalJson({ nested: { deep: [cyclicObj] } })).toThrow(
      TypeError,
    )
  })
})

describe('D15 - hash payload excludes descriptor_hash and runtime fields; tracks content', () => {
  it('ignores descriptor_hash and decorated runtime fields', () => {
    const base = forkJoinDescriptor()
    const hash = computeDescriptorHash(base)
    const decorated = {
      ...base,
      descriptor_hash: 'a'.repeat(64),
      activations: {},
      committed_transitions: {},
    }
    expect(computeDescriptorHash(decorated)).toBe(hash)
  })
  it('changes when goal, nodes, or edges change', () => {
    const base = forkJoinDescriptor()
    const hash = computeDescriptorHash(base)
    expect(computeDescriptorHash({ ...base, goal: 'different goal' })).not.toBe(
      hash,
    )
    const changedNodes = {
      ...base,
      nodes: base.nodes.map((node, index) =>
        index === 0 ? { ...node, title: `Renamed ${node.id}` } : node,
      ),
    }
    expect(computeDescriptorHash(changedNodes)).not.toBe(hash)
    const changedEdges = {
      ...base,
      edges: base.edges.map((edge, index) =>
        index === 0 ? { ...edge, id: `${edge.id}-renamed` } : edge,
      ),
    }
    expect(computeDescriptorHash(changedEdges)).not.toBe(hash)
  })
  it('is key-order independent (canonicalJson sorts keys recursively)', () => {
    const a = forkJoinDescriptor()
    // 显式乱序重建：同一语义内容、不同键序 → 同 hash（键序无关确定性）
    const shuffled = {
      terminal_verification_node_id: a.terminal_verification_node_id,
      edges: a.edges,
      entry_node_ids: a.entry_node_ids,
      goal: a.goal,
      concurrency_limit: a.concurrency_limit,
      revision_id: a.revision_id,
      descriptor_version: a.descriptor_version,
      nodes: a.nodes,
      run_id: a.run_id,
    }
    expect(computeDescriptorHash(shuffled)).toBe(computeDescriptorHash(a))
    expect(canonicalJson(shuffled)).toBe(canonicalJson(a))
  })
})

describe('D16 - structure-before-hash and deep ownership', () => {
  it('returns false for structurally invalid but hash-matching input', () => {
    const valid = forkJoinDescriptor()
    const duplicated = { ...valid, nodes: [valid.nodes[0], valid.nodes[0]] }
    expect(
      verifyDescriptorHash({
        ...duplicated,
        descriptor_hash: computeDescriptorHash(duplicated),
      }),
    ).toBe(false)
  })
  it('returns false for valid structure with a wrong hash', () => {
    const sealed = sealGraphDescriptor(forkJoinDescriptor())
    expect(
      verifyDescriptorHash({ ...sealed, descriptor_hash: 'f'.repeat(64) }),
    ).toBe(false)
  })
  it('returns false for non-objects and never throws', () => {
    expect(verifyDescriptorHash(null)).toBe(false)
    expect(verifyDescriptorHash(42)).toBe(false)
    expect(verifyDescriptorHash('text')).toBe(false)
    expect(() => verifyDescriptorHash({ descriptor_hash: 'x' })).not.toThrow()
    expect(() => verifyDescriptorHash(Symbol('s'))).not.toThrow()
  })
  it('deep-freezes parse/seal outputs; writes to frozen nodes throw', () => {
    const sealed = sealGraphDescriptor(forkJoinDescriptor())
    expect(Object.isFrozen(sealed)).toBe(true)
    expect(Object.isFrozen(sealed.nodes)).toBe(true)
    expect(Object.isFrozen(sealed.nodes[0])).toBe(true)
    expect(Object.isFrozen(sealed.edges)).toBe(true)
    expect(Object.isFrozen(sealed.edges[0])).toBe(true)
    expect(Object.isFrozen(sealed.entry_node_ids)).toBe(true)
    expect(() => {
      sealed.nodes[0].title = 'mutated'
    }).toThrow(TypeError)
  })
})

describe('D17 - fixed-edge exclusivity', () => {
  it('rejects a node mixing a fixed edge with a conditional edge', () => {
    const input = {
      descriptor_version: 1,
      run_id: 'run-fixed-excl',
      revision_id: 'rev-fixed-excl',
      goal: 'fixed exclusivity',
      nodes: [
        executableNode('a', 'command'),
        executableNode('mid', 'command'),
        executableNode('t1', 'command'),
        executableNode('t2', 'command'),
      ],
      edges: [
        { id: 'e-a-mid', kind: 'fixed', from: 'a', to: 'mid' },
        { id: 'e-mid-t1', kind: 'fixed', from: 'mid', to: 't1' },
        { id: 'e-mid-t2', kind: 'conditional', from: 'mid', to: 't2', route: 'x' },
      ],
      entry_node_ids: ['a'],
      concurrency_limit: 1,
      terminal_verification_node_id: 't1',
    }
    expect(() => parseGraphDescriptor(input)).toThrow(
      /node mid must use one fixed edge or an explicit route\/fan-out set/,
    )
  })
})

describe('D18 - fan-out cardinality', () => {
  it('rejects a single fan_out edge', () => {
    const input = {
      descriptor_version: 1,
      run_id: 'run-fan1',
      revision_id: 'rev-fan1',
      goal: 'single fan-out',
      nodes: [
        executableNode('fan', 'agent'),
        executableNode('b1', 'command'),
        { id: 'join', kind: 'join', title: 'Join', fan_out_node_id: 'fan', input_branch_ids: ['br1', 'br2'] },
        executableNode('term', 'command'),
      ],
      edges: [
        { id: 'e-fan-b1', kind: 'fan_out', from: 'fan', to: 'b1', branch_id: 'br1', owner_join_id: 'join' },
        { id: 'e-b1-join', kind: 'fixed', from: 'b1', to: 'join' },
        { id: 'e-join-term', kind: 'fixed', from: 'join', to: 'term' },
      ],
      entry_node_ids: ['fan'],
      concurrency_limit: 1,
      terminal_verification_node_id: 'term',
    }
    expect(() => parseGraphDescriptor(input)).toThrow(
      /fan-out node fan must declare at least two fan_out edges and no other edge kind/,
    )
  })
  it('rejects fan_out edges mixed with other edge kinds', () => {
    const d = forkJoinDescriptor()
    expect(() =>
      parseGraphDescriptor({
        ...d,
        edges: [
          ...d.edges,
          { id: 'e-fan-term', kind: 'fixed', from: 'fan', to: 'term' },
        ],
      }),
    ).toThrow(
      /fan-out node fan must declare at least two fan_out edges and no other edge kind/,
    )
  })
})

describe('D19 - join outgoing shape', () => {
  it('rejects a join with no outgoing edges', () => {
    const d = forkJoinDescriptor()
    expect(() =>
      parseGraphDescriptor({
        ...d,
        edges: d.edges.filter((edge) => edge.id !== 'e-join-term'),
      }),
    ).toThrow(/join node join must have exactly one fixed outgoing edge/)
  })
  it('rejects a join with a non-fixed outgoing edge', () => {
    const d = forkJoinDescriptor()
    expect(() =>
      parseGraphDescriptor({
        ...d,
        edges: d.edges.map((edge) =>
          edge.id === 'e-join-term'
            ? { id: 'e-join-term', kind: 'conditional', from: 'join', to: 'term', route: 'x' }
            : edge,
        ),
      }),
    ).toThrow(/join node join must have exactly one fixed outgoing edge/)
  })
})

describe('D20 - duplicate conditional routes', () => {
  it('rejects duplicate routes on a node', () => {
    const input = {
      descriptor_version: 1,
      run_id: 'run-routes',
      revision_id: 'rev-routes',
      goal: 'routes',
      nodes: [
        executableNode('s', 'command'),
        executableNode('w', 'command'),
        executableNode('t1', 'command'),
        executableNode('t2', 'command'),
      ],
      edges: [
        { id: 'e-s-w', kind: 'fixed', from: 's', to: 'w' },
        { id: 'e-w-t1', kind: 'conditional', from: 'w', to: 't1', route: 'dup' },
        { id: 'e-w-t2', kind: 'conditional', from: 'w', to: 't2', route: 'dup' },
      ],
      entry_node_ids: ['s'],
      concurrency_limit: 1,
      terminal_verification_node_id: 't1',
    }
    expect(() => parseGraphDescriptor(input)).toThrow(
      /declares duplicate route\(s\): dup/,
    )
  })
})

describe('D21 - back edges must be structural returns', () => {
  it('rejects a back edge that is not a structural return to an earlier node', () => {
    const d = loopDescriptor()
    expect(() =>
      parseGraphDescriptor({
        ...d,
        edges: d.edges.map((edge) =>
          edge.kind === 'back_edge' && edge.id === 'e-work-retry'
            ? { ...edge, to: 'term' }
            : edge,
        ),
      }),
    ).toThrow(
      /back-edge e-work-retry is not a structural return to an earlier node/,
    )
  })
})

describe('D22 - human-approval single-fixed-edge rule', () => {
  const badEdges = [
    {
      name: 'conditional',
      edge: { id: 'e-approval-term', kind: 'conditional', from: 'approval', to: 'term', route: 'approve' },
    },
    {
      name: 'fan_out',
      edge: { id: 'e-approval-term', kind: 'fan_out', from: 'approval', to: 'term', branch_id: 'br1', owner_join_id: 'join' },
    },
    {
      name: 'back_edge',
      edge: { id: 'e-approval-term', kind: 'back_edge', from: 'approval', to: 'term', route: 'retry', max_traversals: 3 },
    },
  ]
  it.each(badEdges)(
    'rejects a human-approval node with a $name outgoing edge',
    ({ edge }) => {
      const d = approvalDescriptor()
      expect(() =>
        parseGraphDescriptor({
          ...d,
          edges: d.edges.map((e) => (e.id === 'e-approval-term' ? edge : e)),
        }),
      ).toThrow(
        /human-approval node approval must have exactly one fixed outgoing edge/,
      )
    },
  )
  it('rejects a human-approval node with zero outgoing edges', () => {
    const d = approvalDescriptor()
    expect(() =>
      parseGraphDescriptor({
        ...d,
        edges: d.edges.filter((edge) => edge.id !== 'e-approval-term'),
      }),
    ).toThrow(
      /human-approval node approval must have exactly one fixed outgoing edge/,
    )
  })
  it('rejects a human-approval node with two fixed outgoing edges', () => {
    const d = approvalDescriptor()
    expect(() =>
      parseGraphDescriptor({
        ...d,
        edges: [
          ...d.edges,
          { id: 'e-approval-entry', kind: 'fixed', from: 'approval', to: 'entry' },
        ],
      }),
    ).toThrow(
      /human-approval node approval must have exactly one fixed outgoing edge/,
    )
  })
  it('accepts a human-approval node with exactly one fixed outgoing edge', () => {
    expect(() => parseGraphDescriptor(approvalDescriptor())).not.toThrow()
  })
})

describe('D23 - verifyDescriptorHash non-branding predicate and ownership producers', () => {
  it('returns true only for structure-valid, hash-matching input', () => {
    const sealed = sealGraphDescriptor(forkJoinDescriptor())
    expect(verifyDescriptorHash(sealed)).toBe(true)
    expect(
      verifyDescriptorHash({ ...sealed, descriptor_hash: 'f'.repeat(64) }),
    ).toBe(false)
    const valid = forkJoinDescriptor()
    const duplicated = { ...valid, nodes: [valid.nodes[0], valid.nodes[0]] }
    expect(
      verifyDescriptorHash({
        ...duplicated,
        descriptor_hash: computeDescriptorHash(duplicated),
      }),
    ).toBe(false)
    expect(verifyDescriptorHash(null)).toBe(false)
    expect(verifyDescriptorHash({})).toBe(false)
  })
  it('never throws', () => {
    expect(() => verifyDescriptorHash({ descriptor_hash: 42 })).not.toThrow()
    expect(() => verifyDescriptorHash({ descriptor_hash: 'x' })).not.toThrow()
    expect(() => verifyDescriptorHash(Symbol('s'))).not.toThrow()
  })
  it('never freezes or mutates the caller input', () => {
    const caller = { ...sealGraphDescriptor(forkJoinDescriptor()) }
    expect(Object.isFrozen(caller)).toBe(false)
    const snapshot = JSON.stringify(caller)
    expect(verifyDescriptorHash(caller)).toBe(true)
    expect(Object.isFrozen(caller)).toBe(false)
    expect(JSON.stringify(caller)).toBe(snapshot)
  })
  it('isGraphDescriptor is a non-throwing structural check', () => {
    expect(isGraphDescriptor(forkJoinDescriptor())).toBe(true)
    expect(isGraphDescriptor({ ...forkJoinDescriptor(), extra: true })).toBe(
      false,
    )
    expect(isGraphDescriptor(null)).toBe(false)
  })
  it('parseGraphDescriptor and sealGraphDescriptor outputs are frozen at every level', () => {
    for (const descriptor of [
      parseGraphDescriptor(forkJoinDescriptor()),
      sealGraphDescriptor(forkJoinDescriptor()),
    ]) {
      expect(Object.isFrozen(descriptor)).toBe(true)
      expect(Object.isFrozen(descriptor.nodes)).toBe(true)
      expect(Object.isFrozen(descriptor.nodes[0])).toBe(true)
      expect(Object.isFrozen(descriptor.edges)).toBe(true)
      expect(Object.isFrozen(descriptor.edges[0])).toBe(true)
      expect(Object.isFrozen(descriptor.entry_node_ids)).toBe(true)
    }
  })
})

describe('D24 - parseSealedGraphDescriptor persisted sealed input matrix', () => {
  const persisted = () =>
    JSON.parse(JSON.stringify(sealGraphDescriptor(forkJoinDescriptor())))
  it('(a) accepts a valid persisted sealed descriptor and deep-freezes it', () => {
    const input = persisted()
    const parsed = parseSealedGraphDescriptor(input)
    expect(parsed.descriptor_hash).toBe(input.descriptor_hash)
    expect(parsed).toEqual(input)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.nodes)).toBe(true)
    expect(Object.isFrozen(parsed.nodes[0])).toBe(true)
    expect(Object.isFrozen(parsed.edges)).toBe(true)
    expect(Object.isFrozen(parsed.edges[0])).toBe(true)
  })
  it('(b) rejects a supplied hash mismatch', () => {
    const input = persisted()
    expect(() =>
      parseSealedGraphDescriptor({ ...input, descriptor_hash: 'f'.repeat(64) }),
    ).toThrow(GraphDescriptorValidationError)
    expect(() =>
      parseSealedGraphDescriptor({ ...input, descriptor_hash: 'f'.repeat(64) }),
    ).toThrow(/does not match the exact revision/)
  })
  it('(c) rejects a missing descriptor_hash', () => {
    const input = persisted()
    const { descriptor_hash: _omitted, ...rest } = input
    expect(() => parseSealedGraphDescriptor(rest)).toThrow(
      GraphDescriptorValidationError,
    )
    expect(() => parseSealedGraphDescriptor(rest)).toThrow(
      /must carry a `descriptor_hash`/,
    )
  })
  it('(d) rejects a malformed descriptor_hash format', () => {
    const input = persisted()
    expect(() =>
      parseSealedGraphDescriptor({ ...input, descriptor_hash: 'not-a-hash' }),
    ).toThrow(GraphDescriptorValidationError)
    expect(() =>
      parseSealedGraphDescriptor({ ...input, descriptor_hash: 'A'.repeat(64) }),
    ).toThrow(/64 lowercase hexadecimal characters/)
  })
  it('(e) rejects structurally invalid but hash-matching input (structure-before-hash)', () => {
    const input = persisted()
    const duplicated = { ...input, nodes: [input.nodes[0], input.nodes[0]] }
    expect(() =>
      parseSealedGraphDescriptor({
        ...duplicated,
        descriptor_hash: computeDescriptorHash(duplicated),
      }),
    ).toThrow()
  })
  it('(f) draft producers reject input carrying a descriptor_hash with a directed error', () => {
    const input = persisted()
    expect(() => parseGraphDescriptor(input)).toThrow(
      GraphDescriptorValidationError,
    )
    expect(() => parseGraphDescriptor(input)).toThrow(
      /parseSealedGraphDescriptor/,
    )
    expect(() => sealGraphDescriptor(input)).toThrow(
      GraphDescriptorValidationError,
    )
    expect(() => sealGraphDescriptor(input)).toThrow(
      /parseSealedGraphDescriptor/,
    )
  })
  it('(g) verifyDescriptorHash is true only for valid hash-matching input and never freezes the caller', () => {
    const input = persisted()
    expect(verifyDescriptorHash(input)).toBe(true)
    expect(
      verifyDescriptorHash({ ...input, descriptor_hash: 'f'.repeat(64) }),
    ).toBe(false)
    const caller = { ...input }
    expect(Object.isFrozen(caller)).toBe(false)
    verifyDescriptorHash(caller)
    expect(Object.isFrozen(caller)).toBe(false)
  })
})

describe('D25 - prototype-named stable IDs are safe', () => {
  const protoInput = () => ({
    descriptor_version: 1,
    run_id: 'run-proto',
    revision_id: 'rev-proto',
    goal: 'proto ids',
    nodes: [
      { ...executableNode('constructor', 'command'), title: 'Ctor' },
      { ...executableNode('prototype', 'command'), title: 'Proto' },
      { ...executableNode('hasOwnProperty', 'command'), title: 'Own' },
    ],
    edges: [
      { id: 'e1', kind: 'fixed', from: 'constructor', to: 'prototype' },
      { id: 'e2', kind: 'fixed', from: 'prototype', to: 'hasOwnProperty' },
    ],
    entry_node_ids: ['constructor'],
    concurrency_limit: 1,
    terminal_verification_node_id: 'hasOwnProperty',
  })
  it('parses, seals, verifies, and persisted-round-trips prototype-named ids', () => {
    expect(() => parseGraphDescriptor(protoInput())).not.toThrow()
    const sealed = sealGraphDescriptor(protoInput())
    expect(verifyDescriptorHash(sealed)).toBe(true)
    expect(computeDescriptorHash(sealed)).toBe(sealed.descriptor_hash)
    expect(
      parseSealedGraphDescriptor(JSON.parse(JSON.stringify(sealed)))
        .descriptor_hash,
    ).toBe(sealed.descriptor_hash)
    expect(isGraphDescriptor(protoInput())).toBe(true)
  })
  it('rejects duplicate prototype-named node ids via own-key duplicates detection', () => {
    const input = protoInput()
    expect(() =>
      parseGraphDescriptor({
        ...input,
        nodes: [...input.nodes, executableNode('constructor', 'command')],
      }),
    ).toThrow(/duplicate node ID\(s\): constructor/)
  })
})

// ---------- M1 - schema 层畸形拒绝矩阵（4 节点 × 4 边；zod v4 漂移锁） ----------
// schema 层认识 conditional/back_edge（合法样本通过）；UNSUPPORTED_EDGE 拒绝
// 在 validate/run 入口（S3/S5 范围），本矩阵只锁 schema 形状拒绝。

describe('M1 - node schema malformed rejection matrix (agent/command/human-approval/join)', () => {
  const agent = executableNode('n1', 'agent')
  const command = executableNode('n2', 'command')
  const approval = { id: 'n3', kind: 'human-approval', title: 'T', prompt: 'ok?' }
  const join = { id: 'n4', kind: 'join', title: 'T', fan_out_node_id: 'f1', input_branch_ids: ['b1', 'b2'] }

  it('accepts one valid sample per node kind (positive control)', () => {
    for (const node of [agent, command, approval, join]) {
      expect(graphNodeSchema.safeParse(node).success).toBe(true)
    }
  })

  it.each([
    ['agent missing instructions', { ...agent, instructions: undefined }],
    ['agent empty instructions', { ...agent, instructions: '' }],
    ['agent timeout_ms below min', { ...agent, timeout_ms: 99 }],
    ['agent timeout_ms above max', { ...agent, timeout_ms: 86_400_001 }],
    ['agent timeout_ms non-integer', { ...agent, timeout_ms: 60_000.5 }],
    ['agent max_attempts zero', { ...agent, max_attempts: 0 }],
    ['agent max_attempts above max', { ...agent, max_attempts: 21 }],
    ['agent unknown effect_policy', { ...agent, effect_policy: { policy: 'mystery' } }],
    ['agent idempotent policy missing key template', { ...agent, effect_policy: { policy: 'idempotent' } }],
    ['agent unknown key (strict)', { ...agent, extra: true }],
    ['agent empty title', { ...agent, title: '' }],
    ['command missing command', { ...command, command: undefined }],
    ['command with agent-only instructions key (strict)', { ...command, instructions: 'x' }],
    ['human-approval missing prompt', { ...approval, prompt: undefined }],
    ['human-approval with executable-only key (strict)', { ...approval, timeout_ms: 1000 }],
    ['join fan_out_node_id invalid charset', { ...join, fan_out_node_id: 'bad id' }],
    ['join input_branch_ids below min 2', { ...join, input_branch_ids: ['b1'] }],
    ['join input_branch_ids above max 64', { ...join, input_branch_ids: Array.from({ length: 65 }, (_, i) => `b${i}`) }],
    ['wrong kind literal', { ...agent, kind: 'robot' }],
    ['missing kind discriminator', { id: 'n9', title: 'T' }],
  ])('rejects %s', (_name, node) => {
    expect(graphNodeSchema.safeParse(node).success).toBe(false)
  })
})

describe('M1 - edge schema malformed rejection matrix (fixed/conditional/fan_out/back_edge)', () => {
  const fixed = { id: 'e1', kind: 'fixed', from: 'a', to: 'b' }
  const conditional = { id: 'e2', kind: 'conditional', from: 'a', to: 'b', route: 'r1' }
  const fanOut = { id: 'e3', kind: 'fan_out', from: 'a', to: 'b', branch_id: 'br1', owner_join_id: 'j1' }
  const backEdge = { id: 'e4', kind: 'back_edge', from: 'a', to: 'b', route: 'retry', max_traversals: 3 }

  it('accepts one valid sample per edge kind incl. conditional/back_edge (positive control)', () => {
    for (const edge of [fixed, conditional, fanOut, backEdge]) {
      expect(graphEdgeSchema.safeParse(edge).success).toBe(true)
    }
  })

  it.each([
    ['fixed unknown key (strict)', { ...fixed, route: 'r1' }],
    ['fixed missing from', { id: 'e1', kind: 'fixed', to: 'b' }],
    ['conditional missing route', { id: 'e2', kind: 'conditional', from: 'a', to: 'b' }],
    ['conditional route invalid charset', { ...conditional, route: 'bad route' }],
    ['fan_out missing branch_id', { id: 'e3', kind: 'fan_out', from: 'a', to: 'b', owner_join_id: 'j1' }],
    ['fan_out missing owner_join_id', { id: 'e3', kind: 'fan_out', from: 'a', to: 'b', branch_id: 'br1' }],
    ['back_edge missing max_traversals', { id: 'e4', kind: 'back_edge', from: 'a', to: 'b', route: 'retry' }],
    ['back_edge max_traversals zero', { ...backEdge, max_traversals: 0 }],
    ['back_edge max_traversals above max', { ...backEdge, max_traversals: 101 }],
    ['back_edge missing route', { id: 'e4', kind: 'back_edge', from: 'a', to: 'b', max_traversals: 3 }],
    ['wrong kind literal', { ...fixed, kind: 'warp' }],
    ['dangling id charset on from', { ...fixed, from: 'bad!' }],
  ])('rejects %s', (_name, edge) => {
    expect(graphEdgeSchema.safeParse(edge).success).toBe(false)
  })

  it('per-kind strict objects reject foreign keys at the dedicated schema level too', () => {
    expect(graphFixedEdgeSchema.safeParse({ ...fixed, extra: 1 }).success).toBe(false)
    expect(graphConditionalEdgeSchema.safeParse({ ...conditional, extra: 1 }).success).toBe(false)
    expect(graphFanOutEdgeSchema.safeParse({ ...fanOut, extra: 1 }).success).toBe(false)
    expect(graphBackEdgeSchema.safeParse({ ...backEdge, extra: 1 }).success).toBe(false)
  })
})

// ---------- IC-04：护栏前缀不计入 32768 作者上限（轮 20 graph P2 批次） ----------

it('IC-04：32768 字符原文本 + 护栏前缀封印通过；32769 原文本拒绝（前缀不进作者上限）', () => {
  const base = {
    descriptor_version: 1, run_id: 'run-guard-cap', revision_id: 'rev-1', goal: 'cap boundary',
    concurrency_limit: 1, entry_node_ids: ['a1'], terminal_verification_node_id: 'a1', edges: [],
    nodes: [{ id: 'a1', kind: 'agent', title: 'a1', timeout_ms: 1000, max_attempts: 1,
      effect_policy: { policy: 'side_effect_free' }, instructions: 'x'.repeat(32_768) }],
  }
  const sealed = sealGraphDescriptor(applyAgentGuardrails(parseGraphDescriptor(base)))
  expect(sealed.nodes[0].instructions.length)
    .toBe(32_768 + AGENT_GUARDRAIL_PREFIX.length + 2) // 前缀幂等拼上且不破上限
  const over = { ...base, nodes: [{ ...base.nodes[0], instructions: 'x'.repeat(32_769) }] }
  expect(() => sealGraphDescriptor(applyAgentGuardrails(parseGraphDescriptor(over)))).toThrow()
})