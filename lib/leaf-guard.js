// lib/leaf-guard.js
// 二期 dsh-native 切片（2026-11-16）：leaf-guard 从协议文字纪律 → 机制强制。
// practices.md §17：隐藏工具的正确最弱机制 = ctx.tools.restrict()（只删可见性，不碰执行管线）；
// §19：per-agent 行为注册在 agent.ctx（agent/created 监听器取得），agent 销毁时随其作用域回收；
//      但「注册在别的上下文有两个 owner」——本插件自身的 effect 同样持有一份 disposer。
// leaf 判定（宿主权威信号，dsh-session SessionHeader）：
//   delegationDepth —— 顶层会话缺席（视为 0），子代理 = parent depth + 1；持久化字段，
//   重启/恢复后语义不灭（冷恢复也走 agent/created，限制自动重挂）。
//   origin==='subagent' 同样归 leaf（防御 depth 缺席的畸形头）。
// 拒绝面只收「编排控制平面」：孙代理派发（omd_delegate）+ team 领队专用工具 + graph 运行控制。
// 队员作业面（team_worker_*/team_mail_*/team_registry/team_write_tree_state/state_*/notepad_*）
// 刻意保留可见——omd team 流水线的队员就是 leaf 作用域，作业工具必须可用。
const LEAF_DENY = [
  // 孙代理派发（leaf-guard 的存在理由）
  'omd_delegate',
  // team 领队控制平面（队员只作业，不管理运行）
  'omd_team_begin', 'omd_team_dispose', 'omd_team_cancel', 'omd_team_scan_orphans',
  'omd_team_phase_transition', 'omd_team_register_worker', 'omd_team_merge_plan',
  'omd_team_heartbeat_scan',
  // graph 运行控制（validate/status 只读面保留）
]

/** 判定一个 agent 是否 leaf（子代理作用域）。header 缺失/畸形一律按顶层（失效方向=不隐藏）。 */
export function isLeafAgent(agent) {
  const header = agent?.session?.header
  if (!header) return false
  const depth = header.delegationDepth
  if (typeof depth === 'number' && Number.isFinite(depth) && depth > 0) return true
  return header.origin === 'subagent'
}

/**
 * 注册机械 leaf-guard：agent/created 上对 leaf 作用域 agent.ctx 挂 tools.restrict({deny})。
 * 契约：(1) 监听器自身绝不抛错（serial 事件，无 next——照 goal-round-driver 惯例吞错降级）；
 * (2) 非 leaf 零成本直通；(3) 双 owner 回收——per-agent disposer 同时挂进本插件 effect，
 * 卸载/重放（cordis dispose+apply）与 agent 销毁任一路径都能解除限制；
 * (4) agentCtx 形状不满足（无 .ctx/.tools.restrict）→ 一次性 warn 降级，不阻断注册。
 * @param opts.deny 测试注入拒绝名单；默认 LEAF_DENY
 * @param opts.logger 测试注入；默认 ctx.logger
 */
export async function registerLeafGuard(ctx, opts = {}) {
  if (typeof ctx.on !== 'function')
    throw new Error('宿主 ctx 缺少事件面（ctx.on）——无法消费 agent/created')
  const deny = opts.deny ?? LEAF_DENY
  const logger = opts.logger ?? ctx.logger
  // 双 owner 台账：per-agent disposer 键控 by sessionId（防重复 created 重挂——重挂先 dispose 旧份）
  const perAgent = new Map()
  const disposeOne = (sessionId) => {
    const d = perAgent.get(sessionId)
    if (!d) return
    perAgent.delete(sessionId)
    try { d() } catch (e) { logger?.warn?.(`[leaf-guard] 限制解除失败（session=${sessionId}）: ${e?.message ?? e}`) }
  }
  ctx.on('agent/created', ({ agent } = {}) => {
    try {
      if (!isLeafAgent(agent)) return
      const sessionId = agent?.session?.header?.id
      const agentCtx = agent?.ctx
      const restrict = agentCtx?.tools?.restrict
      if (typeof restrict !== 'function') {
        logger?.warn?.('[leaf-guard] leaf 作用域缺 agent.ctx.tools.restrict——本 agent 退回协议文字守卫（不阻断）')
        return
      }
      if (typeof sessionId === 'string') disposeOne(sessionId) // 防御：同名 agent 重建先拆旧限制
      const dispose = restrict.call(agentCtx, { deny: [...deny] })
      if (typeof sessionId === 'string') perAgent.set(sessionId, dispose)
      logger?.info?.(`[leaf-guard] leaf 作用域已机械隐藏 ${deny.length} 个编排工具（session=${sessionId ?? '<unknown>'}）`)
    } catch (e) {
      logger?.warn?.(`[leaf-guard] 处理失败（本 agent 未挂限制，直通）: ${e?.message ?? e}`)
    }
  })
  // 本插件自己的 owner：重放/卸载时解除全部 per-agent 限制（cordis effect 支持同步 cleanup）
  ctx.effect?.(() => () => { for (const sessionId of [...perAgent.keys()]) disposeOne(sessionId) })
  return { deny: [...deny] }
}
