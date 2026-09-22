// tests/lib/hook.test.js
// M3 c2-impl 验收（台账 m3-advance S9 逐条落槽）：
// C2 链路：确定性关键词检测（keywords.js 单一来源，零 LLM）→ 命中 → 模式状态写入 → state_read 实现读回一致
// C3 未命中 prompt 零成本直通（无状态写入、无注入）
// 监听器契约：每路径恰一次 next()、自身绝不抛错（写失败/会话锚缺失直通）
import { test, expect } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  stripNonActivating, detectKeyword, buildArmedState,
  writeModeState, readBackViaStateRead, renderActivationNotice, registerKeywordHook,
} from '../../lib/hook.js'

async function tmpWorkdir() {
  return await mkdtemp(join(tmpdir(), 'omd-hook-test-'))
}

// ---- 确定性关键词检测（零 LLM；注册表单一来源）----
test('detectKeyword：注册表触发词命中（explicit/natural 各一例）', () => {
  expect(detectKeyword('用 ralph 做个任务')).toEqual({ target: 'ralph', trigger: 'ralph', intent: 'explicit' })
  expect(detectKeyword('帮我做一个 demo 页面')).toEqual({ target: 'autopilot', trigger: '帮我做一个', intent: 'natural' })
})

test('detectKeyword：多词命中按注册表数组序（cancel 独占优先）', () => {
  const hit = detectKeyword('先 autopilot 一下，不对，cancelomd')
  expect(hit.target).toBe('cancel')
  expect(hit.trigger).toBe('cancelomd')
})

test('detectKeyword：未命中返回 null；退役词不触发（吞掉）', () => {
  expect(detectKeyword('普通任务，没有任何触发词')).toBeNull()
  expect(detectKeyword('ultrawork 这种退役词不触发')).toBeNull()
})

test('detectKeyword：代码块/行内代码/URL 内触发词确定性免疫', () => {
  expect(detectKeyword('看这个例子：\n```\nralph\n```\n就是这样')).toBeNull()
  expect(detectKeyword('配置键是 `ralph` 字面量')).toBeNull()
  expect(detectKeyword('文档在 https://example.com/ralph-docs 页面')).toBeNull()
})

test('stripNonActivating：保留普通文本，剥离三种不激活形态', () => {
  const s = stripNonActivating('前文 `code ralph` 中 https://x/ralph 尾\n```\nfenced ralph\n```')
  expect(s).not.toContain('ralph')
  expect(s).toContain('前文')
})

// ---- 命中后的模式状态初值 ----
test('buildArmedState：激活契约四要素 + keyword_route 审计元数据', () => {
  const now = new Date('2026-09-22T12:00:00.000Z')
  const entry = { target: 'ralph', trigger: 'ralph', intent: 'explicit' }
  const s = buildArmedState({ entry, promptText: '用 ralph 做 X', now })
  expect(s.active).toBe(true)
  expect(s.started_at).toBe('2026-09-22T12:00:00.000Z')
  expect(s.current_phase).toBe('keyword-detected')
  expect(s.prompt_echo).toBe('用 ralph 做 X')
  expect(s.keyword_route).toEqual({ target: 'ralph', trigger: 'ralph', intent: 'explicit', source: 'keyword-hook' })
})

test('buildArmedState：prompt_echo 截断到 1200（state.mjs 写路径同款上限）', () => {
  const s = buildArmedState({ entry: { target: 'wiki', trigger: 'wiki', intent: 'explicit' }, promptText: 'x'.repeat(2000) })
  expect(s.prompt_echo.length).toBe(1200)
})

