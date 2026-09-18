// lib/config.js
import z from '@deepseek-ai/schemastery'

export const Config = z.object({
  language: z.union([z.const('zh'), z.const('en'), z.const('both')]).default('zh')
    .description('资产语言：zh 中文 / en 英文 / both 中文正文+英文术语'),
  tiers: z.object({
    low: z.string().default('deepseek-chat'),
    medium: z.string().default('deepseek-chat'),
    high: z.string().default('deepseek-reasoner'),
  }).description('档位→模型映射；值可为模型标识或 "inherit"（继承主会话）'),
  roleOverrides: z.dict(z.string()).default({})
    .description('角色级覆盖，如 { "omd-agent-code-reviewer": "provider/model" }'),
  stateDir: z.string().default('.omd').description('项目状态目录名'),
  autopilot: z.object({
    maxIterations: z.natural().min(1).default(10),
    maxQaCycles: z.natural().min(1).default(5),
    maxValidationRounds: z.natural().min(1).default(3),
  }),
})

// schemastery 无 zod 式 .parse()：schema 本身是可调用函数（Config(data) 即解析）。
// 此处附加 parse 别名以统一调用面（后续任务请用 Config.parse(data)，语义 = 直接调用）。
Config.parse = (data) => Config(data)

/** 角色→模型解析：roleOverrides > tiers；'inherit' → undefined。 */
export function resolveModel(config, role) {
  const v = config.roleOverrides[role.name] ?? config.tiers[role.tier]
  return v === 'inherit' ? undefined : v
}
