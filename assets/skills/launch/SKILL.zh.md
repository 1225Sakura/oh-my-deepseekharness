---
name: launch
description: 船坞的受治理交付管道——收敛使命、综合持久规格、分解带阻塞边的垂直切片 ticket、经 team 并行跑 frontier、以验证收尾、带完整决策日志报告。两道入门闸——yard 闸（drydock 审计）与雾闸（目的地不清的活先转 deep-interview/plan 再进本管道）。没有唯一答案或犯错代价惨重的检查点归人类；一切可重复、可凭证据验收的归 agent 连续跑。
when-to-use: 一份使命简报或既有规格需要带人类检查点（C1-C5）与完整 paper trail 的受治理端到端交付。前置：drydock 船坞已存在（否则 yard 闸硬阻塞）。不适用于单点修复（交给 execute）、目的地说不清的起雾工程（先用 deep-interview/plan 收敛）。opt-in；显式调用。
---

# launch（下水）

launch 是船坞的交付航程：从使命简报走到已交付、已验证的改动。它站在可验证性边界上——**agent 连续跑一切可重复、可凭证据验收的；系统无法裁决或错了代价惨重的，归人类决定。** 目标不是最大化自动化——是最大化可验证工作的委派，让人类的时间只花在只有人类能做的决定上。

可验证性测试，逐步应用：*这件事做错了，系统能发现吗？能自动重做或回滚吗？* 两个都是 → agent。无唯一答案、系统无法裁决、或错了代价惨重 → 人类。

launch 假定船坞存在——不存在就拒绝开跑。yard 闸是每次调用的第一个动作，先于文档语言解析、先于读任何提供的规格：

- **跑完整的 drydock `--check` 审计**——缺失面、`CONTEXT.md` frontmatter 缺失或非法的 `documentLanguage`、死路径、代码里没用到的术语、从未被引用的标准。这是唯一判据：Launch 不另做自己的设施盘点。
- **actionable / 高置信发现硬阻塞本次运行：** 逐字列出每条此类发现，指向 `drydock` 技能，声明本次运行从未开始、未产出任何工件，停下。没有显式覆盖时，任何发现都按阻塞处理。
- **窄覆盖（仅限显式意图）：** 低置信发现、drydock 报告里被显式归类为误报的发现、或用户显式声明的 scratch/一次性仓库，只能被逐次调用的慎重用户意图覆盖——覆盖必须点名发现或一次性范围，绝不静默吞掉高置信 actionable 发现。没有通用绕过开关。
- **当前审计局限：** 今天的 `--check` 是 skill 指令清单，没有机器可读的发现/严重度契约或可执行体——在结构化契约落地前，严重度分级依赖 drydock 报告的措辞。机器可读契约是计划中的后续项；门禁措辞如实说明它能与不能机械依赖什么。
- **干净审计（或被显式覆盖的低置信/误报/scratch 范围）放行运行。** 此刻每个 paper-trail 槽位（`CONTEXT.md`、`docs/adr/`、`docs/business/`）与设施面都已存在；Launch 在决策敲定时填充 paper trail，但绝不创建槽位。
- 规则入口是 `CLAUDE.md`——船坞地图不认替代品。

## 边界

| 人类检查点（关键的 20%） | agent 连续跑（机械的 80%） |
|---|---|
| C1 起草使命简报（目标 + 范围） | 事实查证与仓库探索，自给自足 |
| C2 批准验收标准 + 测试 seam 清单 | 访谈备料：frontier 问题打包，各附建议答案 |
| C3 批准 ticket 分解（粒度、阻塞边） | 规格与 ticket 起草、机械校验（独立性、可演示性、装得进一个上下文） |
| C4 回答跑程中冒出的不可逆决策（打包、异步） | 在约定 seam 处 TDD 实现、构建、测试、回归 |
| C5 验收完成报告；经 Open Assumptions 与逐行沉淀清单否决 | code-review、全改动 verify、team frontier 调度、整条 paper trail |

检查点之间管道绝不空转：agent 持续跑每一个不依赖待决人类答案的 frontier ticket。

## 生命周期姿态

Launch 是**omd 既有生命周期之上的无状态组合**——它不拥有自己的运行时状态机：

