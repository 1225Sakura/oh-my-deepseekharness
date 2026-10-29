// mcp-server/index.mjs
// omd 自带 stdio MCP server（规格 §5.2）。启动方式：process.execPath index.mjs
// 环境变量：OMD_STATE_DIR（默认 .omd）；OMD_CODE_INTEL（插件 Config codeIntel 段 JSON：
//   astGrep 开关 + lspServers 注册表，lib/index.js 挂载时注入）；每工具调用经参数传 cwd/sessionId。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerStateTools } from './tools/state.mjs'
import { registerNotepadTools } from './tools/notepad.mjs'
import { registerPrdTools } from './tools/prd.mjs'
import { registerHandoffTools } from './tools/handoff.mjs'
import { registerTeamTools } from './tools/team.mjs'
import { registerTraceTools } from './tools/trace.mjs'
import { registerEventsTools } from './tools/events.mjs'
import { registerHudTools } from './tools/hud.mjs'
import { registerGraphTools } from './tools/graph.mjs'
import { registerCodeIntelTools } from './tools/codeintel.mjs'

const server = new McpServer({ name: 'omd-state', version: '0.1.0' })
let codeIntel = {}
try { codeIntel = JSON.parse(process.env.OMD_CODE_INTEL || '{}') } catch { codeIntel = {} }
// R3-⑩：team stale 阈值注入（getStatus 的 per-mode stale 判定用；缺省 300000）
const teamStaleAfterMs = Number(process.env.OMD_TEAM_STALE_MS)
const env = { stateDir: process.env.OMD_STATE_DIR || '.omd', codeIntel, teamStaleAfterMs: Number.isFinite(teamStaleAfterMs) ? teamStaleAfterMs : undefined }
registerStateTools(server, env)
registerNotepadTools(server, env)
registerPrdTools(server, env)
registerHandoffTools(server, env)
registerTeamTools(server, env)
registerTraceTools(server, env)
registerEventsTools(server, env) // W1-1 生态补全：events.jsonl 只读审计面
registerHudTools(server, env)
registerGraphTools(server, env)
registerCodeIntelTools(server, env)
await server.connect(new StdioServerTransport())
