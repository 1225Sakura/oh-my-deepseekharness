---
name: drydock
description: 在任意仓库铺设船坞龙骨——四柱共享环境（上下文、规则、工具、标准）落到各个承载面（CLAUDE.md、项目技能、design-system、scripts、共享上下文），让每个人类与 agent 继承同一套设计语言、人人都能交付。每仓库跑一次；用 --check 复审漂移。
when-to-use: 开一个人类与 agent 共建的仓库；知识只存在于人脑和聊天记录而非文件；新成员/新 agent 应该靠阅读而非靠问来继承上下文。不适用于无协作者的一次性原型；已在跑该 harness 的仓库改用 --check。
---

# drydock（铺龙骨）

为**船坞**铺龙骨：一个仓库、一套共享 harness、每个贡献者继承它。本技能搭起把"人人都能交付"变成"人人都用同一套设计语言交付"的环境——创建各承载面、最小化播种、接好负责填充它们的流程（launch 写 CONTEXT/ADR；launch C5 沉淀与 review 沉淀标准），并报告什么已存在、什么被创建、什么有意留空。

四柱及其物理落点：

| 柱 | 承载面 |
|---|---|
| 上下文（共享背景） | `CONTEXT.md`（术语表）+ `docs/business/` + `docs/adr/` + omd notepad 记忆 |
| 规则（边界） | `CLAUDE.md`（薄入口：约定、原则、索引；dsh 把 CLAUDE.md/AGENTS.md 当项目规则读）+ `docs/standards/` |
| 工具（可组合能力） | `.omd/skills/`（项目技能——`.omd/` 内刻意的可提交例外）+ `scripts/` |
| 标准（船级社） | `design-system/`（tokens、组件、模式）+ `docs/standards/` |

隐喻对照：船坞是共享设施；船级社（`docs/standards/` + `design-system/`）定船只适航必须通过的规则；drydock 铺龙骨；launch 把船送下水。

**dsh 适配说明**：OMC 的 `.mcp.json` 承载面在 dsh 下没有仓库内等价物——MCP server 集成声明在 dsh profile 的 cordis patch / 插件配置里，不在仓库里。因此工具柱在仓库内由 `.omd/skills/` + `scripts/` 构成；profile 级 MCP 接线改记到 `docs/standards/process.md`。

## 何时使用

- 开一个人类与 agent 共建的仓库
- 知识只存在于人脑和聊天记录而非文件的仓库
- onboarding：新队友或新 agent 应靠阅读继承上下文，而不是靠问

## 何时不用

- 无协作者的一次性原型
- 已在跑该 harness 的仓库（改用 `--check`）

## 流程

### 1. 探测（绝不覆盖）

写任何东西之前先盘点（用 `glob`/`read`，不靠 shell 猜）：

- `CLAUDE.md` 在吗？`AGENTS.md` 在吗？（规则：任一存在就原地扩展；把缺失的那个建成一行指针指向另一个；**绝不两个都新建**）
- `CONTEXT.md`、`docs/adr/`、`docs/standards/`、`docs/business/`、`design-system/`、`.omd/skills/`、`scripts/`、`.gitattributes`——哪些在、哪些缺？
- omd 插件装了吗？——只在 omd 会话内值得查（看系统提示词的 omd 协议段和 `mcp__omd-state__*` 工具）；不在就静默跳过（有没有 omd，harness 都能跑）

先报告地图，再动手。

### 2. 先定文档语言，只问探测答不了的问题

生成 harness 文件的文档语言是一个文件承载的决定，不是会话状态。严格按此契约：

