// lib/graph/scheduler.js
// Graph Core 纯函数调度投影（零 I/O）——输入 = sealed descriptor + 扁平 journal
// 记录数组（FileJournal.readAll 输出或按 SKILL.zh.md L83-91 手写的模型驱动
// journal），输出 = ready/waiting/blocked/done/failed 节点集（U4 S3，计划
// .omd/plans/ralplan-u4-graph-runtime.md §5 Q4/Q5、§7 步骤 3、§4 unit 段）。
//
// 不变量（写死在本层）：
// - node_committed 是节点完成的唯一判据（SKILL.zh.md L94）：有 node_scheduled
//   无 node_committed → 投影回 ready 重跑（at-least-once，attempt 续号消耗预算，
//   与上游 runner.ts beginActivationAttempt 在 begin 时消耗预算同语义）；
// - conditional/back_edge 一期不支持：schema 层认识这两类（lib/graph/schema.js
//   L98-116），scheduler/入口以 UNSUPPORTED_EDGE fail-fast（exit 1 显式文案，
//   计划 §5 Q5）；
// - fan_out cohort/token identity 借上游 runner.ts L142-151 确定性合成方案
//   （0-based：cohort=`<fanNodeId>-coh<k>`、token=`<cohortId>-tok<i>`，i=fan_out
//   边在 descriptor 中的序）；一期 DAG 无 back_edge ⇒ fan 节点至多提交一次 ⇒ k 恒 0；
// - join 汇合移植 reference resolveJoin 语义（scheduler.ts L1104-1204）：owner fan
//   完成且 cohort 全部 branch token arrived ⇒ join 确定性消解（consumed 恰好一次；
//   纯函数投影天然幂等，无 journal 记录——扁平词汇表无 join type，消解可由同一
//   输入在恢复时逐位重放）。
//
// 本文件纯函数：不读盘、不写盘、不取时钟；journal 读取是调用方（S4 runner）的事。

import { JOURNAL_RECORD_TYPES } from './journal.js'

/** 一期不支持的边类（schema 认识、runtime 拒绝）。 */
export const UNSUPPORTED_EDGE_KINDS = Object.freeze(['conditional', 'back_edge'])
export const UNSUPPORTED_EDGE_CODE = 'UNSUPPORTED_EDGE'

/** 调度投影封闭错误：code 机器可判读，exitCode 对齐 SKILL.zh.md L41-43 契约。 */
export class GraphSchedulerError extends Error {
  constructor(code, exitCode, message) {
    super(message)
    this.name = 'GraphSchedulerError'
    this.code = code
    this.exitCode = exitCode
  }
}

/** conditional/back_edge 入口拒绝（exit 1 语义，显式文案）。 */
export class UnsupportedEdgeError extends GraphSchedulerError {
  constructor(edges) {
    const detail = edges
      .map((edge) => `edge ${edge.id} (${edge.from} -> ${edge.to}) kind '${edge.kind}'`)
      .join('; ')
    super(
      UNSUPPORTED_EDGE_CODE,
      1,
      `UNSUPPORTED_EDGE: ${detail} — conditional/back_edge edges are not supported by the phase-1 graph runtime and are rejected at entry (exit 1)`,
    )
    this.name = 'UnsupportedEdgeError'
    this.edges = edges.map((edge) => ({
      id: edge.id,
      kind: edge.kind,
      from: edge.from,
      to: edge.to,
    }))
  }
}

/**
 * 入口边类闸：descriptor 含 conditional/back_edge 边即抛 UnsupportedEdgeError。
 * graph_validate / graph_run / 投影入口共用（计划 §5 Q5：入口即拒，fail-fast）。
 */
export function assertSupportedEdges(descriptor) {
  const rejected = descriptor.edges.filter((edge) =>
    UNSUPPORTED_EDGE_KINDS.includes(edge.kind),
  )
  if (rejected.length > 0) throw new UnsupportedEdgeError(rejected)
}

/**
 * 确定性合成身份（移植上游 runner.ts L142-151，0-based）：
 * cohort = `<fanOutNodeId>-coh<cohortIndex>`；token = `<cohortId>-tok<branchIndex>`，
 * branchIndex = fan_out 边在 descriptor.edges 中的相对序。live 与恢复重放同值。
 */
export function cohortIdFor(fanOutNodeId, cohortIndex) {
  return `${fanOutNodeId}-coh${cohortIndex}`
}

