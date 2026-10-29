// tests/mcp-server/hud.test.js
// c4 HUD server 面（v0.4 P2-D）：hud_render / hud_summary 经 MCP 暴露 lib/hud.js 五要素契约
import { test, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeHudTools, registerHudTools } from '../../mcp-server/tools/hud.mjs'
import { makeStateTools } from '../../mcp-server/tools/state.mjs'
import { makeNotepadTools } from '../../mcp-server/tools/notepad.mjs'

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hud-'))
  const env = { stateDir: '.omd' }
  return { cwd, hud: makeHudTools(env), state: makeStateTools(env), notepad: makeNotepadTools(env) }
}

test('空态可渲染：mode=idle，todo 三区 0', async () => {
  const { cwd, hud } = await setup()
  try {
    const r = await hud.render({ cwd })
    expect(r.summary.mode).toBe('idle')
    expect(r.summary.agents).toBe(0)
    expect(r.summary.todo).toEqual({ working: 0, priority: 0, manual: 0 })
    expect(Object.keys(r).sort()).toEqual(['card', 'summary']) // 恰二键，多余键即失败（AC1/AC6）
    expect(r.card).toContain('[omd] 编排状态')                  // 新标题
    expect(r.card).toContain('没有运行')                        // AC2 空态引导
    expect(r.card.split('\n').length).toBeLessThanOrEqual(8)   // B1′：6 行有界 → ≤8 行有界
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('活跃模式 + notepad 条目 → 五要素正确派生', async () => {
  const { cwd, hud, state, notepad } = await setup()
  try {
    await state.write({
      cwd, sessionId: 's1', mode: 'team',
      state: { active: true, current_phase: 'team-exec', iteration: 3, current_story: 'US-2', active_agents: ['w-1', 'w-2'] },
    })
    await notepad.writeWorking({ cwd, text: '临时事项' })
    await notepad.writePriority({ cwd, text: '永久事项' })
    const r = await hud.render({ cwd })
    expect(r.summary.mode).toBe('team')
    expect(r.summary.round).toBe(3)
    expect(r.summary.story).toBe('US-2')
    expect(r.summary.agents).toBe(2)
    expect(r.summary.todo).toMatchObject({ working: 1, priority: 1, manual: 0 })
    expect(r.card).toContain('模式: team（团队） · 阶段: team-exec')  // AC3 中文标签卡（重设计：模式·阶段合并行）
    expect(r.card).toContain('轮次: 3')
    expect(r.card).not.toContain('代理:')                         // HUD 重设计：恒 0 自觉填报字段移出卡面
    expect(r.card).toContain('故事: US-2')                // 五要素 story 不再缺席（报告一 #87）
    expect(r.card).toContain('记忆: 永久 1 · 工作 1 · 手动 0')
    expect(r.card.split('\n').length).toBeLessThanOrEqual(8)
    const s = await hud.summary({ cwd })
    expect(s).toEqual(r.summary) // summary 工具与 render 同源
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('hud_render description（AC6）：中文措辞、至多 8 行、不提 detail/modeCatalog', () => {
  const calls = []
  registerHudTools({ registerTool: (name, def) => calls.push({ name, def }) }, { stateDir: '.omd' })
  const render = calls.find(c => c.name === 'hud_render')
  expect(render).toBeTruthy()
  expect(render.def.description).toContain('至多 8 行')
  expect(render.def.description).not.toContain('6 行')
  expect(render.def.description).not.toContain('detail')
  expect(render.def.description).not.toContain('modeCatalog')
})

test('W4-1 mirror fallback read: when state is missing, c6 run-state mirror fills in the five elements', async () => {
  const { cwd, hud } = await setup()
  try {
    await mkdir(join(cwd, '.omd', 'state'), { recursive: true })
    await writeFile(join(cwd, '.omd', 'state', 'run-state.json'), JSON.stringify({
      mode: 'team', round: 7, current_story: 'S9', active_agents: ['w-1'], todo: { working: 2, priority: 0, manual: 0 }, version: 3, updatedAt: new Date().toISOString(),
    }))
    const r = await hud.render({ cwd })
    expect(r.summary.mode).toBe('team')
    expect(r.summary.round).toBe(7)
    expect(r.summary.story).toBe('S9')
    expect(r.summary.agents).toBe(1)
    expect(r.card).toContain('轮次: 7')
    const s = await hud.summary({ cwd })
    expect(s.round).toBe(7)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('W4-1 mirror freshness window: stale mirror (>2h) does not mislead, remains idle', async () => {
  const { cwd, hud } = await setup()
  try {
    await mkdir(join(cwd, '.omd', 'state'), { recursive: true })
    await writeFile(join(cwd, '.omd', 'state', 'run-state.json'), JSON.stringify({
      mode: 'team', round: 7, current_story: 'S9', active_agents: [], todo: {}, version: 3, updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    }))
    const r = await hud.render({ cwd })
    expect(r.summary.mode).toBe('idle')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})


// ---- P1-W4-1 mirror 回退读（team eco-completion w-P1-3）----
test('mirror 回退：有 mode 无进度字段 → 轮次/故事/代理补值并标 mirror 来源（典型病灶态）', async () => {
  const { cwd, hud, state } = await setup()
  try {
    await state.write({ cwd, sessionId: 's1', mode: 'team', state: { active: true, current_phase: 'team-exec' } })
    await mkdir(join(cwd, '.omd', 'state'), { recursive: true })
    await writeFile(join(cwd, '.omd', 'state', 'run-state.json'), JSON.stringify({
      mode: 'team', round: 5, current_story: 'US-9',
      active_agents: ['w-1', 'w-2', 'w-3'], todo: { working: 1, priority: 0, manual: 0 },
      version: 7, updatedAt: new Date().toISOString(),
    }), 'utf8')
    const r = await hud.render({ cwd })
    expect(r.summary.mode).toBe('team')            // mode 永不被 mirror 覆盖
    expect(r.summary.round).toBe(5)
    expect(r.summary.story).toBe('US-9')
    expect(r.summary.agents).toBe(3)
    expect(r.summary.roundSource).toBe('mirror')
    expect(r.summary.storySource).toBe('mirror')
    expect(r.summary.agentsSource).toBe('mirror')
    expect(r.card).toContain('轮次: 5')             // 卡面消费回退值（不再「未上报直说」）
    expect(r.card).toContain('故事: US-9')
    expect(Object.keys(r).sort()).toEqual(['card', 'summary']) // 恰二键契约不破（AC6）
    const s = await hud.summary({ cwd })
    expect(s).toEqual(r.summary)                   // summary 工具与 render 同源（含来源键）
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('有 state 无 mirror → 现状且无来源键；双无 → 现状', async () => {
  const { cwd, hud, state } = await setup()
  try {
    await state.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true, current_phase: 'exec', iteration: 2, current_story: 'US-1', active_agents: ['w-1'] } })
    const r = await hud.render({ cwd })
    expect(r.summary.round).toBe(2)
    expect(r.summary.roundSource).toBeUndefined()
    expect(r.summary.storySource).toBeUndefined()
    expect(r.summary.agentsSource).toBeUndefined()
    const emptyDir = await mkdtemp(join(tmpdir(), 'omd-hud-empty-'))
    try {
      const empty = await hud.summary({ cwd: emptyDir })
      expect(empty.mode).toBe('idle')
      expect(empty.round).toBeNull()
      expect(empty.roundSource).toBeUndefined()
      expect(empty.storySource).toBeUndefined()
      expect(empty.agentsSource).toBeUndefined()
    } finally { await rm(emptyDir, { recursive: true, force: true }) }
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
