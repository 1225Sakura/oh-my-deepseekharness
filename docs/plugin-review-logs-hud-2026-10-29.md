# omd 插件审查 · 日志 + HUD 生态全方位审查（2026-10-29）

> 对象：@sakura12/oh-my-deepseekharness v0.5.2（D:\omd）｜对比基准：reference/oh-my-claudecode（OMC v5.7.0 快照，tag=v5.7.0 / HEAD=8262f9f79）
> 权威计划：.omd/plans/ralplan-logging-hud-engine-audit.md（RALPLAN 两轮共识，Critic r2 APPROVE；大纲=其 §4，维度映射=§3，Options 裁决=§1.3/§7）
> 证据基座 = 四份步骤产出：.omd/state/ralplan-reviews/ 下 lhe-evidence-r1.md（S1 取证）/ lhe-engine-r1.md（S2 走读）/ lhe-delta-r1.md（S3 delta+抽查）/ lhe-external-r1.md（S4 外部对标）。本文为 S5 综合，只综合不新查；引用格式「evidence §n」「engine §n」等指向上述文件的节/file:line。
> 证据纪律（计划 §0-F5/F7/F8）：代码一律 file:line；45 点/框架只以节锚+父节路径引用、禁行号；closure 过时行号仅作线索，结论以 repo 现状为准；锚内数字全部现场重数。
> 时点声明：取证基线=2026-10-29 工作区（keywords 8 条目/hud-route 239 行等与此一致）；其后并行批次（eco-completion W1/W4、W2 tdd）更新 lib/hud-route.js（+17 行）、lib/keywords.js（+tdd 第 9 条目）、lib/probe.js、lib/index.js——hud-route 现状锚：WORKER_AGGREGATE_LIMIT=:26、truncated=:72、readEvents=:142、skipped 分支=:242/:245；keywords 现状 9 条目（tdd 为 arm:false 指引条目）。

## 1. 执行摘要

- 五步审查（S1-S5）收口：平面 A（日志）六文件走读健康，平面 B（HUD）五承载面健康，平面 C 决策链 O-A3 主链 8/8 环节无空环（engine §2）。
- 新增 gap 2 条：N1（上游 mission board 面无承载）、N2（用量/成本/上下文压力可观测面无承载）——均为上游对照缺口，非缺陷（delta §3）。
- 走读候选 4 条：C1（中，fallback 双审计面失败车次不同步）/ C2（低，recordFallback 绕过 version/CAS 契约）/ C3（低，stateDir 校验口径分裂）/ C4（最低，注释行号引注漂移）——全部 P2（engine §3）。
- 疑点终局：①hb.log=confirmed 孤儿（F4 范式登记，只登记不删）；②hooksBridge=refuted（版本漂移已消除）；③CLI hudRoute skipped=confirmed 设计内降级（非缺陷）；④effort=confirmed 登记属实（设计内缺口，无数据源通道）（evidence §2；external §2）。
- delta 实测：hud 全树 52（16+29+7）与 hooks 30/14/11/29 现场重数与基线全吻合，无锚点漂移；抽查 8 条覆盖 parity/closure/U8 三先例，7 仍成立 + 1 已修失效（正向）（delta §1/§5）。
- 外部对标：疑点①③④背书成立；候选题「MCP 工具面无状态边界」因预算耗尽以 uncertain + 引用表 pending 归档，终稿如实标注不硬凑（external §3/§4）。
- 维度评分：聚焦 9 维（D1/D4/D5/D7/D10/D11/D12/D15/D16）——6 健康 + 3 健康带债，无 P0/P1 级新缺陷；非聚焦 7 维各一行不适用理由（§9）。
- 台账：8 条 IC 行（IC-24~IC-31）入 upgrade-tracking.md IC 节，维度 id 全部 ∈ D1-D16，无 D17。
- closure 遗留双态：R5「纯写不读」取证时点部分成立、现状已修（team_read_mirror 与 HUD 镜像回退读相继落地，详 §3）；stale 文案矛盾已修（evidence §3）。

## 2. 范围与 Options 裁决记录

