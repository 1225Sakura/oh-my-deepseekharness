# oh-my-dsh graph 运行时与 MCP 工具内部 · 刻板审查报告（第三轮）

> 审查对象：`@sakura12/oh-my-deepseekharness` v0.5.0（D:\omd 工作副本；含一、二轮 51 条修复后的现状）
> 本轮覆盖面：第二轮诚实声明的未覆盖区——lib/graph/ 七文件（约 80KB）逐行深读 + mcp-server/tools/ 内部逻辑。
> 审查立场：刻板——不粉饰、不推测，每条发现附可复核证据（文件:行号）；深读无恙的面如实登记查点，不编造缺陷。
> 严重度：P0=正确性/安全硬伤；P1=实质风险；P2=打磨项。

## 摘要

| 严重度 | 真实发现 | 说明 |
|---|---|---|
| P0 | 0 | — |
| P1 | 6 | state_write 所有权扫描无锁（互斥破口）/ stale 双语义不贯通 / fence acquire 泄漏空锁 / takeover TOCTOU 可误删活锁 / reconcile 移植丢闸 / bin-MCP 退出码不一致 |
| P2 | 13 | journal 短写撕裂、safe-fs 纪律破口、output_ref 形态债、prd 台账三缺陷等 |

另有 **21 条查点记录**（深读后验证无恙的关键面，含实证）——六节合计 40 条登记：descriptor 8 / journal 6 / 调度 5 / fence 5 / MCP 工具 6 / runner 10。

总体结论（刻板口径）：graph 运行时核心（descriptor 校验、journal 账本、调度器）质量显著高于插件平均水平——移植忠实、校验穷尽、测试钉得深（三节制式零缺陷或仅 P2 卫生项）。**问题集中在边界接缝**：①互斥原语家族——run-state 修好了 lockfile，state_write 同款破口还在，fence 的 acquire/takeover 路径又冒出两个新的竞态（含实证复现）；②移植缺口——reconcile 策略闸在上游 fail-closed 而 omd 零检查；③双入口一致性——bin 与 MCP 的退出码契约、封印护栏注入都出现第三入口/双入口漂移。三轮合看：51（已修）+ 19（本轮真实发现），互斥与「声明 vs 实际」仍是本仓库最值得投资的系统性主题。

## 审查对象清单

- `lib/graph/descriptor.js` — descriptor 校验与封印
- `lib/graph/schema.js` — descriptor schema
- `lib/graph/guardrails.js` — agent 节点护栏前缀注入
- `lib/graph/journal.js` — journal.jsonl append-only 账本
- `lib/graph/scheduler.js` — 就绪判定/并发上限/seq
- `lib/graph/fence.js` — OwnerFence 跨进程占用
- `lib/graph/runner.js` — 运行循环与命令执行
- `bin/graph-runner.mjs` — CLI 入口
- `mcp-server/tools/graph.mjs` — graph_* 六工具面
- `mcp-server/tools/state.mjs` — state_* 工具面
- `mcp-server/tools/team.mjs` — team_* 十六工具面
- `mcp-server/tools/prd.mjs` — prd_* 工具面
- `mcp-server/tools/notepad.mjs` — notepad_* 工具面
- `mcp-server/tools/hud.mjs` — hud_* 工具面
- `mcp-server/tools/trace.mjs` — trace_* 工具面
- `mcp-server/tools/handoff.mjs` — handoff_* 工具面

## descriptor 与封印

