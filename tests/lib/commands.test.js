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

test('注册 omd / omd-doctor / omd-cancel 三个命令', async () => {
  const { ctx, registered } = makeCtx()
  await registerCommands(ctx, fakeCreateUserMessage)
  expect(registered.map(c => c.name).sort()).toEqual(['omd', 'omd-cancel', 'omd-doctor'])
  for (const c of registered) expect(c.name).toMatch(/^[a-z][a-z0-9_-]*$/)  // 宿主命名正则
})

test('S8 /omd 帮助：确定性直返（零 followup），含五模式 + 关键词 + 两条诊断命令', async () => {
  const { ctx, registered } = makeCtx()
  await registerCommands(ctx, fakeCreateUserMessage)
  const followup = vi.fn()
  const r = registered.find(c => c.name === 'omd')
    .handler({ rawInput: '', agent: { followup } })
  expect(r.kind).toBe('success')
  expect(followup).not.toHaveBeenCalled() // 非 prompt 空壳：不注入 LLM 往返
  for (const kw of ['autopilot', 'ralph', 'team', 'ralplan', 'deep-interview'])
    expect(r.text).toContain(kw)
  expect(r.text).toContain('/omd-doctor')
  expect(r.text).toContain('/omd-cancel')
  expect(r.text).toContain('omd HUD')
  expect(r.text).toContain('omd_memory_list')
})

test('S2 omd-doctor 确定性直出：probe 矩阵 + 会话锚 + .omd 实测；正常零 followup', async () => {
  const { ctx, registered } = makeCtx()
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const ws = await mkdtemp(join(tmpdir(), 'omd-doctor-'))
  try {
    await registerCommands(ctx, fakeCreateUserMessage, {
      probeReport: { core: { status: 'ok' }, mcpServer: { status: 'ok' } },
    })
    const followup = vi.fn()
    const doctor = registered.find(c => c.name === 'omd-doctor')
    const r = await doctor.handler({ rawInput: '', agent: { followup, session: { header: { cwd: ws } } } })
    expect(r.kind).toBe('success')
    expect(followup).not.toHaveBeenCalled() // 正常零 LLM 往返
    expect(r.text).toContain('能力矩阵')
    expect(r.text).toContain('.omd')
    expect(r.text).toContain('core: ok')
    expect(r.text).toContain('可写性：ok')
    expect(r.text).toContain('全部正常')
  } finally { await rm(ws, { recursive: true, force: true }) }
})

test('S2 omd-doctor 异常路径：failure 项触发 followup 请助手介入', async () => {
  const { ctx, registered } = makeCtx()
  await registerCommands(ctx, fakeCreateUserMessage, {
    probeReport: { core: { status: 'ok' }, mcpServer: { status: 'failure', detail: 'boom' } },
  })
  const followup = vi.fn()
  const r = await registered.find(c => c.name === 'omd-doctor')
    .handler({ rawInput: '', agent: { followup, session: { header: {} } } })
  expect(r.kind).toBe('success')
  expect(r.text).toContain('mcpServer: failure')
  expect(r.text).toContain('会话锚缺失')
  expect(followup).toHaveBeenCalledTimes(1) // 异常才 followup
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
  expect(registered).toHaveLength(3)
})
