---
name: skill
description: 管理本地 dsh 技能——list、add、remove、edit、search、info、sync、setup 向导
when-to-use: 用户想管理技能——查看已安装的技能、创建新技能、编辑或删除已有技能、搜索技能库、在用户与项目作用域之间同步技能。仅限显式调用。
---

# skill（技能管理）

管理 dsh 技能的 meta-skill，以 CLI 式子命令工作（`skill list`、`skill add <name>`……）。无参数调用时运行 setup 向导（`skill setup`）。

## dsh 技能系统语义

- **技能格式**：每个技能是一个目录，内含 `SKILL.md`，带 YAML frontmatter——`name`（必须等于目录名）、`description`（一行）、`when-to-use`（一行）。frontmatter 键名只允许 `[A-Za-z-]`。双语项目可选配 `SKILL.zh.md` 中文副本。
- **扫描根**（三个作用域）：
  - **omd 内置**：已安装 oh-my-dsh 插件包内的 `assets/skills/` 目录——可发现、可读，绝不通过本技能删除或编辑
  - **用户**：`~/.dsh/skills/`——对该操作者跨全部项目可用
  - **项目**：`.dsh/skills/`——随仓库 commit，与团队共享
- **调用方式**：dsh 注册的技能按名字 user-invocable 且 model-invocable；没有 OMC 式的插件市场或生成的命令目录——添加技能就是把它的目录写进某个扫描根。
- **没有质量/用量统计**：OMC 基于 mnemosyne 的质量分与使用计数在 omd 中不存在；不要编造。
- **模板字段差异**：OMC 技能模板的 `id`/`source`/`quality`/`triggers` 等 frontmatter 字段在 dsh 无对应物，舍弃——omd 模板只保留 `name`/`description`/`when-to-use`（触发词由 omd 关键词注册表承担，不写进技能文件）。

## 子命令

### skill list

按作用域组织展示全部可用技能。

**行为：**
1. 扫描插件 `assets/skills/` 目录里的 omd 内置技能（只读）
2. 扫描用户技能 `~/.dsh/skills/`
3. 扫描项目技能 `.dsh/skills/`
4. 解析 YAML frontmatter（`name`、`description`、`when-to-use`）取元数据
5. 以表格展示：

```
BUILT-IN SKILLS (bundled with oh-my-dsh, read-only):
| Name              | Description                    | Scope    |
|-------------------|--------------------------------|----------|
| ralph             | PRD 驱动的持久循环             | built-in |
| verify            | 证据支撑的完成验证             | built-in |

USER SKILLS (~/.dsh/skills/):
| Name              | Description                    | Scope    |
|-------------------|--------------------------------|----------|
| error-handler     | 项目专属错误模式               | user     |

PROJECT SKILLS (.dsh/skills/):
| Name              | Description                    | Scope    |
|-------------------|--------------------------------|----------|
| test-runner       | 本仓库如何跑测试               | project  |
```

---

### skill add [name]

创建新技能的交互向导。

**行为：**
1. **询问技能名**（若未提供）——校验：小写、只用连字符、无空格
2. **询问 description**——简洁一行
3. **询问 when-to-use**——一行，点名应触发该技能的情形
4. **询问作用域：**
   - `user` → `~/.dsh/skills/<name>/SKILL.md`
   - `project` → `.dsh/skills/<name>/SKILL.md`
5. **用模板创建技能文件**：

```markdown
---
name: <name>
description: <description>
when-to-use: <when-to-use>
---

# <Name>

## Purpose

[描述这个技能做什么]

## When to Use

[描述触发本技能的情形]

## Workflow

1. [步骤 1]
2. [步骤 2]
3. [步骤 3]

## Notes

[补充上下文、边界情况、坑]
```

6. **报告成功**并附文件路径
7. **建议**："用 `skill edit <name>` 继续定制内容"

---

### skill remove <name>

按名字删除技能。

**行为：**
1. **在两个可写作用域中查找**：
   - `~/.dsh/skills/<name>/SKILL.md`
   - `.dsh/skills/<name>/SKILL.md`
2. **找到**：展示技能信息（name、description、scope）并**请求确认**："Delete '<name>' skill from <scope>? (yes/no)"
3. **确认后**：删除整个技能目录，报告 "✓ Removed skill '<name>' from <scope>"
4. **未找到**：报告 "✗ Skill '<name>' not found in user or project scope"

**安全**：无显式确认绝不删除。omd 内置技能绝不可通过本技能移除。

---

### skill edit <name>

交互式编辑已有技能。

**行为：**
1. 按名字**找到技能**（搜两个可写作用域）
2. 用 `read` 工具**读当前内容**
3. **展示当前值**（name、description、when-to-use、scope）
4. **询问要改什么：**
   - `description`——更新描述
   - `when-to-use`——更新触发条件
   - `content`——编辑完整 markdown 正文
   - `rename`——重命名（移动目录并更新 frontmatter 的 `name`）
   - `cancel`——不改退出
