// mcp-server/tools/events.mjs
// W1-1（ralplan 生态补全 P0 证明面）：events.jsonl 只读 MCP 工具。
// 背景：events.jsonl（派发审计 route/fallback 1:1）此前唯一读面是 HUD 路由（lib/hud-route.js），
// MCP 侧无读工具（2026-10-26 审查「读写不对称」）——本文件补齐对账读侧。
// 复用 lib/events.js 的 readEvents（尾部窗口 64KiB + 坏行容错）与 aggregateEvents（route/fallback
// 聚合），此处仅做 MCP 接线与 {tail, kind} 过滤；写路径（withFileLock）归 delegate 派发点，不动。
import { z } from 'zod'
import { readEvents, aggregateEvents, EVENT_KINDS, DEFAULT_EVENTS_WINDOW_BYTES } from '../../lib/events.js'
import { assertSafeCwd } from '../lib/paths.mjs'

export function makeEventsTools(env) {
  /**
   * kind 过滤先于 tail：tail 语义 = 「过滤视图的尾部 N 条」。
   * aggregate 恒对全窗计算（不受 kind/tail 影响）——route:fallback 1:1 对账要看全景。
   * _corrupt 坏行原样保留在未过滤视图（行号供审计），kind 过滤天然排除。
   */
  async function read({ cwd, tail, kind, stateDir }) {
    assertSafeCwd(cwd)
    const sd = stateDir ?? env.stateDir
    const events = await readEvents({ cwd, stateDir: sd, maxBytes: DEFAULT_EVENTS_WINDOW_BYTES })
    const filtered = kind ? events.filter(e => e.kind === kind) : events
    const total = filtered.length
    const n = Number.isFinite(tail) && tail > 0 ? Math.floor(tail) : undefined
    const list = n !== undefined ? filtered.slice(-n) : filtered
    return {
      events: list,
      totalInWindow: total,
      returned: list.length,
      truncated: n !== undefined && total > list.length,
      aggregate: aggregateEvents(events),
    }
  }
  return { read }
}

export function registerEventsTools(server, env) {
  const t = makeEventsTools(env)
  const jsonOut = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }] })
  server.registerTool('events_read', {
    description: 'events.jsonl 只读（派发审计面）：tail 尾部 N 条 + kind 过滤（route/fallback），附聚合（route:fallback 1:1 可对账）',
    inputSchema: {
      cwd: z.string(),
      tail: z.number().int().positive().optional(),
      kind: z.enum([...EVENT_KINDS]).optional(),
      stateDir: z.string().optional(),
    },
  }, async a => jsonOut(await t.read(a)))
}
