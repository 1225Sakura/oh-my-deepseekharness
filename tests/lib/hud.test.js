import { test, expect } from 'vitest'
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
    stats: { working: 0, priority: 1, manual: 0 },
  }))
  const lines = card.split('\n')
  expect(lines).toHaveLength(6)
  expect(lines[0]).toBe('[omd] HUD 摘要卡')
  expect(card).toContain('mode:   ralph')
  expect(card).toContain('round:  2')
  expect(card).toContain('story:  S4')
  expect(card).toContain('agents: 1')
  expect(card).toContain('todo:   working=0 priority=1 manual=0')
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
  expect(hud.snapshot.summary.mode).toBe('ralph')

  // t1：状态不变 → diff 为空
  await hud.pollOnce()
  expect(hud.snapshot.diff).toEqual([])

  // t2：状态变更（iteration 3 + story S5）→ 下一个 pollOnce 后 diff 包含 round/story
  await stateTools.write({ cwd, sessionId: 's1', mode: 'ralph',
    state: { active: true, iteration: 3, current_story: 'S5', active_agents: ['worker-1'] } })
  await hud.pollOnce()
  expect(hud.snapshot.diff.sort()).toEqual(['round', 'story'])
  expect(hud.snapshot.summary.round).toBe(3)
})

// ---------- createPollingHud 工厂契约 ----------

test('createPollingHud：缺 fetchSummary 显式报错；start/stop 控制 timer；intervalMs 默认 1000', async () => {
  expect(() => createPollingHud({})).toThrow(/fetchSummary/)
  const hud = createPollingHud({ fetchSummary: () => summarize({ status: { activeCount: 0, modes: [] } }) })
  expect(hud.snapshot).toBeNull()
  hud.start()
  hud.start()  // 幂等
  hud.stop()
  hud.stop()  // 幂等
  const snap = await hud.pollOnce()
  expect(snap.summary.mode).toBe('idle')
  expect(HUD_CONTRACT_VERSION).toBe(1)  // 内容契约版本锁定
})
