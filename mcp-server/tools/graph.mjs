// mcp-server/tools/graph.mjs
// U4 S5（计划 .omd/plans/ralplan-u4-graph-runtime.md §5 Q1/Q5/Q6/Q7/Q8/Q9/Q11、
// §7 步骤 5、§4 integration、§6 验收 1/6/8）：graph DAG 运行时的 MCP 六工具面——
// graph_validate / graph_run / graph_status / graph_resume / graph_node_result /
// graph_gate_resolve。确定性推进全部在 lib/graph 核心（runGraph），工具层只做
// 入口契约：
// - 恒返回 {exit_code, terminal_status, ...} 形状（Q8，失败也不抛、映射退出码）；
// - UNSUPPORTED_EDGE 入口 fail-fast（assertSupportedEdges，Q5）；
// - agent 护栏前缀注入（Q7）：effect_policy=side_effect_free 的 agent 节点
//   instructions 在封印前强制拼只读/leaf-guard 契约前缀（运行时生成，与 bin
//   入口共用 lib/graph/guardrails.js，双入口同 hash）；
// - graph_node_result / graph_gate_resolve 的匹配校验与幂等在工具层入口即做
//   （Q11/Q6），append 经 OwnerFence 绑定（跨进程 OCC 互斥，Q3 口径）。
//
// 授权面诚实声明（计划 Principle 5）：graph_gate_resolve / graph_node_result
// 信任 MCP 调用者、无用户在场证明——gate 是工作流构造而非安全边界（模型本就
// 持 pwsh，绕过成本为零），属 prompt 层约定；缓解=裁决/提交必须匹配最新
// pending（错位 fail-closed 拒绝）。graph_run/resume 同步推进单次调用时长=
// 至首个等待点耗时之和、无上限；客户端超时/断连不影响 run 推进，以
// graph_status 轮询。
import { z, ZodError } from 'zod'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  GraphDescriptorValidationError,
  parseSealedGraphDescriptor,
  sealGraphDescriptor,
} from '../../lib/graph/descriptor.js'
import { applyAgentGuardrails } from '../../lib/graph/guardrails.js'
import {
  DESCRIPTOR_SNAPSHOT_NAME,
  DescriptorDriftError,
  FileJournal,
  JOURNAL_FILE_NAME,
  JournalCorruptionError,
} from '../../lib/graph/journal.js'
import { FenceError, OwnerFence } from '../../lib/graph/fence.js'
import {
  assertSupportedEdges,
  GraphSchedulerError,
  projectGraph,
} from '../../lib/graph/scheduler.js'
import { EXIT_CODES, runGraph } from '../../lib/graph/runner.js'

const graphRoot = (cwd, stateDir) => join(cwd, stateDir ?? '.omd', 'graph-runs')

/** 工具层失败映射：恒返回结果形状，绝不向 MCP 抛（Q8；未知兜底 70）。 */
function toolFailure(error, runId = null) {
  const message = error instanceof Error ? error.message : String(error)
  let exitCode = EXIT_CODES.CRASH
  if (error instanceof FenceError) exitCode = EXIT_CODES.FENCED_OUT
  else if (error instanceof JournalCorruptionError) exitCode = EXIT_CODES.CORRUPT_JOURNAL
  else if (error instanceof DescriptorDriftError) exitCode = EXIT_CODES.DESCRIPTOR_DRIFT
  else if (error instanceof GraphSchedulerError) exitCode = error.exitCode
  else if (error instanceof GraphDescriptorValidationError) exitCode = EXIT_CODES.FAILED_TERMINAL
  else if (error instanceof ZodError) exitCode = EXIT_CODES.FAILED_TERMINAL // 畸形入参=调用方错误，非运行时崩溃
  else if (error instanceof RangeError) exitCode = EXIT_CODES.FAILED_TERMINAL
  return {
    exit_code: exitCode,
    terminal_status: null,
    status: 'in_progress',
    run_id: runId,
    error: message,
  }
}

/** 入口封印管线：sealed 输入（带 descriptor_hash）校验后原样采用——永不静默
 *  重算；draft 输入先拼护栏前缀再封印（Q7；hash 由前缀参与、确定性可重放）。 */
function sealForRun(descriptor) {
  const hash =
    descriptor !== null && typeof descriptor === 'object' && !Array.isArray(descriptor)
      ? descriptor.descriptor_hash
      : undefined
  if (typeof hash === 'string') return parseSealedGraphDescriptor(descriptor)
  return sealGraphDescriptor(applyAgentGuardrails(descriptor))
}