5. **对所选字段**：展示当前值、询问新值、更新 YAML frontmatter 或正文、用 `edit`/`write` 写回
6. **报告成功**并附改动摘要

---

### skill search <query>

按 name、description、when-to-use 或正文搜索技能。

**行为：**
1. 扫描全部三个作用域的所有技能
2. 大小写不敏感地匹配 name、description、when-to-use、完整 markdown 正文
3. 带上下文展示匹配：

```
Found 2 skills matching "typescript error":

1. typescript-fixer (user)
   Description: Fix common TypeScript errors
   Match: "typescript error handling patterns"

2. lint-fix (project)
   Description: Auto-fix linting errors
   Match: "TypeScript ESLint error resolution"
```

**排序**：name/when-to-use 命中的排在正文命中之前。

---

### skill info <name>

展示技能的详细信息。

**行为：**
1. 按名字**找到技能**（搜全部三个作用域）
2. **解析 YAML frontmatter** 与正文
3. **展示完整细节**：name、scope、description、when-to-use、文件路径、双语状态（是否有 `SKILL.zh.md`），然后是完整内容
4. **未找到**：报告错误并建议 `skill search`

---

### skill sync

在用户与项目作用域之间同步技能。

**行为：**
1. 扫描两个可写作用域（`~/.dsh/skills/`、`.dsh/skills/`）
2. 对比分类：仅用户侧、仅项目侧、两侧皆有
3. 展示同步机会并提供选项：
   - [1] 复制用户技能到项目
   - [2] 复制项目技能到用户
   - [3] 查看两侧皆有技能的差异
   - [4] 取消
4. 处理用户选择，每次复制都要确认

**安全**：未经确认绝不覆盖。

---

### skill setup

设置与管理本地技能的交互向导。

**行为：**

#### 第 1 步：目录检查与创建

```powershell
# 用户级技能目录
$UserSkillsDir = Join-Path $HOME '.dsh\skills'
if (Test-Path $UserSkillsDir) { "User skills directory exists: $UserSkillsDir" }
else { New-Item -ItemType Directory -Force $UserSkillsDir | Out-Null; "Created: $UserSkillsDir" }

# 项目级技能目录
$ProjectSkillsDir = '.dsh\skills'
if (Test-Path $ProjectSkillsDir) { "Project skills directory exists: $ProjectSkillsDir" }
else { New-Item -ItemType Directory -Force $ProjectSkillsDir | Out-Null; "Created: $ProjectSkillsDir" }
```

#### 第 2 步：技能扫描与盘点

扫描两个目录（在每个根下 `glob` 找 `**/SKILL.md`，解析 frontmatter 的 `name`/`description`），展示带修改时间的清单与总数。

#### 第 3 步：快捷操作菜单

用 `ask_user_question` 工具提供选项：

1. **Add new skill**——启动创建向导（`skill add`）
2. **List all skills with details**——完整盘点（`skill list`）
3. **Scan conversation for patterns**——分析当前会话中值得固化的模式，用户挑中的用 `skillify` 提炼
4. **Import skill**——从 URL 或粘贴内容导入
5. **Done**——退出向导

**选项 3：扫描会话找模式**

关注：最近调试中得到的不显然的解法、需要排查的棘手 bug、代码库专属的变通方案、花了时间才解决的错误模式。报告发现，并询问是否用 `skillify` 提炼其中条目。

**选项 4：导入技能**

让用户提供 URL（用 `read_page` 抓取）或直接粘贴 markdown 内容，然后询问作用域（user 或 project）。校验 dsh 技能格式（frontmatter 含 `name`/`description`/`when-to-use`，键名合法，目录名与 `name` 一致）后存入所选位置。

---

### skill scan

快速扫描两个可写技能目录（`skill setup` 第 2 步，不带向导）。

---

## 技能模板

经 `skill add` / `skill setup` 创建技能时提供这些模板：

### 错误解法模板

```markdown
---
name: error-[short-slug]
description: [特定上下文中某具体错误] 的解法
when-to-use: 出现错误 "[exact message fragment]"（位于 [specific context]）时
---

# [Error Name]

## The Insight
这个错误的根因是什么？你发现了什么原理？

## Why This Matters
不知道它会出什么问题？什么症状把你引到这里？

## Recognition Pattern
- Error message: "[exact error]"
- File: [specific file path]
- Context: [when does this occur]

## The Approach
1. [带文件/行号的具体动作]
2. [带文件/行号的具体动作]
3. [验证步骤]

## Example
\`\`\`
// Before (broken) / After (fixed)
\`\`\`
```

### 工作流技能模板

