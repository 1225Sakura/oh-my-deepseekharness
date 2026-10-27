// mcp-server/tools/hud.mjs
// c4 HUD server 面（v0.4.0 P2-D 第一步）：把 lib/hud.js 的五要素契约暴露为 MCP 工具——
// 模型调 hud_render 即得至多 8 行中文摘要卡文本，无需 client half 即可落地「HUD 可见性」。
// 数据源严格只有 state_get_status + notepad_stats 两个现成读面（lib/hud.js 设计约束）。
import { z } from 'zod'
import { summarize, renderCard, buildHudView, createSummaryReader } from '../../lib/hud.js'
import { makeStateTools } from './state.mjs'
import { makeNotepadTools } from './notepad.mjs'

export function makeHudTools(env) {
  const stateTools = makeStateTools(env)
  const notepadTools = makeNotepadTools(env)
  return {
    /** 渲染 HUD 编排状态卡（中文摘要卡，至多 8 行）。恒返回恰 {summary, card} 二键（AC6）。 */
    async render({ cwd }) {
      const view = buildHudView({
        status: await stateTools.getStatus({ cwd }),
        stats: await notepadTools.stats({ cwd }),
      })
      // lastActivity 并入 detail 供 renderCard 空态「上次活动」行消费（HUD 重设计 R1）
      return { summary: view.summary, card: renderCard(view.summary, { ...view.detail, lastActivity: view.lastActivity }) }
    },
    /** 只回五要素 JSON（client half / 机器消费面）。 */
    async summary({ cwd }) {
      const read = createSummaryReader({ stateTools, notepadTools, cwd })
      return await read()
    },
  }
}

export function registerHudTools(server, env) {
  const t = makeHudTools(env)
  const jsonOut = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }] })
  const base = { cwd: z.string() }
  server.registerTool('hud_render', {
    description: 'HUD 编排状态卡渲染：中文摘要卡（至多 8 行：任务句/模式·阶段/PRD 进度/轮次/记忆，空态含上次活动与启动提示）+ summary JSON；数据源=state_get_status+notepad_stats',
    inputSchema: base,
  }, async a => jsonOut(await t.render(a)))
  server.registerTool('hud_summary', {
    description: 'c4 HUD 五要素 JSON（机器消费面；renderCard 的契约对象）',
    inputSchema: base,
  }, async a => jsonOut(await t.summary(a)))
}

// summarize 透传（测试与文档的单一来源锚点）
export { summarize }
