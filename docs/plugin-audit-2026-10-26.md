# oh-my-dsh 插件全面审查报告（2026-10-26）

> **2026-10-29 重基线**：本报告发现已由 42ff80c/14183fc 及 team eco-completion 消化，逐条见文末「修复对照终章」；后续审计以终章为真值基准。
> 后续增量见 docs/plugin-review-logs-hud-2026-10-29.md（增量覆盖范围 = 平面 A 日志 + 平面 B HUD + 平面 C 决策链 + OMC v5.7.0 delta + 外部对标；不含旧篇全量复核）


审查对象：D:\omd（@sakura12/oh-my-deepseekharness，仓库版本 0.5.1）+ 实装环境（web profile 实装 0.4.9，GUI http://127.0.0.1:3080）。
方法：两个并行只读侦察子代理（降级面 / HUD 数据链路）+ 主会话对运行中 GUI 的实测 + dsh 宿主源码核验。
本报告由 ralph 循环 PRD .omd/prd/plugin-audit-2026-10-26.json 驱动；修复进度见「修复对照」章节（S10 完成时补齐）。

## 实证

实测一（HUD cwd 锚错位，2026-10-26 对运行中 GUI 实测）：
- `GET http://127.0.0.1:3080/oh-my-dsh/hud.json`（面板实际请求形态）→ 200，`cwd: C:\Users\36084`，mode=idle，记忆 0/0/0，workers 空。
- `GET /oh-my-dsh/hud.json?cwd=D:\omd` → 200，mode=ralph（本会话，阶段 prd-preparation），记忆 6/1/0，workers 2 名。
- 结论：数据链路完好；面板读的是宿主进程 cwd（用户家目录）下的残留 .omd，不是会话工作区。

实测二（实装漂移）：web profile package.json 依赖 `@sakura12/oh-my-deepseekharness: ^0.4.9`，实装 0.4.9；仓库 0.5.1。lib/ 下 13 个文件与实装不一致，即 0.5.0/0.5.1 的开发成果从未到达运行中的 GUI——「改了没用」的体感由此而来。

## 症状一：链路无法闭环，大面积降级

总评：主因不是单点 bug，而是架构取向——omd 把 OMC 的 hook/通知/消息缝全部转成「数据面 + 模型自觉」，五条主链各断一环：

1. **team 检测→催促断链**：heartbeat 扫描结果只写宿主日志，领队模型永远看不到（lib/heartbeat.js:51-52）；lib/team.js:13 自承「催促归领队模型」，但检测结果不到模型，催促永不发生。唯一闭环=领队主动调 team_heartbeat_scan。
2. **graph pending→回填断链**：agent 节点只写 agent_pending 后等待，不自动派发（lib/graph/runner.js:400）；watchdog 超时 subagent 不被杀（lib/graph/runner.js:329）；conditional/back_edge fail-fast 不支持（lib/graph/scheduler.js:42）。
3. **记忆写入→发现断链**：omd_memory_* 只有 set/get/delete，无 list/enumerate，新会话无法发现已有 key（lib/memory.js:117-143）；protocol 段通篇不提记忆工具（lib/protocol.js）；notepad 同理无会话开始注入。
4. **HUD 数据→面板断链**：见症状二。
5. **关键词→激活断链（部分）**：natural 意图关键词（autopilot/deep-interview/ai-slop-cleaner）无 hook 武装（lib/keywords.js:19-23），激活依赖模型自律。

降级面的具体问题：

