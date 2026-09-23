---
name: autopilot
description: 从一句话想法到验证通过的可用代码的全自治流水线，基于 dsh 原生 goal 续跑机制驱动
when-to-use: 用户想要从想法到可用代码的端到端全自治执行（"autopilot"、"full auto"、"帮我做一个…"）；任务跨越规划、实现、QA、验证多个阶段。 quick fix、头脑风暴、单一聚焦改动不要用本模式。
---

# autopilot

<Purpose>
autopilot 接收两三行的想法，自治地跑完整生命周期：需求扩写、规划、并行实现、QA 循环、双评审门验证，最终交付验证通过的可用代码。在 omd 中它跑在 dsh 原生 goal 续跑机制（`create_goal` / `update_goal`）之上，而不是 Stop hook。本文档是按 omd 设计规格对 OMC autopilot skill 的重写——与 OMC 原文不一致时，以本文档为准。
</Purpose>

<Hard_Constraints>
- **只能主会话启动。** `create_goal` 拒绝 subagent 权限——autopilot 只能由 direct human 在主会话直接启动，禁止把模式启动委派给队员。
- **MVP 模式互斥。** 启动前必读状态（按模式 `mcp__omd-state__state_read({ cwd, sessionId, mode })`，或用 `mcp__omd-state__state_list_active({ cwd })` 拿跨会话视图）。任一模式 active 时拒绝启动并如实报告，不得嵌套。
- **无证据不完成。** 任何"完成"声明必须附新鲜验证命令的原始输出。
</Hard_Constraints>

<Pipeline>
五个阶段：**Expansion → Planning → Execution → QA → Validation**。阶段之间严格串行；并行只发生在阶段内部（Execution 与 Validation）。
</Pipeline>

## Phase 0 — Expansion（扩写）

入口检查，按此顺序（衔接条款）：

1. **检测到 ralplan 共识计划**（`.omd/plans/ralplan-*.md`）：**同时跳过 Phase 0 和 Phase 1**——该计划已通过需求与架构双重校验。直接带着它进 Phase 2（Execution）。
2. **检测到 deep-interview 产出**（`.omd/specs/deep-interview-*.md`）：跳过扩写动作本身，把这份预校验规格直接当作 Phase 0 产出，继续进 Phase 1（Planning）。
3. **输入模糊**（没有文件路径、函数名或任何具体锚点）：先用 `ask_user_question` 主动提议重定向到 `deep-interview` skill——例如"先跑 deep-interview（推荐）" vs "直接扩写"。
4. **否则**：自行扩写。用 `ask_user_question` 澄清少数几个会实质改变构建方向的决策点（范围、技术栈、接口形态）——1–3 个聚焦问题，每个 2–4 个选项。

产出：规格写入 `.omd/plans/<topic>.md`（`<topic>` = 从任务提炼的小写 slug）。

## Phase 1 — Planning（规划）

Phase 0 检测到 ralplan 共识计划时本阶段跳过。

从规格推导实现计划：拆成相互独立、文件级边界清晰的任务，每个任务带自己的验证命令；按依赖排序。计划追加进 `.omd/plans/<topic>.md`。计划较复杂时可委派：先用 `skill` 工具加载 `omd-agent-planner` 角色卡，再经 `subagent` spawn。

## 启动阈值与 goal 创建

- **阈值**：整个任务单轮能做完的，直接做——**不开 goal**。
- 否则，进 Execution 之前：
  ```
  create_goal(objective = <规格摘要 + 完成判据>, max_goal_rounds = <上限>)
  ```
  `max_goal_rounds` **必须设置**——协议默认 **10**（配置项 `autopilot.maxIterations`）。不设轮次上限的 goal 是协议违规。

## Phase 2 — Execution（goal 循环体）

每一轮 goal：

1. `todo_write` —— 照计划刷新任务列表；每条工作流同一时刻只有一个 in_progress。
2. 背景委派实现：加载 `omd-agent-executor` 角色卡，对相互独立的任务并行 spawn `subagent`（默认即背景运行）。不重复委派已在跑的工作。
3. 每个任务的验证命令由你亲自运行；读过原始输出后才准在 `todo_write` 里标 completed。
4. 更新状态（见文末状态契约）：`current_phase: "execution"` + 进度字段，然后结束本轮——goal 机制会自动续跑，直到完成或触限。

## Phase 3 — QA

循环 build → lint → test → fix 直到全绿：

