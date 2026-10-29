// tests/mcp-server/events.test.js
// W1-1（生态补全 P0 证明面）：events_read MCP 只读工具——lib/events.js readEvents/aggregateEvents 接线。
// 写面用 recordRouteEvent 真实落盘（与生产同路径），不 mock 文件形状。
import { test, expect } from 'vitest'
import { mkdtemp, rm, appendFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeEventsTools, registerEventsTools } from '../../mcp-server/tools/events.mjs'
import { recordRouteEvent, eventsPath } from '../../lib/events.js'

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-events-mcp-'))
  return { cwd, ev: makeEventsTools({ stateDir: '.omd' }) }
}

test('文件缺席 → 空 events + 零聚合（读路径永不抛错）', async () => {
  const { cwd, ev } = await setup()
  try {
    const r = await ev.read({ cwd })
    expect(r.events).toEqual([])
    expect(r.totalInWindow).toBe(0)
    expect(r.returned).toBe(0)
    expect(r.truncated).toBe(false)
    expect(r.aggregate).toEqual({ total: 0, byTier: { low: 0, medium: 0, high: 0, explicit: 0 }, fallbackCount: 0 })
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('真实事件读回 + kind 过滤 + tail 过滤视图语义 + 聚合 1:1 对账', async () => {
  const { cwd, ev } = await setup()
  try {
    await recordRouteEvent({ cwd, kind: 'route', decision: { dispatchId: 'dp-1', role: 'omd-agent-executor', tier: 'medium' } })
    await recordRouteEvent({ cwd, kind: 'fallback', decision: { dispatchId: 'dp-1', role: 'omd-agent-executor', tier: 'medium' } })
    await recordRouteEvent({ cwd, kind: 'route', decision: { dispatchId: 'dp-2', role: 'r', tier: 'high', clamped: true } })

    const all = await ev.read({ cwd })
    expect(all.totalInWindow).toBe(3)
    expect(all.returned).toBe(3)
    expect(all.aggregate.total).toBe(2)            // route 行数
    expect(all.aggregate.fallbackCount).toBe(1)    // route:fallback 1:1 对账
    expect(all.aggregate.byTier.high).toBe(1)
    expect(all.aggregate.byTier.medium).toBe(1)

    const routes = await ev.read({ cwd, kind: 'route' })
    expect(routes.totalInWindow).toBe(2)
    expect(routes.events.every(e => e.kind === 'route')).toBe(true)
    expect(routes.aggregate.fallbackCount).toBe(1) // 聚合恒对全窗，不受 kind 过滤影响

    const tail2 = await ev.read({ cwd, tail: 2 })
    expect(tail2.returned).toBe(2)
    expect(tail2.truncated).toBe(true)
    expect(tail2.events[1].dispatchId).toBe('dp-2') // 过滤视图尾部

    const tail9 = await ev.read({ cwd, tail: 9 })
    expect(tail9.truncated).toBe(false)
    expect(tail9.returned).toBe(3)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('坏行容错：_corrupt 占位不抛错（审计行号保留）', async () => {
  const { cwd, ev } = await setup()
  try {
    await recordRouteEvent({ cwd, kind: 'route', decision: { dispatchId: 'dp-1' } })
    await mkdir(join(cwd, '.omd', 'state'), { recursive: true })
    await appendFile(eventsPath(cwd, '.omd'), '{broken json\n', 'utf8')
    const r = await ev.read({ cwd })
    expect(r.totalInWindow).toBe(2)
    expect(r.events.some(e => e._corrupt === true)).toBe(true)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('注册：events_read 经 registerEventsTools 暴露（描述含只读/过滤语义）', () => {
  const calls = []
  registerEventsTools({ registerTool: (name, def) => calls.push({ name, def }) }, { stateDir: '.omd' })
  expect(calls.map(c => c.name)).toEqual(['events_read'])
  const reg = calls.find(c => c.name === 'events_read')
  expect(reg.def.description).toContain('只读')
  expect(reg.def.description).toContain('tail')
  expect(reg.def.description).toContain('kind')
})