范围：平面 A（日志生态：events/trace/runstate/heartbeat/team 落盘面）+ 平面 B（HUD 生态：hud/hud-route/client/hud.mjs/probe）为主线；平面 C（生成引擎）按 O-A3 主链为界；越界发现只记 out-of-scope 一行（P3）。Non-goals（计划 §5）：不全量复核 parity 45 点、不改源码、不深审 dsh 宿主与 D6/D14 运行时、不重开 U8 已裁决事项。

Options 裁决（计划 §1.3 收敛，本文执行确认）：

| 裁决点 | 定稿 | 执行落点 |
|---|---|---|
| Q1 平面 C 范围 | O-A3 = O-A1 编排决策链主线 + O-A2 模板引擎降附注 | engine §1：O-A2 经 glob 实测仅 prd-template.json 一个文件，「证据极薄」成立，降为附注（本文 §5.4） |
| Q2 对比策略 | O-B3 = delta 复审 + 既有结论抽查（≥5 条覆盖 ≥3 先例） | delta §5：抽查 8 条 / 3 先例（parity/closure/U8 必抽齐） |
| Q3 扩展维度 | 不立 D17；EL1-EL3 为维内子清单，终稿 §9 固定落点 | 本文 §9.1-§9.3，一维一节防漂成第二台账 |
| Q4 外部引用深度 | O-C2 定向 ≤6 查询 + O-C1 降级触发 + MF6 超预算处置 | external §4：补查 6/6，第 7 个必要查询未出现，MF6 未触发 |

## 3. 平面 A：日志生态（证据六列清单）

S1 产出六列清单（行数 / kind 集 / 写入路径 / 锁域 / 容错口径 / U8 ADR 约束落点）全文见 evidence §1（A1-A5 行）。本节摘要与关键判定：

| 面 | 文件 | 关键形态 | U8 约束落点 |
|---|---|---|---|
| events | lib/events.js（124 行） | route/fallback 双 kind（events.js:19）；resolve 防幻影树（:28-30）；per-文件进程内 FIFO 锁（:47） | 一期不轮转（:13）；64KiB 尾窗 DEFAULT_EVENTS_WINDOW_BYTES=65536（:22）✓ |
| trace | mcp-server/tools/trace.mjs（155 行） | begin+hypothesis 等 7 kind（:14/:50）；SAFE_ID 白名单（:13/:18）；重复 begin 拒绝（:48） | append-only 同族（:5）；读面无窗口（:27-37 全量载入）→ EL1 素材 |
| run-state | lib/runstate.js（143 行） | 七字段镜像快照；CAS 重读重试 ≤3（:115-129）；预算耗尽覆盖写+warning（:130-141） | c6 契约面，无 U8 条款 |
| heartbeat | lib/heartbeat.js（81 行） | 只读扫描无写面；ENOENT→[]（:25）；per-run 容错（:32-37）；timer.unref（:77） | 呈面双消费者（:14-17，closure 断链修复面） |
| team 审计面 | lib/team.js（409 行） | mailbox 双向 type 集（:234-237）；phase 状态机（:3）；「邮箱有界小文件」设计（:9）；ack 重写剥离坏行（:260-264） | 自带有界性，无 U8 条款 |

**U8 AC-12「窗口语义 SKILL 点名」落地复核**：双语逐节对应在案——SKILL.zh.md:52 / SKILL.md:54 点名 64KiB 尾窗、「近期信号」语义与 warn 自动消退；toolCalls 计数口径双语同在（SKILL.zh.md:51 / SKILL.md:53）。轮转=既定二期（F2），无新增缺陷（evidence §4）。

**F6 closure 遗留双态结论**（F7 口径：closure 行号仅线索，以 repo 现状为准）：

- R5「run-state.json 纯写不读」——**取证时点部分成立，现状已修**：证据时点=2026-10-29 取证时，run-state.json 现存（eco-completion v3）且 team_read_mirror 不存在，「展示级消费者为零」仅对取证时点成立（hud 四文件零引用；元数据级读面在案：team.mjs:37/:56-57、worktree.js:134）；其后该文件被 eco-completion 终结清理、team_read_mirror（team.mjs:171）与 HUD 镜像回退读（hud-route.js:145，w-P1-3）相继落地——R5「纯写不读」在现状已闭合为「已修」（evidence §3）。
- stale 文案矛盾——**已修**：client.js:186-195 为修复后代码（动态 staleAfterMs + 回退不说时长），回归守门 client-bundle.test.js:256 在案（evidence §3）。
- 断链#1/#2（team 面）——out-of-scope 一行备注：属 D6 界，本审查不裁定，终局核对归 D6 另立任务（evidence §3 末行；Non-goals 兜底）。

