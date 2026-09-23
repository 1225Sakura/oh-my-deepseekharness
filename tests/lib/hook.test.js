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
test('detectKeyword：explicit 锚定形态命中（B1：返回带 hook 策略）', () => {
  expect(detectKeyword('用 ralph 做个任务')).toMatchObject({ target: 'ralph', trigger: 'ralph', intent: 'explicit', hook: { arm: true, match: 'anchored' } })
  expect(detectKeyword('ralph: 拉起循环')).toMatchObject({ target: 'ralph', hook: { arm: true } })
})

test('detectKeyword：natural 条目 hook 层直通（B1：语义守卫归模型层）', () => {
  expect(detectKeyword('帮我做一个 demo 页面')).toBeNull()
  expect(detectKeyword('如何使用 autopilot？')).toBeNull()
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

test('detectKeyword：裸词/解释性提及/回显块不激活（B1 核心）', () => {
  expect(detectKeyword('什么是 ralph 模式？')).toBeNull()
  expect(detectKeyword('看这段回显 [RALPH LOOP - ITERATION 3] 就继续了')).toBeNull()
  expect(detectKeyword('历史注入 [MAGIC KEYWORD: ralph] 也别再自激')).toBeNull()
  // B1 复审具名钉：解释性问句（否定前导守卫，窗口含边界字符）
  expect(detectKeyword('如何使用 ralph？')).toBeNull()
  expect(detectKeyword('怎么用 wiki 查一下？')).toBeNull()
  // B1 复审具名钉：CJK 引用形态（排除集含「」等全角引号）
  expect(detectKeyword('「用 ralph 做」这种引用形态不武装')).toBeNull()
  expect(detectKeyword('帮我做个 code review 好吗')).toMatchObject({ target: 'review', hook: { injectGuide: true, arm: false } })
})

test('stripNonActivating：保留普通文本，剥离回显块/围栏/行内码/URL/裸反引号（B1 扩展）', () => {
  const s = stripNonActivating('前文 `code ralph` 中 https://x/ralph 尾\n```\nfenced ralph\n```\n回显 [RALPH LOOP - ITERATION 3] 与 [MAGIC KEYWORD: ralph] 残留 ` 反引号')
  expect(s).not.toContain('ralph')
  expect(s).not.toContain('RALPH LOOP')
  expect(s).not.toContain('MAGIC KEYWORD')
  expect(s).not.toContain('`')
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
    { agent: undefined, messages: [userMsg('ralph: 做事')] },
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
      { agent: { session: { header: { id: 'bad/session', cwd } } }, messages: [userMsg('ralph: 做事')] },
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
      { agent: { session: { header: { id: 'sess-REJ', cwd } } }, messages: [userMsg('ralph: 做事')] },
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
    entry: { target: 'ralph', trigger: 'ralph: 任务', intent: 'explicit' },
    sessionId: 'sess-N1', updatedAt: '2026-09-22T13:00:00.000Z',
  })
  expect(text).toContain('[MAGIC KEYWORD: ralph]')
  expect(text).toContain('sess-N1')
  expect(text).toContain('expectUpdatedAt=2026-09-22T13:00:00.000Z')
})

