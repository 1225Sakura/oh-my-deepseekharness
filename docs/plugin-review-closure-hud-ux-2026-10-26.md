# 插件全面审查：链路闭环 / HUD 价值 / 人性化使用

> 日期：2026-10-26。对象：`@sakura12/oh-my-deepseekharness` v0.5.2（D:\omd 工作副本）。
> 方法：ralph 循环 + 4 路并行只读审查（全部论断以当前代码 file:line 实证，不采信 README/声明）；详版证据附件：`.omd/prd/checks/review-mcp-tools.md`（附A）、`review-host-chain.md`（附B）、`review-hud.md`（附C）、`review-usability.md`（附D）。
> 动机：用户三点抱怨——①链路无法闭环、大部分东西被降级；②HUD 价值为 0；③人性化使用为 0。

---

## 执行摘要（直接回应三点）

**① 「链路无法闭环，大部分被降级」——感知属实，但事实与感知有出入。** 工具链路本身大体健康：55 个 MCP 工具中 **53 个端到端闭环**（MCP → lib → 落盘 → 可读回，附A 逐组实证），零 TODO/stub。「全是降级」的观感来自三个真实来源：
- **能力矩阵残影**：仓库 0.5.2 已移除 `hooksBridge` 探测行（lib/probe.js:38-41），但 web profile 实装的是 **0.5.1**（实装 lib/probe.js:64-65 仍有该行）——用户每次会话都看到一行恒 `unavailable` 的噪音项。这不是降级，是**版本漂移**。
- **2 条真实断链**（team 组库能力存在但 MCP 未接线，见下 [断链]#1/#2）。
- **3 条文档化架构边界**（graph agent 节点不自动派发、mailbox 无推送、heartbeat 催促归模型）——代码头注诚实登记（lib/hud-route.js:84-86、lib/heartbeat.js:6-8），但对用户而言「声明了却不闭环」即降级。

**② 「HUD 价值为 0」——属实，且根因是结构性的。** 实测（2026-10-26T09:52Z，附C C.2 节实测输出原文）：ralph 正在干活时 HUD 显示「轮次: 0 / 代理: 0 / 故事: 缺席」——三个关键字段全靠模型自觉 `state_write`、无运行时保障（state.mjs:101-103 纯透传）；workers 区展示 27 天前已完结 run 的僵尸队员（hud-route.js:34-71 无终态过滤）；95% 的普通会话（非五种 omd 模式）面板恒为 idle 广告页（实测 15 个会话目录 13 个空）。HUD 回答的是「omd 系统认为自己处于什么状态」，不回答用户真正问的「我的活儿干到哪了」。

**③ 「人性化使用为 0」——过判，但有两处「对用户说谎/卡死」的阻断级问题。** 旧审查（docs/usability-humanization-review.md）33 条修复复核大部分属实，仍发现：HUD 面板 stale 文案写死「已超过 2 小时」（lib/client.js:181）而 team 阈值实为 5 分钟（lib/config.js:37）——**对用户谎报时长**；孤儿扫描提示「需人工处置」却不给处置命令（lib/worktree.js:147）——**报警不给出路**；42 个技能在 `/omd` 帮助面集体隐身（lib/commands.js:18-37 只列 8 个模式关键词）。

---

## 一、链路闭环审查

### 1.1 MCP 工具面总账（附A 详版）

注册入口 mcp-server/index.mjs:23-31，九组计数 = state 5 + notepad 6 + prd 4 + handoff 3 + team 16 + trace 4 + hud 2 + graph 6 + codeintel 9 = **55**，与 lib/index.js:128 降级文案一致。共享基建完整：原子写 mcp-server/lib/atomic.mjs:7-28、路径白名单 mcp-server/lib/paths.mjs:20-41、三区解析 mcp-server/lib/markdown.mjs:19-52。

