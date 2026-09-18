// lib/index.js
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Config } from './config.js'
import { probeCapabilities } from './probe.js'
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
 * @param opts.assetsRoot 测试注入资产目录；默认包内 assets/
 * @param opts.defineTool 测试注入；默认动态 import('@deepseek-ai/dsh-tools')
 */
export async function apply(ctx, config, opts = {}) {
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

  registerCommands(ctx)

  if (ctx.storage) {
    const defineTool = opts.defineTool ?? (await import('@deepseek-ai/dsh-tools')).defineTool
    // 内部经 ctx.effect 注册 domain close（插件重放/卸载时释放存储句柄）
    await registerMemoryTools(ctx, defineTool)
  }

  return { probeReport }
}
