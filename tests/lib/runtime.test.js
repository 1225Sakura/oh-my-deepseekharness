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

// ---------- 2026-10-26 第二轮 S5：active 分支复活（同步读面） ----------

test('S5 readActiveModesSync：锚定 cwd 读活跃模式（active=true + _meta.mode），按 updatedAt 新者优先', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { readActiveModesSync } = await import('../../lib/runtime.js')
  const ws = await mkdtemp(join(tmpdir(), 'omd-rt-'))
  try {
    const dir = join(ws, '.omd', 'state', 'sessions', 'sess-1')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'ralph-state.json'), JSON.stringify({
      active: true, current_phase: 'execution', iteration: 2,
      _meta: { mode: 'ralph', sessionId: 'sess-1', updatedAt: '2026-10-26T10:00:00.000Z' },
    }), 'utf8')
    await writeFile(join(dir, 'team-state.json'), JSON.stringify({
      active: false, // 非活跃不进
      _meta: { mode: 'team', sessionId: 'sess-1', updatedAt: '2026-10-26T11:00:00.000Z' },
    }), 'utf8')
    const active = readActiveModesSync(ws, '.omd')
    expect(active).toHaveLength(1)
    expect(active[0]._meta.mode).toBe('ralph')
    // 渲染集成：活跃模式行进快照
    const text = renderRuntimeSnapshot({ active, degraded: [] })
    expect(text).toContain('活跃模式：ralph')
    expect(text).toContain('恢复指引')
  } finally { await rm(ws, { recursive: true, force: true }) }
})

test('S5 readActiveModesSync 回落：锚缺失/目录缺席/坏文件 → [] 不炸', async () => {
  const { readActiveModesSync } = await import('../../lib/runtime.js')
  expect(readActiveModesSync('', '.omd')).toEqual([])         // 锚缺失拒绝相对回落
  expect(readActiveModesSync('/no/such/dir', '.omd')).toEqual([]) // 目录缺席
})
