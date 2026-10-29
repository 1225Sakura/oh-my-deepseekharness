# omd 参考项目跟进升级计划（v0.4.2 起持续机制）

Status: active（goal 驱动，跨会话续跑）
基线：docs/feature-parity-audit.md（45 点，34✅/1⚠️/10🚫，对照 OMC 5.4.0 + OMX 0.21.5——**轮 9 起参考快照已刷至 v5.7.0/0.21.9，本基线过期，重基线=U7**）

全维度问题链：维度框架=docs/dimension-framework.md｜闭包脚本=scripts/audit-dimension-closure.mjs｜守门=tests/docs/dimension-chain.test.js（两层门：恒跑层只依赖 git 内事实 + reference 活体层缺席 skip+警告）——本文件 IC 节为问题链台账，经 .gitignore 外科式再包含（C-1 方案 A）随 git 分发。

## 2026-02-06 漂移扫描（参考快照刷新后）

- OMC：skills 39（audit 记 38；+1 经集合差确认无实质缺口——差异项 omc-doctor/omc-setup 为 omd 自有等价物、configure-notifications=🚫R-7）；**hooks 30+→40**（R-2 结论不变：dsh 宿主仅 agent/pre-step 拦截点，复评触发条件未变——宿主事件面无更新）；agents 19 ✓ 与 audit 一致
- OMCX：skills 29；差异 11 项中 9 项为退役/已决定/等价物（ultrawork/pipeline/ultraqa=R-5 退役；worker=R-5 并入 team 协议；visual-ralph=visual-verdict 覆盖；configure-notifications=R-7；omx-setup/doctor=omd 等价物）
- **真实新候选（2 项，待评估）**：OMX `autoresearch-goal`（goal 驱动变体——与 omd 的 dsh native goal 机制同构，优先评估移植）；OMX `code-review`（独立评审工作流，omd 现有 review skill + code-reviewer 角色，评估合并或移植）
- 本轮 HUD 升级已交付（见 ralplan-hud-clarity.md 附录 A）：preset 三档 + tier 色档 + modeCatalog 路由下发 + 双语 SKILL

## 升级积压（按优先级）

| # | 项 | 来源 | 状态 |
|---|---|---|---|
| U1 | OMX autoresearch-goal 评估移植 | 本轮漂移扫描 | ✅ 关闭（R1 裁决：OMX 0.21 已退役的日落存根——重复入口；omd autoresearch 已是 dsh goal 驱动的严格超集，Contract 即 create_goal+max_goal_rounds 熔断。零移植） |
| U2 | OMX code-review 评估+移植 | 本轮漂移扫描 | ✅ 已实现（R2）。落地=assets/skills/review/SKILL.zh.md + SKILL.md 新增「Merge-readiness 模式」节（双通道 fail-closed 门禁+合成矩阵+报告契约；不持模式状态）。流程=轻量共识（比例裁量：纯 markdown 资产、无代码/契约面）：draft → 独立 critic REVISE（3 MAJOR：来源注与「不持状态」契约矛盾/architect 词表须 lane prompt 提供/缺报告契约 BLOCK 防埋没；+4 minor）→ 按其修法逐条落地 → skills.test 5/5 绿。审计锚：评审裁决全文在本会话记录；上游=reference/oh-my-codex/skills/code-review |
| U3 | HUD Follow-up：state.mjs 加性透传 state/fixLoops（AC10 danger 真实生效）+ tier 并入 detail 下发（真单源）+ focused 档补取数时间 | ralplan-hud-clarity verify O1/O2 | ✅ 已实现（R3，独立 verifier VERIFIED：6 文件、289/289 新鲜绿、五环单源链路实证——state.mjs 透传→buildHudView deriveTier→hud-route detail.tier→client resolveTier 优先；focused 取数行分支隔离实证；比例裁量=verify 报告已定案的小步加性变更，writer+独立 verifier 分离） |
| U4 | graph DAG 运行时二期（audit 唯一 ⚠️；journal 格式已冻结） | audit #45 | 立项简报就绪：.omd/plans/u4-graph-runtime-brief.md（8 个必答设计问题 + 验收草案 + 非目标）——fresh session ralplan 直接以此为输入。**轮 9 附注：上游已到 v5.7.0，简报内 OMC 5.4.0 锚点行号立项前须重锚** |
| U5 | 插件激活：发版升级路径（npm publish 0.4.2 + profile 插件升级）+ 宿主重启 | 轮 9 | ✅ 已发版+已升级（仅剩用户重启宿主 + /omd-doctor 验装；回退段见轮 9 附记。原 npm pack→本地 add 路径已被 registry 发版路径取代，同步收口） |
| U6 | 多行 agent 树（依赖 active_agents 元素形状核实） | 附录 A.2 | ✅ 已实现（轮 14：自适应两级树，详见轮 14 附记）。**轮 9 附注：用户偏好=hud.json 聚合变体（聚合 team registry，不动 getStatus MCP 形状）；P2 一次性修订与 c5 一期共享（ralplan-omd-upgrade-hud-observability.md ADR 已落锤：仅 hud.json 私有面扩展，MCP wire 零变化）；轮 4 三案论证保留供其 ralplan 裁决** |

| U7 | audit 45 点全量重基线（基线=v5.7.0/0.21.9 新快照，逐点重评 45 项） | 轮 9 快照刷新 | ✅ 已完成（轮 16，详见轮 16 附记；35✅/0⚠️/0❌/10🚫 + 11 项新能力评估；吸收 S1 勘误三处） |
| U9 | dsh 0.2.0 兼容发版（peer ranges 拓宽含 0.2.0-rc 线 + 集成面复核 + R-2 复评 + 0.4.3 发版） | 轮 10 宿主升级 | ✅ 已发版 0.4.3（轮 11，详见轮 11 附记；仅剩用户重启验装 + /omd-doctor） |
| U8 | c5 HUD 工具调用可观测性一期 MVP（.omd/state/events.jsonl 落盘 route/fallback + hud.json 聚合 team registry/events + HudPanel full preset「队员」「工具调用」两区 + fallback>0 走 AC10 warn 色档） | deep-interview spec c5 节 | ✅ 已实现（轮 12，详见轮 12 附记；二期清单=zstd 会话解析/越界规则引擎/开销占比；OQ 残留=窗口/上限默认值口味与是否当轮 bump 0.4.4，留用户拍板） |

| U10 | 2g-A：委派路由 tiers 默认值 glm-5.3-flash → 'inherit'（行为变更）+ dsh 0.2.0 stable 二次复评 | 轮 11 U9 共识 | ◐ 第一半 ✅ 已落地（轮 17，ec96619，随 0.4.5 发版；用户拍板提前，照 Follow-up ① 备忘实施）；stable 二次复评仍待 dsh 0.2.0 stable 触发 |

**建议推进顺序（轮 14 更新）**：~~U9~~ ✅ → ~~U8~~ ✅（轮 12 已实现）→ ~~U6~~ ✅（轮 14 已实现）→ U4（简报就绪，fresh session ralplan）→ U7（重基线大工程，可同时吸收 OMC 5.7 新增评估与 U10 的 stable 二次复评）。

## 全维度问题链台账（IC）

> 迁移注记：U1-U10 为 legacy 已收口链（共识=各自评审档案，执行=附记，守门=对应测试面），原文保留不重写；其 open 残留以 IC-ID 重新入链（见 IC-18）。
> 列 schema（守门断言同源，改列必同步 tests/docs/dimension-chain.test.js L1b）：
> 发现=diff\|probe\|manual\|injected\|empirical；诊断=pending\|root-caused（root-caused 须在 `#### IC-<ID>` 附记含根因+证据锚）；共识=none-needed\|pending\|approved；执行=pending\|done\|observed-only\|wontfix(理由)；守门=assertion-live(测试名)\|conditional-review(触发条件)\|none-justified；定档=P0\|P1\|P2\|OBS。
> 终态：closed=诊断 root-caused ∧ 共识≠pending ∧ 执行∈{done,wontfix} ∧ 守门∈{assertion-live,conditional-review,none-justified}（wontfix 须共识=approved 且附记含理由）；observed=定档 OBS ∧ 执行=observed-only ∧ 附记含升格条件。
> 注入构成：spec 7 类 + 实证 2 类（IC-20/IC-21）。

