// lib/graph/runner.js
// Graph Core 推进循环（U4 S4a，计划 .omd/plans/ralplan-u4-graph-runtime.md
// §5 Q4/Q9/Q10、§7 步骤 4）——绑定 fence（owner 互斥）+ journal（唯一状态
// 权威）+ scheduler（纯函数投影）：
// - 同步推进至首个等待点（gate_waiting / agent_pending / run 终态）再返回
//   （OQ2 定案）；单次调用时长=至首个等待点耗时之和、无上限；
// - command 节点 = child_process spawn pwsh -NoProfile -Command；
//   concurrency_limit 闸在 ready-list 出队处（inflight promise pool）；
// - timeout_ms → Windows taskkill /PID <pid> /T /F 强杀整树（实证：孙进程
//   一并终止；被杀子进程 close 事件 exitCode=1/signalCode=null，故超时判定
//   只信自家 timedOut 标志）→ node_failed{retryable: attempt<max_attempts}
//   （Q10 钉死 A）→ 预算内重调度，超限 run failed exit 1；
//   非 Windows 回退进程组杀（detached 子进程 -pid SIGKILL → 单 pid 兜底）；
// - agent 节点 = 写 agent_pending 等待（运行时无杀 subagent 手段；watchdog 在
//   每次推进入口检查等待时长超 timeout_ms → 标 node_failed{retryable}）；
// - gate 节点 = 写 gate_waiting 等待（裁决由 S5 graph_gate_resolve 提交）；
// - resume 路径 = 读 journal 投影续跑（committed 零重跑由 scheduler 不变量
//   保证）；graph_run 幂等：同 run_id fence 存活 → exit 19；owner 死且 stale
//   过期 → takeover:true 显式接管，成功写 fence_acquired journal 行；
// - 退出码映射 {0,1,19,20,21,70}（SKILL.zh.md L41-43；70=未捕获异常兜底）。
//
// 返回形状契约（S4b/S5 对接面）：
//   {
//     exit_code: 0|1|19|20|21|70,   // 0=completed 或 parked（status 区分）
//     terminal_status: 'completed'|'failed'|'cancelled'|null,
//     status: 'completed'|'failed'|'in_progress'|'waiting',
//     run_id, descriptor_hash, epoch,
//     waiting: projection.waiting,   // parked 时的等待点（否则为最近投影值）
//     projection,                    // 完整投影（graph_status 复用）
//     error?: string,                // 映射失败（19/20/21/70/入口拒绝）消息
//   }
//
// fence 释放策略（与上游 runner.ts L1078 的有意偏差，明文记录）：上游异常退出
// 保留 lock 靠 stale reap；omd runner 常驻 MCP server 进程，异常返回后 pid 仍
// 存活会让 stale 双条件永不成立 → run 死锁。故本实现所有返回路径（正常 parked
// /终态/映射失败）都释放 fence；只有进程真崩溃才遗留 lock，由 lease 过期 +
// pid 死亡双条件被 takeover 收割。fence 心跳每推进循环迭代刷新一次 owner.json。

import { execFile, spawn } from 'node:child_process'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

import {
  DescriptorDriftError,
  FileJournal,
  JournalCorruptionError,
  DESCRIPTOR_SNAPSHOT_NAME,
} from './journal.js'
import { FenceError, OwnerFence } from './fence.js'
import { GraphSchedulerError, projectGraph } from './scheduler.js'

/** SKILL.zh.md L41-43 退出码契约（70 补齐上游 EXIT_CODES 缺口）。 */
export const EXIT_CODES = Object.freeze({
  OK: 0,
  FAILED_TERMINAL: 1,
  FENCED_OUT: 19,
  CORRUPT_JOURNAL: 20,
  DESCRIPTOR_DRIFT: 21,
  CRASH: 70,
})

/** 单路输出采集上限（字节）；超出截断并标记（大输出本就经 output_ref 旁路）。 */
export const MAX_CAPTURED_OUTPUT_BYTES = 256 * 1024
/** node_failed.error 附带输出尾部的上限。 */
const ERROR_OUTPUT_TAIL_BYTES = 1024

const IDEMPOTENCY_TOKEN_PATTERN = /\{(\w+)\}/g

/** idempotent 节点的 GRAPH_IDEMPOTENCY_KEY（authority.ts L72-89 token 方案）。 */
export function idempotencyKeyFor(descriptor, node, attempt) {
  if (node.effect_policy.policy !== 'idempotent') return undefined
  const tokens = {
    run_id: descriptor.run_id,
    node_id: node.id,
    attempt: String(attempt),
    attempt_no: String(attempt),
  }
  return node.effect_policy.idempotency_key_template.replace(
    IDEMPOTENCY_TOKEN_PATTERN,
    (match, token) =>
      Object.prototype.hasOwnProperty.call(tokens, token) ? tokens[token] : match,
  )
}

