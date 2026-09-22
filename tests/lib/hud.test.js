import { test, expect, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HUD_FIELDS, HUD_CONTRACT_VERSION,
  summarize, diffSummary, renderCard, createSummaryReader, createPollingHud,
} from '../../lib/hud.js'
import { makeStateTools } from '../../mcp-server/tools/state.mjs'
import { makeNotepadTools } from '../../mcp-server/tools/notepad.mjs'

// ---------- summarize：五要素映射（契约） ----------

test('summarize：最新活跃模式为主，五要素逐一落位', () => {
  const summary = summarize({
    status: {
      activeCount: 2,
      modes: [
        { mode: 'team', sessionId: 's2', iteration: 1, current_story: 'S9', active_agents: ['x', 'y'], updatedAt: '2026-09-22T10:00:00.000Z' },
        { mode: 'ralph', sessionId: 's1', iteration: 2, current_story: 'S4', active_agents: ['a'], updatedAt: '2026-09-22T11:00:00.000Z' },
      ],
    },
    stats: { priority: 1, working: 3, manual: 2 },
  })
  expect(Object.keys(summary)).toEqual(HUD_FIELDS)  // 内容契约封闭：恰五字段
  expect(summary.mode).toBe('ralph+team')           // 全部活跃模式名排序联结
  expect(summary.round).toBe(2)                     // 最新模式（ralph, 11:00）的轮次
  expect(summary.story).toBe('S4')
  expect(summary.agents).toBe(1)
  expect(summary.todo).toEqual({ working: 3, priority: 1, manual: 2 })
})

test('summarize：无活跃模式 → idle，stats 缺席 → 三区计 0', () => {
  expect(summarize({ status: { activeCount: 0, modes: [] } })).toEqual({
    mode: 'idle', round: null, story: null, agents: 0,
    todo: { working: 0, priority: 0, manual: 0 },
  })
  expect(summarize()).toMatchObject({ mode: 'idle', agents: 0 })  // 全缺席不炸
})

// ---------- diffSummary：逐字段 diff（镜像断言验收面） ----------

test('diffSummary：一致=空数组；单字段变=恰该字段；对象键序无关', () => {
  const a = { mode: 'ralph', round: 2, story: 'S4', agents: 1, todo: { working: 3, priority: 1, manual: 2 } }
  expect(diffSummary(a, { ...a })).toEqual([])
  expect(diffSummary(a, { ...a, story: 'S5' })).toEqual(['story'])
  expect(diffSummary(a, { ...a, round: 3, agents: 2 })).toEqual(['round', 'agents'])  // 按契约序
  expect(diffSummary(a, { ...a, todo: { priority: 1, manual: 2, working: 3 } })).toEqual([])  // 键序无关
  expect(diffSummary(a, { ...a, todo: { working: 4, priority: 1, manual: 2 } })).toEqual(['todo'])
  expect(diffSummary(a, { mode: 'x', extra: 1 })).toEqual(HUD_FIELDS)  // 多余字段不进 diff
})

// ---------- renderCard：最小摘要卡（R11 档位：无实时面板/流式） ----------

test('renderCard：六行有界文本含五要素；部分形态输入不炸', () => {
  const card = renderCard(summarize({
    status: { activeCount: 1, modes: [{ mode: 'ralph', iteration: 2, current_story: 'S4', active_agents: ['a'], updatedAt: '2026-09-22T11:00:00.000Z' }] },
    stats: { priority: 0, working: 1, manual: 0 },
  }))
  const lines = card.split('\n')
  expect(lines).toHaveLength(6)
  expect(lines[0]).toBe('[omd] HUD 摘要卡')
  expect(card).toContain('mode:   ralph')
  expect(card).toContain('round:  2')
  expect(card).toContain('story:  S4')
  expect(card).toContain('agents: 1')
  expect(card).toContain('todo:   working=1 priority=0 manual=0')
  expect(renderCard()).toContain('idle')  // 空态可渲染
})

// ---------- 数据源装配：只接 state_get_status + notepad_stats 两个现成读面 ----------

function makeEnv() {
  return { stateTools: makeStateTools({ stateDir: '.omd' }), notepadTools: makeNotepadTools({ stateDir: '.omd' }) }
}

test('createSummaryReader：只消费 getStatus+stats 两读面；缺读面/缺工作区显式报错', async () => {
  expect(() => createSummaryReader({})).toThrow(/getStatus/)
  const { stateTools, notepadTools } = makeEnv()
  expect(() => createSummaryReader({ stateTools, notepadTools })).toThrow(/cwd/)  // 缺工作区显式报错
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hud-'))
  const reader = createSummaryReader({ stateTools, notepadTools, cwd })
  await stateTools.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true, iteration: 2, current_story: 'S4' } })
  const summary = await reader()
  expect(summary).toMatchObject({ mode: 'ralph', round: 2, story: 'S4' })
})