| ID | 维度 | 项 | 发现 | 诊断 | 共识 | 执行 | 守门 | 定档 |
|---|---|---|---|---|---|---|---|---|
| IC-01 | D14 | graph runner 错误路径不杀在飞子进程——已修复（catch 收割 inflight childPid） | injected | root-caused | approved | done | assertion-live(tests/lib/graph-runner.test.js) | P2 |
| IC-02 | D14 | parked 优先于 failed 的终态歧义——已修复（park 返回体附 failed 摘要） | injected | root-caused | approved | done | assertion-live(tests/lib/graph-runner.test.js) | P2 |
| IC-03 | D14 | staleGraceMs 不持久化——已修复（owner.json 持久化 + readOwnerJson 白名单透传 + inspect 读回） | injected | root-caused | approved | done | assertion-live(tests/lib/graph-fence.test.js) | P2 |
| IC-04 | D14 | 护栏前缀计入 32768 上限——已修复（instructionsSchema 作者面上限独立） | injected | root-caused | approved | done | assertion-live(tests/lib/graph-schema.test.js) | P2 |
| IC-05 | D14 | schema parse 死导出 vs graph.mjs 手写校验双轨——已修复（wire 长度帽补强 + 头注权威分工声明） | injected | root-caused | approved | done | assertion-live(tests/mcp-server/graph.test.js) | P2 |
| IC-06 | D14 | outputs/ 直写无 symlink 防护——已修复（openNoFollow+assertPrivateRegularFile 同款纪律） | injected | root-caused | approved | done | assertion-live(tests/lib/graph-journal.test.js) | P2 |
| IC-07 | D14 | fence epoch 续号崩溃窗口——已修复（sidecar 先于 payload 写序对调） | injected | root-caused | approved | done | assertion-live(tests/lib/graph-fence.test.js) | P2 |
| IC-08 | D14 | projectAfter 裸 catch 降级——已修复（JournalCorruptionError 透传 20，三调用点包装） | injected | root-caused | approved | done | assertion-live(tests/mcp-server/graph.test.js) | P2 |
| IC-09 | D14 | append/watchdog O(n²)——已修复（maxSeq epoch 键缓存 + watchdog 快照复用） | injected | root-caused | approved | done | assertion-live(tests/lib/graph-e2e.test.js) | P2 |
| IC-10 | D15 | 测试盲区五处——已补齐（双 takeover/unlink ENOENT/watchdog 重排/truncate 回退/status fence 形状） | injected | root-caused | approved | done | assertion-live(tests/lib/graph-fence.test.js) | P2 |
| IC-11 | D15 | flake 二次现形（publish 环境 npm test 红/隔离绿，worktree.test.js 同族）——已去化 | empirical | root-caused | approved | done | conditional-review(下次 publish 链全量绿即终验) | P1 |
| IC-12 | D12 | omd_delegate 落盘锚=宿主进程 cwd（GUI 从 home 启动时污染 ~/.omd）——已修复（args.cwd 工作区优先 + 主目录锚守卫 + 死代码 stateRoot 删除） | empirical | root-caused | approved | done | assertion-live(tests/lib/delegate.test.js) | P1 |
| IC-13 | D16 | README 徽章漂移 519 vs 523——已修复（徽章+正文刷 538，L1f 守门断言覆盖） | diff | root-caused | none-needed | done | assertion-live(tests/docs/dimension-chain.test.js) | P2 |
| IC-14 | D2 | tdd 独立 skill 立项评估 | injected | pending | pending | pending | conditional-review(各自 ralplan) | P2 |
| IC-15 | D2 | refit 回顾工作流立项评估（须先析与 remember/self-improve 分工） | injected | pending | pending | pending | conditional-review(各自 ralplan) | P2 |
| IC-16 | D2 | architecture-survey 移植形态评估 | injected | pending | pending | pending | conditional-review(各自 ralplan) | P2 |
| IC-17 | D2 | intent 移植形态评估 | injected | pending | pending | pending | conditional-review(各自 ralplan) | P2 |
| IC-18 | D12 | dsh 0.2.0 stable 二次复评（U10 残留，含 tiers 默认值 0.5.0 候选） | injected | pending | pending | pending | conditional-review(dsh 0.2.0 stable 发布触发) | P2 |
| IC-19 | D5 | MAGIC KEYWORD 注入实发未观察（已观察：IC-20 误触发实例证明注入链路真实发效） | injected | root-caused | none-needed | done | none-justified | P2 |
| IC-20 | D12 | c2 keyword-hook 对 delegate prompt 正文「ralplan」字样误触发并预写状态——已修复（provisional 不绑定所有权） | empirical | root-caused | approved | done | assertion-live(tests/mcp-server/state.test.js) | P1 |
| IC-21 | D11 | inactive/残留模式状态无自动回收，阻塞新模式启动——已修复（inactive 不绑定所有权，supersede 留痕） | empirical | root-caused | approved | done | assertion-live(tests/mcp-server/state.test.js) | P1 |
| IC-22 | D16 | README 测试计数（files/tests）无恒跑守门覆盖——已修复（L1f：徽章 alt↔URL↔正文三面互断 + files 锚实测 test 文件数） | diff | root-caused | none-needed | done | assertion-live(tests/docs/dimension-chain.test.js) | P2 |
| IC-23 | D13 | casWriteRunState/runstate CAS 以 ISO 毫秒 updatedAt 为唯一 token——同毫秒并发双写碰撞即丢更新（version 同值互覆）——已修复（单调 token helper monotonicIsoNow 三处归一） | manual | root-caused | approved | done | assertion-live(tests/lib/worktree.test.js) | P2 |
| IC-24 | D12 | fallback 双审计面在派发失败车次上不同步（events 立即落盘 vs run-state 校验后落盘，失败车次 events 两行/run-state 无痕迹）（lhe C1） | manual | root-caused | approved(ralplan-p2) | done @1cb8d4b(同点落盘) | assertion-live(tests/lib/delegate.test.js C1 抛错车次双面同步) | P2 |
| IC-25 | D12 | recordFallback 与 c6 镜像写语义分叉（直写三键、version 不 +1、不经 CAS；fallback 写后队长下次 CAS 必多一次冲突重试）（lhe C2） | manual | root-caused | approved(ralplan-p2) | done @0c3b8a5(锁内 version+1+monotonicIsoNow) | assertion-live(tests/lib/routing.test.js C2 版本纪律+反向键存续) | P2 |
| IC-26 | D11 | stateDir 语义分裂：hook/state 面禁绝对路径与 .. 段、routing/events 面显式支持——Config.stateDir 绝对路径组合下预写失效而事件照常落盘（lhe C3） | manual | root-caused | approved(ralplan-p2) | done @0c3b8a5(注册期 omdPaths 预检+per-hit 降噪) | assertion-live(tests/lib/hook.test.js C3 注册期预检) |时) | P2 |
| IC-27 | D16 | lib/events.js:36 注释引 delegate.js:38/:55 行号漂移（现码 modelId 决策在 :58/:67），文档性引注失真（lhe C4） | manual | root-caused | none-needed | done @1cb8d4b(注释符号化) | verified(p2-verify-r1 零行号抽验) | P2 |
| IC-28 | D7 | 上游 mission board 面（mission-board.ts 636 行 + elements + missions/ 子系统）任务板/时间线呈面，omd 无对应承载（lhe N1） | diff | pending | pending | pending | conditional-review(各自 ralplan) | P2 |
| IC-29 | D7 | 上游用量/成本/上下文压力可观测面（usage-api + payload-estimate + custom-rate-provider + E3 族 6 元素），omd HUD 无此维度（lhe N2） | diff | pending | pending | pending | conditional-review(各自 ralplan) | P2 |
| IC-30 | D15 | .omd/hb.log 孤儿（v0.4.1 vitest 输出重定向一次性测试产物，全仓无写入方无读者）——confirmed，F4 范式登记（lhe 疑点①） | empirical | root-caused | approved | done | conditional-review(删除仅限用户显式确认) | P2 |
| IC-31 | D7 | HUD effort 无承载=设计内缺口（上游 effort.ts 数据源 statusline stdin，omd 读面钉死两拉取无通道；补齐=管道工程）（lhe 疑点④） | empirical | root-caused | approved | done | conditional-review(二期 effort 立项时复用评估记录) | P2 |

### 排序表（provisional，S6 终稿；P0/P1/P2 语义对齐轮 17 发版前审查制：P0=阻塞发版/数据损坏/宿主崩溃级；P1=功能缺陷无绕行/契约破坏；P2=质量债/文档漂移/盲区）