| 组 | 注册 | 闭环状态 | 关键证据 |
|---|---|---|---|
| state（5） | ✅ | ✅ 闭环（CAS+所有权+锁域） | mcp-server/tools/state.mjs:11-133 |
| notepad（6） | ✅ | ✅ 闭环（三区 TTL） | mcp-server/tools/notepad.mjs:10-66 |
| prd（4） | ✅ | ✅ 闭环（evidence 强制+修订台账） | mcp-server/tools/prd.mjs:10-107 |
| handoff（3） | ✅ | ✅ 闭环 | mcp-server/tools/handoff.mjs:14-58 |
| team（16） | ✅ | ⚠️ 闭环带 2 处断链 | mcp-server/tools/team.mjs:19-200 |
| trace（4） | ✅ | ✅ 闭环 | mcp-server/tools/trace.mjs:39-155 |
| hud（2） | ✅ | ✅ 闭环（派生读面） | mcp-server/tools/hud.mjs:10-45 |
| graph（6） | ✅ | ✅ 闭环（全仓最重：journal/fence/scheduler 全真实现） | mcp-server/tools/graph.mjs:144-502、lib/graph/runner.js:242-471、lib/graph/journal.js:300-363 |
| codeintel（9） | ✅ | ✅ 闭环（LSP 为配置态显式降级） | mcp-server/tools/codeintel.mjs:66-379、mcp-server/tools/codeintel-astgrep.mjs:89-152 |

宿主挂载链：lib/index.js:112-124 经 dsh-mcp-client stdio 拉起 + 三 env 注入（lib/index.js:120），`failOnStartupError:false`（lib/index.js:121）挂载失败降级不阻断。

### 1.2 [断链] 清单（真实断链，非感知）

1. **[断链] `cancelTeamRun` 无 MCP 接线**：lib/worktree.js:215-229 的「取消前列差异提示」实现完整且有测试（tests/lib/worktree.test.js:149），但 mcp-server/tools/team.mjs:35-37/98-101 只暴露 `team_dispose`——**没有任何 MCP 工具调用 cancelTeamRun**，取消提示面在工具层不可达。
2. **[断链] `isSessionActive` 恒 false**：scanOrphans/beginTeamRun 的活跃会话判定默认 `async () => false`（lib/worktree.js:132/158），team.mjs:30-42 从不传该注入。后果：①beginTeamRun「存活 run 拒绝覆写」防线（lib/worktree.js:163-165）在 MCP 路径**永不触发**；②孤儿扫描把存活 run 也报成孤儿候选（lib/worktree.js:144 恒走 false 分支）。
3. **[降级·非断链] lsp_***：Config `codeIntel.lspServers` 为空时显式报错（mcp-server/tools/codeintel.mjs:83-86），配置态降级而非实现缺失；probe 如实记录（lib/index.js:199-208）。
4. **[架构边界·文档化]** graph agent 节点不自动派发、mailbox 无推送、heartbeat 催促归模型（docs/plugin-audit-2026-10-26.md、lib/heartbeat.js:6-8 头注）——非暗坑，但属「声明面 > 闭环面」。

### 1.3 能力矩阵与探测实证（附B 详版）

矩阵 = 真探测（core/storage，lib/probe.js:42-67）+ apply 注册结果追加（lib/index.js:51-210）；README.md:169 已声明「注册成功≠探测通过」。mcpServer 刻意渲染为 mounted（lib/protocol.js:18-20）。**根因**：用户看到的「大部分降级」观感主要来自矩阵残影——仓库 0.5.2 已删 hooksBridge 行（lib/probe.js:38-41），实装 0.5.1 仍显示（实装漂移）。

### 1.4 [虚标] 清单（声明 vs 实测）

