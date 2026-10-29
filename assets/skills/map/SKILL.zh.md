---
name: map
description: 技能地图——哪个技能管哪件事，按交付环顺序排列。当你知道要做什么、但不知道该用哪个已发售技能时使用；地图只路由，绝不执行。
when-to-use: 用户知道需要哪类工作、但不知道归哪个技能；或直接问「X 该用哪个技能」。地图只在已发售技能间路由——不代为执行。
---

# 地图（Map）

你知道有事要做，但不知道归哪个技能。在下表找到活儿，沿路由走。每行解析为一次 Skill 工具调用——发起调用，然后遵循该技能的纪律。地图对任何纪律只解释一次，不重复。

## 交付环

| 你在这里 | 技能 |
|---|---|
| 外部工作进港（issue、PR、报告） | `harbor` |
| 目的地是雾——头三个决策还说不出来 | `ask-navigator` |
| 想法模糊；必须先提问 | `deep-interview` |
| 需求清晰；需要计划 | `plan`（多视角共识：`ralplan`） |
| 计划已批准；分解并端到端交付（人类检查点） | `launch` |
| 单任务；持久迭代直到验证完成 | `ralph` |
| 全自动从想法到代码 | `autopilot` |
| 需要协调并行队员 | `team`（仅限显式调用） |
| 单个已批准任务贯穿到验证过的代码 | `execute` |
| 散文无法定夺的设计问题 | `loft` |
| 开工前仓库需要共享地基 | `drydock` |
| 完成的活儿需要评审判断 | `review` |
| 有人声称做完了 | `verify` |
| 工作以发布收尾 | `release` |
| issue/PR 需要隔离 worktree 会话 | `project-session-manager` |

## 支线入口（脱离主环）

| 活儿 | 技能 |
|---|---|
| bug 需要根因 | `debug`；竞争假设追踪：`trace` |
| 测试应驱动实现 | `tdd` |
| 代码库越来越难改 | `analyze`（只读深度仓库分析，带证据边界） |
| AI 生成的残渣需要清理 | `ai-slop-cleaner` |
| 开放问题需要带出处的答案 | `research`；官方/外部文档：`external-context`；第二意见：`ask` |
| 知识需要跨会话复利 | `wiki`；持久项目记忆：`remember` |
| 周期性自治改进循环 | `self-improve`；持久目标台账：`ultragoal`；有状态单任务循环：`autoresearch` |
| 性能优化需要门禁 | `performance-goal` |
| 视觉/UI 需要裁决 | `visual-verdict` |
| 缺设计权威来源 | `design` |
| 新代码必须保持最小与原则 | `minimal-code-discipline`；面向 agent 的文档：`agent-doc-discipline` |
| 新仓库需要定向文档 | `deepinit` |

## 工具箱

| 活儿 | 技能 |
|---|---|
| 安装、诊断、配置 | `omd-setup`；`omd-doctor` |
| 管理技能本身 | `skill`（本地）；`skillify`（从会话提炼） |
| 查看编排状态 | `trace`（兼追踪通道）；`graph`（DAG 运行时）；`hud`（状态卡） |
| 取消一个模式 | `cancel` |

## 规则

- 地图只路由，绝不执行。每行解析为一次 Skill 工具调用——发起调用，然后遵循该技能纪律。
- 地图只路由实际已发售的技能。没有匹配行本身就是信息：直说无路由，而不是挑一个听起来最近的技能。
- 两行都像时，以上方交付环顺序裁决：靠前的腿优先。
- 关键词提示：`autopilot`、`deep-interview`、`review`、`tdd`、`ai-slop-cleaner` 说出关键词即触发；`ralph`、`ralplan`、`wiki` 需锚定显式形（`ralph: <任务>` / 用 ralph…）；`team` 无关键词——仅限显式调用；所有被路由技能永远可以按名显式调用。
