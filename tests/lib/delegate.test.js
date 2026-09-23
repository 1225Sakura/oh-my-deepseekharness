// tests/lib/delegate.test.js
// c1 实现验收（台账 m3-advance S8，T4② 补写判据逐行落槽）：
// C1 前置：档位 id 对齐部署 LLM（config 默认 glm-5.3-flash）+ 不可用 id 派发前显式报错不静默继承
// C2 档位/model 参数经 spawn 路径派发（差分：可用 id 成功非空 / 无效 id 显式失败；宿主 e2e 落 evidence/S8）
// C3 表上限钳制联动 c3（派发档位 ≤ 表定上限；档位经 Config.tiers 映射）
import { test, expect } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Config } from '../../lib/config.js'
import { buildRoutingTable } from '../../lib/routing.js'
import {
  DELEGATE_PROVIDER, resolveDispatch, parentRouteForDelegation, registerDelegateTool,
} from '../../lib/delegate.js'

/** 可解析路由集合（模拟部署 LLM 服务：glm 系活、deepseek 系死——S1 差分证据同款）。 */
const VALID_ROUTES = [
  { provider: 'glm', model: 'glm-5.3-flash' },
  { provider: 'deepseek-official', model: 'glm-5.3-flash' },
]

function makeFakes({ validRoutes = VALID_ROUTES, childText = 'OK-DELEGATE' } = {}) {
  const calls = { preflight: [], start: [] }
  const llm = {
    async resolveCallConfig(config) {
      calls.preflight.push(config)
      const hit = validRoutes.some(r => r.provider === config.provider && r.model === config.model)
      if (!hit) throw new Error(`model "${config.provider}/${config.model}" is not resolvable`)
      return config
    },
  }
  const subagents = {
    getProvider: name => name === DELEGATE_PROVIDER ? { name } : undefined,
    list: () => [DELEGATE_PROVIDER],
    async start(name, request) {
      calls.start.push({ name, request })
      return {
        id: 'child-1',
        result: Promise.resolve({ output: [{ type: 'text', text: childText }], stopReason: 'completed' }),
        dispose: async () => { calls.disposed = (calls.disposed ?? 0) + 1 },
      }
    },
  }
  const parent = {
    session: { requestHeader: () => ({ config: { provider: 'glm', model: 'glm-5.3-flash', reasoningEffort: 'high' } }) },
    options: { maxTokens: 4096 },
  }
  return { calls, llm, subagents, parent }
}

/** 注册工具并返回捕获的定义 + fake ctx。 */
async function setupTool({ config, roles = [{ name: 'omd-agent-explore', tier: 'low' }, { name: 'omd-agent-planner', tier: 'high' }], ...fakeOpts } = {}) {
  const fakes = makeFakes(fakeOpts)
  let captured
  const ctx = { tools: { register(def) { captured = def } }, logger: { info() {}, warn() {} } }
  await registerDelegateTool(ctx, def => def, {
    config: config ?? Config.parse({}),
    roles,
    subagents: fakes.subagents,
    llm: fakes.llm,
  })
  return { ...fakes, def: captured }
}

const TABLE = buildRoutingTable([
  { name: 'omd-agent-explore', tier: 'low' },
  { name: 'omd-agent-planner', tier: 'high' },
])

// ---- resolveDispatch 纯判定 ----

test('resolveDispatch：显式 model 一等硬指定（tier=null 不经档位表；日志行键控 dispatch id）', () => {
  const d = resolveDispatch({ config: Config.parse({}), table: TABLE, args: { model: 'glm-5.3-flash' }, dispatchId: 'x-1' })
  expect(d.explicit).toBe(true)
  expect(d.modelId).toBe('glm-5.3-flash')
  expect(d.tier).toBeNull()
  expect(d.fallback).toBe(false)
  expect(d.logLine).toContain('dispatch=x-1')
  expect(d.logLine).toContain('explicit model=glm-5.3-flash')
})

test('resolveDispatch：表上限钳制联动（cap=low + tier=high → 档位钳到 low、fallback=false）', () => {
  const d = resolveDispatch({ config: Config.parse({}), table: TABLE, args: { role: 'omd-agent-explore', tier: 'high' }, dispatchId: 'x-2' })
  expect(d.clamped).toBe(true)
  expect(d.tier).toBe('low')
  expect(d.tableTier).toBe('low')
  expect(d.fallback).toBe(false)
  expect(d.logLine).toContain('clamped')
})

