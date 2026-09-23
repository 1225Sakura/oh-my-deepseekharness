// tests/mcp-server/trace.test.js
import { test, expect } from 'vitest'
import { mkdtemp, readFile, appendFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeTraceTools } from '../../mcp-server/tools/trace.mjs'

async function tools() {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-'))
  return { t: makeTraceTools({ stateDir: '.omd' }), cwd }
}

test('begin 建追踪：begin 事件落盘 + 假设自动编号', async () => {
  const { t, cwd } = await tools()
  const r = await t.begin({ cwd, traceId: 'auth-bug', title: '登录失败', hypotheses: ['token 过期', '时钟漂移'] })
  expect(r.ok).toBe(true)
  expect(r.traceId).toBe('auth-bug')
  expect(r.hypotheses).toEqual([
    { id: 'h1', text: 'token 过期', status: 'open' },
    { id: 'h2', text: '时钟漂移', status: 'open' },
  ])
  const raw = await readFile(join(cwd, '.omd', 'trace', 'auth-bug.jsonl'), 'utf8')
  expect(raw.trim().split('\n')).toHaveLength(1)
  expect(JSON.parse(raw).type).toBe('begin')
})

test('begin 重复 traceId 显式拒绝（不覆盖已有追踪）', async () => {
  const { t, cwd } = await tools()
  await t.begin({ cwd, traceId: 'x', hypotheses: ['a'] })
  await expect(t.begin({ cwd, traceId: 'x', hypotheses: ['b'] })).rejects.toThrow('已存在')
})

test('event 追加证据/反证/状态迁移，summary 聚合正确', async () => {
  const { t, cwd } = await tools()
  await t.begin({ cwd, traceId: 'x', title: 't', hypotheses: ['甲因', '乙因'] })
  await t.event({ cwd, traceId: 'x', kind: 'evidence', hypothesis: 'h1', text: '日志显示 401 集中在过期窗口' })
  await t.event({ cwd, traceId: 'x', kind: 'counterevidence', hypothesis: 'h2', text: '服务器时钟与 NTP 同步' })
  await t.event({ cwd, traceId: 'x', kind: 'hypothesis', text: '丙因：代理层剥离 header' })
  await t.event({ cwd, traceId: 'x', kind: 'status', hypothesis: 'h2', status: 'refuted', text: '时钟排除' })
  await t.event({ cwd, traceId: 'x', kind: 'status', hypothesis: 'h1', status: 'confirmed', text: '复现确认' })
  const s = await t.summary({ cwd, traceId: 'x' })
  expect(s.closed).toBe(false)
  expect(s.eventCount).toBe(6)
  const byId = Object.fromEntries(s.hypotheses.map(h => [h.id, h]))
  expect(byId.h1.status).toBe('confirmed')
  expect(byId.h1.evidence).toBe(1)
  expect(byId.h2.status).toBe('refuted')
  expect(byId.h2.counterevidence).toBe(1)
  expect(byId.h3.text).toContain('丙因')
  expect(byId.h3.status).toBe('open')
  expect(s.openHypotheses).toEqual(['h3'])
  expect(s.timeline).toHaveLength(6)
})

test('end 结案后追加事件显式拒绝；summary 标 closed', async () => {
  const { t, cwd } = await tools()
  await t.begin({ cwd, traceId: 'x', hypotheses: ['a'] })
  await t.event({ cwd, traceId: 'x', kind: 'end', text: '根因=甲，修复见 commit abc' })
  const s = await t.summary({ cwd, traceId: 'x' })
  expect(s.closed).toBe(true)
  expect(s.endedAt).toBeTruthy()
  await expect(t.event({ cwd, traceId: 'x', kind: 'note', text: '补记' })).rejects.toThrow('已结案')
})

test('event 校验：不存在的 trace / 非法 kind / status 缺 hypothesis 均显式报错', async () => {
  const { t, cwd } = await tools()
  await expect(t.event({ cwd, traceId: 'nope', kind: 'note', text: 'x' })).rejects.toThrow('不存在')
  await t.begin({ cwd, traceId: 'x', hypotheses: ['a'] })
  await expect(t.event({ cwd, traceId: 'x', kind: 'bogus', text: 'x' })).rejects.toThrow('kind 非法')
  await expect(t.event({ cwd, traceId: 'x', kind: 'status', status: 'confirmed', text: 'x' })).rejects.toThrow('hypothesis')
  await expect(t.event({ cwd, traceId: 'x', kind: 'status', hypothesis: 'h1', status: 'bogus', text: 'x' })).rejects.toThrow('status 非法')
  await expect(t.event({ cwd, traceId: 'x', kind: 'note', text: '  ' })).rejects.toThrow('text 必填')
})

test('unsafe traceId 拒绝（路径注入防护）', async () => {
  const { t, cwd } = await tools()
  await expect(t.begin({ cwd, traceId: '../evil', hypotheses: [] })).rejects.toThrow('unsafe traceId')
})

test('list 列出全部 trace；空目录返回空数组', async () => {
  const { t, cwd } = await tools()
  expect(await t.list({ cwd })).toEqual([])
  await t.begin({ cwd, traceId: 'a', hypotheses: [] })
  await t.begin({ cwd, traceId: 'b', hypotheses: [] })
  expect((await t.list({ cwd })).sort()).toEqual(['a', 'b'])
})

test('JSONL 含坏行时 summary 容错（报 corruptLines 不崩）', async () => {
  const { t, cwd } = await tools()
  await t.begin({ cwd, traceId: 'x', hypotheses: ['a'] })
  const file = join(cwd, '.omd', 'trace', 'x.jsonl')
  await appendFile(file, '{not json\n', 'utf8')
  const s = await t.summary({ cwd, traceId: 'x' })
  expect(s.eventCount).toBe(1)
  expect(s.corruptLines).toEqual([2])
})

test('timelineLimit 有界截断（保留尾部最新事件）', async () => {
  const { t, cwd } = await tools()
  await t.begin({ cwd, traceId: 'x', hypotheses: ['a'] })
  for (let i = 0; i < 10; i++) await t.event({ cwd, traceId: 'x', kind: 'note', text: `n${i}` })
  const s = await t.summary({ cwd, traceId: 'x', timelineLimit: 3 })
  expect(s.timeline).toHaveLength(3)
  expect(s.timeline[2].text).toBe('n9')
})

test('traceId 省略时自动生成且可用', async () => {
  const { t, cwd } = await tools()
  const r = await t.begin({ cwd, title: 'auto' })
  expect(r.traceId).toMatch(/^t-[0-9a-f]{8}$/)
  const s = await t.summary({ cwd, traceId: r.traceId })
  expect(s.title).toBe('auto')
})