- **hooksBridge 恒 unavailable 残件**：dsh 宿主根本没有 ctx.hooks 服务，该探测行是 M3 规划残件，构造性恒 unavailable（lib/probe.js:64-66）；虽被降级公告过滤（lib/index.js:86），仍作为噪音行出现在能力矩阵。
- **mcpServer 假绿灯**：failOnStartupError:false（lib/index.js:115），挂载成功≠server 真起来；stdio server 启动即崩时 55 个 MCP 工具静默缺席，真实冒烟只在 /omd-doctor。
- **skills 资产静默零加载**：readdir 失败 catch{} 吞掉，零 skill 无任何 probe 行（lib/skills.js:46）。
- **run-state 五要素镜像写多读无**：四个写面（lib/worktree.js:172、lib/runstate.js、lib/routing.js:96-110），读面仅 scanOrphans 看终态；镜像字段零消费者，也没有 team_read_mirror 读工具。
- **events.jsonl 单消费者**：唯一读面是 HUD 路由（lib/hud-route.js:95），MCP 无读工具。
- **动态 context 的 active 分支是死代码**：硬编码 active:[]（lib/index.js:82），活跃模式+恢复指引永不渲染（lib/runtime.js:13-18）。
- **bin/graph-runner.mjs 不随包发布**：package.json files 无 bin/、无 bin 字段，README 与 graph skill 引用的 CLI 入口对 npm 用户不存在。
- **mailbox 无推送**：领队→队员信件要队员轮询 team_mail_read；team_merge_plan 只出计划不执行合并（lib/team.js:14-15，文档化边界）。

（降级设计的正面：全部注册期降级均「记 probe + warn + 不阻断」，见 lib/index.js:93-202，这部分是健康的。）

## 症状二：HUD 作用为零

逐面结论（三个承载面）：

1. **MCP hud_render/hud_summary**：可用但被动——cwd 传对即有数据（mcp-server/tools/hud.mjs:15-26 需显式 cwd 参数），模型不主动调等于不存在。
2. **HTTP 路由 /oh-my-dsh/hud.json**：注册正常（web 宿主实测 200）；cwd 解析 `?cwd=` 缺省回落 process.cwd()（lib/hud-route.js:130）——这是病灶。
3. **GUI 右侧栏 tab**：注册机制合法，dsh keyed 座按 definition.id 派发（dsh-client-ui-sidebar-right client.js:5551），会被正常渲染——不是渲染层问题；但面板 fetch 从不带 ?cwd=（lib/client.js:65），仓库 0.5.1 与实装 0.4.9 此行一致，最新版也没修。

根因排序：
- H1【实证成立】cwd 锚定宿主进程而非会话工作区（lib/hud-route.js:130 × lib/client.js:65）。
- H2 空态不显示正在监测的目录，用户无法自诊（lib/client.js catalogView）。
- H3 round/story/agents 三字段靠模型 state_write 自觉写，无代码强制——本会话活跃 ralph 状态就缺这三个字段，修好 cwd 后「轮次/任务」仍显示空。
- H4 面板仅能从 guide 页胶囊打开，且插件激活后须重启 dsh web 才装载 client bundle。
- H5 MCP 面从未被主动调用（无任何自动呈现面）。

附带发现：C:\Users\36084\.omd 残留 36 条 events.jsonl 记录（delegate 落盘锚错位，lib/delegate.js:125 的 process.cwd() 回落所致；IC-12 守卫是后加的）。

## 症状三：人性化使用为零

1. **命令是 prompt 空壳**：/omd-doctor /omd-cancel 的 handler 只 followup 一段自然语言（lib/commands.js:22-33），零确定性逻辑，用户输命令后要等一轮 LLM 才知道发生了什么。
2. **无帮助入口**：没有 /omd 之类的速查命令；42 个技能、55 个 MCP 工具、5 个模式关键词全部只存在于系统提示词里，用户无 GUI 可发现路径。
3. **HUD 入口隐藏**：只能从右侧栏 guide 页胶囊打开（lib/client.js:337-341），且打开后默认读错目录（症状二 H1+H2）——首次体验即「这玩意没用」。
4. **错误呈现不友好**：注册失败只进宿主日志（ctx.logger.warn），用户在 GUI 里无感知；面板数据面错误文案虽然存在但被 H1 掩盖。
5. **安装链断裂**：实装 ^0.4.9 从 npm 安装（profile package.json），本地仓库 0.5.1 无任何「改动→生效」的文档化路径——开发者改完代码永远看不到效果。
6. **协议段信息过载**：系统提示词内的协议文本极长且全量常驻，重要降级公告淹没其中（lib/protocol.js 全文注入）。

## 修复对照

