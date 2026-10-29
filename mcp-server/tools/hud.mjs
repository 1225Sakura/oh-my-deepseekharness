// mcp-server/tools/hud.mjs
// c4 HUD server 面（v0.4 P2-D 第一步）：把 lib/hud.js 的五要素契约暴露为 MCP 工具——
// 模型调 hud_render 即得至多 8 行中文摘要卡文本，无需 client half 即可落地「HUD 可见性」。
// 数据源=state_get_status + notepad_stats 两个现成读面；P1-W4-1（team eco-completion）起
// 增第三读面：run-state.json 镜像回退——轮次/故事/代理在 state 派生缺席时补值并标
// roundSource/storySource/agentsSource='mirror'，治「关键字段全靠模型自觉 state_write」
// 的结构性缺口（共识计划 W4-1）。mode 空闲时随新鲜镜像补值并标 modeSource（state 是模式
// 在场唯一权威；R5 评审：注释曾写「永不被覆盖」与已测行为矛盾，已按实现更正）。
import { z } from 'zod'
import { summarize, renderCard, buildHudView, createSummaryReader } from '../../lib/hud.js'
import { makeStateTools } from './state.mjs'
import { makeNotepadTools } from './notepad.mjs'
import { readJson } from '../lib/atomic.mjs'
import { runStatePath } from '../../lib/worktree.js'

/**
 * W4-1 mirror 回退读（纯函数，hud-route.js 同源复用）：
 * state 派生的轮次/故事/代理缺席 → 以 run-state 七字段镜像补值并标来源键；字段齐或零
 * mirror → 原样返回（无来源键=「有 state 无 mirror=现状」四态口径）。
 */
export const MIRROR_FRESH_MS = 2 * 60 * 60 * 1000 // 新鲜度窗：>2h 的镜像视为陈旧整体忽略（不误导 idle 页）

export function applyMirrorFallback(summary, mirror, now = Date.now()) {
  if (!mirror || typeof mirror !== 'object') return summary
  const age = now - Date.parse(mirror.updatedAt ?? '')
  if (!Number.isFinite(age) || age < 0 || age > MIRROR_FRESH_MS) return summary // 陈旧/坏时间戳 → 不误导
  const out = { ...summary }
  const src = {}
  // 无任何活跃模式（模型从未 state_write）→ mode 也随新鲜镜像补（镜像由 team 运行时在阶段边界写，可信）
  if ((!out.mode || out.mode === 'idle') && mirror.mode) { out.mode = mirror.mode; src.modeSource = 'mirror' }
  if (out.round == null && mirror.round != null) { out.round = mirror.round; src.roundSource = 'mirror' }
  if (out.story == null && mirror.current_story != null) { out.story = mirror.current_story; src.storySource = 'mirror' }
  const ma = Array.isArray(mirror.active_agents) ? mirror.active_agents : []
  // 注意（文档化权衡，R5 评审）：summarize 把「缺席/空数组」折叠为 0——模型显式上报
  // active_agents:[] 会被当缺席由镜像补值（round/story 用 == null 尊重显式值）。根治需改
  // summarize 输出形状（波及 diffSummary 消费面），本轮接受为权衡并在此留痕。
  if (!out.agents && ma.length) { out.agents = ma.length; src.agentsSource = 'mirror' }
  return Object.keys(src).length ? { ...out, ...src } : out
}

/** run-state.json 只读（缺席/坏 JSON → null 不炸；读面容错同 events readEvents 口径）。 */
export async function readMirrorRunState(env, cwd) {
  try { return await readJson(runStatePath(cwd, env?.stateDir ?? '.omd'), null) } catch { return null }
}

export function makeHudTools(env) {
  const stateTools = makeStateTools(env)
  const notepadTools = makeNotepadTools(env)
  return {
    /** 渲染 HUD 编排状态卡（中文摘要卡，至多 8 行）。恒返回恰 {summary, card} 二键（AC6）。 */
    async render({ cwd }) {
      const [view, mirror] = await Promise.all([
        buildHudView({
          status: await stateTools.getStatus({ cwd }),
          stats: await notepadTools.stats({ cwd }),
        }),
        readMirrorRunState(env, cwd),
      ])
      // W4-1：mirror 回退后 summary 进卡（轮次/故事行不再纯依赖模型自觉上报）
      const summary = applyMirrorFallback(view.summary, mirror)
      // lastActivity 并入 detail 供 renderCard 空态「上次活动」行消费（HUD 重设计 R1）
      return { summary, card: renderCard(summary, { ...view.detail, lastActivity: view.lastActivity }) }
    },
    /** 只回五要素 JSON（client half / 机器消费面）。 */
    async summary({ cwd }) {
      const read = createSummaryReader({ stateTools, notepadTools, cwd })
      const [base, mirror] = await Promise.all([read(), readMirrorRunState(env, cwd)])
      return applyMirrorFallback(base, mirror)
    },
  }
}

export function registerHudTools(server, env) {
  const t = makeHudTools(env)
  const jsonOut = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }] })
  const base = { cwd: z.string() }
  server.registerTool('hud_render', {
    description: 'HUD 编排状态卡渲染：中文摘要卡（至多 8 行：任务句/模式·阶段/PRD 进度/轮次/记忆，空态含上次活动与启动提示）+ summary JSON；数据源=state_get_status+notepad_stats（+run-state 镜像回退 W4-1）',
    inputSchema: base,
  }, async a => jsonOut(await t.render(a)))
  server.registerTool('hud_summary', {
    description: 'c4 HUD 五要素 JSON（机器消费面；renderCard 的契约对象）',
    inputSchema: base,
  }, async a => jsonOut(await t.summary(a)))
}

// summarize 透传（测试与文档的单一来源锚点）
export { summarize }
