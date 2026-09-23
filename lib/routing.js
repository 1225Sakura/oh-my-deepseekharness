// lib/routing.js
// c3 自适应路由（M3，spec di-m3-advance-001：拓扑 c3 行 / R5-R6/R15 裁决 / 约束 6、9）
// - 宾语=模型档位；信号=队长静态评估×4 特征（任务类型/接触面/失败可逆性/上下文自包含性，
//   全静态可判定，零额外 LLM 调用）
// - 路由表为上限（表上限权威，自适应仅表定档位及以下，只降不升）
// - 派发前恰一次判定，无运行中重路由；RoutingLog 不设实体（约束 9）：
//   路由记录与派发 1:1，验收=按 dispatch id 键控的日志行计数断言
// - 表外任务 → 落会话默认档（Config.routing.defaultTier）+ run-state.json 记 fallback:true（可审计）
import { atomicWriteJson, readJson } from '../mcp-server/lib/atomic.mjs'
import { runStatePath } from './worktree.js'
import { withFileLock } from './runstate.js'

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

/** 路由日志行格式（单一来源）：delegate/routing 两侧共用，杜绝格式漂移。 */
export const fmtLog = d => `[routing] dispatch=${d.dispatchId} role=${d.role} table=${d.tableTier ?? 'miss'}`
  + ` suggested=${d.suggestedTier} final=${d.tier}`
  + `${d.clamped ? ' clamped' : ''}${d.fallback ? ' fallback=true' : ''}`

/**
 * 派发前路由判定（纯函数，恰一次；调用方每次派发恰调一次 → 无运行中重路由）。
 * @param {object} input
 * @param {object} [input.features] 4 特征静态信号；suggestedTier 缺席时必填（经 suggestTier 评分）
 * @param {string} [input.suggestedTier] 调用方已定档（如 omd_delegate 的 tier 参数）——
 *   提供时跳过特征评分，仍受表上限钳制/fallback/日志语义约束（c8 S8 联动复用）
 * @returns {dispatchId, role, tableTier, suggestedTier, tier, clamped, fallback, logLine}
 *   logLine=该次派发的唯一路由日志行（键控 dispatch id；调用方负责输出，计数断言即验收）。
 *   表外角色（table 无该 role）→ tier=defaultTier（会话默认档）、fallback=true。
 */
export function routeOnce({ table, role, features, suggestedTier, dispatchId, defaultTier = 'medium' }) {
  if (!dispatchId) throw new Error('routing: dispatchId 必填（路由日志 1:1 键控）')
  let suggested
  if (suggestedTier === undefined) {
    suggested = suggestTier(features)
  } else {
    if (!TIER_ORDER.includes(suggestedTier))
      throw new Error(`routing: suggestedTier 无效: ${String(suggestedTier)}（合法: ${TIER_ORDER.join('/')}）`)
    suggested = suggestedTier
  }
  const capTier = table?.[role]
  if (!capTier) {
    const d = { dispatchId, role, tableTier: null, suggestedTier: suggested, tier: defaultTier, clamped: false, fallback: true }
    return { ...d, logLine: fmtLog(d) }
  }
  const d = {
    dispatchId,
    role,
    tableTier: capTier,
    suggestedTier: suggested,
    tier: clampTier(suggested, capTier),
    clamped: TIER_ORDER.indexOf(suggested) > TIER_ORDER.indexOf(capTier),
    fallback: false,
  }
  return { ...d, logLine: fmtLog(d) }
}

/**
 * fallback 审计：run-state.json **权威路径**（`<cwd>/<stateDir>/state/run-state.json`）记
 * fallback:true（tmp+rename 原子写，复用 mcp-server 存量原语）。
 * M1 修复（2026-09-22 双通道评审）：原实现落 `<stateDir>/run-state.json`——与 c6 权威路径
 * 分叉（协议宣称同一文件）且裸读-改-写无锁、绕过队长独占写互斥。现统一走权威路径 +
 * withFileLock 互斥（与 writeRunStateMirror 同锁域），仅增补 fallback 审计面，不覆盖既有键。
 * ⚠️ 无 run（beginTeamRun 未跑）时本审计文件独立存在（五字段镜像契约不适用——纯审计面）。
 */
export async function recordFallback({ cwd, stateDir = '.omd', decision, at = new Date().toISOString() }) {
  if (!decision?.fallback) throw new Error('routing: recordFallback 只接受 fallback=true 的派发判定')
  if (!cwd) throw new Error('routing: recordFallback 需要 cwd（权威路径 = cwd/stateDir/state/run-state.json）')
  const file = runStatePath(cwd, stateDir)
  return withFileLock(file, async () => {
    const state = await readJson(file, {})
    state.fallback = true
    state.lastFallback = { dispatchId: decision.dispatchId, role: decision.role, tier: decision.tier, at }
    state.updatedAt = at
    await atomicWriteJson(file, state)
    return file
  })
}
