// lib/heartbeat.js
// v0.4 P2-C team heartbeat 周期检测定时器（c6/team 运行时的插件侧呈面）：
// - cordis ctx.effect 托管 setInterval，插件重放/卸载自动回收（dispose=clearInterval）
// - 周期扫描 <process.cwd()>/<stateDir>/team/*/registry.json（lib/team.js scanHeartbeat）：
//   超时未心跳队员标 stale（粘性，绝不自动杀）+ 未 ack blocker/question → logger.warn 呈面
// - 诚实边界（与 lib/team.js 头注同款）：检测+呈面是插件能做的全部——催促动作由领队模型
//   经 send_message 执行（dsh 无插件→subagent 消息缝）。宿主进程 cwd 非项目根时扫描空目录
//   自然 no-op（文档化限制）；Config team.heartbeatIntervalMs=0 关闭定时器（按需扫描仍可用）。
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { scanHeartbeat } from './team.js'

/**
 * 全 run 扫描（2026-10-26 审查 S5 导出）：对 <cwd>/<stateDir>/team/* 逐一 scanHeartbeat，
 * 汇总 alertLines。双消费者：本模块周期定时器（cwd=宿主 process.cwd()，记日志）与
 * hud-route.js hudSnapshot（cwd=请求指定的会话工作区，进面板告警区）——后者修复
 * 「heartbeat 告警只进宿主日志、模型/用户不可见」的断链。
 * ENOENT（无 team 目录）→ []；目录不可读 → 单行降级告警（不静默）。
 */
export async function scanAllRuns({ cwd, stateDir = '.omd', staleAfterMs = 300_000 }) {
  const root = resolve(cwd, stateDir, 'team') // P2-5：resolve 非 join——绝对 stateDir 防幻影树（events.js 同款纪律）
  let runs = []
  try { runs = await readdir(root, { withFileTypes: true }) }
  catch (e) {
    if (e?.code === 'ENOENT') return []
    return [`[team] heartbeat 扫描目录不可读（${e?.code ?? e?.message}）——周期检测降级，请检查 ${root} 权限`]
  }
  const lines = []
  for (const e of runs) {
    if (!e.isDirectory()) continue
    // P2-4 修复（评审）：per-run 容错——一个坏 run 不再静默清空全部 alerts（坏 run 降级行呈面）
    try {
      const r = await scanHeartbeat({ cwd, runId: e.name, stateDir, staleAfterMs })
      lines.push(...r.alertLines) // 结构化告警面（评审修复#4：不再子串嗅探——用户文本曾可吞告警）
    } catch (err) {
      lines.push(`[team] run ${e.name} 心跳扫描异常：${err?.message ?? err}（该 run 须人工核查）`)
    }
  }
  return lines
}

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
  // 扫描逻辑单一来源=scanAllRuns（导出供 hud-route 按请求 cwd 复用；此处锚宿主 cwd）
  const doScan = scan ?? (() => scanAllRuns({ cwd: process.cwd(), stateDir, staleAfterMs }))
  let fired = 0
  let consecutiveFailures = 0 // 失败节流计数（warn 呈面用）
  let scanning = false // in-flight 守卫：扫描慢于 interval 时跳过重叠 tick（评审修复 LOW-1）
  ctx.effect(() => {
    const timer = setInterval(async () => {
      if (scanning) return
      scanning = true
      fired++
      try {
        for (const line of await doScan())
          ctx.logger?.warn?.(`oh-my-dsh: ${line}`)
        consecutiveFailures = 0 // 成功拍复位节流
      } catch (err) {
        // 刻板审查修复（报告二：debug 静默→warn 节流呈面）：连续失败每 10 拍 warn 一次，
        // 「检测+呈面」承诺的失败路径不再失明；仍绝不因后台检测阻断宿主
        consecutiveFailures++
        if (consecutiveFailures === 1 || consecutiveFailures % 10 === 0)
          ctx.logger?.warn?.(`oh-my-dsh: team heartbeat 扫描连续失败 ×${consecutiveFailures}（检测降级中，下周期重试）: ${err?.message ?? err}`)
      } finally {
        scanning = false
      }
    }, intervalMs)
    timer.unref?.() // 后台检测不阻止进程退出
    return () => clearInterval(timer)
  })
  return { enabled: true, detail: `interval=${intervalMs}ms staleAfter=${staleAfterMs}ms`, get fired() { return fired } }
}
