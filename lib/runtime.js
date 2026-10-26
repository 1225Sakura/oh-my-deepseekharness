/** 动态上下文渲染（规格 §4 静态/动态分层；OMX:RUNTIME overlay 对应物）。 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 活跃模式同步读面（2026-10-26 第二轮 S5：复活 active 分支——此前 index.js 硬编码
 * active:[]，「活跃模式+恢复指引」是死代码）。锚=assemble 时 context.agent.session.header.cwd
 * （dsh-agent dispatch.js:92 assembleContextFor 先例），text() 必须同步返回（assemble 不 await），
 * 故用同步 fs——小 JSON 文件、有界扫描（≤20 个状态文件）、一切失败回落 []（只降级公告）。
 */
export function readActiveModesSync(cwd, stateDir = '.omd') {
  if (typeof cwd !== 'string' || !cwd) return [] // 锚缺失 → 拒绝相对路径回落宿主 cwd（HUD 同款病灶教训）
  try {
    const sessionsRoot = join(cwd, stateDir, 'state', 'sessions')
    const out = []
    for (const sess of readdirSync(sessionsRoot, { withFileTypes: true })) {
      if (!sess.isDirectory()) continue
      for (const f of readdirSync(join(sessionsRoot, sess.name))) {
        if (!f.endsWith('-state.json') || out.length >= 20) continue
        try {
          const s = JSON.parse(readFileSync(join(sessionsRoot, sess.name, f), 'utf8'))
          if (s?.active === true && s?._meta?.mode) out.push(s)
        } catch { /* 单文件坏 → 跳过（坏文件不炸原则同款） */ }
      }
    }
    out.sort((a, b) => String(b._meta.updatedAt ?? '').localeCompare(String(a._meta.updatedAt ?? '')))
    return out
  } catch { return [] } // sessions 目录缺席/不可读 → 无活跃模式
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
  for (const d of degraded) lines.push(`- ⚠️降级：${d} 不可用，按协议层能力矩阵的降级路径执行`)
  return lines.join('\n')
}