| # | 声明 | 出处 | 实测 | 判定 |
|---|---|---|---|---|
| 1 | Tests: 558 passed | README.md:3、README.md:183 | `npx vitest run` = 46 files / **576** passed | ❌ 虚标（陈旧，少标） |
| 2 | 「2 个斜杠命令」 | README.md:11、README.md:51 | lib/commands.js:96/:108/:115 实际 **3** 个 | ❌ 虚标（少标） |
| 3 | 记忆工具只列 set/get/delete | README.md:76 | lib/memory.js:150 还有 `omd_memory_list` | ⚠️ 漏列 |
| 4 | hooksBridge unavailable | 会话能力矩阵 | 0.5.2 已移除（lib/probe.js:38-41），实装 0.5.1 残影 | ⚠️ 漂移 |
| 5 | Config 键表 | README.md:87-102、lib/config.js:4-55 | lib/hud-route.js:78 消费 `hudPreset`、:129 消费 `graph.stalledAfterMs` 均未登记 | ⚠️ 未文档化配置面 |
| ✅ | 42 skills / 55 tools / 33 角色卡 / 档位分布 | package.json:4、README.md:11 | 清点全部相符 | ✅ |

**根因分类汇总**（每断链/虚标给出最小修复路径）：
- 断链#1/#2 根因 = 插件未接线（lib 能力已在，MCP 层缺一行注入/一个工具）→ 修 mcp-server/tools/team.mjs:30-42 传注入、加 cancel 工具。
- 虚标#1/#2/#3 根因 = 文档未随代码演进 → 修 README.md 对应行。
- 虚标#4 根因 = 实装版本漂移 → 升级 profile 实装至 0.5.2 即消。
- 虚标#5 根因 = Config schema 未声明 → 修 lib/config.js:4-55 补键。

---

## 二、HUD 价值审查

### 2.1 展示字段与数据源链路（附C 详版）

HUD 三承载面：MCP 面（mcp-server/tools/hud.mjs:15-27，数据源严格=state_get_status+notepad_stats，mcp-server/tools/hud.mjs:4,17-18）；HTTP 面 `/oh-my-dsh/hud.json`（lib/hud-route.js:116-154，追加 detail/tier/modeCatalog/preset/workers/toolCalls/alerts）；Client 面板（lib/client.js:387-400 注册 tab，轮询 5s→30s 退避 lib/client.js:80-82）。五要素 wire 契约 lib/hud.js:25；渲染 lib/hud.js:136-174。

**死数据路径实证**：c6 run-state.json 七字段镜像（lib/runstate.js:16）设计为「与 HUD 五要素同名对齐」，实际 HUD 三面（mcp-server/tools/hud.mjs、lib/hud.js、lib/hud-route.js、lib/client.js）**零处引用**（grep 实证），当前 `.omd/state/run-state.json` 甚至不存在（Test-Path=False）——一条纯写不读的数据流水线。

### 2.2 实测输出（2026-10-26T09:52:36Z 实跑，探针 .omd/prd/checks/hud-probe.mjs 可复跑）

`hud_render` 卡片原文（ralph 活跃中）：
```
[omd] 编排状态
模式: ralph（Ralph 循环）
阶段: execution
轮次: 0
代理: 0 个活跃代理
记忆: 永久 6 · 工作 1 · 手动 0
```
`hud_summary`：`{"mode":"ralph","round":0,"story":null,"agents":0,"todo":{"working":1,"priority":6,"manual":0}}`
`hudSnapshot` 私有面：`workers.list` = 2 名 `status:"done"` 队员，来自 **27 天前已完结** run `hud-clarity-v4`；`toolCalls` = 8 条横跨两周的 c3 路由判定（全为 `"kind":"route"`，与当前会话无关）；`alerts:[]`，`tier:"ok"`。

逐字段信息量：模式（低，用户自知）/ 阶段（中低，自觉值）/ **轮次 0（零——ralph 实际在干活，全程撒谎）** / **代理 0（负——实际有 subagent 在跑）** / 故事 null（零，无人写）/ 记忆计数（低）/ workers（负——僵尸名单）/ toolCalls（零——名实不符）/ alerts（中，唯一可行动区）。

