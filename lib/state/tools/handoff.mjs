// mcp-server/tools/handoff.mjs
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteText } from '../lib/atomic.mjs'
import { readFile } from 'node:fs/promises'
import { omdPaths } from '../lib/paths.mjs'

const STAGES = /^[A-Za-z0-9_-]+$/
const SECTION_KEYS = ['decided', 'rejected', 'risks', 'files', 'remaining']
const SECTION_TITLES = { decided: '## Decided', rejected: '## Rejected', risks: '## Risks', files: '## Files', remaining: '## Remaining' }
const MAX_SECTION_LINES = 20

export function makeHandoffTools(env) {
  const file = (cwd, stage) => {
    if (!STAGES.test(stage)) throw new Error(`unsafe stage: ${stage}`)
    return join(omdPaths({ cwd, stateDir: env.stateDir, sessionId: '_' }).handoffs, `${stage}.md`)
  }
  return {
    async write({ cwd, stage, sections }) {
      for (const k of SECTION_KEYS)
        if (typeof sections[k] !== 'string' || !sections[k].trim())
          throw new Error(`missing section: ${k}（五段必填：${SECTION_KEYS.join('/')}）`)
      const warnings = []
      let doc = `# Handoff: ${stage}\n\n`
      for (const k of SECTION_KEYS) {
        let body = sections[k].trim()
        const lines = body.split(/\r?\n/)
        if (lines.length > MAX_SECTION_LINES) {
          body = lines.slice(0, MAX_SECTION_LINES).join('\n') + '\n[truncated]'
          warnings.push(`section ${k} truncated to ${MAX_SECTION_LINES} lines`)
        }
        doc += `${SECTION_TITLES[k]}\n${body}\n\n`
      }
      await atomicWriteText(file(cwd, stage), doc)
      return { ok: true, warnings }
    },
    async read({ cwd, stage }) {
      return await readFile(file(cwd, stage), 'utf8')
    },
    async list({ cwd }) {
      const dir = omdPaths({ cwd, stateDir: env.stateDir, sessionId: '_' }).handoffs
      try { return (await readdir(dir)).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)) }
      catch { return [] }
    },
  }
}

export function registerHandoffTools(server, env) {
  const t = makeHandoffTools(env)
  const jsonOut = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }] })
  const base = { cwd: z.string(), stage: z.string() }
  server.registerTool('handoff_write', { description: '写 team 阶段交接（五段固定格式）',
    inputSchema: { ...base, sections: z.object({ decided: z.string(), rejected: z.string(), risks: z.string(), files: z.string(), remaining: z.string() }) } },
    async a => jsonOut(await t.write(a)))
  server.registerTool('handoff_read', { description: '读阶段交接', inputSchema: base }, async a => jsonOut(await t.read(a)))
  server.registerTool('handoff_list', { description: '列出已有交接的阶段', inputSchema: { cwd: z.string() } }, async a => jsonOut(await t.list(a)))
}