## 4. 平面 B：HUD 生态

S1 证据清单 B1-B5 全文见 evidence §1。摘要：

| 面 | 文件 | 关键形态 |
|---|---|---|
| 纯函数库+轮询工厂 | lib/hud.js（236 行） | 五要素契约 HUD_FIELDS:25，**无 effort 字段**（疑点④证据）；观察者异常不阻断（:219）；重入防护（:222-228） |
| HTTP 数据路由 | lib/hud-route.js（239 行） | 只读聚合；50 名截断（:24/:70）；四路并行+catch（:138-143）；AC-5 窗口消费侧（:140）；AC-10 tier 提升（:169）；AC-6 绝不 500（:29/:57） |
| 浏览器面板 | lib/client.js（443 行） | stale 阈值读 server 下发（:186-195，R3-⑩ 配套面）；缺键跳过不炸；无 effort 渲染 |
| MCP wire | mcp-server/tools/hud.mjs（46 行） | 恒 {summary,card} 二键（:21/:24-28）；富面不进 MCP wire（hud-route.js:123-127 P2 红线） |
| probe | lib/probe.js（67 行） | 四态 ok/timeout/failure/unavailable（:15-27）；有界输出 4KB；疑点②复核锚（:38-41 残件移除注释） |

无新增缺陷。skipped 降级语义、stale 双语义现算下发（state.mjs:115-130）均在案；effort 缺口定性见 §8-④。

## 5. 平面 C：生成引擎（O-A3 主链走读）

### 5.1 O-A3 裁决记录

O-A1 编排决策链（keywords→hook→state→routing→delegate→events）经实证为 omd 真正「生成」派发决策的引擎路径，登记锚 D1/D5/D12 恰落此链；O-A2 模板引擎证据不足降附注。合取是唯一同时满足证据面与登记锚面的解读（engine §1；计划 §7-Q1）。

### 5.2 主链 8 环节（无空环，逐环节 file:line 见 engine §2）

| 环节 | 承载 | 锚点 |
|---|---|---|
| ① 关键词表 | lib/keywords.js | KEYWORD_REGISTRY 8 条目（:12-32）；锚定形态 :37-41；退役词 :44-45 |
| ② hook 拦截 | lib/hook.js | agent/pre-step 单监听器（:194）；stripNonActivating 剥离序（:32-39）；detectKeyword 三形态（:52-95）；恰一次 next()（:236-241） |
| ③ state 激活 | lib/hook.js + state.mjs | 预写与 MCP 同一把锁（:124-125 ≡ state.mjs:19）；token 闭环（updatedAt=expectUpdatedAt=CAS 键）；supersede 留痕（state.mjs:44-57） |
| ④ 四特征评估 | lib/routing.js | SIGNAL_FEATURES（:16-21）；TIER_BANDS（:23-24）；routeOnce 纯函数恰一次（:68-93） |
| ⑤ 档位钳制 | lib/routing.js | clampTier 只降不升（:39-43）；表源链 delegate.js:116 ← index.js:156 |
| ⑥ 硬路由派发 | lib/delegate.js | resolveDispatch（:44-68）；不可解析 id 显式报错（:179-192）；spawn 派发（:205-221） |
| ⑦ events 落盘 | lib/events.js + delegate.js | recordRouteEvent（:40-65）；route/fallback 1:1（delegate.js:150-166） |
| ⑧ fallback 审计 | lib/routing.js | recordFallback（:103-116）；增补三键不覆盖既有键；调用点 delegate.js:193-201 |

空环检查 8/8 有 file:line → **链路无空环（pass）**（engine §2）。

### 5.3 断链/不一致候选（4 条，不设下限如实呈报）

