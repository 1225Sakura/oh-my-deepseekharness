// tests/lib/heartbeat.test.js
// v0.4 P2-C heartbeat 定时器：启停契约 + 周期扫描呈面 + dispose 回收（扫描注入，不碰真实文件系统）
import { test, expect } from 'vitest'
import { registerHeartbeatTimer } from '../../lib/heartbeat.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))

function fakeCtx() {
  const warns = []
  const effects = []
  return {
    warns, effects,
    logger: { warn: (m) => warns.push(m), debug: () => {} },
    effect(fn) { effects.push(fn) },
  }
}

test('intervalMs=0 → skipped 不注册 effect', () => {
  const ctx = fakeCtx()
  const r = registerHeartbeatTimer(ctx, { config: { team: { heartbeatIntervalMs: 0 } } })
  expect(r.enabled).toBe(false)
  expect(r.detail).toContain('=0')
  expect(ctx.effects).toHaveLength(0)
})

test('ctx.effect 缺席 → skipped 不抛错', () => {
  const r = registerHeartbeatTimer({}, { config: { team: { heartbeatIntervalMs: 10 } } })
  expect(r.enabled).toBe(false)
  expect(r.detail).toContain('ctx.effect')
})

test('周期扫描：scan 返回的告警行全部呈面 logger.warn；dispose 后停止', async () => {
  const ctx = fakeCtx()
  // 契约（评审修复#4）：scan 只回告警行（alertLines），heartbeat 不做内容嗅探
  const lines = ['[team] stale 队员: w-1（x，5m 无心跳）', '[team] 未处置 blocker: w-2 seq=1：文本含"正常"二字也不被吞']
  const r = registerHeartbeatTimer(ctx, {
    config: { team: { heartbeatIntervalMs: 15 } },
    scan: async () => lines,
  })
  expect(r.enabled).toBe(true)
  expect(ctx.effects).toHaveLength(1)
  const dispose = ctx.effects[0]()
  await sleep(50) // ≈3 个周期
  expect(ctx.warns.length).toBeGreaterThanOrEqual(2)
  expect(ctx.warns[0]).toContain('stale 队员')
  expect(ctx.warns.some(m => m.includes('未处置 blocker'))).toBe(true) // 含"正常"的用户文本不再被过滤吞掉
  const before = ctx.warns.length
  dispose()
  await sleep(40)
  expect(ctx.warns.length).toBe(before) // dispose 后定时器已回收
})

test('扫描抛错静默降级（下周期重试，不阻断宿主）', async () => {
  const ctx = fakeCtx()
  let calls = 0
  registerHeartbeatTimer(ctx, {
    config: { team: { heartbeatIntervalMs: 15 } },
    scan: async () => { calls++; throw new Error('boom') },
  })
  const dispose = ctx.effects[0]()
  await sleep(50)
  expect(calls).toBeGreaterThanOrEqual(2) // 抛错后仍在周期重试
  expect(ctx.warns).toHaveLength(0)
  dispose()
})