- [P2] instructionsSchema 上限对全部 agent 节点放宽 171 字符，「作者面 32768 不变」契约不成立——max=32768+前缀169+2=32939 对所有 agent 节点生效，但护栏前缀只对 effect_policy=side_effect_free 节点注入，idempotent/reconcile 策略的 agent 节点永不注入，其 instructions 可合法写至 32939 字符通过封印，超出注释声明的作者上限；现有测试只锁定 side_effect_free 路径，非注入路径的越界无覆盖（证据：lib/graph/schema.js:35、lib/graph/schema.js:38、lib/graph/schema.js:31-33、lib/graph/guardrails.js:22-30；对照 tests/lib/graph-schema.test.js:1152）
- [P2] 仓库内第三个封印入口跳过护栏注入——e2e driver 直接 sealGraphDescriptor(parseGraphDescriptor(draft))，与「护栏前缀→封印」双入口契约不一致；同一含 side_effect_free agent 节点的 draft 经此路径会封印出不同 descriptor_hash，且 agent 节点在无只读/leaf-guard 前缀下被执行。当前无实际后果（e2e 唯一 fixture graph-simple-linear.json 全是 command 节点），属漂移隐患（证据：tests/lib/helpers/graph-e2e-driver.mjs:46；对照 bin/graph-runner.mjs:73、mcp-server/tools/graph.mjs:81、lib/graph/guardrails.js:5-7；现状无害依据 tests/lib/graph-e2e.test.js:25、tests/lib/fixtures/graph-simple-linear.json:9）
- [P2] 查点记录：封印幂等与 hash 稳定已验证无恙——sealGraphDescriptor 拒绝带 hash 输入（所有权流互斥），hash 载荷固定九字段且排除 descriptor_hash；同 draft 重复封印同 hash 有测试锁定；bin 对解析后 draft 注入护栏、mcp 对原始输入注入，因 Zod strict 拒绝未知键而非剥离、parse 不做值转换，两路径产出同一 hash（证据：lib/graph/descriptor.js:668-672、lib/graph/descriptor.js:84-96、tests/lib/graph-schema.test.js:547-551、bin/graph-runner.mjs:73、mcp-server/tools/graph.mjs:81、lib/graph/schema.js:11-13）
- [P2] 查点记录：护栏注入幂等已验证无恙——startsWith 前缀判重防重复拼接，已带前缀的 sealed 快照回流再封印不漂移；32768 原文+前缀通过、32769 拒绝有测试锁定；无转义问题（前缀为纯文本前缀拼接，不参与任何再解析）（证据：lib/graph/guardrails.js:46、lib/graph/guardrails.js:50、tests/lib/graph-schema.test.js:1152-1163）
- [P2] 查点记录：parseSealedGraphDescriptor 永不静默重算已验证无恙——先验 hash 格式、再 strict 结构校验、再重算比对，不匹配即拒；verifyDescriptorHash 结构先于 hash、永不抛、不克隆不改输入（证据：lib/graph/descriptor.js:697-707、lib/graph/descriptor.js:720-729）
- [P2] 查点记录：canonicalJson 跨实现对齐风险已核查——键排序为 UTF-16 码元序（与 RFC 8785 一致），循环/非 plain object/非有限数均显式拒绝；数字序列化依赖 JSON.stringify 的 ECMAScript 最短往返格式，descriptor_hash 仅在 JS 兼容 canonicalizer 下可复现——当前单实现无恙，登记为跨语言移植约束（证据：lib/graph/descriptor.js:52-56、lib/graph/descriptor.js:66-77、lib/graph/descriptor.js:71-72）
- [P2] 查点记录：fork region 校验成本有界已实测无恙——746 节点/762 边、6 组分支区域两两重叠的畸形 descriptor 全量校验 13.7ms 内 fail-closed 抛出（schema 上限 nodes≤1000/edges≤5000）；最重路径（区域逐节点 isReachable、跨区域两两重叠 O(R²)）在上限内无 DoS 风险（证据：lib/graph/schema.js:142-143、lib/graph/descriptor.js:402、lib/graph/descriptor.js:440-452）
- [P2] 查点记录：schema 畸形面已核查无可绕过——全对象 .strict() 拒未知键、kind 判别联合封死未知节点/边类型、ID/文本/数值均有界；draft 带 hash、sealed 缺 hash、hash 格式错、proto 污染输入均有拒绝测试锁定；deepFreeze+structuredClone 防御性拷贝每层冻结有测试锁定（证据：lib/graph/schema.js:74、lib/graph/schema.js:98-103、lib/graph/schema.js:136-152、lib/graph/descriptor.js:116-123、tests/lib/graph-schema.test.js:935、tests/lib/graph-schema.test.js:1010、tests/lib/graph-schema.test.js:1051）