/** run 目录 descriptor.json 快照重水化（graph_status/graph_resume 的恢复输入）。 */
function readDescriptorSnapshot(runsRoot, runId) {
  const snapshotPath = join(runsRoot, runId, DESCRIPTOR_SNAPSHOT_NAME)
  let raw
  try {
    raw = readFileSync(snapshotPath, 'utf8')
  } catch (error) {
    throw new DescriptorDriftError(
      'descriptor snapshot unreadable: ' + String(error?.code ?? error?.message ?? error),
    )
  }
  let snapshot
  try {
    snapshot = JSON.parse(raw)
  } catch {
    throw new DescriptorDriftError('descriptor snapshot is not valid JSON')
  }
  return parseSealedGraphDescriptor(snapshot)
}

function reject(exitCode, message, runId = null) {
  return { exit_code: exitCode, terminal_status: null, status: 'in_progress', run_id: runId, error: message }
}

/** append 后重投影（快照缺席/畸形时不阻塞提交回报，降级为空投影）。 */
function projectAfter(runsRoot, runId) {
  try {
    const journal = new FileJournal(runsRoot, runId)
    const projection = projectGraph(
      readDescriptorSnapshot(runsRoot, runId),
      journal.readAll(),
    )
    return {
      terminal_status: projection.terminal_status,
      status: projection.status,
      waiting: projection.waiting,
    }
  } catch {
    return { terminal_status: null, status: 'in_progress', waiting: [] }
  }
}

