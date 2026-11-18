// tests/native-state-tools.test.js
// 一期 dsh-native 改造测试：进程内工具注册面（lib/state-tools.js）。
// 覆盖：收集器规格计数、zod→描述符编译、cwd/sessionId 自动派生、显式 cwd 覆盖、zod 校验拒绝。
// 二期②：注册面接 storageDomain 域（mock storage），state/hud 依赖面经 env.table 注入。
import { test, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildEnv, collectSpecs, shapeToParameters, registerStateTools } from '../lib/state-tools.js'
import { stateKey } from '../lib/state-domain.js'
import { projectKey } from '../lib/memory.js'

const identityDefineTool = def => def

function mockCtx() {
  const registered = []
  const m = new Map()
  const table = {
    get: k => m.get(k),
    put: async (k, v) => { m.set(k, v) },
    delete: async k => m.delete(k),
    keys: () => [...m.keys()],
  }
  const ctx = {
    tools: { register: d => registered.push(d) },
    storage: { domain: { open: async () => ({ table: () => table, async close() {} }) } },
  }
  return { ctx, registered, table }
}

const FULL_TABLE = { get() {}, put: async () => {}, delete: async () => {}, keys: () => [] }

test('collectSpecs 捕获 34 个工具规格（与 omd-doctor 计数契约一致）', () => {
  const { specs, failures } = collectSpecs({ ...buildEnv({}), table: FULL_TABLE })
  expect(specs.length).toBe(34)
  expect(failures).toHaveLength(0)
  const names = specs.map(s => s.name)
  for (const required of ['state_write', 'state_get_status', 'notepad_write_priority', 'trace_begin', 'hud_render', 'ast_grep_search'])
    expect(names).toContain(required)
  expect(names.every(n => !n.startsWith('omd_'))).toBe(true) // 绑定层保持裸名，前缀在适配器加
})

test('collectSpecs 模块级容错：env.table 缺席 → state/hud 两模块进 failures，其余照常（team 已退役）', () => {
  const { specs, failures } = collectSpecs(buildEnv({}))
  expect(specs.length).toBe(27) // 58 - state×5 - hud×2
  expect(failures).toHaveLength(2)
  expect(specs.every(s => !s.name.startsWith('state_') && !s.name.startsWith('hud_'))).toBe(true)
})

test('shapeToParameters：sessionId 剔除、cwd 降级可选、required 收缩、jsonKeys 收集', () => {
  const { specs } = collectSpecs({ ...buildEnv({}), table: FULL_TABLE })
  const writeSpec = specs.find(s => s.name === 'state_write')
  const { parameters, jsonKeys } = shapeToParameters(writeSpec.inputSchema)
  expect(parameters.sessionId).toBeUndefined()
  expect(parameters.cwd).toBeDefined()
  expect(parameters.cwd.required).toBeUndefined()
  expect(parameters.mode.required).toBe(true)
  expect(parameters.state.type).toBe('json')
  expect(parameters.expectUpdatedAt.type).toBe('string')
  expect(parameters.expectUpdatedAt.required).toBeUndefined()
  expect(jsonKeys).toContain('state')
})

test('registerStateTools 注册 34 个 omd_ 前缀工具且 execute 自动派生会话锚（写进域表）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omd-native-'))
  try {
    const { ctx, registered, table } = mockCtx()
    const { count, tools, status } = await registerStateTools(ctx, identityDefineTool, { config: { stateDir: '.omd' } })
    expect(count).toBe(34)
    expect(status).toBe('ok')
    expect(registered.length).toBe(34)
    expect(tools).toContain('omd_state_write')
    expect(registered.every(t => t.name.startsWith('omd_'))).toBe(true)

    const write = registered.find(t => t.name === 'omd_state_write')
    const exec = { agent: { session: { header: { cwd: dir, id: 'sess-A1' } } } }
    const res = await write.execute({ mode: 'autopilot', state: { active: true, current_phase: 'running' } }, exec)
    expect(res).toEqual({ ok: true })
    // 域表直查（不再落 .omd 文件）：键 = projectKey(cwd):mode:sessionId
    const raw = table.get(`${projectKey(dir)}:autopilot:sess-A1`)
    expect(raw.active).toBe(true)
    expect(raw._meta.sessionId).toBe('sess-A1')

    const read = registered.find(t => t.name === 'omd_state_read')
    const back = await read.execute({ mode: 'autopilot' }, exec)
    expect(back.active).toBe(true)
    expect(await read.execute({ mode: 'nonexistent-mode' }, exec)).toEqual({ exists: false })
    // 键拼装 sanity：与 state-domain 单源一致
    expect(table.keys()).toContain(stateKey(dir, 'autopilot', 'sess-A1'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('显式 cwd 覆盖会话锚（多仓/worktree 场景）', async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), 'omd-session-'))
  const anchorDir = await mkdtemp(join(tmpdir(), 'omd-anchor-'))
  try {
    const { ctx, registered, table } = mockCtx()
    await registerStateTools(ctx, identityDefineTool, { config: {} })
    const write = registered.find(t => t.name === 'omd_state_write')
    const exec = { agent: { session: { header: { cwd: sessionDir, id: 'sess-B2' } } } }
    await write.execute({ cwd: anchorDir, mode: 'ralph', state: { active: true } }, exec)
    expect(table.get(`${projectKey(anchorDir)}:ralph:sess-B2`).active).toBe(true) // 落锚目录
    expect(table.keys().filter(k => k.startsWith(projectKey(sessionDir)))).toHaveLength(0) // 会话锚目录不写
  } finally {
    await rm(sessionDir, { recursive: true, force: true })
    await rm(anchorDir, { recursive: true, force: true })
  }
})

test('会话锚缺失且无 cwd 参数 → 显式报错（不静默落宿主 cwd）', async () => {
  const { ctx, registered } = mockCtx()
  await registerStateTools(ctx, identityDefineTool, { config: {} })
  const write = registered.find(t => t.name === 'omd_state_write')
  await expect(write.execute({ mode: 'autopilot', state: { active: true } }, { agent: undefined }))
    .rejects.toThrow(/无法确定工作区锚/)
})

test('zod 校验：缺失必填参数被拒（含路径级违规信息）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omd-zod-'))
  try {
    const { ctx, registered } = mockCtx()
    await registerStateTools(ctx, identityDefineTool, { config: {} })
    const write = registered.find(t => t.name === 'omd_state_write')
    const exec = { agent: { session: { header: { cwd: dir, id: 'sess-C3' } } } }
    await expect(write.execute({ state: { active: true } }, exec)) // 缺 mode
      .rejects.toThrow(/参数校验失败.*mode/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('storage 缺席 → state/hud 依赖面 skipped、其余注册、status=skipped', async () => {
  const registered = []
  const ctx = { tools: { register: d => registered.push(d) } } // 无 storage
  const r = await registerStateTools(ctx, identityDefineTool, { config: {} })
  expect(r.status).toBe('skipped')
  expect(r.count).toBe(27)
  expect(r.table).toBeNull()
  expect(registered.every(t => t.name !== 'omd_state_write' && t.name !== 'omd_hud_render')).toBe(true)
  expect(r.detail).toContain('storageDomain 域未接入')
})
