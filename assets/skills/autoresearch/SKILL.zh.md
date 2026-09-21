---
name: autoresearch
description: 有状态的单任务改进循环——严格 evaluator 契约、markdown 决策日志、max-runtime 停止行为
when-to-use: 已有 mission 与 evaluator，想要持续的单任务迭代改进，并把实验日志持久化到 .omd/autoresearch/ 下。不用于运行时生成 evaluator（先访谈或直接撰写），也不用于多任务编排（v1 禁止）。
---

<Purpose>
autoresearch 是一个有状态 skill，做有界的、evaluator 驱动的迭代改进。同一时刻只持有一个 mission，评估不通过也持续迭代，把每次评估与决策记录为持久 artifact，只有到达显式的 max-runtime 上限或其他显式终止条件才停止。
</Purpose>

<Use_When>
- 已有 mission 和 evaluator。OMC 中二者由 `/deep-interview --autoresearch` 生成；该 `--autoresearch` 标志变体**尚未移植到 omd**——正常运行 `deep-interview` skill，与用户敲定 mission 规格 + evaluator 契约，或直接撰写。
- 想要严格评估下的持续单任务改进。
- 需要 `.omd/autoresearch/` 下的持久实验日志。
</Use_When>

<Do_Not_Use_When>
- 需要在运行时生成 evaluator——先访谈或直接写好。
- 需要把多个 mission 编排在一起——v1 禁止。
- 想用 OMC 已退役的 `omc autoresearch` CLI 流程——omd 无对应物。
</Do_Not_Use_When>

<Contract>
- v1 仅支持单 mission。
- evaluator 输出必须是结构化 JSON，必填布尔字段 `pass`，可选数值字段 `score`。
- 评估不通过的迭代**不会**停止运行。
- 停止条件显式且有界，max-runtime 是首要的硬停止上限。
- 循环载体：迭代由 dsh `goal` 机制承载——`create_goal` 且必须设 `max_goal_rounds` 作为轮数熔断；记录在模式状态里的墙钟 max-runtime/deadline 每轮按时间戳复核。
</Contract>

<Required_Artifacts>
权威持久存储位于 `.omd/autoresearch/<mission-slug>/` 和/或 `.omd/logs/autoresearch/<run-id>/`。

最低必备 artifact：
- mission 规格
- evaluator 脚本或命令引用
- 每轮迭代的评估 JSON
- markdown 决策日志

推荐的标准形态：
```text
.omd/autoresearch/<mission-slug>/
  mission.md
  evaluator.json
  runs/<run-id>/
    evaluations/
      iteration-0001.json
      iteration-0002.json
    decision-log.md
```
已有可复用的运行时 artifact 就复用，不做无谓重复。
</Required_Artifacts>

<Workflow>
1. 确认单 mission 已存在且 evaluator 已就绪。
2. 确保 `autoresearch` 模式状态已激活（见状态契约）并记录：
   - mission slug/目录
   - evaluator 引用
   - 迭代计数
   - started/updated 时间戳
   - 显式的 max-runtime 或 deadline
3. 每轮迭代（一个 goal 轮次）：
   - 恰好跑一个实验/改动周期
   - 用 `pwsh` 跑 evaluator
   - 持久化机器可读的评估 JSON
   - 追加一条人可读的 markdown 决策日志
   - 评估不通过也继续
4. 停止条件：
   - 到达 max-runtime 上限（每轮对照状态时间戳复核）
   - `max_goal_rounds` 用尽
   - 用户显式取消（cancel 语义）
   - 记录了其他显式终止条件
</Workflow>

<Periodic_Reruns>
OMC 借助 Claude Code 原生 cron 做周期性 mission 重跑。**dsh 没有原生 cron 原语——该集成列 omd 二期。**在此之前若确需周期重跑，用 OS 级调度（Windows 任务计划 / cron 拉起一个 dsh 会话）。

若使用周期重跑：
- 一个调度任务只对应一个 mission
- 保持同一份 mission/evaluator 契约
- 追加新的 run artifact，不覆盖既往实验
</Periodic_Reruns>

<Execution_Policy>
- 不做多 mission 编排。
- OMC 的 `src/autoresearch/*` 运行时/schema 助手在 omd 无对应物——契约在 prompt 层强制。
- 日志要对人有用，不只是对机器有用。
</Execution_Policy>

## 状态契约

**调用形态约定**：每次 `state_*` 调用都必须把 `cwd` 与 `sessionId` 作为顶层参数；模式字段嵌在 `state` 键下。

- **启动**：`mcp__omd-state__state_write({ cwd, sessionId, mode: "autoresearch", state: { active: true, started_at: <ISO 8601>, current_phase: "running", mission_slug, mission_dir, evaluator_ref, iteration: 0, max_runtime, deadline } })`。状态文件：`.omd/state/sessions/{sessionId}/autoresearch-state.json`。
- **转换**：每个轮次边界更新 `iteration` 与 updated 时间戳。
- **完成/取消**：`mcp__omd-state__state_clear({ cwd, sessionId, mode: "autoresearch" })`。`.omd/autoresearch/` 与 `.omd/logs/autoresearch/` 下的全部内容**保留**，供审计与恢复。
- **MCP server 不可用**：用普通文件工具对 `.omd/` 做同样的读写，并显式公告降级。
