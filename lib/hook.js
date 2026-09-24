// lib/hook.js
// M3 c2-impl（T4②-B 裁决）：原生 cordis 插件消费宿主拦截点 agent/pre-step（canonical seam，
// dsh-hooks-claude-code 同款消费面——S2 F2 勘明「自研逻辑应写为原生拦截点插件，桥仅 CC 兼容
// 回退」）。UserPromptSubmit ≙ pre-step 携带新认领的用户输入：dsh-agent-loop 的 inbox.claim
// 消耗语义保证每条用户输入恰到达一次（后续 step 认领为空 ⇒ messages.length===0 直通）。
//
// 链路（S2 marker 链路工程化 + B1 语义收窄）：prompt → 确定性关键词检测（lib/keywords.js
// 注册表单一来源，零 LLM）→ 显式条目命中 → 模式状态预写 + 注入激活指引块；review 条目命中 →
// 只注入行内指引块（不写状态）；natural 条目与裸词/解释性提及/回显块 → 零成本直通（语义守卫
// 归模型层协议——B1 修复：确定性面不再对 natural/裸词预写状态架空模型层守卫）。
import { omdPaths } from '../mcp-server/lib/paths.mjs'
import { atomicWriteJson } from '../mcp-server/lib/atomic.mjs'
import { KEYWORD_REGISTRY, ANCHORED_MATCH_RE } from './keywords.js'

export const HOOK_SOURCE = 'oh-my-dsh:keyword-hook'
// state.mjs 同款 prompt_echo 上限（写路径契约一致）
const ECHO_MAX = 1200

// 防误触发（关键词路由表守卫的确定性子集），按序剥离：
// ①模式回显/注入块字面（粘贴旧回显不自激——B1 场景）②fenced code ③行内代码 ④URL ⑤未配对反引号残留。
// 引号内/解释性提及等语义级守卫由模型层协议执行；explicit 条目另经锚定形态收窄（见 detectKeyword）。
const ECHO_BLOCK_RE = /\[(?:RALPH LOOP|MAGIC KEYWORD)[^\]]*\]/gi
const FENCE_RE = /```[\s\S]*?(?:```|$)/g
const INLINE_CODE_RE = /`[^`\n]*`/g
const URL_RE = /\b(?:https?|ftp):\/\/\S+/gi
const STRAY_BACKTICK_RE = /`+/g

/** 剥离不激活形态；检测输入的统一预处理（失效方向=过度剥离致漏检，绝不致误激活）。 */
export function stripNonActivating(text) {
  return String(text ?? '')
    .replace(ECHO_BLOCK_RE, ' ')
    .replace(FENCE_RE, ' ')
    .replace(INLINE_CODE_RE, ' ')
    .replace(URL_RE, ' ')
    .replace(STRAY_BACKTICK_RE, ' ')
}

/**
 * 确定性关键词检测（零 LLM）：按注册表数组序（优先级）。
 * - hook.match='token'：专属触发词子串（cancelomd/stopomd/code review 等——非裸词）。
 * - hook.match='anchored'：explicit 条目走 ANCHORED_MATCH_RE 行锚定/「用 X」形态（裸词不激活），
 *   且锚点前 8 字符内含疑问词即视为解释性提及 → 直通（B1 复审：'如何使用 ralph？' 不武装）。
 * - 无 hook 字段的条目（natural）：跳过——语义守卫归模型层协议（B1 修复核心）。
 * @returns {target, trigger, intent, hook} 命中项；未命中 null。
 */
export function detectKeyword(text) {
  const s = stripNonActivating(text)
  for (const entry of KEYWORD_REGISTRY) {
    const policy = entry.hook
    if (!policy) continue
    if (policy.match === 'anchored') {
      const pats = ANCHORED_MATCH_RE[entry.target] ?? []
      for (const re of pats) {
        const m = re.exec(s)
        if (!m) continue
        // 否定前导守卫（B1 复审）：窗口含边界字符（m.index+1）——「怎么用 wiki？」的「么」
        // 紧邻「用」，不含边界会被锚定正则的排除类消费致漏检；疑问词命中=解释性提及直通
        const lead = s.slice(Math.max(0, m.index - 8), m.index + 1)
        if (/如何|怎么|怎样|什么|是否|能否|为何|咋/.test(lead)) continue
        return { target: entry.target, trigger: entry.triggers[0], intent: entry.intent, hook: policy }
      }
      continue
    }
    for (const trigger of entry.triggers)
      if (s.includes(trigger))
        return { target: entry.target, trigger, intent: entry.intent, hook: policy }
  }
  return null
}

