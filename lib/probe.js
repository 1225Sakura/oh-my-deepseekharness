/** 能力探测：四态结果 + 超时 + 有界输出 + 模块级缓存（规格 §2 probe 健壮性契约）。 */

let cache = null
export function _resetCache() { cache = null }  // 仅测试用

const MAX_DETAIL = 4096  // 有界输出 4KB

function truncate(s) {
  s = String(s)
  return s.length > MAX_DETAIL ? s.slice(0, MAX_DETAIL) + '…[truncated]' : s
}

async function probeOne(fn, timeoutMs) {
  let timer
  try {
    await Promise.race([
      fn(),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new TimeoutError()), timeoutMs) }),
    ])
    return { status: 'ok' }
  } catch (e) {
    if (e instanceof TimeoutError) return { status: 'timeout' }
    return { status: 'failure', detail: truncate(e?.message ?? e) }
  } finally { clearTimeout(timer) }
}
class TimeoutError extends Error {}

/**
 * @param ctx cordis 上下文（可选服务缺失时为 undefined）
 * @param opts.timeoutMs 单项探测超时，默认 3000
 * @returns 探测报告：{ core, storage, mcpClient, hooksBridge, hostVersion }
 */
export async function probeCapabilities(ctx, opts = {}) {
  if (cache) return cache
  const timeoutMs = opts.timeoutMs ?? 3000
  const report = {}

  // inject 保证的核心服务：存在即 ok（不做深度实测）
  report.core = (ctx.tools && ctx.skills && ctx.systemPrompt && ctx.commands)
    ? { status: 'ok' }
    : { status: 'failure', detail: '核心 inject 服务缺失，插件无法工作' }

  // 可选服务：缺失 → unavailable；存在 → 实测一次轻量调用
  report.storage = ctx.storage === undefined
    ? { status: 'unavailable' }
    : await probeOne(() => ctx.storage.get('oh-my-dsh', '__probe__').catch?.() ?? Promise.resolve(), timeoutMs)

  report.mcpClient = ctx.mcpClient === undefined
    ? { status: 'unavailable' } : { status: 'ok' }
  report.hooksBridge = ctx.hooks === undefined
    ? { status: 'unavailable' } : { status: 'ok' }

  cache = report
  return report
}

/** 渲染给协议 section / doctor 命令共用的一览表文本。 */
export function renderProbeReport(report) {
  const lines = ['| 探测项 | 状态 |', '|---|---|']
  for (const [k, v] of Object.entries(report))
    lines.push(`| ${k} | ${v.status}${v.detail ? `（${v.detail}）` : ''} |`)
  return lines.join('\n')
}
