---
name: external-context
description: 并行 spawn document-specialist 子代理做外部 web 检索与文档查找
when-to-use: 问题需要外部文档、参考资料或 web 上下文——最佳实践、库对比、框架最新模式。仅限显式调用；仓库本地问题用 research。
---

# external-context（外部上下文）

为一个查询抓取外部文档、参考与上下文。把查询分解成 2-5 个 facet，并行 spawn `omd-agent-document-specialist` 子代理。

## 用法

```
external-context <主题或问题>
```

### 示例

```
external-context Node.js 中 JWT token 轮换的最佳实践是什么？
external-context 对比 PostgreSQL 下 Prisma 与 Drizzle ORM
external-context React Server Components 的最新模式与惯例
```

## 协议

### 步骤 1：Facet 分解

把查询分解成 2-5 个相互独立的检索 facet：

```markdown
## 检索分解

**查询：** <原始查询>

### Facet 1：<facet 名>
- **检索焦点：** 要搜什么
- **来源：** 官方文档、GitHub、博客等

### Facet 2：<facet 名>
...
```

### 步骤 2：并行子代理调用

用 `subagent` 工具并行（后台）发起各独立 facet，每个都带上 `omd-agent-document-specialist` 角色卡：

```
subagent(description="Facet: <facet 名>", run_in_background=true, prompt="<omd-agent-document-specialist 角色卡>

任务：检索：<facet 描述>。用 web_search 和 read_page 找官方文档与示例。所有来源附 URL 引用。")
```

最多 5 个并行 document-specialist 子代理。综合前先收齐每个子代理的最后一条消息。

> OMC 对照：原版用 `Task(subagent_type="oh-my-claudecode:document-specialist", model="sonnet", ...)` 加 WebSearch/WebFetch。omd 的 `subagent` 工具继承主会话模型（软路由）——prompt 里传入的角色卡才是它成为 document-specialist 的依据；`web_search` / `read_page` 是 WebSearch/WebFetch 的 dsh 等价物。

### 步骤 3：综合输出格式

按此格式呈现综合结果：

```markdown
## 外部上下文：<查询>

### 关键发现
1. **<发现>** - 来源：[标题](url)
2. **<发现>** - 来源：[标题](url)

### 详细结果

#### Facet 1：<名称>
<带来源的聚合发现>

#### Facet 2：<名称>
<带来源的聚合发现>

### 来源
- [来源 1](url)
- [来源 2](url)
```

## 配置

- 最多 5 个并行 document-specialist 子代理
- 无关键词触发——仅限显式调用

## 状态契约

external-context **不持模式状态**：一次性的 fan-out 加综合，不在 `.omd/state/` 下写任何内容。值得跨会话保留的发现，显式写 `mcp__omd-state__notepad_write_working` / `notepad_write_priority`。
