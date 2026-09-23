// lib/delegate.js
// c1 实现（M3，台账 m3-advance S8）：omd_delegate 硬路由工具——档位/model 参数经
// 宿主 ctx.subagents spawn 路径强制生效（区别于 subagent 工具的软路由继承，规格 §7-5）。
// - C1 前置：Config 档位表 id 已对齐部署 LLM（config.js 默认 glm-5.3-flash）；派发前经
//   llm.resolveCallConfig 校验路由，不可用 id 显式报错，绝不静默继承
// - C3 联动：档位路由复用 c3 routeOnce（表上限钳制只降不升 + fallback 审计 + dispatch id
//   键控 1:1 日志行）；显式 model 是档位空间之外的一等硬指定，不经档位表
// - 参考宿主 @deepseek-ai/dsh-tool-subagent 的 spawn 请求构造（label/prompt/parent/
//   agentOptions/signal），前台一次性派发并释放 run
import { isAbsolute, join } from 'node:path'
import { TIER_ORDER, buildRoutingTable, routeOnce, recordFallback, fmtLog } from './routing.js'
import { resolveModel } from './config.js'

/** 宿主默认 in-process spawn 后端注册名（dsh-subagent-spawn-in-process providerName）。 */
export const DELEGATE_PROVIDER = 'spawn'

/**
 * 读取调用代理的派发继承路由（provider/model/reasoningEffort）。
 * 镜像 @deepseek-ai/dsh-subagent 的 parentAgentOptionsForDelegation（纯属性读，无身份/实例
 * 依赖）：最新请求头的 config 持有请求时选定的 provider/model；创建 options 是首次请求前的
 * 回退。omd 不解析 @deepseek-ai/dsh-subagent（非 peer 依赖），子代理合并仍由宿主服务内
 * 的 resolveChildAgentOptions 完成——本函数只服务于 omd_delegate 的派发前路由校验。
 */
export function parentRouteForDelegation(parent) {
  const requestConfig = parent?.session?.requestHeader?.()?.config
  if (requestConfig === undefined) return { ...(parent?.options ?? {}) }
  const { provider: _p, model: _m, reasoningEffort: _e, ...createdOptions } = parent?.options ?? {}
  return {
    ...createdOptions,
    provider: requestConfig.provider,
    model: requestConfig.model,
    ...(requestConfig.reasoningEffort === undefined ? {} : { reasoningEffort: requestConfig.reasoningEffort }),
  }
}

/**
 * 派发路由判定（纯函数，恰一次）：档位路径复用 c3 routeOnce；显式 model 路径绕过档位表。
 * @returns {dispatchId, role, tableTier, suggestedTier, tier, clamped, fallback, explicit, modelId, logLine}
 *   explicit-model 路径 tier=null（档位语义不适用）；无 role 的档位路径无表可钳（表上限按角色键控）。
 */
export function resolveDispatch({ config, table, args, dispatchId }) {
  if (!dispatchId) throw new Error('omd_delegate: dispatchId 必填')
  const tier = args?.tier
  if (tier !== undefined && !TIER_ORDER.includes(tier))
    throw new Error(`omd_delegate: tier 无效: ${String(tier)}（合法: ${TIER_ORDER.join('/')}）`)
  const role = typeof args?.role === 'string' && args.role.length > 0 ? args.role : null
  const model = args?.model
  const explicitModel = typeof model === 'string' && model.length > 0 ? model : undefined
  if (explicitModel === undefined && model !== undefined)
    throw new Error('omd_delegate: model 为空串——显式指定 model 时必须非空（省略即走档位路径）')
  if (args?.provider !== undefined && explicitModel === undefined)
    throw new Error('omd_delegate: provider 必须与 model 一起提供（档位路径自动解析 provider）')
  const defaultTier = config?.routing?.defaultTier ?? 'medium'
  if (explicitModel !== undefined) {
    const d = { dispatchId, role, tableTier: null, suggestedTier: null, tier: null, clamped: false, fallback: false, explicit: true, modelId: explicitModel }
    return { ...d, logLine: `[routing] dispatch=${dispatchId} role=${role ?? 'none'} explicit model=${explicitModel}` }
  }
  const requested = tier ?? defaultTier
  if (role !== null) {
    const route = routeOnce({ table, role, suggestedTier: requested, dispatchId, defaultTier })
    return { ...route, explicit: false, modelId: undefined }
  }
  const d = { dispatchId, role: null, tableTier: null, suggestedTier: requested, tier: requested, clamped: false, fallback: false, explicit: false, modelId: undefined }
  return { ...d, logLine: fmtRouteLog(d) }
}

