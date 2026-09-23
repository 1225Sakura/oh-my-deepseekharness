// mcp-server/index.mjs
// omd 自带 stdio MCP server（规格 §5.2）。启动方式：process.execPath index.mjs
// 环境变量：OMD_STATE_DIR（默认 .omd）；每工具调用经参数传 cwd/sessionId。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerStateTools } from './tools/state.mjs'
import { registerNotepadTools } from './tools/notepad.mjs'
import { registerPrdTools } from './tools/prd.mjs'
import { registerHandoffTools } from './tools/handoff.mjs'
import { registerTeamTools } from './tools/team.mjs'

const server = new McpServer({ name: 'omd-state', version: '0.1.0' })
const env = { stateDir: process.env.OMD_STATE_DIR || '.omd' }
registerStateTools(server, env)
registerNotepadTools(server, env)
registerPrdTools(server, env)
registerHandoffTools(server, env)
registerTeamTools(server, env)
await server.connect(new StdioServerTransport())
