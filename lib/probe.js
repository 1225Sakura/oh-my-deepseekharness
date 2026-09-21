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
 * @returns 探测报告：{ core, storage, hooksBridge }（可选服务缺席归 unavailable）
 *
 * 注意：没有 mcpClient 行——`ctx.mcpClient` 服务根本不存在（MCP 挂载走
 * `import('@deepseek-ai/dsh-mcp-client')` + `ctx.plugin()`，与宿主服务无关），
 * 探测它只能是固有假阴性。真实信号是 index.js 追加的 `probeReport.mcpServer`（挂载结果）。
 * hooksBridge 是 M3 二期前置探测（hooks 桥关键词检测），其 unavailable 不算降级——
 * 协议矩阵照常展示，但动态 context 的降级公告过滤它（见 index.js）。
 */
export async function probeCapabilities(ctx, opts = {}) {
  if (cache) return cache
  const timeoutMs = opts.timeoutMs ?? 3000
  const report = {}

  // inject 保证的核心服务：存在即 ok（不做深度实测）
  report.core = (ctx.tools && ctx.skills && ctx.systemPrompt && ctx.commands)
    ? { status: 'ok' }
    : { status: 'failure', detail: '核心 inject 服务缺失，插件无法工作' }

  // storage 在 inject 中声明（dsh-base 保证 dsh-storage 三件套存在——patch 实证）；
  // 防御非 base profile：缺失仍归 unavailable 走降级，不抛错。
  // 真实 domain API 形态校验（§7-7 核验：ctx.storage.domain.open(spec) → Promise<Domain>）。
  // 只检查形态、不做深度 open，避免副作用（详见规格 §7-7 副作用分析）。
  const storage = tryGet(ctx, 'storage')
  report.storage = storage === undefined
    ? { status: 'unavailable' }
    : await probeOne(async () => {
        const domain = await storage.domain
        if (typeof domain?.open !== 'function')
          throw new Error('ctx.storage.domain.open 缺失：宿主 storage 不是 domain API 形态')
      }, timeoutMs)

  report.hooksBridge = tryGet(ctx, 'hooks') === undefined
    ? { status: 'unavailable', detail: '二期前置（M3 hooks 桥关键词检测），不算降级' }
    : { status: 'ok' }

  cache = report
  return report
}