/** c3 路由日志行同款格式（复用 routing.js fmtLog——单一来源，杜绝格式漂移）。 */
const fmtRouteLog = d => fmtLog({ ...d, role: d.role ?? 'none' })

/** 工具输出 schema：每次调用新对象（memory 工具同款纪律——不共享引用防闭包污染）。 */
function delegateOutputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean' },
      dispatchId: { type: 'string' },
      role: { type: 'string' },
      tier: { type: 'string' },
      model: { type: 'string' },
      provider: { type: 'string' },
      clamped: { type: 'boolean' },
      fallback: { type: 'boolean' },
      logLine: { type: 'string' },
      text: { type: 'string' },
    },
  }
}

/** 输出渲染：路由判定头一行 + 子代理最终文本（ContentBlock[] 契约）。 */
function renderDelegate(args, value) {
  if (!value || value.ok !== true)
    return [{ type: 'text', text: `omd_delegate 派发失败：dispatchId=${value?.dispatchId ?? ''}` }]
  return [{ type: 'text', text: `${value.logLine}\n${value.text ?? ''}` }]
}

/** cordis 安全取服务：ctx.get 是运行时取面（tool-subagent 同款，未 inject 也可取）；缺席归 undefined。 */
function tryGet(ctx, name) {
  if (typeof ctx?.get === 'function') {
    try { return ctx.get(name) } catch { /* 落到属性访问兜底 */ }
  }
  try { return ctx[name] } catch { return undefined }
}

/**
 * 注册 omd_delegate 工具。ctx.subagents 缺席时抛错（调用方降级记 probeReport）。
 * @param opts.config 插件 Config（档位表/defaultTier/stateDir）
 * @param opts.roles 角色卡清单（建 c3 路由表，与协议「模型路由表」同源）
 * @param opts.subagents 测试注入 ctx.subagents
 * @param opts.llm 测试注入 llm 服务（省则运行时 tryGet）
 */