## journal 与恢复

- [P2] writeSync 短写未校验，极端情况下成功返回却留下撕裂行、run 无法恢复 — append 写路径 `writeSync(fd, line)` 的返回值（实际写入字节数）被丢弃，`writeCompleted` 无条件置 true（证据：lib/graph/journal.js:320、lib/graph/journal.js:321）；POSIX/Windows 均允许短写（如信号中断、特殊文件系统），一旦发生，fsync 把半行刷盘、`_seqCache` 照常前进（证据：lib/graph/journal.js:322、lib/graph/journal.js:326），而下次 `readAll` 对截断尾 fail-closed 抛 JournalCorruptionError（证据：lib/graph/journal.js:377、lib/graph/journal.js:381），恢复路径无修复手段，整个 run 被一条半行永久卡死。修复成本一行（循环写满或校验返回值不等即走失权截断分支）。
- [P2] descriptor 快照读取未走本文件自定的 safe-fs 纪律 — `assertDescriptorBinding` 用裸 `readFileSync` 读 descriptor.json（证据：lib/graph/journal.js:442），而同一文件对 journal 主路径与 outputs/ 旁路写均强制 openNoFollow + assertPrivateRegularFile（symlink 拒绝 + 私有常规文件断言，证据：lib/graph/journal.js:227、lib/graph/journal.js:236、lib/graph/journal.js:504、lib/graph/journal.js:506），其注释自称「防护纪律全路径一致」（证据：lib/graph/journal.js:500）；写入侧 runner 的原子快照写同样无 symlink 检查（证据：lib/graph/runner.js:212、lib/graph/runner.js:216）。descriptor.json 若被换为 symlink 会被静默跟随读取，漂移校验的信任根出现缺口（本地单用户场景实际风险低，故 P2）。
- [P2] output_ref 校验只查非空，形态不受约束，为未来消费者埋下路径安全债 — 读路径 `flatRecordError` 对 node_committed.output_ref 仅要求非空字符串（证据：lib/graph/journal.js:135、lib/graph/journal.js:136），而写路径自身只生成 `outputs/<sanitize 后>.md` 形态（证据：lib/graph/journal.js:495、lib/graph/journal.js:511）；MCP 提交口允许调用方把任意 ≤2048 字符的 output_ref 直接落账（证据：mcp-server/tools/graph.mjs:256、mcp-server/tools/graph.mjs:338）。当前全仓无任何代码按 output_ref 回读文件（已检索确认），故无现实遍历危害；但「journal 行是可信输入」的假设一旦用于新增 outputs 读取面，`../..` 形态的记录将直通。校验闸在 journal.js，宜在读/写两侧钉死 `^outputs/[A-Za-z0-9._:-]+$` 形态。
- [P2] 查点记录：坏行检测与截断尾语义 fail-closed 且聚合计数一次抛 — 不完整尾行（缺尾换行）与中间坏行（非 JSON / 字段校验失败 / seq 跳号重复）统一计数后一次性抛 JournalCorruptionError（exitCode 20、truncatedCount 聚合），绝不静默返回部分数据（证据：lib/graph/journal.js:376、lib/graph/journal.js:406、lib/graph/journal.js:411）；构造器强制 truncatedCount 为正整数，边界无缺（证据：lib/graph/journal.js:72、lib/graph/journal.js:75）。测试 ① 组钉死非 JSON 行/截断半行/聚合计数/seq 跳号与重复/词表外 type 全 fail-closed（证据：tests/lib/graph-journal.test.js:179、tests/lib/graph-journal.test.js:248）。
- [P2] 查点记录：重放幂等性已验证 — projectGraph fold 对重复 node_committed/fence_acquired/gate_resolved 幂等（committedAttempt 同值覆盖、fence_acquired 不入节点投影，证据：lib/graph/scheduler.js:250、lib/graph/scheduler.js:257、lib/graph/scheduler.js:288）；MCP 提交口对同 payload 重复提交幂等返回、异 payload 拒绝（证据：mcp-server/tools/graph.mjs:294、mcp-server/tools/graph.mjs:328）；seq 严格连续由 readAll 与 validateRecordSequence 双重闸把守（证据：lib/graph/journal.js:395、lib/graph/journal.js:401、lib/graph/scheduler.js:119）。
- [P2] 查点记录：并发 append 风险边界与失权截断语义如实落地 — 无 fence 模式（allowUnfencedAppend）跨进程无互斥保证在文件头明文声明、须显式 opt-in（证据：lib/graph/journal.js:22、lib/graph/journal.js:24、lib/graph/journal.js:296）；fence 绑定 append 三段式 assertOwnership（写前/打开后/fsync 后），fsync 在飞失权时仅当 size 恰为 expectedSize 才截自家后缀，size 已变即遗留 durable suffix 供 fail-closed 重放、绝不误截他人数据（证据：lib/graph/journal.js:302、lib/graph/journal.js:325、lib/graph/journal.js:328、lib/graph/journal.js:347）；win32 O_APPEND 句柄 ftruncate EPERM 的第二 fd 回退有专项测试直钉 size 守卫（证据：tests/lib/graph-journal.test.js:483、tests/lib/graph-journal.test.js:496）；maxSeq 进程内缓存以 fence epoch 为失效键，失权/换主自动重读（证据：lib/graph/journal.js:419、lib/graph/journal.js:428）。

