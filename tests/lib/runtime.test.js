import { test, expect } from 'vitest'
import { renderRuntimeSnapshot, readActiveModesFromTable } from '../../lib/runtime.js'
import { projectKey } from '../../lib/memory.js'

test('无活跃模式时返回空串（不占上下文）', () => {
  expect(renderRuntimeSnapshot({ active: [], degraded: [] })).toBe('')
})

test('有活跃模式时输出快照与恢复指引', () => {
  const s = renderRuntimeSnapshot({
    active: [{ _meta: { mode: 'ralph', sessionId: 's1', updatedAt: '2026-09-15T08:00:00Z' }, current_phase: 'exec', iteration: 2, max_iterations: 10 }],
    degraded: ['storage'],
  })
  expect(s).toContain('ralph')
  expect(s).toContain('2/10')
  expect(s).toContain('storage')
  expect(s).toContain('降级')
})

test('stale（>2h）模式被标注', () => {
  const s = renderRuntimeSnapshot({
    active: [{ _meta: { mode: 'autopilot', sessionId: 's1', updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString() } }],
    degraded: [],
  })
  expect(s).toContain('STALE')
})

// ---------- 2026-10-26 第二轮 S5：active 分支复活（二期②起经域表同步读面） ----------

test('S5 readActiveModesFromTable：锚定 cwd 读活跃模式（active=true + _meta.mode），按 updatedAt 新者优先', () => {
  const ws = '/proj/omd-rt'
  const m = new Map()
  m.set(`${projectKey(ws)}:ralph:sess-1`, {
    active: true, current_phase: 'execution', iteration: 2,
    _meta: { mode: 'ralph', sessionId: 'sess-1', updatedAt: '2026-10-26T10:00:00.000Z' },
  })
  m.set(`${projectKey(ws)}:team:sess-1`, {
    active: false, // 非活跃不进
    _meta: { mode: 'team', sessionId: 'sess-1', updatedAt: '2026-10-26T11:00:00.000Z' },
  })
  m.set(`${projectKey('/other/ws')}:ralph:sess-x`, { active: true, _meta: { mode: 'ralph', sessionId: 'sess-x', updatedAt: '2026-10-26T12:00:00.000Z' } }) // 跨仓不进
  const table = { get: k => m.get(k), keys: () => [...m.keys()] }
  const active = readActiveModesFromTable(table, ws)
  expect(active).toHaveLength(1)
  expect(active[0]._meta.mode).toBe('ralph')
  // 渲染集成：活跃模式行进快照
  const text = renderRuntimeSnapshot({ active, degraded: [] })
  expect(text).toContain('活跃模式：ralph')
  expect(text).toContain('恢复指引')
})

test('S5 readActiveModesFromTable 回落：锚缺失/表缺席/表异常 → [] 不炸', () => {
  expect(readActiveModesFromTable({ keys: () => [], get: () => undefined }, '')).toEqual([])  // 锚缺失拒绝相对回落
  expect(readActiveModesFromTable(null, '/proj/x')).toEqual([])                               // 表缺席（storage 缺席）
  expect(readActiveModesFromTable({ keys: () => { throw new Error('boom') }, get: () => undefined }, '/proj/x')).toEqual([]) // 表异常
})