### 2.3 根因（按权重）

- **R1 结构性空态（首因）**：HUD 只看得见五种 omd 模式的 state 文件（mcp-server/tools/state.mjs:77-94）；95% 普通会话面板恒为 idle 广告页（实测 15 会话目录 13 空）。
- **R2 关键字段无写者保障**：round/story/agents 全靠模型自觉 state_write（state.mjs:101-103 纯透传）；skill 自认「agents=0 属正常」（assets/skills/hud/SKILL.zh.md:29）。HUD 展示的是自觉填报数据，不是运行时事实。
- **R3 与真实工作脱节**：`.omd/prd/*.json` 现成的 story 进度完全没接；HUD 不回答「我的活儿干到哪了」。
- **R4 私有面考古数据**：workers 无 run 终态过滤（lib/hud-route.js:34-71）；toolCalls 名实不符（路由判定≠工具调用，lib/hud-route.js:127-131）。
- **R5 死数据路径**：run-state.json 纯写不读（见 2.1）。
- **R6/R7 次要**：入口深（lib/client.js:391-396 guide 胶囊）；stale 文案矛盾（lib/client.js:181 写死 2h × team 5min）。

### 2.4 HUD 重设计提案

原则：从「omd 模式自报状态镜」改为「当前会话工作进度的可行动信号板」；宁可少而真，不可多而编。

值得展示的信号（数据源现状 → 改动）：① **PRD 进度**（`.omd/prd/*.json` 现成 + ralph state 已有 `prd_path`，只需 lib/hud-route.js:116 hudSnapshot 里 join 一次）；② **最近活动时间**（updatedAt 已有，state.mjs:104）；③ **告警置顶全 preset**（lib/hud-route.js:128-134 已有）；④ **活跃队员过滤**（phase!=='complete' 过滤，lib/hud-route.js:53-67 小改）；⑤ **最近 N 次派发明细**（events.jsonl 逐条 route 事件已有，计数改明细小改）；⑥ **任务句**（prompt_echo 现成，截断展示）。删除/降级到 full preset：轮次/代理计数/记忆计数/toolCalls 计数/僵尸 workers。

最小落地改动点（不动 wire 契约 lib/hud.js:25）：lib/hud-route.js:116-154（聚合过滤+PRD join）、lib/hud.js:136-174（卡面首行改任务句）、lib/client.js:168-190（行项对齐）。

---

## 三、人性化使用审查

按用户旅程四阶段（详版附D，每条带证据；严重度：阻断级/困扰级/不适级）：

### 阶段一：安装/初始化
- **摩擦点1 [阻断级]** 忘重启 profile = 无声死局：插件缺席零报错，而验装工具 /omd-doctor 本身也依赖这次重启才存在（README.md:25、assets/skills/omd-setup/SKILL.zh.md:28）。自救线索埋在 README 引用块里。
- **摩擦点2 [困扰级]** Config 写在哪个文件全程没人说：README.md:107 示例头注 `# cordis.patch.yml` 误导指向包内只读挂载补丁（cordis.patch.yml:1-8）。

### 阶段二：触发/日常使用
- **摩擦点3 [困扰级]** 42 个技能在帮助面集体隐身：`/omd` 速查只列 8 个模式关键词（lib/commands.js:18-37），39 个非模式技能唯一发现入口是用户不可见的系统提示词。
- **摩擦点4 [困扰级]** autopilot 的 messageStart 锚定制造「同一句话两种命运」：「autopilot 帮我做 X」武装、「请帮我做一个 X」不武装（lib/hook.js:79-88），用户无法预测激活与否。
- **摩擦点5 [不适级]** 编排协议全量常驻 ~110 行，含 30 个未实现 OMC hook 名单（lib/protocol.js:48）与 500+ 字接线面注（lib/protocol.js:70）——纯上下文成本。

