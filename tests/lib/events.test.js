// tests/lib/events.test.js
// U8 S1（c5 HUD 工具调用可观测性一期，ralplan-u8-hud-tool-observability.md Step 1）验收：
// AC-1 真实 tmp 目录落盘形状（{ts,kind,dispatchId,role,tableTier,suggestedTier,tier,clamped,fallback,explicit,modelId?}）
// AC-2 fallback 派发 route+fallback 各一条同点落盘（同一 dispatchId，天然 1:1）
// AC-3 落盘失败零阻断（注入写错误，fallback 与非 fallback 两分支，ctx.logger.warn 恰一次）
// AC-4 并发 N=20 行数恰 N、逐行 JSON.parse 无撕裂（withFileLock 复用 runstate.js 导出）
// AC-5 坏行跳过（_corrupt 同款口径）+ 尾部窗口（默认 64 KiB，可注入）
// AC-8 aggregateEvents 归类（explicit 桶=explicit:true；tier 桶仅 explicit=false 且 tier 非 null）
import { test, expect, vi } from 'vitest'
import { join, dirname } from 'node:path'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Config } from '../../lib/config.js'
import {
  EVENT_KINDS, DEFAULT_EVENTS_WINDOW_BYTES, EVENTS_ROTATE_BYTES, eventsPath, recordRouteEvent, readEvents, aggregateEvents,
} from '../../lib/events.js'
import { DELEGATE_PROVIDER, registerDelegateTool } from '../../lib/delegate.js'

const mkTmp = () => mkdtemp(join(tmpdir(), 'omd-events-'))

/** 路由判定夹具（对齐 resolveDispatch 返回形状，lib/delegate.js:38/:55）。 */
function decisionOf(over = {}) {
  return {
    dispatchId: 'omdd-t-1', role: 'omd-agent-explore', tableTier: 'low', suggestedTier: 'high',
    tier: 'low', clamped: true, fallback: false, explicit: false, modelId: undefined, ...over,
  }
}

/** omd_delegate 注册夹具（delegate.test.js makeFakes/setupTool 同款形态 + events/warn 捕获）。 */
async function setupDelegate({ config, recordRouteEvent: recordImpl, warns = [] } = {}) {
  const subagents = {
    getProvider: name => name === DELEGATE_PROVIDER ? { name } : undefined,
    list: () => [DELEGATE_PROVIDER],
    async start() {
      return {
        id: 'child-1',
        result: Promise.resolve({ output: [{ type: 'text', text: 'OK-DELEGATE' }], stopReason: 'completed' }),
        dispose: async () => {},
      }
    },
  }
  const llm = { async resolveCallConfig(c) { return c } }
  const parent = { session: { requestHeader: () => ({ config: { provider: 'glm', model: 'glm-5.3-flash' } }) }, options: {} }
  let captured
  const ctx = { tools: { register(def) { captured = def } }, logger: { info() {}, warn(m) { warns.push(m) } } }
  await registerDelegateTool(ctx, def => def, {
    config, roles: [{ name: 'omd-agent-explore', tier: 'low' }], subagents, llm,
    ...(recordImpl ? { recordRouteEvent: recordImpl } : {}),
  })
  return { def: captured, parent }
}

// ---- AC-1：真实 tmp 目录落盘，逐字段形状断言 ----