| 档 | ID | 项 | 依赖扇出(blocked-by) |
|---|---|---|---|
| P1 | IC-12 | home 锚定观察项 | - |
| P1 | IC-20 | keyword-hook 误触发（已闭环 0.4.8） | - |
| P1 | IC-21 | 残留模式状态无回收（已闭环 0.4.8） | - |
| P1 | IC-11 | flake 二次现形（已去化闭环） | - |
| P2 | IC-01 | graph runner 错误路径 | - |
| P2 | IC-02 | parked/failed 终态歧义 | - |
| P2 | IC-03 | staleGraceMs 不持久化 | - |
| P2 | IC-04 | 护栏前缀计入上限 | - |
| P2 | IC-05 | schema 双轨 | - |
| P2 | IC-06 | outputs/ 无 symlink 防护 | - |
| P2 | IC-07 | fence epoch 崩溃窗口 | - |
| P2 | IC-08 | projectAfter 裸 catch | - |
| P2 | IC-09 | append/watchdog O(n²) | - |
| P2 | IC-10 | 测试盲区五处 | - |
| P2 | IC-13 | README 徽章漂移 | - |
| P2 | IC-14 | tdd 立项 | - |
| P2 | IC-15 | refit 立项 | - |
| P2 | IC-16 | architecture-survey 立项 | - |
| P2 | IC-17 | intent 立项 | - |
| P2 | IC-18 | dsh 0.2.0 stable 复评 | - |
| P2 | IC-19 | MAGIC KEYWORD 观察 | - |
| P2 | IC-22 | README 测试计数无守门 | - |
| P2 | IC-23 | 同毫秒 CAS token 碰撞 | - |
| P2 | IC-24 | fallback 双审计面失败车次不同步（lhe C1） | fixed @1cb8d4b |
| P2 | IC-25 | recordFallback 与 c6 镜像写语义分叉（lhe C2） | fixed @0c3b8a5 |
| P2 | IC-26 | stateDir 校验口径分裂（lhe C3，详五段表） | fixed @0c3b8a5 |
| P2 | IC-27 | lib/events.js 注释行号漂移（lhe C4，文档性引注） | fixed @1cb8d4b |
| P2 | IC-28 | 上游 mission board 面观察（D7，OBS 候选详五段表） | - |
| P2 | IC-29 | 上游用量/成本/上下文压力可观测面（usage-api + payload-estimate + custom-rate-provider + E3 族 6 元素）（lhe N2） | - |
| P2 | IC-30 | .omd/hb.log 孤儿（v0.4.1 vitest 输出重定向一次性测试产物，F4 范式登记）（lhe 疑点①） | - |
| P2 | IC-31 | HUD effort 无承载=设计内缺口（上游 effort.ts 数据源 statusline stdin，omd 读面钉死两拉取无通道；补齐=管道工程）（lhe 疑点④） | - |

### 逐维发现登记（S5，2026-10-15 三批执行；每维显式登记，禁止沉默维）

| 维 | 手段 | 结果 |
|---|---|---|
| D1 执行模式 | diff | 零发现（closure 零孤儿；A 组 8✅ 无新漂移） |
| D2 技能资产 | diff | 零发现（42/48/29 全对 audit 权威） |
| D3 角色卡与路由 | diff | 零发现（33 agents / omc 19 一致） |
| D4 状态/记忆/数据面 | manual | 零发现——memory 复核（spec AC7）通过：upstream-forms 两层门绿（含于 45 文件/529 全量）、形态卡在位、notepad Priority 指针在位（L6）、wiki index 挂载在位 |
| D5 Hook 矩阵 | probe | IC-19 闭环（注入实发已观察）；净零新增 |
| D6 Team 运行时 | probe | 零发现（heartbeat/team 测试面全绿） |
| D7 HUD 与通知 | probe | 零发现（hud/client 测试面全绿） |
| D8 CLI 与分发 | diff | 零发现（bin=graph-runner 专用入口，与 audit #39 一致） |
| D9 跨进程/运行时核 | probe | 零发现（graph e2e 七组真实跨进程全绿） |
| D10 插件运行时与 cordis 集成 | probe | IC-20 维持（hook.js L79/L81 预写行为 grep 实证，root-caused 在案） |
| D11 MCP state 契约与多会话锚定 | probe | IC-12/IC-21 维持 |
| D12 委派路由 c1/c3 | probe | IC-18/IC-20 维持 |
| D13 worktree c5/c6/c8 | probe | IC-11 关联维持（worktree.test 同族 flake 在案） |
| D14 graph DAG 运行时 | probe | IC-01~10 维持开放——git 实证 lib/graph 自 f95952a（U4 末提交）零后续提交，无修复 |
| D15 测试与发布门禁 | manual | IC-10/IC-11 维持；prepublishOnly 门禁在位；全量 45/529 绿 |
| D16 文档/计数一致性 | diff | **净新增 IC-22**（README files/tests 三源漂移无守门）；IC-13 维持 |

### 上游观察（OBS：只记录不修；升格条件=①reference 刷新证实上游已修复 ②用户拍板绕修）

（暂无）

### 定档规则（AC8 终版，2026-10-15 成文；量化判据=可判定问句，逐条是/否，不打分）

**P0**（满足任一即入档）：①阻塞发版门禁（prepublishOnly 红且非测试自身缺陷）②用户数据丢失或跨会话/跨仓状态污染（写错锚、覆盖他会话活数据）③宿主启动级崩溃（plugin tree 加载失败、宿主退出、级联 Invalid effect）。
**P1**（满足任一即入档）：①功能缺陷且无绕行路径 ②对外契约破坏（MCP wire 形状、Config 键语义、journal/文件格式兼容）③共识流程被机制性绕过或阻塞（如残留状态所有权挡新模式启动）④同族缺陷两现以上且污染可信度信号（flake 咬发版门禁）。
**P2**：其余一切——质量债、文档/计数漂移、有界性能损耗、测试盲区（存在替代验证路径）、可绕行的功能缺陷。
**OBS**：上游 OMC/OMX 缺陷，只记录不修，不占 P 级（升格条件见上游观察节）。
**档内排序**：blocked-by 依赖链深度降序；同深度按发现时间正序。
**对照先例**：轮 17 发版前审查制（P0=0/P1=0/P2=14 即本判据的首次隐式应用）；本表 IC-11 入 P1 的依据=判据 P1-④。

#### IC-19

S5 批 2 probe 结论（2026-10-15）：「注入实发未观察」已解——IC-20 的误触发实例（session 3cf255c3 被预写 keyword-detected 状态）证明 keyword-hook 注入链路在真实会话中发效，观察完成，本行闭环（closed）。遗留的误触发缺陷本体在 IC-20 另案。

#### IC-22

README 测试计数根因：徽章行（L3）与正文快速上手行（L169）的 files/tests 数字无任何守门断言覆盖——upstream-forms L1b 只守 description 42/55 与 omd-doctor 双语计数，不守 README 测试计数；本轮执行新增 tests/docs/dimension-chain.test.js（45 文件/529 tests）即造成第三处漂移实证（徽章 519 / 正文 44 files·523 tests / 实际 45·529）。修复=刷两行数字 + dimension-chain 增一条 README 计数断言。

#### IC-01

修复（2026-10-15，轮 20）：lib/graph/runner.js 错误路径收割在飞子进程——inflight 表提升函数级（catch 可见）、executeCommandNode 经 entry.childPid 追踪/结算清除、catch 逐个 killProcessTree。回归钉=「运行中途失权 → taskkill 实证」（fake spawn/execFileImpl 注入，双并发编排：B 结算触发失权写账抛错、A 仍在飞被收割）。

#### IC-02

修复：park 优先于 failed 系 OQ2 设计定案保留，返回体附 failed 摘要（projection.failed）消除 status:failed 派生读与 terminal_status:null 的双读矛盾。回归钉=「bad 终态失败 + gate 未决 → park 且 failed 含 bad」。探针实证：gate 若带入边会被 blocked 而非 waiting（拓扑教训记录在测试注释）。

#### IC-03

修复：stale_grace_ms 写入 owner.json（writeOwnerJson），readOwnerJson 白名单透传，inspect 优先读回持久化值、缺席回落实例默认。观测/接管口径与原 run 保护意图一致。回归钉=「60s 持久化宽限下默认 30s 观测实例不误判 stalled」+ 旧形状回落对照。e2e ①⑤ 首跑改显式短宽限（语义对齐；观测侧短宽限不再生效正是修复语义）。

#### IC-04

修复：schema.js 新增 instructionsSchema（作者面 32768 + 前缀长 + 2），护栏前缀不计入作者上限。回归钉=32768 封印通过 / 32769 拒绝。

#### IC-05

修复：上游 schema 类型（graphNodeResultSchema 等）与 MCP wire 校验形状本就不同（outcome/attempt_id vs node_id/attempt）——定案=wire 校验为权威并补长度帽（node_id ≤128 / output_ref ≤2048 / output_summary ≤8192），graph.mjs 头注声明分工，上游类型留 port 保真测试覆盖。回归钉=长度帽拒绝测试。

#### IC-06

修复：writeOutput 复用 openNoFollow + assertPrivateRegularFile（与 journal 主路径同款纪律）。回归钉=outputs 目标为 symlink → JournalCorruptionError（环境不支持建 symlink 时按 ⑤ 先例跳过断言）。

#### IC-07

修复：fence 写序对调（先 sidecar epoch 后 lock payload）——崩溃窗口侧从「takeover 重发同号」变为无害跳号空洞。既有 epoch 单调钉（release 续号不回退/落败者 FENCED_OUT）保持绿。

#### IC-08

修复：projectAfter 的 JournalCorruptionError 单独透传（调用点包装 projectAfterOrReject → reject(20)），其余降级不变。回归钉=「追加截断半行后 projectAfter 抛 JournalCorruptionError」。

#### IC-09

修复：journal maxSeq 进程内缓存（键=fence epoch，失权/换主自动失效；append 成功推进缓存；无 fence 不缓存）+ watchdog 快照每轮一份（原每 waiting 每轮全读）。回归=全套件含真实跨进程 e2e 绿。

#### IC-10

五盲区全补：①双 takeover 恰一胜出（fence 单测近似竞态）②unlink ENOENT 容忍（unlinkImpl 测试缝，忠实模拟文件先消失再抛）③watchdog retryable:true 重排新 agent_pending ④truncateSuffixViaFreshFd 导出直钉 size 守卫 ⑤graph_status fence 字段补 epoch=null 断言。

