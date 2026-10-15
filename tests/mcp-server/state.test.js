import { test, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeStateTools } from '../../mcp-server/tools/state.mjs'

async function tools() {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-'))
  const t = makeStateTools({ stateDir: '.omd' })
  return { t, cwd }
}

test('write 后 read 读回，自动带 _meta', async () => {
  const { t, cwd } = await tools()
  await t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true, iteration: 1 } })
  const got = await t.read({ cwd, sessionId: 's1', mode: 'ralph' })
  expect(got.active).toBe(true)
  expect(got._meta).toMatchObject({ mode: 'ralph', sessionId: 's1', updatedBy: 's1' })
  expect(typeof got._meta.updatedAt).toBe('string')
})

test('跨会话写被拒绝（所有权强制）', async () => {
  const { t, cwd } = await tools()
  await t.write({ cwd, sessionId: 's1', mode: 'team', state: { active: true } })
  await expect(t.write({ cwd, sessionId: 's2', mode: 'team', state: { active: false } }))
    .rejects.toThrow(/owned by session/)
})

test('写前读检查：expectUpdatedAt 不匹配时拒绝', async () => {
  const { t, cwd } = await tools()
  await t.write({ cwd, sessionId: 's1', mode: 'autopilot', state: { active: true, current_phase: 'plan' } })
  const cur = await t.read({ cwd, sessionId: 's1', mode: 'autopilot' })
  await expect(t.write({ cwd, sessionId: 's1', mode: 'autopilot', state: { current_phase: 'exec' }, expectUpdatedAt: ' stale' }))
    .rejects.toThrow(/conflict/)
  await t.write({ cwd, sessionId: 's1', mode: 'autopilot', state: { current_phase: 'exec' }, expectUpdatedAt: cur._meta.updatedAt }) // 不抛
})

test('listActive 只列 active:true 的模式，跨会话聚合只读', async () => {
  const { t, cwd } = await tools()
  await t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true } })
  await t.write({ cwd, sessionId: 's1', mode: 'team', state: { active: false } })
  await t.write({ cwd, sessionId: 's2', mode: 'autopilot', state: { active: true } })
  const list = await t.listActive({ cwd })
  expect(list.map(x => `${x._meta.sessionId}:${x._meta.mode}`).sort())
    .toEqual(['s1:ralph', 's2:autopilot'])
})

test('clear 删除文件，重复 clear 幂等', async () => {
  const { t, cwd } = await tools()
  await t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true } })
  await t.clear({ cwd, sessionId: 's1', mode: 'ralph' })
  await t.clear({ cwd, sessionId: 's1', mode: 'ralph' })
  expect(await t.read({ cwd, sessionId: 's1', mode: 'ralph' })).toBeUndefined()
})

test('prompt_echo 超过 1200 字符被截断', async () => {
  const { t, cwd } = await tools()
  await t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true, prompt_echo: 'x'.repeat(2000) } })
  const got = await t.read({ cwd, sessionId: 's1', mode: 'ralph' })
  expect(got.prompt_echo.length).toBeLessThanOrEqual(1200)
})

// ---------- 终审修复 L3：孤儿文件（缺 _meta）报错文案 ----------

// ---------- c4 HUD 数据面：getStatus 投影透传（加性，现成读面零新宿主槽位） ----------

