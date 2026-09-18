// mcp-server/lib/markdown.mjs
/** notepad 三区解析/序列化（规格 §5.3）。 */
export const ZONES = { priority: '## Priority Context', working: '## Working Memory', manual: '## MANUAL' }
const HEADER = '# omd Notepad\n\n'

export function parseNotepad(text) {
  const zones = { priority: [], working: [], manual: [] }
  if (!text) return zones
  let cur = null
  for (const line of text.split(/\r?\n/)) {
    if (line === ZONES.priority) { cur = 'priority'; continue }
    if (line === ZONES.working) { cur = 'working'; continue }
    if (line === ZONES.manual) { cur = 'manual'; continue }
    if (cur && line.startsWith('- ')) zones[cur].push(line)
  }
  return zones
}

export function serializeNotepad(zones) {
  let out = HEADER
  for (const [key, header] of Object.entries(ZONES)) {
    out += header + '\n' + (zones[key].length ? zones[key].join('\n') + '\n' : '') + '\n'
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