#### IC-11

根因（2026-10-15 AC8+去化轮定案）：vitest 非 browser 默认 testTimeout=**5000ms**（node_modules/vitest/dist/chunks/coverage.DfSpMS-b.js:3921 实证），worktree.test.js 每条测试串行 4-8 次 git 子进程（mkdtemp fixture→init→config→commit→worktree add×2→rev-parse/diff/rm），Windows spawn+AV 扫描下单次 git 可达数百 ms——全量并行（graph e2e 七条真实跨进程测试同期占 22s）与 publish 环境（npm prepublish 链）负载下，单测墙钟顶破 5s → 偶发红；隔离负载低 → 恒绿。**同族反证**：graph-e2e 作者已为全部重测试显式加 20-45s 第三参超时，worktree.test.js 被漏。修法（heartbeat 先例同款：去人工天花板、零断言削弱）=9 条重测试显式 20s 第三参（tests/lib/worktree.test.js）。两次历史现形（轮 17 补记 publish 被拦 + S4a 全量并行红）均被此机制解释。验证：套件 16/16 绿 ×2、全量 45/529 绿 ×1（本轮）；**终验已过**：0.4.8 publish 的 prepublishOnly 门禁在 publish 环境全量绿（75a4766 链，exit 0）——conditional-review 触发条件满足，本条终局闭环。

#### IC-23

S6 审查 worktree.test.js 顺带发现（manual）：lib/worktree.js casWriteRunState:72-76 与 lib/runstate.js:118 的 CAS 均以 updatedAt（toISOString 毫秒串）为唯一比对 token——同毫秒内 A 写后 B 读 cur.updatedAt 判 CAS 通过、写回同串 updatedAt，第三写者 C 对 B 的 expectUpdatedAt 校验恒真 → 并发同毫秒双写静默丢更新（version 双方同值 +1 互覆，无告警）。触发面：team run 两阶段拆除与镜像 CAS 写在真实并发下的同毫秒窗口（低概率但非零，且静默）。修法方向（须共识）：token 加单调保证（max(now, cur+1ms) 或 version 参与比对）——涉 CAS 语义行为面，单独立项。

**2026-10-15 闭环**：单调 token helper `monotonicIsoNow(prev)`（lib/worktree.js）三处归一——casWriteRunState 咽喉（runstate 镜像写经它）+ runstate.js 覆盖写路径 + state.mjs 常规写路径（supersede 内联逻辑归并同 helper）。专属断言两条：state.mjs 面（同毫秒双写旧 token 必 conflict）+ worktree 面（casWriteRunState 同毫秒单调递增 + helper 单测面）。37/37 绿。

**2026-10-15 实证更新**：IC-23 在 0.4.8 轮被 ABA 守门测试当场活捉——supersede 重打 _meta.updatedAt 与 leaf 预写落在同一毫秒，「重打」为 no-op、旧 token 照样过 CAS（首次验证即红）。state.mjs supersede 路径已按单调 token 修（now <= prev 时取 prev+1ms，mcp-server/tools/state.mjs），ABA 测试随之绿。**此实证把 IC-23 从「理论低概率」升格为「实测必现」**——lib/worktree.js 与 lib/runstate.js 两处同族修法照搬单调 token 即可，建议随下次涉 CAS 轮次顺带收口。

#### IC-12

根因（2026-10-15 定案）：lib/delegate.js 的事件/fallback 落盘锚是 **process.cwd()**（宿主进程工作目录）——四处调用点（原 L126 死代码 stateRoot + L156/158/191 三处真实写）。GUI 从用户主目录启动时锚即 ~/.omd，轮 15 流浪锚（C:\\Users\\36084\\.omd 被并发会话写 5 条 delegate 事件）由此而来。修复：①omd_delegate 参数面加可选 cwd（工作区绝对路径优先）；②守卫=锚恰为主目录本身才跳过落盘+告警（收窄后形态——初版「主目录之下」误伤 %TEMP% 夹具，被既有 c3 fallback 测试当场抓回）；③死代码 stateRoot() 删除。断言三条：cwd 透传/主目录锚跳过+告警/cwd 缺席回落行为不变。20/20 绿。

#### IC-13

README 徽章漂移根因：提交 27dea74 把测试计数同步进 docs/feature-parity-audit.md 但漏刷 README.md:3 徽章行（实测徽章 519 vs 正文 L169 与 audit 523）。同类先例=轮 7 附记（徽章滞后系轮 14 漏刷，轮 15 补）。修复=刷徽章行 + 将徽章计数纳入恒跑断言面。

#### IC-20（ephemeral 证据内联）

c2 keyword-hook 误触发实证（2026-10-14 本访谈会话）：主会话经 omd_delegate 派发 analyst 评分，prompt 正文含「复用 ralplan 评审面」字样（引文语境）→ keyword-hook 确定性扫描在子代理会话（3cf255c3-f403-4a7e-a8b5-8cedf9d9fcae）预写 ralplan 状态（实测载荷：current_phase=keyword-detected、keyword_route={target:ralplan, trigger:ralplan, intent:explicit, source:keyword-hook}）。leaf 会话按守卫正确拒绝激活（其回报「触发词仅出现在派发 prompt 引文内，leaf 会话关键词路由失效」），但残留状态致主会话 state_write({mode:ralplan}) 抛错「state is owned by session '3cf255c3…' and cannot be modified by session 'session-84201beb…'」。绕行修复已实证=state_clear 以该 sessionId 名义。根因：hook 侧确定性检测（零 LLM）无法区分 delegate prompt 正文中的引文提及；预写发生在模型守卫之前。注：state_clear 后该 session 目录为空壳，本段即当时输出的持久化（原锚点 ephemeral）。

#### IC-21（ephemeral 证据内联）

残留模式状态实证（2026-10-14 本访谈会话）：主会话激活 ralplan 时 state_write 抛错「state is owned by session 'session-3249cea4-3f42-4c30-9f58-5c67340230cf'」——该文件实测载荷：{active:false, handed_off_to:"ralph", plan:".omd/plans/ralplan-memory-omc-omx-forms.md", at:"2026-10-14T12:04:56.658Z"}，即 memory 先例已交接 ralph 的终态会话。同类先例：.omd/state/sessions/session-b09747c5-50fb-470a-ac8f-a1f1f3209ef5/ralplan-state.archived-20260924.json（归档命名绕开）。根因：模式状态无 TTL/回收机制，inactive+已交接状态仍持所有权。绕行修复已实证=state_clear。本段即当时输出的持久化（原锚点 ephemeral）。

#### IC-24

lhe S2 走读 C1（2026-10-29，root-caused）：events 的 route/fallback 落盘在 resolveDispatch 后立即执行（lib/delegate.js:154-166），run-state 的 recordFallback 排在 model 校验（:167-190，可抛）与 provider 注册检查（:191-192，可抛）之后（:193-201）。校验抛错车次：events.jsonl 有 route+fallback 两行、run-state.json 无 fallback 痕迹——events.js:37 注释自认「事件=路由判定，含后续失败车次」，run-state 侧无对等语义声明，两审计面对同一判定可给出分歧观测。证据锚=lhe-engine-r1.md §3 C1。定级 P2（审计观测分歧，非功能缺陷无绕行）。处置建议：落盘次序重构须共识单独立项。

#### IC-25

lhe S2 走读 C2（2026-10-29，root-caused）：recordFallback 直写 fallback/lastFallback/updatedAt 三键、version 原样保留不 +1、不经 expectUpdatedAt（lib/routing.js:109-113）；同文件 writeRunStateMirror 契约=version 每写 +1（写入方强制）+ CAS（lib/runstate.js:11/:76/:80）。后果=fallback 写后队长下一次镜像 CAS 必多一次冲突重试（重试机制兜底，非数据损坏）；同一权威文件两套写语义并存。证据锚=lhe-engine-r1.md §3 C2。与 IC-23 同族（同文件写语义），建议随下次涉 CAS 轮次顺带收口。

#### IC-26

lhe S2 走读 C3（2026-10-29，root-caused）：hook 预写与 MCP state 面经 omdPaths，stateDir 禁绝对路径与 .. 段（paths.mjs:7-11/:22；调用点 lib/hook.js:124/:129 与 state.mjs:13/:23）；routing/events 面显式支持绝对 stateDir（lib/routing.js:106-107、lib/events.js:26-29）。Config.stateDir 配绝对路径组合下：关键词预写 catch 直通失效（lib/hook.js:231-234）、state 工具报错，路由事件/审计照常落盘——同仓两套路径校验口径。证据锚=lhe-engine-r1.md §3 C3。主锚归 D11（.omd 锚定语义一致性）；涉 D12 面（events/routing 直拼侧）。

#### IC-27

