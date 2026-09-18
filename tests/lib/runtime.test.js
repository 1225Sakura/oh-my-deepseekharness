import { test, expect } from 'vitest'
import { renderRuntimeSnapshot } from '../../lib/runtime.js'

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
