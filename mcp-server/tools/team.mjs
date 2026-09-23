// mcp-server/tools/team.mjs
// c5/c6/c8 接线面（M3 A 路径）：把 lib/{worktree,runstate,multirepo}.js 的库能力
// 暴露为 omd-state MCP 工具，供 team SKILL 队长 subagent 调——
// 队长在五阶段过渡中用 `team_begin` 建工作树（c5），每次阶段变化用 `team_write_mirror`
// 写 run-state 快照（c6），关闭时用 `team_dispose` 两阶段拆除（c5）。
// 路径在 c5 运行树内时自动走 c8 树内锚定（multirepo.writeTreeRunState）；非运行树走主仓。
import { z } from 'zod'
import { beginTeamRun, disposeRunWorktree, scanOrphans } from '../../lib/worktree.js'
import { writeRunStateMirror, buildMirrorPatch, buildTodoSummary } from '../../lib/runstate.js'
import { writeTreeRunState } from '../../lib/multirepo.js'
import { makeNotepadTools } from './notepad.mjs'
import {
  transitionPhasePersist, readPhaseState,
  registerWorker, updateWorker, heartbeatWorker, readRegistry,
  sendMail, readMail, ackMail, scanHeartbeat, buildMergePlan,
  MAIL_DIRECTIONS, MAIL_TYPES, WORKER_STATUSES, TEAM_PHASES, TEAM_TERMINAL,
} from '../../lib/team.js'

export function makeTeamTools(env) {
  /**
   * notepad stats 取数（B5 修订）：caller 显式传 stateDir 时走 caller 的 stateDir，
   * 否则走 env.stateDir。这样 todo 数据源与 run-state 写位置在同一目录，
   * 避免 c5 树内 cwd 与主仓 run-state.json 跨仓不一致。
   */
  function notepadStats(cwd, stateDir) {
    const sd = stateDir ?? env.stateDir
    return makeNotepadTools({ stateDir: sd }).stats({ cwd })
  }

  async function begin({ cwd, runId, stateDir = '.omd' }) {
    const r = await beginTeamRun({ cwd, runId, stateDir })
    return { ...r, orphans: r.orphans.map(o => o.runId), orphanLines: r.orphanLines }
  }

  async function dispose({ cwd, runId, stateDir = '.omd', reason = 'verified', expectUpdatedAt }) {
    return await disposeRunWorktree({ cwd, runId, stateDir, reason, expectUpdatedAt })
  }

  async function scanOrphansTool({ cwd, stateDir = '.omd' }) {
    const r = await scanOrphans({ cwd, stateDir })
    return { orphans: r.orphans, lines: r.lines }
  }

  /**
   * 阶段边界 / 派发前快照写（c6 唯一入口）。
   * patch 经 buildMirrorPatch 构造七字段镜像键，writeRunStateMirror 内做 CAS + 重试 + 覆盖写兜底。
   * todo 字段可由调用方显式传，否则从 cwd 的 notepad stats 自动取（stateDir 透传，与 run-state 同位置）。
   */
  async function writeMirror({ cwd, stateDir = '.omd', patch = {}, expectUpdatedAt, retries = 3 }) {
    const todo = patch.todo ?? buildTodoSummary({ stats: await notepadStats(cwd, stateDir) })
    const mirrorPatch = buildMirrorPatch({ ...patch, todo })
    return await writeRunStateMirror({ cwd, stateDir, patch: mirrorPatch, expectUpdatedAt, retries })
  }

  /**
   * 树内任意状态写（c8 接线面）：仅在 c5 运行树内可用；非运行树抛错。
   * 写 `<tree>/.omd/<rel>`，懒创建树内 .omd。
   */
  async function writeTreeState({ cwd, rel, data, stateDir = '.omd' }) {
    return await writeTreeRunState({ startDir: cwd, rel, data, stateDir })
  }

  return {
    begin, dispose, scanOrphansTool, writeMirror, writeTreeState,
    // ---- v0.4 领队运行时面（lib/team.js 接线）----
    phaseTransition: ({ cwd, runId, to, note, stateDir = '.omd' }) =>
      transitionPhasePersist({ cwd, runId, to, note, stateDir }),
    phaseStatus: ({ cwd, runId, stateDir = '.omd' }) => readPhaseState(cwd, runId, stateDir),
    registerWorker: ({ cwd, runId, worker, stateDir = '.omd' }) =>
      registerWorker({ cwd, runId, worker, stateDir }),
    workerUpdate: ({ cwd, runId, workerId, patch, stateDir = '.omd' }) =>
      updateWorker({ cwd, runId, workerId, patch, stateDir }),
    workerHeartbeat: ({ cwd, runId, workerId, stateDir = '.omd' }) =>
      heartbeatWorker({ cwd, runId, workerId, stateDir }),
    registry: ({ cwd, runId, stateDir = '.omd' }) => readRegistry(cwd, runId, stateDir),
    mailSend: ({ cwd, runId, direction, workerId, type, text, from, stateDir = '.omd' }) =>
      sendMail({ cwd, runId, direction, workerId, type, text, from, stateDir }),
    mailRead: ({ cwd, runId, direction, workerId, unackedOnly, stateDir = '.omd' }) =>
      readMail({ cwd, runId, direction, workerId, unackedOnly, stateDir }),
    mailAck: ({ cwd, runId, direction, workerId, seqs, stateDir = '.omd' }) =>
      ackMail({ cwd, runId, direction, workerId, seqs, stateDir }),
    heartbeatScan: ({ cwd, runId, staleAfterMs, stateDir = '.omd' }) =>
      scanHeartbeat({ cwd, runId, staleAfterMs, stateDir }),
    mergePlan: ({ cwd, runId, stateDir = '.omd' }) => buildMergePlan({ cwd, runId, stateDir }),
  }
}

