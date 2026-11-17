/** 动态上下文渲染（规格 §4 静态/动态分层；OMX:RUNTIME overlay 对应物）。 */
import { stateCwdPrefix } from './state-domain.js'

/**
 * 活跃模式同步读面（二期②起经 storageDomain 域表：get/keys 同步内存权威态，text() 的
 * 同步契约不变）。锚=assemble 时 context.agent.session.header.cwd；表缺席/锚缺失回落 []
 * （只降级公告）。有界 ≤20 条（同旧文件扫描口径）。
 */
export function readActiveModesFromTable(table, cwd) {
  if (!table || typeof table.keys !== 'function') return [] // 域未接入（storage 缺席）→ 无活跃模式
  if (typeof cwd !== 'string' || !cwd) return [] // 锚缺失 → 拒绝相对路径回落宿主 cwd（HUD 同款病灶教训）
  try {
    const prefix = stateCwdPrefix(cwd)
    const out = []
    for (const kk of table.keys()) {
      if (!kk.startsWith(prefix) || out.length >= 20) continue
      const s = table.get(kk)
      if (s?.active === true && s?._meta?.mode) out.push(s)
    }
    out.sort((a, b) => String(b._meta.updatedAt ?? '').localeCompare(String(a._meta.updatedAt ?? '')))
    return out
  } catch { return [] } // 表异常 → 无活跃模式（坏记录不炸原则同款）
}

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
  for (const d of degraded) lines.push(`- ⚠️降级：${d} 不可用，按对应技能的降级规则执行；状态工具缺席时用普通文件工具读写 .omd/`)
  return lines.join('\n')
}
