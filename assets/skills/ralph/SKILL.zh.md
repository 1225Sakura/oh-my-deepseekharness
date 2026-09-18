---
name: ralph
description: PRD 驱动的 fresh-agent 持久循环——逐轮迭代直到所有 story 带命令证据通过、且独立 verifier 评审签字
when-to-use: 任务需要跨多轮、有证据兜底的保证完成。仅限显式调用（"ralph: <任务>"、"用 ralph 做…"）；只能由 direct human 在主会话启动。一次性 quick fix 或从想法到代码的自治流水线不要用本模式（后者用 autopilot）。
---

# ralph

<Purpose>
ralph 是构建在 dsh 原生 `ralph` 工具之上的 PRD 驱动持久循环：每一轮都是一个没有对话记忆的 fresh agent，共享工作区就是长期记忆，轮次之间只有一份有界的结构化报告流转。循环跑到结构化 PRD 里**每一条** story 都 `passes: true`（有原始命令证据背书）、且独立 verifier subagent 签字（`architectVerified: true`）为止。本文档是按 dsh 语义对 OMC ralph skill 的重写——没有 Stop hook，没有同上下文续跑。
</Purpose>

<Hard_Constraints>
- **只能主会话启动，且必须是 direct human 要求。** `ralph` 工具拒绝非人类与 subagent 权限。禁止在 subagent、workflow 或另一模式内部启动 ralph。
- **前台阻塞。** ralph 循环运行期间主会话不能交互做别的事。若 goal 续跑或另一模式 active，先读状态，然后拒绝并如实报告。
- **MVP 模式互斥**——不做 linked team/autopilot 组合。
</Hard_Constraints>

## Step 1 — PRD 准备（调用 ralph 工具之前）

1. **先读状态**：`mcp__omd-state__state_read({ cwd, sessionId, mode: "ralph" })` + `state_list_active({ cwd })`。另一模式 active 则拒绝；发现 stale 的 ralph PRD 则走下方 stale 协议。
2. **创建/精炼结构化 PRD**（下称 prd.json），位置 `.omd/prd/<topic>.json`，从模板 `assets/templates/prd-template.json` 起步。PRD 是结构化 JSON，不是 markdown 勾选清单。每条 story 字段：
   - `passes: boolean` —— 完成声明；只准在有证据时置位。
   - `acceptanceCriteria: [{ id, text, revision }]` —— 具体、可验证，每条对应一个可执行检查。**禁止泛化条目**（"implementation is complete" 之类）：启动循环前必须把脚手架条目改写成任务专属的验收标准。
   - `architectVerified: boolean` —— 独立评审签字。循环自身**永远不得**设置此字段；只有 Step 3 的 verifier pass 能置位。
   - `criteriaRevision` / 单条 criterion 的 `revision` —— 完成声明绑定验收标准版本，让"改完标准再宣称完成"可被检测。
   - `criterionAmendments[]` —— 修订台账（见下）。
3. story 按依赖排序；每条 story 应能在一轮左右完成。
4. `.omd/prd/progress.txt` 不存在则初始化。

## Step 2 — 启动循环

```
ralph(objective = "<PRD 路径> + 完成判据 + 证据契约", maxRounds = <上限>)
```

- `maxRounds` **必须设置**——它是熔断器；触顶即停，并报告剩余 story。
- objective 文本必须指示每一轮：
  1. 读 PRD 与 `progress.txt`；取优先级最高且 `passes: false` 的 story。
  2. 实现它（需要时经 `subagent` 委派 `omd-agent-executor`；独立工作背景并行）。
  3. **证据契约**：运行该 story 的验证命令，把**原始输出**写进本轮交接报告。没跑过检查就不得置 `passes: true`——无 evidence 的 `prd_check` 调用会被工具拒绝。
  4. 通过 `mcp__omd-state__prd_check` 标记完成（结构化 PRD 操作——优先于手改 JSON）。
  5. 追加 `.omd/prd/progress.txt`：实现了什么、改了哪些文件、留给后续轮次的经验与代码模式。

## 验收标准修订