// ---- C2 链路（单测级）：写 → state_read 自身实现读回一致 ----
test('writeModeState → readBackViaStateRead：state_read 实现读回与写入逐字段一致', async () => {
  const cwd = await tmpWorkdir()
  try {
    const now = new Date('2026-09-22T12:30:00.000Z')
    const entry = { target: 'ralph', trigger: 'ralph', intent: 'explicit' }
    const state = buildArmedState({ entry, promptText: '用 ralph 做 Y', now })
    const file = await writeModeState({ cwd, stateDir: '.omd', sessionId: 'sess-RB1', mode: 'ralph', state, now })
    expect(file).toBe(join(cwd, '.omd', 'state', 'sessions', 'sess-RB1', 'ralph-state.json').replaceAll('\\', '/'))
    const back = await readBackViaStateRead({ cwd, stateDir: '.omd', sessionId: 'sess-RB1', mode: 'ralph' })
    expect(back).toEqual({
      ...state,
      _meta: { mode: 'ralph', sessionId: 'sess-RB1', updatedAt: '2026-09-22T12:30:00.000Z', updatedBy: 'sess-RB1' },
    })
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('writeModeState：非法 sessionId 被 SAFE_ID 前置拒绝（G6 域安全）', async () => {
  await expect(writeModeState({
    cwd: 'C:/tmp', stateDir: '.omd', sessionId: '../escape', mode: 'ralph',
    state: buildArmedState({ entry: { target: 'ralph', trigger: 'ralph', intent: 'explicit' } }),
  })).rejects.toThrow(/unsafe sessionId/)
})

// ---- 监听器三态与契约 ----
function fakeCtx() {
  const captured = {}
  const warns = []
  const infos = []
  const ctx = {
    on: (event, fn) => { captured[event] = fn },
    logger: { warn: (m) => warns.push(m), info: (m) => infos.push(m) },
  }
  return { ctx, captured, warns, infos }
}

const fakeCreateUserMessage = (msg) => ({ role: 'user', ...msg })
const userMsg = (text) => ({ content: [{ type: 'text', text }] })

test('监听器：未命中 → 恰一次 next() 直通，零状态写零注入（C3）', async () => {
  const cwd = await tmpWorkdir()
  const { ctx, captured } = fakeCtx()
  await registerKeywordHook(ctx, { createUserMessage: fakeCreateUserMessage, config: { stateDir: '.omd' } })
  try {
    let nextCalls = 0
    const downstream = { kind: 'enter', messages: [userMsg('普通任务')] }
    const out = await captured['agent/pre-step'](
      { agent: { session: { header: { id: 'sess-MISS', cwd } } }, messages: [userMsg('只回复 OK-MISS，没有触发词')] },
      async () => { nextCalls++; return downstream },
    )
    expect(nextCalls).toBe(1)
    expect(out).toBe(downstream)
    await expect(stat(join(cwd, '.omd'))).rejects.toThrow()  // 零状态写
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('监听器：空 messages → 直通（inbox.claim 消耗语义，后续 step 不重触发）', async () => {
  const { ctx, captured } = fakeCtx()
  await registerKeywordHook(ctx, { createUserMessage: fakeCreateUserMessage, config: { stateDir: '.omd' } })
  let nextCalls = 0
  const downstream = { kind: 'enter', messages: [] }
  const out = await captured['agent/pre-step'](
    { agent: { session: { header: { id: 's', cwd: 'C:/tmp' } } }, messages: [] },
    async () => { nextCalls++; return downstream },
  )
  expect(nextCalls).toBe(1)
  expect(out).toBe(downstream)
})

test('监听器：命中 → 模式状态落盘 + 下游注入 [MAGIC KEYWORD] 激活块（C2 正例）', async () => {
  const cwd = await tmpWorkdir()
  const { ctx, captured, infos } = fakeCtx()
  await registerKeywordHook(ctx, { createUserMessage: fakeCreateUserMessage, config: { stateDir: '.omd' } })
  try {
    const downstream = { kind: 'enter', messages: [userMsg('cancelomd')] }
    const out = await captured['agent/pre-step'](
      { agent: { session: { header: { id: 'sess-HIT1', cwd } } }, messages: [userMsg('cancelomd')] },
      async () => ({ ...downstream }),
    )
    // 状态落盘且经 state_read 实现读回一致
    const back = await readBackViaStateRead({ cwd, stateDir: '.omd', sessionId: 'sess-HIT1', mode: 'cancel' })
    expect(back.active).toBe(true)
    expect(back._meta).toMatchObject({ mode: 'cancel', sessionId: 'sess-HIT1', updatedBy: 'sess-HIT1' })
    // 注入块：恰追加一条，含路由指引与 expectUpdatedAt 续写锚
    expect(out.messages.length).toBe(downstream.messages.length + 1)
    const injected = out.messages.at(-1)
    expect(injected.content[0].text).toContain('[MAGIC KEYWORD: cancel]')
    expect(injected.content[0].text).toContain(`expectUpdatedAt=${back._meta.updatedAt}`)
    expect(injected.source).toBe('oh-my-dsh:keyword-hook')
    // 命中日志行（e2e 证据面）
    expect(infos.some(l => l.includes('[keyword-hook] hit trigger=\'cancelomd\''))).toBe(true)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('监听器：会话锚缺失 → warn 直通，无状态写无注入', async () => {
  const { ctx, captured, warns } = fakeCtx()
  await registerKeywordHook(ctx, { createUserMessage: fakeCreateUserMessage, config: { stateDir: '.omd' } })
  const downstream = { kind: 'enter', messages: [] }
  const out = await captured['agent/pre-step'](
    { agent: undefined, messages: [userMsg('ralph 做事')] },
    async () => downstream,
  )
  expect(out).toBe(downstream)
  expect(warns.some(l => l.includes('会话锚缺失'))).toBe(true)
})

test('监听器：状态写失败（非法 sessionId）→ warn 直通不抛错，下游原样', async () => {
  const cwd = await tmpWorkdir()
  const { ctx, captured, warns } = fakeCtx()
  await registerKeywordHook(ctx, { createUserMessage: fakeCreateUserMessage, config: { stateDir: '.omd' } })
  try {
    const downstream = { kind: 'enter', messages: [] }
    const out = await captured['agent/pre-step'](
      { agent: { session: { header: { id: 'bad/session', cwd } } }, messages: [userMsg('ralph 做事')] },
      async () => downstream,
    )
    expect(out).toBe(downstream)
    expect(warns.some(l => l.includes('处理失败'))).toBe(true)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('监听器：命中但下游 reject → 状态已落盘、不注入（诚实留痕）', async () => {
  const cwd = await tmpWorkdir()
  const { ctx, captured } = fakeCtx()
  await registerKeywordHook(ctx, { createUserMessage: fakeCreateUserMessage, config: { stateDir: '.omd' } })
  try {
    const out = await captured['agent/pre-step'](
      { agent: { session: { header: { id: 'sess-REJ', cwd } } }, messages: [userMsg('ralph 做事')] },
      async () => ({ kind: 'reject' }),
    )
    expect(out).toEqual({ kind: 'reject' })
    const back = await readBackViaStateRead({ cwd, stateDir: '.omd', sessionId: 'sess-REJ', mode: 'ralph' })
    expect(back.active).toBe(true)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('registerKeywordHook：宿主缺 ctx.on → 显式报错（index.js 降级路径的触发面）', async () => {
  await expect(registerKeywordHook({}, { createUserMessage: fakeCreateUserMessage, config: {} })).rejects.toThrow(/ctx\.on/)
})

// ---- 注入块模板 ----
test('renderActivationNotice：确定性模板（模式/触发词/sessionId/expectUpdatedAt 齐全）', () => {
  const text = renderActivationNotice({
    entry: { target: 'autopilot', trigger: '全自动', intent: 'natural' },
    sessionId: 'sess-N1', updatedAt: '2026-09-22T13:00:00.000Z',
  })
  expect(text).toContain('[MAGIC KEYWORD: autopilot]')
  expect(text).toContain('全自动')
  expect(text).toContain('sess-N1')
  expect(text).toContain('expectUpdatedAt=2026-09-22T13:00:00.000Z')
})
