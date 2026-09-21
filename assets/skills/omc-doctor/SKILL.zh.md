---
name: omc-doctor
description: 已弃用（oh-my-dsh 中）——OMC（oh-my-claudecode，Claude Code 侧）安装诊断；仅保留为迁移期遗留体检清单。诊断 omd 安装本身请用 omd-doctor。
when-to-use: 仅当用户正从 oh-my-claudecode（Claude Code）迁移到 oh-my-dsh，并要求检查/清理 OMC 遗留物（~/.claude hooks、CLAUDE.md 标记、插件缓存）时使用。任何"诊断 omd"/"omd 不工作了"的请求应加载 omd-doctor。
---

# omc-doctor（omd 中已弃用——仅迁移期遗留体检）

> **弃用声明。** 本技能的 OMC 原版诊断的是 *Claude Code 上的 OMC 安装*：`~/.claude/plugins/cache/omc/` 插件缓存、`CLAUDE.md` 里的 `<!-- OMC:START -->` 标记、curl 时代遗留 hook 脚本、`omc` CLI。**这些产物在 oh-my-dsh 里一概不存在**——omd 是经 `dsh plugin add` 安装的 dsh 插件，无 CLI、无 CLAUDE.md、无 hook 脚本。诊断 omd 安装是 **omd-doctor** 的职责（宿主版本、注册计数、Config 可解析性、MCP 冒烟、`.omd/` 可写性、probe 矩阵）。本技能只在一个场景存活：用户曾在 Claude Code 上跑 OMC，迁往 omd 时想检查/清理 OMC 遗留。

## 何时改道

- "检查我的 omd 安装"、"omd doctor"、"omd 不工作了" → **加载 `omd-doctor`**，不要跑本清单。
- "我以前用 oh-my-claudecode，有没有残留 / 会不会和 omd 冲突？" → 跑下面的清单。

## 迁移期 OMC 遗留体检清单（默认只读）

所有路径尊重 `CLAUDE_CONFIG_DIR`；默认根为 `~/.claude`。每项落定 ✅ 干净 / ⚠️ 提示 / ❌ 发现遗留。**未经用户明确确认绝不删除任何东西**——本技能只提议，用户处置。

1. **CLAUDE.md 里的 OMC 标记** —— 查 `~/.claude/CLAUDE.md` 及任何 `CLAUDE-*.md` 伴随文件里的 `<!-- OMC:START -->` / `<!-- OMC:VERSION:... -->`。发现 → ⚠️ 提示：只影响 Claude Code 会话，不影响 dsh；删不删皆可。
2. **OMC 遗留 hook 脚本** —— `~/.claude/hooks/{keyword-detector,persistent-mode,session-start,stop-continuation}.{sh,mjs}`，以及 `~/.claude/settings.json` / 项目 `.claude/settings.json` 中引用它们的 `"hooks"` 条目。发现 → ⚠️；在 dsh 下是惰性文件，但若用户仍用 Claude Code 跑 OMC 可能造成重复行为。
3. **OMC 插件缓存** —— `~/.claude/plugins/cache/omc/oh-my-claudecode` 下的版本目录。多版本 → ⚠️ 陈旧缓存（Claude Code 侧清理）。
4. **curl 时代遗留资产** —— `~/.claude/{agents,commands,skills}/` 中与 OMC 插件资产同名的条目（如 `executor.md`、`planner.md`、`autopilot`、`ralph`、`omc-setup`）。只标记与 OMC 资产同名的文件；用户的自定义文件绝不标记。
5. **工作区里的 `.omc/` 目录** —— omd 的 `.omd/` 旁边躺着旧 `.omc/`。发现 → ⚠️ 提示：两者目录名不同、永不冲突；旧 `.omc/` 状态可由用户决定归档或删除。

## 报告格式

```
omc-doctor（迁移体检）— <日期>

| # | 检查项 | 状态 | 细节 |
|---|-------|------|------|
| 1 | CLAUDE.md 的 OMC 标记 | ✅/⚠️ | … |
| 2 | OMC 遗留 hooks/脚本 | ✅/⚠️ | … |
| 3 | OMC 插件缓存版本 | ✅/⚠️ | … |
| 4 | curl 时代遗留资产 | ✅/⚠️ | … |
| 5 | 工作区遗留 .omc/ | ✅/⚠️ | … |

注：本清单与 omd 健康无关。omd 验装请跑 /omd-doctor。
```

## 状态契约

omc-doctor **不持模式状态**：无 `state_write`/`state_clear`。它是只读检查；任何清理建议仅在用户明确确认后执行，且只针对 Claude Code / OMC 产物——绝不触碰 omd 自身文件。