## 调度与并发

- [P2] 查点记录：concurrency_limit 强制具备 tick 内原子性——ready-list 出队处 `inflight.size >= concurrencyLimit` 检查（证据：lib/graph/runner.js:398）到 `inflight.set` 占位（证据：lib/graph/runner.js:413）之间全是同步操作（journal append 为同步 fs、spawn 同步发起），无 await 出让点，单线程事件循环内检查与占位不可交错；真实进程级并发峰值经 UtcNow.Ticks 起止区间扫描钉死 <=2（证据：tests/lib/graph-e2e.test.js:549、tests/lib/graph-e2e.test.js:606），journal 行序另有 limit=1 串行与 limit=2 放行双钉（证据：tests/lib/graph-runner.test.js:210、tests/lib/graph-runner.test.js:233）——已验证无恙
- [P2] 查点记录：seq 恢复后续号单调性三层咬合——readAll 严格连续闸（缺号/跳号即 20 语义 fail-closed，证据：lib/graph/journal.js:395、lib/graph/journal.js:397）+ append OCC maxSeq()+1 续号且调用方不得自带 seq（证据：lib/graph/journal.js:474、lib/graph/journal.js:477）+ 进程内 maxSeq 缓存以 fence epoch 为失效键，接管换主自动重读（证据：lib/graph/journal.js:422、lib/graph/journal.js:426）；scheduler 投影侧再做严格递增二次校验（证据：lib/graph/scheduler.js:119）——已验证无恙
- [P2] 查点记录：join 等待语义确定且幂等——未消解 join 恒落 blocked、不执行不占外部等待位（证据：lib/graph/scheduler.js:388、lib/graph/scheduler.js:390）；消解条件=owner fan 已 done 且每条 fan_out 分支区域内存在以 fixed 边直指本 join 的已 done 节点（证据：lib/graph/scheduler.js:316、lib/graph/scheduler.js:331），fixpoint 循环至不动点（证据：lib/graph/scheduler.js:324）；join 无 journal 记录、恢复时由同一输入逐位重放（不变量声明：lib/graph/scheduler.js:17）；结构性前提（fan 单 owner join、分支必有 join 输入边、fork 区域禁嵌套 join）由 descriptor 校验保证（证据：lib/graph/descriptor.js:332、lib/graph/descriptor.js:409、lib/graph/descriptor.js:390）——已验证无恙
- [P2] 查点记录：assertSupportedEdges fail-fast 落在投影入口第一行——conditional/back_edge 过滤即抛 UnsupportedEdgeError（exit 1 显式文案，证据：lib/graph/scheduler.js:65、lib/graph/scheduler.js:69），projectGraph 在任何 fold 之前调用（证据：lib/graph/scheduler.js:172）；conditional 与 back_edge 两类入口拒绝均有测试钉死（证据：tests/lib/graph-scheduler.test.js:540、tests/lib/graph-scheduler.test.js:549）——已验证无恙
- [P2] 查点记录：崩溃悬挂 attempt 的预算语义闭环——node_scheduled 无 node_committed 投影回 ready 续号重跑（at-least-once 不变量，证据：lib/graph/scheduler.js:8），maxAttempt+1 超 max_attempts 即判 attempts_exhausted 不再重试（证据：lib/graph/scheduler.js:405、lib/graph/scheduler.js:408），与 runner 写账方向 retryable=attempt<max_attempts 一致（证据：lib/graph/runner.js:353）；node_committed 为完成唯一判据、节点分类先查 done（证据：lib/graph/scheduler.js:380）——已验证无恙

