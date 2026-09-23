// tests/lib/client-bundle.test.js
// v0.4 P2-D HUD client half（lib/client.js 手工懒加载 CJS bundle）沙箱断言：
// ① bundle 在 fake __ModuleLoader__ 下注册工厂（id=包名）且执行无副作用（只注册）
// ② 物化导出 { apply, inject, HudPanel }；inject=['slots','sidebarRightTabs']
// ③ apply(mock ctx)：注册 tab 类型（id/kind/title/guide）+ tab 体（seat/key 对齐定义 id）
// ④ 服务缺席 → console.warn 告警直通不抛错
// ⑤ HudPanel 渲染逻辑冒烟（fake React：err/加载中/正常三分支）
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

function fakeReact() {
  const effects = []
  const states = []
  return {
    effects, states,
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (init) => { const s = [init, () => {}]; states.push(s); return s },
    useEffect: (fn) => effects.push(fn),
  }
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
  expect(flat).toContain('omd HUD 摘要卡')
  expect(flat).toContain('加载中') // 初始 snap=null → 加载中分支
  expect(react.effects).toHaveLength(1) // 轮询 effect 已注册（fetch/setInterval 在 effect 内，沙箱不执行）
})
