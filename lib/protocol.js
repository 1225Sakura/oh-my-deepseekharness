// lib/protocol.js
/** 静态协议段渲染（纯函数、同步、有界输出）。规格 §3/§4.4。 */
import { KEYWORD_REGISTRY, RETIRED_KEYWORDS, RETIRED_NOTE } from './keywords.js'
import { resolveModel } from './config.js'
import { SIGNAL_FEATURES, TIER_BANDS } from './routing.js'

const FEATURE_TEXT = Object.entries(SIGNAL_FEATURES)
  .map(([k, vs]) => `${k}=${vs.join('/')}`).join('；')

export function renderProtocol({ config, probeReport, roles }) {
  const routeRows = KEYWORD_REGISTRY.map((e, i) =>
    `| ${i + 1} | ${e.target} | ${e.triggers.join('、')} | ${e.intent} |`).join('\n')
  const roleRows = roles.map(r => {
    const m = resolveModel(config, r)
    return `| ${r.name} | ${r.tier} | ${m ?? 'inherit（继承主会话）'} |`
  }).join('\n')
  const probeRows = Object.entries(probeReport)
    // 终审修复 #6：mcpServer 的 ok 渲染为 mounted——failOnStartupError:false 时
    // 挂载成功不代表 server 真起来了（真实冒烟在 omd-doctor）。
    .map(([k, v]) => `| ${k} | ${k === 'mcpServer' && v.status === 'ok' ? 'mounted' : v.status} |`).join('\n')

  return `# oh-my-dsh 编排协议（omd）

## 关键词路由表（命中即加载对应 skill 并立即开始；命中后第一步必须 mcp__omd-state__state_write 激活状态）
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

### 关键词 hook（原生拦截点，M3 c2）
- 命中时 omd 插件经宿主 agent/pre-step 拦截点做确定性检测（零 LLM）：预写该模式状态并注入 \`[MAGIC KEYWORD: <mode>]\` 激活块——收到该块即视为路由已触发，按块内 sessionId/mode/updatedAt 续写状态（首个 state_write 携 expectUpdatedAt=<注入块 updatedAt>），无需从零激活
- 未命中 prompt 零成本直通（无状态写、无注入）；代码块/行内代码/URL 内触发词在 hook 侧确定性免疫，其余守卫语义仍由上表模型层执行

## 模式硬约束
- autopilot/ralph 只能在主会话直接启动（goal/ralph 工具拒绝 subagent 权限），禁止委派队员启动
- 模式互斥（MVP）：任一模式 active 时不得启动另一模式；启动前必读 state（mcp__omd-state__state_list_active）
- leaf-guard：队员（subagent）禁止再 spawn 孙代理、禁止使用编排工具
- ralph 前台阻塞主会话；运行期间不要在此会话安排其他工作

## 模型路由表（当前生效；委派照此填 workflow agent() 的 provider/model 参数）
| 角色 | 档位 | 模型 |
|---|---|---|
${roleRows}

- subagent 工具无 model 参数 = 强制继承主会话（omd 软路由如实告知）；omd_delegate 工具=硬路由：tier/model 参数经 spawn 路径派发，档位映射受上表钳制、不可用 id 派发前显式报错不静默继承；workflow agent() 支持硬路由
- 档位值 "inherit" 表示继承主会话

### c3 自适应路由（表上限钳制；派发前恰一次）
- 每次派发前恰一次静态评估 4 特征（零额外调用）：${FEATURE_TEXT}
- 建议档=特征贡献求和 0-${TIER_BANDS.lowMax}→low / ${TIER_BANDS.lowMax + 1}-${TIER_BANDS.mediumMax}→medium / ${TIER_BANDS.mediumMax + 1}-8→high；最终档=min(建议档, 上表该角色档位)——表上限权威、只降不升、禁止运行中重路由
- 每次派发恰记一行 \`[routing] dispatch=<id>\` 日志（路由:派发=1:1）；表外角色落会话默认档 ${config.routing?.defaultTier ?? 'medium'}，且 run-state.json 记 fallback:true（可审计）

### c5 team worktree 隔离（每运行一树；两阶段拆除；孤儿绝不自动删）
- 队长 run 启动 → \`${config.stateDir ?? '.omd'}/worktrees/{run-id}\`（gitignored，从当前 HEAD worktree add），启动时先扫孤儿：run-state 非终态且无活跃会话 → 只提示处置，**绝不自动删**
- 两阶段拆除：verify 通过 → run-state 先 CAS 写 disposed 终态 → 再删树（终态时间戳必须早于删树时间；CAS 不成功绝不删树）
- 用户取消：删树前先列树内与 HEAD 差异文件（只提示不阻塞）

### c6 run-state 镜像契约（七字段快照 CAS；队长独占写）
- run-state.json 权威=\`${config.stateDir ?? '.omd'}/state/run-state.json\`，七字段镜像：mode/round/current_story/active_agents/todo（计数+首条标题）+version+updatedAt；version 1 起步每写 +1
- **队长独占写**（队员只读）；两写时机：阶段边界（run 启动/拆除）+ 派发前（与 c3 routeOnce 同临界区：先路由判定 → 快照写 → 再派发）
- expectUpdatedAt 冲突：重读最新值重试 ≤3 次；预算耗尽以最新读值覆盖写 + warning 日志行（全程 version 严格 +1）

### c8 多仓锚定（树内懒建；豁免向上 marker 解析；残渣随树丢弃）
- 运行树内写 omd 状态 → 树内 \`${config.stateDir ?? '.omd'}/\` **首次写才懒创建**，父仓状态树零新增写入（不外溢；父仓 .omd 基线 hash 前后一致）
- run-state 命名空间树内解析**豁免向上 marker**：父级 .omd / .omd-workspace 锚不截胡树内状态（树内自建，树内 .omd 尚未懒建也锚树内，绝不回落父仓）
- run-state.json 权威=主仓，树内只读参考；树拆除（c5 两阶段）→ 树内 .omd 残渣随树丢弃
- 纯多仓（非 run-tree）场景语义留执行期按 spec OQ 处理；树外状态写显式拒绝

## 能力矩阵（probe 实测；标注降级）
| 探测项 | 状态 |
|---|---|
${probeRows}

- 注：goal/ralph/subagent/workflow/ask_user_question 等宿主工具的可用性未探测，以实际调用结果为准

## deep-interview 配置（当前生效；Config 键 deepInterview.*）
- 歧义度阈值 ${config.deepInterview.ambiguityThreshold}；软提醒 ${config.deepInterview.softWarningRounds} 轮；硬上限 ${config.deepInterview.maxRounds} 轮

## 状态契约（MCP 工具经 mcp__omd-state__ 前缀调用；cwd=当前工作区绝对路径，sessionId=当前会话 id）
- 模式启动：mcp__omd-state__state_write({ cwd, sessionId, mode, state: { active: true, started_at, current_phase, prompt_echo } })
- 读取：mcp__omd-state__state_read({ cwd, sessionId, mode })；跨会话活跃清单：mcp__omd-state__state_list_active({ cwd })
- 阶段转换：state_write 更新 state.current_phase；每轮结束更新 state.iteration
- 完成/取消：mcp__omd-state__state_clear({ cwd, sessionId, mode })；plans/prd/handoffs/checkpoints 保留供恢复
- 记忆：显式调用 mcp__omd-state__notepad_write_priority（永久）/ mcp__omd-state__notepad_write_working（7 天）
- update_goal 前必须先 get_goal 读取当前 goal_id 与 revision（二者是 update_goal 的必填参数）
- create_goal 必须设 max_goal_rounds（默认 ${config.autopilot.maxIterations}）
- autopilot 界限：QA 循环 ≤${config.autopilot.maxQaCycles}；同错误 3 次提前停；re-validation ≤${config.autopilot.maxValidationRounds} 轮
`
}
