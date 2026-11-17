import { test, expect } from 'vitest'
import { makeStateTools } from '../../lib/state/tools/state.mjs'
import { stateKey } from '../../lib/state-domain.js'

// 二期②：存储迁移后 fixture = 内存 mock table（域写链在宿主侧，单测只钉行为语义——
// 所有权/supersede/CAS/provisional/IC-23 全部保留原断言）。
function makeTable() {
  const m = new Map()
  return {
    get: k => m.get(k),
    put: async (k, v) => { m.set(k, v) },
    delete: async k => m.delete(k),
    keys: () => [...m.keys()],
  }
}

function tools() {
  const cwd = '/proj/omd-state-test'
  const table = makeTable()
  const t = makeStateTools({ stateDir: '.omd', table })
  return { t, cwd, table }
}

test('write 后 read 读回，自动带 _meta', async () => {
  const { t, cwd } = tools()
  await t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true, iteration: 1 } })
  const got = await t.read({ cwd, sessionId: 's1', mode: 'ralph' })
  expect(got.active).toBe(true)
  expect(got._meta).toMatchObject({ mode: 'ralph', sessionId: 's1', updatedBy: 's1' })
  expect(typeof got._meta.updatedAt).toBe('string')
})

test('跨会话写被拒绝（所有权强制）', async () => {
  const { t, cwd } = tools()
  await t.write({ cwd, sessionId: 's1', mode: 'team', state: { active: true } })
  await expect(t.write({ cwd, sessionId: 's2', mode: 'team', state: { active: false } }))
    .rejects.toThrow(/owned by session/)
})

test('写前读检查：expectUpdatedAt 不匹配时拒绝', async () => {
  const { t, cwd } = tools()
  await t.write({ cwd, sessionId: 's1', mode: 'autopilot', state: { active: true, current_phase: 'plan' } })
  const cur = await t.read({ cwd, sessionId: 's1', mode: 'autopilot' })
  await expect(t.write({ cwd, sessionId: 's1', mode: 'autopilot', state: { current_phase: 'exec' }, expectUpdatedAt: ' stale' }))
    .rejects.toThrow(/conflict/)
  await t.write({ cwd, sessionId: 's1', mode: 'autopilot', state: { current_phase: 'exec' }, expectUpdatedAt: cur._meta.updatedAt }) // 不抛
})

test('listActive 只列 active:true 的模式，跨会话聚合只读', async () => {
  const { t, cwd } = tools()
  await t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true } })
  await t.write({ cwd, sessionId: 's1', mode: 'team', state: { active: false } })
  await t.write({ cwd, sessionId: 's2', mode: 'autopilot', state: { active: true } })
  const list = await t.listActive({ cwd })
  expect(list.map(x => `${x._meta.sessionId}:${x._meta.mode}`).sort())
    .toEqual(['s1:ralph', 's2:autopilot'])
})

test('clear 删除记录，重复 clear 幂等', async () => {
  const { t, cwd } = tools()
  await t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true } })
  await t.clear({ cwd, sessionId: 's1', mode: 'ralph' })
  await t.clear({ cwd, sessionId: 's1', mode: 'ralph' })
  expect(await t.read({ cwd, sessionId: 's1', mode: 'ralph' })).toBeNull()
})

test('prompt_echo 超过 1200 字符被截断', async () => {
  const { t, cwd } = tools()
  await t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true, prompt_echo: 'x'.repeat(2000) } })
  const got = await t.read({ cwd, sessionId: 's1', mode: 'ralph' })
  expect(got.prompt_echo.length).toBeLessThanOrEqual(1200)
})

test('G6 域安全：sessionId/mode 进键空间，非法形态前置拒绝（文案同旧 SAFE_ID）', async () => {
  const { t, cwd } = tools()
  await expect(t.write({ cwd, sessionId: '../evil', mode: 'ralph', state: { active: true } }))
    .rejects.toThrow(/unsafe sessionId/)
  await expect(t.write({ cwd, sessionId: 's1', mode: 'a:b', state: { active: true } }))
    .rejects.toThrow(/unsafe mode/)
  await expect(t.read({ cwd, sessionId: 's1', mode: 'a:b' })).rejects.toThrow(/unsafe mode/)
})

