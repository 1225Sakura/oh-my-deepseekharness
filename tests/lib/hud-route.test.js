// tests/lib/hud-route.test.js
// v0.4 P2-D HUD 路由（node 数据面）：handler 语义 + webServer 注册/降级契约
import { test, expect } from 'vitest'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HUD_ROUTE_PATH, hudSnapshot, makeHudHandler, registerHudRoute } from '../../lib/hud-route.js'
import { recordRouteEvent } from '../../lib/events.js'
const MOCK_TABLE = (() => { const m = new Map(); return { get: k => m.get(k), put: async (k, v) => { m.set(k, v) }, delete: async k => m.delete(k), keys: () => [...m.keys()] } })()
import { makeStateTools } from '../../lib/state/tools/state.mjs'
import { makeNotepadTools } from '../../lib/state/tools/notepad.mjs'

function mockRes() {
  const r = { status: null, headers: null, body: null }
  r.writeHead = (code, headers) => { r.status = code; r.headers = headers }
  r.end = (body) => { r.body = body }
  return r
}

test('hudSnapshot：真实 .omd 状态 → 五要素摘要 + 至多 8 行卡 + detail/modeCatalog/preset', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hudr-'))
  try {
    const env = { stateDir: '.omd', table: MOCK_TABLE }
    await makeStateTools(env).write({
      cwd, sessionId: 's1', mode: 'autopilot',
      state: { active: true, current_phase: 'execution', iteration: 2, active_agents: ['a1'] },
    })
    await makeNotepadTools(env).writeWorking({ cwd, text: 'w1' })
    const snap = await hudSnapshot({ cwd, stateDir: '.omd', stateTable: MOCK_TABLE })
    expect(snap.ok).toBe(true)
    expect(snap.summary).toMatchObject({ mode: 'autopilot', round: 2, agents: 1 })
    expect(snap.summary.todo).toMatchObject({ working: 1 })
    expect(snap.card.split('\n').length).toBeLessThanOrEqual(8)  // B1′：恰 6 行 → ≤8
    // AC5：顶层键集白名单锁定（二期③ team 运行时退役 → {workers}/{alerts} 键移除）
    expect(Object.keys(snap).sort())
      .toEqual(['at', 'card', 'cwd', 'detail', 'lastActivity', 'modeCatalog', 'ok', 'preset', 'summary', 'toolCalls'])
    expect(snap.detail.primary).toBe('autopilot')
    expect(snap.detail.modes[0]).toMatchObject({ mode: 'autopilot', sessionId: 's1', label: '自动驾驶' })
    expect(snap.detail.tier).toBe('ok') // U3/O2：tier 并入 detail 下发（lib 单源 → client 优先采用；顶层键集白名单不变）
    expect(snap.modeCatalog).toHaveLength(5)
    for (const { mode, label } of snap.modeCatalog) expect(label).toBeTruthy()
    expect(snap.card).toContain('模式: autopilot（自动驾驶）')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('hudSnapshot preset（AC11/S8）：缺省 focused；非法回退 focused；合法透传', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hudr-'))
  try {
    expect((await hudSnapshot({ cwd, stateDir: '.omd', stateTable: MOCK_TABLE })).preset).toBe('focused')
    expect((await hudSnapshot({ cwd, stateDir: '.omd', config: { hudPreset: 'no-such' } })).preset).toBe('focused')
    expect((await hudSnapshot({ cwd, stateDir: '.omd', config: { hudPreset: 'full' } })).preset).toBe('full')
    expect((await hudSnapshot({ cwd, stateDir: '.omd', config: { hudPreset: 'minimal' } })).preset).toBe('minimal')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('handler：?cwd= 显式指定优先；响应 JSON + no-store；异常 500', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hudr-'))
  try {
    const seen = []
    const handler = makeHudHandler({ stateDir: '.omd', config: { hudPreset: 'minimal' }, snapshot: async (a) => { seen.push(a); return { ok: true, cwd: a.cwd, summary: {}, card: 'x', preset: 'minimal' } } })
    const res = mockRes()
    await handler({ method: 'GET', url: `/oh-my-dsh/hud.json?cwd=${encodeURIComponent(cwd)}` }, res)
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(JSON.parse(res.body).cwd).toBe(cwd)
    expect(seen[0].cwd).toBe(cwd)
    expect(seen[0].config).toEqual({ hudPreset: 'minimal' })  // config 透传至 snapshot（S8 preset 来源）

    // 评审修复：POST 405；不存在的 cwd 404（路径 oracle 收窄）
    const resPost = mockRes()
    await handler({ method: 'POST', url: '/oh-my-dsh/hud.json' }, resPost)
    expect(resPost.status).toBe(405)
    const res404 = mockRes()
    await handler({ method: 'GET', url: '/oh-my-dsh/hud.json?cwd=C%3A%2Fno-such-dir-omd-xyz' }, res404)
    expect(res404.status).toBe(404)

    const boom = makeHudHandler({ snapshot: async () => { throw new Error('disk gone') } })
    const res2 = mockRes()
    await boom({ method: 'GET', url: '/oh-my-dsh/hud.json' }, res2)
    expect(res2.status).toBe(500)
    expect(JSON.parse(res2.body).error).toContain('disk gone')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})


test('AC-6 空态/坏 registry：无 team 目录与 events → toolCalls 空聚合；单 run 坏 JSON 跳过该 run 不 500', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hudr-'))
  try {
    const s0 = await hudSnapshot({ cwd, stateDir: '.omd', stateTable: MOCK_TABLE })
    expect(s0.ok).toBe(true)
    expect(s0.toolCalls).toEqual({ total: 0, byTier: { low: 0, medium: 0, high: 0, explicit: 0 }, fallbackCount: 0 })

    // team registry 面已退役：目录出现与否均不影响快照（不 500 即契约）
    const badDir = join(cwd, '.omd', 'team', 'run-bad')
    await mkdir(badDir, { recursive: true })
    await writeFile(join(badDir, 'registry.json'), '{broken json', 'utf8')
    const s1 = await hudSnapshot({ cwd, stateDir: '.omd', stateTable: MOCK_TABLE })
    expect(s1.ok).toBe(true)
    expect(s1.ok).toBe(true) // registry 残渣不再参与快照
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
