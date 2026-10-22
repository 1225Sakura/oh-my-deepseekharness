# oh-my-dsh 插件使用体验与人性化 · 刻板审查报告

> 审查对象：`@sakura12/oh-my-deepseekharness` v0.4.9（D:\omd 工作副本）
> 审查立场：刻板——不粉饰、不推测，每条发现附可复核证据（文件:行号）。
> 严重度：P0=阻断/误导用户；P1=显著损害体验；P2=打磨项。

## 摘要

| 严重度 | 数量 | 含义 |
|---|---|---|
| P0 | 1 | 阻断/误导用户（omd-setup 包名错误，照抄即安装失败） |
| P1 | 15 | 显著损害体验（文档与实现漂移、失败反馈无原因、HUD 名实不符等） |
| P2 | 17 | 打磨项（措辞、示例选择、空态引导等） |

总计 **33 条发现**，分布于 6 个维度：安装与首跑 8 / 配置与状态 8 / 命令与关键词 4 / 交互反馈与文案 4 / HUD 与可见性 4 / 文档一致性 5。

总体结论（刻板口径）：插件的工程骨架（probe 降级、证据契约、守门测试、诚实声明段落）是认真的；**失守集中在文档与文案的保鲜**——omd-setup 技能双语版本整体过期（包名、计数、默认值三处硬伤），是最影响新用户的人性化伤口；其次是失败路径的反馈质量（delegate 失败无原因、cancel 确认过简）与 HUD 卡片的名实不符。33 条中没有任何一条指向核心运行时逻辑错误——问题全在「对人说话的那一层」。

## 审查对象清单

以下为本审查覆盖的用户交互面文件（逐一核实存在）：

- `README.md` — 安装与能力声明入口
- `package.json` — dsh.bundle/client 声明与 files 发布面
- `cordis.patch.yml` — cordis 补丁配置
- `bin/graph-runner.mjs` — graph CLI 入口
- `lib/index.js` — 插件入口（apply 装配）
- `lib/commands.js` — 斜杠命令注册
- `lib/config.js` — Config 模型与默认值
- `lib/keywords.js` — 关键词路由表
- `lib/hook.js` — keyword-hook（agent/pre-step）
- `lib/hud.js` — HUD 卡渲染
- `lib/hud-route.js` — /oh-my-dsh/hud.json 数据路由
- `lib/client.js` — client half（侧边栏 tab）
- `lib/delegate.js` — omd_delegate 派发工具
- `lib/probe.js` — 能力矩阵探测
- `lib/protocol.js` — 注入协议文本（模型路由表等）
- `mcp-server/index.mjs` — MCP server 装配
- `mcp-server/tools/state.mjs` — state_* 工具面
- `mcp-server/tools/prd.mjs` — prd_* 工具面
- `mcp-server/tools/hud.mjs` — hud_* 工具面
- `assets/skills/omd-setup` — 安装指引技能
- `assets/skills/omd-doctor` — 验装诊断技能
- `assets/skills/ralph` — ralph 技能
- `assets/skills/cancel` — 取消技能
- `docs/feature-parity-audit.md` — 功能对齐审计文档

## 安装与首跑

- [P0] omd-setup 技能全篇包名写错——安装/更新/卸载命令用的都是 `oh-my-dsh`，而 npm 真实包名是 `@sakura12/oh-my-deepseekharness`——verifier 实测 npm 上 `oh-my-dsh` 包真实存在（v0.1.7，amplifthq/oh-my-dsh，已停更的他包），新用户照抄不会 404，而是**静默装错同名他包**，比 404 更糟（证据：assets/skills/omd-setup/SKILL.zh.md:17、assets/skills/omd-setup/SKILL.zh.md:70、assets/skills/omd-setup/SKILL.zh.md:77；对照 package.json:2 与 README.md:19 的正确写法）
  修复建议：把 omd-setup 双语 SKILL 中所有 `dsh plugin ... add/remove oh-my-dsh` 改为 `@sakura12/oh-my-deepseekharness`，并加一条守门测试 grep 技能文档中的包名与 package.json name 字段一致。