export function registerTeamTools(server, env) {
  const t = makeTeamTools(env)
  const jsonOut = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }] })
  const cwdRunId = { cwd: z.string(), runId: z.string() }

  server.registerTool('team_begin', {
    description: 'c5 team worktree 隔离：建 `<stateDir>/worktrees/{run-id}`（gitignored），孤儿扫描 + 启动写 run-state active v1',
    inputSchema: { ...cwdRunId, stateDir: z.string().optional() },
  }, async a => jsonOut(await t.begin(a)))

  server.registerTool('team_dispose', {
    description: 'c5 两阶段拆除：先 CAS 写 disposed 终态 → 再删树（CAS 不成功绝不删）',
    inputSchema: { ...cwdRunId, stateDir: z.string().optional(), reason: z.string().optional(), expectUpdatedAt: z.string().optional() },
  }, async a => jsonOut(await t.dispose(a)))

  server.registerTool('team_scan_orphans', {
    description: 'c5 孤儿扫描：崩溃遗留（非终态无活跃会话）→ 报告且绝不自动删',
    inputSchema: { cwd: z.string(), stateDir: z.string().optional() },
  }, async a => jsonOut(await t.scanOrphansTool(a)))

  server.registerTool('team_write_mirror', {
    description: 'c6 run-state 快照写：五要素镜像 + version + updatedAt；CAS 冲突重读 ≤3 次，预算耗尽覆盖写',
    inputSchema: {
      cwd: z.string(),
      stateDir: z.string().optional(),
      patch: z.record(z.any()).optional(),
      expectUpdatedAt: z.string().optional(),
      retries: z.number().optional(),
    },
  }, async a => jsonOut(await t.writeMirror(a)))

  server.registerTool('team_write_tree_state', {
    description: 'c8 树内状态写：仅在 c5 运行树内可用，懒创建 <tree>/.omd；非运行树抛错',
    inputSchema: { cwd: z.string(), rel: z.string(), data: z.record(z.any()), stateDir: z.string().optional() },
  }, async a => jsonOut(await t.writeTreeState(a)))

  // ---- v0.4 领队运行时（lib/team.js）：阶段状态机 / 队员生命周期 / mailbox / heartbeat / merge plan ----
  const runBase = { cwd: z.string(), runId: z.string(), stateDir: z.string().optional() }

  server.registerTool('team_phase_transition', {
    description: 'team 阶段迁移（状态机校验）：team-plan→prd→exec→verify→fix(≤3)→complete/failed/cancelled；非法迁移显式拒绝',
    inputSchema: { ...runBase, to: z.enum([...TEAM_PHASES, ...TEAM_TERMINAL]), note: z.string().optional() },
  }, async a => jsonOut(await t.phaseTransition(a)))

  server.registerTool('team_phase_status', {
    description: '读 team 阶段状态（phase/fixLoops/history）',
    inputSchema: runBase,
  }, async a => jsonOut(await t.phaseStatus(a)))

  server.registerTool('team_register_worker', {
    description: '登记队员生命周期（实际 spawn 由领队经 omd_delegate/subagent 完成后调用本工具落账；workerId 省略自动生成 w-<uuid8>）',
    inputSchema: {
      ...runBase,
      worker: z.object({
        workerId: z.string().optional(), dispatchId: z.string().optional(), agentId: z.string().optional(),
        role: z.string(), tier: z.string().optional(), phase: z.string().optional(),
        spawnedAt: z.string().optional(), note: z.string().optional(),
      }),
    },
  }, async a => jsonOut(await t.registerWorker(a)))

  server.registerTool('team_worker_update', {
    description: '更新队员状态（状态迁移校验：dispatched→running→blocked/done/failed；终态不可复活）',
    inputSchema: {
      ...runBase, workerId: z.string(),
      patch: z.object({
        status: z.enum(WORKER_STATUSES).optional(), note: z.string().optional(),
        agentId: z.string().optional(), dispatchId: z.string().optional(), phase: z.string().optional(),
      }),
    },
  }, async a => jsonOut(await t.workerUpdate(a)))

  server.registerTool('team_worker_heartbeat', {
    description: '队员心跳（复位 lastHeartbeatAt 与 stale 标记；终态队员拒绝）',
    inputSchema: { ...runBase, workerId: z.string() },
  }, async a => jsonOut(await t.workerHeartbeat(a)))

  server.registerTool('team_registry', {
    description: '读队员 registry（runId=owner-epoch 的 UUID 生命周期台账）',
    inputSchema: runBase,
  }, async a => jsonOut(await t.registry(a)))

  server.registerTool('team_mail_send', {
    description: 'mailbox 发信：in=队员→领队（progress/blocker/done/question），out=领队→队员（nudge/assign/answer）',
    inputSchema: {
      ...runBase, direction: z.enum(MAIL_DIRECTIONS), workerId: z.string(),
      type: z.string(), text: z.string(), from: z.string().optional(),
    },
  }, async a => jsonOut(await t.mailSend(a)))

  server.registerTool('team_mail_read', {
    description: 'mailbox 读信（direction 省略双向；unackedOnly 只回未 ack）',
    inputSchema: {
      ...runBase, direction: z.enum(MAIL_DIRECTIONS).optional(), workerId: z.string().optional(),
      unackedOnly: z.boolean().optional(),
    },
  }, async a => jsonOut(await t.mailRead(a)))

  server.registerTool('team_mail_ack', {
    description: 'mailbox ack 标记（领队处置完 blocker/question 后 ack）',
    inputSchema: { ...runBase, direction: z.enum(MAIL_DIRECTIONS), workerId: z.string(), seqs: z.array(z.number().int()) },
  }, async a => jsonOut(await t.mailAck(a)))

  server.registerTool('team_heartbeat_scan', {
    description: 'heartbeat 扫描：超时未心跳队员标 stale（绝不自动杀）+ 未 ack blocker/question 汇总——检测与呈面，催促由领队 send_message 执行',
    inputSchema: { ...runBase, staleAfterMs: z.number().int().optional() },
  }, async a => jsonOut(await t.heartbeatScan(a)))

  server.registerTool('team_merge_plan', {
    description: 'merge 计划（merge-orchestrator MVP）：树∩主仓冲突候选 + 建议合并序；只生成计划不执行合并',
    inputSchema: runBase,
  }, async a => jsonOut(await t.mergePlan(a)))
}
