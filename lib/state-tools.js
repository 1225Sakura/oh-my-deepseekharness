// lib/state-tools.js
// 一期 dsh-native 改造（2026-11-16）：omd-state stdio MCP 子进程 → ctx.tools.register 进程内直注册。
// 单一来源不变：工具实现与 zod 输入 schema 仍由 lib/state/tools/*.mjs 的 registerXTools(env) 声明
// （原 MCP 绑定层原样保留）；本文件用收集器假 server 捕获 registerTool(name, meta, handler) 规格，
// 经 z.toJSONSchema 编译为宿主 defineTool 参数描述符后逐个 ctx.tools.register。
//
// 相比 MCP wire 面的体验增量：
// - cwd/sessionId 不再要求模型传入：execute 时从 exec.agent.session.header 自动派生
//   （cwd 保留为可选覆盖参数——多仓/worktree 锚场景显式传；sessionId 永不外露，杜绝跨会话冒名）；
// - 宿主对 args 先做 schema 校验（路径级违规信息），zod safeParse 保留精确校验语义；
// - 子进程/stdio/冒烟探针/reconnect/OMD_STATE_DIR env 传递整类故障域删除。
import { z } from 'zod'
import { registerStateTools as registerStateToolsMcp } from './state/tools/state.mjs'
import { registerNotepadTools } from './state/tools/notepad.mjs'
import { registerPrdTools } from './state/tools/prd.mjs'
import { registerHandoffTools } from './state/tools/handoff.mjs'
import { registerTeamTools } from './state/tools/team.mjs'
import { registerTraceTools } from './state/tools/trace.mjs'
import { registerEventsTools } from './state/tools/events.mjs'
import { registerHudTools } from './state/tools/hud.mjs'
import { registerGraphTools } from './state/tools/graph.mjs'
import { registerCodeIntelTools } from './state/tools/codeintel.mjs'

const REGISTRARS = [
  registerStateToolsMcp, registerNotepadTools, registerPrdTools, registerHandoffTools,
  registerTeamTools, registerTraceTools, registerEventsTools, registerHudTools,
  registerGraphTools, registerCodeIntelTools,
]

/**
 * 工具运行环境：与原 MCP server env 同形（工具模块契约不变；env 字符串中转已删）。
 * @param config 插件 Config（stateDir/codeIntel/team.staleAfterMs）
 */
export function buildEnv(config) {
  const teamStaleAfterMs = Number(config?.team?.staleAfterMs)
  return {
    stateDir: config?.stateDir ?? '.omd',
    codeIntel: config?.codeIntel ?? {},
    teamStaleAfterMs: Number.isFinite(teamStaleAfterMs) ? teamStaleAfterMs : undefined,
  }
}

/**
 * 收集器：假 server 捕获全部 registerTool 规格（名称/描述/zod 形状/处理器）。
 * 绑定层零改动——MCP SDK 的 registerTool 形态成为可替换传输缝。
 */
export function collectSpecs(env, registrars = REGISTRARS) {
  const specs = []
  const fakeServer = { registerTool: (name, meta, handler) => specs.push({ name, ...meta, handler }) }
  for (const register of registrars) register(fakeServer, env)
  return specs
}

/** MCP 处理器返回形态（jsonOut）→ 结构化值；非 content 形状原样透传（防御）。 */
function unwrapContent(res) {
  const text = res?.content?.find(b => b?.type === 'text')?.text
  if (typeof text !== 'string') return res
  try { return JSON.parse(text) } catch { return text }
}

/** JSON Schema 节点 → 宿主参数描述符（宽类型面；精确校验仍由 zod safeParse 执行）。 */
function nodeToDescriptor(node) {
  const { description, type, enum: enums, items, additionalProperties } = node ?? {}
  const desc = description ? { description } : {}
  if (typeof type === 'string') {
    if (type === 'string')
      return { type: 'string', ...(Array.isArray(enums) && enums.length > 0 ? { enum: enums } : {}), ...desc }
    if (type === 'number' || type === 'integer') return { type: 'number', ...desc }
    if (type === 'boolean') return { type: 'boolean', ...desc }
    if (type === 'array')
      return { type: 'array', ...(items ? { items: nodeToDescriptor(items) } : {}), ...desc }
    if (type === 'object' && additionalProperties === false && node.properties) {
      const properties = {}
      for (const [k, v] of Object.entries(node.properties)) properties[k] = nodeToDescriptor(v)
      return { type: 'object', properties, additionalProperties: true, ...desc }
    }
  }
  return { type: 'json', ...desc } // 联合/record/未知形态一律任意 JSON 值
}

