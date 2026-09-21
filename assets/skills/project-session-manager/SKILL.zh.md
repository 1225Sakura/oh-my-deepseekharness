---
name: project-session-manager
description: worktree 优先的隔离开发环境——为 issue、PR、feature 建独立 worktree 与 dsh 会话，git worktree + 提供商 CLI（gh/jira）方法论的 dsh 适配版
when-to-use: 用户想为评审 PR、修 issue、开发 feature 建一个与当前工作隔离的环境（"开个 worktree 评审 PR #123"、"给 issue #42 建个会话"、"psm"、"teleport"）。OMC 的 psm.sh/omc teleport CLI 在 omd 中不存在——本技能用 plain git/gh 命令 + dsh 会话执行同一套方法论。
---

# Project Session Manager（worktree 优先的隔离开发环境）

**移植说明（先读）。** OMC 原版带 bash 实现（`psm.sh`、`omc teleport` CLI、tmux 会话编排、`~/.psm/` 注册表）。omd **没有 CLI、没有 tmux 集成**——本移植保留方法论骨架（worktree 优先隔离、提供商驱动的元数据、生命周期卫生），用 dsh 实际拥有的工具执行：`pwsh`/shell 跑 `git` 与提供商 CLI，**一个 worktree 一个 dsh 会话**作为"会话"概念，`.omd/` 存元数据。tmux 编排与托管会话注册表无法忠实复现的部分标注为**二期**。

## 核心思想

一个任务 = 一个 git worktree = 一个 dsh 会话。PR 评审、issue 修复、feature 开发并行推进，互不污染当前检出。

## 快速开始（teleport 等价物，仅 worktree）

```bash
# issue/PR worktree（GitHub，在仓库根目录跑）
git fetch origin pull/123/head:pr-123-review   # PR 引用；issue 则从 main 拉分支
git worktree add ../worktrees/pr-123 pr-123-review

# feature worktree
git fetch origin main
git worktree add ../worktrees/feat-add-webhooks -b feature/add-webhooks origin/main

# 列出 / 移除
git worktree list
git worktree remove ../worktrees/pr-123 --force
```

然后**以该 worktree 为工作目录**开一个 dsh 会话，把任务简报交给它（见下文"会话启动"）。

## 会话类型与命名

| 类型 | 触发 | 分支约定 | worktree 目录（建议） |
|---|---|---|---|
| PR 评审 | `review <repo>#<n>` | `pr-<n>-review`（fetch `pull/<n>/head`） | `<worktree_root>/pr-<n>` |
| issue 修复 | `fix <repo>#<n>` | `fix/<n>-<slug>` | `<worktree_root>/issue-<n>` |
| feature | `feature <name>` | `feature/<name>` | `<worktree_root>/feat-<name>` |

`<worktree_root>` 建议：仓库旁 sibling 的 `../worktrees/` 或用户自选根目录——omd 不强加 `~/.psm/`。每个用户保持一致即可。

## 提供商引用

支持的引用格式（用提供商 CLI 解析，默认 GitHub `gh`）：

- `owner/repo#123`、`alias#123`（alias 是用户自己的映射，见下）、完整 GitHub URL、或当前仓库裸 `#123`。

建 worktree 前先取上下文：

```bash
gh pr view 123 --repo owner/repo --json number,title,author,headRefName,baseRefName,body,url
gh issue view 42 --repo owner/repo --json number,title,body,labels,url
```

Jira（或其他 tracker）：同理——tracker 供 issue 文本，git 供仓库。`PROJ-123` 引用用 `jira` CLI。仅当用户说过 PROJ 是 tracker 项目时才把 `PROJ-123` 当 tracker 引用（避免把 `FIX-123` 这类分支名误判）。

可选项目别名文件：用户想要别名的话，维护一个小 JSON（如锚点仓库里的 `.omd/psm-projects.json`，或用户自名的全局文件），映射 `alias → { repo, local, default_base, provider? }`。替代 `~/.psm/projects.json`。

## 会话元数据

往每个 worktree 丢一份元数据文件，让后续任何会话都能重建上下文：

```json
// <worktree>/.omd-psm-session.json
{
  "id": "myrepo:pr-123",
  "type": "review",
  "ref": "pr-123",
  "branch": "pr-123-review",
  "base": "main",
  "created_at": "<ISO-8601>",
  "worktree_path": "<绝对路径>",
  "source_repo": "<绝对路径>",
  "provider": { "kind": "github", "number": 123, "title": "…", "author": "…", "url": "…" },
  "state": "active"
}
```

## 会话启动

1. 解析引用 → 用提供商 CLI 取 PR/issue/feature 上下文。
2. 建分支 + worktree（命令见上）。
3. 写元数据文件。
4. 在该 worktree 开 dsh 会话，给它一份自包含简报，例如：
   - 评审：`Review PR #123: "<title>" by @<author> (<head> → <base>). URL: <url>. 加载 review 技能。`
   - 修复：`Fix issue #42: "<title>". URL: <url>. Branch: <branch>.`
   - feature：`Implement feature "<name>" for <project>. Branch: <branch>.`

**dsh 现实：** 没有可以在 tmux 里拉起的 `claude` CLI，也没有 `tmux send-keys` 投送。"attach" = 打开/切换到 cwd 是该 worktree 的 dsh 会话。用户真要 tmux 托管终端的话，那是用户自己驱动的外部配置——omd 如实说明但不编排（二期候选）。

## 生命周期

- **list**：源仓库里 `git worktree list` + 在 worktree 根下 glob `.omd-psm-session.json`。
- **status**：读当前 worktree 的元数据文件。
- **kill/关闭**：`git worktree remove <path> --force`（先确认没有未合并工作），删元数据，可选删分支。
- **cleanup**：逐个会话查提供商状态——`gh pr view <n> --json state,merged` / `gh issue view <n> --json state`——移除 PR 已合并 / issue 已关闭的 worktree。报告保留与移除。建议默认保留期：未动的 worktree 14 天（有未提交改动的一律先问）。

## 错误处理

| 错误 | 处置 |
|---|---|
| worktree 路径已存在 | 提供选项：复用（直接在那开会话）、重建（remove + add）、放弃 |
| PR/issue 找不到 | 核对引用与仓库权限（`gh auth status`） |
| 没有 `gh` | 提示安装 GitHub CLI；非 GitHub 宿主用对应 CLI 或手动解析引用 |
| 移除时有未提交改动 | 停下来问——绝不静默强删 |

## omd 状态注意

每个 worktree 有**自己的 `.omd/` 状态目录**（状态锚定在会话 cwd）。模式状态（autopilot/ralph/team）不在主检出与 worktree 之间传递——这是设计使然，隔离就是目的。若将来需要跨 worktree 共享状态，那是二期设计项（对照 OMC 的 `.omc-workspace` 标记）。

## 二期缺口（明确未移植）

- `psm.sh` 脚本与 `omc teleport` CLI（omd 无 CLI 面）
- tmux 会话创建/attach 与 `send-keys` 投送提示词
- `~/.psm/sessions.json` 全局注册表 + `cleanup_after_days` 自动化
- `claude --dangerously-skip-permissions` 自动拉起

## 状态契约

project-session-manager **不持 omd 模式状态**：无 `state_write`/`state_clear`。唯一的持久产物是它创建的 git worktree/分支和各 worktree 内的 `.omd-psm-session.json` 元数据。破坏性步骤（移除 worktree、删分支）一律需用户明确确认。