- [P1] 验装预期计数全过时——omd-setup 声称预期「40 个 skill / 19 个角色卡 / 18 个 MCP 工具」，实际是 42 / 33 / 55；新用户跑 /omd-doctor 看到的数字与文档「预期全绿」描述对不上，会把健康安装误诊为注册缺口（证据：assets/skills/omd-setup/SKILL.zh.md:63；对照 README.md:57、README.md:58、README.md:59）
- [P1] omd-setup 宣称内置 MCP server「18 个工具：state×5、notepad×6、prd×4、handoff×3」，与实际 55 个工具（另含 team×16、graph×6、lsp×7 等）严重不符，用户对可用工具面的预期被系统性低估（证据：assets/skills/omd-setup/SKILL.zh.md:26；对照 README.md:59）
- [P2] README 兼容性声明把证据台账指向 `.omd/plans/dsh-02-compat-evidence.md`，但 .omd 是 gitignored 本地产物，npm 安装用户无法复核该声明的依据（证据：README.md:25、README.md:149）
- [P2] README 安装节止步于 add 命令与「验装：/omd-doctor」，没有「装完下一步做什么」的引导（如先跑 omd-setup 技能或快速上手表锚点），首跑动线断在安装与能力速览之间（证据：README.md:15、README.md:27、README.md:31）
- [P1] README 安装流程缺「重启/重载 profile」必做步骤——README 从 add 命令直接跳到验装（README.md:19 至 README.md:27）只字未提重载，而 omd-setup 明确装完必须重启或重载 profile 让插件树重载再开新会话；只看 README 首跑的用户插件根本不生效，/omd-doctor 也不存在（证据：README.md:19、README.md:27；对照 assets/skills/omd-setup/SKILL.zh.md:28）
- [P1] profile 概念对新人零解释且占位符自相矛盾——安装命令使用 --profile <name> 但全文不解释 profile 是什么、如何查看已有 profile 名；同一页相邻两行占位符一个叫 <name> 一个叫 <profile>，omd-setup 同样直接假设读者已懂（证据：README.md:19、README.md:22、assets/skills/omd-setup/SKILL.zh.md:17）
- [P1] graph-runner 把用户用法错误包装成运行时崩溃——缺参数抛 usage 错误（bin/graph-runner.mjs:43 至 bin/graph-runner.mjs:47），顶层 catch 一律加 graph-runner crash: 前缀输出 JSON 并以退出码 70 收场，用法错误与真崩溃同码同文案；无 --help 分支，descriptor JSON 解析失败（bin/graph-runner.mjs:53）同样只甩原始 Node 报错（证据：bin/graph-runner.mjs:43、bin/graph-runner.mjs:68、bin/graph-runner.mjs:75）

## 配置与状态

- [P1] 配置指引自相矛盾——omd-setup 的 Config 表把 `tiers.low/medium/high` 默认值写成 `deepseek-chat`/`deepseek-reasoner`，但 0.4.5 起实际默认是 `'inherit'`（继承主会话）；README 配置表已更新、setup 技能没跟上，用户按 setup 技能配置会得到与预期相反的路由行为（证据：assets/skills/omd-setup/SKILL.zh.md:37、assets/skills/omd-setup/SKILL.zh.md:39；对照 lib/config.js:8、lib/config.js:12、README.md:78）
- [P1] omd-setup 称「模型路由只在 workflow 路径硬生效；subagent 继承主会话模型（软路由）」，但 c1 接线后 `omd_delegate` 已是硬路由（tier/model 经 spawn 路径强制生效）；用户按旧文档会把硬路由派发当成软继承来规划成本（证据：assets/skills/omd-setup/SKILL.zh.md:51；对照 README.md:65）
- [P2] Config 分组说明文案覆盖不齐：`autopilot` 组与 `deepInterview` 组没有 `.description`（其余组均有），配置面板/自省输出里这两组键缺少人话解释（证据：lib/config.js:21、lib/config.js:28；对照有说明的 lib/config.js:33、lib/config.js:38）
- [P2] `stateDir` 可改名 `.omd` 只有一句「项目状态目录名」，但协议文本与技能文档里大量硬编码 `.omd/` 路径（状态契约、prd 路径、progress.txt），改名后的连锁影响没有任何文档说明（证据：lib/config.js:20、README.md:82；对照 README.md:124 整节仍以 `.omd/` 为标题）
- [P1] omd-setup 的 Config 表漏掉 5 个真实存在的键——routing.defaultTier、team.heartbeatIntervalMs、team.staleAfterMs、codeIntel.astGrep、codeIntel.lspServers 在代码中均有定义（lib/config.js:17 至 lib/config.js:19、lib/config.js:33 至 lib/config.js:48）且 README 配置表有收录（README.md:86 至 README.md:89），但 setup 指引的配置表完全没有这些行，用户无从得知 heartbeat 与 LSP 注册表可配（证据：assets/skills/omd-setup/SKILL.zh.md:34；对照 lib/config.js:17、lib/config.js:33、README.md:86）
- [P1] 能力矩阵失败时只给状态不给原因——probe 明明捕获了有界的 detail（lib/probe.js:31），协议渲染却只输出状态一列、把 detail 丢弃（lib/protocol.js:17 至 lib/protocol.js:20）；storage failure 时用户只见一行 failure，无原因、无下一步指引，hooksBridge 的「不算降级」说明（lib/probe.js:71）同样从不渲染（证据：lib/probe.js:31、lib/protocol.js:20、lib/probe.js:71）
- [P2] tiers 的用户可见 description 塞满版本考古——描述文本写「0.4.5 行为变更：自写死 glm-5.3-flash 改为继承主会话路由」，这是迁移历史而非配置说明，首次接触的用户读到的是无关版本叙事（证据：lib/config.js:11 至 lib/config.js:14）
- [P2] doctor 排障指引仍把 glm-5.3-flash 称作「默认」——omd-doctor 检查项 3 的实证教训写「默认 glm-5.3-flash 不在本部署允许名录」，与现行默认 inherit 矛盾，排障者可能误判自己配置错了（证据：assets/skills/omd-doctor/SKILL.zh.md:40；对照 lib/config.js:8 至 lib/config.js:10）