lhe S2 走读 C4（2026-10-29，root-caused，文档性）：lib/events.js:36 注释引「decision.modelId，lib/delegate.js:38/:55」——现码 modelId 决策字段实际在 lib/delegate.js:58/:67（:38 为 JSDoc 起始、:55 为 provider 校验 throw）；同文件 :6 引 runstate.js:64-69 经核仍准确（withFileLock 实码 lib/runstate.js:65-70）。F7 双态口径：注释行号仅线索，现状以实码为准。证据锚=lhe-engine-r1.md §3 C4。文档性一行修正；本审查不改源码（Non-goals），故执行 pending 至下次触碰时刷新。

#### IC-28

lhe S3 delta N1（2026-10-29）：上游 mission board 面（src/hud/mission-board.ts 636 行 + elements/mission-board.ts re-export + 顶层 missions/ 子系统）为任务板/时间线/多 mission-worker 状态呈面，omd 无对应承载——omd PRD 面是 ralph story 台账语义，非任务板时间线形态。对照列查重空集：形态卡 §顶层子系统地图（仅列名 missions/，未评估）＋ parity §上游新增能力评估 11 项全集（无 mission）＋ upgrade-tracking §2026-02-06 漂移扫描（无此项）。证据锚=lhe-delta-r1.md §3 N1（证据=mission-board.ts:1-12 状态机 import 面）。评估立项归各自 ralplan。

#### IC-29

lhe S3 delta N2（2026-10-29）：上游用量/成本/上下文压力可观测面（usage-api.ts + payload-estimate.ts + custom-rate-provider.ts + elements E3 族 6 元素 limits/call-counts/token-usage/enterprise-cost/context/context-warning），omd HUD 五要素（hud.js:25）与 hud.json 富面均无此维度；dsh 亦无 statusline stdin 缝。对照列查重空集：parity G #36/#37/#38（均非用量面）＋ 11 项评估全集（无用量/成本项）＋ 形态卡 §omd 映射表（HUD 行仅 effort/statusline）。证据锚=lhe-delta-r1.md §3 N2。评估立项归各自 ralplan。

#### IC-30

lhe S1/S4 疑点①终局（2026-10-29，root-caused）：.omd/hb.log=confirmed 孤儿——全仓 grep `hb\.log` 零命中（lib/、mcp-server/、tests/、docs/、README.md 均无写入方与读者；可复现命令=lhe-evidence-r1.md §2①）；内容实证=v0.4.1 时代 `npm notice`+vitest run tests/lib/heartbeat.test.js 的完整 vitest 输出（shell `>` 重定向一次性测试产物；vitest.config.js 无任何 hb.log 配置，现行测试产物卫生）；README 户口树记 events.jsonl/trace/ 无 hb.log 行。处置=F4 范式登记（孤儿=无守门无读者；**删除须用户显式确认，任何自动化流程不得动它**）；外部口径（12factor 日志治理外置 + logrotate removal 属系统工具职责）同向背书（lhe-external-r1.md §2①）。本行执行=登记处置完成；按终态定义构成 closed——「closed」指登记闭环，非 hb.log 文件删除完成。

#### IC-31

lhe S1/S3/S4 疑点④终局（2026-10-29，root-caused）：effort 登记属实——上游 elements/effort.ts:14-30 实存（renderEffort 五档；数据源=statusline stdin effort.level，U3 字面「receives JSON session data on stdin」），omd HUD 全链（hud.js/hud-route.js/client.js/hud.mjs）grep effort 零命中；定性=设计内缺口：omd HUD 读面被设计约束钉死 state_get_status+notepad_stats 两拉取（hud.js:10-11/:192-200），无 statusline stdin 推送通道，补齐=数据管道工程（宿主注入或档位表镜像）非加 element。评估记录已落三处（lhe-evidence-r1.md §2④ / lhe-delta-r1.md §4 / lhe-external-r1.md §2④）。登记位回写（parity G#36/#10「❌未做待核」→「❌未做·设计内缺口」）按计划 Follow-ups 归编排方，非本行执行范围。

## 持续跟进机制

1. 参考快照刷新后跑漂移扫描：skills/hooks/agents 计数 + 集合差（命令见本轮 pwsh 脚本模式）
2. audit 口径不变：版本号新提交也纳入（不只看版本号）
3. 每 🚫 决定记录的复评触发条件照旧生效（R-1~R-8）
4. 变更一律走 ralplan/team 流程，禁止无共识直接移植
## 轮 2 附记（测试基建）

- heartbeat.test.js「扫描抛错静默降级」计时 flake 去化：定长 sleep(50) 改为 2s 上限轮询等待（断言强度不变：仍要求 ≥2 次重试 + warns 静默）。根因=全量并发下 interval tick 饥饿，与 U2 改动无关（隔离跑恒绿）。比例裁量：测试基建修复，非功能移植。修复后全量 34 文件 288/288 绿（两次验证）。
## 轮 4 附记（U6 依赖核实 + U4 立项准备）

- **U6 依赖核实（证据）**：`active_agents` 在 mode state 中仅当领队模型显式 state_write 时才存在（lib/team.js 零写入点，grep 实证）；权威每队员数据在 `.omd/team/<runId>/registry.json`——元素含 workerId/role/tier/phase/status/stale/spawnedAt/lastHeartbeatAt/note，恰为 agent 树所需（角色/时长=lastHeartbeatAt-spawnedAt/状态/描述）。**设计约束冲突**：HUD 读 registry = 第三数据源，违反 ralplan-hud-clarity P2（零新数据源，该 P2 是共识原则）。⇒ U6 不是呈现层快改，须独立 ralplan 立项论证：方案候选 a) getStatus 聚合 team registry（扩 state 读面，P2 修订需用户/共识批准）b) 新 MCP 工具 team_roster（warker 聚合只读面）c) 放弃 registry，维持 active_agents 手写契约并把「队员计数=0」的语义在文档讲清。立项时三选一过 Architect/Critic。
- **U4 立项锚点**：契约入口=assets/skills/graph/SKILL.md（journal 格式已冻结为恢复输入契约，audit #45）；执行语义=模型驱动今天照 journal 写，二期=确定性运行时。立项 ralplan 输入：journal 格式约定（graph skill 内）、DAG 校验面（环/孤立节点）、恢复语义（崩溃后从 journal 重放）、与 team 模式的宿主关系。建议 fresh session 启动（本会话上下文已耗尽）。
- **U5 维持等用户确认**：激活动作（npm pack → dsh plugin add → 宿主重启）会中断本会话宿主，不能由 goal 轮自治执行。
## 轮 5 附记（U6 过渡澄清）

- hud SKILL 双语新增「agents 计数语义」注：计数=领队显式写入的 active_agents（team 运行时不自动写，0 属正常）；队员明细权威面=team_registry MCP + registry.json；U6 数据面方案留其立项 ralplan。不预empt共识，纯文档澄清（可理解性延续）。skills.test+hud.test 17/17 绿。
## 轮 7 附记（文档失实修复，D-2 同类）

- README 徽章 270→289 passed、快速上手 30 files/251 tests→34 files/289 tests（本轮 U2/U3 + 去化后实测）。audit 文档内 251/270 为带日期历史存档，保留不动。
## 轮 8 附记（落盘 + 新鲜复验）

- U2/U3/轮4-7 全部在制改动以 4 个原子提交落 master：4bd3d90（U2 review）→ cbb143b（U3 HUD 链路+呈现）→ aa201e6（heartbeat flake 去化）→ c57efef（README 徽章）。提交前新鲜全量复验 34 files/289/289 绿（非引用旧日志）。
- 宿主工具注记：本会话 dsh git_* 系列工具故障（shell.run is not a function），git 操作全程走 pwsh；如后续会话复现，按此绕行。
- 剩余积压不变：U4（简报就绪，fresh session ralplan 启动）、U5（待用户确认）、U6（阶段 3，独立 ralplan 立项）。
## 轮 9 附记（2026-10-12 发版 + 快照刷新，deep-interview→ralplan 共识链执行）

- **U5 收口**：0.4.2 已发布 npm（prepublishOnly=npm test 门禁生效；publish exit 0 + registry 确认行为主证据；npm view CDN 传播延迟为辅证挂起）→ web profile 插件升级 0.4.2（profile node_modules package.json version 断言实证）→ master 推送完成（de381c3..45014ad，含 bump 提交 45014ad；SSH 主链直连成功）。**仅剩用户手动作业：重启宿主 → /omd-doctor 验装 → HUD 冒烟。回退段：dsh plugin --profile web add @sakura12/oh-my-deepseekharness@0.4.1（重装 0.4.1）；若升级后宿主级崩溃且回退恢复 → npm deprecate 0.4.2；个别缺陷不 deprecate 走下一版本修复。**
- **快照刷新**：reference/oh-my-claudecode ff-only → v5.7.0（8262f9f，5435 提交补齐）；reference/oh-my-codex ff-only → 0.21.9（02ef37e，3978 提交）。两仓均 grafted 浅克隆，fetch+ff-only 干净通过。
- **audit 基线过期声明**：docs/feature-parity-audit.md 45 点基线对照 OMC 5.4.0/OMX 0.21.5 起整体过期；重基线=U7。
- **网络通道实证**：github 直连 443 超时；Clash 混合端口 127.0.0.1:7897 全链可用（git fetch、npm publish）；SSH 22 由 Clash 接管实证（git push SSH 主链成功）。
- **token 注记**：~/.npmrc 旧 token 对包无发布权限（E404），已替换为会话提供的新 token 后 publish 成功；**建议用户轮换该 token**（曾出现对话明文）。
- **档案**：spec=.omd/specs/deep-interview-omd-upgrade-hud-observability.md（8 轮，21% borderline PASSED）；共识计划=.omd/plans/ralplan-omd-upgrade-hud-observability.md（v2.1，Critic APPROVE R2）；评审=.omd/state/ralplan-reviews/（architect/critic r1-r2 共 4 份）。
## 轮 10 附记（2026-10-12 dsh 0.2.0-rc.2 宿主升级兼容侦察）

