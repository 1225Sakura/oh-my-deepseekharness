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

// 注入假 createUserMessage（identity），避免单测依赖宿主包
const fakeCreateUserMessage = (msg) => msg

test('注册 omd-doctor 与 omd-cancel 两个命令', async () => {
  const { ctx, registered } = makeCtx()
  await registerCommands(ctx, fakeCreateUserMessage)
  expect(registered.map(c => c.name).sort()).toEqual(['omd-cancel', 'omd-doctor'])
  for (const c of registered) expect(c.name).toMatch(/^[a-z][a-z0-9_-]*$/)  // 宿主命名正则
})

test('omd-doctor handler 注入引导消息并返回 success', async () => {
  const { ctx, registered } = makeCtx()
  await registerCommands(ctx, fakeCreateUserMessage)
  const followup = vi.fn()
  const r = registered.find(c => c.name === 'omd-doctor')
    .handler({ rawInput: '', agent: { followup } })
  expect(r.kind).toBe('success')
  expect(followup).toHaveBeenCalledTimes(1)
  const msg = followup.mock.calls[0][0]
  expect(JSON.stringify(msg)).toContain('omd-doctor')
})

test('omd-cancel 注入取消指令（get_goal 前置 + goal pause + state_clear 指引）', async () => {
  const { ctx, registered } = makeCtx()
  await registerCommands(ctx, fakeCreateUserMessage)
  const followup = vi.fn()
  const r = registered.find(c => c.name === 'omd-cancel')
    .handler({ rawInput: '', agent: { followup } })
  expect(r.kind).toBe('success')
  const payload = JSON.stringify(followup.mock.calls[0][0])
  expect(payload).toMatch(/state_clear|update_goal/)
  expect(payload).toContain('get_goal')   // update_goal 必须带 goal_id/revision，先 get_goal
})

test('默认路径动态 import @deepseek-ai/dsh-llm（devDep 已装，可解析）', async () => {
  const { ctx, registered } = makeCtx()
  await registerCommands(ctx)   // 不传注入 → 走动态 import 真实包
  expect(registered).toHaveLength(2)
})