- omd `team` 技能拥有队员协调、交接与取消；Launch 绝不在 team 契约之外改动 team 状态。
- canonical `plan` → `execute` → `review` → `verify` 各面拥有自己的既有生命周期行为。Launch  authored 的工件限于 `.omd/specs/<feature-slug>/`、`CONTEXT.md`、`docs/adr/`、`docs/business/`——外加 C5 批准之后、Phase 5 槽位表点名的沉淀槽。
- Launch 没有自动续跑。中断后重读工件与当前 team 状态，但只能经一次新的显式 Launch 调用、且上一轮 team 跑程已到达关闭边界之后才继续。绝不推断人类批准、绝不重放进行中的 worker。
- 起雾的工程不归 launch 管：雾闸拦停时，本次运行从未开始——无工件、无半成品状态。omd 没有 navigator 技能；用 `deep-interview` 或 `plan` 收敛目的地，带着磨锐的使命简报回来。
- Launch 不增加自己的批准回执、修订计数器、重放日志、取消路径、回滚机制或清理生命周期。

本技能里任何持久性声明都是关于磁盘文件的声明，不是关于隐藏运行时的。`.omd/specs/` 存 launch 产出的规格/ticket；当团队想把 paper trail 进 git 时，把它当可提交工件面（与 `.omd/skills/` 并列）对待——`.omd/` 其余部分仍是被忽略的运行状态。

## Phase 0——入门

只有通过干净 yard 闸的运行才到得了本阶段。读提供的规格或进 Phase 1 之前，先解析文档语言。当次调用中人类的显式选择优先；否则读 `CONTEXT.md` frontmatter 确切稳定键 `documentLanguage` 里合法的 BCP 47 风格标签；否则要求 `CLAUDE.md` 与 `README.md` 一致的高置信推断。持久化的裸中文或只带地区的中文标签是文字歧义，必须在该权威层问一次，绝不用推断绕过。缺失、混杂、冲突、低置信、非法显式输入、文字歧义中文——都要一次打包的语言提问；不许猜。中文必须解析到显式 `zh-Hans` 或 `zh-Hant` 文字标签。`zh-Hans-*` 选简体 companion，`zh-Hant-*` 选繁体 companion，完整归一化标签原样持久化。在任何 Launch 产出工件之前把解析出的归一化标签写回 `CONTEXT.md`，让新的显式调用不靠隐藏会话状态就能读到。人类阅读并维护这些工件；agent 语言无关。

只本地化散文与面向人类的标签/可本地化标量值。路径、flag、代码围栏、占位符、frontmatter 键与机器语义值、YAML/JSON 键、生命周期 token（`plan`、`execute`、`review`、`verify`）、状态枚举（`pending`、`in_progress`、`completed`、`failed`、`ready-for-agent`）、ID、ticket `blockedBy`、全部解析器/控制 token 逐字节稳定。参考语言 companion 互斥：只输出选定的一份渲染，绝不双语重复标题或标签。

- 先于一切的简报自检：简报点名了目标、范围边界、non-goals 吗？缺两个以上就明说，并请一轮磨锐——拿软简报跑管道会把歧义变成看着自信的输出。
- **雾闸**：磨锐之后，做雾测试——**Q1**：能用一句话说出目的地吗（这个工程要抵达的规格、决策或改动）？**Q2**：现在就能精确说出前三个决策吗（尽管一个都还答不了）？任一答否 → 运行不开始：明说，注明未产出任何工件，建议先用 `deep-interview` 或 `plan` 收敛。移交残余问题与已敲定的词汇，让访谈不重问。
- 提供了规格路径 → 读它，跳 Phase 2。
- 使命简报 → Phase 1。
- 单点修复 → 交接给 `execute`，退出。

## Phase 1——收敛（人类决定，agent 备料）

用决策树协议跑访谈：画出决策及其依赖，然后按 **frontier 轮次**工作——把当前所有可问的问题打包成一轮（用 `ask_user_question`），编号，各附建议答案。人类作答；树变形；重算 frontier。事实永远由子代理从仓库证据自给（`subagent` 派 `omd-agent-explore`）——人类只被问再多探索也定不了的事。

paper trail，每项敲定的当下写：
- 领域词汇 → 仓库根的 `CONTEXT.md`（一术语一条目）
- 过 ADR 测试的决策（难逆转、缺背景会惊讶、真实取舍）→ `docs/adr/NNNN-<slug>.md`
- 收敛中发现的业务规则与背景 → `docs/business/`（一文答一个业务问题，首段说明为什么重要）

此处不收敛是正常工作，不是失败：frontier 清不空，就把残余问题分级呈现——这是 C2 的输入，不是错误。若残余问题本身就无法精确陈述（雾测试 Q2 不过），目的地本身未定，超出 C2 权限：停下，记下已敲定的（`CONTEXT.md` 词汇、已答问题），建议 `deep-interview`/`plan`，退出——管道绝不发明目的地。