### 阶段三：观察/反馈
- **摩擦点6 [阻断级]** HUD 面板 stale 文案对用户说谎：写死「已超过 2 小时」（lib/client.js:181），team 阈值实为 5 分钟（lib/config.js:37）；MCP 卡已修（lib/hud.js:168），client half 漏修（手工 CJS bundle 无单源）。
- **摩擦点7 [困扰级]** 面板「任务」标签实为代理计数（lib/client.js:176），与 lib/hud.js:161「代理」口径分裂——同一会话两个 HUD 面说两套话。
- **摩擦点8 [困扰级]** 告警呈面依赖用户恰好开着面板：team stale / graph 停滞（lib/hud-route.js:102）对未开面板用户零推送。

### 阶段四：异常恢复
- **摩擦点9 [困扰级]** 孤儿扫描提示不给处置路径：「需人工处置，绝不自动删」（lib/worktree.js:147）之后没说怎么处置。
- **摩擦点10 [困扰级]** CAS/所有权错误消息为英文协议术语且无恢复指引（mcp-server/tools/state.mjs:61/:63）——对照同仓做得好的 lib/worktree.js:165（有动作指引）。
- **摩擦点11 [困扰级]** 「stale」一词三种阈值无总表：队员 5min（lib/config.js:37）/ 模式状态 2h（assets/skills/ralph/SKILL.zh.md:65）/ graph fence 30s（assets/skills/graph/SKILL.zh.md:124）。
- **摩擦点12 [不适级]** /omd-cancel 只是发 prompt 给助手（lib/commands.js:114-121），「一键取消并确信干净」的确定性路径不存在。

### 改进清单（按性价比排序）

| # | 改动点 | 用户可感知效果 |
|---|---|---|
| 1 | lib/client.js:181 + lib/client.js:176 两行文案 | 消除 stale 时长谎报；GUI 与 MCP 卡口径统一 |
| 2 | lib/worktree.js:147 提示尾部补处置命令（team_dispose 或手动删路径） | 崩溃恢复提示从「报警」变「出路」 |
| 3 | lib/commands.js:18-37 /omd 帮助补技能目录指引 | 「能干什么」的答案不再漏 90% |
| 4 | mcp-server/tools/state.mjs:61/:63、lib/worktree.js:118 错误中文化+恢复动作 | CAS 冲突从死胡同变自恢复指引 |
| 5 | assets/skills/omd-setup/SKILL.zh.md:32、README.md:106 写明 Config 实际位置 | 配置从「知道有键」到「知道在哪改」 |
| 6 | 新增「stale 三阈值总表」文档小节 | 同一术语不再一词三义 |
| 7 | lib/protocol.js:48/:70 未实现 hook 名单与接线面注移出常驻注入 | 每会话注入缩 ~15% |
| 8 | heartbeat 告警注入协议动态 context | 未开面板用户也能看到 stale 信号 |

---

## 四、修复 backlog（P0/P1/P2）