| ID | 定级 | 摘要 | 证据 | 处置 |
|---|---|---|---|---|
| C1 | 中 | fallback 双审计面在派发失败车次上不同步：events 落盘在 resolveDispatch 后立即，run-state recordFallback 排在可抛的校验之后——失败车次 events 有两行、run-state 无痕迹 | delegate.js:154-166 vs :167-201；events.js:37 注释自认语义 | IC-24（§10） |
| C2 | 低 | recordFallback 与 c6 镜像写语义分叉：直写三键、version 不 +1、不经 CAS——同权威文件两套写语义并存，fallback 写后下一次 CAS 必多一次冲突重试 | routing.js:109-113 vs runstate.js:11/:76/:80 | IC-25 |
| C3 | 低 | stateDir 语义分裂：hook/state 面禁绝对路径与 .. 段，routing/events 面显式支持——Config 配绝对路径时关键词预写失效而路由事件照常落盘 | paths.mjs:7-11 vs routing.js:106-107/events.js:26-29 | IC-26 |
| C4 | 最低（文档性） | events.js:36 注释引 delegate.js:38/:55 行号漂移（现码 modelId 决策在 :58/:67）；F7 双态口径：注释仅线索，现状以实码为准 | events.js:36 vs delegate.js:38-43/:55/:58/:6

> **修复状态（2026-10-29 收口）**：C1/C4 已随 `1cb8d4b`、C2/C3 已随 `0c3b8a5` 入库——ralplan-p2 两轮共识 APPROVE，守门 5 用例（delegate/routing/hook），全量 51 文件/635 测试绿，复验 p2-verify-r1=VERIFIED。C4 域外残留 6 处先例注记行号不属本轮改动面，已列单（p2-verify-r1）。7 | IC-27 |

### 5.4 附注：模板资产盘点（O-A2，一行，不进验收门）

assets/templates 全目录仅 prd-template.json 一个文件（glob 现场实测）——「插件内证据极薄」成立，模板引擎不构成独立平面（engine §4）。

## 6. OMC v5.7.0 delta（实测户口册 + 映射表 + 对照列）

### 6.1 实测户口册（F8 现场重数，与计划 V1 逐项对账）

hud 全树 52 = 顶层 16 + elements/ 29（纯平铺）+ __tests__/ 7；源:测试 = 45+7；elements/effort.ts 实存。hooks.json 重数：hook actions=30 / matcher 组=14 / 事件类型=11 / 引用脚本=29——与 upstream-form-omc §CLI/hook/状态面清单 及 parity §S1 勘误落实 全部吻合；漂移扫描节已登记的「hooks 30+→40」实测维持 30 无新漂移，按禁重报令（F8）不列为 gap（delta §1）。

### 6.2 映射表（粒度定稿：顶层逐文件 / elements 按功能域聚合 / effort 单列）

总判断：上游= statusline 型终端 HUD（stdin JSON→元素渲染→ANSI），omd= MCP 卡 + loopback Web 面板型——「编排状态可见」主语义同构（parity G 组 #36/#37 已载）。权威全表见 delta §2；本表为其浓缩：

| 上游 | omd 承载 | 判定 |
|---|---|---|
| index.ts / render.ts / state.ts / types.ts / omc-state.ts（HUD 主干 5） | hud.mjs:31-43 + hud-route.js:222-239 + client.js:36 起 + state.mjs getStatus + hud.js HUD_FIELDS:25/renderCard:141-183 | 已载：parity G #36 |
| colors.ts | hud.js TIER:81 + client.js TIER_COLOR:51-55 | 已载：G #37 语义映射差异 |
| stdin.ts / transcript.ts | 无承载（dsh 无 statusline stdin 缝；transcript 在宿主 store） | 已载根因：G #37 |
| agent-kind.ts | lib/team.js worker 生命周期部分同构 | 已载：C #17 + F #30/#32 相邻能力 |
| background-cleanup/-tasks.ts、sanitize.ts、background 元素 | 无对应（宿主 job 系统等价；omd 无 ANSI 注入面） | 非缺口（宿主等价/无需求面） |
| **mission-board.ts + elements/mission-board.ts + missions/ 子系统** | 无对应承载（omd PRD 面是 story 台账语义非任务板时间线） | **N1 本次新增** |
| **usage-api.ts / payload-estimate.ts / custom-rate-provider.ts + E3 用量族 6 元素（limits/call-counts/token-usage/enterprise-cost/context/context-warning）** | 无对应承载（五要素无用量键） | **N2 本次新增** |
| E1 编排模式族 7 元素 / E2 环境身份族 8 / E4 statusline 展示族 4 / E5 background / E6 session-summary / E8 index | state_get_status 派生 + modeCard + U8 workers 区；E2/E4/E5/E8 无承载（宿主自有面/无 statusline 缝/架构形态差异）；E6 部分同构（lastActivity） | 已载或非缺口（delta §2.2） |
| **elements/effort.ts（单列）** | **无对应承载面**（HUD 全链 grep effort 零命中） | 已登记：G #36 + 评估 #10 ❌未做；评估记录见 §8-④ |
| __tests__/ 7 | omd 守门：hud-route/client-bundle/hud/upstream-forms 四测试面 | 已载 |