export async function registerDelegateTool(ctx, defineTool, opts = {}) {
  const config = opts.config
  if (!config) throw new Error('delegate: config 必填（档位表/默认档来源）')
  const subagents = opts.subagents ?? tryGet(ctx, 'subagents')
  if (!subagents || typeof subagents.start !== 'function')
    throw new Error('delegate: ctx.subagents 服务缺席（宿主未挂载 subagent 缝），omd_delegate 不可用')
  const table = buildRoutingTable(opts.roles ?? [])
  const stateRoot = () => {
    const sd = config.stateDir ?? '.omd'
    return isAbsolute(sd) ? sd : join(process.cwd(), sd)
  }
  let seq = 0

  ctx.tools.register(defineTool({
    name: 'omd_delegate',
    description: '硬路由派发子代理：tier/model 参数经 spawn 路径强制生效（subagent 工具是软路由继承）。'
      + 'tier 经档位表映射并受角色表上限钳制（只降不升）；model 显式指定模型 id（可与 provider 同给）。'
      + '不可解析 id 派发前显式报错，不静默继承。前台一次性派发，返回子代理最终输出与路由判定（logLine/tier/clamped/fallback）。'
      + 'role 填角色卡名（omd-agent-*，入路由表；表外角色落会话默认档并记 fallback 审计）。',
    parameters: {
      description: { type: 'string', required: true, description: '委派任务的简短描述（3-5 词）。' },
      prompt: { type: 'string', required: true, description: '完整自包含任务文本（子代理看不到本会话）。' },
      role: { type: 'string', description: '角色卡名（omd-agent-*）。入 c3 路由表取表定档位上限；提示子代理先加载该角色卡。' },
      tier: { type: 'string', description: `请求档位（${TIER_ORDER.join('/')}）；省略落会话默认档。受角色表上限钳制。` },
      model: { type: 'string', description: '显式模型 id（部署可解析，如 glm-5.3-flash）；一等硬指定，绕过档位表。' },
      provider: { type: 'string', description: 'LLM provider id；必须与 model 一起提供。' },
    },
    output: { schema: delegateOutputSchema(), render: renderDelegate },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec?.agent
      if (!parent) throw new Error('omd_delegate: 宿主未提供调用代理（exec.agent 缺席），无法派发')
      const dispatchId = `omdd-${Date.now().toString(36)}-${(++seq).toString(36)}`
      const decision = resolveDispatch({ config, table, args, dispatchId })
      const modelId = decision.explicit ? decision.modelId
        : resolveModel(config, { name: decision.role ?? '', tier: decision.tier })
      // m1（评审）：Config 文档化复合格式 "provider/model"（模型路由表示例形态）拆分——
      // 仅当未显式给 provider 且恰两段时，首段作 provider、余段作 model id（不误切单段 id）
      let effectiveModelId = modelId
      let providerId
      if (typeof effectiveModelId === 'string' && args?.provider === undefined
        && /^[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(effectiveModelId)) {
        const idx = effectiveModelId.indexOf('/')
        providerId = effectiveModelId.slice(0, idx)
        effectiveModelId = effectiveModelId.slice(idx + 1)
      }
      // C1：派发前路由校验——不可用 id 在此显式报错（不静默继承/不静默降级）
      let agentOptions
      if (effectiveModelId !== undefined) {
        const llm = opts.llm ?? tryGet(ctx, 'llm')
        if (!llm || typeof llm.resolveCallConfig !== 'function')
          throw new Error(`omd_delegate: llm 服务缺席——模型 id "${effectiveModelId}" 无法校验（不静默派发）`)
        providerId = args.provider ?? providerId ?? parentRouteForDelegation(parent).provider
        if (providerId === undefined)
          throw new Error(`omd_delegate: 无法确定 LLM provider（调用代理无路由且未显式提供）——model=${effectiveModelId}`)
        await llm.resolveCallConfig({ provider: providerId, model: effectiveModelId }, exec?.signal)
        agentOptions = { provider: providerId, model: effectiveModelId }
      }
      if (subagents.getProvider(DELEGATE_PROVIDER) === undefined)
        throw new Error(`omd_delegate: subagent provider "${DELEGATE_PROVIDER}" 未注册（已注册: ${subagents.list().join(', ') || '无'}）`)
      // c3 fallback 审计（派发前判定面；审计失败仅告警不阻断派发；M1：权威路径+互斥锁）
      if (decision.fallback) {
        try {
          await recordFallback({ cwd: stateRoot(), decision })
        } catch (e) {
          ctx.logger?.warn?.(`omd_delegate: fallback 审计写入失败（不阻断派发）: ${e?.message ?? e}`)
        }
      }
      const finalPrompt = decision.role
        ? `[omd_delegate] 本次派发角色=${decision.role}（先经 skill 工具加载该角色卡，再按角色卡约束执行任务）。\n\n${args.prompt}`
        : args.prompt
      const request = {
        label: args.description,
        prompt: [{ type: 'text', text: finalPrompt }],
        parent,
        ...(agentOptions ? { agentOptions } : {}),
      }
      const run = await subagents.start(DELEGATE_PROVIDER, { ...request, signal: exec?.signal })
      let result
      try {
        result = await run.result
      } finally {
        try { await run.dispose?.() } catch { /* dispose 失败不吞子代理结果 */ }
      }
      if (result.stopReason !== 'completed') {
        const diag = result.diagnostic ? `；diagnostic=${result.diagnostic}` : ''
        throw new Error(`omd_delegate: 子代理异常结束 stopReason=${result.stopReason}${diag}`)
      }
      const text = (result.output ?? [])
        .filter(b => b?.type === 'text' && typeof b.text === 'string')
        .map(b => b.text).join('')
      ctx.logger?.info?.(decision.logLine)
      const out = { ok: true, dispatchId, clamped: decision.clamped, fallback: decision.fallback, text, logLine: decision.logLine }
      if (decision.role) out.role = decision.role
      if (decision.tier) out.tier = decision.tier
      if (effectiveModelId !== undefined) out.model = effectiveModelId
      if (providerId !== undefined) out.provider = providerId
      return out
    },
  }))
}