// ---------- c4 HUD 数据面：getStatus 投影透传（加性，现成读面零新宿主槽位） ----------

test('getStatus 投影透传 current_story 与 active_agents；缺席为 undefined', async () => {
  const { t, cwd } = tools()
  await t.write({ cwd, sessionId: 's1', mode: 'ralph',
    state: { active: true, iteration: 2, current_story: 'S4', active_agents: ['worker-1'] } })
  const st = await t.getStatus({ cwd })
  expect(st.activeCount).toBe(1)
  expect(st.modes[0]).toMatchObject({ mode: 'ralph', iteration: 2, current_story: 'S4', active_agents: ['worker-1'] })
  await t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true, iteration: 3 } })
  const st2 = await t.getStatus({ cwd })
  expect(st2.modes[0].current_story).toBeUndefined()
  expect(st2.modes[0].active_agents).toBeUndefined()
})

test('孤儿记录（缺 _meta）的报错文案显示 <unknown> 而非 undefined', async () => {
  const { t, cwd, table } = tools()
  // 手工放一个无 _meta 的孤儿记录（ghost 会话）
  await table.put(stateKey(cwd, 'ralph', 'ghost'), { active: true })
  await expect(t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true } }))
    .rejects.toThrow(/<unknown>|ghost/)
})

test('getStatus U3/AC10 加性透传：state 与 fixLoops（两种拼法兜底）；缺席为 undefined', async () => {
  const { t, cwd } = tools()
  await t.write({ cwd, sessionId: 's1', mode: 'ralph',
    state: { active: true, state: 'running', fix_loop_count: 2 } })
  const st = await t.getStatus({ cwd })
  expect(st.modes[0].state).toBe('running')
  expect(st.modes[0].fixLoops).toBe(2)
  await t.write({ cwd, sessionId: 's2', mode: 'team',
    state: { active: true, fixLoops: 1 } })
  const st2 = await t.getStatus({ cwd })
  expect(st2.modes.find(m => m.mode === 'team').fixLoops).toBe(1)
  await t.write({ cwd, sessionId: 's3', mode: 'autopilot', state: { active: true } })
  const st3 = await t.getStatus({ cwd })
  expect(st3.modes.find(m => m.mode === 'autopilot').state).toBeUndefined()
  expect(st3.modes.find(m => m.mode === 'autopilot').fixLoops).toBeUndefined()
})

// ---------- IC-20/IC-21 修复：所有权绑定谓词收窄（.omd/plans/ralplan-mode-state-lifecycle.md） ----------

test('IC-21：inactive/已交接状态不绑定所有权——新会话直接激活取代（审计+active:false+listActive 不含）', async () => {
  const { t, cwd } = tools()
  await t.write({ cwd, sessionId: 'old', mode: 'ralph', state: { active: false, handed_off_to: 'ralph' } })
  const before = await t.read({ cwd, sessionId: 'old', mode: 'ralph' })
  await t.write({ cwd, sessionId: 'new', mode: 'ralph', state: { active: true, current_phase: 'consensus' } }) // 不抛
  const oldFile = await t.read({ cwd, sessionId: 'old', mode: 'ralph' })
  expect(oldFile.active).toBe(false)
  expect(oldFile.supersededBy).toBe('new')
  expect(typeof oldFile.supersededAt).toBe('string')
  expect(oldFile._meta.updatedAt !== before._meta.updatedAt).toBe(true) // ABA 防线：_meta 重打
  expect(oldFile._meta.sessionId).toBe('old') // 原 sessionId 保留（审计归属）
  const list = await t.listActive({ cwd })
  expect(list.find(x => x._meta.sessionId === 'old')).toBeUndefined()
})

test('IC-20：provisional 预写（keyword-detected + keyword_route.source）不绑定所有权——主会话直接取代', async () => {
  const { t, cwd } = tools()
  await t.write({ cwd, sessionId: 'leaf', mode: 'ralph', state: { active: true, current_phase: 'keyword-detected',
    keyword_route: { target: 'ralph', trigger: 'ralph', intent: 'explicit', source: 'keyword-hook' } } })
  await t.write({ cwd, sessionId: 'main', mode: 'ralph', state: { active: true, current_phase: 'running' } }) // 不抛
  const leafFile = await t.read({ cwd, sessionId: 'leaf', mode: 'ralph' })
  expect(leafFile.active).toBe(false)
  expect(leafFile.supersededBy).toBe('main')
})

