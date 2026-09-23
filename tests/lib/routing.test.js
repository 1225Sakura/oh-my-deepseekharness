// tests/lib/routing.test.js
// c3 自适应路由验收（台账 m3-advance S3，R18 表逐行落槽）：
// C1 断言①：配置 35 项模型路由表 × 4 特征笛卡尔抽样 → 每次派发档位 ≤ 表定上限（钳制成立，表上限权威）
// C2 断言②：按 dispatch id 键控的路由日志行数 == 派发数（派发前恰一次判定，无运行中重路由）
// C3 断言③：表外任务 e2e 一例 → 落会话默认档 + run-state.json 记 fallback:true（可审计）
import { test, expect } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { loadAssets } from '../../lib/skills.js'
import {
  TIER_ORDER, SIGNAL_FEATURES, TIER_BANDS,
  suggestTier, clampTier, buildRoutingTable, routeOnce, recordFallback,
} from '../../lib/routing.js'

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '../../assets')

/** 4 特征全笛卡尔组合：3^4 = 81。 */
function cartesianFeatures() {
  const combos = []
  for (const t of SIGNAL_FEATURES.taskType)
    for (const c of SIGNAL_FEATURES.contactSurface)
      for (const r of SIGNAL_FEATURES.failureReversibility)
        for (const s of SIGNAL_FEATURES.contextSelfContainedness)
          combos.push({ taskType: t, contactSurface: c, failureReversibility: r, contextSelfContainedness: s })
  return combos
}

test('4 特征枚举齐全且笛卡尔空间 = 3^4 = 81', () => {
  expect(Object.keys(SIGNAL_FEATURES)).toEqual([
    'taskType', 'contactSurface', 'failureReversibility', 'contextSelfContainedness',
  ])
  expect(cartesianFeatures().length).toBe(81)
})

test('suggestTier 分带：0-2 low / 3-5 medium / 6-8 high；非法特征值抛错', () => {
  expect(suggestTier({ taskType: 'routine', contactSurface: 'singleFile', failureReversibility: 'reversible', contextSelfContainedness: 'selfContained' })).toBe('low')
  expect(suggestTier({ taskType: 'critical', contactSurface: 'systemWide', failureReversibility: 'irreversible', contextSelfContainedness: 'externalDeps' })).toBe('high')
  expect(suggestTier({ taskType: 'standard', contactSurface: 'multiFile', failureReversibility: 'costly', contextSelfContainedness: 'partial' })).toBe('medium')
  expect(() => suggestTier({ taskType: 'nonsense', contactSurface: 'multiFile', failureReversibility: 'costly', contextSelfContainedness: 'partial' })).toThrow(/taskType/)
  expect(() => suggestTier({})).toThrow()
})

test('clampTier：TIER_ORDER 序上只降不升；非法档位抛错', () => {
  expect(clampTier('high', 'low')).toBe('low')
  expect(clampTier('medium', 'high')).toBe('medium')
  expect(clampTier('low', 'high')).toBe('low')
  for (const t of TIER_ORDER) expect(clampTier(t, 'high')).toBe(t)
  expect(() => clampTier('ultra', 'high')).toThrow()
})