- **宿主升级实证**：dsh 0.1.x → 0.2.0-rc.2；omd 0.4.2 在新宿主运行层全绿——插件注册 ✓、HUD 中文卡渲染 ✓（hud.json 实测）、MCP 挂载 ✓（state_* 冒烟）、npm test 289/289 ✓。U5 至此全收口（用户已完成重启验机）。
- **唯一不兼容=声明层**：8 个 @deepseek-ai/dsh-* 全部 0.2.0-rc.2，落在 omd peer range（上限 <0.2.0）之外；安装期 pnpm peer warning。修复=U9（range 加性拓宽含 0.2.0-rc 线）。
- **R-2 复评触发条件点燃**：audit R-2「dsh 宿主仅 agent/pre-step 拦截点」的复评条件=宿主事件面更新——0.2.0 大版本升级即触发；U9 工作清单第 3 项承接。
- **复核项**：升级前会话 omd_delegate 派发 glm-5.3-flash ×3 异常终止（stopReason=error）——0.2.0 上是否已修/行为变化，列入 U9 集成面复核清单。
- **0.4.2 registry 辅证闭环**：npm view versions 已含 0.4.2（CDN 延迟消退），AC-3 双证据齐。
- **档案**：U9 立项简报=.omd/plans/dsh-02-compat-brief.md。

## 轮 11 附记（2026-10-12 U9 执行完成，ralplan deliberate 共识链）

- **共识链**：Planner R1 → Architect R1（SOUND-WITH-CHANGES，S-1～S-4）→ Critic R1（ITERATE，1 MAJOR+5 MINOR）→ Planner R2 → Architect R2（SOUND-WITH-CHANGES，F1～F3 一行级）→ **Critic R2 APPROVE（0 MAJOR/0 MINOR）**。档案：.omd/state/ralplan-reviews/u9-{planner,architect,critic}-r{1,2}.md；计划：.omd/plans/ralplan-u9-dsh-02-compat.md。
- **发版 0.4.3**：提交 2b4bb23（Step1 peer 拓宽+单测+doctor 锚点）→ d2008ce（Step2-4 doctor 2g-C+R-2 复评+README）→ 56afe7a（bump+发布说明）；tag v0.4.3；push SSH 主链远端 hash 核对一致；npm publish exit 0（prepublishOnly 门禁过）；本地 tarball SHA1 与发布 shasum 逐字节一致（9fe80e43…）；web profile 升级 0.4.3（profile node_modules 版本断言 ✓）；**pnpm peers check 中 omd 出现 0 次**（剩余 warning 全是 profile 其他插件固有噪音）。npm view 元数据 CDN 延迟照旧挂起辅证（tarball URL 已 HTTP 200）。
- **AC-1 双面试证**：npm 12.0.1 对照组（0.4.2 旧 range）ERESOLVE 硬失败 / 实验组 exit=0 零告警；pnpm 12.4.1（plugin-manager 真实面）exit=0 零 unmet peer。
- **S-2 双线图**：0.2.0-rc.2 线 vitest 35/301 绿（需 --legacy-peer-deps + 补 dsh-sandbox@0.2.0-rc.2——0.2.0 线 dsh-tools 新增传递 peer）；committed 线恢复后 301/301 复绿。
- **2g 根因定案**：宿主 child-route allowlist 拒绝 glm-5.3-flash（sakura provider 仅 k3/MiniMax-M3），omd_delegate ×2 stopReason=error 复现；绕过=subagent 继承/显式 sakura/k3（均实证走通）；默认值行为变更移 U10（0.5.0 候选）。
- **R-2 复评维持**（docs/feature-parity-audit.md L118）：0.1.7-rc.1 vs 0.2.0-rc.2 拦截面逐包对比零新增；R-3/R-4/R-7 不点燃。
- **2e 观察项**：keyword hook 注册面实证 ✓（宿主 waterfall agent/pre-step 在 0.2.0 仍派发）；MAGIC KEYWORD 注入实发未观察（本会话用户措辞正确不命中锚定形态=守卫按设计直通），留待自然触发复核。
- **剩余手动作业（交接用户）**：重启宿主 → /omd-doctor 验装（AC-7）→ HUD 冒烟。回退段：dsh plugin --profile web add @sakura12/oh-my-deepseekharness@0.4.2；宿主级崩溃且回退恢复 → npm deprecate 0.4.3。

## 轮 12 附记（2026-10-13 U8 执行完成，ralplan short 共识链 + ralph goal 降级驱动）

- **共识链档案**：.omd/state/ralplan-reviews/u8-{planner,architect,critic}-r{1,2,3}.md 共 9 份——Critic R3 APPROVE / Architect R3 SOUND，计划=.omd/plans/ralplan-u8-hud-tool-observability.md v2.1（需求权威=deep-interview spec c5 节，P2 修订边界=仅 hud.json 私有面、MCP wire 零变化）。
- **执行方式**：ralph goal 降级驱动（ralph 原生工具不可用，走 create_goal 续跑 + PRD 逐 story 证据契约），分 4 轮 executor 逐 story 落地。
- **原子提交**：6553513（S1：lib/events.js 事件总线 + delegate.js opts 注入缝挂钩 + 测试）→ 9b66ef4（S3：client.js full preset 两区 + bundle 测试）→ 9805af4（S2：hud-route.js workers/toolCalls 聚合 + 白名单 + 测试）→ 本提交④（文档同步：hud SKILL 双语 P2 修订记录 + 新数据面说明、README、本附记）。
- **测试计数**：35 files/301 → 36 files/316 全绿（+1 文件=tests/lib/events.test.js；S1 末实测 308，S2/S3 向既有测试文件追加 AC-6/7/10 与 ⑮-⑱ 断言后文档轮新鲜实测 316，两次复跑一致）；F-6 卫生闸=npm test 复跑前后仓库 .omd/state/events.jsonl ABSENT→ABSENT。
- **流程异常记录**：S3 出现双 executor 实例重复派发——后台 subagent 不进 job_list/teammate 清单导致主会话误判失踪而重派，两实例产出一致无冲突（一方补测试提交 9b66ef4，另一方独立复验全绿并留旁证）。**教训：后台派发后以文件证据为准，不以 job_list 为准。**
- **OQ 残留（留用户拍板）**：① events.jsonl 尾部窗口 64 KiB / workers 上限 50 的默认值口味（可调参数，改值不改架构）；② 是否当轮 bump 0.4.4 发版（升级面板可见性须经发版+宿主重启，U5/U9 同款链路）。
- **P2 边界终审**：MCP wire 面（hud_render/hud_summary/state_get_status 形状）与 mcp-server/tools/hud.mjs、lib/hud.js 全程零 diff（AC-9 git 级证据见 S2 PRD evidence）；workers/toolCalls 仅落 /oh-my-dsh/hud.json loopback 私有面。

## 轮 13 附记（2026-10-13 U8 发版 0.4.4 + 默认值拍板）

- **OQ 拍板**：窗口/上限默认值维持 64 KiB / 50 名（用户选定，零改动进版）；bump 0.4.4 批准。
- **发版链**：npm test 门禁 36/316 绿 → bump 提交 8105762（发布说明随提交体）→ push SSH 主链 56afe7a..8105762（5 提交：U8 四个 + bump）→ npm publish exit 0（prepublishOnly 门禁过；shasum 446cfbd3…；npm view 第 3 次重试（~90s）传播到位 0.4.4）→ web profile 升级 0.4.4（profile node_modules 版本断言 ✓；pnpm peers check 中 omd 零出现待本条复核——见下行实证）。
- **pnpm peers check**：omd 出现 0 次（Select-String 零命中实证，与轮 11 同口径）。
- **剩余手动作业（交接用户）**：重启宿主 → /omd-doctor 验装 → HUD 冒烟（full preset 应见「队员」「工具调用」两区；做一次 omd_delegate 派发后「工具调用」区有计数）。回退段：dsh plugin --profile web add @sakura12/oh-my-deepseekharness@0.4.3；宿主级崩溃且回退恢复 → npm deprecate 0.4.4。
- **剩余积压（轮 14 更新）**：U4 → U7（可吸收 U10）。

## 轮 14 附记（2026-10-13 U6 执行完成，ralplan short 共识链 + ralph goal 降级驱动）