## fence 与接管

- [P1] owner.epoch 坏值时 acquire 泄漏空锁，后续获取全被 FENCED_OUT — createUnderLock 中 readEpochCeiling（lib/graph/fence.js:363）位于清理 try（lib/graph/fence.js:366）之外，fail-closed 抛错时 fd 未关、空 owner.lock 残留；实证：污染 sidecar 后 acquire 抛错、lock 残留空内容、第三实例 acquire 收 FENCED_OUT/19，须等 stalled 宽限后 takeover 才恢复；既有测试（tests/lib/graph-fence.test.js:216）只断言抛错、不断言锁残留
- [P1] takeover 的 inspect→unlink→O_EXCL 序列有跨进程 TOCTOU，可误删新主活锁并致双持 — 两进程同见 stalled 后，落败者可在胜方重建锁之后执行 unlink（lib/graph/fence.js:271）；且 heartbeat 只查内存 this.held 不校验锁身份（lib/graph/fence.js:281）、owner.json 心跳无 epoch 字段（lib/graph/fence.js:395-399），被废黜者心跳可污染 owner.json，待其死后 inspect 以死 pid 判 stalled（lib/graph/fence.js:222、lib/graph/fence.js:229），活主锁可被第三者 takeover——journal append 的 assertOwnership 只兜账本写，pwsh 命令副作用不在兜底内；盲区① 测试（tests/lib/graph-fence.test.js:284）仅覆盖同进程串行竞态，未覆盖此交错
- [P2] createUnderLock 尾部 writeOwnerJson 失败时实例已持锁但 acquire 抛错，调用方状态矛盾 — this.fd/heldEpoch 先赋值（lib/graph/fence.js:385-386），writeOwnerJson（lib/graph/fence.js:388）抛错无回滚；实证：令 owner.json 写入 EPERM，acquire 抛错但 held=true、锁残留，第二实例 acquire 被 FENCED_OUT
- [P2] 查点记录：stalled 双条件（lease 过期且 pid 不存活）经单测逐一钉死四象限（lib/graph/fence.js:229，tests/lib/graph-fence.test.js:124-148），stale_grace_ms 持久化使观测口径不背离原 run（lib/graph/fence.js:228，tests/lib/graph-fence.test.js:320-341）——已验证无恙
- [P2] 查点记录：release 身份检查先于任何变更、fd 持有期读 payload，绝不误删接管者锁（lib/graph/fence.js:315-337）；epoch sidecar 先写后 payload 的崩溃序只产生无害跳号空洞（lib/graph/fence.js:367-371）；pid 复用为头部明文申报的已知残余风险（lib/graph/fence.js:16-18）——已验证无恙

## MCP 工具内部

