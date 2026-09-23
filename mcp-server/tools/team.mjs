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

  return { begin, dispose, scanOrphansTool, writeMirror, writeTreeState }
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
}
