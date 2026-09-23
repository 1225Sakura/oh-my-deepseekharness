// lib/keywords.js
/** 关键词注册表（规格 §3.1，OMX keyword-registry 式：目标/触发词/意图要求/优先级=数组序）。
 *
 *  hook 策略（B1 修复，2026-09-22 双通道评审裁决）：keyword-hook 的确定性面只对
 *  显式条目武装——「解释性提及/粘贴回显不激活」的语义守卫不再被预写状态架空。
 *  - hook.arm=true：命中即预写模式状态。match='token'（专属词子串，如 cancelomd）
 *    或 match='anchored'（行锚定/「用 X」形态，裸词不激活——注册表 note 纪律）。
 *  - hook.injectGuide=true：只注入行内指引块，不写状态（review 条目 note 纪律）。
 *  - 无 hook 字段：keyword-hook 层直通（natural 条目的语义守卫归模型层协议，
 *    系统提示路由表照常渲染，模型按表自行加载 skill）。
 */
export const KEYWORD_REGISTRY = [
  { target: 'cancel', triggers: ['cancelomd', 'stopomd'], intent: 'none',
    hook: { arm: true, match: 'token' },
    note: '独占优先；故意不匹配裸 cancel/stop；不可被禁用' },
  { target: 'ralph', triggers: ['ralph'], intent: 'explicit',
    hook: { arm: true, match: 'anchored' },
    note: '要求显式调用：ralph: <任务> / "用 ralph 做…"；裸词不匹配' },
  { target: 'autopilot', triggers: ['autopilot', 'full auto', '全自动', '帮我做一个', '帮我实现一个'], intent: 'natural' },
  { target: 'ralplan', triggers: ['ralplan'], intent: 'explicit',
    hook: { arm: true, match: 'anchored' } },
  { target: 'deep-interview', triggers: ['deep interview', '深度访谈'], intent: 'natural' },
  { target: 'ai-slop-cleaner', triggers: ['deslop', 'anti-slop', 'ai-slop'], intent: 'natural' },
  { target: 'review', triggers: ['code review', '代码评审'], intent: 'natural',
    hook: { arm: false, injectGuide: true, match: 'token' },
    note: '注入行内指引块而非完整 skill' },
  { target: 'wiki', triggers: ['wiki'], intent: 'explicit',
    hook: { arm: true, match: 'anchored' },
    note: '要求显式调用："用 wiki 记录/查询…"；裸词不匹配' },
]

/** explicit 条目的锚定匹配形态（行首 `x:` 前缀 / 「用 x …」显式调用式；裸词绝不命中）。
 *  排除集含 CJK 引号/括号（B1 复审：'「用 ralph 做…」' 引用形态不武装）；解释性问句由
 *  hook.js 否定前导守卫兜底（'如何使用 ralph？' 不武装）。 */
export const ANCHORED_MATCH_RE = {
  ralph: [ /^\s*ralph\s*[:：]/m, /(?:^|[^\w"'`「」『』""''])用\s*ralph\b/ ],
  ralplan: [ /^\s*ralplan\s*[:：]/m, /(?:^|[^\w"'`「」『』""''])用\s*ralplan\b/ ],
  wiki: [ /^\s*wiki\s*[:：]/m, /(?:^|[^\w"'`「」『』""''])用\s*wiki\b/ ],
}

/** 退役词：吞掉不触发，提示继任者（sunset 机制雏形）。 */
export const RETIRED_KEYWORDS = ['ultrawork', 'ulw', 'uw', 'ccg']
export const RETIRED_NOTE = '这些模式已在 OMC v5.0 退役：ultrawork/ulw/uw/ccg → 请改用 autopilot 或 team。'