- [P1] state_write 的所有权扫描+supersede 全路径无锁——先扫其他会话同名模式文件并就地改写（supersede 审计写 :44），再读-校验-写本文件（:52-63），全程无互斥；MCP server 并发处理请求时两个会话可同时通过扫描、双双写成 active 同模式——「模式互斥」契约在并发下不成立（run-state 已修的伪 CAS 同族问题，此面未修）（证据：mcp-server/tools/state.mjs:22、mcp-server/tools/state.mjs:44、mcp-server/tools/state.mjs:52；对照已修面 lib/worktree.js:79 的 lockfile 临界区）
  修复建议：把 write 的扫描+supersede+校验+写整体收进 per-stateDir 的 lockfile 临界区（复用 withRunStateLock 同款原语，锁文件如 <stateDir>/state/.state-write.lock）。
- [P1] getStatus 的 stale 阈值全局硬编码 2 小时——team 模式的 stale 语义是 5 分钟（Config team.staleAfterMs），但 HUD deriveTier 与卡片 stale 行消费的只有这个 2h 全局判定；team run 卡死 5 分钟后 heartbeat 标 stale，HUD 卡片却要 2 小时才显示 stale——两种 stale 语义互不贯通，监控信号矛盾（证据：mcp-server/tools/state.mjs:96；对照 lib/config.js:35、lib/hud.js:85）
- [P2] prd_amend 对缺 criterionAmendments 字段的手写 PRD 直接崩——`s.criterionAmendments.push(...)` 无初始化兜底，合法但不带该字段的 PRD JSON 触发 TypeError 而非人话错误（证据：mcp-server/tools/prd.mjs:56；对照容错写法 mcp-server/tools/prd.mjs:77 的 ?? []）
- [P2] prd_uncheck 回退完成状态但不清理已落账的 evidence 字段——story 被 uncheck 后 evidence 残留，re-check 前读 PRD 的人会看到「未通过但有证据」的矛盾态（证据：mcp-server/tools/prd.mjs:44、mcp-server/tools/prd.mjs:45；对照 check 的写入面 mcp-server/tools/prd.mjs:36）
- [P2] 台账矛盾检测只覆盖「孤儿 amendment」——ralph skill 契约还要求「同一原文被修订两次」fail-closed，status() 的 warnings 未实现这条；台账完整性校验半残（证据：mcp-server/tools/prd.mjs:77、mcp-server/tools/prd.mjs:79）
- [P2] state_list_active 无界全量读——逐会话逐文件 readJson 无上限无并发控制，.omd 长期不清理的仓库每次 HUD 轮询全扫（与性能节空转问题叠加）（证据：mcp-server/tools/state.mjs:75、mcp-server/tools/state.mjs:80）

## runner 与命令执行