/** command 子进程环境：继承 process.env + 调用方扩展 + graph 自有变量。 */
function buildCommandEnv(descriptor, node, attempt, extraEnv) {
  const env = {
    ...process.env,
    ...(extraEnv ?? {}),
    GRAPH_RUN_ID: descriptor.run_id,
    GRAPH_NODE_ID: node.id,
    GRAPH_ATTEMPT: String(attempt),
  }
  const key = idempotencyKeyFor(descriptor, node, attempt)
  if (key !== undefined) env.GRAPH_IDEMPOTENCY_KEY = key
  return env
}

/**
 * 进程树强杀。Windows：taskkill /T /F（实证：pwsh 子进程树含孙进程一并终止，
 * Windows 自带零依赖）。非 Windows：detached 进程组 -pid SIGKILL，单 pid 兜底。
 */
export function killProcessTree(pid, execFileImpl = execFile) {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFileImpl(
        'taskkill',
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true },
        () => resolve(),
      )
      return
    }
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // 已退出。
      }
    }
    resolve()
  })
}

/**
 * 执行一个 command 节点（永不 reject；结果经 settled 对象带回）。
 * 超时只信自家 timedOut 标志（实证：taskkill 后 close 事件 exitCode=1、
 * signalCode=null，与命令自身非零退出不可区分）。
 */
function executeCommandNode(context) {
  const { descriptor, node, attempt, cwd, extraEnv, spawnImpl } = context
  return new Promise((resolve) => {
    let child
    try {
      child = spawnImpl('pwsh', ['-NoProfile', '-Command', node.command], {
        cwd,
        env: buildCommandEnv(descriptor, node, attempt, extraEnv),
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({ kind: 'failed', error: `spawn failed: ${error.message}` })
      return
    }
    let output = ''
    let truncated = false
    const capture = (chunk) => {
      if (truncated) return
      output += chunk.toString('utf8')
      if (Buffer.byteLength(output, 'utf8') > MAX_CAPTURED_OUTPUT_BYTES) {
        output = output.slice(0, MAX_CAPTURED_OUTPUT_BYTES)
        truncated = true
      }
    }
    child.stdout?.on('data', capture)
    child.stderr?.on('data', capture)
    let timedOut = false
    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      // 强杀不阻塞 close 结算；taskkill 失败（进程已退）无害。
      void killProcessTree(child.pid, context.execFileImpl)
    }, node.timeout_ms)
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    child.on('error', (error) => {
      finish({ kind: 'failed', error: `spawn failed: ${error.message}` })
    })
    child.on('close', (code, signal) => {
      const tail = truncated ? `${output}\n[output truncated]` : output
      if (timedOut) {
        finish({
          kind: 'failed',
          error: `timeout after ${node.timeout_ms}ms (process tree killed)`,
          output: tail,
        })
        return
      }
      if (code === 0) {
        finish({ kind: 'succeeded', exitCode: 0, output: tail })
        return
      }
      const why =
        signal !== null && signal !== undefined
          ? `terminated by signal ${signal}`
          : `exit code ${String(code)}`
      finish({ kind: 'failed', error: `command failed: ${why}`, output: tail })
    })
  })
}

/** node_failed.error 组装：消息 + 输出尾部（有界）。 */
function failureErrorMessage(result) {
  if (typeof result.output !== 'string' || result.output.length === 0) {
    return result.error
  }
  const tail = result.output.slice(-ERROR_OUTPUT_TAIL_BYTES)
  return `${result.error}; output tail: ${tail}`
}

/** 原子写 JSON 快照（temp+rename；与 fence sidecar 同方案）。 */
function atomicWriteJson(filePath, value) {
  const tmp = `${filePath}.tmp.${randomBytes(6).toString('hex')}`
  writeFileSync(tmp, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, filePath)
}

/**
 * 推进一个 sealed graph 至首个等待点或终态。
 *
 * @param {object} options
 * @param {object} options.sealedDescriptor sealGraphDescriptor /
 *   parseSealedGraphDescriptor 输出（含 descriptor_hash）。
 * @param {string} options.runsRoot 如 `<cwd>/.omd/graph-runs`。
 * @param {boolean} [options.takeover] 显式接管（graph_resume 路径；要求
 *   owner 死且 stale 过期，否则 FenceError → exit 19）。
 * @param {number} [options.staleGraceMs] fence 宽限注入（默认 30s）。
 * @param {string} [options.cwd] command 子进程工作目录（默认 process.cwd()）。
 * @param {object} [options.env] command 子进程额外环境变量。
 * @param {(event: object) => void} [options.onEvent] 进度事件回调
 *   （journal append 镜像 + run_parked/run_finished）。
 * @param {Function} [options.spawnImpl] 子进程注入缝（默认 node:child_process spawn）。
 * @param {Function} [options.execFileImpl] taskkill 注入缝（默认 execFile）。
 * @param {() => number} [options.now] 时钟注入缝（默认 Date.now）。
 */