// ---- B1 语义收窄（监听器级）：裸词直通 / 来源过滤 / review 指引面 / 防盲覆写 ----
test('监听器：裸词/解释性提及 → 直通无状态写（B1 语义收窄）', async () => {
  const cwd = await tmpWorkdir()
  const { ctx, captured } = fakeCtx()
  await registerKeywordHook(ctx, { createUserMessage: fakeCreateUserMessage, config: { stateDir: '.omd' } })
  try {
    const downstream = { kind: 'enter', messages: [userMsg('什么是 ralph 模式？')] }
    const out = await captured['agent/pre-step'](
      { agent: { session: { header: { id: 'sess-B1', cwd } } }, messages: [userMsg('什么是 ralph 模式？')] },
      async () => downstream,
    )
    expect(out).toBe(downstream)
    await expect(stat(join(cwd, '.omd'))).rejects.toThrow() // 零状态写
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('监听器：assistant 来源不参与检测（B1 来源过滤）', async () => {
  const cwd = await tmpWorkdir()
  const { ctx, captured } = fakeCtx()
  await registerKeywordHook(ctx, { createUserMessage: fakeCreateUserMessage, config: { stateDir: '.omd' } })
  try {
    const downstream = { kind: 'enter', messages: [] }
    const out = await captured['agent/pre-step'](
      { agent: { session: { header: { id: 'sess-SRC', cwd } } }, messages: [{ role: 'assistant', content: [{ type: 'text', text: 'cancelomd' }] }] },
      async () => downstream,
    )
    expect(out).toBe(downstream)
    await expect(stat(join(cwd, '.omd'))).rejects.toThrow() // 零状态写
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('监听器：review 命中 → 只注入行内指引块，不写模式状态（note 纪律）', async () => {
  const cwd = await tmpWorkdir()
  const { ctx, captured } = fakeCtx()
  await registerKeywordHook(ctx, { createUserMessage: fakeCreateUserMessage, config: { stateDir: '.omd' } })
  try {
    const downstream = { kind: 'enter', messages: [userMsg('帮我做个 code review')] }
    const out = await captured['agent/pre-step'](
      { agent: { session: { header: { id: 'sess-REV', cwd } } }, messages: [userMsg('帮我做个 code review')] },
      async () => ({ ...downstream }),
    )
    expect(out.messages.length).toBe(downstream.messages.length + 1)
    const injected = out.messages.at(-1)
    expect(injected.content[0].text).toContain('未激活任何模式状态')
    await expect(stat(join(cwd, '.omd', 'state', 'sessions', 'sess-REV'))).rejects.toThrow() // 零模式状态
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('监听器：tool 来源文本块不参与检测（B1 复审：role 过滤挡不住 tool 形态的双保险钉）', async () => {
  const cwd = await tmpWorkdir()
  const { ctx, captured } = fakeCtx()
  await registerKeywordHook(ctx, { createUserMessage: fakeCreateUserMessage, config: { stateDir: '.omd' } })
  try {
    const downstream = { kind: 'enter', messages: [] }
    const out = await captured['agent/pre-step'](
      { agent: { session: { header: { id: 'sess-TOOL', cwd } } }, messages: [{ role: 'user', content: [{ type: 'text', text: 'cancelomd', source: { kind: 'tool' } }] }] },
      async () => downstream,
    )
    expect(out).toBe(downstream)
    await expect(stat(join(cwd, '.omd'))).rejects.toThrow() // 零状态写
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('监听器：同会话同名模式已 active → 跳过重置与注入（B1 防盲覆写）', async () => {
  const cwd = await tmpWorkdir()
  const { ctx, captured } = fakeCtx()
  await registerKeywordHook(ctx, { createUserMessage: fakeCreateUserMessage, config: { stateDir: '.omd' } })
  try {
    const now = new Date('2026-09-22T12:00:00.000Z')
    await writeModeState({
      cwd, stateDir: '.omd', sessionId: 'sess-DUP', mode: 'cancel',
      state: { active: true, started_at: now.toISOString(), current_phase: 'running', prompt_echo: '运行中勿动', keyword_route: { target: 'cancel', trigger: 'cancelomd', source: 'other' } }, now,
    })
    const before = await readBackViaStateRead({ cwd, stateDir: '.omd', sessionId: 'sess-DUP', mode: 'cancel' })
    const downstream = { kind: 'enter', messages: [userMsg('cancelomd')] }
    const out = await captured['agent/pre-step'](
      { agent: { session: { header: { id: 'sess-DUP', cwd } } }, messages: [userMsg('cancelomd')] },
      async () => ({ ...downstream }),
    )
    expect(out.messages.length).toBe(downstream.messages.length) // 零注入
    const after = await readBackViaStateRead({ cwd, stateDir: '.omd', sessionId: 'sess-DUP', mode: 'cancel' })
    expect(after).toEqual(before) // 状态零重置
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
