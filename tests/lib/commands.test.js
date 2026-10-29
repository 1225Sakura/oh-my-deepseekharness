// tests/lib/commands.test.js
import { test, expect, vi } from 'vitest'
import { registerCommands, renderOmdHelpRoster, buildSkillRosterLines } from '../../lib/commands.js'

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
  const r = await registered.find(c => c.name === 'omd')
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

// ===== P1-W3-3：/omd 帮助面逐技能全名册（team eco-completion · w-P1-5b）=====

test('P1-W3-3 /omd 名册版：真实资产枚举 ≥43 技能行、含 tdd、字母序', async () => {
  const text = await renderOmdHelpRoster()
  expect(text).toContain('技能（逐技能全名册')
  const roster = text.split('\n').filter(l =>
    l.endsWith('（说出技能名调用）') || /（关键词 [^）]+）$/.test(l))
  expect(roster.length).toBeGreaterThanOrEqual(43)
  expect(text).toMatch(/  tdd：.*（关键词 tdd）/)
  const rosterSection = text.slice(text.indexOf('技能（逐技能全名册'))
  expect(rosterSection.indexOf('  analyze：')).toBeGreaterThan(-1)
  expect(rosterSection.indexOf('  analyze：')).toBeLessThan(rosterSection.indexOf('  wiki：'))
  expect(text).toContain('omd_memory_list') // 可见性区保留
})

test('P1-W3-3 枚举失败回落分组文案不崩', async () => {
  const text = await renderOmdHelpRoster({ readdir: async () => { throw new Error('boom') } })
  expect(text).toContain('质量：review / verify')
  expect(text).toContain('模式关键词（在会话输入中触发）：')
})

test('P1-W3-3 空名册回落分组文案', async () => {
  const text = await renderOmdHelpRoster({ readdir: async () => [] })
  expect(text).toContain('质量：review / verify')
})

test('P1-W3-3 名册行：首句截断 ≤40+…、读失败降级「—」、触发方式映射、字母序', async () => {
  const long = 'A'.repeat(60) + '。 second'
  const lines = await buildSkillRosterLines({
    readdir: async () => [
      { name: 'zz-fake', isDirectory: () => true },
      { name: 'aa-broken', isDirectory: () => true },
      { name: 'tdd', isDirectory: () => true },
      { name: 'wiki', isDirectory: () => true },
    ],
    readFile: async (p) => {
      if (String(p).includes('aa-broken')) throw new Error('nope')
      if (String(p).includes('zz-fake')) return `---\nname: zz-fake\ndescription: "${long}"\n---\nbody`
      return `---\nname: ok\ndescription: real desc here\n---\nbody`
    },
  })
  expect(lines).toHaveLength(4)
  expect(lines[0].startsWith('  aa-broken：')).toBe(true) // 字母序
  expect(lines.find(l => l.startsWith('  aa-broken：'))).toBe('  aa-broken：—（说出技能名调用）')
  const zz = lines.find(l => l.startsWith('  zz-fake：'))
  expect(zz).toContain('…')
  expect(zz.slice(0, zz.indexOf('（')).length).toBeLessThanOrEqual('  zz-fake：'.length + 41)
  expect(lines.find(l => l.startsWith('  tdd：'))).toContain('（关键词 tdd）')
  expect(lines.find(l => l.startsWith('  wiki：'))).toContain('（关键词 wiki）')
})