- **共识链档案**：.omd/state/ralplan-reviews/u6-{planner,architect,critic}-r1.md 三份——Critic R1 APPROVE（0 CRITICAL/0 MAJOR，4 MINOR 执行期吸收）、Architect R1 SOUND-WITH-CHANGES（零 MAJOR，3 MINOR）；计划=.omd/plans/ralplan-u6-agent-tree.md。
- **拍板记录**：自适应组头（≥2 distinct runId 才渲染组头行、单 run 保持 U8 平铺原状）= Architect R1 Synthesis 综合路径，用户指示「继续」采纳推荐项。
- **评审吸收项（一句表）**：F-1（8 行预算措辞修正：恰 8 行由 hud.test.js:95 锁定，:55/:98 为上限断言——文档级，本附记如实记录）／F-2（⑮ 零改写变体=自适应组头，拍板采纳，⑮-⑱ 零改写仍绿实证）／F-3=M1（组头计数口径=组内已渲染队员行数，截断腰斩 run 由截断提示行兜底联读消歧）／M2（AC-7 消失断言改锚实际旧措辞 SKILL.zh.md:54「workerId/role/status/心跳时长」平铺描述，本轮 S2 文档按新形态重写该句）／M3（OQ 已决项 runId 短式不再列为开放问题）／M4（版本交叉免疫句补入 SKILL 双语：旧 client 忽略新键、新 client+旧 server 缺键跳过不炸、runId 缺席兜底「-」）。
- **原子提交**：6da9511（S1：lib/client.js 队员区自适应 run 分组两级树 + row() indent 可选参 + client-bundle 测试 ⑲）→ 本提交②（S2 文档同步：hud SKILL 双语队员区说明 + 版本交叉免疫句；本附记因 .omd/ gitignored 不入提交）。
- **测试计数实测**：36 files/317 tests 全绿（S1 后基线 316 + 新增 ⑲ 断言 1，本轮 S2 文档轮新鲜复跑实测 317 一致）；F-6 纪律延续（npm test 复跑前后仓库 .omd/state/events.jsonl 零新增）。
- **P2/契约零破坏实证（S1 AC-3）**：lib/hud.js、mcp-server/tools/hud.mjs、lib/hud-route.js、lib/events.js 四文件 git 零 diff；改动面仅 client 呈现层 + 文档。


## 轮 15 附记（2026-10-13 U6+U4 完成）

- **U6 收口（轮 14 见上）** + **U4 收口（本轮）**：graph DAG 确定性运行时一期 MVP 落地。
- **U4 共识链**：deliberate 全程——Planner r1→r3（v2.1 final）、Architect r1→r2（2 MAJOR：journal append 绑 fence / gate 授权面；F-9~F-13 微修）、Critic r1→r2（ITERATE 3 MAJOR→APPROVE）。档案 .omd/state/ralplan-reviews/u4-*（9 份）。关键裁决：**扁平 journal 格式一期坚守，决定 driver=模型可手写性**（包络 fingerprint 模型无法手写，SKILL「今天模型写的 journal 就是明天的恢复输入」承诺不破产）；包络升级触发条件=runtime 成为唯一写入方（ADR §8）。
- **U4 交付**（6 提交）：3de69b7（descriptor 层，上游 D1-D25 全 25 组向量对照零漂移）→ bad078b（journal 层；**复审抓出 win32 O_APPEND 句柄 ftruncate EPERM 死代码**→第二 fd+size 守卫回退）→ b9b6fd0（scheduler 投影）→ 93600f4（owner fence+runner 核心；Windows 四项实证：kill(pid,0) 语义/taskkill 树杀/close 事件 exitCode=1/pwsh 启动余量）→ c397397（e2e 七组全真实跨进程：kill 恢复 seq 续号零重跑/篡改 21/截断 20/双写者 fence-19/stale 接管/timeout 整树收割/并发峰值≤2）→ f95952a（MCP 六工具面 49→55 + bin 入口 + 词汇表登记 agent_pending/fence_acquired + Q7 护栏双入口同 hash）。
- **S6 收口**：43 文件/519 tests 全量绿（36/317 → +7 文件/+202 测试）；F-6 纪律 hash 不变；multirepo C3 **测试卫生封闭化**——resolveRunStateDir 加性 ceiling 选项（用户级 ~/.omd 合法祖先锚不泄漏进夹具判定）。
- **⚠️ 环境事件**：C:\Users\36084\.omd 流浪锚两度出现——**肇事者是另一并发 dsh 会话（D:\xiaoguai\p0-prototype）**，其 omd_delegate 派发事件（planner/analyst/explore 共 5 条）错锚写到用户主目录。首次误判为本会话所留已合并回正仓；二次确认外来后**不再删除**（他会话活数据），改为测试封闭化根治。omd 潜在缺陷观察项：子代理/MCP 状态写面可能锚到 home。
- **README 计数**：316→519（徽章行滞后系 U6 轮 14 漏刷，本轮补）。
- **推进顺序**：~~U4~~ ✅ ~~U6~~ ✅ → U7（重基线大工程，吸收 U10 复评）。

## 轮 16 附记（2026-10-13 U7 完成——45 点全量重基线）

- **U7 收口**：docs/feature-parity-audit.md 重基线（对照 OMC v5.7.0 8262f9f / OMX 0.21.9 02ef37e，tag 双锚实证）。**45 点终态：35✅ / 0⚠️ / 0❌ / 10🚫**（唯一迁移 #45 graph ⚠️→✅，U4 轮 15 落地）；R-1～R-8 全部维持零点燃。
- **S1 勘误（三处失实纠正）**：OMC skills 48（轮 9 记 39=v5.4.0 旧数，口径错位）；hooks 30 条注册（轮 9「40」五口径无出处，作废）；omd assets/skills 42（audit 记 44，47b5050 删 2 未同步）。commands 21 首次补录。
- **上游新增能力评估 11 项**（评估全集 56=45+11）：4⚠️（architecture-survey/intent/refit/tdd）+ 7❌（diagram/minimal-prose-discipline/map/pr/session-flow/HUD effort/GLOSSARY）；0✅ 不凑数。refit 与 remember/self-improve、tdd 形态差异的归并分析已落 audit。
- **收口**：npm test 43/519 全绿；原子提交 c94b587（audit 恰 1 文件，历史存档逐字节保留；S3 纯验证无独立提交——.omd/ gitignored 无可提交面）；upgrade-tracking U7 行 ✅（本行即实物）。
- **U10 残留**：stable 二次复评待 dsh 0.2.0 stable 发布后随其落地（#16/#17 证据行届时更新）；tiers 默认值变更维持 0.5.0 候选。
- **推进顺序终态**：~~U9~~ ~~U8~~ ~~U4~~ ~~U6~~ ~~U7~~ 全部 ✅。**积压清零**——剩余仅 U10（0.5.0 候选，须 dsh 0.2.0 stable 触发）与各 ⚠️/❌ 新能力项（audit 重基线段已列，按需单独立项）。

## 轮 17 附记（2026-10-13 U10 第一半 + 发版前审查 + 0.4.5 发版）

- **U10 第一半落地**：tiers 三档默认值 glm-5.3-flash → inherit（用户拍板提前，照 U9 Follow-up ① 备忘实施）；提交 ec96619（! 标行为变更）；protocol.test.js 豁免语义=改 fixture 输入、断言逐字不动；全仓 glm-5.3-flash 残留 31 处逐一判定（迁移文档/显式 fixture/运行时示例，零处锚定生产默认）。**stable 二次复评仍待 dsh 0.2.0 stable 触发**。
- **发版前全量审查**（8105762..HEAD，12 提交，code-reviewer 独立）：**P0=0 / P1=0 / P2=14**，APPROVE COMMENT 级。档案=.omd/state/ralplan-reviews/u4-u6-u7-prerelease-review.md。正面观察：三段式 assertOwnership+失权截断=教科书级 OCC；fail-closed 全线一致；e2e 七组真实跨进程扎实。
- **顺手收 4 项**（55d0fda）：P2-8（graph_validate 补 status）/P2-9（graph_run 信任声明）/P2-12（stale_grace_ms min(1)）+ audit U10 句刷新 + graph SKILL 双语补 output? 与 sealed 例外句。
- **0.4.5 发版链**：门禁 43/519 → bump 8c65722（发布说明随提交体）→ push SSH 主链 8105762..8c65722（18 提交）→ npm publish exit 0（prepublishOnly 过）→ CDN 传播 ~2.5min（8 次重试）→ web profile 升级 0.4.5（版本断言 ✓）→ pnpm peers check omd 零出现。
- **P2 follow-up 台账（10 项，audit 后续轮次消化）**：①runner 错误路径不杀在飞子进程 ②parked 优先于 failed 的终态歧义 ③staleGraceMs 不持久化 ④护栏前缀计入 32768 上限 ⑤schema parse 死导出 vs graph.mjs 手写校验双轨 ⑥outputs/ 直写无 symlink 防护 ⑦fence epoch 续号崩溃窗口（写序对调即闭合）⑧projectAfter 裸 catch 降级 20 ⑨append/watchdog O(n²) ⑩测试盲区五处。
- **新能力立项记录（用户拍板四项，均待各自 ralplan）**：tdd 独立 skill（形态缺口最小，优先）；refit 回顾工作流（须先析与 remember/self-improve 分工）；architecture-survey + intent（移植形态评估）。
- **用户手动作业**：重启宿主 → /omd-doctor 验装 → HUD 冒烟（full preset 队员两级树 + graph_* 六工具）。回退段：dsh plugin --profile web add @sakura12/oh-my-deepseekharness@0.4.4；宿主级崩溃且回退恢复 → npm deprecate 0.4.5。
- **推进顺序终态**：积压 U1-U10 全部关闭或收口。持续跟进=快照刷新后漂移扫描（下轮基线已刷 v5.7.0/0.21.9）+ R-1~R-8 复评条件照旧。

