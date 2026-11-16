// lib/protocol.js
/** 静态协议段渲染（纯函数、同步、有界输出）。规格 §3/§4.4。 */
import { KEYWORD_REGISTRY, RETIRED_KEYWORDS, RETIRED_NOTE } from './keywords.js'
import { SIGNAL_FEATURES, TIER_BANDS } from './routing.js'

const FEATURE_TEXT = Object.entries(SIGNAL_FEATURES)
  .map(([k, vs]) => `${k}=${vs.join('/')}`).join('；')

export function renderProtocol({ config }) {
  const routeRows = KEYWORD_REGISTRY.map((e, i) =>
    `| ${i + 1} | ${e.target} | ${e.triggers.join('、')} | ${e.intent} |`).join('\n')

  return `# oh-my-dsh 编排协议（omd）

## 关键词路由表（命中即加载对应 skill 并立即开始；命中后第一步必须 omd_state_write 激活状态）
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

### 关键词 hook（原生拦截点）
- 命中时插件经宿主 agent/pre-step 确定性检测（零 LLM），预写模式状态并注入 \`[MAGIC KEYWORD: <mode>]\`；收到激活块即按块内 sessionId/mode/updatedAt 续写，首个 state_write 携 expectUpdatedAt=<注入块 updatedAt>
- 未命中零成本直通（无状态写、无注入）；代码块/行内代码/URL 内触发词由 hook 确定性免疫，其余守卫由模型执行

## 模式硬约束
- autopilot/ralph 只能在主会话直接启动（goal/ralph 工具拒绝 subagent 权限），禁止委派队员启动
- 模式互斥（MVP）：任一模式 active 时不得启动另一模式；启动前必读 state（omd_state_list_active）
- leaf-guard（机制强制）：插件已在子代理作用域经 tools.restrict 机械隐藏编排工具（omd_delegate/team 领队面/graph 运行控制）——队员模型面不可见，无需自觉；你若在主会话，请勿把编排工具转交队员语境
- ralph 前台阻塞主会话；运行期间不要在此会话安排其他工作

## 委派
- 角色名与摘要查 native catalog，档位上限取角色卡 tier。subagent 省略 model 即继承主会话（软路由）；omd_delegate 的 tier/model 经 spawn 硬路由并执行档位 clamp，不可用 id 派发前显式报错、不静默继承；workflow agent() 支持硬路由
- 跨会话项目记忆（按 projectPath 隔离）：omd_memory_set / omd_memory_get / omd_memory_delete / omd_memory_list；新会话先 list 再决定读取项

### c3 自适应路由（表上限钳制；派发前恰一次）
- 每次派发前恰一次静态评估 4 特征（零额外调用）：${FEATURE_TEXT}
- 建议档=特征贡献求和 0-${TIER_BANDS.lowMax}→low / ${TIER_BANDS.lowMax + 1}-${TIER_BANDS.mediumMax}→medium / ${TIER_BANDS.mediumMax + 1}-8→high；最终档=min(建议档, 角色卡 tier 上限)——表上限权威、只降不升、禁止运行中重路由
- 每次派发恰记一行 \`[routing] dispatch=<id>\` 日志（路由:派发=1:1）；表外角色落会话默认档 ${config.routing?.defaultTier ?? 'medium'}，且 fallback 审计记入权威 run-state（\`${config.stateDir ?? '.omd'}/state/run-state.json\`）

## deep-interview 配置（Config 键 deepInterview.*）
- 歧义度阈值 ${config.deepInterview.ambiguityThreshold}；软提醒 ${config.deepInterview.softWarningRounds} 轮；硬上限 ${config.deepInterview.maxRounds} 轮

## 状态契约（工具前缀 omd_；cwd/sessionId 自动从当前会话派生——仅多仓/worktree 锚需显式传 cwd）
- 模式启动：omd_state_write({ mode, state: { active: true, started_at, current_phase, prompt_echo } })
- 读取：omd_state_read({ mode })；跨会话活跃清单：omd_state_list_active()；聚合+stale：omd_state_get_status()
- 阶段转换：omd_state_write 更新 state.current_phase；每轮结束更新 state.iteration
- 完成/取消：omd_state_clear({ mode })；plans/prd/handoffs/checkpoints 保留供恢复
- 记忆：显式调用 omd_notepad_write_priority（永久）/ omd_notepad_write_working（7 天）
- update_goal 前必须先 get_goal 读取当前 goal_id 与 revision（二者是 update_goal 的必填参数）
- create_goal 必须设 max_goal_rounds（默认 ${config.autopilot.maxIterations}）
- autopilot 界限：QA 循环 ≤${config.autopilot.maxQaCycles}；同错误 3 次提前停；re-validation ≤${config.autopilot.maxValidationRounds} 轮
`
}