test('resolveDispatch：表外角色 → 会话默认档 + fallback=true（c3-C3 语义沿用）', () => {
  const d = resolveDispatch({ config: Config.parse({}), table: TABLE, args: { role: 'omd-agent-nosuch', tier: 'high' }, dispatchId: 'x-3' })
  expect(d.fallback).toBe(true)
  expect(d.tier).toBe('medium')
  expect(d.logLine).toContain('fallback=true')
})

test('resolveDispatch：无 role 无表可钳 → 落请求档/默认档，非 fallback', () => {
  const a = resolveDispatch({ config: Config.parse({}), table: TABLE, args: { tier: 'high' }, dispatchId: 'x-4' })
  expect(a.tier).toBe('high')
  expect(a.fallback).toBe(false)
  const b = resolveDispatch({ config: Config.parse({}), table: TABLE, args: {}, dispatchId: 'x-5' })
  expect(b.tier).toBe('medium')
  expect(b.fallback).toBe(false)
})

test('resolveDispatch：非法参数显式抛错（tier 非法/model 空串/provider 缺 model）', () => {
  const base = { config: Config.parse({}), table: TABLE }
  expect(() => resolveDispatch({ ...base, args: { tier: 'ultra' }, dispatchId: 'x-6' })).toThrow(/tier/)
  expect(() => resolveDispatch({ ...base, args: { model: '' }, dispatchId: 'x-7' })).toThrow(/model/)
  expect(() => resolveDispatch({ ...base, args: { provider: 'glm' }, dispatchId: 'x-8' })).toThrow(/provider/)
})

// ---- 工具装配：spawn 路径差分（单元面；宿主 e2e 落 evidence/S8） ----

test('omd_delegate：显式可用 id → preflight 校验后经 spawn 派发，agentOptions 硬路由，返回非空文本', async () => {
  const { def, calls } = await setupTool()
  const out = await def.execute({ description: '探针', prompt: '只输出 OK-DELEGATE', model: 'glm-5.3-flash' }, { agent: makeFakes().parent })
  expect(calls.preflight).toEqual([{ provider: 'glm', model: 'glm-5.3-flash' }])
  expect(calls.start).toHaveLength(1)
  expect(calls.start[0].name).toBe(DELEGATE_PROVIDER)
  expect(calls.start[0].request.agentOptions).toEqual({ provider: 'glm', model: 'glm-5.3-flash' })
  expect(calls.start[0].request.parent).toBeTruthy()
  expect(out.ok).toBe(true)
  expect(out.model).toBe('glm-5.3-flash')
  expect(out.text).toBe('OK-DELEGATE')
  expect(out.logLine).toContain('explicit model=glm-5.3-flash')
  expect(calls.disposed).toBe(1) // 前台派发必释放 run
})

test("omd_delegate：显式不可用 id（deepseek-*）→ 派发前显式失败、绝不静默继承、零 spawn", async () => {
  const { def, calls } = await setupTool()
  await expect(def.execute({ description: '负例', prompt: 'x', model: 'deepseek-reasoner' }, { agent: makeFakes().parent }))
    .rejects.toThrow(/deepseek-reasoner/)
  expect(calls.preflight).toHaveLength(1)
  expect(calls.start).toHaveLength(0)
})

test('C3 钳制联动 e2e 面：档位经 Config.tiers 映射——high 映射不可用 id 时显式失败；同请求被表钳到 low 后成功', async () => {
  // 部署覆写场景：high=deepseek-chat（不可解析）、low=glm-5.3-flash（可解析）
  const config = Config.parse({ tiers: { low: 'glm-5.3-flash', medium: 'glm-5.3-flash', high: 'deepseek-chat' } })
  const negative = await setupTool({ config })
  await expect(negative.def.execute({ description: '负例', prompt: 'x', tier: 'high' }, { agent: negative.parent }))
    .rejects.toThrow(/deepseek-chat/)
  expect(negative.calls.start).toHaveLength(0)
  // 同一档位请求 + 表定上限 low 的角色 → 钳到 low → 映射 glm-5.3-flash → spawn 成功
  const positive = await setupTool({ config })
  const out = await positive.def.execute(
    { description: '正例', prompt: 'x', tier: 'high', role: 'omd-agent-explore' },
    { agent: positive.parent })
  expect(positive.calls.start[0].request.agentOptions).toEqual({ provider: 'glm', model: 'glm-5.3-flash' })
  expect(out.tier).toBe('low')
  expect(out.clamped).toBe(true)
})