export async function runGraph(options) {
  const descriptor = options.sealedDescriptor
  const runId = descriptor.run_id
  const runsRoot = options.runsRoot
  const now = options.now ?? Date.now
  const spawnImpl = options.spawnImpl ?? spawn
  const emit = (event) => {
    options.onEvent?.(event)
  }

  const fence = new OwnerFence(runsRoot, runId, {
    staleGraceMs: options.staleGraceMs,
    now,
  })
  const journal = new FileJournal(runsRoot, runId, {
    assertOwnership: () => fence.assertOwnership(),
  })

  let epoch = null
  let projection = null
  try {
    const acquired = options.takeover === true ? fence.takeover() : fence.acquire()
    epoch = acquired.epoch

    // ---- 启动：descriptor 快照 + run_started（fresh）或绑定校验（resume） ----
    mkdirSync(journal.runDir, { recursive: true })
    let records = journal.readAll()
    const isFresh = records.length === 0
    if (isFresh) {
      // 快照先于 run_started：崩溃介于两者间时下次调用重写快照（幂等）。
      atomicWriteJson(join(journal.runDir, DESCRIPTOR_SNAPSHOT_NAME), descriptor)
      journal.append({
        type: 'run_started',
        run_id: runId,
        descriptor_hash: descriptor.descriptor_hash,
      })
      records = journal.readAll({ verifyDescriptorHash: true })
      emit({ type: 'run_started', run_id: runId })
    } else {
      // 绑定校验：快照 vs run_started（21）；run_started vs 供给 descriptor
      // 的 hash 由 projectGraph fold 闸（21）。
      records = journal.readAll({ verifyDescriptorHash: true })
      // 接管/恢复获取一律写 fence_acquired 审计行（新 owner epoch 落账）。
      journal.append({ type: 'fence_acquired', epoch, owner_pid: process.pid })
      records = journal.readAll()
      emit({ type: 'fence_acquired', epoch })
    }

    const nodesById = new Map(descriptor.nodes.map((node) => [node.id, node]))
    const concurrencyLimit = descriptor.concurrency_limit
    const inflight = new Map()

    const appendRecord = (record) => {
      journal.append(record)
      emit({ ...record })
    }

    /** agent 等待 watchdog（Q10）：超 timeout_ms 标 node_failed，不强杀。 */
    const expireAgentWaitings = () => {
      const current = projectGraph(descriptor, journal.readAll())
      let expired = false
      for (const entry of current.waiting) {
        if (entry.kind !== 'agent_pending') continue
        const node = nodesById.get(entry.node_id)
        let pendingRec = null
        const all = journal.readAll()
        for (let i = all.length - 1; i >= 0; i -= 1) {
          const rec = all[i]
          if (
            rec.type === 'agent_pending' &&
            rec.node_id === entry.node_id &&
            rec.attempt === entry.attempt
          ) {
            pendingRec = rec
            break
          }
        }
        if (pendingRec === null) continue
        const elapsedMs = now() - Date.parse(pendingRec.ts)
        if (elapsedMs <= node.timeout_ms) continue
        appendRecord({
          type: 'node_failed',
          node_id: entry.node_id,
          attempt: entry.attempt,
          error: `agent pending exceeded timeout_ms ${node.timeout_ms} (watchdog; subagent not killed)`,
          retryable: entry.attempt < node.max_attempts,
        })
        expired = true
      }
      return expired
    }

    const drainSettled = () => {
      for (const [nodeId, entry] of [...inflight.entries()]) {
        if (entry.result === undefined) continue
        inflight.delete(nodeId)
        const node = nodesById.get(nodeId)
        if (entry.result.kind === 'succeeded') {
          const record = {
            type: 'node_committed',
            node_id: nodeId,
            attempt: entry.attempt,
            exit_code: entry.result.exitCode,
          }
          if (typeof entry.result.output === 'string' && entry.result.output.length > 0) {
            record.output = entry.result.output
          }
          appendRecord(record)
        } else {
          appendRecord({
            type: 'node_failed',
            node_id: nodeId,
            attempt: entry.attempt,
            error: failureErrorMessage(entry.result),
            retryable: entry.attempt < node.max_attempts,
          })
        }
      }
    }

    const finish = (exitCode, terminalStatus, extra = {}) => ({
      exit_code: exitCode,
      terminal_status: terminalStatus,
      status: projection?.status ?? 'in_progress',
      run_id: runId,
      descriptor_hash: descriptor.descriptor_hash ?? null,
      epoch,
      waiting: projection?.waiting ?? [],
      projection,
      ...extra,
    })

    // ---- 推进循环 ----
    for (;;) {
      fence.heartbeat() // 推进期间刷新 lease（进程存活证据）。
      expireAgentWaitings()
      projection = projectGraph(descriptor, journal.readAll())
      if (projection.terminal_status !== null) {
        // 恢复已终结 run：幂等返回既有终态（cancelled 映射 1）。
        return finish(
          projection.terminal_status === 'completed'
            ? EXIT_CODES.OK
            : EXIT_CODES.FAILED_TERMINAL,
          projection.terminal_status,
        )
      }

      // ready-list 出队：concurrency_limit 闸在此（只限 command 并发子进程）。
      for (const item of projection.ready) {
        const node = nodesById.get(item.node_id)
        if (node.kind === 'human-approval') {
          appendRecord({ type: 'gate_waiting', node_id: node.id, prompt: node.prompt })
          continue
        }
        if (node.kind === 'agent') {
          appendRecord({ type: 'agent_pending', node_id: node.id, attempt: item.attempt })
          continue
        }
        if (inflight.has(node.id)) continue // 在飞 attempt 占预算，不重入
        if (inflight.size >= concurrencyLimit) continue
        appendRecord({ type: 'node_scheduled', node_id: node.id, attempt: item.attempt })
        const entry = { attempt: item.attempt, result: undefined, promise: null }
        entry.promise = executeCommandNode({
          descriptor,
          node,
          attempt: item.attempt,
          cwd: options.cwd ?? process.cwd(),
          extraEnv: options.env,
          spawnImpl,
          execFileImpl: options.execFileImpl,
        }).then((result) => {
          entry.result = result
        })
        inflight.set(node.id, entry)
      }

      if (inflight.size === 0) {
        projection = projectGraph(descriptor, journal.readAll())
        if (projection.waiting.length > 0) {
          // 首个等待点：同步推进终点（OQ2），状态已落 journal。
          emit({ type: 'run_parked', waiting: projection.waiting })
          return finish(EXIT_CODES.OK, null, { status: 'waiting' })
        }
        if (projection.status === 'completed') {
          appendRecord({ type: 'run_finished', terminal_status: 'completed' })
          projection = projectGraph(descriptor, journal.readAll())
          return finish(EXIT_CODES.OK, 'completed')
        }
        if (projection.status === 'failed') {
          appendRecord({ type: 'run_finished', terminal_status: 'failed' })
          projection = projectGraph(descriptor, journal.readAll())
          return finish(EXIT_CODES.FAILED_TERMINAL, 'failed')
        }
        // 无 ready/waiting/inflight 却未终结 = 调度停滞（DAG 内不应发生）：
        // fail-closed 终结 run，绝不空转。
        appendRecord({ type: 'run_finished', terminal_status: 'failed' })
        projection = projectGraph(descriptor, journal.readAll())
        return finish(EXIT_CODES.FAILED_TERMINAL, 'failed', {
          error: 'no schedulable work remaining but run is not terminal',
        })
      }

      // 等至少一个在飞子进程结算，再 FIFO 落账全部已结算项。
      await Promise.race([...inflight.values()].map((entry) => entry.promise))
      drainSettled()
    }
  } catch (error) {
    return mapRunFailure(error, runId, descriptor, epoch, projection)
  } finally {
    // 所有返回路径释放 fence（见文件头偏差声明）；进程崩溃由 stale 收割兜底。
    if (fence.held) {
      try {
        fence.release()
      } catch {
        // best-effort；释放失败遗留 lock 由 stale 判定收割。
      }
    }
  }
}

/** 失败 → 退出码映射（恒返回结果对象，绝不重抛；未知异常兜底 70）。 */
function mapRunFailure(error, runId, descriptor, epoch, projection) {
  const message = error instanceof Error ? error.message : String(error)
  let exitCode = EXIT_CODES.CRASH
  if (error instanceof FenceError) {
    exitCode = EXIT_CODES.FENCED_OUT
  } else if (error instanceof JournalCorruptionError) {
    exitCode = EXIT_CODES.CORRUPT_JOURNAL
  } else if (error instanceof DescriptorDriftError) {
    exitCode = EXIT_CODES.DESCRIPTOR_DRIFT
  } else if (error instanceof GraphSchedulerError) {
    exitCode = error.exitCode
  }
  return {
    exit_code: exitCode,
    terminal_status: null,
    status: projection?.status ?? 'in_progress',
    run_id: runId,
    descriptor_hash: descriptor.descriptor_hash ?? null,
    epoch,
    waiting: projection?.waiting ?? [],
    projection,
    error: message,
  }
}
