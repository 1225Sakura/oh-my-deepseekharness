# omd 退役兼容矩阵（compat-retirement）

> 目的：把「退役」从静默缺失变成可查文档——每个退役名都有 omd 等价物或显式差异说明（共识计划 W3-2/W3-4，Principle 2「可发现性即完整性」）。
> 来源（仓库实证）：上游处置 = reference/oh-my-claudecode/.github/CLAUDE.md:31「**Retired in 5.0.0 (removed, not aliased)**」＋完整 16 名单；别名机制实证 = reference/oh-my-claudecode/src/alias-retirement/registry.ts（learner→skillify 于 5.0.0 退役；psm→project-session-manager、cancel-ralph→cancel 别名存活）；omd 等价物 = assets/skills/ 名册 + lib/keywords.js 注册表逐项盘点。
> 口径：上游「移除不设别名」≠ omd 无等价物——omd 以本矩阵提供**显式继任映射**，旧肌肉记忆一查即达。

## A. 退役触发词（lib/keywords.js RETIRED_KEYWORDS，命中即吞并提示继任者）

| 退役词 | omd 继任者 | 差异说明 |
|---|---|---|
| ultrawork / ulw | autopilot | `autopilot <任务>` 全自治流水线（goal 续跑）；ultrawork 的并行面由 team 承载 |
| uw | autopilot | 同上 |
| ccg | autopilot / team | 生成引擎类任务走 autopilot；多代理协同走 team |

## B. OMC v5.0 退役 16 技能 → omd 等价物

| 退役技能 | omd 等价物 | 等效工作流配方 | 差异说明 |
|---|---|---|---|
| ultrawork | autopilot | `autopilot <任务>` | 并行子任务面→team |
| ultraqa | verify + omd-agent-quality-strategist | verify 门禁（证据）+ 质量策略评审（风险加权测试深度，GO/NO-GO） | 上游为独立循环 skill；omd 拆为门禁+角色 |
| ultrapilot | autopilot（长目标加 ultragoal） | `autopilot <目标>`；持久多目标用 ultragoal | 上游多模式合一 |
| swarm | team | 「用 team 做…」五阶段流水线（plan→prd→exec→verify→fix≤3） | 上游 4.1.7 起 swarm 已被 team 取代 |
| pipeline | graph 或 team | 确定性 DAG→graph（journal/fence）；阶段编排→team | 按确定性需求二选一 |
| merge-readiness | review + omd-agent-git-master + verify + team_merge_plan | 合并前配方：review（缺陷/风险）→ git-master（分支/历史）→ verify（证据）→ team_merge_plan（冲突候选+合并序） | 上游为单 skill；omd 为四件套配方（能力超集） |
| deep-dive | trace + analyze | 证据追踪：trace_begin/event/summary；只读深析：analyze（置信度+证据边界） | 上波单通道；omd 双通道分工 |
| sciomc | plan + omd-agent-architect | 结构化思辨入 plan，架构健全性由 architect 角色卡评审 | 同上拆分逻辑 |
| ccg | autopilot | 同 A 表 | — |
| omc-teams | team | 同 swarm 行 | — |
| setup | omd-setup | 安装/配置指引 + /omd-doctor 验装 | 更名 + 诊断面增强 |
| mcp-setup | omd-setup + omd-doctor | MCP 注册走 omd-setup；连通性冒烟走 omd-doctor（真握手计数） | 拆装分离 |
| omc-reference | wiki + /omd 帮助面 | 知识沉淀 `用 wiki 记录/查询…`；能力速查 /omd（全技能目录） | 上游手册型；omd 为知识库+速查双面 |
| learner | skillify + notepad/omd_memory_* | 经验提炼 skillify；持久记忆 notepad_write_priority / omd_memory_set | 上游 registry.ts 实证 learner→skillify；omd 记忆面为增值承载 |
| writer-memory | notepad 三区 | notepad_write_priority（永久）/write_working（7 天）/write_manual（永不清理） | 记忆分层化 |
| local-build-reminder | 无直接等价（如实差异） | 语义替代：omd-doctor（注册/冒烟诊断）+ events_read（派发审计面） | 构建提醒属宿主/CI 通知承载，dsh 无此事件面——依赖宿主，不硬造 |

## defer 台账 schema

defer 裁决（共识计划 W2）的登记模板；登记处 = `.omd/state/defer-ledger.md`（运行态，gitignored 不入库）——**本节为已提交资产的 schema 锚**，fresh clone 可据此初始化台账。

| 字段 | 说明 |
|---|---|
| 项 | defer 的能力名（对应共识计划 W2 表 #） |
| 计量处 | 点燃判据在哪里计数（文件/登记行/需求记录） |
| 复核触发点 | 何时复核（如：每次 parity 重基线轮） |
| owner | 责任主体（非事件名） |
| 当前状态 | waiting / ignited / closed |

模板行：`| <能力项> | <计量处> | <复核触发点> | <owner> | waiting |`
硬约束（共识计划 P4）：缺任一三要素的 defer = 变相悬挂，不予通过。

## 软别名机制评估（W3-4 决定记录 · 2026-10-29）

**Decision**：RETIRED_NOTE 升级为「提示 + 携带继任用法示例」；否决「退役词直接激活继任模式」的真别名。

**评估**：现状 RETIRED_NOTE 只说改用 autopilot/team，用户需自行回忆用法形态。升级后示例随提示同行到达（如 ultrawork <任务> → `autopilot <你的任务>` / 「用 team 做…」），迁移成本降为零跳转。真别名（输入旧词→直接启动继任模式）被否决：肌肉记忆迁移应当显式——旧词静默变形会让用户在不知情的状态下启动重型编排，违背 omd 关键词面「显式优先」的一贯立场（team 无关键词触发同理）。

**Consequences**：核查实证——现行 RETIRED_NOTE 文案已携带继任用法示例（如 `autopilot <你的任务>` / 「用 team 做…」），升级项实为已完成态，无需改码；退役体验从「撞墙」变「指路」；无新增触发词，关键词面零膨胀。

**Follow-ups**：每次上游退役名单变化时同步本文件 A 表与 RETIRED_NOTE 示例。