// ---- C1 断言①：配置 35 项模型路由表 × 4 特征笛卡尔抽样 → 每次派发档位 ≤ 表定上限 ----
test('C1 钳制：35 项路由表（33 实角色+2 夹具）× 81 特征组合全抽样，派发档位恒 ≤ 表定上限', async () => {
  const assets = await loadAssets({ assetsRoot: ASSETS, language: 'zh' })
  const realRoles = assets.roles.map(r => ({ name: r.name, tier: r.tier }))
  // 判据构造「配置 35 项模型路由表」：生产 33 实角色（v0.4 OMX 移植 +14）+ 夹具角色补足 35 项（逐项标注 fixture- 前缀）
  const fixture = [...realRoles]
  let i = 0
  while (fixture.length < 35) fixture.push({ name: `fixture-agent-${++i}`, tier: TIER_ORDER[i % 3] })
  expect(realRoles.length).toBe(33)
  expect(fixture.length).toBe(35)

  const table = buildRoutingTable(fixture)
  expect(Object.keys(table).length).toBe(35)
  const combos = cartesianFeatures()
  let sampled = 0
  for (const [role, cap] of Object.entries(table)) {
    for (const features of combos) {
      const d = routeOnce({ table, role, features, dispatchId: `c1-${sampled}` })
      expect(d.fallback).toBe(false)
      expect(TIER_ORDER.indexOf(d.tier)).toBeLessThanOrEqual(TIER_ORDER.indexOf(cap))
      // 钳制语义：final == min(suggested, cap)
      expect(d.tier).toBe(clampTier(d.suggestedTier, cap))
      sampled++
    }
  }
  expect(sampled).toBe(35 * 81)
})

test('C1 补充：生产路由表（assets 33 实角色）× 81 组合全抽样同样钳制（表上限权威）', async () => {
  const assets = await loadAssets({ assetsRoot: ASSETS, language: 'zh' })
  const table = buildRoutingTable(assets.roles)
  const combos = cartesianFeatures()
  let sampled = 0
  for (const [role, cap] of Object.entries(table)) {
    for (const features of combos) {
      const d = routeOnce({ table, role, features, dispatchId: `prod-${sampled}` })
      expect(TIER_ORDER.indexOf(d.tier)).toBeLessThanOrEqual(TIER_ORDER.indexOf(cap))
      sampled++
    }
  }
  expect(Object.keys(table).length).toBe(33)
  expect(sampled).toBe(33 * 81)
})

// ---- C2 断言②：按 dispatch id 键控的路由日志行数 == 派发数 ----
test('C2 日志 1:1：派发 N 次 → 路由日志恰 N 行，dispatch id 唯一键控，同输入判定恒定（无重路由）', () => {
  const table = buildRoutingTable([
    { name: 'omd-agent-executor', tier: 'medium' },
    { name: 'omd-agent-planner', tier: 'high' },
    { name: 'omd-agent-explore', tier: 'low' },
  ])
  const dispatches = [
    { role: 'omd-agent-explore', features: { taskType: 'routine', contactSurface: 'singleFile', failureReversibility: 'reversible', contextSelfContainedness: 'selfContained' } },
    { role: 'omd-agent-executor', features: { taskType: 'critical', contactSurface: 'multiFile', failureReversibility: 'costly', contextSelfContainedness: 'partial' } },
    { role: 'omd-agent-planner', features: { taskType: 'critical', contactSurface: 'systemWide', failureReversibility: 'irreversible', contextSelfContainedness: 'externalDeps' } },
    { role: 'omd-agent-nosuch', features: { taskType: 'standard', contactSurface: 'multiFile', failureReversibility: 'costly', contextSelfContainedness: 'partial' } }, // 表外
    { role: 'omd-agent-explore', features: { taskType: 'critical', contactSurface: 'systemWide', failureReversibility: 'irreversible', contextSelfContainedness: 'externalDeps' } }, // 建议被钳到 low
  ]
  // 每次派发恰调一次 routeOnce → 恰一行日志（调用方收集）
  const lines = dispatches.map((t, i) =>
    routeOnce({ table, role: t.role, features: t.features, dispatchId: `d-${String(i + 1).padStart(3, '0')}` }).logLine)
  expect(lines.length).toBe(dispatches.length)
  const ids = lines.map(l => /dispatch=(\S+)/.exec(l)[1])
  expect(new Set(ids).size).toBe(dispatches.length)
  for (let i = 0; i < dispatches.length; i++) expect(lines[i]).toContain(`dispatch=d-${String(i + 1).padStart(3, '0')}`)
  // 无运行中重路由：同派发重复判定结果恒定（纯函数、无状态漂移）
  const first = dispatches[1]
  const a = routeOnce({ table, role: first.role, features: first.features, dispatchId: 'd-002' })
  const b = routeOnce({ table, role: first.role, features: first.features, dispatchId: 'd-002' })
  expect(a.tier).toBe(b.tier)
  expect(a.logLine).toBe(b.logLine)
  // 钳制可见：explore 表定 low，critical 组合建议 high → final=low 且日志标 clamped
  const clamped = routeOnce({ table, role: 'omd-agent-explore', features: dispatches[4].features, dispatchId: 'd-9' })
  expect(clamped.suggestedTier).toBe('high')
  expect(clamped.tier).toBe('low')
  expect(clamped.clamped).toBe(true)
  expect(clamped.logLine).toContain('clamped')
})

