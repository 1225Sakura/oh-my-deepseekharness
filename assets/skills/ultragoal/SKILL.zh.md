---
name: ultragoal
description: 持久多目标工程——有序 story、尝试计数与逐 story 证据持久化在 .omd/ultragoal 下，由 dsh 原生 goal 机制（create_goal/update_goal）驱动，收尾带评审门禁
when-to-use: 用户要一个跨会话/worktree 持久跟踪的大型多步骤工程（"ultragoal"、"把这个当持久目标跟踪"、"多 story 工程"）——比单个改动大（单个改动用 ralph 或直接委派），且要带最终质量门禁的执行而非纯规划产物（纯规划用 plan）。
---

# ultragoal —— 持久多目标工程

把简报拆成一组有序 story，把 start/checkpoint/blocker/failure 事件记进持久的 append-only 台账，并用 dsh 原生 goal 工具驱动当前会话。台账扛得住会话重启与 worktree；goal 工具让活着的会话保持聚焦。

**移植映射（OMC → dsh）。** OMC 用 `omc ultragoal` CLI 写 `.omc/ultragoal/` 产物 + 打印交接文本给 Claude Code 的 `/goal` 斜杠命令（shell 碰不到 `/goal` 状态）。在 omd 里两半都是一等的：持久产物就是 `.omd/ultragoal/` 下的文件（用 `write`/`edit` 写），会话 goal 直接用 `create_goal` / `get_goal` / `update_goal` 管理——不需要交接间接层。`/goal` 快照对账那套（`--claude-goal-json`）**已舍弃**：dsh goal 状态是权威源，`get_goal` 直接可查。

## 工作流

### 1. 建计划

把简报拆成有序 story。计划写到 `.omd/ultragoal/plans/<planId>/plan.md`（`<planId>` 默认 `default`；并行场景见下文）：

```markdown
# Ultragoal: <工程标题>
<!-- created: <ISO-8601> -->

## 聚合目标
<一段话——成为 create_goal 的 objective>

## Stories
- [ ] G001 <slug>: <做什么> —— 所需证据: <测试/文件/PR>
- [ ] G002 <slug>: …
```

然后启动 dsh goal：

```
create_goal(objective: "<聚合目标>", max_goal_rounds: <上限，默认 10>)
```

`max_goal_rounds` 必填——默认取 `autopilot.maxIterations`（默认 10），用户另有指定除外。

### 2. 按序做 story

每个 story：在台账里标记 in-progress，干活，收集证据（测试输出、改动文件、PR 链接）。用户显式点名时 pending story 可以乱序启动；绝不静默跳号。

往 `.omd/ultragoal/plans/<planId>/ledger.md` 追加事件——append-only，一行一事件：

```
<ISO-8601> start    G001 attempt=1
<ISO-8601> checkpoint G001 status=complete evidence="npm test 全绿; files: src/x.ts"
<ISO-8601> blocker  G003 title="…" detail="…"
<ISO-8601> fail     G002 attempt=2 reason="…"
```

### 3. Checkpoint

story 带证据完成时，在 `plan.md` 里打勾并追加 checkpoint 事件。证据是强制的——没证据不打勾（与 `prd_check` 同一契约）。

### 4. 最终质量门禁（宣告工程完成之前）

最后一个 story 打勾后，工程**仍未**完成，直到三关全过：

1. **review** 技能过一遍整体 diff（slop、可简化点、风险）
2. **verify** 技能——跑验证命令，读真实输出
3. 独立**代码评审**——委派 `omd-agent-code-reviewer`（新鲜 subagent 上下文；绝不在写作上下文里自批）

门禁不干净：**不要** complete。追加一条 blocker story（如 `G0NN resolve-final-review-blockers`），把评审发现作为它的证据要求，保持 goal 活跃，继续做。

### 5. complete / pause / blocked

- **complete：** 先 `get_goal`（抄下精确的 `goal_id` + `revision`），再 `update_goal({ action: "complete", … })`——只在最终门禁全绿之后。
- **pause/resume：** 用户要求时 `update_goal({ action: "pause" })`；`resume` 重新武装。跨会话重启时 goal 已解除武装——读台账重建上下文，然后 `resume`（或用同一聚合目标与剩余 story 重建 goal）。
- **blocked：** 仅当**同一**阻塞条件持续 **≥ 3 个连续 goal 轮**；在 `blocked_reason` 里写明具体条件。困难或还有活没干完不算 blocked。

## 并行运行（多会话 / worktree）

同一工作区里两个并发 ultragoal 不得共享计划目录。每次运行用独立 `<planId>`（如 `<epochMs>-<slug>`），产物落到 `.omd/ultragoal/plans/<planId>/`。每个会话各持自己的 dsh goal——互不冲突。注意每个 worktree 有自己的 `.omd/`；跨 worktree 共享台账是二期设计项。

## 什么时候不要用

- 单个小改动 → 直接委派或 `ralph`
- 只要规划产物、不要执行循环 → `plan`

## 状态契约

ultragoal **不持 omd 模式状态**（无 `state_write`/`state_clear`——它不是执行模式；omd 关键词路由不激活它）。它的持久化住在两处：dsh goal（会话级，经 `create_goal`/`get_goal`/`update_goal` 管理——`update_goal` 之前永远先 `get_goal` 抄精确 id/revision）与仓库内持久产物 `.omd/ultragoal/plans/<planId>/{plan.md,ledger.md}`。
