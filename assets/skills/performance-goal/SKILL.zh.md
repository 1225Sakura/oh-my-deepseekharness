---
name: performance-goal
description: evaluator 门禁的性能优化工作流——基线测量、瓶颈分析、小步可逆优化、复测闭环、门禁式完成
when-to-use: 用户要求优化性能且想要目标导向的、带可量化指标的循环，而非一次性评审。任何优化开始前必须已有 evaluator 命令与 pass/fail 契约。
---

# performance-goal（性能目标工作流）

当用户要求优化性能且想要目标导向的循环而非一次性评审时使用本技能。没有数值目标的一次性性能体检，请改用 `review` / `omd-agent-performance-reviewer`。

## 契约

- 持久工作流状态放在 `.omd/perf/<slug>/`（普通文件：`state.json`、`checkpoints.md`）——**OMX 的 `omx performance-goal` CLI 在 dsh 下无对应面**；用 `write` / `read` / `edit` 文件工具读写这些产物，而不是 shell 调 CLI。
- dsh 原生 goal 工具（`create_goal` / `get_goal` / `update_goal`）持有当前会话的焦点与续跑记账——替代 Codex goal mode。`create_goal` 必须设 `max_goal_rounds`（默认 10）。
- evaluator 命令与 pass/fail 契约存在之前，任何优化工作不得开始。
- evaluator 有通过的 checkpoint 且完成审计证明目标达成之前，不许以 `complete` 调 `update_goal`。`update_goal` 需要来自一次新鲜 `get_goal` 的精确 `goal_id` 与 `revision`——永远先读再写。

## 建项（替代 `omx performance-goal create`）

1. 给目标起 slug（如 `startup-latency`）。
2. 写 `.omd/perf/<slug>/state.json`：

```json
{
  "objective": "Reduce CLI startup latency by 20%",
  "evaluatorCommand": "npm run perf:startup",
  "evaluatorContract": "PASS when p95 latency improves by 20% and regression tests pass",
  "slug": "startup-latency",
  "baseline": { "metric": "p95 ms", "value": null, "measuredAt": null },
  "lastValidation": { "status": "none", "evidence": null, "at": null }
}
```

3. 动任何代码之前先跑一次 evaluator 命令填基线——没有实测基线的目标不是目标，是愿望。
4. 启动 goal：先 `get_goal`；仅当无活跃 goal 且目标明确时才 `create_goal`，并设好 `max_goal_rounds`。

## Agent 循环

1. 确认 `.omd/perf/<slug>/state.json` 存在；不存在则先走建项。
2. 只对着 evaluator 契约工作。
3. 先找瓶颈再优化：对热路径做 profile 或插桩；候选原因按实测占比排序，不按直觉。因果不清时把深挖委派给 `omd-agent-tracer` / `omd-agent-analyst`。
4. 小步可逆补丁——一个补丁只验证一个假设。
5. 每个补丁之后跑 evaluator 与相关回归测试。
6. 每次 pass/fail/blocker 都记录：追加到 `.omd/perf/<slug>/checkpoints.md`，并更新 `state.json` 的 `lastValidation`（status 为 `pass` | `fail` | `blocked`，带证据与时间戳）。
7. 仅当 pass 产物存在且无剩余必需工作时才完成：跑完成审计（evaluator 通过 + 回归测试绿 + 无占位捷径），然后 `get_goal`，再用该新鲜快照以 `complete` 调 `update_goal`。

## 完成门禁

性能目标未完成，除非 `.omd/perf/<slug>/state.json` 的 `lastValidation.status` 为 `pass` 且证据点名 evaluator 输出，并且完成审计为绿。仅普通测试通过不算数，除非它们就是声明的 evaluator 契约。

生命周期：`create_goal` 启动会话 goal（dsh 负责跨轮续跑），循环按 基线→瓶颈→补丁→复测 迭代，evaluator 与审计都通过后才以 `complete` 调 `update_goal` 标记终态成功。若同一阻塞条件持续 3 轮以上，改用 `blocked` 调 `update_goal` 并给出具体 `blocked_reason`，不要空转。

## 边界

- evaluator 命令由用户或仓库提供（benchmark 脚本、测试目标、计时 harness）。若没有，造这个 harness **就是**第一项工作——evaluator 存在之前就优化违反契约。
- dsh goal 工具是按会话的；`.omd/perf/<slug>/` 产物跨会话携带状态。恢复时先读产物，再以 `resume` 调 `update_goal` 重新武装。
- 多目标性能工程（多个 slug 串行编排）升级到 `ultragoal`，不要在单会话里堆叠 goal。