/**
 * zod 形状 → 宿主参数描述符表 + json 形态键清单。
 * - sessionId 剔除（execute 自动派生，模型面不可见——所有权冒名整类消除）；
 * - cwd 降为可选覆盖（缺省=会话工作区锚）；
 * - required 面随剔除/降级同步收缩；
 * - jsonKeys = type:'json' 的参数键（宿主/客户端链路会把嵌套对象字符串化传输——
 *   上游同款怪癖，state.mjs 绑定层注释「有意修正 OMC 字符串传输怪癖」的 DSH 重现，
 *   execute 侧须宽容 parse）。
 */
export function shapeToParameters(shape) {
  const jsonSchema = z.toJSONSchema(z.object(shape), { io: 'input', unrepresentable: 'any' })
  const required = new Set(jsonSchema.required ?? [])
  const parameters = {}
  const jsonKeys = []
  for (const [key, node] of Object.entries(jsonSchema.properties ?? {})) {
    if (key === 'sessionId') continue
    if (key === 'cwd') {
      parameters[key] = { type: 'string', description: '工作区绝对路径锚；缺省=当前会话工作区（多仓/worktree 场景显式传）' }
      continue
    }
    const base = nodeToDescriptor(node)
    if (base.type === 'json') jsonKeys.push(key)
    parameters[key] = required.has(key) ? { ...base, required: true } : base
  }
  return { parameters, jsonKeys }
}

/** 通用输出 render：字符串原样（hud 卡面），其余紧凑 JSON。 */
function renderSpecValue(_args, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null)
  return [{ type: 'text', text }]
}

/** 单个收集规格 → 宿主 defineTool（自动派生 + 双层校验 + jsonOut 解包 + 字符串化参数宽容 parse）。 */
function toNativeTool(spec, defineTool) {
  const zodShape = z.object(spec.inputSchema)
  const { parameters, jsonKeys } = shapeToParameters(spec.inputSchema)
  const jsonKeySet = new Set(jsonKeys)
  // 上游同款怪癖修正（state.mjs「OMC 字符串传输怪癖」DSH 重现）：json 形态参数若以
  // 字符串到达（客户端链路字符串化嵌套对象），先尝试 parse；parse 失败原样保留——
  // 让 zod 给出精确的类型报错，绝不静默吞掉畸形载荷。
  const coerce = (args) => {
    const out = { ...args }
    for (const key of jsonKeySet) {
      const v = out[key]
      if (typeof v === 'string') {
        const s = v.trim()
        if (s.startsWith('{') || s.startsWith('[')) {
          try { out[key] = JSON.parse(s) } catch { /* 保留原串，交给 zod 报精确错误 */ }
        }
      }
    }
    return out
  }
  return defineTool({
    name: `omd_${spec.name}`,
    description: spec.description,
    parameters,
    output: { schema: { type: 'json' }, render: renderSpecValue },
    async execute(args, exec) {
      const header = exec?.agent?.session?.header
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : header?.cwd
      if (typeof cwd !== 'string' || cwd.length === 0)
        throw new Error(`omd_${spec.name}: 无法确定工作区锚——当前会话未携带 cwd 且未显式传 cwd 参数`)
      const callArgs = coerce({ ...args, cwd, sessionId: header?.id })
      const parsed = zodShape.safeParse(callArgs)
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('；')
        throw new Error(`omd_${spec.name}: 参数校验失败——${issues}`)
      }
      const value = unwrapContent(await spec.handler(parsed.data))
      return value === undefined ? null : value
    },
  })
}

/**
 * 注册全部 58 个状态面工具（进程内）。任一注册失败整体抛错（调用方降级记 probeReport）。
 * @returns { count, tools } 注册计数与工具名清单（probe/doctor 消费）
 */
export async function registerStateTools(ctx, defineTool, opts = {}) {
  const specs = collectSpecs(buildEnv(opts.config))
  const tools = []
  for (const spec of specs) {
    ctx.tools.register(toNativeTool(spec, defineTool))
    tools.push(`omd_${spec.name}`)
  }
  return { count: tools.length, tools }
}
