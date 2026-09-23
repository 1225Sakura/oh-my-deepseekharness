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
import { registerDelegateTool } from './delegate.js'
import { registerKeywordHook } from './hook.js'
import { registerHeartbeatTimer } from './heartbeat.js'
import { registerHudRoute } from './hud-route.js'

export const name = 'oh-my-dsh'
// 双清单语义（M1.1 修复）：
// - CORE_SERVICES：缺失即抛错（规格 §6.1 例外条款——没有它们插件根本无法工作）
// - inject 全量 = CORE_SERVICES + storage：storage 必须进 inject（cordis 对未 inject
//   服务的访问抛错——B1 教训；dsh-base 的 cordis.patch.yml 挂载了 dsh-storage 三件套，
//   任何 base profile 都保证它存在）。storage 缺失仍走降级不抛错（防御非 base profile）。
const CORE_SERVICES = ['tools', 'skills', 'systemPrompt', 'commands']
// M3 c1：subagents 进 inject（设计规格 §7-5：omd_delegate 用宿主 dsh-subagent 服务 spawn
// 指定 model）——cordis 对未 inject 服务的访问抛错（B1 教训）；dsh-base 每个模板都挂
// subagent 缝，缺席时 setup 内 tryGet 降级记 probeReport.delegate=unavailable。
export const inject = [...CORE_SERVICES, 'storage', 'subagents']
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
  // 核心服务缺失 → 启动即报错（规格 §6.1 例外条款）；storage 不在此列（缺失走降级）
  for (const svc of CORE_SERVICES)
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
  // 此处渲染 probe 降级公告。过滤规则（M1.1）：hooksBridge 是二期前置探测不算降级；
  // mcpServer 只在 failure 时公告（mounted/unavailable 不公告）。
  // v0.4 补充：skipped 默认不公告——但仅限「配置性关闭/无宿主面」的新探测行
  // （teamHeartbeat=0 关闭、hudRoute CLI 无 webServer、codeIntel.astGrep=false）；
  // memoryTools 的 skipped（storage 不可用）是真降级，照常公告（评审修复#13：
  // 初版全局过滤 skipped 曾把它静默吞掉）。
  const SKIP_IS_OK = new Set(['teamHeartbeat', 'hudRoute', 'codeIntel'])
  ctx.systemPrompt.context({
    name: 'oh-my-dsh:runtime',
    order: RUNTIME_CONTEXT_ORDER,
    text: () => renderRuntimeSnapshot({
      active: [],
      degraded: Object.entries(probeReport)
        .filter(([k, v]) => v.status !== 'ok'
          && !(v.status === 'skipped' && SKIP_IS_OK.has(k))
          && k !== 'hooksBridge'
          && (k !== 'mcpServer' || v.status === 'failure'))
        .map(([k]) => k),
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
        env: { OMD_STATE_DIR: config.stateDir, OMD_CODE_INTEL: JSON.stringify(config.codeIntel ?? {}) },
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

  // M3 c1：omd_delegate 硬路由工具——ctx.subagents spawn 缝在場才注册（缺席降级记 probe，
  // 不阻断插件；注册失败同样降级，软路由照常）
  let subagents
  try { subagents = ctx.subagents } catch { /* cordis：未 inject 的服务属性访问抛错=缺席 */ }
  if (subagents) {
    try {
      const defineTool = opts.defineTool ?? (await import('@deepseek-ai/dsh-tools')).defineTool
      await registerDelegateTool(ctx, defineTool, { config, roles: assets.roles })
      probeReport.delegate = { status: 'ok' }
    } catch (e) {
      probeReport.delegate = { status: 'failure', detail: String(e?.message ?? e) }
      ctx.logger?.warn?.(`oh-my-dsh: omd_delegate 注册失败（硬路由不可用，软路由照常）: ${e?.message ?? e}`)
    }
  } else {
    probeReport.delegate = { status: 'unavailable', detail: '宿主未挂载 subagent 缝（ctx.subagents 缺席）' }
  }

  // M3 c2（T4②-B 裁决）：关键词 hook——原生 cordis 插件消费宿主 agent/pre-step 拦截点
  // （dsh-hooks-claude-code 同款消费面，S2 F2 勘明；桥为 CC 兼容回退，本实现零依赖桥包）。
  // 确定性关键词检测（lib/keywords.js 单一来源，零 LLM）→ 命中写模式状态 + 注入激活指引；
  // 未命中零成本直通。注册失败降级记 probeReport.keywordHook，不阻断插件（关键词路由退回
  // 模型层协议执行——协议段路由表仍在）。
  try {
    await registerKeywordHook(ctx, { config })
    probeReport.keywordHook = { status: 'ok' }
  } catch (e) {
    probeReport.keywordHook = { status: 'failure', detail: String(e?.message ?? e) }
    ctx.logger?.warn?.(`oh-my-dsh: 关键词 hook 注册失败（路由退回模型层协议执行）: ${e?.message ?? e}`)
  }

  // v0.4 P2-C：team heartbeat 周期检测定时器（lib/heartbeat.js；0=关闭记 skipped，注册失败降级不阻断）
  try {
    const hb = registerHeartbeatTimer(ctx, { config })
    probeReport.teamHeartbeat = { status: hb.enabled ? 'ok' : 'skipped', detail: hb.detail }
  } catch (e) {
    probeReport.teamHeartbeat = { status: 'failure', detail: String(e?.message ?? e) }
    ctx.logger?.warn?.(`oh-my-dsh: team heartbeat 定时器注册失败（team_heartbeat_scan 按需扫描仍可用）: ${e?.message ?? e}`)
  }

  // v0.4 P2-D：HUD client half 数据面——web 宿主上注册 /oh-my-dsh/hud.json（CLI 会话降级 skipped）
  try {
    const hr = registerHudRoute(ctx, { config })
    probeReport.hudRoute = { status: hr.enabled ? 'ok' : 'skipped', detail: hr.detail }
  } catch (e) {
    probeReport.hudRoute = { status: 'failure', detail: String(e?.message ?? e) }
    ctx.logger?.warn?.(`oh-my-dsh: HUD 路由注册失败（client half 无数据面；MCP hud_render 仍可用）: ${e?.message ?? e}`)
  }

  // v0.4 P2-E：codeIntel 探测——@ast-grep/napi 原生依赖可用性（LSP 由 codeIntel.lspServers
  // 注册表驱动，无原生依赖；napi 缺席只影响 ast_grep_*，工具层显式报错不静默降级）
  if (config.codeIntel?.astGrep === false) {
    probeReport.codeIntel = { status: 'skipped', detail: 'codeIntel.astGrep=false（ast_grep_* 已配置禁用）' }
  } else {
    try {
      await import('@ast-grep/napi')
      probeReport.codeIntel = { status: 'ok' }
    } catch (e) {
      probeReport.codeIntel = { status: 'unavailable', detail: `@ast-grep/napi 加载失败（ast_grep_* 显式报错，LSP 不受影响）: ${String(e?.message ?? e)}` }
    }
  }

  return { probeReport }
}
