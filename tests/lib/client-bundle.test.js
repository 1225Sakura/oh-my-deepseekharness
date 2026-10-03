// tests/lib/client-bundle.test.js
// v0.4 P2-D HUD client half（lib/client.js 手工懒加载 CJS bundle）沙箱断言：
// ① bundle 在 fake __ModuleLoader__ 下注册工厂（id=包名）且执行无副作用（只注册）
// ② 物化导出 { apply, inject, HudPanel, HUD_ROUTE }；inject=['slots','sidebarRightTabs']
// ③ apply(mock ctx)：注册 tab 类型（id/kind/title/guide）+ tab 体（seat/key 对齐定义 id）
// ④ 服务缺席 → console.warn 告警直通不抛错
// ⑤ 加载中分支冒烟（NB-a：本轮 HudPanel 重写不触及该分支，断言保留）
// ⑥-⑮ ralplan-hud-clarity 呈现层重写：AC7 idle 下发目录/active 中文卡/stale 锁子串/
//    detail 缺席回退/无内置目录；AC10 tier 三档 data-tier 标记；AC11 preset 三档矩阵
//    （minimal-idle / focused-active / full-active / 回退，fakeReact useState 种子注入）
import { test, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const BUNDLE = join(dirname(fileURLToPath(import.meta.url)), '../../lib/client.js')

/** 在沙箱中加载 bundle：返回 { loaderCalls, materialize }。 */
async function loadBundle() {
  const code = await readFile(BUNDLE, 'utf8')
  const loaderCalls = []
  const sandbox = {
    window: { __ModuleLoader__: { load: (row) => loaderCalls.push(row) } },
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  return { loaderCalls, sandbox }
}

/** 物化工厂：fake require 只认 react（最小桩）。 */
function materialize(row, reactStub) {
  const require = (name) => {
    if (name === 'react') return reactStub
    throw new Error(`unexpected require: ${name}`)
  }
  return row.factory(require)
}

/** fake React：useState 按调用序注入种子（seeds[i] 覆盖第 i 个 useState 的 init）。 */
function fakeReact(seeds = []) {
  const effects = []
  const states = []
  return {
    effects, states,
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (init) => {
      const i = states.length
      const v = i < seeds.length ? seeds[i] : init
      const s = [v, () => {}]
      states.push(s)
      return s
    },
    useEffect: (fn) => effects.push(fn),
  }
}

/** 深度收集树中满足条件的节点（fake React 元素 {type, props, children}；children 可为嵌套数组）。 */
function findNodes(node, pred, out = []) {
  if (Array.isArray(node)) {
    for (const c of node) findNodes(c, pred, out)
    return out
  }
  if (!node || typeof node !== 'object') return out
  if (pred(node)) out.push(node)
  findNodes(node.children ?? [], pred, out)
  return out
}

// ---- fixtures：hud.json payload 形状按计划 AC4/AC5/AC11 契约 ----

const CATALOG = [
  { mode: 'autopilot', label: '自动驾驶' },
  { mode: 'ralph', label: 'Ralph 循环' },
  { mode: 'team', label: '团队' },
  { mode: 'ralplan', label: '共识规划' },
  { mode: 'deep-interview', label: '深度访谈' },
]

const CARD_TEXT = [
  '[omd] 编排状态',
  '模式: Ralph 循环（ralph）',
  '阶段: exec',
  '轮次: 3',
  '任务: 2 个 agent',
  '记忆: 工作区 1 / 优先区 2 / 手动区 0',
  '另有 1 个模式：autopilot（自动驾驶）',
].join('\n')

function modeEntry(over = {}) {
  return {
    mode: 'ralph', label: 'Ralph 循环', sessionId: 'sess-1', state: 'active',
    iteration: 3, current_story: 'S1 实现', current_phase: 'exec',
    active_agents: [{ id: 'w-1' }, { id: 'w-2' }],
    updatedAt: '2026-02-06T10:00:00.000Z', stale: false,
    ...over,
  }
}

function snapPayload(over = {}) {
  return {
    ok: true, cwd: 'D:/omd', at: '2026-02-06T10:00:05.000Z',
    summary: { mode: 'ralph', round: 3, story: 'S1 实现', agents: 2, todo: { working: 1, priority: 2, manual: 0 } },
    card: CARD_TEXT,
    preset: 'focused',
    detail: { primary: 'ralph', modes: [modeEntry()] },
    modeCatalog: CATALOG,
    ...over, // 显式传 detail: undefined / preset: undefined 即「缺席」
  }
}

/** 种子注入渲染：snap 为第 1 个 useState、err 为第 2 个。
 *  HudPanel 闭包绑定 materialize 时的 react——故必须在此用种子 react 物化工厂。 */
function seedPanel(loaderCalls, snap, err = null) {
  const react = fakeReact([snap, err])
  const exports = materialize(loaderCalls[0], react)
  const tree = exports.HudPanel()
  return { react, tree, flat: JSON.stringify(tree) }
}

test('① bundle 注册工厂：id=包名，加载零副作用', async () => {
  const { loaderCalls } = await loadBundle()
  expect(loaderCalls).toHaveLength(1)
  expect(loaderCalls[0].id).toBe('@sakura12/oh-my-deepseekharness')
  expect(typeof loaderCalls[0].factory).toBe('function')
})

test('② 物化导出契约：apply/inject/HudPanel/HUD_ROUTE', async () => {
  const { loaderCalls } = await loadBundle()
  const react = fakeReact()
  const exports = materialize(loaderCalls[0], react)
  expect(typeof exports.apply).toBe('function')
  expect(exports.inject).toEqual(['slots', 'sidebarRightTabs'])
  expect(typeof exports.HudPanel).toBe('function')
  expect(exports.HUD_ROUTE).toBe('/oh-my-dsh/hud.json')
  expect(Object.keys(exports).sort()).toEqual(['HUD_ROUTE', 'HudPanel', 'apply', 'inject'])
})

test('③ apply：tab 类型 + tab 体注册（seat/key 对齐，guide 胶囊齐全）', async () => {
  const { loaderCalls } = await loadBundle()
  const exports = materialize(loaderCalls[0], fakeReact())
  const tabDefs = []
  const slotInjects = []
  const slotRegs = []
  const ctx = {
    sidebarRightTabs: { register: (def) => tabDefs.push(def) },
    slots: {
      inject: (seat, fn) => { slotInjects.push(seat); return fn() },
      register: (meta, component) => { slotRegs.push({ meta, component }); return () => {} },
    },
  }
  exports.apply(ctx)
  expect(tabDefs).toHaveLength(1)
  const def = tabDefs[0]
  expect(def.id).toBe('omd-hud-panel')
  expect(def.kind).toBe('omd-hud')
  expect(def.patterns).toBeUndefined() // page 类型：无地址 glob
  expect(def.title()).toBe('omd HUD')
  expect(def.guide).toHaveLength(1)
  expect(def.guide[0].title()).toBe('omd HUD')
  expect(def.guide[0].description()).toContain('五要素')
  expect(slotInjects).toEqual(['sidebar.right.pane.tab'])
  expect(slotRegs).toHaveLength(1)
  expect(slotRegs[0].meta).toMatchObject({ name: 'sidebar.right.pane.tab', key: 'omd-hud-panel' }) // keyed 座按 key 派发（第一方契约）
  expect(slotRegs[0].component).toBe(exports.HudPanel) // 体座 key=定义 id，组件同导出
})

test('④ 服务缺席告警直通（不抛错、不注册）', async () => {
  const { loaderCalls } = await loadBundle()
  const exports = materialize(loaderCalls[0], fakeReact())
  const warns = []
  const orig = console.warn
  console.warn = (m) => warns.push(m)
  try {
    expect(() => exports.apply({})).not.toThrow()
    expect(() => exports.apply(null)).not.toThrow()
  } finally { console.warn = orig }
  expect(warns.length).toBe(2)
  expect(warns[0]).toContain('sidebarRightTabs/slots')
})

test('⑤ HudPanel 初始渲染：加载中分支（effect 注册轮询）', async () => {
  const { loaderCalls } = await loadBundle()
  const react = fakeReact()
  const exports = materialize(loaderCalls[0], react)
  const tree = exports.HudPanel()
  expect(tree.type).toBe('div')
  const flat = JSON.stringify(tree)
  expect(flat).toContain('omd 编排状态') // B3′：面板标题随 HudPanel 重写同步
  expect(flat).toContain('加载中') // NB-a：加载中分支断言原样保留
  expect(react.effects).toHaveLength(1) // NB-a：轮询 effect 已注册（fetch/setInterval 在 effect 内，沙箱不执行）
})

test('⑥ AC7 idle：渲染下发 modeCatalog（模式名+中文名同现）+ 空态引导 + 记忆中文标签', async () => {
  const { loaderCalls } = await loadBundle()
  const s = snapPayload({
    summary: { mode: 'idle', round: null, story: null, agents: 0, todo: { working: 0, priority: 0, manual: 0 } },
    detail: { primary: null, modes: [] },
  })
  const { flat } = seedPanel(loaderCalls, s)
  expect(flat).toContain('当前没有运行中的 omd 模式')
  // 目录来自下发 modeCatalog：模式名与中文名同现
  expect(flat).toContain('autopilot')
  expect(flat).toContain('自动驾驶')
  expect(flat).toContain('deep-interview')
  expect(flat).toContain('深度访谈')
  // 记忆中文标签，非裸 working=
  expect(flat).toContain('记忆')
  expect(flat).not.toContain('working=')
})

test('⑦ AC7 focused active：主模式卡（模式/阶段/轮次/任务）+ stale 锁子串 + 次要小注；AC10 warn 档', async () => {
  const { loaderCalls } = await loadBundle()
  const s = snapPayload({
    detail: {
      primary: 'ralph',
      modes: [
        modeEntry({ stale: true }),
        modeEntry({ mode: 'autopilot', label: '自动驾驶', sessionId: 'sess-2', current_story: 'S2' }),
      ],
    },
  })
  const { tree, flat } = seedPanel(loaderCalls, s)
  expect(tree.props['data-tier']).toBe('warn') // AC10：data-tier 标记落 DOM
  expect(flat).toContain('阶段')
  expect(flat).toContain('轮次')
  expect(flat).toContain('任务')
  expect(flat).toContain('未更新') // A1 受锁子串（stale 行漂移兜底）
  expect(flat).toContain('另有 1 个模式') // focused：次要模式小注
  expect(flat).toContain('记忆')
  expect(flat).toContain('最近取数') // U3/O1：focused 档取数时间上下文
  expect(flat).not.toContain('刷新间隔') // S5：删刷新间隔行
  expect(flat).not.toContain('working=')
})

test('⑧ AC10 danger：活跃模式 state=failed → data-tier=危险档 + 文字标记', async () => {
  const { loaderCalls } = await loadBundle()
  const s = snapPayload({ detail: { primary: 'ralph', modes: [modeEntry({ state: 'failed' })] } })
  const { tree, flat } = seedPanel(loaderCalls, s)
  expect(tree.props['data-tier']).toBe('danger')
  expect(flat).toContain('危险')
})

test('⑨ AC10 ok：活跃且非 stale → ok 档（无色降级=默认文本色）', async () => {
  const { loaderCalls } = await loadBundle()
  const { tree, flat } = seedPanel(loaderCalls, snapPayload({}))
  expect(tree.props['data-tier']).toBe('ok')
  expect(flat).toContain('状态正常')
})

test('⑨b AC10 tier：payload 的 detail.tier 优先（lib 单源下发），非法值回退受锁副本判定', async () => {
  const { loaderCalls } = await loadBundle()
  const given = seedPanel(loaderCalls, snapPayload({ detail: { primary: 'ralph', modes: [modeEntry()], tier: 'warn' } }))
  expect(given.tree.props['data-tier']).toBe('warn')
  const bogus = seedPanel(loaderCalls, snapPayload({ detail: { primary: 'ralph', modes: [modeEntry()], tier: 'bogus' } }))
  expect(bogus.tree.props['data-tier']).toBe('ok')
})

test('⑩ AC11 minimal-idle：<pre> 卡文本档，不渲染语义面板与目录', async () => {
  const { loaderCalls } = await loadBundle()
  const s = snapPayload({
    preset: 'minimal',
    summary: { mode: 'idle', round: null, story: null, agents: 0, todo: { working: 0, priority: 0, manual: 0 } },
    detail: { primary: null, modes: [] },
  })
  const { tree, flat } = seedPanel(loaderCalls, s)
  const pres = findNodes(tree, (n) => n.type === 'pre')
  expect(pres).toHaveLength(1)
  expect(flat).toContain('任务: 2 个 agent') // fixture 卡正文进 <pre>
  expect(flat).not.toContain('启动方式') // 空态目录引导不渲染（minimal 只出卡）
  expect(tree.props['data-tier']).toBe('ok')
})

test('⑪ AC11 full active：次要模式全部展开 + 记忆三区逐条 + cwd/最近取数元信息区', async () => {
  const { loaderCalls } = await loadBundle()
  const s = snapPayload({
    preset: 'full',
    detail: {
      primary: 'ralph',
      modes: [
        modeEntry(),
        modeEntry({ mode: 'autopilot', label: '自动驾驶', sessionId: 'sess-2', current_story: 'S2', iteration: 1 }),
      ],
    },
  })
  const { tree, flat } = seedPanel(loaderCalls, s)
  expect(flat).toContain('其他模式')
  expect(flat).not.toContain('另有 ') // full：次要模式展开，不折叠小注
  expect(flat).toContain('自动驾驶（autopilot）')
  expect(flat).toContain('记忆（notepad 三区）')
  expect(flat).toContain('永久保留')
  expect(flat).toContain('手动维护')
  expect(flat).toContain('7 天过期')
  expect(flat).toContain('cwd')
  expect(flat).toContain('D:/omd')
  expect(flat).toContain('最近取数')
  expect(tree.props['data-tier']).toBe('ok')
})

test('⑫ AC7/AC11 detail 缺席回退：<pre> 卡文本（回退分支冒烟）', async () => {
  const { loaderCalls } = await loadBundle()
  const { tree, flat } = seedPanel(loaderCalls, snapPayload({ detail: undefined }))
  const pres = findNodes(tree, (n) => n.type === 'pre')
  expect(pres).toHaveLength(1)
  expect(flat).toContain('任务: 2 个 agent')
  expect(flat).not.toContain('主模式')
})

test('⑬ AC11 preset 缺省/非法 → focused 语义化面板（client 只渲染下发 preset）', async () => {
  const { loaderCalls } = await loadBundle()
  for (const preset of [undefined, 'bogus']) {
    const { flat } = seedPanel(loaderCalls, snapPayload({ preset }))
    expect(flat).toContain('主模式')
    expect(flat).not.toContain('记忆（notepad 三区）') // full 专属区不出现
  }
})

test('⑭ AC7：client.js 无内置模式目录文案残留（目录单源下发自 lib，client 只渲染）', async () => {
  const code = await readFile(BUNDLE, 'utf8')
  expect(code).not.toMatch(/自动驾驶|Ralph 循环|团队|共识规划|深度访谈/)
  expect(code).not.toContain('MODE_LABELS')
})