## 命令与关键词

- [P1] ralph 触发口径三处不一——README 快速上手说「`ralph:` 前缀」，锚定正则实际接受行首 `ralph:` 或「用 ralph …」两种形态，而 dsh 技能面 `/ralph` 斜杠形态（本次审查会话实证触发成功）完全绕过锚定守卫；用户无法从任何单一文档预知哪种写法生效、守卫保护哪种写法（证据：README.md:38、lib/keywords.js:36、lib/keywords.js:16）
- [P2] 退役词提示只说「请改用 autopilot 或 team」，不给一句可照抄的改写示例（如 `autopilot <你的任务>`）；从 OMC 迁移来的老用户要多猜一步（证据：lib/keywords.js:43、README.md:48）
- [P2] README 快速上手三模式表未收录仅有的两个斜杠命令——/omd-doctor 与 /omd-cancel 藏在后面第二张表里，命令面发现性依赖读完全文（证据：README.md:35、README.md:43、lib/commands.js:19）
- [P2] review 条目命中后只注入行内指引块而非完整 skill（keywords.js 的 note 纪律），但没有任何面向用户的文档说明「code review」触发的是轻量指引而非完整评审——同一类触发词在不同条目下体验不一致且无交代（证据：lib/keywords.js:24、lib/keywords.js:26）

## 交互反馈与文案

- [P1] omd_delegate 派发失败的工具渲染只回 `omd_delegate 派发失败：dispatchId=…`，不带任何失败原因；输出 schema 没有 error 字段，调用方拿不到可行动信息只能盲重试（证据：lib/delegate.js:94、lib/delegate.js:96；对照同文件参数校验错误带完整原因的 lib/delegate.js:48、lib/delegate.js:55）
- [P2] /omd-cancel 的即时确认只有一句「omd 取消协议已触发。」，不像 /omd-doctor 那样说明「结果将由助手报告」——取消恰是用户最焦虑的场景，即时反馈反而最沉默（证据：lib/commands.js:32；对照 lib/commands.js:24）
- [P2] keyword-hook 的激活注入块全是面向模型的协议术语（[MAGIC KEYWORD] / expectUpdatedAt / state_write），GUI 里这段文本用户可见却零人话——没有任何一句「已为你激活 ralph 模式」的面向人提示（证据：lib/hook.js:111、lib/hook.js:113、lib/hook.js:115）
- [P2] 退役关键词提示引用上游项目版本语境「OMC v5.0」而非 omd 自身版本；omd 用户未必知道 OMC 是什么，提示的同情对象错了（证据：lib/keywords.js:43）

## HUD 与可见性

- [P1] HUD 摘要卡五要素缺 story——HUD_FIELDS 内容契约含 story，但 renderCard 实际渲染 模式/阶段/轮次/任务/记忆 五行，「任务」行显示的却是活跃代理计数（agents），story 在卡片上整体缺席且「任务」标签名实不符（证据：lib/hud.js:25、lib/hud.js:147、lib/hud.js:152）
- [P1] hud.js 模块头注停留在 0.3.0——「client 端（1.x 路线）……当前 0.3.0 范围外」，但 0.4.9 实际已全量落地 client half（lib/client.js + lib/hud-route.js + README 能力速览 HUD 行）；模块权威注释落后两个版本，维护者会被误导以为面板不存在（证据：lib/hud.js:20、lib/hud.js:22；对照 README.md:61）
- [P2] stale 文案写死「状态已超过 2 小时未更新」，但 team 模式的 stale 阈值实为 5 分钟（Config team.staleAfterMs 默认 300000）——同一文案覆盖不同阈值，用户无法从卡片判断真实超时时长（证据：lib/hud.js:158；对照 lib/config.js:35）
- [P2] HUD 空态只列 5 个模式名与中文 label，不给一句话启动示例——空态是新手第一触点，README 快速上手表现成的一句话示例没有被借过来（证据：lib/hud.js:138、lib/hud.js:139；对照 README.md:37）