当实测证明某条 criterion 在经验上为假，**不得**静默删除或弱化它。走 `mcp__omd-state__prd_amend` 修订：

- 原 criterion 逐字保留进 `criterionAmendments[]`，附 `kind`（`replaced` | `superseded`）、`reason`、有界 `evidence`；`authority` 可选（默认 `user`）；时间戳由工具自动记录（`at` 字段）。
- 缺 evidence/reason 的修订无效——PRD 读取时 **fail closed**。台账自相矛盾（原文仍 active、或同一原文被修订两次）同样使 PRD 无效。
- 完成检查只验证 ACTIVE 标准。这不是削弱目标的工具：它存在是为了让"实测与计划不一致"朝实测一侧收敛，同时循环不松手。

## Step 3 — 独立评审（全部 story passes 之后）

当每条 story 都 `passes: true`，由**主会话** spawn 一个 `omd-agent-verifier` subagent 对照 PRD 验收标准做独立评审——天然不同上下文，这正是意义所在：

- verifier 重跑证据命令、逐条核对 criterion；笼统的"看起来做完了"式结论无效。
- **通过**：置 `architectVerified: true`（经 PRD 工具），然后按状态契约完成收尾。
- **拒绝**：修复发现项后再请 verifier 复验。拒绝不是停止条件。

MVP 说明：单一 verifier pass 是底线。分层评审深度与强制 deslop pass 推迟到后续里程碑（与 OMC 的刻意分歧，如实记录）。

## stale 检测与和解

- PRD/状态超过 **2 小时**未动（`staleAfterMs: 7200000`）即 stale。异常退出（崩溃、强杀、取消）后重启时，输出 `[STALE PRD WARNING]`，附未完成 story 数与 last-touched 时长——向用户报告，**绝不自动续跑**。
- 仅当 story 配置的 `observableChecks`（`fileExists` / `fileContains`）**全部通过**，才允许自动和解为 `passes: true`。和解的 story 保持 `architectVerified: false`，仍须 verifier 签字。
- 每次和解决定追加进 `.omd/prd/reconciliation.jsonl`——审计日志是契约的一部分。

## progress.txt

跨迭代记忆：改了哪些文件、发现的代码库模式、不要再犯的错误。每轮追加；每个 fresh 轮次先读它。它替代 fresh 轮次所没有的对话记忆。

## 停止条件

- 全部 story `passes: true` + verifier 批准 → 完成（按状态契约清理）。
- 达到 `maxRounds` → 停止；报告剩余 story 及其证据状态。
- 根本性阻塞（缺凭据、需求不清、外部服务宕）→ 停止并报告。
- 用户说停 → 取消语义：清状态；PRD、progress.txt、reconciliation.jsonl 保留。

## 降级

`ralph` 工具不可用 → goal 驱动循环（`create_goal` + 每轮推进一条 story，PRD/证据契约不变）。goal 也不可用 → 纯 PRD + 用户人工推进。降级首次进入时显式告知一次。

## 状态契约

**调用形状约定**：`cwd`（当前工作区路径）与 `sessionId`（当前会话 id）是每个 `state_*` 调用的**必填顶层参数**；模式字段嵌套在 `state` 键下。

- **开始**：`state_write({ cwd, sessionId, mode: "ralph", state: { active: true, started_at: <ISO 8601>, current_phase: "execution", prompt_echo: <压缩 ≤1200 字符>, max_rounds: <上限>, prd_path: ".omd/prd/<topic>.json" } })`。状态文件：`.omd/state/sessions/{sessionId}/ralph-state.json`。
- **阶段转换**：每个轮次边界、每次阶段变化都更新 `state` 内的 iteration/进度字段。
- **完成/取消**：`state_clear({ cwd, sessionId, mode: "ralph" })`。`.omd/prd/` 下的一切（PRD JSON、progress.txt、reconciliation.jsonl）**保留**，供审计与恢复。
- **异常退出**：状态与 PRD 留在盘上；stale（>2h）状态只报告不自动续。
- **MCP server 挂了**：用普通文件工具对 `.omd/` 做同样的读写，并显式说明。