// ---- C3 断言③：表外任务 e2e 一例 → 落会话默认档 + run-state.json 记 fallback:true（可审计） ----
test('C3 表外任务 e2e：落会话默认档 + run-state.json 记 fallback:true（临时目录，零触碰日常 .omd）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omd-c3-'))
  try {
    const table = buildRoutingTable([{ name: 'omd-agent-executor', tier: 'medium' }])
    const features = { taskType: 'critical', contactSurface: 'systemWide', failureReversibility: 'irreversible', contextSelfContainedness: 'externalDeps' }
    // 表外任务：路由判定 → fallback → run-state 审计落盘 → 读回验证
    const d = routeOnce({ table, role: 'omd-agent-nosuch', features, dispatchId: 'e2e-001' })
    expect(d.fallback).toBe(true)
    expect(d.tableTier).toBeNull()
    expect(d.tier).toBe('medium') // 会话默认档（Config.routing.defaultTier 默认 medium）
    expect(d.logLine).toContain('fallback=true')
    const file = await recordFallback({ cwd: dir, stateDir: '.omd', decision: d })
    const state = JSON.parse(await readFile(file, 'utf8'))
    expect(state.fallback).toBe(true)
    expect(state.lastFallback).toMatchObject({ dispatchId: 'e2e-001', role: 'omd-agent-nosuch', tier: 'medium' })
    expect(typeof state.updatedAt).toBe('string')
    // 会话默认档可配置：defaultTier=low 时表外任务落 low
    const d2 = routeOnce({ table, role: 'omd-agent-nosuch', features, dispatchId: 'e2e-002', defaultTier: 'low' })
    expect(d2.tier).toBe('low')
    // recordFallback 只接受 fallback 判定（防误审计）
    await expect(recordFallback({ cwd: dir, stateDir: '.omd', decision: { fallback: false } })).rejects.toThrow(/fallback/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('TIER_BANDS 与协议渲染同源（0-2/3-5/6-8）', () => {
  expect(TIER_BANDS).toEqual({ lowMax: 2, mediumMax: 5 })
})

// M1 修复回归：fallback 审计走权威路径 + withFileLock 互斥——并发双调不丢更新、恰一最终值
test('M1 回归：并发 fallback 审计在权威路径互斥域内串行', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omd-m1-'))
  try {
    const d1 = { fallback: true, dispatchId: 'm1-a', role: 'r1', tier: 'low' }
    const d2 = { fallback: true, dispatchId: 'm1-b', role: 'r2', tier: 'medium' }
    await Promise.all([
      recordFallback({ cwd: dir, stateDir: '.omd', decision: d1 }),
      recordFallback({ cwd: dir, stateDir: '.omd', decision: d2 }),
    ])
    const file = join(dir, '.omd', 'state', 'run-state.json')
    const state = JSON.parse(await readFile(file, 'utf8'))
    expect(state.fallback).toBe(true)
    expect(['m1-a', 'm1-b']).toContain(state.lastFallback.dispatchId) // 锁内串行，恰一最终值
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
