// mcp-server/tools/notepad.mjs
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { atomicWriteText } from '../lib/atomic.mjs'
import { omdPaths } from '../lib/paths.mjs'
import { parseNotepad, serializeNotepad, formatEntry, entryDate } from '../lib/markdown.mjs'

const WORKING_TTL_MS = 7 * 86400_000  // 规格 §5.3：7 天

export function makeNotepadTools(env) {
  async function load(cwd) {
    let text = ''
    try { text = await readFile(omdPaths({ cwd, stateDir: env.stateDir, sessionId: '_' }).notepad, 'utf8') } catch {}
    return parseNotepad(text)
  }
  async function save(cwd, zones) {
    await atomicWriteText(omdPaths({ cwd, stateDir: env.stateDir, sessionId: '_' }).notepad, serializeNotepad(zones))
  }
  function pruneZones(zones) {
    const cutoff = Date.now() - WORKING_TTL_MS
    zones.working = zones.working.filter(l => { const d = entryDate(l); return !Number.isFinite(d) || d >= cutoff })
    return zones  // priority / manual 不动
  }
  async function writeZone(cwd, zone, { text, at }) {
    const zones = pruneZones(await load(cwd))
    zones[zone].push(formatEntry(text, at))
    await save(cwd, zones)
    return { ok: true }
  }
  return {
    read: async ({ cwd }) => serializeNotepad(pruneZones(await load(cwd))),
    writePriority: ({ cwd, text, at }) => writeZone(cwd, 'priority', { text, at }),
    writeWorking: ({ cwd, text, at }) => writeZone(cwd, 'working', { text, at }),
    writeManual: ({ cwd, text, at }) => writeZone(cwd, 'manual', { text, at }),
    prune: async ({ cwd }) => { await save(cwd, pruneZones(await load(cwd))); return { ok: true } },
    stats: async ({ cwd }) => {
      const z = pruneZones(await load(cwd))
      return { priority: z.priority.length, working: z.working.length, manual: z.manual.length }
    },
  }
}

export function registerNotepadTools(server, env) {
  const t = makeNotepadTools(env)
  const base = { cwd: z.string() }
  const entry = { ...base, text: z.string(), at: z.string().optional() }
  const jsonOut = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }] })
  server.registerTool('notepad_read', { description: '读 .omd/notepad.md（三区）', inputSchema: base }, async a => jsonOut(await t.read(a)))
  server.registerTool('notepad_write_priority', { description: '写入永久记忆（Priority Context）', inputSchema: entry }, async a => jsonOut(await t.writePriority(a)))
  server.registerTool('notepad_write_working', { description: '写入工作记忆（7 天过期）', inputSchema: entry }, async a => jsonOut(await t.writeWorking(a)))
  server.registerTool('notepad_write_manual', { description: '写入 MANUAL 区（永不清理）', inputSchema: entry }, async a => jsonOut(await t.writeManual(a)))
  server.registerTool('notepad_prune', { description: '手动清理过期 Working Memory', inputSchema: base }, async a => jsonOut(await t.prune(a)))
  server.registerTool('notepad_stats', { description: '三区条目数统计', inputSchema: base }, async a => jsonOut(await t.stats(a)))
}