<!-- shipyard-document-language-contract:start -->
```json
{
  "schemaVersion": 1,
  "authority": { "path": "CONTEXT.md", "frontmatterKey": "documentLanguage" },
  "canonicalSources": ["CLAUDE.md", "README.md"],
  "askOn": ["missing", "mixed", "conflict", "low-confidence", "invalid-explicit", "script-ambiguous"],
  "tagPattern": "^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$",
  "scriptVariants": ["zh-Hans", "zh-Hant"],
  "seedCompanionPrefixes": { "en": "en", "zh-Hans": "zh-Hans", "zh-Hant": "zh-Hant" },
  "stableTokens": [
    "CONTEXT.md", "documentLanguage", "launch", "--serial",
    "plan", "execute", "review", "verify", "blockedBy",
    "pending", "in_progress", "completed", "failed", "ready-for-agent",
    "id", "name", "description", "triggers", "```",
    "<Project>", "<term>", "<feature-slug>"
  ]
}
```
<!-- shipyard-document-language-contract:end -->

解析顺序：

1. 当次调用中人类的显式选择合法时优先。归一化为稳定的 BCP 47 风格标签：语言小写、文字 Title-Case、地区大写。非法显式输入必须问一次，不许猜。
2. 否则读 `CONTEXT.md` 顶部 YAML frontmatter 的 `documentLanguage`。合法且文字无歧义的标签对新的 Drydock / Launch 调用是权威。若持久化的标签是裸 `zh` 或只带地区的中文，在该权威层问一次；绝不用来源推断绕过它。
3. 标记缺失或非法时，按序检查权威来源：先 `CLAUDE.md`，再 `README.md`。仅当每个可用来源都有一个无歧义的主导语言、且所有可用来源归一化到同一标签时才可推断。另一来源缺失或为空时，一个无歧义来源即足够。
4. 中文必须解析到显式带文字的标签：`zh-Hans` 或 `zh-Hant`（可选再带地区）。裸 `zh` 和只带地区的中文标签是文字歧义，必须问一次而不是替用户选 companion。companion 选择用最长语言/文字前缀：`zh-Hans-*` 选 `zh-Hans`，`zh-Hant-*` 选 `zh-Hant`；完整归一化标签（如 `zh-Hans-CN`）原样存入 `CONTEXT.md`。
5. 无可用来源、语言混杂、标签冲突、低置信推断、非法显式输入、文字歧义中文——都必须触发一次打包的语言提问（用 `ask_user_question`）。不许猜。拿不到答案，在写任何本地化产物前停下。
6. 脚手架之前，把解析出的标签写进 `CONTEXT.md` 的确切稳定 frontmatter 键 `documentLanguage`（新建或扩展其 frontmatter，键名不翻译）。这个可见文件是初始化报告的语言权威；不建守护进程、不建隐藏台账、不建运行时状态。

只有散文和面向人类的标签/可本地化值跟随所选语言；结构性键保持语言稳定。路径、flag、代码围栏、占位符、frontmatter 键与机器语义值、YAML/JSON 键、生命周期 token、状态枚举、ID、`blockedBy`、解析器/控制 token 全部逐字节稳定。

语言定了之后才问剩余问题（用 `ask_user_question`）：

- 包/技术栈（给 standards 和 design-system 播种用）
- 这个仓库有 UI 吗？（无 UI → design-system/ 建成带说明的 stub，或应请求跳过）
- issue tracker 在哪（GitHub / GitLab / 本地 `.scratch/`）——V1 harbor intake 只支持 GitHub；同时记录维护者的沟通授权（issue 评论、改 label）——供 harbor 的 intake 队列消费

### 3. 脚手架（只建缺失面——seed 按文档语言渲染）

```
CLAUDE.md                      # 薄入口——见 seed A
CONTEXT.md                     # 术语表——见 seed B
.gitattributes                 # * text=auto eol=lf（灭掉 Windows 的 CRLF 警告噪音）
docs/adr/0001-adopt-shipyard-harness.md
docs/standards/architecture.md # seed C
docs/standards/data.md
docs/standards/process.md
docs/business/README.md        # seed D
design-system/README.md        # seed E（仅 UI 仓库；否则 stub）
design-system/tokens/README.md
.omd/skills/README.md          # seed F
scripts/README.md
```

seed 范例是参考 companion，绝不混合输出。解析出 `documentLanguage` 后**只选一个** companion；不要从另一 companion 带出重复标题或标签。用最长匹配的语言/文字前缀：`en-*` 用英文、`zh-Hans-*` 用简体、`zh-Hant-*` 用繁体，同时 Seed B 把完整解析标签写进 `documentLanguage`。其他合法标签：把英文 canonical companion 翻译一次，上述稳定 token 全部保留。

生成 seed 散文之前，若本会话已加载 `agent-doc-discipline` 技能，先用 `skill` 工具调用它并应用其规则；seed 散文合格的标准：每条规则可检查且带 why、每个面不靠聊天记录即可自描述、来源写明而非假设。队友或 agent 仅靠阅读 seed 内容就能行动。

Seed A — CLAUDE.md, en（薄入口；文件已存在则原地扩展）：

<!-- shipyard-seed-a:en:start -->
```markdown
# <Project> — Agent & Human Shipyard

## Project conventions
- <language/framework/package manager/naming — list what matters, skip the rest>

## Architecture principles
- <the 3-5 principles most often violated in this project>

## Standards index (full text in docs/standards/)
- Architecture: docs/standards/architecture.md
- Data: docs/standards/data.md
- Process: docs/standards/process.md