### 6.3 增量 gap 表（新增 ↔ 既有台账节锚 对照列）

| ID | gap | 证据 | 标注 | 对照列（查重锚） |
|---|---|---|---|---|
| N1 | 上游 mission board 任务板/时间线/多 mission-worker 呈面，omd 无对应承载 | mission-board.ts:1-12（状态机 import 面）；elements/mission-board.ts:1 | 本次新增 | 形态卡 §顶层子系统地图（仅列名未评估）＋ parity §上游新增能力评估 11 项全集（无 mission）＋ upgrade-tracking §2026-02-06 漂移扫描（无此项）＝**查重空集** |
| N2 | 上游用量/成本/上下文压力可观测面，omd HUD 五要素与 hud.json 富面均无此维度 | usage-api.ts 导出面；payload-estimate.ts 导出面；hud.js:25 五要素无用量键 | 本次新增 | parity G #36/#37/#38（均非用量面）＋ 11 项评估全集（无用量/成本项）＋ 形态卡 §omd 映射表（HUD 行仅 effort/statusline）＝**查重空集** |

不立 gap 候选及理由（防误判漏报）：agent-kind（相邻能力已载）/ sanitize（无需求面）/ stdin+transcript（根因已载 #37）/ background 族（宿主等价）/ hooks 计数（已登记漂移，禁重报令生效）——全文见 delta §3 尾段。

### 6.4 抽查记录（MF3：8 条 ≥5，3 先例全覆盖）

parity/closure/U8 各抽既有结论共 8 条逐一复核：7 条仍成立；1 条已失效=closure stale 文案矛盾（现修复代码 client.js:186-196 在案，属双态核验正向结果）。逐条表见 delta §5。重复率对照=上述 §6.3 对照列（N1/N2 查重空集），供评审按列抽检。

## 7. 外部引用表

| # | 支撑结论 | 字面 URL（编排方核实清单为准） | 实访（2026-10-29） | 漂移处置 |
|---|---|---|---|---|
| U1 | C1 hook 事件面对照 | https://github.com/Yeachan-Heo/oh-my-claudecode/blob/main/docs/HOOKS.md | 200 但 blob 截断；重查 raw 版 200 全文 43,684 字符 | raw 重查计入预算 |
| U2 | 疑点③跨面一致性 | https://docs.anthropic.com/en/docs/claude-code/hooks | 跨域重定向至 code.claude.com＝锚点漂移；重查 code.claude.com/docs/en/hooks.md → 200 | 重查计入预算 |
| U3 | 疑点④effort 数据源 | https://code.claude.com/docs/en/statusline.md | 200 全文 66,010 字符，无漂移 | 无需 |
| U4 | MCP 无状态边界候选题 | https://github.com/anthropics/skills/blob/main/mcp-builder/reference/mcp_best_practices.md | **404**；定位现路径 skills/mcp-builder/…；**全文未抓取——补查预算 6/6 耗尽** | 定位已计入预算；全文抓取未竞得 |

搜索级引用（摘要级，如实标注；均 2026-10-29）：12factor/logs（「Treat logs as event streams」）、logrotate(8) man（rotation/compression/removal）——疑点①背书用。

关键摘录：U1「OMC's 21 hooks intercept…11 lifecycle events」；U2「fires the same hook events wherever it runs」+ matcher 事件名片段 ≥15（截断，不做官方总数断言，F8）；U3「effort.level｜low/medium/high/xhigh/max…receives JSON session data on stdin」。

