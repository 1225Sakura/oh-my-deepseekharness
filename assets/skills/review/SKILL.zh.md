---
name: review
description: 在交付前评估已完成工作的缺陷、风险与可简化点
when-to-use: 工作已存在、需要评估——合并前评审、实现通道之后的批准环节，或 "code review" / "代码评审" 关键词触发。不用于编写改动；review 绝不亲手写它所评判的改动。
---

# review（评审）

评估已有工作时使用本技能。review 绝不亲手写它所评判的改动。这是 omd 的 canonical 评审工作流（OMC 源码注册名是 `omc-review`，omd 改名为 `review`——见规格分歧表）。

## 目标

找出真正的问题，按严重度排序，细节足够支撑行动。

## 流程

1. 先弄清楚改了什么、本应做什么（`.omd/` 下有 spec/plan/handoff 就先读）。
2. 对照意图读改动。
3. 先查正确性，再查风险，再查可简化性。
4. 每条候选发现先验证再报告。
5. 最严重的发现排最前。

## 检查项

- **Correctness**——逻辑缺陷、边界情况、错误路径、并发
- **Risk**——安全边界、破坏性操作、数据完整性
- **Reuse**——本该复用的现有工具函数或模式
- **Simplification**——可以删除或合并的代码
- **Coverage**——未带测试就交付的行为

## 规则

- 通道分离：评审者不得与作者同处一个活跃上下文。作为独立门禁时用 `subagent` spawn `omd-agent-code-reviewer`（先用 `skill` 工具加载角色卡）。
- 先验证再报告。听起来合理但复现不了的发现是噪音。
- 严重度如实标注；不为显得全面而凑数。
- 工作扎实时，"无发现"是合法结果。
- 默认建议性——review 提供信息，不做门禁。硬门禁（发布、安全、破坏性操作）独立存在且 fail-closed。当被显式用作评审门禁时（autopilot Phase 4、ralph 独立评审层、team-verify 升级），由调用方模式决定裁决如何卡住推进。

## 输出

- 发现列表，最严重在前，每条带文件、行号与具体失败场景
- 检查过且确认干净的部分
- 无法评估的部分

## 状态契约

review **不持模式状态**。当它作为门禁在外层模式内运行时（autopilot 双评审门、ralph verifier 环节、team-verify），裁决由外层模式记入自己的状态；review 自身不在 `.omd/` 下创建文件，也不做 `state_write`/`state_clear`。

## Merge-readiness 模式（opt-in 双通道门禁）

被显式用作合并门禁时（「merge-ready 评审」「发布前双通道」），review 从单通道建议性升级为双通道独立门禁：

1. **记录范围**：先记录评审范围（`git status --short` + `git diff --stat`），不悄悄扩围。
2. **双通道并行**：`subagent` spawn 两名净上下文评审员，互不可见对方输出；spawn 前先经 `skill` 工具加载对应角色卡，并在 lane prompt 中显式嵌入任务契约——`omd-agent-code-reviewer`：「只评审安全/质量/性能/最佳实践/可维护性，不评架构；返回 file:line 证据与 APPROVE / REQUEST CHANGES / COMMENT 结论」（发现按 CRITICAL/HIGH/MEDIUM/LOW 分级）；`omd-agent-architect`：「返回 file:line 证据与 Architectural Status: CLEAR / WATCH / BLOCK（CLEAR=无顾虑，WATCH=非阻塞顾虑，BLOCK=合并阻塞项）」——该状态词表不在 architect 角色卡内，必须由 lane prompt 提供。评审通道不传 `model`/`reasoning_effort` 覆盖。
3. **证据门禁（fail-closed）**：APPROVE 当且仅当 code-reviewer=APPROVE ∧ architect=CLEAR ∧ 双通道均返回证据。任一通道缺失或失败 = 「独立评审不可用」阻断态——不是放行理由，不得以当前/作者通道替审。
4. **合成矩阵**：architect=BLOCK → REQUEST CHANGES；否则 reviewer=REQUEST CHANGES → REQUEST CHANGES；否则 architect=WATCH → COMMENT；否则遵 reviewer 结论。
5. **发现纪律**：每条发现必须 `file:line` + 问题描述 + 风险 + 具体修复建议；事实与建议分列。
6. **报告契约**：最终报告并列两条通道的原始裁决与合成后的最终裁决；architect 的 BLOCK 项置于报告最前、不可埋没；不可用态以「独立评审不可用」作为最终结论，不得记为 APPROVE 或 merge-ready。
7. 边界：不改变默认建议性与其余门禁——其他显式门禁（autopilot 双评审门、ralph 独立评审层、team-verify 升级）仍按各自模式定义执行；本模式供独立调用的合并门禁使用，不持模式状态、不做 `state_write`/`state_clear`。

（来源：OMX code-review 卡的 omd 适配——门禁矩阵、fail-closed 不可用态与双通道纪律照搬上游；OMX 特有面 `omx state write` CLI、hook-owned `skill-active-state.json` 与 Autopilot `handoff_artifacts.code_review`→`ultraqa` 流转不搬入本 skill：门禁裁决与后续流转由调用方外层模式记入其自身状态。Upstream: reference/oh-my-codex/skills/code-review。本节须同构写入 SKILL.zh.md 与 SKILL.md 两文件。）