/** 见 cohortIdFor。 */
export function branchTokenIdFor(cohortId, branchIndex) {
  return `${cohortId}-tok${branchIndex}`
}

/** Locale 无关的 code-unit 排序（对齐上游 compareIds，scheduler.ts L193-195）。 */
function compareIds(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

function groupEdgesBy(edges, key) {
  const result = new Map()
  for (const edge of edges) {
    const group = result.get(edge[key]) ?? []
    group.push(edge)
    result.set(edge[key], group)
  }
  return result
}

/** 记录流完整性闸：seq 严格递增 + type 在冻结词汇表内（fail-closed，20 语义）。 */
function validateRecordSequence(records) {
  if (!Array.isArray(records)) {
    throw new GraphSchedulerError(
      'INVALID_INPUT',
      1,
      'journal records must be an array of flat journal records',
    )
  }
  let previousSeq = 0
  for (const record of records) {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      throw new GraphSchedulerError(
        'JOURNAL_CORRUPT',
        20,
        'journal record is not an object',
      )
    }
    if (!Number.isInteger(record.seq) || record.seq <= previousSeq) {
      throw new GraphSchedulerError(
        'JOURNAL_CORRUPT',
        20,
        `journal seq is not strictly increasing at seq ${String(record.seq)}`,
      )
    }
    if (!JOURNAL_RECORD_TYPES.includes(record.type)) {
      throw new GraphSchedulerError(
        'JOURNAL_CORRUPT',
        20,
        `journal record type ${JSON.stringify(record.type)} is not in the frozen vocabulary`,
      )
    }
    previousSeq = record.seq
  }
}

/** 分支区域：从 branch head 前向可达且不穿过 owner join 的节点集（移植 descriptor.js collectBranchRegion 语义）。 */
function collectBranchRegion(outgoing, branchHeadId, joinNodeId) {
  const pending = [branchHeadId]
  const region = new Set()
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === joinNodeId || region.has(current)) continue
    region.add(current)
    for (const edge of outgoing.get(current) ?? []) pending.push(edge.to)
  }
  return region
}

/**
 * 纯函数投影：fold 扁平 journal 记录 → 节点集。
 *
 * @param {object} descriptor sealed descriptor（sealGraphDescriptor /
 *   parseSealedGraphDescriptor 输出；S1 已做全结构校验，本层不重验结构）。
 * @param {object[]} records 扁平 journal 记录数组（seq 升序；通常来自
 *   FileJournal.readAll，模型驱动期手写 journal 亦接受——本层做轻量完整性闸）。
 * @returns 投影对象（全新值，输入不被改动）：
 *   {
 *     run_id, descriptor_hash, max_seq,
 *     ready:   [{ node_id, attempt, reason: 'initial'|'retry'|'rerun' }]  // attempt=null 于 human-approval
 *     waiting: [{ node_id, kind: 'agent_pending'|'gate_waiting', attempt? }]
 *     blocked: [node_id],
 *     done:    [node_id],   // node_committed / gate approved / join 已消解
 *     failed:  [{ node_id, reason: 'non_retryable_failure'|'attempts_exhausted'|'gate_denied' }]
 *     cohorts: [{ cohort_id, fan_out_node_id, owner_join_id, token_ids,
 *                 arrived_token_ids, consumed }],
 *     terminal_status: 'completed'|'failed'|'cancelled'|null,  // run_finished 权威
 *     status:  'completed'|'failed'|'in_progress',  // terminal_status 缺省时派生
 *   }
 */