**候选题处置（如实标注）**：①hook 事件面最小完备（竞得，U1/U2 覆盖）：omd 单电线承载关键词路由单职责＝最小完备下限，差距在事件广度非缺陷定性；②**MCP 工具面无状态边界（未竞得）**：U4 404 定位到新路径后预算耗尽，全文未抓取 → 该候选题结论 **uncertain**、引用表记 **pending**，恢复路径=抓取 U4 新路径全文；终稿如实归档，不硬凑（external §3）。

**预算台账**：口径=基线 4 条义务誊录之外的补查 ≤6（MF5）；实际补查 6/6（raw 重查/hooks.md 重查/mcp_bp 404/statusline 补取/2 次 web_search）；第 7 个必要查询未出现 → **MF6 强制降级未触发**；候选题 uncertain 是「竞争剩余」未竞得的结果，非 MF6 处置（external §4）。

## 8. 疑点①-④终局裁定

| 疑点 | 裁定 | 关键证据 | 处置 |
|---|---|---|---|
| ① .omd/hb.log 孤儿 | **confirmed** | 全仓 grep 零命中（无写入方无读者，可复现命令在案）；内容= v0.4.1 时代 vitest 输出重定向一次性测试产物；README 户口树无 hb.log 行 | F4 范式登记：孤儿=无守门无读者；**删除须用户显式确认，任何自动化流程不得动它**；入 IC-30（D15 测试卫生） |
| ② hooksBridge | **refuted**（F1 复核通过） | repo lib/probe.js 与实装 profile 取证时点逐字节 identical（均 2303B）；其后 repo 侧追加 smokeMcpServer（eco-completion W1，2303B→5350B）属功能演进非版本残影，残件移除状态双侧一致，裁决 refuted 不变；profile package.json=0.5.2 双侧一致；probe.js:38-41 现为残件移除注释 | 版本漂移已消除，closure P0 修复生效；当前会话快照 hooksBridge:unavailable 属旧进程未重启，非代码现状 |
| ③ CLI hudRoute skipped | **confirmed**（设计内降级，非缺陷） | 主证=tests/lib/hud-route.test.js:234-237 断言 + hud-route.js:224-228 分支；SKIP_IS_OK 公告过滤（index.js:82/:90-94）；CLI 复现成功（enabled:false + detail） | 结案不变；外查对照=披露层级有差距（可选改进非缺陷，external §2③），落 §10 建议路线 |
| ④ effort 字段 | **confirmed**（登记属实：设计内缺口） | 上游 effort.ts:14-30 实存（V1）；omd HUD 全链 grep 零命中；数据源模型不同构：上游=statusline stdin 推送（U3 字面 5 档），omd 读面钉死 state_get_status+notepad_stats 两拉取（hud.js:10-11/:192-200） | 评估记录已落三处（evidence §2④ / delta §4 / external §2④）；定性=补齐=管道工程非加 element；登记位回写（「❌未做待核」→「❌未做·设计内缺口」）按计划 Follow-ups 归编排方；入 IC-31（D7） |

## 9. 维度评分（16 全集）与 EL1-EL3 落点

评分标度：✅ 健康（无新发现或仅正向核验）｜◐ 健康带债（存在已登记 P2 级质量债/对照缺口）｜⚠️ 缺口（P0/P1 级）。本轮无 ⚠️。每维证据回链步骤产出。

### 9.1 聚焦 9 维（计划 §3 映射）