/**
 * 命中后的模式状态初值（explicit 条目预写契约：active/started_at/current_phase/prompt_echo
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

/** 注入激活指引块（explicit 条目预写形态；[MAGIC KEYWORD] 约定同宿主 hook 惯例）。 */
export function renderActivationNotice({ entry, sessionId, updatedAt }) {
  return [
    `[MAGIC KEYWORD: ${entry.target}] omd 关键词路由命中：触发词 '${entry.trigger}'（intent=${entry.intent}）。`,
    `模式状态已由 keyword-hook 预写并激活（sessionId=${sessionId}，mode=${entry.target}，updatedAt=${updatedAt}）。`,
    `按路由表加载 ${entry.target} 对应 skill 并立即开始；首个 state_write 建议携 expectUpdatedAt=${updatedAt} 续写同一状态。`,
  ].join('\n')
}

/** 注入行内指引块（review 条目 note 纪律：指引而非完整 skill，绝不写模式状态）。 */
export function renderGuideNotice({ entry }) {
  return [
    `[关键词指引: ${entry.target}] 触发词命中（intent=${entry.intent}）——本条目为行内指引面，未激活任何模式状态。`,
    `如需完整流程：按路由表调用 ${entry.target} 对应 skill；收到评审意见先读 receiving-code-review 再评估，交付评审前先读 requesting-code-review。`,
  ].join('\n')
}

/**
 * 展平消息数组为检测用文本（text 块联结；非文本块忽略）。
 * 来源过滤（B1 复审对齐）：claim 语义下消息无 role 字段视为用户输入；文本块排除
 * 扫描面收紧（v0.4.1，复验实测缺陷修复，严格白名单）：消息级只扫 m.source.kind ===
 * 'user' 的人类输入 seam。role='user' 的消息流里还混有 tool 结果（kind=tool）、模型复述
 * （kind=model）与子代理回报 splice（无 source 的内存构造消息，headless 实测在案）——
 * 一律不扫：否则回报里的触发词证据（如回归表格引用 cancelomd）会误触发模式预写。
 * 块级 tool 双保险保留；语义守卫主防线=锚定形态+否定前导守卫（不变）。
 */
function flattenText(messages) {
  return messages
    .filter(m => (m?.role === undefined || m.role === 'user') && m?.source?.kind === 'user')
    .flatMap(m => Array.isArray(m?.content) ? m.content : [])
    .filter(b => b?.type === 'text' && typeof b.text === 'string' && b.source?.kind !== 'tool')
    .map(b => b.text)
    .join('\n')
}

/**
 * 注册关键词 hook：ctx.on('agent/pre-step') 单监听器。
 * 契约：(1) 每条路径恰调用 next() 一次（写状态失败/会话锚缺失/检测异常均直通不阻断）；
 * (2) 未命中/非武装条目零成本直通；(3) 监听器自身绝不抛错（跟随 goal-round-driver 惯例）；
 * (4) 防盲覆写（B1 修复）：同会话同名模式已 active 时跳过预写与注入（不重置运行中状态）。
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
    let appended = null
    try {
      const text = Array.isArray(messages) && messages.length > 0 ? flattenText(messages) : ''
      const entry = text ? detectKeyword(text) : null
      if (entry) {
        const sessionId = agent?.session?.header?.id
        const cwd = agent?.session?.header?.cwd ?? process.cwd()
        if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof cwd !== 'string') {
          logger?.warn?.(`[keyword-hook] 命中 '${entry.trigger}' 但会话锚缺失（sessionId/cwd 不可得）——直通`)
        } else if (entry.hook.arm) {
          // 防盲覆写：同会话同名模式已 active → 跳过预写与注入（不重置运行中状态，B1 场景③）
          const existing = await readBackViaStateRead({ cwd, stateDir, sessionId, mode: entry.target }).catch(() => null)
          if (existing?.active === true) {
            logger?.info?.(`[keyword-hook] '${entry.target}' 已活跃于本会话——跳过重置（防盲覆写）`)
          } else {
            const now = new Date()
            const file = await writeModeState({
              cwd, stateDir, sessionId, mode: entry.target,
              state: buildArmedState({ entry, promptText: text, now }), now,
            })
            logger?.info?.(`[keyword-hook] hit trigger='${entry.trigger}' target=${entry.target} session=${sessionId} file=${file}`)
            appended = renderActivationNotice({ entry, sessionId, updatedAt: now.toISOString() })
          }
        } else if (entry.hook.injectGuide) {
          // review 条目：只注入行内指引块（不写模式状态——注册表 note 纪律）
          appended = renderGuideNotice({ entry })
        }
      }
      // 未命中/锚缺失/非武装/写失败都落到这里：appended 保持 null（C3 零成本直通）
    } catch (error) {
      logger?.warn?.(`[keyword-hook] 处理失败（直通不阻断）: ${error?.message ?? error}`)
      appended = null
    }
    // 恰一次 next()（host 错误自然传播，与其他原生插件一致）
    const downstream = await next()
    if (appended && downstream && downstream.kind === 'enter') {
      const context = createUserMessage({ content: [{ type: 'text', text: appended }], source: { kind: HOOK_SOURCE } })
      return { ...downstream, messages: [...downstream.messages, context] }
    }
    return downstream
  })
  return true
}