- [P1] reconcile 策略 fail-closed 缺口——schema 接受 { policy: 'reconcile' }（lib/graph/schema.js:49），但 executeCommandNode 对 effect_policy 零检查、无条件 spawn 执行（lib/graph/runner.js:138），失败后照常被 retryable 重试（lib/graph/runner.js:353）；唯一被特判的策略是 idempotent 注入 GRAPH_IDEMPOTENCY_KEY（lib/graph/runner.js:72）。上游契约是 reconcile 节点 fail-closed 拒绝通用执行器（"reconcile policy requires a custom executor"，reference/oh-my-claudecode/src/graph/runtime/executors/command.ts L208-214，agent 侧同 L109-110）——omd 移植丢了这道闸，声明「副作用需人工对账」的节点被当作普通 shell 命令执行并重跑，effect_policy 三分法形同虚设；omd 侧计划/文档未见此偏差声明（.omd/plans 与 assets/skills/graph/SKILL.zh.md 均无 reconcile 运行语义）
- [P1] bin 入口的输入拒绝仍落 exit 70，与 MCP 入口 exit 1 分流不一致——exit 2 修复只覆盖缺参（bin/graph-runner.mjs:53）与坏 JSON（bin/graph-runner.mjs:64）；schema 非法 descriptor（parseGraphDescriptor 抛 ZodError/GraphDescriptorValidationError，bin/graph-runner.mjs:73）与 UNSUPPORTED_EDGE（assertSupportedEdges 抛 UnsupportedEdgeError exitCode=1，bin/graph-runner.mjs:74）都在 main() 的 try 外，由 .catch 兜底成 exit 70（bin/graph-runner.mjs:86）；而同一 descriptor 走 MCP graph_run 时 GraphSchedulerError 映射 error.exitCode=1、ZodError/ValidationError 映射 FAILED_TERMINAL=1（mcp-server/tools/graph.mjs:60-63）。双入口设计声明同权同契约（bin/graph-runner.mjs:20），脚本化调用方按退出码分类时会把「设计上拒绝的输入」误判为「运行时崩溃」
- [P2] stdout/stderr 逐 chunk toString('utf8') 切碎跨 chunk 多字节字符——capture 对每个 data 事件独立 chunk.toString('utf8')（lib/graph/runner.js:154），流边界落在 UTF-8 多字节序列中间时产生 U+FFFD 替换符，落进 journal/output_ref 的输出即已损坏（pwsh 中文输出高发）；正解是 setEncoding('utf8') 或 StringDecoder 拼接
- [P2] 截断计量单位错位：按字节判定、按 UTF-16 码元截断——Buffer.byteLength(output) 超 MAX_CAPTURED_OUTPUT_BYTES 后 output.slice(0, 256*1024) 按码元切（lib/graph/runner.js:155-157），纯 CJK 输出实际保留字节可达上限约 3 倍；ERROR_OUTPUT_TAIL_BYTES 名为字节实为码元（lib/graph/runner.js:66、lib/graph/runner.js:207）。有界性本身成立（≤256K 码元+一块 chunk，截断后 capture 短路 lib/graph/runner.js:153），但常量语义名实不符
- [P2] --stale-grace-ms 非数字静默透传 NaN——Number('abc')=NaN 无校验（bin/graph-runner.mjs:60）；OwnerFence 构造器 ?? 不拦截 NaN（lib/graph/fence.js:173），leaseAgeMs > NaN 恒 false → stalled 永不成立（lib/graph/fence.js:229），该 run 的 takeover 被永久拒绝且无任何报错；应 fail-fast 进 exit 2 分流
- [P2] 查点记录：timeout 强杀确杀进程树——Windows taskkill /PID /T /F（lib/graph/runner.js:107-112），非 Windows detached 进程组 -pid SIGKILL 带单 pid 兜底（lib/graph/runner.js:115-124）；有墙钟回归钉：Start-Sleep 30 两 attempt 自然 60s 被压到 <30s（tests/lib/graph-runner.test.js:163-183），超时判定只信自家 timedOut 标志、与被 kill 的 exitCode=1 不可区分问题已规避（lib/graph/runner.js:181-187）
- [P2] 查点记录：stdout 捕获有界且大输出有旁路——单路 256KB 截断+标记（lib/graph/runner.js:64、lib/graph/runner.js:152-159），截断后子进程管道持续 drain 不会撑爆内存；journal 侧 >4096B 自动旁路 outputs/ 只记 output_ref（lib/graph/journal.js:483-489），journal 行不会被大输出撑肥
- [P2] 查点记录：长命令 await 期间 fence lease 过期无接管风险——heartbeat 仅在推进循环迭代刷新（lib/graph/runner.js:373），Promise.race 等待在飞子进程期间 lease 会超 30s 宽限，但 stalled 判定是 lease 过期 AND owner pid 死亡双条件缺一不可（lib/graph/fence.js:229），活 owner 不会被 takeover；双执行风险已验证不成立
- [P2] 查点记录：exit 2 分流修复（已修部分）验证正确——缺参/坏 JSON → 人话 stderr + exit 2 且不污染 GRAPH_RUN_RESULT stdout 通道（bin/graph-runner.mjs:53-71），--help → exit 0（bin/graph-runner.mjs:46-49），进程退出码=runGraph exit_code（bin/graph-runner.mjs:83）；测试全钉死（tests/mcp-server/graph.test.js:399-407）
- [P2] 查点记录：错误路径收割在飞子进程——catch 段对 inflight 表逐一发 killProcessTree（lib/graph/runner.js:451-453），不重跑不落账、at-least-once 由 journal 重放保证；回归钉实证失权现场 taskkill 被调到（tests/lib/graph-runner.test.js:562-592）。重试幂等前提与上游一致：GRAPH_IDEMPOTENCY_KEY token 含 attempt 是移植原样（lib/graph/runner.js:74-77 对照 reference authority.ts L82-84），非偏差

