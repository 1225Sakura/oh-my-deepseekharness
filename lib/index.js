// lib/index.js
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Config } from './config.js'
import { probeCapabilities, _resetCache } from './probe.js'
import { renderProtocol } from './protocol.js'
import { renderRuntimeSnapshot } from './runtime.js'
import { loadAssets, registerAssets } from './skills.js'
import { registerCommands } from './commands.js'
import { registerMemoryTools } from './memory.js'

export const name = 'oh-my-dsh'
// 可选服务（storage）经运行时判空降级（规格 §6.1）；MVP 用必需 inject + ctx.storage 判空。
export const inject = ['tools', 'skills', 'systemPrompt', 'commands']
export { Config }

const DEFAULT_ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')

// §7-2 核验：dsh-system-prompt 的 section()/context() 都强制 Number.isFinite(order)；
// context 的集中档位 CONTEXT_ORDERS 用到 120（SUBAGENT_DELEGATION），omd 顺延。
const PROTOCOL_SECTION_ORDER = 100
const RUNTIME_CONTEXT_ORDER = 130

/**
 * cordis 插件入口。配置变更时宿主经 Fiber.update() → restart() 重放本函数，
 * 所有注册（section/context/skill/command/tool/domain close）随 scope dispose 自动回收。
 *
 * cordis 契约：apply 的返回值只能是 dispose 函数或 null/undefined，
 * 返回普通对象会被 safeCollect 判为 Invalid effect（cordis _execute）。
 * 因此 cordis 入口不返回值；需要 probeReport 的测试改用 setup()。
 * @param opts.assetsRoot 测试注入资产目录；默认包内 assets/
 * @param opts.defineTool 测试注入；默认动态 import('@deepseek-ai/dsh-tools')
 */
export async function apply(ctx, config, opts = {}) {
  await setup(ctx, config, opts)
}

/** apply 的实现本体，返回 { probeReport } 供测试断言降级矩阵；cordis 宿主请走 apply。 */
export async function setup(ctx, config, opts = {}) {
  // M3：cordis 配置重放 = dispose + 重跑 apply，probe 模块级缓存必须随之重置，否则陈旧
  _resetCache()
  // 核心服务缺失 → 启动即报错（规格 §6.1 例外条款）
  for (const svc of inject)
    if (!ctx[svc]) throw new Error(`oh-my-dsh: 核心服务 ${svc} 缺失，插件无法工作（请升级 dsh 宿主）`)

  const probeReport = await probeCapabilities(ctx)
  const assets = await loadAssets({ assetsRoot: opts.assetsRoot ?? DEFAULT_ASSETS, language: config.language })
  registerAssets(ctx, assets)

  // text 函数必须同步求值（§7-2 核验：assemble() 同步调用 text(context)，不 await）——
  // renderProtocol / renderRuntimeSnapshot 都是同步纯函数，符合契约。
  ctx.systemPrompt.section({
    name: 'oh-my-dsh:protocol',
    order: PROTOCOL_SECTION_ORDER,
    text: () => renderProtocol({ config, probeReport, roles: assets.roles }),
  })

  // 动态 context：active-mode 快照。MVP 经协议指引模型用 state_get_status 自查；
  // 此处渲染 probe 降级公告（活跃模式快照需要会话 cwd——§7-9 验证后补全）
  ctx.systemPrompt.context({
    name: 'oh-my-dsh:runtime',
    order: RUNTIME_CONTEXT_ORDER,
    text: () => renderRuntimeSnapshot({
      active: [],
      degraded: Object.entries(probeReport).filter(([, v]) => v.status !== 'ok').map(([k]) => k),
    }),
  })

  // H1：registerCommands 内动态 import('@deepseek-ai/dsh-llm')；包缺席/注册失败降级不阻断插件
  try {
    await registerCommands(ctx)
    probeReport.commands = { status: 'ok' }
  } catch (e) {
    probeReport.commands = { status: 'failure', detail: String(e?.message ?? e) }
    ctx.logger?.warn?.(`oh-my-dsh: 命令注册失败（/omd-doctor /omd-cancel 不可用）: ${e?.message ?? e}`)
  }

  // §7-1 闭环：cordis.patch.yml 静态 YAML 无法引用包内绝对路径（args 相对路径解析基准不可靠），
  // 改为运行时动态挂载——cordis ctx.plugin({name,inject,Config,apply}, config) 已源码实证，
  // fiber 生命周期随 omd 重放/卸载自动回收。mcp-client 失败不阻断插件（降级路径见协议能力矩阵）。
  let mcpStatus = 'unavailable'
  try {
    const mcp = await import('@deepseek-ai/dsh-mcp-client')
    await ctx.plugin(
      { name: mcp.name, inject: mcp.inject, Config: mcp.Config, apply: mcp.apply },
      {
        transport: 'stdio',
        serverName: 'omd-state',
        command: process.execPath,
        args: [join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp-server', 'index.mjs')],
        env: { OMD_STATE_DIR: config.stateDir },
        failOnStartupError: false,
        reconnect: { enabled: true, initialDelayMs: 1000, maxDelayMs: 30000, maxAttempts: 5 },
      },
    )
    mcpStatus = 'ok'
  } catch (e) {
    mcpStatus = 'failure'
    ctx.logger?.warn?.(`oh-my-dsh: MCP server 挂载失败，state/notepad/prd/handoff 工具不可用（协议层降级为文件直读）: ${e?.message ?? e}`)
  }
  probeReport.mcpServer = { status: mcpStatus }

  // 消费 probe 结论而非存在性门控（§6.1：storage failure/unavailable 时降级，不注册记忆工具）
  if (probeReport.storage?.status === 'ok') {
    // B2：dsh-tools 动态 import 或注册过程失败 → 降级，不阻断插件加载
    try {
      const defineTool = opts.defineTool ?? (await import('@deepseek-ai/dsh-tools')).defineTool
      // H1：registerMemoryTools 内动态 import('@deepseek-ai/dsh-storage-domain')；
      // 内部经 ctx.effect 注册 domain close（插件重放/卸载时释放存储句柄）
      await registerMemoryTools(ctx, defineTool)
      probeReport.memoryTools = { status: 'ok' }
    } catch (e) {
      probeReport.memoryTools = { status: 'failure', detail: String(e?.message ?? e) }
      ctx.logger?.warn?.(`oh-my-dsh: 记忆工具注册失败（omd_memory_* 不可用）: ${e?.message ?? e}`)
    }
  } else {
    probeReport.memoryTools = { status: 'skipped', detail: 'storage 不可用' }
  }

  return { probeReport }
}
