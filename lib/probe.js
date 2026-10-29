/** 能力探测：四态结果 + 超时 + 有界输出 + 模块级缓存（规格 §2 probe 健壮性契约）。 */

let cache = null
export function _resetCache() { cache = null }  // 测试用 + apply 入口重置（cordis 重放后防陈旧缓存）

const MAX_DETAIL = 4096  // 有界输出 4KB

function truncate(s) {
  s = String(s)
  return s.length > MAX_DETAIL ? s.slice(0, MAX_DETAIL) + '…[truncated]' : s
}

import { tryGet } from './tryget.js' // 单源（原三份拷贝之一，刻板审查修复）

async function probeOne(fn, timeoutMs) {
  let timer
  try {
    const op = fn()
    // 阻断热修（主动深审轮 R1）：超时后输掉的竞速 promise 稍后 reject 时不得成为
    // unhandled rejection——node>=22.19 默认 throw 会让宿主进程退出。超时即判 timeout，
    // 输者的失败信息对四态判定无增益，no-op catch 吸收。
    op.catch(() => {})
    await Promise.race([
      op,
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
 * @returns 探测报告：{ core, storage }（可选服务缺席归 unavailable）
 *
 * 注意：没有 mcpClient 行——`ctx.mcpClient` 服务根本不存在（MCP 挂载走
 * `import('@deepseek-ai/dsh-mcp-client')` + `ctx.plugin()`，与宿主服务无关），
 * 探测它只能是固有假阴性。真实信号是 index.js 追加的 `probeReport.mcpServer`（挂载结果 + smokeMcpServer 冒烟）。
 * 2026-10-26 审查：M3 hooks 桥残件探测行已移除——dsh 宿主根本没有 ctx.hooks 服务，
 * 该行构造性恒 unavailable（M3 二期前置规划残留），纯噪音；关键词 hook 走原生
 * agent/pre-step 拦截点（lib/hook.js），其真实信号是 probeReport.keywordHook。
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

  cache = report
  return report
}

/**
 * MCP server 真冒烟（计划 P0-W1-3：挂载成功≠server 真起来——failOnStartupError:false 下
 * stdio server 启动即崩时全部 mcp__omd-state__* 工具静默缺席；mcp-client 不暴露任何 ctx 服务，
 * 唯一真实信号 = 独立探针客户端对同一 server 入口做 initialize 握手（SDK connect）+ tools/list 计数）。
 * 尽力而为：任何失败归 { smoke:'fail', tools:null }，绝不抛错；timeoutMs 到点放弃并关闭探针进程。
 * @param opts.command/args/env 探针 spawn 目标（index.js 传 server 入口与三 env）
 * @param opts.timeoutMs 整体预算（connect+tools/list），默认 5000
 * @param opts.clientFactory 测试注入：async (opts) => { connect, request, close }；
 *   默认构造 MCP SDK stdio 客户端（env 沿 mcp-client 同款 scrubbedParentEnv + extra）
 * @returns { smoke:'ok'|'fail', tools:number|null, detail?:string }
 */
export async function smokeMcpServer(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 5000
  let handle
  try {
    handle = await (opts.clientFactory ?? defaultSmokeClientFactory)(opts)
  } catch (e) {
    return { smoke: 'fail', tools: null, detail: `探针客户端构造失败: ${truncate(String(e?.message ?? e))}` }
  }
  let timer
  try {
    let listSchema = null
    try { listSchema = (await import('@modelcontextprotocol/sdk/types.js')).ListToolsResultSchema } catch { /* 注入 factory 时 schema 可缺席 */ }
    const op = (async () => {
      await handle.connect()
      const res = await handle.request({ method: 'tools/list' }, listSchema)
      const tools = Array.isArray(res?.tools) ? res.tools.length : null
      return { smoke: 'ok', tools }
    })()
    // 同 probeOne：超时后 finally close() 令挂起的 connect/request 以 ConnectionClosed
    // 拒绝——no-op catch 吸收，防止 unhandled rejection 崩宿主（回归钉在 mcp-smoke.test.js）。
    op.catch(() => {})
    const result = await Promise.race([
      op,
      new Promise((_, rej) => { timer = setTimeout(() => rej(new TimeoutError()), timeoutMs) }),
    ])
    return result.tools !== null
      ? { ...result, detail: `initialize+tools/list 冒烟通过（${result.tools} 个工具）` }
      : result
  } catch (e) {
    return {
      smoke: 'fail',
      tools: null,
      detail: e instanceof TimeoutError
        ? `冒烟超时（>${timeoutMs}ms）——server 未在窗口内完成 initialize/tools-list`
        : `冒烟失败: ${truncate(String(e?.message ?? e))}`,
    }
  } finally {
    clearTimeout(timer)
    try { await handle.close() } catch { /* 探针清理尽力而为 */ }
  }
}

/** 默认探针客户端：MCP SDK stdio Client（connect=initialize 握手）；close 同时回收子进程。 */
async function defaultSmokeClientFactory(opts) {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
  ])
  let baseEnv
  try { baseEnv = (await import('@deepseek-ai/dsh-subprocess')).scrubbedParentEnv() }
  catch { baseEnv = process.env } // dsh-subprocess 缺席（非宿主进程内运行）→ 原样继承
  const transport = new StdioClientTransport({
    command: opts.command,
    args: opts.args ?? [],
    env: { ...baseEnv, ...(opts.env ?? {}) },
  })
  const client = new Client({ name: 'omd-mcp-smoke', version: '0.0.0' })
  return {
    connect: () => client.connect(transport),
    request: (msg, schema) => client.request(msg, schema ?? { parse: (v) => v }),
    close: async () => {
      try { await client.close() } catch { /* 尽力而为 */ }
      try { await transport.close() } catch { /* 尽力而为 */ }
    },
  }
}