// ---------- C2 镜像断言：状态变更 → ≤N=1 轮询周期内逐字段 diff 为空 ----------

test('C2 镜像断言：状态变更后恰 1 个轮询周期，摘要卡与状态源逐字段 diff 为空', async () => {
  const { stateTools, notepadTools } = makeEnv()
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hud-'))
  const reader = createSummaryReader({ stateTools, notepadTools, cwd })
  const hud = createPollingHud({ fetchSummary: reader })

  // t0：初态落卡（物化拍）
  await stateTools.write({ cwd, sessionId: 's1', mode: 'ralph',
    state: { active: true, iteration: 2, current_story: 'S4', active_agents: ['worker-1'] } })
  await notepadTools.writeWorking({ cwd, text: 't1' })
  await hud.pollOnce()
  expect(hud.snapshot.summary).toMatchObject({ mode: 'ralph', round: 2, story: 'S4', agents: 1 })

  // t1：状态变更（story/轮次/agent/todo 四处）
  await stateTools.write({ cwd, sessionId: 's1', mode: 'ralph',
    state: { active: true, iteration: 3, current_story: 'S5', active_agents: ['worker-1', 'worker-2'] } })
  await notepadTools.writeWorking({ cwd, text: 't2' })

  // 恰 1 个轮询周期（N=1）后：卡片 vs 状态源现值，逐字段 diff 为空
  await hud.pollOnce()
  const sourceNow = await reader()
  expect(diffSummary(hud.snapshot.summary, sourceNow)).toEqual([])
  expect(hud.snapshot.summary.story).toBe('S5')
  expect(renderCard(hud.snapshot.summary)).toContain('story:  S5')
})

test('C2 反例：状态变更后 0 个轮询周期，diff 非空（镜像滞后可见）', async () => {
  const { stateTools, notepadTools } = makeEnv()
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hud-'))
  const reader = createSummaryReader({ stateTools, notepadTools, cwd })
  const hud = createPollingHud({ fetchSummary: reader })
  await stateTools.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true, iteration: 1, current_story: 'S4' } })
  await hud.pollOnce()
  await stateTools.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true, iteration: 2, current_story: 'S5' } })
  // 0 周期：卡片仍是旧拍，与状态源现值 diff 至少含 story（镜像断言的负对照）
  expect(diffSummary(hud.snapshot.summary, await reader())).toContain('story')
})

// ---------- C3 升级路径：内容契约不变，只换刷新机制 ----------

test('C3 契约-机制分离：直接取数与轮询适配器对同一状态产出逐字段一致的卡', async () => {
  const { stateTools, notepadTools } = makeEnv()
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hud-'))
  await stateTools.write({ cwd, sessionId: 's1', mode: 'autopilot', state: { active: true, iteration: 4, current_story: 'S6', active_agents: ['a', 'b'] } })
  await notepadTools.writePriority({ cwd, text: 'p' })

  // 机制 A：父侧轮询适配器
  const viaPolling = createPollingHud({ fetchSummary: createSummaryReader({ stateTools, notepadTools, cwd }) })
  await viaPolling.pollOnce()
  // 机制 B（模拟升级后的取数通道）：不经轮询适配器，直接调同一 reader
  const viaDirect = await createSummaryReader({ stateTools, notepadTools, cwd })()

  expect(diffSummary(viaPolling.snapshot.summary, viaDirect)).toEqual([])       // 内容契约不变
  expect(renderCard(viaPolling.snapshot.summary)).toBe(renderCard(viaDirect))   // 渲染面逐字节一致
  expect(HUD_CONTRACT_VERSION).toBe(1)                                          // 升级不换契约版本
})

// ---------- 轮询适配器：参数校验与生命周期 ----------

test('createPollingHud：缺 fetchSummary 报错；start/stop 生命周期生效', async () => {
  expect(() => createPollingHud({})).toThrow(/fetchSummary/)
  vi.useFakeTimers()
  try {
    let calls = 0
    const hud = createPollingHud({ fetchSummary: async () => { calls++; return summarize() }, intervalMs: 50 })
    hud.start()
    await vi.advanceTimersByTimeAsync(120)   // ~2 个周期
    const at = hud.snapshot.at
    expect(calls).toBeGreaterThanOrEqual(2)
    hud.stop()
    await vi.advanceTimersByTimeAsync(500)
    expect(hud.snapshot.at).toBe(at)         // stop 后不再轮询
  } finally {
    vi.useRealTimers()
  }
})
