// lib/config.js
import z from '@deepseek-ai/schemastery'

export const Config = z.object({
  language: z.union([z.const('zh'), z.const('en'), z.const('both')]).default('zh')
    .description('资产语言：zh 中文 / en 英文 / both 中文正文+英文术语'),
  tiers: z.object({
    low: z.string().default('glm-5.3-flash'),
    medium: z.string().default('glm-5.3-flash'),
    high: z.string().default('glm-5.3-flash'),
  }).description('档位→模型映射；值可为模型标识或 "inherit"（继承主会话）。'
    + '默认值对齐部署 LLM 服务（S1 差分证据：glm-5.3-flash 可解析、deepseek-* 不可解析）；'
    + '不可用 id 由 omd_delegate 派发前校验显式报错，不静默继承'),
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
  }),
  // 终审修复 #3：deep-interview skill 引用的配置键（源 OMC 读 .claude/settings.json 的
  // omc.deepInterview.*）——模型运行时无法读插件 Config，由 protocol.js 渲染进协议段。
  deepInterview: z.object({
    ambiguityThreshold: z.number().default(0.2),
    maxRounds: z.natural().min(1).default(20),
    softWarningRounds: z.natural().min(1).default(10),
  }),
  team: z.object({
    heartbeatIntervalMs: z.natural().default(60_000),
    staleAfterMs: z.natural().min(1).default(300_000),
  }).description('team 运行时心跳：heartbeatIntervalMs=周期检测间隔（0=关闭定时器，'
    + '领队仍可用 team_heartbeat_scan 按需扫描）；staleAfterMs=队员无心跳 stale 阈值'),
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