| 级别 | 项 | 改动点 | 预期验证方式 |
|---|---|---|---|
| **P0** | HUD 面板 stale 文案谎报 | lib/client.js:181 对齐 lib/hud.js:168 读 server 真实阈值 | GUI 面板 team 队员 6min 无心跳时不再显示「2 小时」 |
| **P0** | 断链#2 isSessionActive 恒 false | mcp-server/tools/team.mjs:30-42 传入真实活跃会话判定 | team_scan_orphans 不再把存活 run 报成孤儿；beginTeamRun 防线可触发（单测） |
| **P0** | 断链#1 cancelTeamRun 未接线 | mcp-server/tools/team.mjs 暴露取消路径（或 team_dispose 前调 cancelTeamRun） | 经 MCP 取消 run 时能看到差异提示（单测） |
| **P0** | 实装版本漂移（hooksBridge 残影） | web profile 实装升级 0.5.1→0.5.2 | 新会话能力矩阵无 hooksBridge 行 |
| **P1** | HUD 重设计（R1-R5） | lib/hud-route.js:116、lib/hud.js:136、lib/client.js:168（见 2.4） | HUD 首行显示任务句+PRD 进度；workers 无僵尸；`node .omd/prd/checks/hud-probe.mjs` 复跑对比 |
| **P1** | 孤儿提示补处置命令 | lib/worktree.js:147 | 提示含 team_dispose 用法（单测断言文案） |
| **P1** | README 数字修正 | README.md:3/:11/:51/:76/:183（558→576、2→3 命令、补 memory_list） | 数字与实测一致 |
| **P1** | /omd 帮助补技能目录 | lib/commands.js:18-37 | /omd 输出含非模式技能指引 |
| **P2** | CAS/所有权错误中文化+恢复指引 | mcp-server/tools/state.mjs:61/:63、lib/worktree.js:118 | 错误消息含重试动作 |
| **P2** | Config 穿透键登记 | lib/config.js:4-55 补 hudPreset/graph.stalledAfterMs + README 配置表 | Config 表与实际消费一致 |
| **P2** | stale 阈值总表 | assets/skills/hud 或 README 新增小节 | 一处可查三阈值 |
| **P2** | 协议注入瘦身 | lib/protocol.js:48/:70 移出常驻 | 注入行数下降 ~15% |
| **P2** | Config 文件位置文档 | assets/skills/omd-setup/SKILL.zh.md:32、README.md:106 | 新用户可定位配置文件 |

---

## 附录：引用抽验

抽验方法：从本报告随机抽 10 条 file:line 引用，脚本核验文件存在且该行非空。抽验脚本：`.omd/prd/checks/citation-spotcheck.cjs`（可复跑）。

### 抽验记录（2026-10-26 实跑原始输出，10/10 通过）

```
PASS lib/probe.js:38 -> * 2026-10-26 审查：M3 hooks 桥残件探测行已移除——dsh 宿主根本没有 ctx.hooks 服务，
PASS lib/worktree.js:215 -> export async function cancelTeamRun({ cwd, runId, stateDir = '.omd', expectUpdat
PASS mcp-server/tools/team.mjs:35 -> async function dispose({ cwd, runId, stateDir = '.omd', reason = 'verified', exp
PASS lib/index.js:120 -> env: { OMD_STATE_DIR: config.stateDir, OMD_CODE_INTEL: JSON.stringify(config.cod
PASS lib/hud-route.js:116 -> export async function hudSnapshot({ cwd, stateDir = '.omd', config } = {}) {
PASS lib/hud.js:136 -> export function renderCard(summary, detail) {
PASS lib/client.js:181 -> '状态已超过 2 小时未更新（上次更新：' + (mm.updatedAt != null ? mm.updatedAt : '-') + '）'));
PASS lib/config.js:37 -> staleAfterMs: z.natural().min(1).default(300_000),
PASS lib/commands.js:18 -> export function renderOmdHelp() {
PASS mcp-server/tools/state.mjs:77 -> async function listActive({ cwd }) {

抽验结果: 10/10 通过
```

附带坐实：lib/client.js:181 确为写死的「2 小时」文案（P0 项实证）；lib/config.js:37 确为 team stale 阈值 300_000ms=5 分钟。

---

## 附录 B：修复记录（2026-10-26 同日全修，13/13 完成）

测试门：`npx vitest run` = **46 files / 581 passed 全绿**（修复前 576；新增 5 个测试锁定新行为：team_cancel 接线、isSessionActive 注入语义、R4 僵尸过滤、R3 PRD join、HUD 卡面新格式）。

