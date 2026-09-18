// mcp-server/lib/markdown.mjs
/** notepad 三区解析/序列化（规格 §5.3）。
 *  H2 修复：解析时保留每个区的 raw 行（非 `- ` 条目行）——MANUAL 区是用户手写内容，
 *  整文件重写不得静默删除任何行。条目行用 `- [iso-date] text` 形状识别。 */
export const ZONES = { priority: '## Priority Context', working: '## Working Memory', manual: '## MANUAL' }
const HEADER = '# omd Notepad'
const ENTRY = /^- \[/

export function isEntryLine(line) { return ENTRY.test(line) }

function trimBlankEdges(lines) {
  const copy = [...lines]
  while (copy.length && copy[0].trim() === '') copy.shift()
  while (copy.length && copy[copy.length - 1].trim() === '') copy.pop()
  return copy
}

/** 解析为 { preamble, priority, working, manual }——每个区是行数组，条目与 raw 行都保留。 */
export function parseNotepad(text) {
  const zones = { preamble: [], priority: [], working: [], manual: [] }
  if (!text) return zones
  let cur = 'preamble'
  for (const line of text.split(/\r?\n/)) {
    if (line === ZONES.priority) { cur = 'priority'; continue }
    if (line === ZONES.working) { cur = 'working'; continue }
    if (line === ZONES.manual) { cur = 'manual'; continue }
    if (line === HEADER) continue   // 固定头部，序列化时统一生成
    zones[cur].push(line)
  }
  return zones
}

/** 序列化：固定头部 → preamble raw 行 → 三区（区内行原样回写，仅修剪区首尾的纯空行）。 */
export function serializeNotepad(zones) {
  let out = HEADER + '\n\n'
  const pre = trimBlankEdges(zones.preamble ?? [])
  if (pre.length) out += pre.join('\n') + '\n\n'
  for (const [key, header] of Object.entries(ZONES)) {
    const lines = trimBlankEdges(zones[key] ?? [])
    out += header + '\n' + (lines.length ? lines.join('\n') + '\n' : '') + '\n'
  }
  return out
}

export function formatEntry(text, at = new Date().toISOString()) {
  return `- [${at}] ${text.replace(/\r?\n/g, ' ')}`
}

export function entryDate(line) {
  const m = /^- \[([^\]]+)\]/.exec(line)
  return m ? Date.parse(m[1]) : NaN
}
