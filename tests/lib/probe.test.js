import { test, expect, vi } from 'vitest'
import { probeCapabilities, _resetCache } from '../../lib/probe.js'

function makeCtx(overrides = {}) {
  return {
    tools: {}, skills: {}, systemPrompt: {}, commands: {},
    storage: overrides.storage,           // undefined 表示缺失
    ...overrides.extra,
  }
}

test('全服务可用时全部 ok', async () => {
  _resetCache()
  const report = await probeCapabilities(makeCtx({ storage: { async get() {} } }))
  expect(report.core.status).toBe('ok')
  expect(report.storage.status).toBe('ok')
})

test('storage 缺失时降级为 unavailable 且不抛异常', async () => {
  _resetCache()
  const report = await probeCapabilities(makeCtx({ storage: undefined }))
  expect(report.storage.status).toBe('unavailable')
  expect(report.core.status).toBe('ok')   // inject 保证的服务不实测
})

test('探测函数超时报 timeout 态', async () => {
  _resetCache()
  const slow = () => new Promise(r => setTimeout(r, 10_000))
  const report = await probeCapabilities(makeCtx({ storage: { get: slow } }), { timeoutMs: 50 })
  expect(report.storage.status).toBe('timeout')
})

test('结果有模块级缓存：同进程第二次调用不重复执行探测', async () => {
  _resetCache()
  const get = vi.fn()
  const ctx = makeCtx({ storage: { get } })
  await probeCapabilities(ctx)
  await probeCapabilities(ctx)
  expect(get).toHaveBeenCalledTimes(1)
})

test('storage 探测抛异常归为 failure', async () => {
  _resetCache()
  const ctx = makeCtx({ storage: { async get() { throw new Error('backend down') } } })
  const report = await probeCapabilities(ctx)
  expect(report.storage.status).toBe('failure')
  expect(report.storage.detail).toContain('backend down')
})
