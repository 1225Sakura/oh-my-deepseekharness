/** 动态上下文渲染（规格 §4 静态/动态分层；OMX:RUNTIME overlay 对应物）。 */

const STALE_MS = 2 * 3600_000

/**
 * @param active state_list_active 的结果（可能来自 MCP 工具或文件直读的降级）
 * @param degraded 当前降级的探测项名数组
 * @returns 注入系统提示词的文本；无活跃模式且无降级时返回空串
 */
export function renderRuntimeSnapshot({ active, degraded }) {
  if ((!active || active.length === 0) && degraded.length === 0) return ''
  const lines = ['## omd 运行时状态']
  for (const s of active ?? []) {
    const stale = Date.now() - Date.parse(s._meta.updatedAt) > STALE_MS
    const iter = s.iteration !== undefined ? `（轮次 ${s.iteration}/${s.max_iterations ?? '?'}）` : ''
    lines.push(`- 活跃模式：${s._meta.mode}${iter}${s.current_phase ? ` 阶段=${s.current_phase}` : ''}${stale ? ' ⚠️STALE（>2h 未更新，恢复时提示用户而非自动续跑）' : ''}`)
  }
  if (active?.length) lines.push('恢复指引：先 state_read 对应模式 state + 读 .omd/checkpoints/ 快照再继续。')
  for (const d of degraded) lines.push(`- ⚠️降级：${d} 不可用，按协议层能力矩阵的降级路径执行`)
  return lines.join('\n')
}
