// lib/heartbeat.js
// v0.4 P2-C team heartbeat 周期检测定时器（c6/team 运行时的插件侧呈面）：
// - cordis ctx.effect 托管 setInterval，插件重放/卸载自动回收（dispose=clearInterval）
// - 周期扫描 <process.cwd()>/<stateDir>/team/*/registry.json（lib/team.js scanHeartbeat）：
//   超时未心跳队员标 stale（粘性，绝不自动杀）+ 未 ack blocker/question → logger.warn 呈面
// - 诚实边界（与 lib/team.js 头注同款）：检测+呈面是插件能做的全部——催促动作由领队模型
//   经 send_message 执行（dsh 无插件→subagent 消息缝）。宿主进程 cwd 非项目根时扫描空目录
//   自然 no-op（文档化限制）；Config team.heartbeatIntervalMs=0 关闭定时器（按需扫描仍可用）。
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { scanHeartbeat } from './team.js'

/**
 * 注册 heartbeat 定时器。ctx.effect 缺席（测试 mock）时静默跳过。
 * @param opts.scan 扫描函数注入点（测试用）；默认对 <cwd>/<stateDir>/team/* 逐一 scanHeartbeat
 * @returns { enabled, detail, fired } 供 probeReport.teamHeartbeat 记录
 */
export function registerHeartbeatTimer(ctx, { config, scan } = {}) {
  const intervalMs = config?.team?.heartbeatIntervalMs ?? 60_000
  if (!intervalMs) return { enabled: false, detail: 'team.heartbeatIntervalMs=0（定时器关闭，按需扫描可用）', fired: 0 }
  if (typeof ctx?.effect !== 'function') return { enabled: false, detail: 'ctx.effect 缺席（测试/降级环境），定时器未注册', fired: 0 }
  const stateDir = config?.stateDir ?? '.omd'
  const staleAfterMs = config?.team?.staleAfterMs ?? 300_000
  const doScan = scan ?? (async () => {
    const cwd = process.cwd()
    const root = join(cwd, stateDir, 'team')
    let runs = []
    try { runs = await readdir(root, { withFileTypes: true }) } catch { return [] } // 无 team 目录 → no-op
    const lines = []
    for (const e of runs) {
      if (!e.isDirectory()) continue
      const r = await scanHeartbeat({ cwd, runId: e.name, stateDir, staleAfterMs })
      lines.push(...r.alertLines) // 结构化告警面（评审修复#4：不再子串嗅探——用户文本曾可吞告警）
    }
    return lines
  })
  let fired = 0
  let scanning = false // in-flight 守卫：扫描慢于 interval 时跳过重叠 tick（评审修复 LOW-1）
  ctx.effect(() => {
    const timer = setInterval(async () => {
      if (scanning) return
      scanning = true
      fired++
      try {
        for (const line of await doScan())
          ctx.logger?.warn?.(`oh-my-dsh: ${line}`)
      } catch (err) {
        // 扫描失败静默降级（下周期重试），绝不因后台检测阻断宿主
        ctx.logger?.debug?.(`oh-my-dsh: team heartbeat 扫描失败（下周期重试）: ${err?.message ?? err}`)
      } finally {
        scanning = false
      }
    }, intervalMs)
    timer.unref?.() // 后台检测不阻止进程退出
    return () => clearInterval(timer)
  })
  return { enabled: true, detail: `interval=${intervalMs}ms staleAfter=${staleAfterMs}ms`, get fired() { return fired } }
}
