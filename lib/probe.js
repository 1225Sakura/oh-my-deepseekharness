/** 能力探测：四态结果 + 超时 + 有界输出 + 模块级缓存（规格 §2 probe 健壮性契约）。 */

let cache = null
export function _resetCache() { cache = null }  // 测试用 + apply 入口重置（cordis 重放后防陈旧缓存）

const MAX_DETAIL = 4096  // 有界输出 4KB

function truncate(s) {
  s = String(s)
  return s.length > MAX_DETAIL ? s.slice(0, MAX_DETAIL) + '…[truncated]' : s
}

/**
 * 可选服务访问必须经 tryGet：cordis 里访问未 inject 的服务会抛
 * "cannot get property ... without inject"（终审 B1）——判空写法在真实宿主必炸。
 */
function tryGet(ctx, name) {
  try { return ctx[name] } catch { return undefined }
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
 * @param ctx cordis 上下文
 * @param opts.timeoutMs 单项探测超时，默认 3000
 * @returns 探测报告：{ core, storage, mcpClient, hooksBridge }（可选服务缺席归 unavailable）
 */
export async function probeCapabilities(ctx, opts = {}) {
  if (cache) return cache
  const timeoutMs = opts.timeoutMs ?? 3000
  const report = {}

  // inject 保证的核心服务：存在即 ok（不做深度实测）
  report.core = (ctx.tools && ctx.skills && ctx.systemPrompt && ctx.commands)
    ? { status: 'ok' }
    : { status: 'failure', detail: '核心 inject 服务缺失，插件无法工作' }

  // 可选服务：缺失 → unavailable；存在 → 按宿主真实 domain API 做形态校验（§7-7 核验：
  // ctx.storage.domain.open(spec) → Promise<Domain>）。只检查形态、不做深度 open，避免副作用。
  const storage = tryGet(ctx, 'storage')
  report.storage = storage === undefined
    ? { status: 'unavailable' }
    : await probeOne(async () => {
        const domain = await storage.domain
        if (typeof domain?.open !== 'function')
          throw new Error('ctx.storage.domain.open 缺失：宿主 storage 不是 domain API 形态')
      }, timeoutMs)

  report.mcpClient = tryGet(ctx, 'mcpClient') === undefined
    ? { status: 'unavailable' } : { status: 'ok' }
  report.hooksBridge = tryGet(ctx, 'hooks') === undefined
    ? { status: 'unavailable' } : { status: 'ok' }

  cache = report
  return report
}