| 症状 | 根因 | 修复 story | 验证证据 |
|---|---|---|---|
| 二 HUD 读不到 | H1 面板 fetch 不带 ?cwd=，宿主回落 process.cwd()（lib/client.js:65 → lib/hud-route.js:130） | S2：useSessionCwd(props) + fetch 带 ?cwd=；cwd 未知显式提示拒绝回落 | tests/lib/client-bundle.test.js ⑳㉑；npx vitest run 435→绿 |
| 二 HUD 像坏掉 | H2 空态不显示监测目录；H3 未上报字段谎称 0 | S3：空态/minimal 显示「正在监测目录」；轮次/任务/故事缺失显示「未上报」 | client-bundle.test.js ㉒㉓㉔；全量 563 绿 |
| 一 降级噪音/静默 | hooksBridge 恒 unavailable 残件（lib/probe.js:64）；skills 零加载 catch{} 静默（lib/skills.js:46） | S4：残件探测行全清；loadAssets errors 归集 → probeReport.skills 行 | degradation.test.js 残件移除回归 + skills 可观测两测试；564 绿 |
| 一 检测→处置断链 | heartbeat 告警只进宿主日志（lib/heartbeat.js:51-52） | S5：scanAllRuns 导出复用，hudSnapshot 按请求 cwd 实弹扫描 → hud.json alerts 键 + 面板告警区 + tier 提升（C1 经 prd_amend rev2 修订：状态文件方案会复发 cwd 错位） | hud-route.test.js S5 两测试 + client-bundle.test.js ㉕；567 绿 |
| 一 CLI 入口缺失 | bin/graph-runner.mjs 不随包发布 | S6：files+bin 字段 | npm pack --dry-run 含 bin/graph-runner.mjs |
| 一 记忆写了没人读 | omd_memory_* 无 list（lib/memory.js:117-143），协议不提 | S7：omd_memory_list（table.keys() 枚举）+ 协议段提及 | memory.test.js S7 list 行为测试；568 绿 |
| 三 无帮助入口 | 仅 /omd-doctor /omd-cancel 且是 prompt 空壳（lib/commands.js:22-33） | S8：/omd 速查命令确定性直返（单源 KEYWORD_REGISTRY） | commands.test.js S8 测试（followup 零调用断言）；569 绿 |
| 三 安装链断裂 | profile 实装 ^0.4.9（npm），仓库 0.5.1 无生效路径 | S9：scripts/install-local.ps1 + README 小节（不自动执行，用户裁决） | Test-Path + README 命中×2 |

未修复（如实记录，超本轮范围）：graph agent 节点不自动派发（lib/graph/runner.js:400）、mailbox 无推送（lib/team.js:14-15）、natural 关键词无 hook 武装（lib/keywords.js:19/22/23）、动态 context active 分支死代码（lib/index.js:82，受宿主 cwd 锚限制无解于当前设计）、/omd-doctor /omd-cancel 仍为 prompt 壳（handler 无宿主侧确定性 API 可替）。安装 0.5.1 到 profile 的动作留给用户（scripts/install-local.ps1）。


---

## 第二轮（2026-10-26 遗留处置 + 0.5.1 增量评审）

对上一轮「未修复」清单的处置（PRD .omd/prd/fix-backlog-2026-10-26.json，verifier 签字见 PRD）：

| 遗留项 | 处置 | 证据 |
|---|---|---|
| /omd-doctor prompt 空壳 | **已确定性化**：async handler 直出 probe 矩阵 + 会话锚 + .omd 写删探针实测；异常才 followup（dsh-commands 对 handler 返回值 Promise.resolve+await，宿主契约核验在案） | tests/lib/commands.test.js S2 两测试 |
| natural 关键词无 hook 武装 | **autopilot 已武装**（messageStart 首行锚定+疑问守卫）；deep-interview/ai-slop-cleaner 维持模型层（触发词常见词误伤面大，裁决记录） | tests/lib/hook.test.js S3 正反对照 |
| graph agent 不自动派发 | **可见性闭环**：scanGraphRuns 停滞检测进 HUD alerts（waiting 非空且 journal >10min 未推进）；派发本身受架构约束（MCP server 无宿主 spawn 缝）维持模型驱动 | tests/lib/hud-route.test.js S4 |
| mailbox out 无推送 | **可见性闭环**：领队信件超 staleAfterMs 未 ack → HUD 告警（催促仍归领队模型，dsh 无插件→subagent 消息缝） | 同上 |
| 动态 context active 死代码 | **已复活**：assembleContextFor 的 agent.session.header.cwd 锚 + readActiveModesSync 同步有界读 | tests/lib/runtime.test.js S5 |