test('getStatus 投影透传 current_story 与 active_agents；缺席为 undefined', async () => {
  const { t, cwd } = await tools()
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

test('孤儿 state 文件（缺 _meta）的报错文案显示 <unknown> 而非 undefined', async () => {
  const { t, cwd } = await tools()
  const { mkdir, writeFile } = await import('node:fs/promises')
  // 手工在别的会话目录放一个无 _meta 的孤儿文件
  await mkdir(join(cwd, '.omd', 'state', 'sessions', 'ghost'), { recursive: true })
  await writeFile(join(cwd, '.omd', 'state', 'sessions', 'ghost', 'ralph-state.json'),
    JSON.stringify({ active: true }), 'utf8')
  await expect(t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true } }))
    .rejects.toThrow(/<unknown>|ghost/)
})
test('getStatus U3/AC10 加性透传：state 与 fixLoops（两种拼法兜底）；缺席为 undefined', async () => {
  const { t, cwd } = await tools()
  await t.write({ cwd, sessionId: 's1', mode: 'ralph',
    state: { active: true, state: 'running', fix_loop_count: 2 } })
  const st = await t.getStatus({ cwd })
  expect(st.modes[0].state).toBe('running')
  expect(st.modes[0].fixLoops).toBe(2)
  await t.write({ cwd, sessionId: 's2', mode: 'team',
    state: { active: true, fixLoops: 1 } })
  const st2 = await t.getStatus({ cwd })
  // fresh-first 同毫秒 tie-break 按 mode 名稳定序——按 mode 名取项，不依赖 modes[0]
  expect(st2.modes.find(m => m.mode === 'team').fixLoops).toBe(1)
  await t.write({ cwd, sessionId: 's3', mode: 'autopilot', state: { active: true } })
  const st3 = await t.getStatus({ cwd })
  expect(st3.modes.find(m => m.mode === 'autopilot').state).toBeUndefined()
  expect(st3.modes.find(m => m.mode === 'autopilot').fixLoops).toBeUndefined()
})


// ---------- IC-20/IC-21 修复：所有权绑定谓词收窄（.omd/plans/ralplan-mode-state-lifecycle.md） ----------

test('IC-21：inactive/已交接状态不绑定所有权——新会话直接激活取代（审计+active:false+listActive 不含）', async () => {
  const { t, cwd } = await tools()
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
  const { t, cwd } = await tools()
  await t.write({ cwd, sessionId: 'leaf', mode: 'ralph', state: { active: true, current_phase: 'keyword-detected',
    keyword_route: { target: 'ralph', trigger: 'ralph', intent: 'explicit', source: 'keyword-hook' } } })
  await t.write({ cwd, sessionId: 'main', mode: 'ralph', state: { active: true, current_phase: 'running' } }) // 不抛
  const leafFile = await t.read({ cwd, sessionId: 'leaf', mode: 'ralph' })
  expect(leafFile.active).toBe(false)
  expect(leafFile.supersededBy).toBe('main')
})

test('IC-20 ABA 防线：被取代会话携预写注入块旧 expectUpdatedAt 续写 → conflict 拒绝', async () => {
  const { t, cwd } = await tools()
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
  const { t, cwd } = await tools()
  await t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true, current_phase: 'keyword-detected' } })
  await expect(t.write({ cwd, sessionId: 's2', mode: 'ralph', state: { active: true } }))
    .rejects.toThrow(/owned by session/)
})

test('双 stale 全被取代：循环 continue 扫全部 session，不因首个非绑定态短路', async () => {
  const { t, cwd } = await tools()
  await t.write({ cwd, sessionId: 'stale1', mode: 'ralph', state: { active: false } })
  await t.write({ cwd, sessionId: 'stale2', mode: 'ralph', state: { active: true, current_phase: 'keyword-detected',
    keyword_route: { source: 'keyword-hook' } } })
  await t.write({ cwd, sessionId: 'new', mode: 'ralph', state: { active: true, current_phase: 'running' } }) // 不抛
  expect((await t.read({ cwd, sessionId: 'stale1', mode: 'ralph' })).supersededBy).toBe('new')
  expect((await t.read({ cwd, sessionId: 'stale2', mode: 'ralph' })).supersededBy).toBe('new')
})

test('存活常规态绑定保持：active:true 无 phase 的他 session 文件仍拒绝（回归钉）', async () => {
  const { t, cwd } = await tools()
  await t.write({ cwd, sessionId: 'live', mode: 'ralph', state: { active: true, current_phase: 'running' } })
  await expect(t.write({ cwd, sessionId: 'other', mode: 'ralph', state: { active: true } }))
    .rejects.toThrow(/owned by session/)
})