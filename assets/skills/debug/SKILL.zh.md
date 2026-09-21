---
name: debug
description: 用模式状态、notepad、日志与聚焦复现来诊断当前 omd 会话或仓库状态
when-to-use: 用户想诊断当前 omd/DeepSeek-Harness 会话问题、工作流断裂或费解的运行时行为——模式卡住、state 过期、编排异常。在隔离出失败点之前不开修复处方。
---

# debug（诊断）

用户想诊断当前 omd/DeepSeek-Harness 会话问题、工作流断裂或费解的运行时行为时使用本技能。

## 目标

快速找到真正的失败信号，并解释下一步纠正动作。

## 流程

1. 仔细读用户的问题描述。
2. 先查最相关的本地证据：
   - 模式状态：`mcp__omd-state__state_get_status({ cwd })` 与 `state_list_active({ cwd })`；读单个模式用 `state_read({ cwd, sessionId, mode })`
   - MCP 降级时直接用 `glob`/`read` 读 `.omd/` 产物——状态文件在 `.omd/state/sessions/{sessionId}/<mode>-state.json`
   - 会话记忆相关时读 `mcp__omd-state__notepad_read({ cwd })`
   - 失败的测试或命令——用 `pwsh` 重跑最窄的那一条
   - 用 `git log` / `git_diff` 关联近期改动
3. 可能的话做最窄复现。
4. 区分症状与根因。
5. 推荐最小的下一步修复或验证动作。

## 规则

- 要真实证据，不要猜。
- 问题涉及编排、模式或 agent 流转时，用状态面排查。
- OMC 原版的 trace MCP 工具（`trace_timeline` / `trace_summary`）**在 omd 二期**；在此之前，用 `.omd/` 状态与 handoff 文件、`git log`、对日志做聚焦 `grep` 来重建 agent 流转过程。
- 如果问题其实是宿主/运行时 bug（dsh 本身，而非 omd 或业务代码），直说。
- 隔离出失败点之前，不开大范围重写的处方。

## 输出

- 观察到的失败
- 根因假设
- 该假设的证据
- 最小的下一步动作

## 状态契约

debug **不持模式状态**：它是只读为主的诊断通道，不在 `.omd/state/` 下创建任何内容。值得保留的发现写 `mcp__omd-state__notepad_write_working`；若随后进入修复，由外层模式（若有）负责持久化。需要多假设竞争的深度因果排查时，升级到 `trace` skill。