test('IC-20 ABA 防线：被取代会话携预写注入块旧 expectUpdatedAt 续写 → conflict 拒绝', async () => {
  const { t, cwd } = tools()
  await t.write({ cwd, sessionId: 'leaf', mode: 'ralph', state: { active: true, current_phase: 'keyword-detected',
    keyword_route: { target: 'ralph', trigger: 'ralph', intent: 'explicit', source: 'keyword-hook' } } })
  const injected = await t.read({ cwd, sessionId: 'leaf', mode: 'ralph' })
  await t.write({ cwd, sessionId: 'main', mode: 'ralph', state: { active: true, current_phase: 'running' } }) // supersede 重打 _meta.updatedAt
  // 不变量：陈旧续写绝不静默通过。取代后 main 已是活跃所有者，故 leaf 续写落在
  // 所有权拒绝（owned by main）；若无活跃接管者则落在 conflict——两种显式拒绝皆合法。
  await expect(t.write({ cwd, sessionId: 'leaf', mode: 'ralph', state: { active: true }, expectUpdatedAt: injected._meta.updatedAt }))
    .rejects.toThrow(/conflict|owned by session/) // 陈旧续写显式认输（conflict 或所有权拒绝），绝不静默复活
})

test('IC-20 合取签名负例：keyword-detected 但缺 keyword_route.source → 仍绑定拒绝', async () => {
  const { t, cwd } = tools()
  await t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true, current_phase: 'keyword-detected' } })
  await expect(t.write({ cwd, sessionId: 's2', mode: 'ralph', state: { active: true } }))
    .rejects.toThrow(/owned by session/)
})

test('双 stale 全被取代：循环 continue 扫全部 session，不因首个非绑定态短路', async () => {
  const { t, cwd } = tools()
  await t.write({ cwd, sessionId: 'stale1', mode: 'ralph', state: { active: false } })
  await t.write({ cwd, sessionId: 'stale2', mode: 'ralph', state: { active: true, current_phase: 'keyword-detected',
    keyword_route: { source: 'keyword-hook' } } })
  await t.write({ cwd, sessionId: 'new', mode: 'ralph', state: { active: true, current_phase: 'running' } }) // 不抛
  expect((await t.read({ cwd, sessionId: 'stale1', mode: 'ralph' })).supersededBy).toBe('new')
  expect((await t.read({ cwd, sessionId: 'stale2', mode: 'ralph' })).supersededBy).toBe('new')
})

test('存活常规态绑定保持：active:true 无 phase 的他 session 记录仍拒绝（回归钉）', async () => {
  const { t, cwd } = tools()
  await t.write({ cwd, sessionId: 'live', mode: 'ralph', state: { active: true, current_phase: 'running' } })
  await expect(t.write({ cwd, sessionId: 'other', mode: 'ralph', state: { active: true } }))
    .rejects.toThrow(/owned by session/)
})

test('IC-23：同毫秒双写 token 单调递增——旧 expectUpdatedAt 必然失配', async () => {
  const { t, cwd } = tools()
  await t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true } })
  const w1 = await t.read({ cwd, sessionId: 's1', mode: 'ralph' })
  await t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true, iteration: 2 } }) // 同毫秒高发
  const w2 = await t.read({ cwd, sessionId: 's1', mode: 'ralph' })
  expect(w2._meta.updatedAt > w1._meta.updatedAt).toBe(true) // 单调严格递增（IC-23 防线）
  await expect(t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true }, expectUpdatedAt: w1._meta.updatedAt }))
    .rejects.toThrow(/conflict/)
})

test('serialized 应用级互斥：并发双写同键不互相踩（排队执行）', async () => {
  const { t, cwd } = tools()
  const [r1, r2] = await Promise.all([
    t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true, iteration: 1 } }),
    t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true, iteration: 2 } }),
  ])
  expect(r1).toEqual({ ok: true })
  expect(r2).toEqual({ ok: true })
  const got = await t.read({ cwd, sessionId: 's1', mode: 'ralph' })
  expect(got.active).toBe(true)
})