| 级别 | 项 | 修复实证 |
|---|---|---|
| P0 | stale 文案谎报 | lib/client.js modeCard 改读 server 下发的 `staleAfterMs`（state.mjs getStatus 按模式双语义现算并随字段下发）；旧 server 无该字段时回退「不说时长」。测试断言 `not.toContain('已超过 2 小时')` |
| P0 | isSessionActive 恒 false | mcp-server/tools/team.mjs 新增 `isSessionActiveFor(cwd, stateDir)`：phase.json 终态→不活跃；非终态看 registry 心跳/phase 迁移时间新鲜度（2h 窗口）；无 team 信号回落 run-state updatedAt。新测试坐实：陈旧心跳 run 报孤儿、鲜活 run 触发「拒绝覆写」防线 |
| P0 | cancelTeamRun 未接线 | team.mjs 新增 `team_cancel` 工具（第 56 个 MCP 工具）：列差异提示 + reason=cancelled 两阶段拆除；测试坐实差异列表 + disposedReason=cancelled |
| P0 | 实装漂移 hooksBridge 残影 | `scripts/install-local.ps1` 已把仓库 0.5.2（含全部修复）装进 web profile；实测实装 probe.js 无 hooksBridge 行、client.js 无写死文案。重启 dsh web 后生效 |
| P1 | HUD 重设计 | ①state.mjs getStatus 加性透传 prompt_echo/prd_path/staleAfterMs + lastActivity（全部状态文件最新写）；②lib/hud.js renderCard 重排：首行任务句、模式·阶段合并、PRD 进度行、轮次「未上报」诚实口径、删除恒 0 的代理行、空态改「上次活动」；③lib/hud-route.js hudSnapshot 加 detail.prd join + workers 僵尸过滤（终态 phase run 整组跳过 + 终态队员过滤，filteredRuns/filteredWorkers 计数呈面）；④lib/client.js 面板对齐（任务句置顶、PRD 进度行、最近活动行）。端到端实测：任务句首行 + 「进度: story 4/4 通过」+ 僵尸 run 过滤（filteredRuns:1） |
| P1 | 孤儿提示不给出路 | lib/worktree.js:147 提示尾部补 team_dispose 处置命令与手动路径 |
| P1 | README 数字虚标 | 558→581（徽章+:183）、2→3 斜杠命令（:11/:51 + 补 /omd 行）、:76 补 omd_memory_list、:71 55→56/team×17 |
| P1 | /omd 帮助技能隐身 | lib/commands.js renderOmdHelp 补「技能」分区（39 个非模式技能按主题分组 + 名册指引） |
| P2 | CAS/所有权错误死胡同 | state.mjs:61/:63、worktree.js:118 中文化+恢复动作（保持 `conflict: ` 前缀机器契约，runstate.js isConflict 正则零破坏） |
| P2 | Config 穿透键未登记 | lib/config.js 登记 `hudPreset`（minimal/focused/full 默认 focused）与 `graph.stalledAfterMs`（默认 600000）；README 与 omd-setup 配置表同步 |
| P2 | stale 一词三义 | README 新增「stale 阈值总表」（队员 5min / 模式 2h / graph 10min，各带配置键） |
| P2 | 协议注入过载 | lib/protocol.js：30 个未实现 hook 名单收敛为一行指针（指向 docs/feature-parity-audit.md）、500+ 字接线面注收敛为一行指针；c5 节补 team_cancel 工具面 |
| P2 | Config 文件位置无答案 | omd-setup 双语 + README 配置示例写明：profile 目录 `cordis.patch.yml`（如 `C:\Users\<你>\.dsh\profiles\<profile>\cordis.patch.yml`）用 `- id: oh-my-dsh` + `config:` 覆盖形式；修正原示例「`# cordis.patch.yml` 头注指向包内只读文件」的误导 |

未修（如实声明）：docs/feature-parity-audit.md:16 等**历史审计文档**中的旧数字保留不动——它们是带日期的时点快照，不是活文档；活文档（README/package.json/omd-doctor/omd-setup）已全部对齐。
