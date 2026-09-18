// lib/keywords.js
/** 关键词注册表（规格 §3.1，OMX keyword-registry 式：目标/触发词/意图要求/优先级=数组序）。 */
export const KEYWORD_REGISTRY = [
  { target: 'cancel', triggers: ['cancelomd', 'stopomd'], intent: 'none',
    note: '独占优先；故意不匹配裸 cancel/stop；不可被禁用' },
  { target: 'ralph', triggers: ['ralph'], intent: 'explicit',
    note: '要求显式调用：ralph: <任务> / "用 ralph 做…"；裸词不匹配' },
  { target: 'autopilot', triggers: ['autopilot', 'full auto', '全自动', '帮我做一个', '帮我实现一个'], intent: 'natural' },
  { target: 'ralplan', triggers: ['ralplan'], intent: 'explicit' },
  { target: 'deep-interview', triggers: ['deep interview', '深度访谈'], intent: 'natural' },
  { target: 'review', triggers: ['code review', '代码评审'], intent: 'natural',
    note: '注入行内指引块而非完整 skill' },
]

/** 退役词：吞掉不触发，提示继任者（sunset 机制雏形）。 */
export const RETIRED_KEYWORDS = ['ultrawork', 'ulw', 'uw', 'ccg']
export const RETIRED_NOTE = '这些模式已在 OMC v5.0 退役：ultrawork/ulw/uw/ccg → 请改用 autopilot 或 team。'