test('AC-1：真实落盘——事件形状逐字段断言（dispatchId=判定键控 id；modelId? 缺席不挂键）', async () => {
  const dir = await mkTmp()
  try {
    const file = join(dir, '.omd', 'state', 'events.jsonl')
    const at = '2026-02-06T00:00:00.000Z'
    await recordRouteEvent({ cwd: dir, stateDir: '.omd', decision: decisionOf(), kind: 'route', at })
    const lines = (await readFile(file, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual({
      ts: at, kind: 'route', dispatchId: 'omdd-t-1', role: 'omd-agent-explore',
      tableTier: 'low', suggestedTier: 'high', tier: 'low',
      clamped: true, fallback: false, explicit: false,
    })
    // 显式 model 路径：modelId 挂键、explicit=true、tier 系 null（explicit-model 派发只进 explicit 桶）
    await recordRouteEvent({
      cwd: dir, stateDir: '.omd', kind: 'route',
      decision: decisionOf({ dispatchId: 'omdd-t-2', role: null, tableTier: null, suggestedTier: null, tier: null, clamped: false, explicit: true, modelId: 'glm-5.3-flash' }),
    })
    const ev2 = JSON.parse((await readFile(file, 'utf8')).trim().split('\n')[1])
    expect(ev2.modelId).toBe('glm-5.3-flash')
    expect(ev2.explicit).toBe(true)
    expect(ev2.tier).toBeNull()
    // eventsPath 解析口径（resolve 非 join——绝对 stateDir 不拼幻影树）
    expect(eventsPath(dir, '.omd')).toBe(file)
    const absState = join(dir, 'abs-state')
    expect(eventsPath(dir, absState)).toBe(join(absState, 'state', 'events.jsonl'))
    // 非法参数显式抛错（不静默）
    await expect(recordRouteEvent({ cwd: dir, decision: decisionOf(), kind: 'bogus' })).rejects.toThrow(/kind/)
    await expect(recordRouteEvent({ cwd: dir, decision: { role: 'x' }, kind: 'route' })).rejects.toThrow(/dispatchId/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---- AC-2：fallback 派发 → route+fallback 各一条同点落盘 ----

test('AC-2：fallback 派发 → events.jsonl 恰多一条 kind=fallback（route+fallback 1:1 同 dispatchId）；非 fallback 恰一条 route', async () => {
  const dir = await mkTmp()
  try {
    const events = []
    const { def, parent } = await setupDelegate({
      config: Config.parse({ stateDir: dir }), // 绝对 tmp：recordFallback 审计零触碰仓库活 .omd
      recordRouteEvent: async e => { events.push(e) },
    })
    const out = await def.execute({ description: 'x', prompt: 'x', role: 'omd-agent-nosuch', tier: 'low' }, { agent: parent })
    expect(out.fallback).toBe(true)
    expect(events.map(e => e.kind)).toEqual(['route', 'fallback'])
    expect(events[0].decision.dispatchId).toBe(out.dispatchId)
    expect(events[1].decision.dispatchId).toBe(out.dispatchId)
    expect(events[1].decision.fallback).toBe(true)
    // 非 fallback 派发：恰一条 route（无双计）
    events.length = 0
    const out2 = await def.execute({ description: 'x', prompt: 'x', role: 'omd-agent-explore', tier: 'low' }, { agent: parent })
    expect(out2.fallback).toBe(false)
    expect(events.map(e => e.kind)).toEqual(['route'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---- AC-3：落盘失败零阻断，warn 恰一次（两分支） ----

test('AC-3：注入写错误——非 fallback 与 fallback 两分支均成功返回、结果字段不变、warn 恰一次', async () => {
  const dir = await mkTmp()
  try {
    const warns = []
    const boom = async () => { throw new Error('disk full') }
    const { def, parent } = await setupDelegate({
      config: Config.parse({ stateDir: dir }), recordRouteEvent: boom, warns,
    })
    // 非 fallback 分支
    const ok = await def.execute({ description: 'x', prompt: 'x', role: 'omd-agent-explore', tier: 'low' }, { agent: parent })
    expect(ok.ok).toBe(true)
    expect(ok.text).toBe('OK-DELEGATE')
    expect(ok.logLine).toContain('dispatch=')
    expect(warns).toHaveLength(1)
    expect(warns[0]).toMatch(/events 落盘失败.*disk full/)
    // fallback 分支：route+fallback 同 try/catch → 不 warn 两次
    warns.length = 0
    const fb = await def.execute({ description: 'x', prompt: 'x', role: 'omd-agent-nosuch', tier: 'low' }, { agent: parent })
    expect(fb.ok).toBe(true)
    expect(fb.fallback).toBe(true)
    expect(warns).toHaveLength(1)
    expect(warns[0]).toMatch(/events 落盘失败.*disk full/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---- AC-4：并发 N=20 行数恰 N、无撕裂（锁复用 runstate.js withFileLock） ----

test('AC-4：并发 N=20 recordRouteEvent → 行数恰 20、逐行 JSON.parse 无撕裂', async () => {
  const dir = await mkTmp()
  try {
    await Promise.all(Array.from({ length: 20 }, (_, i) => recordRouteEvent({
      cwd: dir, stateDir: '.omd', kind: i % 5 === 4 ? 'fallback' : 'route',
      decision: decisionOf({ dispatchId: `omdd-c-${i}`, fallback: i % 5 === 4 }),
    })))
    const lines = (await readFile(join(dir, '.omd', 'state', 'events.jsonl'), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(20)
    const ids = new Set(lines.map(l => JSON.parse(l).dispatchId)) // 撕裂行在此 JSON.parse 抛错
    expect(ids.size).toBe(20)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---- AC-5：读面有界 + 坏行容错 ----

test('AC-5：坏行跳过（_corrupt 口径）+ 尾部窗口（注入小窗口只聚合尾部；默认 64 KiB）', async () => {
  const dir = await mkTmp()
  try {
    expect(DEFAULT_EVENTS_WINDOW_BYTES).toBe(65536)
    // 文件缺席 → 空聚合（不抛错）
    expect(await readEvents({ cwd: dir, stateDir: '.omd' })).toEqual([])
    const file = join(dir, '.omd', 'state', 'events.jsonl')
    await mkdir(dirname(file), { recursive: true })
    // 坏行容错：坏行以 _corrupt 标记行占位、好行全返回
    await writeFile(file, '{"kind":"route","dispatchId":"a"}\nNOT-JSON\n{"kind":"route","dispatchId":"b"}\n')
    const evs = await readEvents({ cwd: dir, stateDir: '.omd' })
    expect(evs.filter(e => !e._corrupt).map(e => e.dispatchId)).toEqual(['a', 'b'])
    expect(evs.filter(e => e._corrupt)).toEqual([{ _corrupt: true, line: 2 }])
    // 尾部窗口：10 行 × ~230B ≈ 2.3KB 文件，注入 500B 窗口 → 只回尾部好行（窗口首行撕裂整行丢弃）
    const pad = 'x'.repeat(200)
    const body = Array.from({ length: 10 }, (_, i) => JSON.stringify({ kind: 'route', dispatchId: `d${i}`, pad })).join('\n') + '\n'
    await writeFile(file, body)
    const tail = await readEvents({ cwd: dir, stateDir: '.omd', maxBytes: 500 })
    const good = tail.filter(e => !e._corrupt)
    expect(good.length).toBeGreaterThan(0)
    expect(good.length).toBeLessThan(10)
    expect(good[good.length - 1].dispatchId).toBe('d9') // 窗口含文件尾部
    expect(tail.every(e => e._corrupt || typeof e.dispatchId === 'string')).toBe(true) // 无撕裂半行
    // 默认窗口 64 KiB：小文件全量返回
    const full = await readEvents({ cwd: dir, stateDir: '.omd' })
    expect(full.filter(e => !e._corrupt)).toHaveLength(10)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---- AC-8：aggregateEvents 归类规则（纯函数） ----

test('AC-8：aggregateEvents——total=route 行数；fallbackCount=fallback 行数；explicit 桶=explicit:true；tier 桶仅 explicit=false 且 tier 非 null；坏行跳过', () => {
  const agg = aggregateEvents([
    { kind: 'route', explicit: false, tier: 'low' },
    { kind: 'route', explicit: false, tier: 'low' },
    { kind: 'route', explicit: false, tier: 'medium' },
    { kind: 'route', explicit: false, tier: 'high' },
    { kind: 'route', explicit: false, tier: null },                                  // 计 total 不进桶
    { kind: 'route', explicit: true, tier: null, modelId: 'glm-5.3-flash' },          // 只进 explicit 桶
    { kind: 'fallback', explicit: false, tier: 'medium' },                            // 不计 total/桶
    { kind: 'fallback', explicit: false, tier: 'medium' },
    { _corrupt: true, line: 9 },                                                      // 坏行跳过
  ])
  expect(agg).toEqual({ total: 6, byTier: { low: 2, medium: 1, high: 1, explicit: 1 }, fallbackCount: 2 })
  expect(aggregateEvents([])).toEqual({ total: 0, byTier: { low: 0, medium: 0, high: 0, explicit: 0 }, fallbackCount: 0 })
  expect(aggregateEvents(undefined)).toEqual({ total: 0, byTier: { low: 0, medium: 0, high: 0, explicit: 0 }, fallbackCount: 0 })
})

test('EVENT_KINDS 契约：route/fallback 两种', () => {
  expect(EVENT_KINDS).toEqual(['route', 'fallback'])
})

// ---- EL1-1：写面轮转（ralplan-u8-2 D1-A；Critic① 二选一取「导出测试缝」——rotateBytes 注入，全走 tmp） ----

test('EL1-1：主档超阈值 → 锁内 rename 单档 .1（主档换新 + .1 归档旧行）；readEvents/aggregate 只读主档', async () => {
  const dir = await mkTmp()
  try {
    expect(EVENTS_ROTATE_BYTES).toBe(1048576) // Critic④ 定值 1MiB
    const file = join(dir, '.omd', 'state', 'events.jsonl')
    // 注入缝 rotateBytes=500、pad 行 ≈330B：d3 前、d5 前各触发一次轮转（旧 .1 被单档滚动覆盖）
    for (let i = 1; i <= 5; i++) {
      await recordRouteEvent({
        cwd: dir, stateDir: '.omd', rotateBytes: 500, kind: 'route',
        decision: decisionOf({ dispatchId: 'd' + i, pad: 'x'.repeat(100) }),
      })
    }
    const archiveIds = (await readFile(file + '.1', 'utf8')).trim().split('\n').map(l => JSON.parse(l).dispatchId)
    const mainIds = (await readFile(file, 'utf8')).trim().split('\n').map(l => JSON.parse(l).dispatchId)
    expect(archiveIds.length).toBeGreaterThanOrEqual(1) // 发生过轮转
    expect(archiveIds).toContain('d1') // .1 归档旧行（最早的行）
    expect(mainIds).toContain('d5') // 主档换新（最新行）
    expect([...archiveIds, ...mainIds]).toEqual(['d1', 'd2', 'd3', 'd4', 'd5']) // 分割连续、无重叠无丢行
    // 读面/聚合零改动（Fail 语义钉死：聚合计入 .1 或读面抛错即败）——只读主档
    const evs = await readEvents({ cwd: dir, stateDir: '.omd' })
    expect(evs.map(e => e.dispatchId)).toEqual(mainIds)
    expect(aggregateEvents(evs).total).toBe(mainIds.length)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('EL1-1：stat ENOENT 首写 → 跳过轮转直接 append、零告警（Critic③ 首写假告警消解）', async () => {
  const dir = await mkTmp()
  const warns = []
  const spy = vi.spyOn(console, 'warn').mockImplementation(m => warns.push(String(m)))
  try {
    const ev = await recordRouteEvent({ cwd: dir, stateDir: '.omd', kind: 'route', decision: decisionOf({ dispatchId: 'first' }) })
    expect(ev.dispatchId).toBe('first')
    expect(warns).toEqual([]) // 首写（文件尚不存在）不产生任何轮转告警
    expect((await readEvents({ cwd: dir, stateDir: '.omd' })).map(e => e.dispatchId)).toEqual(['first'])
  } finally {
    spy.mockRestore()
    await rm(dir, { recursive: true, force: true })
  }
})
