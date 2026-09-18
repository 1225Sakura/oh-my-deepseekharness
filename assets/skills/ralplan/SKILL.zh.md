---
name: ralplan
description: 共识规划入口——在执行前自动拦截过于模糊的 ralph/autopilot/team 请求并转入共识规划
when-to-use: 用户说 "ralplan" 或想在执行前拿到共识精炼的计划；也是 ralph/autopilot/team 请求模糊到无法直接执行（无文件路径、符号、issue 号、可测试锚点）时的重定向目标。不适用于已经具体、可直接执行的请求。
---

# ralplan（共识规划别名）

ralplan 是 `plan --consensus` 的快捷入口：以 **RALPLAN-DR 结构化审议**（默认 short 模式，高风险工作用 deliberate 模式）跑 Planner → Architect → Critic 迭代循环，直到达成共识。

## 用法

```
ralplan "任务描述"
ralplan --interactive "任务描述"
```

## 参数

- `--interactive`：在两个关键决策点向用户提问（第 2 步草稿评审、第 6 步最终批准）。不带该参数则全流程自动——Planner → Architect → Critic 循环——最终计划标记 `pending approval`、输出后即停，不提问也不执行。
- `--deliberate`：高风险工作强制 deliberate 模式——增加 pre-mortem（3 个失败场景）与扩展测试计划（unit/integration/e2e/observability）。不带该参数时，请求显式含高风险信号（auth/安全、数据迁移、破坏性/不可逆变更、生产事故、合规/PII、公共 API 破坏）也会自动启用。
- `--architect <provider>` / `--critic <provider>`：OMC 可把这两步外包给外部 CLI。omd 不依赖外部 CLI（规格依赖边界），这两个参数为兼容而接受，实际回落到默认角色卡流程并附一行说明。

## 规划/执行边界

ralplan 是规划模块。它可以查看上下文、起草或更新计划产物，但除非用户在当轮或结构化批准 UI 中显式同意执行，产物必须标记 `pending approval`。显式执行批准之前，它**不得**运行改动型 shell 命令、编辑源码、commit、push、开 PR、调用执行技能或委派实现任务。

## 角色映射（omd MVP 名册）

OMC 的 Architect/Critic 环节映射到 omd MVP 名册：

| 环节 | omd 角色卡 | 委派 prompt 注入的立场 |
|---|---|---|
| Planner | `omd-agent-planner`（high） | 计划撰写 + RALPLAN-DR 摘要 |
| Architect | `omd-agent-planner`（high） | 架构健全性评审，steelman 反方论证 |
| Critic | `omd-agent-analyst`（high） | 质量/可测试性评估，裁决 APPROVE/ITERATE/REJECT |

每个环节用 `subagent` 派出（先用 `skill` 工具加载角色卡）。两个评审环节拿到**同一份固定计划快照**，**严格串行**执行。

## 共识流程

1. **Planner** 产出初始计划与精简的 **RALPLAN-DR 摘要**（评审之前）：
   - Principles（3–5 条）
   - Decision Drivers（前 3）
   - Viable Options（≥2），各有边界清晰的 pros/cons；只剩一个可行项时，对被否选项给出显式排除理由
   - 仅 deliberate 模式：pre-mortem（3 个失败场景）+ 扩展测试计划（unit/integration/e2e/observability）
2. **用户反馈**（*仅 --interactive*）：用 `ask_user_question` 呈现草稿计划 + Principles/Drivers/Options 摘要——进入评审 / 要求修改 / 跳过评审。否则自动进入评审。
3. **Architect** 评审固定快照的架构健全性：最强的 steelman 反方论证、至少一个真实取舍张力、（尽量）综合路径；deliberate 模式还要显式标记 principle 违反。**等它完成再进第 4 步。** Architect 的产出**不得**传给 Critic。
4. **Critic** 独立评估同一固定快照——第 3 步完成后才发出的、单独等待的 `subagent` 调用：principle 与 option 一致性、备选公平性、风险缓解清晰度、验收标准可测试性、验证步骤具体性。deliberate 模式：缺失/薄弱的 pre-mortem 或扩展测试计划**必须**拒。

   > **同一固定快照的独立串行评审。** Architect 与 Critic 绝不并行；两方都不改快照；结果只由 Planner 在两份评审都完成后综合进修订。
