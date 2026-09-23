// tests/mcp-server/hud.test.js
// c4 HUD server 面（v0.4 P2-D）：hud_render / hud_summary 经 MCP 暴露 lib/hud.js 五要素契约
import { test, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeHudTools } from '../../mcp-server/tools/hud.mjs'
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
    expect(r.card).toContain('[omd] HUD 摘要卡')
    expect(r.card).toContain('mode:   idle')
    expect(r.card.split('\n')).toHaveLength(6) // 6 行有界契约
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
    expect(r.card).toContain('agents: 2')
    expect(r.card).toContain('working=1 priority=1 manual=0')
    const s = await hud.summary({ cwd })
    expect(s).toEqual(r.summary) // summary 工具与 render 同源
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
