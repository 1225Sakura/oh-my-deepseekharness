---
name: deepinit
description: 深度代码库初始化——生成层级化 AGENTS.md 文档
when-to-use: 仓库缺少 AI 可读文档、agent/人类反复重新摸索结构时使用；生成覆盖每个目录的可导航 AGENTS.md 层级。已有 AGENTS.md 时用更新模式刷新。不适用于一次性原型或单文件脚本。
---

# deepinit（深度初始化）

在整个代码库中生成全面的、层级化的 AGENTS.md 文档。AGENTS.md 是 dsh 的一等项目规则面——本技能负责生成这个层级体系。

## 核心概念

AGENTS.md 是 **AI 可读文档**，帮助 agent 理解：
- 每个目录装什么
- 组件之间如何关联
- 在该区域工作的特殊指令
- 依赖与关系

## 层级标签体系

每个 AGENTS.md（根除外）带一个父引用标签：

```markdown
<!-- Parent: ../AGENTS.md -->
```

形成可导航层级：
```
/AGENTS.md                          ← 根（无父标签）
├── src/AGENTS.md                   ← <!-- Parent: ../AGENTS.md -->
│   ├── src/components/AGENTS.md    ← <!-- Parent: ../AGENTS.md -->
│   └── src/utils/AGENTS.md         ← <!-- Parent: ../AGENTS.md -->
└── docs/AGENTS.md                  ← <!-- Parent: ../AGENTS.md -->
```

## AGENTS.md 模板

```markdown
<!-- Parent: {到父级的相对路径}/AGENTS.md -->
<!-- Generated: {时间戳} | Updated: {时间戳} -->

# {目录名}

## Purpose
{一段话说明该目录装什么、扮演什么角色}

## Key Files
{每个重要文件配一行描述}

| File | Description |
|------|-------------|
| `file.ts` | 用途简述 |

## Subdirectories
{每个子目录配简述}

| Directory | Purpose |
|-----------|---------|
| `subdir/` | 装什么（见 `subdir/AGENTS.md`） |

## For AI Agents

### Working In This Directory
{给在此目录改文件的 agent 的特殊指令}

### Testing Requirements
{如何测试此目录的改动}

### Common Patterns
{此处使用的代码模式或约定}

## Dependencies

### Internal
{依赖的代码库其他部分}

### External
{关键外部包/库}

<!-- MANUAL: 此行以下手工添加的笔记在重新生成时保留 -->
```

## 执行流程

### 第 1 步：绘制目录结构

用 `subagent` 派出 `omd-agent-explore`：

```
subagent(prompt="用 glob 递归列出所有目录。排除：node_modules、.git、dist、build、__pycache__、.venv、coverage、.next、.nuxt、.omd")
```

### 第 2 步：建工作计划

用 `todo_write` 为每个目录生成 todo，按深度分层：

```
Level 0: /（根）
Level 1: /src、/docs、/tests
Level 2: /src/components、/src/utils、/docs/api
...
```

### 第 3 步：逐层生成

**重要**：先生成父层再生成子层，保证父引用有效。

对每个目录：
1. 读目录下所有文件
2. 分析用途与关系
3. 生成 AGENTS.md 内容
4. 带正确的父引用写文件

### 第 4 步：对比与更新（已存在时）

AGENTS.md 已存在时：

1. **读现有内容**
2. **识别区段**：
   - 自动生成区段（可更新）
   - 手工区段（`<!-- MANUAL -->` 保留）
3. **对比**：
   - 有新文件？
   - 有文件删除？
   - 结构变了？
4. **合并**：
   - 更新自动生成内容
   - 保留手工标注
   - 更新时间戳

### 第 5 步：校验层级

生成后跑校验：

| 检查 | 怎么验 | 纠正动作 |
|------|--------|----------|
| 父引用可解析 | 读每个 AGENTS.md，检查 `<!-- Parent: -->` 路径存在 | 修路径或删孤儿 |
| 无孤儿 AGENTS.md | 对照 AGENTS.md 位置与目录结构 | 删除孤儿文件 |
| 完整性 | 列出所有目录，检查是否有 AGENTS.md | 补生成缺失文件 |
| 时间戳新鲜 | 检查 `<!-- Generated: -->` 日期 | 重新生成过期文件 |

校验模式（用 dsh 工具，不用 shell）：
- 用 `glob` 的 `AGENTS.md` 模式找到所有 AGENTS.md。
- 用 `grep` 的 `<!-- Parent:` 模式审计全仓父引用。

## 智能委派

| 任务 | 角色 |
|------|------|
| 目录绘制 | `omd-agent-explore`（low 档，`subagent`） |
| 文件分析 | `omd-agent-architect`（high 档） |
| 内容生成 | `omd-agent-writer`（medium 档） |
| AGENTS.md 写入 | `omd-agent-writer` |

派出的 agent 是叶子执行者：禁止再 spawn 孙代理；它们返回发现/草稿，由编排会话负责写文件。

## 空目录处理

| 情况 | 动作 |
|------|------|
| 无文件、无子目录 | **跳过**——不创建 AGENTS.md |
| 无文件、有子目录 | 创建只列子目录的极简 AGENTS.md |
| 只有生成产物（*.min.js、*.map） | 跳过或极简 AGENTS.md |
| 只有配置文件 | 创建描述配置用途的 AGENTS.md |

纯容器目录的极简示例：
```markdown
<!-- Parent: ../AGENTS.md -->
# {目录名}

## Purpose
组织相关模块的容器目录。

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `subdir/` | 描述（见 `subdir/AGENTS.md`） |
```

## 并行规则

1. **同层目录**：并行处理（同一回合发多个 `subagent`）
2. **不同层**：串行（父先）
3. **大目录**：每个目录派专属 agent
4. **小目录**：多个打包进一个 agent

## 质量标准

### 必须包含
- [ ] 准确的文件描述
- [ ] 正确的父引用
- [ ] 子目录链接
- [ ] 给 AI agent 的指令

### 必须避免
- [ ] 泛泛的样板话
- [ ] 错误的文件名
- [ ] 断掉的父引用
- [ ] 漏掉重要文件

## 触发更新模式

在已有 AGENTS.md 的代码库上运行时：

1. 先探测现有文件
2. 读并解析现有内容
3. 分析当前目录状态
4. 生成现有与当前的 diff
5. 应用更新，保留手工区段

## 性能考虑

- **缓存目录清单**——不重复扫描同一目录
- **小目录打包**——一次处理多个
- **跳过未变**——目录没变就跳过重新生成
- **并行写**——多个 agent 同时起草不同文件

## 状态契约

deepinit **不持模式状态**：无 `state_write`/`state_clear`。交付物就是磁盘上的 AGENTS.md 文件（用户所有，是否 commit 由用户决定）——`.omd/` 下不写任何东西。中断后直接用更新模式重跑；现有文件与 `<!-- MANUAL -->` 区段按上述合并规则保留。
