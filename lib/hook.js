// lib/hook.js
// M3 c2-impl（T4②-B 裁决）：原生 cordis 插件消费宿主拦截点 agent/pre-step（canonical seam，
// dsh-hooks-claude-code 同款消费面——S2 F2 勘明「自研逻辑应写为原生拦截点插件，桥仅 CC 兼容
// 回退」）。UserPromptSubmit ≙ pre-step 携带新认领的用户输入：dsh-agent-loop 的 inbox.claim
// 消耗语义保证每条用户输入恰到达一次（后续 step 认领为空 ⇒ messages.length===0 直通）。
//
// 链路（S2 marker 链路工程化）：prompt → 确定性关键词检测（lib/keywords.js 注册表单一来源，
// 零 LLM）→ 命中 → 模式状态写入（omd state 域，state_read 同路径读回）→ 注入激活指引块；
// 未命中 → 零成本直通（无状态写、无注入）。
import { omdPaths } from '../mcp-server/lib/paths.mjs'
import { atomicWriteJson } from '../mcp-server/lib/atomic.mjs'
import { KEYWORD_REGISTRY } from './keywords.js'

export const HOOK_SOURCE = 'oh-my-dsh:keyword-hook'
// state.mjs 同款 prompt_echo 上限（写路径契约一致）
const ECHO_MAX = 1200

// 防误触发（关键词路由表守卫的确定性子集）：代码块/行内代码/URL 内的触发词不激活。
// 引号内/解释性提及等语义级守卫仍由模型层协议执行（协议段渲染），确定性面不越权。
const FENCE_RE = /```[\s\S]*?(?:```|$)/g
const INLINE_CODE_RE = /`[^`\n]*`/g
const URL_RE = /\b(?:https?|ftp):\/\/\S+/gi

/** 剥离不激活形态（fenced code / inline code / URL）；检测输入的统一预处理。 */
export function stripNonActivating(text) {
  return String(text ?? '')
    .replace(FENCE_RE, ' ')
    .replace(INLINE_CODE_RE, ' ')
    .replace(URL_RE, ' ')
}

/**
 * 确定性关键词检测（零 LLM）：按注册表数组序（优先级）子串匹配。
 * @returns {target, trigger, intent} 命中项；未命中 null。
 */
export function detectKeyword(text) {
  const s = stripNonActivating(text)
  for (const entry of KEYWORD_REGISTRY)
    for (const trigger of entry.triggers)
      if (s.includes(trigger)) return { target: entry.target, trigger, intent: entry.intent }
  return null
}

/**
 * 命中后的模式状态初值（关键词路由表激活契约：active/started_at/current_phase/prompt_echo
 * + keyword_route 审计元数据；_meta 由 writeModeState 统一附加）。
 */
export function buildArmedState({ entry, promptText, now = new Date() }) {
  return {
    active: true,
    started_at: now.toISOString(),
    current_phase: 'keyword-detected',
    prompt_echo: String(promptText ?? '').slice(0, ECHO_MAX),
    keyword_route: { target: entry.target, trigger: entry.trigger, intent: entry.intent, source: 'keyword-hook' },
  }
}

/**
 * 模式状态写入：omdPaths stateFile 布局 + atomic tmp+rename，_meta 契约与
 * mcp-server state_write 逐字段一致（所有权归该会话，模型后续 state_write 可续写）。
 * @returns 写入文件绝对路径
 */
export async function writeModeState({ cwd, stateDir, sessionId, mode, state, now = new Date() }) {
  const file = omdPaths({ cwd, stateDir, sessionId }).stateFile(mode)
  await atomicWriteJson(file, {
    ...state,
    _meta: { mode, sessionId, updatedAt: now.toISOString(), updatedBy: sessionId },
  })
  return file
}

/** 经 state_read 自身实现（makeStateTools().read）读回——验收链「state_read 读回一致」的读路径。 */
export async function readBackViaStateRead({ cwd, stateDir, sessionId, mode }) {
  const { makeStateTools } = await import('../mcp-server/tools/state.mjs')
  return await makeStateTools({ stateDir }).read({ cwd, sessionId, mode })
}

/** 注入激活指引块（确定性模板；[MAGIC KEYWORD] 约定同宿主 hook 惯例）。 */
export function renderActivationNotice({ entry, sessionId, updatedAt }) {
  return [
    `[MAGIC KEYWORD: ${entry.target}] omd 关键词路由命中：触发词 '${entry.trigger}'（intent=${entry.intent}）。`,
    `模式状态已由 keyword-hook 预写并激活（sessionId=${sessionId}，mode=${entry.target}，updatedAt=${updatedAt}）。`,
    `按路由表加载 ${entry.target} 对应 skill 并立即开始；首个 state_write 建议携 expectUpdatedAt=${updatedAt} 续写同一状态。`,
  ].join('\n')
}

/** 展平消息数组为检测用文本（text 块联结；非文本块忽略）。 */
function flattenText(messages) {
  return messages
    .flatMap(m => Array.isArray(m?.content) ? m.content : [])
    .filter(b => b?.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n')
}

/**
 * 注册关键词 hook：ctx.on('agent/pre-step') 单监听器。
 * 契约：(1) 每条路径恰调用 next() 一次（写状态失败/会话锚缺失/检测异常均直通不阻断）；
 * (2) 未命中零成本直通；(3) 监听器自身绝不抛错（跟随 goal-round-driver 惯例）。
 * @param opts.createUserMessage 测试注入；默认动态 import('@deepseek-ai/dsh-llm')
 * @param opts.config omd Config（stateDir）
 */
export async function registerKeywordHook(ctx, opts = {}) {
  const createUserMessage = opts.createUserMessage ?? (await import('@deepseek-ai/dsh-llm')).createUserMessage
  if (typeof ctx.on !== 'function')
    throw new Error('宿主 ctx 缺少事件面（ctx.on）——无法消费 agent/pre-step 拦截点')
  const stateDir = opts.config?.stateDir ?? '.omd'
  const logger = ctx.logger

  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    let notice = null
    try {
      const text = Array.isArray(messages) && messages.length > 0 ? flattenText(messages) : ''
      const entry = text ? detectKeyword(text) : null
      if (entry) {
        const sessionId = agent?.session?.header?.id
        const cwd = agent?.session?.header?.cwd ?? process.cwd()
        if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof cwd !== 'string') {
          logger?.warn?.(`[keyword-hook] 命中 '${entry.trigger}' 但会话锚缺失（sessionId/cwd 不可得）——直通`)
        } else {
          const now = new Date()
          const file = await writeModeState({
            cwd, stateDir, sessionId, mode: entry.target,
            state: buildArmedState({ entry, promptText: text, now }), now,
          })
          logger?.info?.(`[keyword-hook] hit trigger='${entry.trigger}' target=${entry.target} session=${sessionId} file=${file}`)
          notice = renderActivationNotice({ entry, sessionId, updatedAt: now.toISOString() })
        }
      }
      // 未命中/锚缺失/写失败都落到这里：notice 保持 null（C3 零成本直通）
    } catch (error) {
      logger?.warn?.(`[keyword-hook] 处理失败（直通不阻断）: ${error?.message ?? error}`)
      notice = null
    }
    // 恰一次 next()（host 错误自然传播，与其他原生插件一致）
    const downstream = await next()
    if (notice && downstream && downstream.kind === 'enter') {
      const context = createUserMessage({ content: [{ type: 'text', text: notice }], source: HOOK_SOURCE })
      return { ...downstream, messages: [...downstream.messages, context] }
    }
    return downstream
  })
  return true
}
