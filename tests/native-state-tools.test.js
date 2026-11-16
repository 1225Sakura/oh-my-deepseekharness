// tests/native-state-tools.test.js
// 一期 dsh-native 改造测试：进程内工具注册面（lib/state-tools.js）。
// 覆盖：收集器规格计数、zod→描述符编译、cwd/sessionId 自动派生、显式 cwd 覆盖、zod 校验拒绝。
import { test, expect } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildEnv, collectSpecs, shapeToParameters, registerStateTools } from '../lib/state-tools.js'

const identityDefineTool = def => def

test('collectSpecs 捕获 58 个工具规格（与 omd-doctor 计数契约一致）', () => {
  const specs = collectSpecs(buildEnv({}))
  expect(specs.length).toBe(58)
  const names = specs.map(s => s.name)
  for (const required of ['state_write', 'state_get_status', 'notepad_write_priority', 'team_begin', 'trace_begin', 'hud_render', 'graph_run', 'ast_grep_search'])
    expect(names).toContain(required)
  expect(names.every(n => !n.startsWith('omd_'))).toBe(true) // 绑定层保持裸名，前缀在适配器加
})

test('shapeToParameters：sessionId 剔除、cwd 降级可选、required 收缩、jsonKeys 收集', () => {
  const specs = collectSpecs(buildEnv({}))
  const writeSpec = specs.find(s => s.name === 'state_write')
  const { parameters: params, jsonKeys } = shapeToParameters(writeSpec.inputSchema)
  expect(jsonKeys).toContain('state')
  expect(params.sessionId).toBeUndefined()
  expect(params.cwd).toBeDefined()
  expect(params.cwd.required).toBeUndefined()
  expect(params.mode.required).toBe(true)
  expect(params.state.type).toBe('json')
  expect(params.expectUpdatedAt.type).toBe('string')
  expect(params.expectUpdatedAt.required).toBeUndefined()
})

test('json 形态参数以字符串到达（OMC 字符串传输怪癖 DSH 重现）→ 宽容 parse', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omd-native-'))
  try {
    const registered = []
    const ctx = { tools: { register: d => registered.push(d) } }
    await registerStateTools(ctx, identityDefineTool, { config: {} })
    const write = registered.find(t => t.name === 'omd_state_write')
    const exec = { agent: { session: { header: { cwd: dir, id: 'sess-D4' } } } }
    const res = await write.execute({ mode: 'autopilot', state: JSON.stringify({ active: true }) }, exec)
    expect(res).toEqual({ ok: true })
    const raw = JSON.parse(await readFile(join(dir, '.omd', 'state', 'sessions', 'sess-D4', 'autopilot-state.json'), 'utf8'))
    expect(raw.active).toBe(true)
    await expect(write.execute({ mode: 'autopilot', state: '{broken' }, exec)).rejects.toThrow(/参数校验失败.*state/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('registerStateTools 注册 58 个 omd_ 前缀工具且 execute 自动派生会话锚', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omd-native-'))
  try {
    const registered = []
    const ctx = { tools: { register: d => registered.push(d) } }
    const { count, tools } = await registerStateTools(ctx, identityDefineTool, { config: { stateDir: '.omd' } })
    expect(count).toBe(58)
    expect(registered.length).toBe(58)
    expect(tools).toContain('omd_state_write')
    expect(registered.every(t => t.name.startsWith('omd_'))).toBe(true)

    const write = registered.find(t => t.name === 'omd_state_write')
    const exec = { agent: { session: { header: { cwd: dir, id: 'sess-A1' } } } }
    const res = await write.execute({ mode: 'autopilot', state: { active: true, current_phase: 'running' } }, exec)
    expect(res).toEqual({ ok: true })
    const raw = JSON.parse(await readFile(join(dir, '.omd', 'state', 'sessions', 'sess-A1', 'autopilot-state.json'), 'utf8'))
    expect(raw.active).toBe(true)
    expect(raw._meta.sessionId).toBe('sess-A1')

    const read = registered.find(t => t.name === 'omd_state_read')
    const back = await read.execute({ mode: 'autopilot' }, exec)
    expect(back.active).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('显式 cwd 覆盖会话锚（多仓/worktree 场景）', async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), 'omd-session-'))
  const anchorDir = await mkdtemp(join(tmpdir(), 'omd-anchor-'))
  try {
    const registered = []
    const ctx = { tools: { register: d => registered.push(d) } }
    await registerStateTools(ctx, identityDefineTool, { config: {} })
    const write = registered.find(t => t.name === 'omd_state_write')
    const exec = { agent: { session: { header: { cwd: sessionDir, id: 'sess-B2' } } } }
    await write.execute({ cwd: anchorDir, mode: 'ralph', state: { active: true } }, exec)
    const raw = JSON.parse(await readFile(join(anchorDir, '.omd', 'state', 'sessions', 'sess-B2', 'ralph-state.json'), 'utf8'))
    expect(raw._meta.sessionId).toBe('sess-B2')
    // 会话目录不应被写入（cwd 覆盖语义：锚落显式目录）
    await expect(readFile(join(sessionDir, '.omd', 'state', 'sessions', 'sess-B2', 'ralph-state.json'))).rejects.toThrow()
  } finally {
    await rm(sessionDir, { recursive: true, force: true })
    await rm(anchorDir, { recursive: true, force: true })
  }
})

test('会话锚缺失且无 cwd 参数 → 显式报错（不静默落宿主 cwd）', async () => {
  const registered = []
  const ctx = { tools: { register: d => registered.push(d) } }
  await registerStateTools(ctx, identityDefineTool, { config: {} })
  const write = registered.find(t => t.name === 'omd_state_write')
  await expect(write.execute({ mode: 'autopilot', state: { active: true } }, { agent: undefined }))
    .rejects.toThrow(/无法确定工作区锚/)
})

test('zod 校验：缺失必填参数被拒（含路径级违规信息）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omd-zod-'))
  try {
    const registered = []
    const ctx = { tools: { register: d => registered.push(d) } }
    await registerStateTools(ctx, identityDefineTool, { config: {} })
    const write = registered.find(t => t.name === 'omd_state_write')
    const exec = { agent: { session: { header: { cwd: dir, id: 'sess-C3' } } } }
    await expect(write.execute({ state: { active: true } }, exec)) // 缺 mode
      .rejects.toThrow(/参数校验失败.*mode/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