export function makeGraphTools(env) {
  const stateDir = env?.stateDir

  return {
    /** graph_validate：descriptor 先自检（strict schema + 结构 + UNSUPPORTED_EDGE）。 */
    async validate({ cwd, descriptor }) {
      try {
        const sealed = sealForRun(descriptor)
        assertSupportedEdges(sealed)
        return {
          exit_code: 0,
          terminal_status: null,
          status: 'in_progress', // 形状惯例：validate 不建 run、无投影面，与 toolFailure 兜底一致
          run_id: sealed.run_id,
          descriptor_hash: sealed.descriptor_hash,
          node_count: sealed.nodes.length,
          edge_count: sealed.edges.length,
        }
      } catch (error) {
        const runId =
          descriptor !== null && typeof descriptor === 'object' ? descriptor.run_id ?? null : null
        return toolFailure(error, runId)
      }
    },

    /** graph_run：封印并同步推进至首个等待点/终态（Q8 返回形状 = runGraph 契约）。 */
    async run({ cwd, descriptor, takeover, stale_grace_ms }) {
      let sealed = null
      try {
        sealed = sealForRun(descriptor)
        assertSupportedEdges(sealed) // 入口 fail-fast（Q5）；runGraph 投影层同闸兜底
        return await runGraph({
          sealedDescriptor: sealed,
          runsRoot: graphRoot(cwd, stateDir),
          takeover: takeover === true,
          staleGraceMs: stale_grace_ms,
          cwd,
        })
      } catch (error) {
        const runId = sealed?.run_id ?? descriptor?.run_id ?? null
        return toolFailure(error, runId)
      }
    },

    /** graph_status：projectGraph 投影 + fence.inspect()（含 stalled，Q9）。 */
    async status({ cwd, run_id }) {
      try {
        const runsRoot = graphRoot(cwd, stateDir)
        const journal = new FileJournal(runsRoot, run_id) // 构造即校验 run_id charset
        if (!existsSync(join(runsRoot, run_id, JOURNAL_FILE_NAME))) {
          return reject(EXIT_CODES.FAILED_TERMINAL, 'graph run not found: ' + run_id, run_id)
        }
        const records = journal.readAll({ verifyDescriptorHash: true }) // 快照绑定（21）
        const projection = projectGraph(readDescriptorSnapshot(runsRoot, run_id), records)
        const fence = new OwnerFence(runsRoot, run_id).inspect()
        return {
          exit_code: 0,
          terminal_status: projection.terminal_status,
          status: projection.status,
          run_id: projection.run_id,
          descriptor_hash: projection.descriptor_hash,
          max_seq: projection.max_seq,
          ready: projection.ready,
          waiting: projection.waiting,
          blocked: projection.blocked,
          done: projection.done,
          failed: projection.failed,
          cohorts: projection.cohorts,
          fence,
        }
      } catch (error) {
        return toolFailure(error, run_id)
      }
    },

    /** graph_resume：唯一续驱动口——从 run 目录快照重水化并推进；
     *  takeover:true 是 stalled run 的显式接管（否则占用中即 19，Q9）。 */
    async resume({ cwd, run_id, takeover, stale_grace_ms }) {
      try {
        const runsRoot = graphRoot(cwd, stateDir)
        if (!existsSync(join(runsRoot, run_id, JOURNAL_FILE_NAME))) {
          return reject(EXIT_CODES.FAILED_TERMINAL, 'graph run not found: ' + run_id, run_id)
        }
        const sealed = readDescriptorSnapshot(runsRoot, run_id)
        return await runGraph({
          sealedDescriptor: sealed,
          runsRoot,
          takeover: takeover === true,
          staleGraceMs: stale_grace_ms,
          cwd,
        })
      } catch (error) {
        return toolFailure(error, run_id)
      }
    },

    /**
     * graph_node_result（Q11）：agent 节点 node_committed 的唯一提交口。
     * 必须匹配最新 agent_pending（node_id 一致、attempt 一致、该 pending 尚无
     * committed）；同 payload 重复提交幂等返回，异 payload 拒绝。授权面诚实
     * 声明见文件头（信任 MCP 调用者，prompt 层约定）。
     */
    async nodeResult({ cwd, run_id, node_id, attempt, exit_code, output_ref, output }) {
      try {
        if (typeof node_id !== 'string' || node_id.length === 0) {
          return reject(EXIT_CODES.FAILED_TERMINAL, 'node_id must be a non-empty string', run_id)
        }
        if (!Number.isInteger(attempt) || attempt < 1) {
          return reject(EXIT_CODES.FAILED_TERMINAL, 'attempt must be an integer >= 1', run_id)
        }
        if (!Number.isInteger(exit_code) || exit_code < 0) {
          return reject(EXIT_CODES.FAILED_TERMINAL, 'exit_code must be an integer >= 0', run_id)
        }
        if (output_ref !== undefined && (typeof output_ref !== 'string' || output_ref.length === 0)) {
          return reject(EXIT_CODES.FAILED_TERMINAL, 'output_ref must be a non-empty string', run_id)
        }
        if (output !== undefined && typeof output !== 'string') {
          return reject(EXIT_CODES.FAILED_TERMINAL, 'output must be a string', run_id)
        }
        const runsRoot = graphRoot(cwd, stateDir)
        const journal = new FileJournal(runsRoot, run_id) // 构造即校验 run_id charset
        if (!existsSync(join(runsRoot, run_id, JOURNAL_FILE_NAME))) {
          return reject(EXIT_CODES.FAILED_TERMINAL, 'graph run not found: ' + run_id, run_id)
        }
        const records = journal.readAll()

        // 匹配最新 agent_pending（该 node 的 max-seq pending；attempt 必须一致）。
        let pending = null
        for (let i = records.length - 1; i >= 0; i -= 1) {
          const record = records[i]
          if (record.type === 'agent_pending' && record.node_id === node_id) {
            pending = record
            break
          }
        }
        if (pending === null) {
          return reject(
            EXIT_CODES.FAILED_TERMINAL,
            'no agent_pending found for node ' + JSON.stringify(node_id) + ' in run ' + run_id,
            run_id,
          )
        }
        if (pending.attempt !== attempt) {
          return reject(
            EXIT_CODES.FAILED_TERMINAL,
            'agent_pending mismatch for node ' + JSON.stringify(node_id) + ': latest pending attempt is ' +
              String(pending.attempt) + ', got ' + String(attempt),
            run_id,
          )
        }

        // 幂等（Q11）：已有 committed——同 payload 幂等返回，异 payload 拒绝。
        let committed = null
        for (let i = records.length - 1; i >= 0; i -= 1) {
          const record = records[i]
          if (record.type === 'node_committed' && record.node_id === node_id && record.attempt === attempt) {
            committed = record
            break
          }
        }
        if (committed !== null) {
          const samePayload =
            committed.exit_code === exit_code &&
            (committed.output_ref ?? undefined) === (output_ref ?? undefined)
          if (!samePayload) {
            return reject(
              EXIT_CODES.FAILED_TERMINAL,
              'node ' + JSON.stringify(node_id) + ' attempt ' + String(attempt) +
                ' already committed with a different payload (recorded exit_code ' +
                String(committed.exit_code) + ', got ' + String(exit_code) + ')',
              run_id,
            )
          }
          const settled = projectAfter(runsRoot, run_id)
          return {
            exit_code: 0,
            terminal_status: settled.terminal_status,
            status: settled.status,
            run_id,
            node_id,
            attempt,
            idempotent: true,
            waiting: settled.waiting,
          }
        }

        // append 绑 fence（跨进程 OCC，Q3 口径）；占用中 → 19。
        const fence = new OwnerFence(runsRoot, run_id)
        fence.acquire()
        try {
          const bound = new FileJournal(runsRoot, run_id, {
            assertOwnership: () => fence.assertOwnership(),
          })
          const record = { type: 'node_committed', node_id, attempt, exit_code }
          if (output_ref !== undefined) record.output_ref = output_ref
          if (typeof output === 'string' && output.length > 0) record.output = output
          bound.append(record)
        } finally {
          try {
            fence.release()
          } catch {
            // best-effort；遗留 lock 由 stale 判定收割。
          }
        }
        const settled = projectAfter(runsRoot, run_id)
        return {
          exit_code: 0,
          terminal_status: settled.terminal_status,
          status: settled.status,
          run_id,
          node_id,
          attempt,
          idempotent: false,
          waiting: settled.waiting,
        }
      } catch (error) {
        return toolFailure(error, run_id)
      }
    },

    /**
     * graph_gate_resolve（Q6）：human-approval 节点唯一裁决口。必须匹配该 gate
     * 最新 gate_waiting（此后尚无 gate_resolved）；错位/已裁决/终态 run 一律
     * 拒绝。denied 是一等结局（run 以 gate_denied 终结）。授权面诚实声明见
     * 文件头（信任 MCP 调用者，prompt 层约定，非安全边界）。
     */
    async gateResolve({ cwd, run_id, node_id, decision, output_summary }) {
      try {
        if (typeof node_id !== 'string' || node_id.length === 0) {
          return reject(EXIT_CODES.FAILED_TERMINAL, 'node_id must be a non-empty string', run_id)
        }
        if (decision !== 'approved' && decision !== 'denied') {
          return reject(EXIT_CODES.FAILED_TERMINAL, "decision must be 'approved' or 'denied'", run_id)
        }
        if (output_summary !== undefined && (typeof output_summary !== 'string' || output_summary.length === 0)) {
          return reject(EXIT_CODES.FAILED_TERMINAL, 'output_summary must be a non-empty string', run_id)
        }
        const runsRoot = graphRoot(cwd, stateDir)
        const journal = new FileJournal(runsRoot, run_id) // 构造即校验 run_id charset
        if (!existsSync(join(runsRoot, run_id, JOURNAL_FILE_NAME))) {
          return reject(EXIT_CODES.FAILED_TERMINAL, 'graph run not found: ' + run_id, run_id)
        }
        const records = journal.readAll()

        // 最新 gate_waiting（该 node 的 max-seq waiting；Q6 run_id+node_id+最大 seq）。
        let waiting = null
        for (let i = records.length - 1; i >= 0; i -= 1) {
          const record = records[i]
          if (record.type === 'gate_waiting' && record.node_id === node_id) {
            waiting = record
            break
          }
        }
        if (waiting === null) {
          return reject(
            EXIT_CODES.FAILED_TERMINAL,
            'no gate_waiting found for node ' + JSON.stringify(node_id) + ' in run ' + run_id,
            run_id,
          )
        }
        const resolvedAfter = records.some(
          (record) =>
            record.type === 'gate_resolved' &&
            record.node_id === node_id &&
            record.seq > waiting.seq,
        )
        if (resolvedAfter) {
          return reject(
            EXIT_CODES.FAILED_TERMINAL,
            'gate ' + JSON.stringify(node_id) + ' latest waiting (seq ' + String(waiting.seq) +
              ') is already resolved; stale decisions are rejected',
            run_id,
          )
        }

        // 终态 run 拒绝裁决（fail-closed；投影需要快照，缺席按漂移口径）。
        const projectionBefore = projectGraph(
          readDescriptorSnapshot(runsRoot, run_id),
          records,
        )
        if (projectionBefore.terminal_status !== null) {
          return reject(
            EXIT_CODES.FAILED_TERMINAL,
            'run ' + run_id + ' is already terminal (' + projectionBefore.terminal_status + '); gate decision rejected',
            run_id,
          )
        }

        // append 绑 fence（跨进程 OCC，Q3 口径）；占用中 → 19。
        const fence = new OwnerFence(runsRoot, run_id)
        fence.acquire()
        try {
          const bound = new FileJournal(runsRoot, run_id, {
            assertOwnership: () => fence.assertOwnership(),
          })
          const record = { type: 'gate_resolved', node_id, decision }
          if (output_summary !== undefined) record.output_summary = output_summary
          bound.append(record)
        } finally {
          try {
            fence.release()
          } catch {
            // best-effort；遗留 lock 由 stale 判定收割。
          }
        }
        const settled = projectAfter(runsRoot, run_id)
        return {
          exit_code: 0,
          terminal_status: settled.terminal_status,
          status: settled.status,
          run_id,
          node_id,
          decision,
          waiting: settled.waiting,
        }
      } catch (error) {
        return toolFailure(error, run_id)
      }
    },

  }
}