另含独立 reviewer 对第一轮 diff 的评审处置：P0×1（graph fixture 封印态）、P1×2（effect deps 缺 cwd；安装脚本临时目录残渣）、P2×7 全部处置（台账见 .omd/prd/progress.txt）。

版本：0.5.1 → **0.5.2**。

---

## 修复对照终章（2026-10-29，team eco-completion）

> 本节为当前真值基准：逐条对照「症状一/降级面」与 2026-10-29 源码实况（file:line 实证，team eco-completion W1 批次落地后复核）。

### 症状一：链路闭环（5 条）

| 原症状 | 当前状态 | 证据（file:line） |
|---|---|---|
| 1. team 检测→催促断链 | **维持文档化边界**（催促动作归领队模型，dsh 无插件→subagent 消息缝；检测+呈面健康） | lib/heartbeat.js:6-8 |
| 2. graph pending→回填断链 | **维持文档化边界**（agent 节点不自动派发，journal/fence 运行时本身为全真实现） | lib/graph/runner.js:400 |
| 3. 记忆写入→发现断链 | **已修复**：omd_memory_list 可枚举全部 key | lib/memory.js:150 |
| 4. HUD 数据→面板断链 | 见 [closure 文档终章](plugin-review-closure-hud-ux-2026-10-26.md)（终态过滤已修复；mirror 回退读/idle 页价值化排期中） | lib/hud-route.js:49/68 |
| 5. 关键词→激活断链（部分） | **部分修复**：autopilot 已 hook 武装（messageStart 首行锚定+疑问守卫，2026-10-26 第二轮 S3）；deep-interview / ai-slop-cleaner 仍无 hook 字段（残留，激活依赖模型自律） | lib/keywords.js（autopilot 键 hook:{arm:true,match:'messageStart'}；deep-interview/ai-slop-cleaner 键无 hook） |

### 降级面问题清单（8 项）

| 原问题 | 当前状态 | 证据（file:line） |
|---|---|---|
| hooksBridge 恒 unavailable 残件 | **已修复（移除）**：探测行删除，改为自述注释 | lib/probe.js:35-37 |
| mcpServer 假绿灯 | **修复进行中**：initialize 握手冒烟为 team eco-completion w-eco-B 在途任务；挂载降级语义（lib/index.js failOnStartupError:false）不变 | lib/index.js:121 |
| skills 资产静默零加载 | **已修复**：目录不可读归集进 errors，能力矩阵+降级公告可见 | lib/skills.js:49/65 |
| run-state 五要素镜像写多读无 | **已修复**：team_read_mirror 只读工具（team eco-completion W1 批次落地） | mcp-server/tools/team.mjs:171 |
| events.jsonl 单消费者 | **已修复**：events_read 只读审计面（tail + kind 过滤 + route:fallback 聚合对账；team eco-completion W1 批次落地） | mcp-server/tools/events.mjs:37、mcp-server/index.mjs:13/30 |
| 动态 context active 分支死代码 | **已修复**：活跃模式同步读面复活 | lib/runtime.js:6-22 |
| bin/graph-runner.mjs 不随包发布 | **已修复**：package.json bin 字段 | package.json:46 |
| mailbox 无推送 | **维持文档化边界**（队员轮询 team_mail_read；插件无推送缝） | lib/team.js 头注 |

### 附：原「[断链] 清单」两项（同日修复，避免与 closure 文档重复展开）

- cancelTeamRun 无 MCP 接线 → **已修复**：team_cancel 注册 | mcp-server/tools/team.mjs:155（实现 lib/worktree.js:215 起）
- isSessionActive 恒 false → **已修复**：盘上活性信号推导（活性窗 2h）注入 begin/scanOrphans | mcp-server/tools/team.mjs:42/64/80
