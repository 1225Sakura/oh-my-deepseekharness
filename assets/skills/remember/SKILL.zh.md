---
name: remember
description: 盘点会话中沉淀的可复用知识，决定它该进项目记忆、notepad 还是持久文档
when-to-use: 用户想保存或整理本会话发现的有用知识——把耐久事实、操作者偏好、踩坑结论晋升到正确的记忆面。不用于暂态任务状态。
---

# remember（记忆归档）

用户想把会话中发现的有用知识保存或组织起来时，使用本技能。

## 目标

把耐久、可复用的知识晋升到正确的记忆面，而不是让它们埋在聊天记录里。

## 记忆面（omd 映射）

- **项目记忆** —— 耐久的团队/项目知识。写入用插件内工具 `omd_memory_set({ projectPath, key, value })`，读取用 `omd_memory_get`，删除用 `omd_memory_delete`（profile 层存储，按项目路径隔离——替代 OMC 的 `project_memory_*` MCP 工具与 `.omc/project-memory.json`，见规格分歧表）。
- **Notepad priority** —— 高信号、需要长期保留的上下文。写入用 `mcp__omd-state__notepad_write_priority({ cwd, text })`。
- **Notepad working** —— 当前会话的临时笔记（7 天过期）。写入用 `mcp__omd-state__notepad_write_working({ cwd, text })`。
- **文档 / AGENTS 文件** —— 真正属于仓库的持久指令与约定（`AGENTS.md`、`CLAUDE.md`、`docs/`）——知识确实是仓库纪律时才直接改文件。

注意：OMC 靠 hook 捕获模型输出里的 `<remember>x</remember>` 标签；dsh 没有等价 hook 面，omd 把捕获改为**显式工具调用**——没有标签语法，直接调 notepad 工具（规格分歧表）。

## 流程

1. 收集会话中的相关发现。
2. 逐条分类：
   - 耐久的项目事实
   - 临时工作笔记
   - 操作者偏好或指令
   - 重复 / 过期 / 相互矛盾的信息
3. 为每条提出最合适的归宿。
4. 只写入或更新合适的那个记忆面。
5. 指出应当清理的重复或冲突。

## 规则

- 不要把所有东西倒进同一个存储。
- 耐久的团队知识优先进项目记忆（`omd_memory_*`）。
- 短期工作上下文优先进 notepad。
- 条目保持简洁、可执行。
- 不确定的内容标注为不确定，不要当事实存储。

## 输出

- 存了什么
- 存到了哪里
- 发现的重复/冲突

## 状态契约

remember **不持模式状态**。它不做 `state_write`/`state_clear`；唯一的持久化是上面的记忆面——notepad 条目落在 `.omd/notepad.md`（经 MCP 工具），项目记忆落在 profile 层存储（经 `omd_memory_*`）。在外层模式内运行时，模式持久化由外层模式的状态契约管辖。