export function registerGraphTools(server, env) {
  const t = makeGraphTools(env)
  const jsonOut = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }] })
  const base = { cwd: z.string() }
  const runIdBase = { ...base, run_id: z.string() }
  const runOpts = { takeover: z.boolean().optional(), stale_grace_ms: z.number().min(1).optional() } // 拒负数/0；缺省走 fence 默认 30s
  server.registerTool('graph_validate', {
    description: 'graph descriptor 自检（strict schema + 结构 + UNSUPPORTED_EDGE fail-fast）——写 descriptor 先自检，返回将封印的 descriptor_hash；effect_policy=side_effect_free 的 agent 节点 instructions 在此拼只读/leaf-guard 护栏前缀（运行时生成）',
    inputSchema: { ...base, descriptor: z.record(z.any()) },
  }, async a => jsonOut(await t.validate(a)))
  server.registerTool('graph_run', {
    description: 'graph 运行：封印并同步推进至首个等待点（gate_waiting/agent_pending）或终态，恒返回 {exit_code, terminal_status, status, waiting, projection}；同 run_id 重入 fence 存活即 19，owner 死且 stale 过期需 takeover:true 显式接管；UNSUPPORTED_EDGE（conditional/back_edge）入口 fail-fast；授权面：descriptor 内 command 节点是经 pwsh 执行的任意 shell 行，只运行你撰写或信任的 descriptor（与 bin 入口同权）',
    inputSchema: { ...base, descriptor: z.record(z.any()), ...runOpts },
  }, async a => jsonOut(await t.run(a)))
  server.registerTool('graph_status', {
    description: 'graph 运行状态：projectGraph 投影（ready/waiting/blocked/done/failed/max_seq/terminal_status）+ fence 观测（occupied/stalled/epoch；stalled=lease 超宽限期且 owner pid 不存活）',
    inputSchema: runIdBase,
  }, async a => jsonOut(await t.status(a)))
  server.registerTool('graph_resume', {
    description: 'graph 恢复（唯一续驱动口）：从 run 目录 descriptor.json 快照重水化并推进至下一等待点/终态；takeover:true 为 stalled run 显式接管（成功写 fence_acquired 审计行），非 stalled 占用即 19',
    inputSchema: { ...runIdBase, ...runOpts },
  }, async a => jsonOut(await t.resume(a)))
  server.registerTool('graph_node_result', {
    description: 'agent 节点结果提交（node_committed 唯一提交口）：输入 {run_id,node_id,attempt,exit_code,output_ref?}，必须匹配最新 agent_pending（attempt 一致且尚无 committed），同 payload 幂等、异 payload 拒绝。授权面：信任 MCP 调用者（prompt 层约定，非安全边界）',
    inputSchema: { ...runIdBase, node_id: z.string(), attempt: z.number().int(), exit_code: z.number().int(), output_ref: z.string().optional(), output: z.string().optional() },
  }, async a => jsonOut(await t.nodeResult(a)))
  server.registerTool('graph_gate_resolve', {
    description: 'human-approval 节点裁决（gate_resolved 唯一提交口）：decision=approved|denied（denied 一等结局，run 以 gate_denied 终结）；必须匹配该 gate 最新 gate_waiting，错位/已裁决/终态 run 拒绝。授权面：信任 MCP 调用者——gate 是工作流构造而非安全边界（prompt 层约定）',
    inputSchema: { ...runIdBase, node_id: z.string(), decision: z.enum(['approved', 'denied']), output_summary: z.string().optional() },
  }, async a => jsonOut(await t.gateResolve(a)))
}