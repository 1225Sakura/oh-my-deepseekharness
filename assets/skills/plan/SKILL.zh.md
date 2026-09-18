---
name: plan
description: 战略规划——可选访谈流程与共识模式
when-to-use: 用户想先规划再动手（"plan this"、"做个计划"）、想为模糊想法做结构化需求采集、想评审已有计划（"--review"）、或想要多视角共识（"--consensus" / ralplan）。不适用于：自治端到端执行（autopilot）、任务明确想立刻写码（ralph / executor）、能直接回答的简单问题。
---

# plan（规划）

<Purpose>
plan 通过智能交互产出全面、可执行的工作计划：按请求具体度自动选择访谈（宽泛请求）或直接规划（详细请求）；支持共识模式（Planner/Architect/Critic 迭代循环 + RALPLAN-DR 结构化审议）与评审模式（Critic 评估已有计划）。
</Purpose>

<执行策略>
- 按请求具体度自动选择访谈或直接模式。
- 访谈中一次只问一个问题——绝不打包。
- 代码库事实先派 `omd-agent-explore` 角色查（`skill` 加载角色卡，`subagent` 派出），查完再问用户。
- 质量线：80%+ 论断引用文件/行号；90%+ 验收标准可测试。
- 共识模式默认全自动；`--interactive` 在草稿评审与最终批准处加用户门禁。
- 共识默认 RALPLAN-DR short 模式；`--deliberate` 或显式高风险信号（auth/安全、数据迁移、破坏性/不可逆变更、生产事故、合规/PII、公共 API 破坏）切 deliberate 模式。
- **规划/执行边界**：规划模式只看上下文、只产计划/规格产物。除非用户在当轮或结构化批准 UI 显式同意执行，产物标记 `pending approval`。批准之前：不跑改动型 shell 命令、不改源码、不 commit/push/开 PR、不调用执行技能、不委派实现任务。
- **模式选型**：计划涉及 omd 执行模式对比（autopilot goal 循环、ralph fresh-agent 循环、team 流水线）时，为工作指定唯一的主循环权威，并遵循协议层的模式互斥契约（MVP：模式不并存）。
</执行策略>

<步骤>

## 模式选择

| 模式 | 触发 | 行为 |
|---|---|---|
| Interview | 宽泛请求默认 | 交互式需求采集 |
| Direct | `--direct` 或详细请求 | 跳过访谈，直接出计划 |
| Consensus | `--consensus`、"ralplan" | Planner → Architect → Critic 循环 + RALPLAN-DR；`--interactive` 加用户门禁 |
| Review | `--review`、"review this plan" | Critic 评估已有计划 |

## Interview 模式（宽泛/模糊请求）

1. **分类请求**：动词模糊、无具体文件、触及 3+ 领域 → 访谈模式。
2. **一次一个聚焦问题**，用 `ask_user_question`（偏好、范围、约束）。
3. **先查代码库事实**：问 "你的代码用什么模式？" 之前先派 `omd-agent-explore`，再引用它的发现问知情的跟进问题。
4. **层层递进**——每个问题建立在上一答之上。
5. 非平凡范围**咨询 `omd-agent-analyst`**（high 档）挖隐藏需求、边界情况与风险。
6. 用户示意就绪时（"出计划吧"、"我准备好了"）**生成计划**。

## Direct 模式（详细请求）

1. 可选的简短 `omd-agent-analyst` 咨询。
2. 立即生成完整工作计划。
3. 可选 Critic 评审。

## Consensus 模式（`--consensus` / "ralplan"）

该模式流程完全等同于 `ralplan` 技能文档：RALPLAN-DR 摘要、同一固定快照的 Architect/Critic 独立串行评审（Architect → 等待 → Critic，绝不并行，Architect 产出不传 Critic，仅 Planner 综合）、最多 5 轮复审、最终 ADR、`--interactive` 批准门禁。完整契约见 `ralplan` 技能；其状态生命周期规则同样适用于此（下方状态契约已复述）。

## Review 模式（`--review`）

1. 从 `.omd/plans/` 读计划文件。
2. 跑 Critic 评审（`omd-agent-analyst` 角色卡 + critic 立场，`subagent` 派出）。
3. 返回裁决：APPROVED、REVISE（附具体反馈）、REJECT（需要重新规划）。

## 计划输出格式

每份计划包含：

- Requirements Summary
- Acceptance Criteria（可测试）
- Implementation Steps（带文件引用）
- Risks and Mitigations
- Verification Steps
- 仅共识/ralplan：**RALPLAN-DR 摘要**（Principles、Decision Drivers、Options）
- 仅共识/ralplan 最终输出：**ADR**（Decision、Drivers、Alternatives considered、Why chosen、Consequences、Follow-ups）
- 仅 deliberate 共识：**Pre-mortem（3 个场景）** + **扩展测试计划**（unit/integration/e2e/observability）

