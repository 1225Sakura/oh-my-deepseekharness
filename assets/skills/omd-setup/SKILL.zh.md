---
name: omd-setup
description: oh-my-dsh 安装与配置指引——dsh plugin add（npm 或本地路径）、Config 键说明、/omd-doctor 验装、更新与卸载流程
when-to-use: 用户要求安装、配置、更新、修复或卸载 oh-my-dsh（"setup omd"、"安装 omd"、"配置 omd"、"omd 更新"）时使用；omd 刚装进 profile、用户问下一步做什么时也落到此技能。
---

# omd-setup —— 安装与配置指引

omd 是 **dsh 插件**，不是 CLI。没有 `omd setup` 命令，也不需要往 CLAUDE.md 写任何东西——安装就是一条 `dsh plugin add`，配置住在插件 Config（cordis profile 层）里，验装用 `/omd-doctor`。本技能走完 安装 → 配置 → 验装 → 更新 四步。

## 第一步 —— 安装

二选一：

```bash
# 从 npm（已发布包）
dsh plugin --profile <name> add oh-my-dsh

# 从本地检出（开发 / 预发布）
dsh plugin --profile <name> add /path/to/oh-my-deepseekharness        # 换成你机器上的检出路径
```

安装时发生了什么：

- 包内自带的 `cordis.patch.yml` 把 **`oh-my-dsh` 插件插入** profile 组合——协议段、双语 skill/角色卡、`/omd-doctor` `/omd-cancel` 命令、`omd_memory_*` 工具都由 `lib/index.js` 注册。
- 内置 MCP server（`omd-state`，18 个工具：state×5、notepad×6、prd×4、handoff×3）在运行时经 `apply()` 里的 `ctx.plugin()` **动态挂载**——静态 patch 表达不了包内绝对路径（规格 §7-1）。`failOnStartupError: false` 意味着 MCP 挂载坏了会降级（协议层播报）而不是炸掉宿主。

装完后**重启或重载 profile**（`dsh web` / 目标 profile）让插件树重载，再开新会话。

## 第二步 —— 配置（可选；默认值即可用）

Config 设在 profile 的插件实例上（cordis Config 层）。全部键与默认值：

| 键 | 默认 | 含义 |
|---|---|---|
| `language` | `zh` | 资产语言：`zh` 中文 / `en` 英文 / `both` 中文正文+英文术语 |
| `tiers.low` | `deepseek-chat` | 低档角色模型标识，或 `inherit` |
| `tiers.medium` | `deepseek-chat` | 中档角色模型标识，或 `inherit` |
| `tiers.high` | `deepseek-reasoner` | 高档角色模型标识，或 `inherit` |
| `roleOverrides` | `{}` | 角色级覆盖，如 `{ "omd-agent-code-reviewer": "provider/model" }` |
| `stateDir` | `.omd` | 项目状态目录名 |
| `autopilot.maxIterations` | `10` | autopilot goal 轮数上限（即 `create_goal` 的 `max_goal_rounds`） |
| `autopilot.maxQaCycles` | `5` | autopilot QA 循环界限 |
| `autopilot.maxValidationRounds` | `3` | autopilot 复验轮数界限 |
| `deepInterview.ambiguityThreshold` | `0.2` | deep-interview 歧义度门禁 |
| `deepInterview.maxRounds` | `20` | deep-interview 硬上限轮数 |
| `deepInterview.softWarningRounds` | `10` | deep-interview 软提醒轮数 |

注意：

- 模型路由只在 **`workflow` 路径硬生效**；`subagent` 继承主会话模型（软路由）。标识符写错在软路径是降级而非崩溃。`inherit` 表示跟随主会话模型。
- 模型运行时读不到插件 Config——生效值渲染在系统提示词 **omd 协议段的模型路由表**里。想确认当前生效值，看那里。
- omd **绝不擅自改用户文件**（规格 §5.5）：它会建议把 `.omd/` 加进 `.gitignore`，但不会替你动手。

## 第三步 —— 验装

在配好的 profile 里开个新会话，跑：

```
/omd-doctor
```

预期全绿：宿主版本落在 peerDep 范围；注册计数（40 个 skill / 19 个 `omd-agent-*` 角色卡 / 2 个命令 / 3 个 `omd_memory_*` 工具 / 18 个 `mcp__omd-state__*` 工具）；Config 标识符可解析；MCP 冒烟（`state_get_status` 有响应）；`.omd/` 可写。任何 ❌/⚠️ 行都由 doctor 自带修复建议。

记住：doctor 只证明安装与接线健康——**端到端可用性是独立的 E2E 门禁**（autopilot / ralph / team 各真实跑通一次，规格 §6.4）。

## 第四步 —— 更新

```bash
dsh plugin --profile <name> add oh-my-dsh@latest   # 或重新 add 更新后的本地路径
```

然后重载 profile。没有独立的迁移向导：Config 键保留默认值，`.omd/` 状态原样延续，`/omd-doctor` 重新验装即可。若未来版本改了 Config 键，release notes 会写明。

## 卸载 / 修复

- 卸载：`dsh plugin --profile <name> remove oh-my-dsh`，然后重载 profile。`.omd/` 项目状态留在磁盘上（不要就手动删）。
- 修复：注册计数缺口或 MCP 冒烟失败时，重新 add 插件（强制刷新 bundle）、重载、再跑 `/omd-doctor`。MCP 持续失败 → 看协议段的降级公告和 `omd-state` server 入口（`mcp-server/index.mjs`）。

## 状态契约

omd-setup 是安装/配置指引，**不持模式状态**：无 `state_write`/`state_clear`。它不改工作区任何东西；仅有的写入发生在 `dsh plugin` CLI 与 profile 的 cordis Config 层，由用户执行（或先经用户确认）。
