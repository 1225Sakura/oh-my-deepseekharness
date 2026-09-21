---
name: wiki
description: LLM Wiki——.omd/wiki 下的持久 markdown 知识库，跨会话复利沉淀（Karpathy 模型），用普通文件工具维护
when-to-use: 用户想存、查、打理持久的项目/会话知识（"wiki 一下"、"wiki add"、"wiki query"、"wiki lint"），或重大发现应当沉淀为 wiki 页而不是随会话结束蒸发。
---

# wiki —— 持久 markdown 知识库

一个持久的、自维护的项目与会话知识 markdown 知识库（Karpathy 的 LLM Wiki 理念）：页面跨会话复利沉淀，而不是随上下文窗口蒸发。

**移植映射（OMC → dsh）。** OMC 用七个 `wiki_*` MCP 工具（ingest/query/lint/add/list/read/delete）支撑本技能。omd **没有 wiki MCP server**（规格明确：wiki 工具列二期）——同样的操作用普通文件工具对 `.omd/wiki/` 执行。方法论（分类、交叉引用、lint 检查、git 忽略存储）不变。

## 存储布局

```
.omd/wiki/
├── index.md            # 全页面目录（每次写入都要维护）
├── log.md              # append-only 操作编年
└── <category>/
    └── <page-slug>.md  # 带 YAML frontmatter 的 markdown
```

页面 frontmatter：

```markdown
---
title: Auth Architecture
category: architecture
tags: [auth, architecture]
updated: <ISO-8601>
---
```

## 操作（OMC wiki_* 工具的文件工具等价物）

| 操作 | 怎么做（dsh 文件工具） |
|---|---|
| **Ingest（收录）** | 把知识拆成一到多个页面；逐页 `write`，然后更新 `index.md`、追加 `log.md`。一次收录可触及多页——优先更新已有页面，别造近似重复页。 |
| **Add（快收）** | 单页快速收录：`write` 一个页面 + 目录 + 日志条目。 |
| **Query（查询）** | 对 `.omd/wiki/` 跑 `grep` 匹配关键词，按 frontmatter 的 `category`/`tags` 过滤；读命中的页面并**自己综合答案、附引用**（页面名）——没有搜索引擎，你就是搜索引擎。 |
| **List / Read** | 读 `index.md` / 读指定页面文件。 |
| **Delete** | 删页面文件，更新 `index.md`，追加日志。先经用户确认。 |
| **Lint（体检）** | 健康检查：孤儿页（不在 `index.md` 里）、陈旧内容（`updated` 远旧于项目近况）、断链的 `[[交叉引用]]`、过大页面（拆分候选）、页面间结构性矛盾。报告发现；修复需用户确认。 |

## 分类

`architecture`、`decision`、`pattern`、`debugging`、`environment`、`session-log`

## 交叉引用

页面间用 `[[page-slug]]` wiki 链接语法。slug 保持稳定——改名必须更新所有入链（lint 会抓漏）。

## 硬约束

- **不做向量嵌入**——查询只有关键词 + 标签匹配（grep 驱动）。
- wiki 页默认被 git 忽略：`.omd/`（含 `.omd/wiki/`）是项目本地的运行态产物。
- 优先更新页面而非增生页面；wiki 靠堆积复利，不靠复制复利。

## 自动捕获（二期）

OMC 靠 hook 在会话结束时把重大发现自动捕获为 `session-log` 页。omd MVP 未接线 hooks 桥（`dsh-hooks-claude-code` 是宿主原生包，二期接入），所以**捕获是手动的**：学到重要东西时立刻 wiki-add，别等会话结束。确定性的会话结束捕获 hook 是二期项。

## 状态契约

wiki **不持 omd 模式状态**：无 `state_write`/`state_clear`。它的全部状态就是它维护的 `.omd/wiki/` 内容。短生命周期的随手记请用 notepad MCP 工具（`mcp__omd-state__notepad_*`）；wiki 只装要复利沉淀的知识。