## 审查方法

- **分工**：领队亲审 MCP 工具内部（state.mjs/prd.mjs 逐行）；五个 graph 节各派一名子代理逐行深读（descriptor 739 行/journal 513 行/scheduler 453 行/fence 403 行/runner 491 行全文 + 对照测试与上游 reference 原文）。
- **实证要求**：fence 面两个 P1 均带子代理实证复现（污染 sidecar/EPERM 注入）；descriptor 面含畸形大图性能实测（746 节点 13.7ms fail-closed）。
- **诚实零发现**：调度节深读零缺陷，以 5 条查点记录交付（检查器放行）——零发现不编造是本轮契约的一部分。
- **并发写入纪律**：六写入者共享一份报告，靠文件版本守卫 + re-read 重试，零覆盖事故。
- **机器核验**：.omd/prd/checks/check-graph.js 全节绿（证据文件存在、行号不越界、格式契约）。
- **verifier 复验记录见下。**

### verifier 复验记录

独立复验（omd_delegate 前台派发 omdd-mvj7mh1m-9，omd-agent-verifier）裁决 **PASS**：9 条验收命令亲跑全 EXIT=0；6 条抽查（含全部必查：fence 两条 P1 机理、reconcile 丢闸、state_write 无锁、stale 2h 硬编码 + 随机 journal 短写条）亲读源码全部支撑，行号精确，零伪造。Gaps 如实登记：fence 两条 P1 的实证复现声明未重跑测试复核（源码机理已核）。

## 修复记录（2026-10，全量 19/19 已修；21 条查点为无恙登记不在其列）

- **fence 与接管**：①readEpochCeiling 挪进清理 try（坏 epoch 不再泄漏空锁）；②takeover 在 unlink 前重核锁 payload epoch（TOCTOU 窄化，残余微秒窗口如实登记）、owner.json 补 epoch 字段、heartbeat 先 assertOwnership（废黜者心跳不再污染 stalled 判定）；③writeOwnerJson 失败回滚 fd/heldEpoch 并按身份 unlink。
- **runner 与命令执行**：④reconcile 闸落地——ReconcileUnsupportedError（GraphSchedulerError 家族，exit 1）在 bin/MCP/投影三层入口 fail-closed；⑤bin 输入类错误（schema 非法/UNSUPPORTED_EDGE/reconcile/Zod）与 MCP 同映射 exit 1，真崩溃才 70；⑥stdout/stderr 改 StringDecoder（跨 chunk 多字节不再切碎）；⑦截断按字节计数按字节切；⑧--stale-grace-ms 非数字 exit 2 人话。
- **MCP 工具内部**：⑨state_write 全路径收进 per-stateDir lockfile 临界区（withCrossProcessFileLock 泛化自 run-state 锁），hook 预写路径同锁域；⑩stale 双语义贯通——team 模式 stale 用 team.staleAfterMs（OMD_TEAM_STALE_MS 注入）；⑪prd_amend criterionAmendments 初始化兜底；⑫prd_uncheck 清 evidence；⑬台账补「原文仍 active / 同文两次修订」检测；⑭listActive 有界化（200×50 上限 + 并发）。
- **descriptor 与封印**：⑮非 side_effect_free 节点的作者面 32768 由 validateGraphDescriptor 补闸 + schema 注释修真；⑯e2e driver 第三封印入口补护栏注入（跨入口 hash 一致）。
- **journal 与恢复**：⑰writeSync 短写显式失败；⑱descriptor 快照读取收进 safe-fs 纪律；⑲output_ref 形态钉死 outputs/<safe-name>。
- 验证：npm test 全量 46 files / 558 tests 全绿（新增 reconcile 闸×2、bin NaN 用例；既有 555 全保）。
