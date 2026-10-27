// tests/lib/hud-route.test.js
// v0.4 P2-D HUD 路由（node 数据面）：handler 语义 + webServer 注册/降级契约
import { test, expect } from 'vitest'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HUD_ROUTE_PATH, hudSnapshot, makeHudHandler, registerHudRoute } from '../../lib/hud-route.js'
import { recordRouteEvent } from '../../lib/events.js'
import { makeStateTools } from '../../mcp-server/tools/state.mjs'
import { makeNotepadTools } from '../../mcp-server/tools/notepad.mjs'

function mockRes() {
  const r = { status: null, headers: null, body: null }
  r.writeHead = (code, headers) => { r.status = code; r.headers = headers }
  r.end = (body) => { r.body = body }
  return r
}

test('hudSnapshot：真实 .omd 状态 → 五要素摘要 + 至多 8 行卡 + detail/modeCatalog/preset', async () => {
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
    expect(snap.card.split('\n').length).toBeLessThanOrEqual(8)  // B1′：恰 6 行 → ≤8
    // AC5：顶层键集白名单锁定（U8 S2 扩为 10 键；S5 扩 {alerts}；HUD 重设计扩 {lastActivity}）
    expect(Object.keys(snap).sort())
      .toEqual(['alerts', 'at', 'card', 'cwd', 'detail', 'lastActivity', 'modeCatalog', 'ok', 'preset', 'summary', 'toolCalls', 'workers'])
    expect(snap.alerts).toEqual([]) // 无 team 目录 → 空告警（ENOENT 不炸）
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
    expect((await hudSnapshot({ cwd, stateDir: '.omd' })).preset).toBe('focused')
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

// U8 S2 辅助：写 run registry（workers=对象映射，team.js:159/177 形状）并用 utimes 钉死
// run 目录 mtime（截断边界=扫描序的权威输入，消除创建顺序/时钟粒度偶然性）
async function writeRegistryFixture(cwd, runId, workers, mtimeIso) {
  const dir = join(cwd, '.omd', 'team', runId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'registry.json'),
    JSON.stringify({ runId, createdAt: '2026-01-01T00:00:00.000Z', workers }), 'utf8')
  const d = new Date(mtimeIso)
  await utimes(dir, d, d) // 写 registry.json 会刷新目录 mtime → 最后钉回目标值
  return dir
}

test('AC-6 空态/坏 registry：无 team 目录与 events → workers 空包 + toolCalls 空聚合；单 run 坏 JSON 跳过该 run 不 500', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hudr-'))
  try {
    const s0 = await hudSnapshot({ cwd, stateDir: '.omd' })
    expect(s0.ok).toBe(true)
    expect(s0.workers).toEqual({ list: [], truncated: false, filteredRuns: 0, filteredWorkers: 0 })
    expect(s0.toolCalls).toEqual({ total: 0, byTier: { low: 0, medium: 0, high: 0, explicit: 0 }, fallbackCount: 0 })

    // 坏 registry 注入：run-bad 是坏 JSON（跳过该 run），run-good 正常聚合，整体不 500
    const badDir = join(cwd, '.omd', 'team', 'run-bad')
    await mkdir(badDir, { recursive: true })
    await writeFile(join(badDir, 'registry.json'), '{broken json', 'utf8')
    await writeRegistryFixture(cwd, 'run-good', {
      'w-1': { workerId: 'w-1', runId: 'run-good', role: 'omd-agent-executor', status: 'running', stale: false, spawnedAt: '2026-01-01T00:00:00.000Z', lastHeartbeatAt: '2026-01-01T00:05:00.000Z' },
    }, '2026-01-02T00:00:00.000Z')
    const s1 = await hudSnapshot({ cwd, stateDir: '.omd' })
    expect(s1.ok).toBe(true)
    expect(s1.workers.truncated).toBe(false)
    expect(s1.workers.list).toHaveLength(1)
    expect(s1.workers.list[0]).toMatchObject({ runId: 'run-good', workerId: 'w-1', role: 'omd-agent-executor', status: 'running' })
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('AC-7 workers 聚合形状：{list,truncated,filteredRuns,filteredWorkers} 对象包；元素恰六键不透传 stale；list 按 spawnedAt 新者优先；终态队员过滤（R4）', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hudr-'))
  try {
    // 两 run 各 1-2 worker；run-a 含 stale:true 注入（vestigial，不得透传）；
    // w-old status=done → R4 修复后不上屏（面板只呈现非终态队员）
    await writeRegistryFixture(cwd, 'run-a', {
      'w-old': { workerId: 'w-old', role: 'r1', status: 'done', stale: true, spawnedAt: '2026-01-01T00:00:00.000Z', lastHeartbeatAt: '2026-01-01T00:01:00.000Z' },
    }, '2026-01-01T01:00:00.000Z')
    await writeRegistryFixture(cwd, 'run-b', {
      'w-mid': { workerId: 'w-mid', role: 'r2', status: 'running', stale: false, spawnedAt: '2026-01-02T00:00:00.000Z', lastHeartbeatAt: '2026-01-02T00:01:00.000Z' },
      'w-new': { workerId: 'w-new', role: 'r3', status: 'blocked', stale: false, spawnedAt: '2026-01-03T00:00:00.000Z', lastHeartbeatAt: '2026-01-03T00:01:00.000Z' },
    }, '2026-01-02T01:00:00.000Z')
    const snap = await hudSnapshot({ cwd, stateDir: '.omd' })
    expect(snap.workers.truncated).toBe(false)
    expect(snap.workers.filteredWorkers).toBe(1) // w-old（done）被过滤
    // 呈现序=spawnedAt 新者优先（跨 run 全局排序，非按 run 分块）
    expect(snap.workers.list.map(w => w.workerId)).toEqual(['w-new', 'w-mid'])
    for (const w of snap.workers.list) {
      // 元素恰含六键——不透传 registry.stale（vestigial，team.js:172 恒 false）
      expect(Object.keys(w).sort()).toEqual(['lastHeartbeatAt', 'role', 'runId', 'spawnedAt', 'status', 'workerId'])
      expect(w.runId).toBeTruthy()
      expect(w.lastHeartbeatAt).toBeTruthy()
    }
    expect(snap.workers.list.find(w => w.workerId === 'w-new').runId).toBe('run-b')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('R4 workers 僵尸过滤：终态 phase 的 run 整组跳过（filteredRuns 计数）；坏 phase.json 不误伤', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hudr-'))
  try {
    // run-dead：phase=complete（终态）→ 整个 run 的队员不上屏（27 天前完结 run 的僵尸名单病灶）
    const deadDir = await writeRegistryFixture(cwd, 'run-dead', {
      'w-zombie': { workerId: 'w-zombie', role: 'r', status: 'running', spawnedAt: '2026-01-01T00:00:00.000Z', lastHeartbeatAt: '2026-01-01T00:00:00.000Z' },
    }, '2026-01-03T00:00:00.000Z')
    await writeFile(join(deadDir, 'phase.json'), JSON.stringify({ phase: 'complete', fixLoops: 0, history: [] }), 'utf8')
    // run-live：无 phase.json（或损坏）→ 不视为终态，队员保留
    await writeRegistryFixture(cwd, 'run-live', {
      'w-live': { workerId: 'w-live', role: 'r', status: 'running', spawnedAt: '2026-01-02T00:00:00.000Z', lastHeartbeatAt: '2026-01-02T00:00:00.000Z' },
    }, '2026-01-02T00:00:00.000Z')
    const snap = await hudSnapshot({ cwd, stateDir: '.omd' })
    expect(snap.workers.filteredRuns).toBe(1)
    expect(snap.workers.list.map(w => w.workerId)).toEqual(['w-live'])
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('R3 PRD 进度 join：主模式 prd_path → detail.prd {done,total,current} + 卡面进度行；缺席不炸', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hudr-'))
  try {
    await mkdir(join(cwd, '.omd', 'prd'), { recursive: true })
    await writeFile(join(cwd, '.omd', 'prd', 't.json'), JSON.stringify({
      topic: 't', stories: [
        { id: 'S1', passes: true }, { id: 'S2', passes: true }, { id: 'S3', passes: false }, { id: 'S4', passes: false },
      ],
    }), 'utf8')
    await makeStateTools({ stateDir: '.omd' }).write({
      cwd, sessionId: 's1', mode: 'ralph',
      state: { active: true, iteration: 1, prd_path: '.omd/prd/t.json', prompt_echo: '修复全部 backlog' },
    })
    const snap = await hudSnapshot({ cwd, stateDir: '.omd' })
    expect(snap.detail.prd).toEqual({ path: '.omd/prd/t.json', done: 2, total: 4, current: 'S3' })
    expect(snap.card).toContain('进度: story 2/4 通过（当前: S3）')
    expect(snap.card.split('\n')[0]).toBe('[omd] 修复全部 backlog') // 任务句首行
    // prd_path 缺席 → detail.prd 不存在，不炸
    const cwd2 = await mkdtemp(join(tmpdir(), 'omd-hudr-'))
    await makeStateTools({ stateDir: '.omd' }).write({ cwd: cwd2, sessionId: 's1', mode: 'ralph', state: { active: true } })
    const snap2 = await hudSnapshot({ cwd: cwd2, stateDir: '.omd' })
    expect(snap2.detail.prd).toBeUndefined()
    await rm(cwd2, { recursive: true, force: true })
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('AC-7 截断 + OQ-3 双排序边界：总数 >50 → 收满 50 提前退出 truncated:true；老 mtime run 内新 spawnedAt worker 仍被截断', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hudr-'))
  try {
    // run-new：mtime 新（扫描先到，占满 50 名额）+ 50 个老 spawnedAt worker
    const workers = {}
    for (let i = 0; i < 50; i++) {
      const id = `w-${String(i).padStart(2, '0')}`
      workers[id] = { workerId: id, role: 'r', status: 'running', stale: false, spawnedAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`, lastHeartbeatAt: '2026-01-01T01:00:00.000Z' }
    }
    await writeRegistryFixture(cwd, 'run-new', workers, '2026-02-01T00:00:00.000Z')
    // run-old：mtime 老（扫描后到）+ 1 个全列表最新 spawnedAt 的 worker
    await writeRegistryFixture(cwd, 'run-old', {
      'w-bleed': { workerId: 'w-bleed', role: 'r', status: 'running', stale: false, spawnedAt: '2026-06-01T00:00:00.000Z', lastHeartbeatAt: '2026-06-01T00:00:00.000Z' },
    }, '2026-01-01T00:00:00.000Z')
    const snap = await hudSnapshot({ cwd, stateDir: '.omd' })
    expect(snap.workers.truncated).toBe(true)
    expect(snap.workers.list).toHaveLength(50)
    // OQ-3：截断边界由扫描序（run mtime 新者优先）决定——w-bleed spawnedAt 最新仍被截断，
    // 呈现序排序只在已收名单内部发生（双序分离，防后续维护者误并两序）
    expect(snap.workers.list.some(w => w.workerId === 'w-bleed')).toBe(false)
    expect(snap.workers.list.every(w => w.runId === 'run-new')).toBe(true)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('AC-10 fallback>0 → detail.tier 提升 warn（原判定 ok）；danger 不降级', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hudr-'))
  try {
    // 基线：无事件 → deriveTier 原判定 ok
    expect((await hudSnapshot({ cwd, stateDir: '.omd' })).detail.tier).toBe('ok')
    // route+fallback 1:1 同点落盘（delegate.js 语义）→ fallbackCount=1 → warn
    await recordRouteEvent({ cwd, stateDir: '.omd', decision: { dispatchId: 'd-1', role: 'off-table-role', fallback: true, tier: 'medium' }, kind: 'route' })
    await recordRouteEvent({ cwd, stateDir: '.omd', decision: { dispatchId: 'd-1', role: 'off-table-role', fallback: true, tier: 'medium' }, kind: 'fallback' })
    const s1 = await hudSnapshot({ cwd, stateDir: '.omd' })
    expect(s1.toolCalls).toEqual({ total: 1, byTier: { low: 0, medium: 1, high: 0, explicit: 0 }, fallbackCount: 1 })
    expect(s1.detail.tier).toBe('warn')
    // danger 不降级：failed 模式在场 → 仍 danger（提升逻辑只升不降）
    await makeStateTools({ stateDir: '.omd' }).write({
      cwd, sessionId: 's1', mode: 'team', state: { active: true, state: 'failed', current_phase: 'exec' },
    })
    expect((await hudSnapshot({ cwd, stateDir: '.omd' })).detail.tier).toBe('danger')
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

// ---------- 2026-10-26 审查 S5：alerts=对请求 cwd 的 heartbeat 实弹扫描 ----------

test('S5 alerts：stale 队员 → alerts 非空且 tier 提升 warn；告警含 workerId', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hudr-'))
  try {
    await writeRegistryFixture(cwd, 'run-stale', {
      'w-old': { workerId: 'w-old', role: 'omd-agent-executor', status: 'running', spawnedAt: '2026-01-01T00:00:00.000Z', lastHeartbeatAt: '2026-01-01T00:00:00.000Z' },
      'w-done': { workerId: 'w-done', role: 'omd-agent-verifier', status: 'done', spawnedAt: '2026-01-01T00:00:00.000Z', lastHeartbeatAt: '2026-01-01T00:00:00.000Z' },
    }, '2026-01-02T00:00:00.000Z')
    const snap = await hudSnapshot({ cwd, stateDir: '.omd' })
    expect(snap.alerts.length).toBe(1) // 终态队员不报 stale
    expect(snap.alerts[0]).toContain('stale 队员')
    expect(snap.alerts[0]).toContain('w-old')
    expect(snap.detail.tier).toBe('warn') // alerts 非空且原 tier=ok → 提升 warn
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('S5 alerts：全体队员终态 → alerts 空且 tier 不提升', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hudr-'))
  try {
    await writeRegistryFixture(cwd, 'run-done', {
      'w-1': { workerId: 'w-1', role: 'omd-agent-executor', status: 'done', spawnedAt: '2026-01-01T00:00:00.000Z', lastHeartbeatAt: '2026-01-01T00:00:00.000Z' },
    }, '2026-01-02T00:00:00.000Z')
    const snap = await hudSnapshot({ cwd, stateDir: '.omd' })
    expect(snap.alerts).toEqual([])
    expect(snap.detail.tier).toBe('ok')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

// ---------- 2026-10-26 第二轮 S4：alerts 扩展（out-mail 老化 + graph stalled） ----------

test('S4 out-mail 老化：领队信件超 staleAfterMs 未 ack → 告警行；graph 停滞 run → 告警行', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hudr-'))
  try {
    // team run：registry + out-mail（老 ts 未 ack）
    await writeRegistryFixture(cwd, 'run-mail', {
      'w-1': { workerId: 'w-1', role: 'omd-agent-executor', status: 'done', spawnedAt: '2026-01-01T00:00:00.000Z', lastHeartbeatAt: '2026-01-01T00:00:00.000Z' },
    }, '2026-01-02T00:00:00.000Z')
    const mailDir = join(cwd, '.omd', 'team', 'run-mail', 'mailbox', 'out')
    await mkdir(mailDir, { recursive: true })
    await writeFile(join(mailDir, 'w-1.jsonl'),
      JSON.stringify({ seq: 1, ts: '2020-01-01T00:00:00.000Z', direction: 'out', from: 'leader', workerId: 'w-1', type: 'assign', text: '请处理 X', ack: false }) + '\n', 'utf8')
    // graph run：合法九字段 descriptor 快照（hash 实算）+ journal（agent_pending 且 mtime 古老）
    const { computeDescriptorHash } = await import('../../lib/graph/descriptor.js')
    const desc = {
      descriptor_version: 1, run_id: 'g-1', revision_id: 'rev-1', goal: 'g',
      nodes: [{ id: 'n1', kind: 'agent', title: 'A', timeout_ms: 60000, max_attempts: 1, effect_policy: { policy: 'side_effect_free' }, instructions: 'do' }],
      edges: [], entry_node_ids: ['n1'], concurrency_limit: 1, terminal_verification_node_id: 'n1',
    }
    const gHash = computeDescriptorHash(desc)
    const gr = join(cwd, '.omd', 'graph-runs', 'g-1')
    await mkdir(gr, { recursive: true })
    await writeFile(join(gr, 'descriptor.json'), JSON.stringify({ ...desc, descriptor_hash: gHash }), 'utf8') // 封印态快照含 descriptor_hash（parseSealedGraphDescriptor 要求）
    await writeFile(join(gr, 'journal.jsonl'), [
      JSON.stringify({ seq: 1, ts: '2020-01-01T00:00:00.000Z', type: 'run_started', run_id: 'g-1', descriptor_hash: gHash }),
      JSON.stringify({ seq: 2, ts: '2020-01-01T00:00:01.000Z', type: 'agent_pending', node_id: 'n1', attempt: 1 }),
    ].join('\n') + '\n', 'utf8')
    const old = new Date('2020-01-01T00:00:00.000Z')
    await utimes(join(gr, 'journal.jsonl'), old, old)

    const snap = await hudSnapshot({ cwd, stateDir: '.omd' })
    expect(snap.alerts.some(a => a.includes('领队信件未应答'))).toBe(true)
    expect(snap.alerts.some(a => a.includes('[graph]') && a.includes('g-1'))).toBe(true)
    expect(snap.detail.tier).toBe('warn')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('S4 graph 目录缺席/新鲜 run → 无 graph 告警', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-hudr-'))
  try {
    const snap = await hudSnapshot({ cwd, stateDir: '.omd' })
    expect(snap.alerts.filter(a => a.includes('[graph]'))).toEqual([])
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
