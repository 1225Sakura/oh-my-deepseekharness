// tests/lib/delegate.test.js
// c1 实现验收（台账 m3-advance S8，T4② 补写判据逐行落槽）：
// C1 前置：档位值可解析时（U10 起默认 "inherit" 继承主会话；显式覆写 id 须部署可解析）派发前校验，不可用 id 显式报错不静默继承
// C2 档位/model 参数经 spawn 路径派发（差分：可用 id 成功非空 / 无效 id 显式失败；宿主 e2e 落 evidence/S8）
// C3 表上限钳制联动 c3（派发档位 ≤ 表定上限；档位经 Config.tiers 映射）
import { test, expect } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
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

/**
 * 注册工具并返回捕获的定义 + fake ctx + events 捕获数组。
 * F-6 测试卫生（U8 S1）：默认注入 recordRouteEvent 捕获器——execute 用例断言调用形状、
 * 零真实落盘（不写仓库活 .omd/state/events.jsonl）；injectEvents:false 走真实落盘（M1 回归专用）。
 */
async function setupTool({ config, roles = [{ name: 'omd-agent-explore', tier: 'low' }, { name: 'omd-agent-planner', tier: 'high' }], injectEvents = true, ...fakeOpts } = {}) {
  const fakes = makeFakes(fakeOpts)
  const events = []
  let captured
  const ctx = { tools: { register(def) { captured = def } }, logger: { info() {}, warn() {} } }
  await registerDelegateTool(ctx, def => def, {
    config: config ?? Config.parse({}),
    roles,
    subagents: fakes.subagents,
    llm: fakes.llm,
    ...(injectEvents ? { recordRouteEvent: async e => { events.push(e) } } : {}),
  })
  return { ...fakes, def: captured, events }
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
  const { def, calls, events } = await setupTool()
  const out = await def.execute({ description: '探针', prompt: '只输出 OK-DELEGATE', model: 'glm-5.3-flash' }, { agent: makeFakes().parent })
  // U8 S1（AC-1）：恰一条 route 事件（捕获器断言调用形状，零真实落盘）；dispatchId=判定键控 id
  expect(events).toHaveLength(1)
  expect(events[0].kind).toBe('route')
  expect(events[0].decision.dispatchId).toBe(out.dispatchId)
  expect(events[0].decision.explicit).toBe(true)
  expect(events[0].decision.modelId).toBe('glm-5.3-flash')
  expect(events[0].cwd).toBe(process.cwd())
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
  const { def, calls, events } = await setupTool()
  await expect(def.execute({ description: '负例', prompt: 'x', model: 'deepseek-reasoner' }, { agent: makeFakes().parent }))
    .rejects.toThrow(/deepseek-reasoner/)
  expect(calls.preflight).toHaveLength(1)
  expect(calls.start).toHaveLength(0)
  // AC-1 语义声明：事件记录路由判定（挂钩点在 model 校验闸门之前，含后续失败车次）
  expect(events.map(e => e.kind)).toEqual(['route'])
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
  // F-6（U8 S1）：注入捕获器——事件=路由判定（闸门之前），负例也恰一条 route 事件、零真实落盘
  const events = []
  await registerDelegateTool(ctx, def => def, { config: Config.parse({}), roles: [], subagents: fakes.subagents, llm: fakes.llm, recordRouteEvent: async e => { events.push(e) } })
  await expect(captured.execute({ description: 'x', prompt: 'x', model: 'glm-5.3-flash' }, { agent: makeFakes().parent }))
    .rejects.toThrow(/spawn.*未注册/)
  expect(events.map(e => e.kind)).toEqual(['route'])
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
    const { def, events } = await setupTool({ config })
    const out = await def.execute({ description: 'x', prompt: 'x', role: 'omd-agent-nosuch', tier: 'low' }, { agent: makeFakes().parent })
    expect(out.fallback).toBe(true)
    // U8 S1（AC-2）：fallback 派发 → route+fallback 各一条同点落盘（同一 dispatchId）
    expect(events.map(e => e.kind)).toEqual(['route', 'fallback'])
    expect(events[0].decision.dispatchId).toBe(out.dispatchId)
    expect(events[1].decision.dispatchId).toBe(out.dispatchId)
    expect(events[1].decision.fallback).toBe(true)
    const state = JSON.parse(await readFile(join(dir, 'state', 'run-state.json'), 'utf8'))
    expect(state.fallback).toBe(true)
    expect(state.lastFallback.role).toBe('omd-agent-nosuch')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('M1 回归（相对 stateDir 形态）：默认部署审计落 <cwd>/.omd/state/ 权威路径，无 .omd/.omd 幻影嵌套', async () => {
  const config = Config.parse({}) // 默认相对 stateDir '.omd'——生产默认形态（第 2 轮评审 F-1：绝对夹具曾掩盖 cwd 错位）
  const eventsFile = join(process.cwd(), '.omd', 'state', 'events.jsonl')
  // F-6（U8 S1，Critic r3 MINOR-5）：events.jsonl 快照-恢复式清理——测试前存在则读内容测后写回，
  // 不存在则测后删除；不得整文件 rm 销毁 dev 活数据。injectEvents:false → 本用例走真实落盘。
  const eventsBefore = await readFile(eventsFile, 'utf8').catch(() => null)
  try {
    const { def } = await setupTool({ config, injectEvents: false })
    const out = await def.execute({ description: 'x', prompt: 'x', role: 'omd-agent-nosuch', tier: 'low' }, { agent: makeFakes().parent })
    expect(out.fallback).toBe(true)
    const authority = join(process.cwd(), '.omd', 'state', 'run-state.json')
    const state = JSON.parse(await readFile(authority, 'utf8'))
    expect(state.fallback).toBe(true)
    expect(state.lastFallback.role).toBe('omd-agent-nosuch')
    // U8 S1：真实落盘面——events.jsonl 恰追加 route+fallback 两行（同一 dispatchId）
    const newLines = (await readFile(eventsFile, 'utf8')).slice(eventsBefore?.length ?? 0).trim().split('\n')
    expect(newLines).toHaveLength(2)
    const [routeEv, fallbackEv] = newLines.map(l => JSON.parse(l))
    expect(routeEv.kind).toBe('route')
    expect(fallbackEv.kind).toBe('fallback')
    expect(routeEv.dispatchId).toBe(out.dispatchId)
    expect(fallbackEv.dispatchId).toBe(out.dispatchId)
    expect(fallbackEv.role).toBe('omd-agent-nosuch')
    // 幻影嵌套路径不得存在（cwd/stateDir 错位回归钉）
    await expect(readFile(join(process.cwd(), '.omd', '.omd', 'state', 'run-state.json'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(process.cwd(), '.omd', '.omd', 'state', 'events.jsonl'), 'utf8')).rejects.toThrow()
    // 清理：仅移除本测试写入的文件
    const { rm: rmAsync } = await import('node:fs/promises')
    await rmAsync(authority, { force: true })
  } finally {
    // events.jsonl 快照-恢复（失败路径也恢复，不把测试污染留给 dev 活数据）
    if (eventsBefore === null) await rm(eventsFile, { force: true })
    else await writeFile(eventsFile, eventsBefore, 'utf8')
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
  // F-6（U8 S1）：注入捕获器——spawn 失败车次也恰一条 route 事件（路由判定语义）、零真实落盘
  const events = []
  await registerDelegateTool(ctx, def => def, { config: Config.parse({}), roles: [], subagents: fakes.subagents, llm: fakes.llm, recordRouteEvent: async e => { events.push(e) } })
  await expect(captured.execute({ description: 'x', prompt: 'x', model: 'glm-5.3-flash' }, { agent: makeFakes().parent }))
    .rejects.toThrow(/stopReason=error.*boom/s)
  expect(events.map(e => e.kind)).toEqual(['route'])
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

// ---- IC-12：落盘锚修复（process.cwd() 主目录污染 → 工作区 cwd 优先 + home 守卫） ----

test('IC-12：args.cwd 透传为事件落盘锚（工作区优先，不再用宿主进程 cwd）', async () => {
  const { def, events } = await setupTool()
  await def.execute({ description: 'x', prompt: 'p', cwd: join(tmpdir(), 'fake-ws-ic12') }, { agent: makeFakes().parent })
  expect(events).toHaveLength(1)
  expect(events[0].cwd).toBe(join(tmpdir(), 'fake-ws-ic12'))
})

test('IC-12：落盘锚在用户主目录下 → 跳过落盘 + 告警（绝不在 ~/.omd 建孤儿状态树）', async () => {
  const fakes = makeFakes()
  const warns = []
  const events = []
  let captured
  const ctx = { tools: { register(d) { captured = d } }, logger: { info() {}, warn(m) { warns.push(String(m)) } } }
  await registerDelegateTool(ctx, d => d, {
    config: Config.parse({}), roles: [],
    subagents: fakes.subagents, llm: fakes.llm,
    recordRouteEvent: async e => { events.push(e) },
  })
  await captured.execute({ description: 'x', prompt: 'p', cwd: homedir() }, { agent: fakes.parent }) // 锚=主目录本身（GUI 从 home 启动形态）
  expect(events).toHaveLength(0) // 守卫：零落盘调用
  expect(warns.some(m => m.includes('IC-12'))).toBe(true) // 告警在位
})

test('IC-12 回归钉：cwd 缺席时回落 process.cwd()（既有行为不变）', async () => {
  const { def, events } = await setupTool()
  await def.execute({ description: 'x', prompt: 'p' }, { agent: makeFakes().parent })
  expect(events[0].cwd).toBe(process.cwd())
})