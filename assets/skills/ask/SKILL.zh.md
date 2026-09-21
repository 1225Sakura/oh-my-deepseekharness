---
name: ask
description: 第二意见顾问通道——把问题路由给一个独立 subagent（可换不同角色卡），并把答案持久化为 ask artifact
when-to-use: 想要一个外部视角看某个问题或任务——从安全角度审 patch、UX 改进建议、全新的计划草案——且回答者不是产出自该工作的上下文。仓库自身能回答的问题用 research。
---

# ask（顾问）

> **移植说明（先读）。** OMC 原版把 prompt 路由给本地外部 CLI（`omc ask <claude|codex|gemini|antigravity|grok|cursor>`）。**omd 零外部依赖：这些 CLI 顾问被替换为 spawn 一个独立 `subagent` 取第二意见。** 顾问是另一个模型上下文，而不是别家厂商的 CLI。这是如实的替代方案，不是隐性缺口。

用 omd 的顾问通道把 prompt 路由给一个全新的 subagent 上下文——可换不同角色卡获得不同视角——并把结果持久化为 ask artifact。

## 用法

```
ask <角色或视角> <问题或任务>
```

示例：

```
ask code-reviewer "从安全角度审一下这个 patch"
ask designer "给这个流程提 UX 改进建议"
ask planner "为 issue #123 起草实现计划"
ask default "帮我 sanity-check 这个迁移顺序"
```

## 路由

**必需执行路径——永远 spawn，绝不自问自答：**

```
subagent(description="ask: <视角>", run_in_background=false,
         prompt="<指定角色时附上 omd-agent-<role> 角色卡>

你是一位独立顾问。以下问题/任务来自另一个想要第二意见的上下文。
基于你自己的分析作答；不要预设请求方的结论。

<问题或任务>")
```

- 命名角色（`code-reviewer`、`designer`、`planner`、`security-reviewer`……）选择对应的 `omd-agent-*` 角色卡——角色卡才是视角成立的依据。
- `default`（或不指定角色）spawn 一个不带角色卡的普通 subagent。
- 这条通道的意义在于**独立上下文**：不要自己作答再转述成"顾问意见"。

## 前置要求

- 除 dsh 自身外无要求——没有要安装或认证的外部 CLI。（OMC 针对各厂商的 `claude --version` / `codex --version` / `gemini --version` 检查在 omd 无对应物。）

## Artifacts

每个答案用 `write` 工具持久化为 ask artifact：

```text
.omd/artifacts/ask/<role>-<slug>-<timestamp>.md
```

artifact 内含问题、所用角色/视角与顾问的完整答案。artifact 路径是答复的一部分，便于调用方链接。

## 状态契约

ask **不持模式状态**：`.omd/artifacts/ask/` 下的 artifact 就是全部留痕。没有 `state_write`/`state_clear`；不在 `.omd/state/` 下写任何内容。