- 最多 **5 个 QA 循环**（配置项 `autopilot.maxQaCycles`，默认 5）。
- **同一错误重复 3 次**即提前停——这说明存在根本性问题。带着错误模式报告并升级给用户，不再空转。
- 只有带着新鲜、通过的验证输出才准离开 QA。

## Phase 4 — Validation（双评审门）

并行 spawn 两名独立评审——各自独立的 subagent 上下文，绝不在作者上下文里自审自批：

1. `omd-agent-verifier` —— 对照规格/计划逐条验证，跑命令、读输出，以新鲜证据为准。
2. `omd-agent-code-reviewer` —— 逻辑缺陷、可维护性、反模式、风格。

**两个都批准才算过。** 被拒：修复后由提出拒绝的评审 re-validate。

- **re-validation 上限 3 轮**（配置项 `autopilot.maxValidationRounds`，默认 3）。
- **安全相关变更升级深度**：追加显式安全评审（认证、加密、信任边界、注入面），并使用可用的最深评审强度。
- 双评审都通过后：先过**收尾沉淀检查点**（见下），再 `update_goal(action="complete")`，再按状态契约清理。

## 收尾沉淀检查点（显式记忆沉淀——替代 OMC hook 自动 learner）

dsh 没有 session-end hook，记忆沉淀不会自动发生。autopilot 在 `update_goal(action="complete")` **之前**必须显式执行一次沉淀检查（remember skill 的收尾形态）：

1. **耐久项目事实**（架构决定、环境坑、操作者偏好）→ `omd_memory_set({ projectPath, key, value })`。
2. **可复利知识**（排障结论、可复用模式）→ wiki add（见 wiki skill）；至少是 notepad priority。
3. **暂态进度** → 不沉淀（随状态清理蒸发）。
4. 没有值得沉淀的内容时显式说一句「无沉淀项」——**不许静默跳过**。

## 数值界限（硬上限）

| 界限 | 数值 | 超限后果 |
|---|---|---|
| goal 轮次 | `max_goal_rounds`（默认 10） | 循环停止；报告进度与剩余工作 |
| QA 循环 | ≤ 5（`maxQaCycles`） | 停止，带错误模式升级 |
| 同一错误重复 | 3 次 | 提前停——根本性问题 |
| re-validation | ≤ 3 轮（`maxValidationRounds`） | `update_goal(action="blocked", blocked_reason=<具体条件 + 证据>)` |

## 取消与恢复

- **取消**（`/omd-cancel` 或用户说停）：`update_goal(action="pause")` + `mcp__omd-state__state_clear({ cwd, sessionId, mode: "autopilot" })`。`.omd/plans/` 与 `.omd/specs/` **保留**。
- **恢复**：再次运行 autopilot 即读保留的 plans/specs，从记录的最后一个阶段继续（OMC resume 语义）。超过 2h 未更新的状态视为 stale——报告并与用户确认，不自动续跑。

## 降级

`create_goal`/`update_goal` 不可用 → 退化手动循环：进度记进 `.omd/state/sessions/{sessionId}/autopilot-state.json`，每轮结束提示用户输入 "continue"。降级模式首次进入时要显式告知一次。

## 状态契约

**调用形状约定**：`cwd`（当前工作区路径）与 `sessionId`（当前会话 id）是每个 `state_*` 调用的**必填顶层参数**；模式字段嵌套在 `state` 键下。示例：`mcp__omd-state__state_write({ cwd: <工作区>, sessionId: <会话>, mode: "autopilot", state: { ... } })`。

- **开始**：`state_write({ cwd, sessionId, mode: "autopilot", state: { active: true, started_at: <ISO 8601>, current_phase: "expansion", prompt_echo: <原始请求压缩 ≤1200 字符> } })`。状态文件：`.omd/state/sessions/{sessionId}/autopilot-state.json`。
- **阶段转换**：每次转换、每个 goal 轮次结束都 `state_write` 更新 `state.current_phase`（`expansion|planning|execution|qa|validation`）与进度字段。
- **完成/取消**：对应 `update_goal` 之后 `state_clear({ cwd, sessionId, mode: "autopilot" })`。`.omd/` 下的 plans、specs、handoffs 永不删除。
- **异常退出**：状态与 plans 留在盘上；下次启动先读状态；>2h 的 stale 状态只报告不自动续。
- **MCP server 挂了**：用普通文件工具对 `.omd/` 做同样的读写，并显式说明。
