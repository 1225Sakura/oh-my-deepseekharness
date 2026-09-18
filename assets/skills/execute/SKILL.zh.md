---
name: execute
description: 把已批准的任务落地为能跑、有验证证据的代码
when-to-use: 工作已理解、任务就是把它做出来——已有批准的计划或规格，需要实现并附验证证据。不适用于：想法还模糊（先 plan 或 deep-interview）、纯评估已有工作（用 review/verify）。
---

# execute（执行）

工作已理解、任务是构建时使用本技能。这是 omd 的 canonical 执行工作流：`autopilot`、`ralph`、`team` 的实现工作都遵循这套规则。

## 目标

把任务从已达成的意图推进到能跑的代码，并拿出它能跑的证据。

## 流程

1. 确认任务清晰到可以动手。不够清晰就先规划（`plan` / `deep-interview`）。
2. 把 work 拆成独立单元；真正独立的单元并行跑。
3. 每个单元实现最小正确改动，复用现有工具函数与模式。
4. 边做边验证，不是只在最后验证。
5. 报告改了什么、验证了什么、还剩什么。

## 规模匹配

机制跟着任务走：

- **单一单元**——直接实现、验证、收工。
- **多个独立单元**——并行委派给 `omd-agent-executor` 子代理（先用 `skill` 工具加载角色卡；默认后台 spawn）。
- **长时或无界**——用 `todo_write` 维护持久任务清单，清空为止。
- **需要协调的并行工人**——用 `team` 技能。

一次专注推进能完成的活，不要拉起编排机制。

## 规则

- 行为不变时，删优于增。
- 没有明确请求不加依赖。
- diff 保持小且可逆。
- 占位 TODO、`test.skip`、stub 测试是阻塞项，不是进度。
-  authoring 与批准分离——不在同一活跃上下文自我批准；交给 `review` 或 `verify`（以独立子代理 spawn `omd-agent-code-reviewer` / `omd-agent-verifier`）。

## 完成标准

宣称完成之前：

- 无 pending 任务
- 测试通过，或失败被如实报告
- 验证证据已收集（跑过哪些命令、读过原始输出）

## 输出

- 改动的文件
- 实现了什么
- 能工作的证据
- 仍未完成的部分

## 状态契约

execute 是轻量工作流，**不持模式状态**——自己没有 `state_write`/`state_clear`。当被外层模式调用时（autopilot phase 2、ralph 轮次、team-exec 阶段），持久化由外层模式的状态契约管辖；execute 只用 `todo_write` 维护工作清单，不触碰 `.omd/` 下的持久产物（plans、handoffs）。
