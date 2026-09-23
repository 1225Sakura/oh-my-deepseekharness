---
name: hud
description: omd 会话的状态可见性——HUD 该显示什么（模式、轮次、story、agent、todo）以及今天怎么拿到这些可见性。**c4 HUD 库能力已在 0.3.0 还原**（commit 后续 9）为纯函数库（lib/hud.js + tests）；把它渲染为持续面板的 client half 是 omd 1.x 项。
when-to-use: 用户问起 HUD/状态栏设置、想要持续的会话状态可见性、或问"我的 HUD 在哪"。库调用（`lib/hud.js#summarize` / `renderCard` / `diffSummary`）今天任何调用方都可用；持续面板渲染需 omd client half（1.x）。
---

# hud（状态可见性）

> **先把诚实状态说前面：** OMC 的 HUD 是 Claude Code 的 `statusLine` 命令脚本（`~/.claude/hud/omc-hud.mjs` + `settings.json`）。dsh **没有状态栏面**，所以这里没有什么可安装、可配置的。omd 的 **c4 HUD 库能力已在 0.3.0 还原**（commit 后续 9——`lib/hud.js` + `tests/lib/hud.test.js`，133 + 128 行，7 个测试通过）。库导出五要素契约（mode/round/story/agents/todo）、`summarize` / `renderCard` / `diffSummary` 纯函数、以及 `createPollingHud` 客户端轮询工厂。**通过 dsh 原生 `ctx.betterSidebar` 注册原生侧边栏 tab 的 client half 是 omd 1.x 项**——模式参考：[DSH-better-sidebar external-plugin-guide](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/docs/external-plugin-guide.md)。在 client half 落地前，用户通过下面 6 条路径拿可见性。

## HUD 该显示什么（方法论，留给 M3）

OMC 原版的预设，作为未来面板的设计输入：

| 预设 | 内容 |
|---|---|
| minimal | `[omd] <模式> | todos:n/m` |
| focused（默认） | 分支、模式轮次（如 `ralph:3/10`）、当前 PRD story、最近技能、上下文 %、agent 数、后台 job、todos |
| full | 全部 + 多行 per-agent 明细（角色码、时长、当前动作） |

颜色纪律：绿正常；黄警告（上下文 >70%、ralph >7 轮）；红危急（上下文 >85%、ralph 到上限）。

## 今天怎么拿到状态可见性

1. **`/omd-doctor`**——安装与接线健康：注册计数、MCP 冒烟、probe 四态矩阵、降级公告。
2. **`mcp__omd-state__state_get_status`**——聚合模式状态 + stale 检测：哪些模式活跃、当前阶段、轮次。
3. **`mcp__omd-state__state_list_active`**——跨会话活跃模式清单。
4. **`list_agents` / `job_list`**——存活 subagent 与后台 job 清单（即 `agents:n` / `bg:n/m` 的等价物）。
5. **`todo_write` 状态**——todos 元素在会话内本就可视。
6. 上下文用量——读会话运行时上下文快照（focused 预设 `ctx:%` 的等价物）。

用户说"帮我装 HUD"时，用上面的预设表加这份清单回答，并明说：GUI 面板 M3 才交付；在那之前，这六条路径就是 HUD。

## 诚实回答 HUD 问题

- **不要**往 `~/.claude/` 写脚本、不要编辑 `settings.json`——这些面在 dsh 下不存在。
- **不要**承诺自动刷新的状态栏；如实描述每条今日路径返回什么，让用户按需拉取。
- 用户追问 M3 面板进度时，指向规格路线图条目（经 `dsh.client` 槽位的 HUD 面板）——那是被跟踪的计划，不是变通。

## 状态契约

hud **不持模式状态**、不写任何东西——它是顾问型技能。回答状态问题时可以**读** `mcp__omd-state__state_get_status` / `state_list_active`；绝不调 `state_write`/`state_clear`，绝不碰文件。
