// tests/lib/commands.test.js
import { test, expect, vi } from 'vitest'
import { registerCommands } from '../../lib/commands.js'

function makeCtx() {
  const registered = []
  return {
    registered,
    ctx: { commands: { register: (def) => { registered.push(def); return () => {} } } },
  }
}

test('注册 omd-doctor 与 omd-cancel 两个命令', () => {
  const { ctx, registered } = makeCtx()
  registerCommands(ctx)
  expect(registered.map(c => c.name).sort()).toEqual(['omd-cancel', 'omd-doctor'])
  for (const c of registered) expect(c.name).toMatch(/^[a-z][a-z0-9_-]*$/)  // 宿主命名正则
})

test('omd-doctor handler 注入引导消息并返回 success', () => {
  const { ctx, registered } = makeCtx()
  registerCommands(ctx)
  const followup = vi.fn()
  const r = registered.find(c => c.name === 'omd-doctor')
    .handler({ rawInput: '', agent: { followup } })
  expect(r.kind).toBe('success')
  expect(followup).toHaveBeenCalledTimes(1)
  const msg = followup.mock.calls[0][0]
  expect(JSON.stringify(msg)).toContain('omd-doctor')
})

test('omd-cancel 注入取消指令（goal pause + state_clear 指引）', () => {
  const { ctx, registered } = makeCtx()
  registerCommands(ctx)
  const followup = vi.fn()
  const r = registered.find(c => c.name === 'omd-cancel')
    .handler({ rawInput: '', agent: { followup } })
  expect(r.kind).toBe('success')
  expect(JSON.stringify(followup.mock.calls[0][0])).toMatch(/state_clear|update_goal/)
})