**放样绕行。** 一个精确但散文定不了的残余问题——需要被看到、被点击，而不是被描述（UI 该长什么样、状态模型手感对不对）——用工件回答，不是用更多问题：用 `skill` 工具调 `loft`，让船长反应，把反应折回访谈。放样工件是 C2 的输入；船长签的是亲眼所见，不是转述。

**Harbor 简报。** `harbor` 移交的使命简报携带带链接与适用条件的已签决策：当作已做决策消费——不重问未变的业务目标。若取证之后代码动过（新 head、base 变了），重验受影响的技术证据；超出已签简报的新实现范围仍要自己的批准。

## Phase 2——规格综合（agent 起草 → C2 批准）

综合出 `.omd/specs/<feature-slug>/spec.md`：

```
# <Feature> Spec
## Problem
## Solution
## User Stories        （编号，各带可测验收标准）
## Implementation Decisions
## Testing Decisions   （仅外部行为）
## Out of Scope
```

全部起草完，停在 **C2**：把验收标准与测试 seam 清单呈交人类批准。seam 由仓库证据与深模块纪律选出（公开接口、既有测试 seam、深度分析）；人类确认或纠正清单——人类没批准的 seam 不写测试。

持久性闸（agent 强制，无需批准）：规格与 ticket 携带契约，绝不携带坐标——无文件路径、无行号。比散文更好编码决策的片段（状态机、reducer、schema）是例外，并注明出处（通常是放样）。

## Phase 3——ticket 分解（agent 起草 → C3 批准）

在 `.omd/specs/<feature-slug>/tickets/` 下切成垂直切片：

- `NN-slug.md`，一 ticket 一文件，按依赖排序，各声明 `blockedBy: [ids]`
- 每个 ticket 横穿每一层、可独立演示、装得进一个新鲜上下文
- 宽重构走 expand-contract：加新形态、分批迁移、删旧形态——每批一个 ticket

agent 侧机械校验先跑（独立性、可演示性、上下文适配）。然后 **C3**：把粒度、阻塞边、建议的合并/拆分呈交人类批准。迭代到批准为止。每个 ticket 标 `ready-for-agent`。

集成接线规则：每个垂直切片自带接线与冒烟断言——产出没有任何东西挂载、服务或 import 的切片不算完成。无单一切切片拥有的跨切片 seam（路由挂载、静态服务、入口接线）拿一张显式集成 ticket，作为最后一个 frontier 项。

## Phase 4——跑 frontier

frontier 是阻塞项全部完成的 ticket 集合。

**并行（默认，2+ ticket）。** 把 ticket 交给 omd `team` 技能：captain 用 `subagent` spawn 队员，每个 ticket 成为 team-exec 阶段的一个工作项，`blockedBy` 边**在派发前全部声明**为 team 的依赖契约——只有阻塞项报告完成后才派发对应 worker。每个 worker 在 C2 批准的 seam 处以 TDD 纪律实现，`minimal-code-discipline` 已加载时作为写作期纪律应用（保持 opt-in）；ticket 只有在评审者（`omd-agent-code-reviewer`）宣布 diff 通过 code-review 后才关闭——实现者绝不自我批准。

**串行（单 ticket，或 `--serial`）。** 一次委派一个 ticket 给 `omd-agent-executor` 子代理；同样的评审门。

**双轴评审门。** 收尾评审沿两条轴并行跑、分开报告——绝不合并、绝不交叉排名，因为一个改动可以过一轴挂一轴（合规范但行为错；忠实但破约定）。任一轴挂，评审者即判 ticket 失败：

- **标准轴**——diff 对照匹配的 `docs/standards/` 卷，加一份仅限判断题的坏味道基线（成文的仓库标准覆盖基线；工具已强制的一律跳过）。这是让 standards 面持续被引用的常驻消费者。
- **规格轴**——diff 对照*本 ticket 的*验收标准（规格是 ticket 分解的总账；只在追溯标准出处与裁决夹带范围——没有 ticket 要求的行为——时查阅）：缺失或打折扣的需求、没人要的行为、看着实现了但看着不对的需求——每条发现引用来源行。

**C4——跑程中冒出的决策。** worker 撞上过 ADR 测试的决策时，在依赖该决策的改动之前停下，把问题（选项、建议、可逆性说明）记进它的最终报告与 `.omd/specs/<feature-slug>/decisions-pending.md`，不宣称完成即结束回合。这是该 worker 的终态结果：不重生它重试、不推断人类答案、不从本次调用另起 team 跑程。把阻塞连同事停 worker 的报告与决策工件指针一起上浮。

在后续的显式 Launch 调用中，先确认上一轮 team 跑程已完全关闭。然后把所有 pending C4 问题打包给人类，把答案记入决策日志/ADR，重建 ticket frontier 再开执行。所有 ticket 依赖在派发前声明；captain 绝不派发阻塞项未报告完成的 worker。Launch 绝不动态修改已派发 worker 的依赖，绝不承诺 C4 后自动再派发。