```markdown
---
name: workflow-[short-slug]
description: 本代码库中 [specific task] 的流程
when-to-use: [应触发它的任务描述或目标关键词]
---

# [Workflow Name]

## The Insight
这个工作流与显而易见的做法有何不同？

## Why This Matters
不照这个流程会出什么错？

## Recognition Pattern
- Task type: [specific task]
- Files involved: [specific patterns]
- Indicators: [how to recognize]

## The Approach
1. [带具体命令/文件的步骤]
2. [带具体命令/文件的步骤]
3. [验证]

## Gotchas
- [常见错误及规避方法]
- [边界情况及处理方式]
```

### 代码模式模板

```markdown
---
name: pattern-[short-slug]
description: 本代码库中 [specific use case] 的模式
when-to-use: 在 [file types / problem domain] 上工作且出现 [recognition cue] 时
---

# [Pattern Name]

## The Insight
这个模式背后的关键原理是什么？

## Why This Matters
它在**这个**代码库解决什么问题？

## Recognition Pattern
- File types: [specific files]
- Problem: [specific problem]
- Context: [codebase-specific context]

## The Approach
1. [基于原理的步骤]
2. [基于原理的步骤]

## Anti-Pattern
不该怎么做，为什么。
```

### 集成技能模板

```markdown
---
name: integration-[short-slug]
description: 本代码库中 [system A] 与 [system B] 的集成方式
when-to-use: 改动 [system A] 与 [system B] 之间的集成时
---

# [Integration Name]

## The Insight
这两个系统的连接有什么不显然之处？

## Why This Matters
不理解这个集成会改坏什么？

## Recognition Pattern
- Files: [specific integration files]
- Config: [specific config locations]
- Symptoms: [what indicates integration issues]

## The Approach
1. [带文件路径的配置步骤]
2. [带具体细节的 setup 步骤]
3. [验证步骤]

## Gotchas
- [集成专属坑 #1]
- [集成专属坑 #2]
```

---

## 错误处理

**所有命令必须处理：**
- 文件/目录不存在
- 权限错误
- 非法 YAML frontmatter
- 技能名重复
- 非法技能名（空格、特殊字符）

**错误格式：**
```
✗ Error: <clear message>
→ Suggestion: <helpful next step>
```

---

## 使用模式

### 直接命令模式

带参数调用时跳过交互向导：`skill list`、`skill add`、`skill scan` 等。

### 交互模式

无参数调用时运行完整向导（`skill setup`）。

---

## 本地技能的好处

**自动应用**：harness 经 `when-to-use` 浮现匹配的技能——不需要记住或搜索解法。

**版本控制**：项目级技能（`.dsh/skills/`）应随代码 commit，全队受益。在 linked worktree 中，未 commit 的技能仍是该 worktree 本地的，worktree 删除即消失。

**知识进化**：随着更好的做法被发现、`when-to-use` 条件被打磨，技能随时间变好。

**节省 token**：模型直接套用已知模式，不再重复解同一个问题。

**代码库记忆**：保存否则会在会话历史中流失的 institutional knowledge。

---

## 技能质量准则

好技能的特征：

1. **Google 不到**——搜索引擎轻易查不到
   - 差："How to read files in TypeScript"
   - 好："This codebase uses custom path resolution requiring fileURLToPath"

2. **语境专属**——引用**这个**代码库的真实文件/错误
   - 差："Use try/catch for error handling"
   - 好："The aiohttp proxy in server.py:42 crashes on ClientDisconnectedError"

3. **精确可执行**——明确说清做什么、在哪做
   - 差："Handle edge cases"
   - 好："When seeing 'Cannot find module' in dist/, check tsconfig.json moduleResolution"

4. **来之不易**——付出过真实调试成本
   - 差：通用编程套路
   - 好："Race condition in worker.ts — Promise.all at line 89 needs await"

---

## 相关技能

- `skillify`——从当前会话提炼技能
- `remember`——把耐久知识路由进 notepad / 项目记忆（比技能轻）
- `deepinit`——生成 AGENTS.md 代码库层级

## 实现注意

1. **YAML 解析**：只做 frontmatter 提取；对未知键格式优雅降级
2. **文件操作**：用 `read`/`write`/`edit` 工具；新文件绝不用 `edit`
3. **用户确认**：破坏性操作必须确认
4. **清晰反馈**：用 ✓ / ✗ / →
5. **作用域解析**：内置作用域只读；写入只发生在 user 或 project 作用域
6. **校验**：强制命名约定（小写、只用连字符）与 `[A-Za-z-]` frontmatter 键名规则

## 状态契约

skill **不持模式状态**。它不做 `state_write`/`state_clear`；唯一的副作用是它在 user/project 扫描根下创建、编辑、移动或删除的技能文件。在外层模式内被调用时，模式持久化由外层模式的状态契约管辖。