5. **复审循环（最多 5 轮）**：Critic 任何非 `APPROVE` 裁决都跑完整闭环——Planner 综合两份评审 → 修订 → Architect → Critic → 重复。5 轮仍未 `APPROVE`，把最佳版本交给用户并注明未达共识。
6. Critic 批准后，计划标记 `pending approval`（除非执行已被显式批准）。*仅 --interactive*：用 `ask_user_question` 呈现：批准经 team 执行（推荐）/ 批准经 ralph 执行 / 先压缩上下文再回来批准 / 要求修改 / 否决。否则输出计划即停。
7. *仅 --interactive*：批准后经 `skill` 工具调用 `team` 技能（并行执行，推荐）或 `ralph` 技能（带验证的顺序执行）——绝不直接实现。

## 产出

共识计划写入 **`.omd/plans/ralplan-<slug>.md`**，必须包含：

- RALPLAN-DR 摘要（Principles、Decision Drivers、Options）
- ADR：Decision、Drivers、Alternatives considered、Why chosen、Consequences、Follow-ups
- 可测试的验收标准与带文件引用的实现步骤
- 一小节 changelog：哪些评审改进被采纳
- `Status: pending approval`，直到用户显式批准执行

## 执行前门禁（Pre-Execution Gate）

### 门禁为什么存在

执行模式（ralph、autopilot、team）会拉起重型编排。拿 "ralph improve the app" 这种请求直接启动，代理们会把本该在规划期做的范围摸底烧在执行期。ralplan-first 门禁拦截欠规格的执行请求，转入共识规划，保证：明确的范围、可测试的验收标准、三方共识、不浪费执行。

### 好提示 vs 坏提示

**过闸**（具体到可直接执行）：
- `ralph fix the null check in src/hooks/bridge.ts:326`
- `autopilot implement issue #42`
- `team add validation to function processKeywordDetector`
- `ralph do:\n1. Add input validation\n2. Write tests\n3. Update README`

**被拦——重定向到 ralplan：**
- `ralph fix this` / `autopilot build the app` / `team improve performance` / `ralph add authentication`

**绕行：** `force: ralph refactor the auth module` 或 `! autopilot optimize everything`。

### 门禁何时不触发

任一具体信号即可过闸（不需要全部）：

| 信号 | 示例 |
|---|---|
| 文件路径 | `ralph fix src/hooks/bridge.ts` |
| issue/PR 号 | `ralph implement #42` |
| camelCase / PascalCase / snake_case 符号 | `ralph fix processKeywordDetector`、`team fix user_model` |
| 测试命令 | `ralph npm test && fix failures` |
| 编号步骤 | `ralph do:\n1. Add X\n2. Test Y` |
| 验收标准 | `ralph add login - acceptance criteria: …` |
| 错误引用 | `ralph fix TypeError in auth` |
| 代码块 | `ralph add: ```ts … ``` ` |
| 逃逸前缀 | `force:` 或 `!` |

### 端到端示例

1. 用户：`ralph add user authentication`
2. 门禁：执行关键词 + 欠规格提示 → 附说明重定向到 ralplan
3. 共识运行：Planner 规划（改哪些文件、用什么 auth 方案、写什么测试）→ Architect 评审 → Critic 验证
4. 批准后用户选 team（并行，推荐）或 ralph（顺序 + 验证）
5. 执行从清晰、有边界的计划开始

### 排障

| 问题 | 解法 |
|---|---|
| 门禁误伤具体请求 | 加锚点：文件引用、函数名或 issue 号 |
| 想绕过门禁 | 加 `force:` 或 `!` 前缀 |
| 模糊请求没被拦 | 门禁只抓短且无具体锚点的提示；补细节或显式调 `ralplan` |
| 被重定向但想直接执行 | 用结构化批准选项或显式点名执行技能；光说 "just do it" 只会让规划以 `pending approval` 产物收尾 |

## 状态契约

**调用形状约定**：`cwd`（当前工作区路径）与 `sessionId`（当前会话 id）是每个 `state_*` 调用的**必填顶层参数**；模式字段嵌套在 `state` 键下。

- **开始**：第 1 步之前 `mcp__omd-state__state_write({ cwd, sessionId, mode: "ralplan", state: { active: true, started_at: <ISO 8601>, current_phase: "consensus" } })`。
- **交接给已批准的执行模式**（team/ralph）：`state_write({ cwd, sessionId, mode: "ralplan", state: { active: false } })`——置为不活跃，**不** clear；计划路径保持可引用。
- **真正终态退出**（否决、非交互输出、中止）：`state_clear({ cwd, sessionId, mode: "ralplan" })`。
- 中间节点（Critic 批准、达到 5 轮上限）**绝不** clear——用户仍可能要求修改。
- `.omd/plans/` 下的共识计划任何路径都不删除。
- **MCP server 不可用**：用普通文件工具对 `.omd/` 做同样读写，并显式说明。
