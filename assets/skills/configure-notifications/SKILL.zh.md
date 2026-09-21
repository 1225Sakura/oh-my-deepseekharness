---
name: configure-notifications
description: omd 的通知配置——诚实现状与 dsh 下最接近的替代路径。OMC 的通知器搭在 Claude Code 会话 hook（session-end、idle、ask-user-question）上、写 ~/.claude/.omc-config.json；dsh 没有会话事件通知面，插件内今天没有可接线的东西。本技能记录替代路径。
when-to-use: 用户要求配置 Telegram/Discord/Slack 通知、会话结束提醒、或"agent 跑完通知我"。不用于会话内进展汇报（那是 goal/subagent 的普通汇报）。
---

# configure-notifications（dsh 现状 + 替代路径）

> **诚实现状：** OMC 的通知系统由 Claude Code 会话 hook（`SessionEnd`、`Notification`、`Stop`）驱动，配置文件在 `~/.claude/.omc-config.json`，CLI 开关形如 `omc --telegram`。在 dsh 下，**这些面对 omd 都不存在**：hooks 桥（即使存在）不暴露插件可消费的会话结束/空闲事件，omd 也没有后台守护进程。因此 **omd 内没有可配置的东西**——不写配置文件、不发明通知面板，对用户如实说明。

## 没有通知面也行得通的部分

- **goal 完成汇报**——`autopilot`/goal 驱动的跑程在落定时会话内回报；GUI 显示完成的回合。"跑完告诉我"在单会话内，答案就是这个。
- **状态拉取**——`mcp__omd-state__state_get_status` / `state_list_active` 从任意会话回答"还有没有在跑的东西"。
- **`job_list` / `list_agents`**——后台 job 与 subagent 的落定会在会话内自动通报。

## 替代路径（用户所有，插件之外）

用户确实需要长跑结束时的推送通知（Telegram/Discord/Slack），诚实的选项是：

1. **外部看守脚本（推荐）。** omd 把模式状态持久化在 `.omd/state/`、goal/模式工件落盘。一个用户自有的小脚本（PowerShell/Python）可以轮询工作区的 `.omd/`（或用文件系统 watcher 监听），在模式进入终态时 POST 到 webhook。omd 永不替用户管这个脚本；它属于船坞槽位里的 `scripts/`。
2. **自建 MCP server。** 用户自建的 MCP server 可暴露一个 `notify` 工具；skill/协议层随后在模式边界（如完成报告步）调用它。MCP server 声明在 dsh profile 的 cordis patch 里——不在 omd 内部。
3. **服务商原生 webhook。** Telegram bot / Discord webhook / Slack incoming-webhook 的获取流程不变（OMC 向导里拿 token 与 URL 的说明作为外部文档仍然适用）——但*发送*必须来自路径 1 或 2，不来自 omd。

## 诚实回答向导式提问

- 被要求"配置 telegram/discord/slack"时：解释缺失的面，然后提出帮忙搭路径 1（仓库 `scripts/` 里的看守脚本）或说明路径 2。这就是本技能的全部范围。
- 绝不把 bot token 收进 omd 持有的文件——omd 没有通知配置 schema，也不该悄悄长一个出来；这个缺口是记录在案的规格分歧候选。

## 状态契约

configure-notifications **不持模式状态**，自身不写任何东西。搭看守脚本（选项 1）只在用户显式要求时写用户的 `scripts/`；`.omd/` 下不放任何东西。