| 维 | 评分 | 依据（回链） | 本轮 IC 行 |
|---|---|---|---|
| D4 状态/记忆/数据面 | ✅ 健康（带 EL1 观察） | events 尾窗/CAS/锁域全健康（evidence §1 A1-A3）；trace 读面无窗口=EL1 素材非缺陷（evidence §1 A2 第六列） | —（EL1 承载） |
| D12 委派路由 c1/c3 | ◐ 健康带债 | 主链 8/8 无空环（engine §2）；C1（中）双审计面失败车次不同步 + C2（低）写语义分叉（engine §3） | IC-24 / IC-25 |
| D15 测试与发布门禁 | ✅ 健康 | 守门断言在案（hud-route.test.js:234-237、client-bundle.test.js:256、upstream-forms 实存 V3）；hb.log=v0.4.1 历史测试卫生遗留（vitest.config 现无重定向，现行测试产物卫生） | IC-30 |
| D16 文档/计数一致性 | ◐ 健康带债 | README 户口树准确（无 hb.log 行）；hooks 计数重数吻合（delta §1.2）；C4 注释引注漂移一条（engine §3）；closure 行号漂移已由 F7 口径处置（evidence §3） | IC-27 |
| D7 HUD 与通知 | ◐ 健康带缺口 | 五承载面零新增缺陷（evidence §1 B1-B5）；N1/N2 上游对照缺口 + effort 设计内缺口 + S4 披露层级可选改进——均为对照缺口非功能缺陷 | IC-28 / IC-29 / IC-31 |
| D5 Hook 矩阵 | ✅ 健康 | 单电线契约/剥离序/防盲覆写全健康（engine §2①②）；外查对照=最小完备下限，差距在事件广度非缺陷（external §3①） | — |
| D11 MCP state 契约与多会话锚定 | ◐ 健康带债 | 锁域一致/token 闭环/provisional 豁免/supersede 留痕衔接证明齐（engine §2③）；C3 stateDir 校验口径分裂（engine §3） | IC-26 |
| D10 插件运行时与 cordis 集成 | ✅ 健康 | 疑点②复核通过：仓↔profile 逐字节一致、probe 四态在案（evidence §2②/§1 B5）；hooksBridge 呈报差异=旧进程未重启非代码现状 | —（EL2 承载） |
| D1 执行模式 | ✅ 健康 | KEYWORD_REGISTRY 8 条目/锚定形态/退役词消费面全在案（engine §2①）；八模式生命周期面无新发现 | — |

### 9.2 非聚焦 7 维（不适用 + 理由）

| 维 | 不适用理由 |
|---|---|
| D2 技能资产 | 本审查平面 A/B/C 无一触及 assets/skills 名册；权威口径=U7 重基线（轮 16）+ 轮 18 逐维登记（零发现），无新证据 |
| D3 角色卡与路由 | 33 角色名册/档位 overlay 资产未触及；本轮仅触及运行时档位钳制逻辑（归 D12） |
| D6 Team 运行时 | team 面仅触及落盘形态走读（evidence §1 A5，只读）与断链#1/#2 out-of-scope 备注（归 D6 另立任务）；行为面未审（Non-goals） |
| D8 CLI 与分发 | 无分发面证据触及（package.json/bin/marketplace 零涉及） |
| D9 跨进程/运行时核 | lockfile/CAS 仅作为平面 A 锁域证据被引用（engine §2③），未做行为复审 |
| D13 worktree c5/c6/c8 | run-state 镜像仅以 c6 写语义边缘涉入（C2 主锚归 D12）；worktree 隔离/多仓锚定面未审 |
| D14 graph DAG 运行时 | graph 面零触及（Non-goals 界内；IC-01~10 既有开放状态不变） |

### 9.3 EL1 生命周期治理（挂 D4/D12）

- **hb.log 孤儿案例**：v0.4.1 时代测试重定向产物，全仓无写入方无读者（evidence §2①）——.omd 产物孤儿化的实证案例；F4 范式登记完成（IC-30，closed；删除须用户显式确认）。
- **trace.mjs 读面无窗口素材**：trace.jsonl 全量载入（trace.mjs:27-37），U8 窗口约束未绑 trace 面——长期增长时读面内存线性增长。定性=风险复评素材非缺陷（evidence §1 A2 第六列、§4）。
- **events.jsonl 一期不轮转**：U8 既定二期（F2），不当新缺陷报；12factor/logrotate 外部口径同向背书「治理外置」设计（external §2①）。
- 同族有界面：mailbox 靠 ack 重写保持有界（team.js:9/:260-264）——自带有界性，无需动作。
- **EL1 治理包落地（2026-10-29，ralplan-u8-2 共识 APPROVE + 复验 VERIFIED）**：events.jsonl 1MiB 锁内轮转单档 .1（读面/聚合零改动）；trace 读面 8MiB 策略性拒绝（结构性拒绝全量窗口化：seq/end/hypothesis 语义依赖）；dispose/cancel 缺文件自愈墓碑（异 runId 双点拒绝+幂等续行同守卫）——本节三项素材全部闭合，守门 7 用例、全量 51 文件/642 测试绿。

### 9.4 EL2 双端一致性（挂 D7/D10）

