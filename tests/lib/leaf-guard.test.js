// tests/lib/leaf-guard.test.js
// 二期 dsh-native 切片：机械 leaf-guard（agent/created + delegationDepth → agent.ctx.tools.restrict）。
import { test, expect } from 'vitest'
import { registerLeafGuard, isLeafAgent } from '../../lib/leaf-guard.js'

function makeAgent({ delegationDepth, origin, id = 'sess-1' } = {}) {
  const restrictions = []
  const header = {}
  if (delegationDepth !== undefined) header.delegationDepth = delegationDepth
  if (origin !== undefined) header.origin = origin
  header.id = id
  const agentCtx = { tools: { restrict: (filter) => { restrictions.push(filter); return () => restrictions.pop() } } }
  const agent = { session: { header }, ctx: agentCtx }
  return { agent, agentCtx, restrictions }
}

function captureListener(ctx) {
  const listeners = {}
  ctx.on = (name, fn) => { listeners[name] = fn }
  return listeners
}

test('leaf 作用域（delegationDepth>0）→ agent.ctx.tools.restrict 挂 deny 名单', async () => {
  const ctx = { on: () => {}, effect: () => {}, logger: { info() {}, warn() {} } }
  const listeners = captureListener(ctx)
  await registerLeafGuard(ctx)
  const { agent, restrictions } = makeAgent({ delegationDepth: 1 })
  listeners['agent/created']({ agent })
  expect(restrictions).toHaveLength(1)
  expect(restrictions[0].deny).toContain('omd_delegate')
  expect(restrictions[0].deny).toContain('omd_team_begin')
  // 队员作业面必须保留可见
  expect(restrictions[0].deny).not.toContain('omd_team_worker_update')
  expect(restrictions[0].deny).not.toContain('omd_team_mail_send')
  expect(restrictions[0].deny).not.toContain('omd_state_write')
})

test('顶层会话（delegationDepth 缺席/0）→ 零成本直通', async () => {
  const ctx = { on: () => {}, logger: { info() {}, warn() {} } }
  const listeners = captureListener(ctx)
  await registerLeafGuard(ctx)
  const top = makeAgent({})
  listeners['agent/created']({ agent: top.agent })
  const zero = makeAgent({ delegationDepth: 0 })
  listeners['agent/created']({ agent: zero.agent })
  expect(top.restrictions).toHaveLength(0)
  expect(zero.restrictions).toHaveLength(0)
})

test('origin=subagent 同样归 leaf（畸形头防御面）', async () => {
  const ctx = { on: () => {}, logger: { info() {}, warn() {} } }
  const listeners = captureListener(ctx)
  await registerLeafGuard(ctx)
  const { agent, restrictions } = makeAgent({ origin: 'subagent' })
  listeners['agent/created']({ agent })
  expect(restrictions).toHaveLength(1)
})

test('重挂防御：同 sessionId 重建先 dispose 旧限制再挂新份；插件 effect 解除全部', async () => {
  const effects = []
  const ctx = { on: () => {}, effect: (fn) => effects.push(fn), logger: { info() {}, warn() {} } }
  const listeners = captureListener(ctx)
  await registerLeafGuard(ctx)
  const first = makeAgent({ delegationDepth: 2, id: 'sess-R' })
  listeners['agent/created']({ agent: first.agent })
  expect(first.restrictions).toHaveLength(1)
  // 同 id 重建：旧 disposer 被调用（restrictions 弹出一份），新限制再挂
  const second = makeAgent({ delegationDepth: 2, id: 'sess-R' })
  listeners['agent/created']({ agent: second.agent })
  expect(first.restrictions).toHaveLength(0)   // 旧份已解除
  expect(second.restrictions).toHaveLength(1)  // 新份在场
  // 插件 effect（第二 owner）：解除全部 per-agent 限制
  expect(effects).toHaveLength(1)
  const cleanup = effects[0]()
  cleanup()
  expect(second.restrictions).toHaveLength(0)
})

test('agentCtx 形状不满足 → warn 降级不抛错；isLeafAgent 对畸形头失效方向=顶层', async () => {
  const warns = []
  const ctx = { on: () => {}, logger: { info() {}, warn: (m) => warns.push(m) } }
  const listeners = captureListener(ctx)
  await registerLeafGuard(ctx)
  const noCtx = { session: { header: { delegationDepth: 1, id: 'sess-X' } } } // 无 ctx
  expect(() => listeners['agent/created']({ agent: noCtx })).not.toThrow()
  expect(warns.some(m => m.includes('leaf 作用域缺'))).toBe(true)
  expect(() => listeners['agent/created']({})).not.toThrow()
  expect(isLeafAgent(undefined)).toBe(false)
  expect(isLeafAgent({ session: {} })).toBe(false)
  expect(isLeafAgent({ session: { header: { delegationDepth: 3 } } })).toBe(true)
})

test('监听器缺 ctx.on → 注册抛错（与 keyword-hook 同款契约）', async () => {
  await expect(registerLeafGuard({})).rejects.toThrow(/ctx\.on/)
})