**串行 C4（`--serial`）。** executor 在依赖该决策的改动之前停下，带回问题且不宣称完成。在批次边界记录并解决人类问题，然后用记录的答案与剩余验收标准起一个新的 executor。不重放、不续跑被打断的 executor 上下文。

**重复失败停线。** 同一验证失败活过三次修复尝试，该泳道挂停，附给人类的根因假说。这是唯一立即打断 C4 打包的条件。

## Phase 5——收尾（agent 报告 → C5 验收）

- 所有 ticket 带证据终态 → 对全改动跑 `verify`
- 对账 paper trail：CONTEXT.md 准确、ADR 齐全、实现教会规格的地方更新规格
- yard 复查：重跑 drydock `--check` 审计；入门以来新冒出的发现报告为 **yard 漂移**，附 `drydock` 技能指针
- **沉淀 pass——回答：这艘船教会了船坞什么？** 先扫来源清单（三连败根因、C4 答案、评审拒绝、verify 发现、本跑程带入的任何延后沉淀行），再作答。每条教训按 `教训 → 槽位 → 打算的改动` 对照下表提出，或显式带理由拒绝；没啥可教的船必须逐字说"no new lessons"。该要求拦的是不回答，不是空回答——为凑数发明教训与跳过问题同罪。教训清单随完成报告、与 Open Assumptions 并列，逐行可否决；批准的教训在验收后才写入槽位，报告记录每个落点的文件位置。把任何教训写进槽位之前，`agent-doc-discipline` 已加载则用 `skill` 工具调它并应用其规则；该技能的验证清单过了，沉淀 pass 才算完。

  | 教训种类 | 槽位 |
  |---|---|
  | 跑程中敲定的术语与边界 | `CONTEXT.md` 术语表 |
  | 可检查的行为规则（带 why） | `docs/standards/` 匹配卷（architecture / data / process） |
  | 最常违反的约定（薄入口级） | `CLAUDE.md` 正文——只提议 |
  | 难逆转决策 | `docs/adr/`（C4 答案已落此处） |
  | 业务规则 / 背景 | `docs/business/` |
  | UI 模式 / 组件契约 | `design-system/` |
  | 可复用手艺 | `.omd/skills/`（过质量门） |
  | 反复需要的自动化 / 集成 | `scripts/`（MCP 接线走 dsh profile 的 cordis patch——记入 docs/standards/process.md） |
  | 没有槽位合适 | 显式带理由拒绝 |

- **薄入口预算：** `CLAUDE.md` 正文至多五条热条目。教训够薄入口级，仅当来源清单证明同一违反在本跑程出现至少两次，或船长标记为 load-bearing。条目按最近晋升在前排列；最冷条目确定性地是所列最后一条，超预算的晋升必须在同一提案中恰好降级那一条，把它的全文移回 `docs/standards/`——不删任何东西，只重新分层。臃肿逐船再平衡，刻意不作为 `--check` 发现。
- 发出**完成报告**：交付范围、验证证据、paper-trail 位置、yard 漂移发现（如有）、沉淀清单（逐行可否决）、按人类可能想否决的程度排序的 Open Assumptions

## 上下文卫生

- Phase 1–3 在一个不中断的上下文窗口内；只在阶段边界压缩（以会话运行时上下文里的上下文用量数字为高水位信号）。
- 长跑：偏好后台 job + 定期进展标记，让编排方看得到活性——静默的前台回合在结束前什么都不吐。
- Phase 4 按构造每 ticket 一个新鲜上下文（team worker 或 subagent）。
- 交接传指针，绝不传内容。
- 会话中途死掉：保住工件，停下。后续显式调用只能在上一轮 team 跑程关闭后继续；磁盘工件是"决定了什么"的权威。

## 完成定义

所有 ticket 带证据终态，全改动 verify 干净，paper trail 对账完毕，报告发出——且 agent 代人类做的每个决定都能用一个指针答出记录在哪。

## 状态契约

Launch **不持 omd 模式状态**——它是无状态组合：自己没有 `state_write`/`state_clear`。Phase 4 下若起了 `team` 跑程，该跑程遵循 `team` 技能自己的状态契约。Launch 的持久性是磁盘文件：`.omd/specs/<feature-slug>/`（规格、ticket、decisions-pending.md）、`CONTEXT.md`、`docs/adr/`、`docs/business/`。中断时保住工件并停下；只能在上一轮 team 跑程关闭后经新的显式调用续跑。