计划存 **`.omd/plans/`**（共识计划为 `ralplan-<slug>.md`）；未完成草稿也放这里，标记 `Status: draft`。

</步骤>

<工具用法>
- 偏好类问题（范围、优先级、风险承受度）用 `ask_user_question`；需要具体值（名称、端口、澄清）才用纯文本。
- 代码库事实先派 `omd-agent-explore`（low 档，`subagent`）。
- 大范围规划验证用 `omd-agent-planner`；需求分析与 Critic 环节用 `omd-agent-analyst`。
- **关键——共识环节串行，绝不并行。** Architect 子代理结果到手才发 Critic 子代理；两方评同一固定快照；结果只在两份评审完成后由 Planner 综合。
- `--interactive` 共识中批准问题一律走 `ask_user_question`——不用纯文本。非交互：计划标记 `pending approval`、输出即停。
- 显式批准后经 `skill` 工具调用 `team` 或 `ralph` 技能——规划模块绝不直接实现。
</工具用法>

<示例>
好——先查证再提问：
```
[派 omd-agent-explore："找 authentication 实现"]
[收到："Auth 在 src/auth/，JWT + passport.js"]
"我看到 src/auth/ 里是 JWT + passport.js。这个新功能沿用现有 auth 还是另起一条认证流？"
```
好——一次一问，层层递进：
```
Q1 "主要目标是什么？" → A1 "提升性能"
Q2 "延迟还是吞吐？" → A2 "延迟"
Q3 "优化 p50 还是 p99？" → …
```
坏——问代码已能回答的事（"auth 实现在哪？"）；一条消息塞三个问题；一次摆出四个设计方案（决策疲劳——一次给一个带取舍的选项，拿到反应再给下一个）。
</示例>

<升级与停止条件>
- 需求够清晰就停止访谈——不过度访谈。
- 共识模式 5 轮后停，呈现最佳版本；state 只在用户最终选择或非交互输出时清理，循环中绝不清。
- 用户说 "just do it" / "skip planning" 但没点名执行路径：以 `pending approval` 产物收尾并经结构化 UI 请求显式执行批准——不调用执行技能、不改文件。
- 不可调和的取舍需要业务决策时升级给用户。
</升级与停止条件>

<收尾清单>
- [ ] 90%+ 验收标准具体可测；80%+ 论断引用文件/行号
- [ ] 每个风险有缓解；无度量不放量词（"fast" → "p99 < 200ms"）
- [ ] 计划存入 `.omd/plans/`
- [ ] 共识：RALPLAN-DR 摘要含 3–5 条 principles、前 3 drivers、≥2 个 options（或排除理由）
- [ ] 共识最终输出：含 ADR 段
- [ ] deliberate：含 pre-mortem（3 场景）+ 扩展测试计划
- [ ] `--interactive`：执行前有显式用户批准；非交互：仅输出 `pending approval`，不自动执行
- [ ] 每条退出路径都停用 ralplan state——执行交接用 `state_write({ cwd, sessionId, mode: "ralplan", state: { active: false } })`，终态退出用 `state_clear({ cwd, sessionId, mode: "ralplan" })`
</收尾清单>

## 状态契约

**调用形状约定**：`cwd`（当前工作区路径）与 `sessionId`（当前会话 id）是每个 `state_*` 调用的**必填顶层参数**；模式字段嵌套在 `state` 键下。

- Interview / Direct / Review 模式是轻量流程：**不持模式状态**——只有 `.omd/plans/` 下的计划产物。
- Consensus 模式持有 `ralplan` 模式状态（与 `ralplan` 技能共享）：
  - **进入**：首个 Planner 环节之前 `state_write({ cwd, sessionId, mode: "ralplan", state: { active: true, started_at: <ISO 8601>, current_phase: "consensus" } })`。
  - **交接给已批准执行**（team/ralph）：`state_write({ cwd, sessionId, mode: "ralplan", state: { active: false } })`——置不活跃，**不** clear。
  - **终态退出**（否决、非交互输出、出错）：`state_clear({ cwd, sessionId, mode: "ralplan" })`。
  - 循环中间（Critic 批准、达到 5 轮上限）绝不 clear。
- **异常退出**：状态与计划留盘；恢复时先读状态再继续循环。
- **MCP server 不可用**：用普通文件工具对 `.omd/` 做同样读写，并显式说明。
