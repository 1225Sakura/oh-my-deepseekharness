// lib/routing.js
// c3 自适应路由（M3，spec di-m3-advance-001：拓扑 c3 行 / R5-R6/R15 裁决 / 约束 6、9）
// - 宾语=模型档位；信号=队长静态评估×4 特征（任务类型/接触面/失败可逆性/上下文自包含性，
//   全静态可判定，零额外 LLM 调用）
// - 路由表为上限（表上限权威，自适应仅表定档位及以下，只降不升）
// - 派发前恰一次判定，无运行中重路由；RoutingLog 不设实体（约束 9）：
//   路由记录与派发 1:1，验收=按 dispatch id 键控的日志行计数断言
// - 表外任务 → 落会话默认档（Config.routing.defaultTier）+ run-state.json 记 fallback:true（可审计）
import { join } from 'node:path'
import { atomicWriteJson, readJson } from '../mcp-server/lib/atomic.mjs'

export const TIER_ORDER = ['low', 'medium', 'high']

/** 4 特征静态信号（R15 队长静态评估）：特征名→合法值枚举，数组下标即贡献分 0/1/2。 */
export const SIGNAL_FEATURES = {
  taskType: ['routine', 'standard', 'critical'],                            // 任务类型
  contactSurface: ['singleFile', 'multiFile', 'systemWide'],                // 接触面
  failureReversibility: ['reversible', 'costly', 'irreversible'],           // 失败可逆性
  contextSelfContainedness: ['selfContained', 'partial', 'externalDeps'],   // 上下文自包含性
}

/** 建议档分带：特征贡献求和 0-8 → ≤2 low / ≤5 medium / 其余 high。 */
export const TIER_BANDS = { lowMax: 2, mediumMax: 5 }

/** 建议档：4 特征静态评分（确定性、零额外调用）。特征值非法即抛错（不静默）。 */
export function suggestTier(features) {
  let sum = 0
  for (const [name, values] of Object.entries(SIGNAL_FEATURES)) {
    const idx = values.indexOf(features?.[name])
    if (idx < 0)
      throw new Error(`routing: 特征 ${name} 值无效: ${String(features?.[name])}（合法: ${values.join('/')}）`)
    sum += idx
  }
  return sum <= TIER_BANDS.lowMax ? 'low' : sum <= TIER_BANDS.mediumMax ? 'medium' : 'high'
}

/** 表上限钳制：min(建议档, 表定档位)，TIER_ORDER 序上只降不升。任一档位非法即抛错。 */
export function clampTier(tier, cap) {
  if (!TIER_ORDER.includes(tier) || !TIER_ORDER.includes(cap))
    throw new Error(`routing: 档位无效 tier=${tier} cap=${cap}`)
  return TIER_ORDER[Math.min(TIER_ORDER.indexOf(tier), TIER_ORDER.indexOf(cap))]
}

/** 路由表：角色→表定档位（上限权威）。与协议「模型路由表」行同源（角色卡 frontmatter tier）。 */
export function buildRoutingTable(roles) {
  const table = {}
  for (const r of roles ?? [])
    if (r?.name && TIER_ORDER.includes(r.tier)) table[r.name] = r.tier
  return table
}

const fmtLog = d => `[routing] dispatch=${d.dispatchId} role=${d.role} table=${d.tableTier ?? 'miss'}`
  + ` suggested=${d.suggestedTier} final=${d.tier}`
  + `${d.clamped ? ' clamped' : ''}${d.fallback ? ' fallback=true' : ''}`

/**
 * 派发前路由判定（纯函数，恰一次；调用方每次派发恰调一次 → 无运行中重路由）。
 * @returns {dispatchId, role, tableTier, suggestedTier, tier, clamped, fallback, logLine}
 *   logLine=该次派发的唯一路由日志行（键控 dispatch id；调用方负责输出，计数断言即验收）。
 *   表外角色（table 无该 role）→ tier=defaultTier（会话默认档）、fallback=true。
 */
export function routeOnce({ table, role, features, dispatchId, defaultTier = 'medium' }) {
  if (!dispatchId) throw new Error('routing: dispatchId 必填（路由日志 1:1 键控）')
  const suggestedTier = suggestTier(features)
  const capTier = table?.[role]
  if (!capTier) {
    const d = { dispatchId, role, tableTier: null, suggestedTier, tier: defaultTier, clamped: false, fallback: true }
    return { ...d, logLine: fmtLog(d) }
  }
  const d = {
    dispatchId,
    role,
    tableTier: capTier,
    suggestedTier,
    tier: clampTier(suggestedTier, capTier),
    clamped: TIER_ORDER.indexOf(suggestedTier) > TIER_ORDER.indexOf(capTier),
    fallback: false,
  }
  return { ...d, logLine: fmtLog(d) }
}

/**
 * fallback 审计：run-state.json 记 fallback:true（tmp+rename 原子写，复用 mcp-server 存量原语）。
 * run-state.json 权威在主仓 stateDir（c6 将落七字段契约；本函数只增补 fallback 审计面，不覆盖既有键）。
 */
export async function recordFallback({ stateDir, decision, at = new Date().toISOString() }) {
  if (!decision?.fallback) throw new Error('routing: recordFallback 只接受 fallback=true 的派发判定')
  const file = join(stateDir, 'run-state.json')
  const state = await readJson(file, {})
  state.fallback = true
  state.lastFallback = { dispatchId: decision.dispatchId, role: decision.role, tier: decision.tier, at }
  state.updatedAt = at
  await atomicWriteJson(file, state)
  return file
}
