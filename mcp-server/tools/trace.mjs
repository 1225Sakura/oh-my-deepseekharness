// mcp-server/tools/trace.mjs
// trace 时间线工具面（v0.4.0 P2-B）：证据驱动的因果追踪数据面。
// 对标 OMC trace_timeline/trace_summary——trace skill 原本是纯编排指引，
// 本模块把「竞争假设 + 正反证据 + 不确定性追踪」落成 append-only JSONL 承载面：
//   .omd/trace/<traceId>.jsonl   每行一个事件，只追加不改写（崩溃可恢复、可审计）
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { omdPaths } from '../lib/paths.mjs'

const SAFE_ID = /^[A-Za-z0-9_-]+$/
const EVENT_KINDS = ['hypothesis', 'evidence', 'counterevidence', 'note', 'status', 'end']
const HYP_STATUS = ['open', 'confirmed', 'refuted', 'abandoned']

function traceFile(env, cwd, traceId) {
  if (!SAFE_ID.test(traceId)) throw new Error(`unsafe traceId: ${traceId}`)
  return join(omdPaths({ cwd, stateDir: env.stateDir, sessionId: '_' }).traces, `${traceId}.jsonl`)
}

async function appendEvent(file, event) {
  await mkdir(dirname(file), { recursive: true })
  await appendFile(file, JSON.stringify(event) + '\n', 'utf8')
}

async function readEvents(file) {
  let text
  try { text = await readFile(file, 'utf8') } catch { return [] }
  const events = []
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    try { events.push(JSON.parse(line)) }
    catch { events.push({ type: '_corrupt', line: i + 1, raw: line.slice(0, 200) }) }
  }
  return events
}

export function makeTraceTools(env) {
  return {
    /** 开一条追踪：写 begin 事件（携带初始竞争假设集）。traceId 省略时生成。 */
    async begin({ cwd, traceId, title, hypotheses = [] }) {
      const id = traceId ?? `t-${randomUUID().slice(0, 8)}`
      const file = traceFile(env, cwd, id)
      const existing = await readEvents(file)
      if (existing.length) throw new Error(`trace 已存在: ${id}（续写请用 trace_event；另开请换 traceId）`)
      const hyps = hypotheses.map((text, i) => ({ id: `h${i + 1}`, text, status: 'open' }))
      await appendEvent(file, { seq: 1, ts: new Date().toISOString(), type: 'begin', title: title ?? id, hypotheses: hyps })
      return { ok: true, traceId: id, hypotheses: hyps }
    },

    /** 追加事件。kind=status 时须给 hypothesis + status；evidence/counterevidence 建议给 hypothesis。 */
    async event({ cwd, traceId, kind, hypothesis, status, text }) {
      if (!EVENT_KINDS.includes(kind)) throw new Error(`kind 非法: ${kind}（合法: ${EVENT_KINDS.join('/')}）`)
      if (typeof text !== 'string' || !text.trim()) throw new Error('text 必填（事件陈述/证据内容）')
      const file = traceFile(env, cwd, traceId)
      const events = await readEvents(file)
      if (!events.length) throw new Error(`trace 不存在: ${traceId}（先 trace_begin）`)
      if (events.some(e => e.type === 'end') && kind !== 'end')
        throw new Error(`trace 已结案: ${traceId}（end 后只读；另开新 trace 续查）`)
      if (kind === 'status') {
        if (!hypothesis) throw new Error('kind=status 必须给 hypothesis（如 h1）')
        if (!HYP_STATUS.includes(status)) throw new Error(`status 非法: ${status}（合法: ${HYP_STATUS.join('/')}）`)
      }
      if (kind === 'hypothesis' && hypothesis) throw new Error('kind=hypothesis 新增假设时不指定 id（自动分配）')
      const ev = { seq: events.length + 1, ts: new Date().toISOString(), type: kind, text }
      if (hypothesis) ev.hypothesis = hypothesis
      if (kind === 'status') ev.status = status
      if (kind === 'hypothesis') ev.hypothesis = `h${nextHypIndex(events)}`
      await appendEvent(file, ev)
      return { ok: true, traceId, seq: ev.seq, ...(ev.hypothesis ? { hypothesis: ev.hypothesis } : {}) }
    },

    /** 聚合摘要：假设存活状态、正/反证据计数、有界时间线、结案状态。 */
    async summary({ cwd, traceId, timelineLimit = 50 }) {
      const file = traceFile(env, cwd, traceId)
      const events = await readEvents(file)
      if (!events.length) throw new Error(`trace 不存在: ${traceId}`)
      const begin = events.find(e => e.type === 'begin')
      const hyps = new Map()
      for (const h of begin?.hypotheses ?? []) hyps.set(h.id, { id: h.id, text: h.text, status: h.status, evidence: 0, counterevidence: 0 })
      let ended = null
      const corrupt = []
      for (const e of events) {
        if (e.type === '_corrupt') { corrupt.push(e.line); continue }
        if (e.type === 'hypothesis' && !hyps.has(e.hypothesis))
          hyps.set(e.hypothesis, { id: e.hypothesis, text: e.text, status: 'open', evidence: 0, counterevidence: 0 })
        if (e.type === 'status' && hyps.has(e.hypothesis)) hyps.get(e.hypothesis).status = e.status
        if (e.type === 'evidence' && hyps.has(e.hypothesis)) hyps.get(e.hypothesis).evidence++
        if (e.type === 'counterevidence' && hyps.has(e.hypothesis)) hyps.get(e.hypothesis).counterevidence++
        if (e.type === 'end') ended = e
      }
      const timeline = events.filter(e => e.type !== '_corrupt').slice(-Math.max(1, timelineLimit))
      return {
        traceId, title: begin?.title ?? traceId,
        begunAt: begin?.ts ?? null, endedAt: ended?.ts ?? null, closed: ended !== null,
        hypotheses: [...hyps.values()],
        openHypotheses: [...hyps.values()].filter(h => h.status === 'open').map(h => h.id),
        eventCount: events.length - corrupt.length,
        ...(corrupt.length ? { corruptLines: corrupt } : {}),
        timeline,
      }
    },

    /** 列出全部 trace id（按文件名）。 */
    async list({ cwd }) {
      const dir = omdPaths({ cwd, stateDir: env.stateDir, sessionId: '_' }).traces
      try { return (await readdir(dir)).filter(f => f.endsWith('.jsonl')).map(f => f.slice(0, -6)) }
      catch { return [] }
    },
  }
}