## 轮 17 补记（0.4.6 marketplace metadata 发版）

- 用户问「插件市场简介更新了吗」→ 核实：README 市场页已随 0.4.5 生效，但 **description 仍是老句、keywords 字段缺失**（市场搜索面为零）。→ 0.4.6 patch：description 刷新（44 skills/55 MCP tools/graph DAG runtime/team pipeline & HUD）+ keywords 12 项（deepseek-harness/dsh-plugin/multi-agent/orchestration/claude-code/oh-my-claudecode/graph-dag/mcp/hud/autopilot/ralph）。提交 871d781，push+publish exit 0；registry 侧 description/keywords 实测生效。
- ⚠️ **flake 二次现形**：首次 publish 被 prepublishOnly 拦下（npm test 在 publish 环境红，隔离复跑全绿）——与 S4a 报告的 worktree.test.js 全量并行偶发红同族，累计两现。建议后续单独立项：定位抖动用例并去化（heartbeat 同款疗法）。
- profile 是否升 0.4.6：元数据变更对插件运行零影响（代码与 0.4.5 逐字节同），**不必升级**；下个功能版一起走。

## 轮 18 附记（2026-10-15 全维度问题链机制落地，deep-interview→共识计划→执行）

- **共识链**：spec=.omd/specs/deep-interview-full-dimension-issue-chain.md（7 轮访谈，模糊度 53%→18% PASSED；含勘误节 E-1——约束 5「git 分发」在访谈时点失实，C-1 方案 A 落地后成立）；计划=.omd/plans/ralplan-full-dimension-issue-chain.md（R2 修订版；Architect R1 SOUND-WITH-CHANGES→R2 SOUND + Critic R1 ITERATE→R2 APPROVE，15 条评审意见 100% 吸收；档案 .omd/state/ralplan-reviews/fd-{architect,critic}-r{1,2}.md）；用户拍板 C-1=方案 A 外科式 .gitignore 再包含。
- **交付**（提交 8ffb212，5 文件 +1096 行）：docs/dimension-framework.md（16 维八字段权威+45 点映射+114 键映射表）；scripts/audit-dimension-closure.mjs（闭包取数：根域自闭合白名单 15 项+reference 漂移哨兵+零孤儿）；tests/docs/dimension-chain.test.js（两层门 L1a-L1e 恒跑+L2 缺席 skip）；本文件 IC 节（22 条问题链+排序表+逐维发现登记 16/16）首次入 git。
- **S5 发现**：三批子代理因宿主子代理路由异常（glm-5.3-flash stopReason=error，轮 11 同族）全部失败，改主会话直采。净新增 IC-22（README files/tests 计数无守门，三源漂移 519/523/529）；IC-19 闭环（IC-20 误触发实例反证注入链路真实，本账首条 closed 终态）；D1-D4/D6-D9 零发现；D14 的 IC-01~10 经 git 实证维持开放（lib/graph 自 f95952a 零后续提交）。
- **验证**：守门 6/6 绿+负例四连红（非法枚举/伪 closed/排序漏 ID/wontfix 缺 approved）；全量 45 文件/529 tests 绿；fresh-clone 真模拟（临时 clone→npm install→两守门）8 passed+2 skipped+WARNING 可见——台账随 git 分发实证；独立 verifier VERIFIED（抽样五段/负例复演/断言强度/全量回归五项全过）。
- **剩余积压**：P1 档 IC-11（flake 去化）/IC-12（home 锚定）/IC-20（keyword 误触发）/IC-21（残留状态回收）待各自共识立项；P2 档按排序表台账消化；执行期顺手修订 m1/m2/NTH-R2-1 已按修正口径执行（porcelain -uall/check-ignore 负向行断言），计划文本不回改。

## 轮 19 附记（2026-10-15 0.4.8 发版——IC-11 去化 + IC-20/21 生命周期修复）

- **IC-11 去化**（68f2818）：根因=vitest 非 browser 默认 testTimeout 5000ms × worktree.test.js git 子进程链在并行/publish 负载下顶破；修=9 条重测试显式 20s（graph-e2e 同款先例）；负例四连验证。
- **IC-20/IC-21 修复**（75a4766）：共识链=ralplan-mode-state-lifecycle.md（Architect R1 SOUND-WITH-CHANGES + Critic R1 ITERATE 全吸收，15 条对照表）；state.mjs write 所有权谓词收窄——仅存活态（active===true 且非 provisional 合取签名）绑定所有权；inactive/keyword-hook 未确认预写被取代（supersede：active:false + supersededBy/At + 重打 _meta.updatedAt 单调 token）。hook.js 补 provisional 语义注释。测试 +6 → 15/15。
- **IC-23 实证升格**：ABA 守门测试当场活捉同毫秒 token 碰撞（supersede 重打为 no-op）——「理论低概率」→「实测必现」；state.mjs 侧单调 token 已修；lib/worktree.js 与 lib/runstate.js 同族修法照搬即可（随下次涉 CAS 轮次收口）。
- **0.4.8 发版链**：门禁 45/529（68f2818 时点）→ bump+修复提交 75a4766 → npm publish exit 0（shasum ffad75a8；**prepublishOnly 全量绿=IC-11 conditional-review 终验通过**）→ web profile 升 0.4.8（第 3 次重试，CDN 传播后到位；profile node_modules 版本断言 ✓）。
- **测试面**：45 文件/535 tests 全绿（529+6 条所有权生命周期测试）。
- **用户手动作业**：重启宿主 → /omd-doctor 验装 → 冒烟（复现一次 keyword 误触发场景验证不再阻塞：leaf 残留 provisional 后主会话可直接激活同 mode）。回退段：dsh plugin --profile web add @sakura12/oh-my-deepseekharness@0.4.7；宿主级崩溃且回退恢复 → npm deprecate 0.4.8。
- **剩余积压**：P1 档仅剩 IC-12（home 锚定，涉宿主边界待析）；P2 档 IC-01~10/13/14~19/22/23 按排序表台账消化（IC-23 已升格实测必现，建议随下次涉 CAS 轮次优先）。

## 轮 20 附记（2026-10-15 剩余积压清零 + 0.4.9 发版）

- **清零批次**：IC-23 单调 token 三处归一（e74e63a，monotonicIsoNow helper：casWriteRunState 咽喉+runstate 覆盖写+state.mjs 常规/supersede 归并，专属断言两条）；IC-13/IC-22 README 计数根治（7e47e01，数字刷 538 + dimension-chain L1f 徽章三面互断+files 锚实数）；IC-12 home 锚定（79e21c0，根因=delegate.js 四处 process.cwd() 落盘锚——GUI 从 home 启动污染 ~/.omd；修=args.cwd 工作区优先+主目录锚守卫+死代码 stateRoot 删除；守卫谓词初版误伤 %TEMP% 夹具被既有测试抓回后收窄为「锚恰为主目录本身」）；IC-01~10 graph 十项清零（4026199，轮 17 P2 台账全落地：收割/park 摘要/grace 持久化/前缀上限/wire 帽/outputs safe-fs/epoch 写序/corruption 透传/maxSeq 缓存/五盲区）。
- **自体捕获两则**：P2-3 落地使 e2e ①⑤ 变红——观测侧短宽限失效正是修复语义（首跑显式短宽限对齐）；P2-2 测试暴露「带 in-边的 entry 不会首轮 waiting」拓扑事实。
- **IC-11 终局闭环**：0.4.8 publish prepublishOnly 全量绿=conditional-review 终验通过。
- **0.4.9 发版链**：门禁 45/552 绿 → 2091403（bump+README 552）→ push 1eef5a5..2091403 → npm publish exit 0（shasum 13eaae9d）→ web profile 升 0.4.9（第 3 次重试 CDN 传播到位；版本断言 ✓）。
- **测试面**：45 文件/552 tests 全绿（新增：生命周期 6+CAS 2+IC-12 3+graph 九钉+盲区五补+L1f 等）。
- **台账终态**：P1 清零（IC-11/12/20/21）；P2 清零（IC-01~10/13/22/23）；仅剩 gated 项 IC-14~17（新能力立项，待用户拍板）+ IC-18（dsh 0.2.0 stable 上游触发）。
- **用户手动作业**：重启宿主 → /omd-doctor 验装（应见 0.4.9）→ HUD 冒烟。回退段：dsh plugin --profile web add @sakura12/oh-my-deepseekharness@0.4.8。
