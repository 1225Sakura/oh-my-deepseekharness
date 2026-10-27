// lib/config.js
import z from '@deepseek-ai/schemastery'

export const Config = z.object({
  language: z.union([z.const('zh'), z.const('en'), z.const('both')]).default('zh')
    .description('资产语言：zh 中文 / en 英文 / both 中文正文+英文术语'),
  tiers: z.object({
    low: z.string().default('inherit'),
    medium: z.string().default('inherit'),
    high: z.string().default('inherit'),
  }).description('档位→模型映射；值为模型标识或 "inherit"（继承主会话路由，默认）。'
    + '成本敏感部署可显式覆写为具体模型 id；'
    + '不可用 id 由 omd_delegate 派发前校验显式报错，不静默继承。'
    + '（0.4.4→0.4.5 默认值行为变更见 README 迁移说明）'),
  roleOverrides: z.dict(z.string()).default({})
    .description('角色级覆盖，如 { "omd-agent-code-reviewer": "provider/model" }'),
  routing: z.object({
    defaultTier: z.union([z.const('low'), z.const('medium'), z.const('high')]).default('medium'),
  }).description('c3 自适应路由：表外任务 fallback 落会话默认档（run-state.json 记 fallback:true）'),
  stateDir: z.string().default('.omd').description('项目状态目录名'),
  autopilot: z.object({
    maxIterations: z.natural().min(1).default(10),
    maxQaCycles: z.natural().min(1).default(5),
    maxValidationRounds: z.natural().min(1).default(3),
  }).description('autopilot 界限：maxIterations=goal 轮次上限（create_goal 的 max_goal_rounds）；'
    + 'maxQaCycles=QA 循环上限；maxValidationRounds=复验轮次上限'),
  // 终审修复 #3：deep-interview skill 引用的配置键（源 OMC 读 .claude/settings.json 的
  // omc.deepInterview.*）——模型运行时无法读插件 Config，由 protocol.js 渲染进协议段。
  deepInterview: z.object({
    ambiguityThreshold: z.number().default(0.2),
    maxRounds: z.natural().min(1).default(20),
    softWarningRounds: z.natural().min(1).default(10),
  }).description('deep-interview 门禁：ambiguityThreshold=歧义度阈值；'
    + 'softWarningRounds=软提醒轮数；maxRounds=硬上限轮数'),
  team: z.object({
    heartbeatIntervalMs: z.natural().default(60_000),
    staleAfterMs: z.natural().min(1).default(300_000),
  }).description('team 运行时心跳：heartbeatIntervalMs=周期检测间隔（0=关闭定时器，'
    + '领队仍可用 team_heartbeat_scan 按需扫描）；staleAfterMs=队员无心跳 stale 阈值'),
  hudRoute: z.boolean().default(true)
    .description('HUD 数据路由 /oh-my-dsh/hud.json 开关（安全阀：false=不注册该 loopback 只读路由；'
    + '该路由无鉴权、?cwd= 可读任意已存在目录的 .omd 摘要——多用户/非可信本机环境建议关闭；'
    + 'MCP hud_render 不受影响）'),
  hudPreset: z.union([z.const('minimal'), z.const('focused'), z.const('full')]).default('focused')
    .description('HUD 面板预设：minimal=纯卡文本 / focused=主模式卡+告警（默认）/ full=追加记忆三区/队员/工具调用/数据面'),
  graph: z.object({
    stalledAfterMs: z.natural().min(1).default(600_000),
  }).description('graph 运行时：stalledAfterMs=run 停滞告警阈值（HUD 告警面扫描用，默认 10 分钟）'),
  codeIntel: z.object({
    astGrep: z.boolean().default(true),
    lspServers: z.dict(z.object({
      command: z.string(),
      args: z.array(z.string()).default([]),
      languages: z.array(z.string()).default([]),
      env: z.dict(z.string()).default({}),
    })).default({}),
  }).description('代码智能 MCP：astGrep=ast_grep_* 开关（@ast-grep/napi 缺席时工具显式报错）；'
    + 'lspServers=LSP 注册表，如 { typescript: { command: "typescript-language-server", args: ["--stdio"], languages: ["typescript"] } }'
    + '——语言服务器本体由用户环境提供，omd 只做进程管理（单实例/崩溃重启≤2/随 MCP server 退出回收）'),
})

// schemastery 无 zod 式 .parse()：schema 本身是可调用函数（Config(data) 即解析）。
// 此处附加 parse 别名以统一调用面（后续任务请用 Config.parse(data)，语义 = 直接调用）。
Config.parse = (data) => Config(data)

/** 角色→模型解析：roleOverrides > tiers；'inherit' → undefined。 */
export function resolveModel(config, role) {
  const v = config.roleOverrides[role.name] ?? config.tiers[role.tier]
  return v === 'inherit' ? undefined : v
}