## Decision records (full text in docs/adr/; load-bearing ones listed here)
- ADR-0001: adopt shipyard harness

## Shared background
- Glossary: CONTEXT.md ｜ Business knowledge: docs/business/ ｜ Decision context: docs/adr/

## Agent guide
- Delivery follows the canonical workflow plan → execute → review → verify; the `launch` skill is an optional governed delivery pipeline (opt-in, invoke explicitly)
- On term conflicts CONTEXT.md wins; new terms are recorded the moment they settle
- Reusable capability goes to .omd/skills/; UI patterns go to design-system/
```
<!-- shipyard-seed-a:en:end -->

Seed A — zh-Hans companion（结构一致，二选一按文档语言渲染）：

<!-- shipyard-seed-a:zh-Hans:start -->
```markdown
# <Project> — Agent & Human Shipyard

## 项目约定
- <language/framework/package manager/naming — list what matters, skip the rest>

## 架构原则
- <the 3-5 principles most often violated in this project>

## 规范索引（全文在 docs/standards/）
- 架构规范: docs/standards/architecture.md
- 数据规范: docs/standards/data.md
- 流程规范: docs/standards/process.md

## 决策记录（全文在 docs/adr/，此处只列 load-bearing 的）
- ADR-0001: adopt shipyard harness

## 共享背景
- 术语: CONTEXT.md ｜ 业务知识: docs/business/ ｜ 决策背景: docs/adr/

## Agent 指南
- 交付遵循 canonical 工作流 plan → execute → review → verify；`launch` 技能是可选的受治理交付管道（opt-in，需要时显式调用）
- 术语冲突以 CONTEXT.md 为准；新术语当场补录
- 可复用能力沉淀到 .omd/skills/；UI 模式沉淀到 design-system/
```
<!-- shipyard-seed-a:zh-Hans:end -->

Seed A — zh-Hant companion（結構一致，只渲染此版本）：

<!-- shipyard-seed-a:zh-Hant:start -->
```markdown
# <Project> — Agent & Human Shipyard

## 專案約定
- <language/framework/package manager/naming — list what matters, skip the rest>

## 架構原則
- <the 3-5 principles most often violated in this project>

## 規範索引（全文在 docs/standards/）
- 架構規範: docs/standards/architecture.md
- 資料規範: docs/standards/data.md
- 流程規範: docs/standards/process.md

## 決策記錄（全文在 docs/adr/，此處只列 load-bearing 項目）
- ADR-0001: adopt shipyard harness

## 共享背景
- 詞彙: CONTEXT.md ｜ 業務知識: docs/business/ ｜ 決策背景: docs/adr/

## Agent 指南
- 交付遵循 canonical 工作流 plan → execute → review → verify；`launch` 技能是可選的治理交付管道（opt-in，必須明確呼叫）
- 術語衝突以 CONTEXT.md 為準；新術語確定時立即補錄
- 可重用能力沉澱到 .omd/skills/；UI 模式沉澱到 design-system/
```
<!-- shipyard-seed-a:zh-Hant:end -->

Seed B — CONTEXT.md（稳定的 frontmatter 键即语言权威）：

en：

<!-- shipyard-seed-b:en:start -->
```markdown
---
documentLanguage: en
---

# Glossary

One entry per term: definition, boundaries, one resolved ambiguity. Agents write here the moment a term is settled. Vocabulary here is law for all specs, tickets, and code naming.

## <term>
- Definition:
- Boundary: (is X, not Y)
- Resolved ambiguity:
```
<!-- shipyard-seed-b:en:end -->

zh-Hans：

<!-- shipyard-seed-b:zh-Hans:start -->
```markdown
---
documentLanguage: zh-Hans
---

# 术语表

一条术语一个条目：定义、边界、一个已解决的歧义。术语敲定的当下写入。词汇对所有 spec、ticket、代码命名具有法律效力。

## <term>
- 定义:
- 边界: （是 X，不是 Y）
- 已解决的歧义:
```
<!-- shipyard-seed-b:zh-Hans:end -->

zh-Hant：

<!-- shipyard-seed-b:zh-Hant:start -->
```markdown
---
documentLanguage: zh-Hant
---

# 詞彙表

每個術語一個條目：定義、邊界、一個已解決的歧義。術語確定時立即寫入。這裡的詞彙是所有 spec、ticket 與程式碼命名的準則。

## <term>
- 定義:
- 邊界: （是 X，不是 Y）
- 已解決的歧義:
```
<!-- shipyard-seed-b:zh-Hant:end -->

Seed C — docs/standards/architecture.md（data.md / process.md 同形；散文按文档语言渲染）：

```markdown
# Architecture Standards