## 文档一致性

- [P2] 工具参数示例与本仓库自己的失败实证互相打架——`omd_delegate` 的 model 参数描述拿 `glm-5.3-flash` 当示例，而 omd-doctor 技能明确记载该 id 在本部署两次硬路由以 `stopReason=error` 终止、且 0.4.5 起已不再是默认值；文档一边教用户避开、工具一边拿它当正面示例（证据：lib/delegate.js:145、assets/skills/omd-doctor/SKILL.zh.md:40；对照现行默认 lib/config.js:8）
- [P2] README 高估 probe 探测覆盖面——「启动时 probe 探测能力」一句话把 9 个探测项全归给 probe，但 lib/probe.js 实际只探测 core/storage/hooksBridge 三项，其余六项是 apply 注册结果的追加记录；用户会把「注册成功」误读为「探测通过」，对降级公告的信任基础是错的（证据：README.md:156、lib/probe.js:47、lib/probe.js:53、lib/probe.js:70；对照措辞更精确的 assets/skills/omd-doctor/SKILL.zh.md:55）
- [P1] README 兼容性声明窄化包元数据——README 写「dsh 宿主 0.1.7-rc.1+」，package.json 的 peerDependencies 实际声明四段 range（另含 0.1.2 与 0.1.5 两条线），omd-doctor 引用的也是完整四段；0.1.5 线用户只读 README 会误判自己不受支持（证据：README.md:25、package.json:62、assets/skills/omd-doctor/SKILL.zh.md:18）
- [P1] 双语资产同步失守已成系统性风险——omd-doctor 已更新到 42/33/55 的现行计数，omd-setup 中英双版却双双停留在旧计数与错误包名；同仓库两套同类文档漂移方向相反，且没有任何同步守卫（守门测试只断言 skills 名册，不断言文档间一致性）（证据：assets/skills/omd-doctor/SKILL.zh.md:28、assets/skills/omd-setup/SKILL.zh.md:63、assets/skills/omd-setup/SKILL.md:17）
- [P2] README「共 75 个技能目录条目」措辞误导——角色卡实为 assets/agents 下 66 个文件（33 角色×双语），目录只有 assets/skills 的 42 个；「目录条目」把两种存储形态混为一谈（证据：README.md:11；对照名册断言位置 assets/skills/omd-doctor/SKILL.zh.md:29）

## 审查方法

- **取证方式**：全部发现基于真实读文件（read/grep），跨文件三方互查（README ↔ 技能文档 ↔ 代码）；禁止无证据发现。
- **机器核验**：每条发现经 `.omd/prd/checks/check-report.js` 校验——严重度标记齐备、证据文件真实存在、引用行号不越界；文档一致性节额外要求「文档 vs 代码」双侧证据 ≥2 条。
- **实证复核**：`npm test` 全量 45 files / 552 tests 全绿（README:3 徽章与 README:169 声明属实，新鲜输出）；assets/skills 42 目录、assets/agents 66 文件（33 角色×双语）实测计数。
- **流程**：ralph PRD 驱动（`.omd/prd/usability-humanization-review.json`，5 story），每条 story 验收命令原始输出经 `prd_check` 落账；全部通过后由独立 omd-agent-verifier 子代理复验签字（重跑验收命令 + 抽查发现与代码原文相符性），复验结论记录于本节下方。

### verifier 复验记录

两轮独立复验（不同上下文子代理，互不串味）均裁决 **PASS**：

- **verifier A**（omd_delegate 前台派发，dispatch omdd-mvj0k5g0-2，omd-agent-verifier）：9 条验收命令重跑全 EXIT=0；6 条抽查（含 P0）全部与原文相符，裁决 PASS/APPROVE。
- **verifier B**（后台 subagent 213bb8ab）：9 条命令全 0；8 条抽查全支撑，裁决 PASS——并附一处事实修正：P0 的失败模式不是「404」（npm 上 oh-my-dsh 系已停更的同名他包，实测存在），而是**静默装错包**；报告 P0 条目措辞已按此修正，严重度反被加重。
- 两名 verifier 共同确认：全程未修改报告与检查器；抽查无伪造、无行号错置。
