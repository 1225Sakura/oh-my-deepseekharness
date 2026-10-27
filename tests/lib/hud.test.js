import { test, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HUD_FIELDS, HUD_CONTRACT_VERSION, MODE_LABELS, PRESETS, HUD_DEFAULT_PRESET, TIER,
  summarize, diffSummary, renderCard, buildHudView, createSummaryReader, createPollingHud,
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

// ---------- renderCard：中文摘要卡（至多 8 行；活跃/空态两态各有恰满预算） ----------

test('renderCard：活跃卡（HUD 重设计）——模式·阶段合并行 + 故事 + 轮次「未上报」诚实口径；多模式小注；非 stale 无 stale 行', () => {
  const view = buildHudView({
    status: {
      activeCount: 2,
      modes: [
        { mode: 'ralph', sessionId: 's1', iteration: 2, current_story: 'S4', active_agents: ['a'], updatedAt: '2026-09-22T11:00:00.000Z' },
        { mode: 'team', sessionId: 's2', iteration: 1, active_agents: [], updatedAt: '2026-09-22T10:00:00.000Z' },
      ],
    },
    stats: { working: 0, priority: 1, manual: 0 },
  })
  const card = renderCard(view.summary, view.detail)
  const lines = card.split('\n')
  expect(lines.length).toBeLessThanOrEqual(8)          // B1′：≤8 行预算
  expect(lines[0]).toBe('[omd] 编排状态')               // 无 prompt_echo 时回退原标题
  expect(card).toContain('模式: ralph（Ralph 循环） · 阶段: 未设置')  // 主模式 + 中文 label + 阶段合并行
  expect(card).toContain('轮次: 2')                     // 轮次行
  expect(card).not.toContain('代理:')                   // R2 修复：恒 0 的自觉填报计数行已移除
  expect(card).toContain('故事: S4')                     // 无 PRD join 时回退故事行
  expect(card).toContain('记忆: 永久 1 · 工作 0 · 手动 0')
  expect(card).toContain('另有 1 个活跃模式')            // 一行小注（N3）
  expect(card).not.toContain('未更新')                  // 非 stale 不出现 stale 行
  expect(card).not.toContain('round:')                  // AC2：无 round:- 黑话
})

test('renderCard：任务句首行 + PRD 进度行（HUD 重设计 R3：回答「在干嘛/到哪了」）', () => {
  const view = buildHudView({
    status: {
      activeCount: 1,
      modes: [{ mode: 'ralph', sessionId: 's1', iteration: 1, updatedAt: '2026-09-22T11:00:00.000Z',
        prompt_echo: '全面审查插件：链路闭环 / HUD 价值 / 人性化使用，这是一段很长的任务描述会被截断' }],
    },
    stats: {},
  })
  const detail = { ...view.detail, prd: { path: '.omd/prd/x.json', done: 2, total: 4, current: 'S3' } }
  const card = renderCard(view.summary, detail)
  const lines = card.split('\n')
  expect(lines[0].startsWith('[omd] 全面审查插件')).toBe(true)  // 任务句首行
  expect(lines[0].length).toBeLessThanOrEqual(6 + 36 + 1)       // 截断 36 字符 + '…'
  expect(card).toContain('进度: story 2/4 通过（当前: S3）')     // PRD 进度行优先于故事行
  expect(card).not.toContain('故事:')                            // PRD 在场时故事行让位
})

test('renderCard：stale 主模式含锁定子串「未更新」；stale 行保底在行数预算内', () => {
  const view = buildHudView({
    status: {
      activeCount: 2,
      modes: [
        { mode: 'autopilot', sessionId: 's1', current_phase: 'execution', iteration: 5, active_agents: ['a'], updatedAt: '2020-01-01T00:00:00.000Z', stale: true },
        { mode: 'team', sessionId: 's2', active_agents: [], updatedAt: '2020-01-01T00:00:00.000Z' },
      ],
    },
    stats: {},
  })
  const card = renderCard(view.summary, view.detail)
  const lines = card.split('\n')
  expect(card).toContain('未更新')                       // AC3 锁定子串（全计划唯一口径）
  expect(card).toContain('上次更新：2020-01-01T00:00:00.000Z')
  expect(card).toContain('模式: autopilot（自动驾驶）')
  expect(lines.length).toBeLessThanOrEqual(8)           // 行数预算（stale 行保底入内）
  expect(lines[lines.length - 1]).toContain('未更新')    // stale 行保底最后一条
})

test('renderCard：空态（HUD 重设计 R1）——「没有运行」+ 上次活动行 + 启动提示 + 记忆行', () => {
  const card = renderCard(summarize({ status: { activeCount: 0, modes: [] }, stats: { working: 1 } }))
  const lines = card.split('\n')
  expect(lines.length).toBeLessThanOrEqual(8)
  expect(card).toContain('没有运行')                     // AC2 空态表述
  expect(card).not.toContain('round')                    // AC2：无 round:- 黑话
  expect(card).not.toContain('idle')                     // 新空态卡无 idle 字样
  expect(card).toContain('启动')                         // 一行启动提示（替代 5 模式广告）
  expect(card).toContain('记忆:')
  expect(lines).toHaveLength(4)                          // 标题+没有运行+启动提示+记忆（无 lastActivity）
  // 有 lastActivity 时插入「上次活动」行
  const card2 = renderCard(summarize({ status: { activeCount: 0, modes: [] }, stats: {} }),
    { lastActivity: { mode: 'ralph', updatedAt: '2026-10-26T09:00:00.000Z' } })
  expect(card2).toContain('上次活动: ralph · 2026-10-26T09:00:00.000Z')
  expect(card2.split('\n')).toHaveLength(5)
})

// ---------- buildHudView：detail/modeCatalog/tier 派生（AC4/AC10，只进 hud.json 不进 MCP wire） ----------

test('buildHudView：detail fresh-first 透传含 sessionId+label；modeCatalog idle 恒在', () => {
  const view = buildHudView({
    status: {
      activeCount: 2,
      modes: [
        { mode: 'team', sessionId: 's2', iteration: 1, updatedAt: '2026-09-22T10:00:00.000Z' },
        { mode: 'ralph', sessionId: 's1', iteration: 2, updatedAt: '2026-09-22T11:00:00.000Z' },
      ],
    },
    stats: { working: 1, priority: 0, manual: 0 },
  })
  expect(Object.keys(view).sort()).toEqual(['detail', 'lastActivity', 'modeCatalog', 'summary', 'tier'])  // HUD 重设计：+lastActivity（加性）
  expect(view.detail.primary).toBe('ralph')                       // primary=modes[0].mode（fresh-first）
  expect(view.detail.modes[0]).toMatchObject({ mode: 'ralph', sessionId: 's1', iteration: 2, label: 'Ralph 循环' })  // A2：透传含 sessionId
  expect(view.detail.modes.map(m => m.mode)).toEqual(['ralph', 'team'])
  expect(view.modeCatalog).toHaveLength(Object.keys(MODE_LABELS).length)
  for (const { mode, label } of view.modeCatalog) expect(label).toBe(MODE_LABELS[mode])
  // idle 也输出完整目录（modeCatalog 恒在），空态卡无 stale 行
  const idleView = buildHudView({ status: { activeCount: 0, modes: [] }, stats: {} })
  expect(idleView.detail).toEqual({ primary: null, modes: [] })
  expect(idleView.modeCatalog).toHaveLength(Object.keys(MODE_LABELS).length)
  expect(idleView.summary.mode).toBe('idle')
  expect(renderCard(idleView.summary, idleView.detail)).not.toContain('未更新')
})

test('buildHudView tier：AC10 三档判定 danger>warn>ok（stale/fix+fixLoops/state=failed）', () => {
  const st = over => ({ activeCount: 1, modes: [{ mode: 'autopilot', updatedAt: '2026-09-22T11:00:00.000Z', ...over }] })
  expect(buildHudView({ status: st(), stats: {} }).tier).toBe(TIER.OK)
  expect(buildHudView({ status: st({ stale: true }), stats: {} }).tier).toBe(TIER.WARN)              // 主模式 stale
  expect(buildHudView({ status: st({ current_phase: 'fix', fixLoops: 2 }), stats: {} }).tier).toBe(TIER.WARN)  // fix+fixLoops>=2
  expect(buildHudView({ status: st({ current_phase: 'fix', fixLoops: 1 }), stats: {} }).tier).toBe(TIER.OK)    // fixLoops<2 不触发
  expect(buildHudView({ status: st({ state: 'failed', stale: true }), stats: {} }).tier).toBe(TIER.DANGER)     // danger 优先于 warn
})

test('S7 常量锁定：MODE_LABELS 五模式中文 label；PRESETS 序与默认值；TIER 三档', () => {
  expect(Object.keys(MODE_LABELS)).toEqual(['autopilot', 'ralph', 'team', 'ralplan', 'deep-interview'])
  expect(Object.values(MODE_LABELS)).toEqual(['自动驾驶', 'Ralph 循环', '团队', '共识规划', '深度访谈'])
  expect(PRESETS).toEqual(['minimal', 'focused', 'full'])
  expect(HUD_DEFAULT_PRESET).toBe('focused')
  expect(TIER).toEqual({ OK: 'ok', WARN: 'warn', DANGER: 'danger' })
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