Rule-shaped, checkable writing; every rule carries a "why". Empty sections are legal — sediment is gradual.

## Module boundaries
## Error handling
## Dependency direction
```

Seed D — docs/business/README.md：

```markdown
# Business Knowledge

Decision background and business rules. Format suggestion: one article answers one business question, opening paragraph states why it matters.
A new teammate (human or agent) reading this directory should be able to answer "why does this product direction exist".
```

Seed E — design-system/README.md：

```markdown
# Design System

## tokens/    Design tokens (colors/type/spacing, machine-readable JSON preferred)
## components/ Component contracts (purpose, variants, misuse)
## patterns/  Interaction patterns (forms, feedback, loading, empty states — sediment reused patterns)
```

Seed F — .omd/skills/README.md：

````markdown
# Project Skills

Reusable capabilities sedimented by this project: specialized tools, prompt templates, specialized practices.
One skill per directory `.omd/skills/<name>/SKILL.md` (bilingual projects add `SKILL.zh.md`), frontmatter must contain
`name` + `description` + `when-to-use` (dsh skill loader requirement: frontmatter keys are `[A-Za-z-]+` only):

```markdown
---
name: project-release-check
description: Apply this repository's release readiness rules
when-to-use: Before any release/tag of this repository
---

# Project Release Check

Follow the repository-specific release checklist and report evidence.
```
The literal YAML keys `name`, `description`, and `when-to-use` never localize. Machine-semantic values stay ASCII and stable; the scalar display values plus Markdown headings and prose may localize.
Bar for admission: if it can be Googled in 5 minutes it is not a skill;
write "this project's specific decision discipline", not generic tutorials.
````

`.omd/skills/` 是 `.omd/` 内**刻意的可提交例外**——`.omd/` 下其余一切（state、plans、handoffs）都是被忽略的运行产物。`.gitignore` 里忽略 `.omd/` 时用 `!.omd/skills/` 把技能面重新包含回来。

### 4. 接好治理回路（这才是船坞，而不是一堆文件夹）

告诉用户，并靠这些流程填充骨架：

- **launch** 在决策敲定时写 CONTEXT.md 词汇、ADR、docs/business/（paper trail）
- **launch C5 沉淀 / review** 把反复出现的纠正沉淀进 docs/standards/ 与 CLAUDE.md 原则
- **任何人**都能往 .omd/skills/ 加项目技能——门槛是质量门，不是权限
- **omd notepad**（`mcp__omd-state__notepad_write_priority` / `notepad_write_working`）复利会话知识；被引用两次的东西晋升进 docs/business/

让"先动手"不失对齐的规则：**开工不需要许可；落地必须落进船坞的某个槽位。** 一个改动说不出落哪个槽（或显式声明无槽），就是坏味道。

### 5. 报告

- 创建了 / 扩展了 / 有意跳过了什么（各带 why）
- 解析出的文档语言，即 `CONTEXT.md` frontmatter 的 `documentLanguage: <tag>`，并说明它来自显式选择、持久化标记还是一致推断
- 接下来最需要人类内容的 3 个面（通常是 CLAUDE.md 约定、architecture.md、CONTEXT.md 首批术语）
- 提醒：随时用 `--check` 重跑，看文件系统与 harness 的漂移

## `--check` 模式

把仓库实际状态与船坞地图做 diff；报告：缺失面、`CONTEXT.md` frontmatter 缺失或非法的 `documentLanguage` 标签、指向死路径的 CLAUDE.md 段落、代码里从未用到的 CONTEXT.md 术语、从未被引用的 standards。每条发现标注置信度（机械可查 = `high`，启发式 = `low`），并在排除用户显式声明的一次性/scratch 仓库后标注是否 actionable。Launch 的 yard 门禁把高置信 actionable 发现当阻塞；低置信或被显式归类为误报的发现、以及用户声明的 scratch/一次性范围内的发现，只能被逐次调用的显式意图覆盖（见 `launch` 技能）。当前 `--check` 没有可执行体或机器可读的退出契约——在结构化发现/严重度契约落地前（计划中的后续项），报告措辞就是分级依据。只读。

## 状态契约

drydock **不持模式状态**：无 `state_write`/`state_clear`。交付物是用户所有的仓库文件（CLAUDE.md、CONTEXT.md、docs/、design-system/、.omd/skills/ 种子）——对 `.omd/` 的唯一触碰是可提交的技能面；不创建任何运行时状态。`--check` 严格只读。中断后重跑即可：探测幂等，绝不覆盖已有文件。
