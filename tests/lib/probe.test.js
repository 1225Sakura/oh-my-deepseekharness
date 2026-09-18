import { test, expect } from 'vitest'
import { probeCapabilities, _resetCache } from '../../lib/probe.js'

function makeCtx(overrides = {}) {
  return {
    tools: {}, skills: {}, systemPrompt: {}, commands: {},
    storage: overrides.storage,           // undefined 表示缺失
    ...overrides.extra,
  }
}

// mock 对齐宿主真实 API（§7-7 核验）：ctx.storage.domain.open(spec) → Promise<Domain>
const realStorage = () => ({ domain: { async open() {} } })

test('全服务可用时全部 ok', async () => {
  _resetCache()
  const report = await probeCapabilities(makeCtx({ storage: realStorage() }))
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
  // domain 是永不 resolve 的 thenable：探测 await 它时挂起 → 超时
  const hanging = { get domain() { return new Promise(() => {}) } }
  const report = await probeCapabilities(makeCtx({ storage: hanging }), { timeoutMs: 50 })
  expect(report.storage.status).toBe('timeout')
})

test('结果有模块级缓存：同进程第二次调用不重复执行探测', async () => {
  _resetCache()
  let accesses = 0
  const storage = { get domain() { accesses++; return { async open() {} } } }
  const ctx = makeCtx({ storage })
  await probeCapabilities(ctx)
  await probeCapabilities(ctx)
  expect(accesses).toBe(1)
})

test('storage 探测抛异常归为 failure', async () => {
  _resetCache()
  const ctx = makeCtx({ storage: { get domain() { throw new Error('backend down') } } })
  const report = await probeCapabilities(ctx)
  expect(report.storage.status).toBe('failure')
  expect(report.storage.detail).toContain('backend down')
})

test('storage 存在但非 domain API 形态归为 failure', async () => {
  _resetCache()
  const ctx = makeCtx({ storage: { async get() {} } })   // 旧臆想 API 形状
  const report = await probeCapabilities(ctx)
  expect(report.storage.status).toBe('failure')
  expect(report.storage.detail).toContain('domain.open')
})