- **CLI hudRoute skipped**：设计内确定性降级（enabled:false + detail + SKIP_IS_OK 公告过滤），非静默吞没（evidence §2③）；与官方「同一行为全运行面一致」承诺（U2）方向一致，披露层级有差距=可选改进（external §2③）。
- **仓↔profile 漂移已消除复核**：probe.js 逐字节 identical、package.json 双侧 0.5.2（evidence §2②）——0.5.2 仓↔实装 profile 漂移在本轮复核中确认消除。

### 9.5 EL3 窗口语义与读面有界（挂 D7/D12）

64KiB 尾窗与 50 名截断的 SKILL-实现一致性：实现侧 events.js:22（65536）/:77-85（尾窗+撕裂行丢弃）、hud-route.js:24/:70（WORKER_AGGREGATE_LIMIT=50 + truncated 标记）+ 消费侧 hud-route.js:140（readEvents 默认 64KiB）；文档侧 SKILL.zh.md:52 / SKILL.md:54 双语逐节点名窗口语义、「近期信号」语义与 warn 消退句（evidence §4）。**SKILL-实现一致 ✓**。trace 面未绑定窗口约束（归 §9.3 EL1 素材，不重复计）。

## 10. P0/P1/P2 建议路线

**P0：无。P1：无**（本轮无阻塞发版/数据损坏/宿主崩溃级、无功能缺陷无绕行/契约破坏级新发现；阴性结论合法 pass，P5）。

P2 路线（全部已入 IC 台账，按建议处置次序）：

1. **IC-24（C1，中）fallback 双审计面同步**：涉 delegate 落盘次序重构（events 立即落盘 vs run-state 校验后落盘），建议单独立项共识后处理。
2. **IC-25（C2）recordFallback 纳入镜像写契约**：与 IC-23 同族（同一权威文件写语义），建议随下次涉 CAS 轮次顺带收口（单调 token / version +1 / CAS 三选一收敛）。
3. **IC-26（C3）stateDir 校验口径统一**：paths 校验下沉共用或显式声明双口径边界；Config.stateDir 绝对路径组合未被实际使用前无急迫性。
4. **IC-27（C4）events.js 注释引注刷新**：文档性一行，下次触碰 events.js 头注时顺手修正。
5. **IC-28 / IC-29（N1/N2）**：各自 ralplan 评估立项（mission board 任务板面 / 用量与上下文压力可观测面）——均为上游对照缺口，立项与否须先析 dsh 宿主等价面与用户价值。
6. **IC-30（疑点①）hb.log 处置**：登记已闭环；实际删除仅限用户显式确认，无默认动作。
7. **IC-31（疑点④）effort**：评估记录已落位；登记位回写（parity G#36/#10）归编排方 Follow-ups；二期补齐=数据管道工程（宿主注入或档位表镜像），立项另议。
8. **S4 披露层级可选改进**（非 IC 项，external §2③）：skipped 降级目前在代码/状态面可见（能力矩阵 + 协议口径），可选项=在 README/hud SKILL 文档层显式宣称「CLI 会话 hudRoute 记 skipped」的对标承诺句，对齐官方披露层级；纯文档可选，无缺陷。

观察项（不占 P 级）：EL1 trace 读面窗口绑定（二期候选，随 trace 面任何二期工作一并评估）；U8 轮转二期风险复评已在案（F2）。

---

## 附：pass 自检（对照计划 §2-S5）

- 终稿十节齐且证据回链：✓（§1-§10；每节回链四份步骤产出的节/file:line）。
- 16 维全集覆盖：✓（聚焦 9 维逐维评分 §9.1；非聚焦 7 维各一行不适用+理由 §9.2）。
- IC 行 schema 合规：✓（IC-24~IC-31 共 8 行；维度 id ∈ D1-D16，无 D17；发现/诊断/共识/执行/守门/定档 枚举全部合法值）。
- 两个指针行在案：✓（plugin-audit-2026-10-26.md 与 plugin-review-closure-hud-ux-2026-10-26.md 头部各一行）。
- C1-C4/N1/N2/疑点①④全部有落点：✓（§5.3/§6.3/§8 + IC-24~IC-31）。
- 候选题如实归档：✓（MCP 无状态边界 = uncertain + pending，§7）。
