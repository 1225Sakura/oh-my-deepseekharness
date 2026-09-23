// tests/lib/hud-route.test.js
// v0.4 P2-D HUD 路由（node 数据面）：handler 语义 + webServer 注册/降级契约
import { test, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HUD_ROUTE_PATH, hudSnapshot, makeHudHandler, registerHudRoute } from '../../lib/hud-route.js'
import { makeStateTools } from '../../mcp-server/tools/state.mjs'
import { makeNotepadTools } from '../../mcp-server/tools/notepad.mjs'

function mockRes() {
  const r = { status: null, headers: null, body: null }
  r.writeHead = (code, headers) => { r.status = code; r.headers = headers }
  r.end = (body) => { r.body = body }
  return r
}

test('hudSnapshot：真实 .omd 状态 → 五要素摘要 + 6 行卡', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hudr-'))
  try {
    const env = { stateDir: '.omd' }
    await makeStateTools(env).write({
      cwd, sessionId: 's1', mode: 'autopilot',
      state: { active: true, current_phase: 'execution', iteration: 2, active_agents: ['a1'] },
    })
    await makeNotepadTools(env).writeWorking({ cwd, text: 'w1' })
    const snap = await hudSnapshot({ cwd, stateDir: '.omd' })
    expect(snap.ok).toBe(true)
    expect(snap.summary).toMatchObject({ mode: 'autopilot', round: 2, agents: 1 })
    expect(snap.summary.todo).toMatchObject({ working: 1 })
    expect(snap.card.split('\n')).toHaveLength(6)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('handler：?cwd= 显式指定优先；响应 JSON + no-store；异常 500', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hudr-'))
  try {
    const seen = []
    const handler = makeHudHandler({ stateDir: '.omd', snapshot: async (a) => { seen.push(a); return { ok: true, cwd: a.cwd, summary: {}, card: 'x' } } })
    const res = mockRes()
    await handler({ method: 'GET', url: `/oh-my-dsh/hud.json?cwd=${encodeURIComponent(cwd)}` }, res)
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(JSON.parse(res.body).cwd).toBe(cwd)
    expect(seen[0].cwd).toBe(cwd)

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

test('registerHudRoute：webServer 缺席 → skipped 降级；在场 → exact 注册 + effect dispose', () => {
  const r1 = registerHudRoute({}, { config: {} })
  expect(r1.enabled).toBe(false)
  expect(r1.detail).toContain('webServer')

  const registered = []
  const disposals = []
  const effects = []
  const ctx = {
    get(name) { return name === 'webServer' ? webServer : undefined },
    effect(fn) { effects.push(fn) },
  }
  const webServer = {
    register(route) { registered.push(route); return () => disposals.push(route.path) },
  }
  const r2 = registerHudRoute(ctx, { config: {} })
  expect(r2.enabled).toBe(true)
  expect(effects).toHaveLength(1)
  const dispose = effects[0]()
  expect(registered).toEqual([{ kind: 'exact', path: HUD_ROUTE_PATH, handler: expect.any(Function) }])
  dispose()
  expect(disposals).toEqual([HUD_ROUTE_PATH]) // 插件重放/卸载摘路由
})
