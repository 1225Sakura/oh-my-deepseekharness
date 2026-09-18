// lib/protocol.js
/** 静态协议段渲染（纯函数、同步、有界输出）。规格 §3/§4.4。 */
import { KEYWORD_REGISTRY, RETIRED_KEYWORDS, RETIRED_NOTE } from './keywords.js'
import { resolveModel } from './config.js'

export function renderProtocol({ config, probeReport, roles }) {
  const routeRows = KEYWORD_REGISTRY.map((e, i) =>
    `| ${i + 1} | ${e.target} | ${e.triggers.join('、')} | ${e.intent} |`).join('\n')
  const roleRows = roles.map(r => {
    const m = resolveModel(config, r)
    return `| ${r.name} | ${r.tier} | ${m ?? 'inherit（继承主会话）'} |`
  }).join('\n')
  const probeRows = Object.entries(probeReport)
    .map(([k, v]) => `| ${k} | ${v.status} |`).join('\n')

  return `# oh-my-dsh 编排协议（omd）

## 关键词路由表（命中即加载对应 skill 并立即开始；命中后第一步必须 state_write 激活状态）
| 优先级 | 模式 | 触发词 | 意图要求 |
|---|---|---|---|
${routeRows}

### 触发守卫（防误触发，必须遵守）
- 仅当触发词是明确的执行指令时才激活；"什么是/怎么用/如何使用/how to use" 等解释性提及**不激活**
- 引号内、代码块内、URL/文件路径内的触发词不激活
- 粘贴的模式回显块（如 \`[RALPH LOOP - ITERATION N]\`）**不激活**（防自激）
- team 无关键词触发，只能显式调用（"用 team 做…"）；队员会话内整个关键词路由失效
- 退役词 ${RETIRED_KEYWORDS.join('/')}：不触发，告知用户——${RETIRED_NOTE}
- 多关键词命中：按优先级顺序全部执行

## 模式硬约束
- autopilot/ralph 只能在主会话直接启动（goal/ralph 工具拒绝 subagent 权限），禁止委派队员启动
- 模式互斥（MVP）：任一模式 active 时不得启动另一模式；启动前必读 state（state_list_active）
- leaf-guard：队员（subagent）禁止再 spawn 孙代理、禁止使用编排工具
- ralph 前台阻塞主会话；运行期间不要在此会话安排其他工作

## 模型路由表（当前生效；委派照此填 workflow agent() 的 provider/model 参数）
| 角色 | 档位 | 模型 |
|---|---|---|
${roleRows}

- subagent 工具无 model 参数 = 强制继承主会话（omd 软路由如实告知）；workflow agent() 支持硬路由
- 档位值 "inherit" 表示继承主会话

## 能力矩阵（probe 实测；标注降级）
| 探测项 | 状态 |
|---|---|
${probeRows}

## 状态契约
- 模式启动：state_write({mode}-state.json, {active:true, started_at, current_phase, prompt_echo})
- 阶段转换：state_write 更新 current_phase；每轮结束更新 iteration
- 完成/取消：state_clear；plans/prd/handoffs/checkpoints 保留供恢复
- 记忆：显式调用 notepad_write_priority（永久）/ notepad_write_working（7 天）
- create_goal 必须设 max_goal_rounds（默认 ${config.autopilot.maxIterations}）
- autopilot 界限：QA 循环 ≤${config.autopilot.maxQaCycles}；同错误 3 次提前停；re-validation ≤${config.autopilot.maxValidationRounds} 轮
`
}
