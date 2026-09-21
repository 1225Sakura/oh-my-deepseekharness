---
name: research
description: 调查一个开放问题，返回有据可查、带来源的结论
when-to-use: 下一步取决于某个尚未知晓的事实——代码库事实、外部 SDK/框架/API 行为、历史沿革。research 只回答问题，不做实现。不用于有状态的迭代改进循环（用 autoresearch）。
---

# research（调研）

下一步取决于某个尚未知晓的事情时使用本技能。research 回答问题；它不实现。

这是唯一的标准调研通道。OMC 已退役的 `deep-dive` / `sciomc` 通道收敛到这里；在 omd 中 `autoresearch` 是独立的有状态改进循环，不是调研入口。

## 目标

用证据替换假设，并如实说出仍不确定的部分。

## 流程

1. 把问题陈述得足够精确，精确到能判断"已回答"。
2. 先搜仓库与其文档——`grep` / `glob` / `read`；本地证据优先于记忆。
3. 涉及外部 SDK、框架或 API 时，用 `web_search` / `read_page` 查官方文档。
4. 答案可能藏起来的地方要多路扫：按文件、按符号、按调用方、按历史（`git log` / `git_diff`）。
5. 综合为 findings，每条都标注来源。

## 规模

- **窄查找**——直接回答。
- **多个相互独立的问题**——并行调查：后台 spawn `subagent`（代码问题用 `omd-agent-explore` 角色卡，外部文档用 `omd-agent-document-specialist`）。
- **规模未知的发现式调研**——持续扫，直到新增一轮不再带来新发现。

## 规则

- 引用来源：文件与行号，或查阅的文档/URL。
- 区分"已验证"与"推断"。
- 有矛盾证据就报告矛盾，不挑更顺的故事。
- 不因调研顺手做实现。

## 输出

- 问题本身
- findings，每条带来源
- 仍未知或无法验证的部分
- 顺理成章的下一步建议（若有）

## 状态契约

research **不持模式状态**。findings 以最后一条消息（作为 subagent 时）或会话摘要交付；值得长期保留的事实写 `mcp__omd-state__notepad_write_priority` / `notepad_write_working`。research 自身不在 `.omd/state/` 下创建任何文件。