export function projectGraph(descriptor, records) {
  assertSupportedEdges(descriptor)
  validateRecordSequence(records)

  const nodes = new Map(descriptor.nodes.map((node) => [node.id, node]))
  const outgoing = groupEdgesBy(descriptor.edges, 'from')
  const incoming = groupEdgesBy(descriptor.edges, 'to')
  const entrySet = new Set(descriptor.entry_node_ids)

  // ---- fold：每节点账本 ----
  const ledger = new Map()
  for (const node of descriptor.nodes) {
    ledger.set(node.id, {
      maxAttempt: 0,
      committedAttempt: null,
      waiting: null,
      gateDecision: null,
      terminalFailed: null,
      lastOutcome: null,
    })
  }
  let terminalStatus = null
  let maxSeq = 0

  const requireLedger = (nodeId, type) => {
    const entry = ledger.get(nodeId)
    if (entry === undefined) {
      throw new GraphSchedulerError(
        'UNKNOWN_NODE',
        1,
        `${type} references node ${JSON.stringify(nodeId)} which is not in the descriptor`,
      )
    }
    return entry
  }

  for (const record of records) {
    maxSeq = record.seq
    switch (record.type) {
      case 'run_started': {
        if (record.run_id !== descriptor.run_id) {
          throw new GraphSchedulerError(
            'RUN_MISMATCH',
            1,
            `run_started.run_id ${JSON.stringify(record.run_id)} does not match descriptor run_id ${JSON.stringify(descriptor.run_id)}`,
          )
        }
        if (
          typeof descriptor.descriptor_hash === 'string' &&
          record.descriptor_hash !== descriptor.descriptor_hash
        ) {
          throw new GraphSchedulerError(
            'DESCRIPTOR_DRIFT',
            21,
            'run_started.descriptor_hash does not match the sealed descriptor hash',
          )
        }
        break
      }
      case 'node_scheduled': {
        const entry = requireLedger(record.node_id, record.type)
        entry.maxAttempt = Math.max(entry.maxAttempt, record.attempt)
        entry.waiting = null
        entry.lastOutcome = 'scheduled'
        break
      }
      case 'agent_pending': {
        const entry = requireLedger(record.node_id, record.type)
        entry.maxAttempt = Math.max(entry.maxAttempt, record.attempt)
        entry.waiting = { kind: 'agent_pending', attempt: record.attempt }
        entry.lastOutcome = 'pending'
        break
      }
      case 'gate_waiting': {
        const entry = requireLedger(record.node_id, record.type)
        entry.waiting = { kind: 'gate_waiting' }
        entry.lastOutcome = 'pending'
        break
      }
      case 'node_committed': {
        const entry = requireLedger(record.node_id, record.type)
        entry.maxAttempt = Math.max(entry.maxAttempt, record.attempt)
        entry.committedAttempt = record.attempt
        entry.waiting = null
        entry.lastOutcome = 'committed'
        break
      }
      case 'node_failed': {
        const entry = requireLedger(record.node_id, record.type)
        const node = nodes.get(record.node_id)
        entry.maxAttempt = Math.max(entry.maxAttempt, record.attempt)
        entry.waiting = null
        entry.lastOutcome = 'failed'
        // Q10 解读钉死 A：retryable 仅由 attempt < max_attempts 决定；
        // 记录值与推导双重取与（手写 journal 容错 fail-closed 方向）。
        const budget = node.max_attempts
        const retryable =
          record.retryable === true &&
          (budget === undefined || record.attempt < budget)
        if (!retryable) {
          // 预算耗尽优先于记录标志位命名：retryable=false 且 attempt 已达
          // max_attempts 正是「超限」常态（Q10），而非异常记录。
          entry.terminalFailed =
            budget !== undefined && record.attempt >= budget
              ? 'attempts_exhausted'
              : 'non_retryable_failure'
        }
        break
      }
      case 'gate_resolved': {
        const entry = requireLedger(record.node_id, record.type)
        entry.gateDecision = record.decision
        entry.waiting = null
        entry.lastOutcome = 'committed'
        if (record.decision === 'denied') entry.terminalFailed = 'gate_denied'
        break
      }
      case 'fence_acquired':
        // fence 元数据不进节点投影（计划 §5 Q9：fence 信息在旁文件/此行仅审计）。
        break
      case 'run_finished':
        terminalStatus = record.terminal_status
        break
      default:
        break
    }
  }

  // ---- join 消解（resolveJoin 语义移植；fixpoint 覆盖嵌套 fan_out 的内层 join） ----
  const joinResolved = new Map()
  const isDone = (nodeId) => {
    const entry = ledger.get(nodeId)
    const node = nodes.get(nodeId)
    return (
      entry.committedAttempt !== null ||
      entry.gateDecision === 'approved' ||
      (node.kind === 'join' && joinResolved.get(nodeId) === true)
    )
  }

  const joinNodes = descriptor.nodes.filter((node) => node.kind === 'join')
  const fanEdgesOf = (fanNodeId) =>
    (outgoing.get(fanNodeId) ?? []).filter((edge) => edge.kind === 'fan_out')

  /** token i arrived ⇔ 分支区域内存在已 done 且以 fixed 边直指本 join 的节点。 */
  const branchArrived = (joinNode, fanEdge) => {
    const region = collectBranchRegion(outgoing, fanEdge.to, joinNode.id)
    return (incoming.get(joinNode.id) ?? []).some(
      (edge) =>
        edge.kind === 'fixed' && region.has(edge.from) && isDone(edge.from),
    )
  }

  let changed = true
  while (changed) {
    changed = false
    for (const joinNode of joinNodes) {
      if (joinResolved.get(joinNode.id) === true) continue
      if (!isDone(joinNode.fan_out_node_id)) continue
      const fanEdges = fanEdgesOf(joinNode.fan_out_node_id)
      if (fanEdges.every((edge) => branchArrived(joinNode, edge))) {
        joinResolved.set(joinNode.id, true)
        changed = true
      }
    }
  }

  // ---- cohort 台账（确定性合成身份，0-based；一期 DAG ⇒ k 恒 0） ----
  const cohorts = []
  for (const node of descriptor.nodes) {
    const fanEdges = fanEdgesOf(node.id)
    if (fanEdges.length === 0 || !isDone(node.id)) continue
    const cohortId = cohortIdFor(node.id, 0)
    const ownerJoinId = fanEdges[0].owner_join_id
    const ownerJoin = nodes.get(ownerJoinId)
    const tokenIds = fanEdges.map((edge, index) =>
      branchTokenIdFor(cohortId, index),
    )
    const arrivedTokenIds = fanEdges
      .map((edge, index) => ({ edge, index }))
      .filter(({ edge }) => branchArrived(ownerJoin, edge))
      .map(({ index }) => tokenIds[index])
    cohorts.push({
      cohort_id: cohortId,
      fan_out_node_id: node.id,
      owner_join_id: ownerJoinId,
      token_ids: tokenIds,
      arrived_token_ids: arrivedTokenIds,
      consumed: joinResolved.get(ownerJoinId) === true,
    })
  }
  cohorts.sort((a, b) => compareIds(a.cohort_id, b.cohort_id))

  // ---- 节点集分类 ----
  const ready = []
  const waiting = []
  const blocked = []
  const done = []
  const failed = []

  const depsSatisfied = (node) => {
    if (entrySet.has(node.id) && (incoming.get(node.id) ?? []).length === 0) {
      return true
    }
    return (incoming.get(node.id) ?? []).every((edge) => isDone(edge.from))
  }

  for (const node of descriptor.nodes) {
    const entry = ledger.get(node.id)
    if (isDone(node.id)) {
      done.push(node.id)
      continue
    }
    if (entry.terminalFailed !== null) {
      failed.push({ node_id: node.id, reason: entry.terminalFailed })
      continue
    }
    if (node.kind === 'join') {
      // 未消解的 join 恒 blocked（不执行、不等待外部输入）。
      blocked.push(node.id)
      continue
    }
    if (entry.waiting !== null) {
      waiting.push({ node_id: node.id, ...entry.waiting })
      continue
    }
    if (!depsSatisfied(node)) {
      blocked.push(node.id)
      continue
    }
    if (node.kind === 'human-approval') {
      ready.push({ node_id: node.id, attempt: null, reason: 'initial' })
      continue
    }
    const nextAttempt = entry.maxAttempt + 1
    if (nextAttempt > node.max_attempts) {
      // 崩溃重跑/重试预算耗尽（scheduled 悬挂 attempt 已耗满 max_attempts）。
      failed.push({ node_id: node.id, reason: 'attempts_exhausted' })
      continue
    }
    ready.push({
      node_id: node.id,
      attempt: nextAttempt,
      reason:
        entry.maxAttempt === 0
          ? 'initial'
          : entry.lastOutcome === 'failed'
            ? 'retry'
            : 'rerun',
    })
  }

  ready.sort((a, b) => compareIds(a.node_id, b.node_id))
  waiting.sort((a, b) => compareIds(a.node_id, b.node_id))
  blocked.sort(compareIds)
  done.sort(compareIds)
  failed.sort((a, b) => compareIds(a.node_id, b.node_id))

  const status =
    terminalStatus ??
    (failed.length > 0
      ? 'failed'
      : done.length === descriptor.nodes.length
        ? 'completed'
        : 'in_progress')

  return {
    run_id: descriptor.run_id,
    descriptor_hash:
      typeof descriptor.descriptor_hash === 'string'
        ? descriptor.descriptor_hash
        : null,
    max_seq: maxSeq,
    ready,
    waiting,
    blocked,
    done,
    failed,
    cohorts,
    terminal_status: terminalStatus,
    status,
  }
}