test('档位路径 roleOverrides 优先于 tiers（映射回退面）', async () => {
  const config = Config.parse({ tiers: { low: 'glm-5.3-flash', medium: 'glm-5.3-flash', high: 'glm-5.3-flash' }, roleOverrides: { 'omd-agent-explore': 'inherit' } })
  const { def, calls } = await setupTool({ config })
  const out = await def.execute({ description: 'x', prompt: 'x', tier: 'low', role: 'omd-agent-explore' }, { agent: makeFakes().parent })
  expect(calls.start[0].request.agentOptions).toBeUndefined() // 'inherit' → 不带 agentOptions（显式配置值，非静默回退）
  expect(calls.preflight).toHaveLength(0)
  expect(out.model).toBeUndefined()
})

test('provider 缺席 → 显式报错并列出已注册 provider（不猜测）', async () => {
  const fakes = makeFakes()
  fakes.subagents.getProvider = () => undefined
  let captured
  const ctx = { tools: { register(def) { captured = def } }, logger: { info() {}, warn() {} } }
  await registerDelegateTool(ctx, def => def, { config: Config.parse({}), roles: [], subagents: fakes.subagents, llm: fakes.llm })
  await expect(captured.execute({ description: 'x', prompt: 'x', model: 'glm-5.3-flash' }, { agent: makeFakes().parent }))
    .rejects.toThrow(/spawn.*未注册/)
})

test('ctx.subagents 缺席 → 注册即抛错（index.js 降级记 probeReport）', async () => {
  const ctx = { tools: { register() {} }, logger: { info() {}, warn() {} } }
  await expect(registerDelegateTool(ctx, def => def, { config: Config.parse({}), roles: [] }))
    .rejects.toThrow(/subagents 服务缺席/)
})

test('c3 fallback 审计：表外角色派发 → run-state.json 记 fallback:true（临时目录，零触碰日常 .omd）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omd-s8-'))
  try {
    const config = Config.parse({ stateDir: dir }) // 绝对路径直落临时目录
    const { def, calls } = await setupTool({ config })
    const out = await def.execute({ description: 'x', prompt: 'x', role: 'omd-agent-nosuch', tier: 'low' }, { agent: makeFakes().parent })
    expect(out.fallback).toBe(true)
    const state = JSON.parse(await readFile(join(dir, '.omd', 'state', 'run-state.json'), 'utf8'))
    expect(state.fallback).toBe(true)
    expect(state.lastFallback.role).toBe('omd-agent-nosuch')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('子代理非 completed → 显式失败（含 diagnostic）', async () => {
  const fakes = makeFakes()
  fakes.subagents.start = async () => ({
    id: 'child-2',
    result: Promise.resolve({ output: [], stopReason: 'error', diagnostic: 'boom' }),
    dispose: async () => {},
  })
  let captured
  const ctx = { tools: { register(def) { captured = def } }, logger: { info() {}, warn() {} } }
  await registerDelegateTool(ctx, def => def, { config: Config.parse({}), roles: [], subagents: fakes.subagents, llm: fakes.llm })
  await expect(captured.execute({ description: 'x', prompt: 'x', model: 'glm-5.3-flash' }, { agent: makeFakes().parent }))
    .rejects.toThrow(/stopReason=error.*boom/s)
})

// ---- parentRouteForDelegation（parentAgentOptionsForDelegation 镜像） ----

test('parentRouteForDelegation：请求头 config 优先于创建 options（effort 透传）', () => {
  const parent = {
    session: { requestHeader: () => ({ config: { provider: 'p1', model: 'm1', reasoningEffort: 'mid' } }) },
    options: { provider: 'p0', model: 'm0', reasoningEffort: 'low', maxTokens: 8 },
  }
  expect(parentRouteForDelegation(parent)).toEqual({ maxTokens: 8, provider: 'p1', model: 'm1', reasoningEffort: 'mid' })
})

test('parentRouteForDelegation：无请求头 → 创建 options 兜底；缺字段不炸', () => {
  expect(parentRouteForDelegation({ session: {}, options: { provider: 'p0', model: 'm0' } })).toEqual({ provider: 'p0', model: 'm0' })
  expect(parentRouteForDelegation(undefined)).toEqual({})
})

// ---- 输出契约 ----

test('output.render：成功 = 路由日志行 + 子代理文本；失败 = 可读提示（不抛 TypeError）', async () => {
  const { def } = await setupTool()
  const ok = def.output.render({}, { ok: true, logLine: '[routing] dispatch=d', text: 'BODY' })
  expect(ok).toEqual([{ type: 'text', text: '[routing] dispatch=d\nBODY' }])
  const bad = def.output.render({}, { ok: false })
  expect(bad[0].type).toBe('text')
  expect(typeof bad[0].text).toBe('string')
})