/** 下一个假设序号：扫既有 begin/hypothesis 事件取最大 h<N>。 */
function nextHypIndex(events) {
  let max = 0
  for (const e of events) {
    const ids = e.type === 'begin' ? (e.hypotheses ?? []).map(h => h.id) : (e.hypothesis ? [e.hypothesis] : [])
    for (const id of ids) { const m = /^h(\d+)$/.exec(id ?? ''); if (m) max = Math.max(max, +m[1]) }
  }
  return max + 1
}

export function registerTraceTools(server, env) {
  const t = makeTraceTools(env)
  const base = { cwd: z.string() }
  const withId = { ...base, traceId: z.string() }
  const jsonOut = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }] })
  server.registerTool('trace_begin', { description: '开一条证据追踪（竞争假设集 → .omd/trace/<id>.jsonl）',
    inputSchema: { ...base, traceId: z.string().optional(), title: z.string().optional(), hypotheses: z.array(z.string()).optional() } },
    async a => jsonOut(await t.begin(a)))
  server.registerTool('trace_event', { description: '追加追踪事件（hypothesis/evidence/counterevidence/note/status/end）',
    inputSchema: { ...withId, kind: z.enum(EVENT_KINDS), hypothesis: z.string().optional(), status: z.enum(HYP_STATUS).optional(), text: z.string() } },
    async a => jsonOut(await t.event(a)))
  server.registerTool('trace_summary', { description: '追踪聚合摘要（假设存活状态、证据计数、有界时间线）',
    inputSchema: { ...withId, timelineLimit: z.number().int().min(1).max(500).optional() } },
    async a => jsonOut(await t.summary(a)))
  server.registerTool('trace_list', { description: '列出全部 trace', inputSchema: base }, async a => jsonOut(await t.list(a)))
}
