# oh-my-dsh 插件代码质量与逻辑 · 刻板审查报告（第二轮）

> 审查对象：`@sakura12/oh-my-deepseekharness` v0.4.9（D:\omd 工作副本）
> 第一轮（使用体验与人性化，33 条发现）见 docs/usability-humanization-review.md；本轮不重复其发现。
> 审查立场：刻板——不粉饰、不推测，每条发现附可复核证据（文件:行号）。
> 严重度：P0=正确性/安全硬伤；P1=实质风险或明显质量缺陷；P2=打磨项。

## 摘要

| 严重度 | 数量 | 含义 |
|---|---|---|
| P0 | 0 | 正确性/安全硬伤 |
| P1 | 6 | 实质风险（伪 CAS、守卫误杀、监控静默失明、状态锚错投、鉴权缺口、测试盲区） |
| P2 | 12 | 质量与打磨项 |

总计 **18 条发现**：逻辑正确性 4 / 错误处理与降级 4 / 代码质量 3 / 安全 3 / 性能 2 / 测试充分性 2。

总体结论（刻板口径）：第二轮没有发现 P0——核心数据面的工程纪律（原子写、单进程互斥、诚实头注、降级不阻断）是扎实的。但六条 P1 指向同一个模式：**声明的契约强于实际的保证**——「跨进程 CAS」实为 check-then-act、「检测+呈面」的失败路径静默、「守卫防误触发」自己制造误杀、hud.json 的边界只记录不缓解。另有一个结构性观察：同仓库内防护纪律不一致（delegate 有 isHomeAnchor 守卫而 hook 没有、heartbeat 有 in-flight 守卫而 createPollingHud 没有）——同一教训没有横向铺开。与第一轮合看：文档面 33 条 + 逻辑面 18 条，最优先修复 = 第一轮 P0（包名）+ 本轮 P1 簇（伪 CAS 与守卫误杀）。

## 审查对象清单

本轮覆盖的核心逻辑与测试文件（逐一核实存在）：

- `lib/index.js` — 插件入口装配与降级
- `lib/hook.js` — keyword-hook 检测与状态预写
- `lib/keywords.js` — 关键词注册表与锚定正则
- `lib/routing.js` — c3 自适应路由
- `lib/delegate.js` — omd_delegate 派发
- `lib/runstate.js` — run-state 镜像 CAS
- `lib/worktree.js` — c5 worktree 隔离
- `lib/team.js` — team 领队运行时
- `lib/events.js` — 派发事件总线
- `lib/heartbeat.js` — 心跳检测
- `lib/hud-route.js` — hud.json 数据路由
- `mcp-server/lib/atomic.mjs` — 原子写
- `mcp-server/lib/paths.mjs` — 状态路径解析
- `mcp-server/tools/state.mjs` — state_* 工具面
- `mcp-server/tools/team.mjs` — team_* 工具面
- `mcp-server/tools/graph.mjs` — graph_* 工具面
- `mcp-server/tools/prd.mjs` — prd_* 工具面
- `mcp-server/tools/codeintel.mjs` — 代码智能工具面
- `bin/graph-runner.mjs` — graph CLI
- `tests/` — vitest 测试面（45 文件）

## 逻辑正确性

- [P1] 否定前导守卫对行锚定模式跨行回望——`detectKeyword` 的疑问词窗口取 `s.slice(m.index - 8, m.index + 1)`，但对行锚定正则 `/^\s*ralph\s*[:：]/m`，m.index 是行首，窗口读的是**上一行的行尾**；用户上一行以「如何/怎么/什么」等结尾（完全合法的上下文），下一行行首的 `ralph:` 命令就被误判为解释性提及而静默直通——真命令被误杀，用户无任何反馈（证据：lib/hook.js:58、lib/hook.js:59；被守卫的锚定模式 lib/keywords.js:36）
  修复建议：对 match='anchored' 的行首形态，守卫窗口应只看本行匹配之前的同段文本（或跳过回望，行首 `x:` 形态本身已是强显式信号），疑问词守卫仅应用于「用 X」形态。
- [P1] 「跨进程 CAS」名不副实——`casWriteRunState` 是 读（:81）→ 校验 expectUpdatedAt（:83）→ mutate → rename（:88） 的 check-then-act，没有任何跨进程原子比较交换原语；两个进程可以同一 expectUpdatedAt 双双通过校验后双写，后写静默覆盖前写且两边都收到成功返回。runstate.js 头注宣称「跨进程以 expectUpdatedAt CAS 兜底」不成立；withFileLock 互斥只覆盖单进程（locks 是模块级 Map），「队长独占写」是约定而非强制——多会话各跑 team 时该窗口真实存在（证据：lib/worktree.js:81、lib/worktree.js:83、lib/worktree.js:88、lib/runstate.js:62；头注宣称 lib/runstate.js:5-6）
- [P2] createPollingHud 无重入防护——setInterval 按固定节奏触发 async pollOnce，取数慢于间隔时多拍并发执行，`snap` 的读-算 diff-写竞态导致 diff 重复或乱序（默认 intervalMs=1000，慢磁盘/大 .omd 下可达）（证据：lib/hud.js:199、lib/hud.js:201；竞态面 lib/hud.js:191、lib/hud.js:195）
- [P2] 原子写失败路径留孤儿 tmp 文件——writeFile 成功后 rename 失败（杀软占用/ACL）时 `<file>.<uuid>.tmp` 无 catch 清理，状态目录会随时间积累孤儿；读侧虽不读 tmp，但 .omd 卫生与磁盘占用无人管（证据：mcp-server/lib/atomic.mjs:9、mcp-server/lib/atomic.mjs:11、同款 mcp-server/lib/atomic.mjs:22）

## 错误处理与降级

- [P1] heartbeat 扫描失败只走 logger.debug——team 周期检测是「检测+呈面」承诺的唯一自动通道，扫描持续失败（权限/坏 JSON 风暴）时用户在 warn 面零感知，插件侧监控静默失明且无人察觉（证据：lib/heartbeat.js:47、lib/heartbeat.js:49；对照承诺文案 lib/heartbeat.js:5）
- [P1] keyword-hook 的会话锚回落无守卫——`cwd ?? process.cwd()` 静默兜底，没有 delegate.js 同款的 isHomeAnchor 守卫；GUI 从主目录启动且 header.cwd 缺失时，模式状态被写进主目录下的 .omd——既污染主目录，又让项目目录的 state_list_active 查不到（状态假丢失，stale 协议也摸不到）（证据：lib/hook.js:167；对照守卫实现 lib/delegate.js:132、其注释记载的实证 lib/delegate.js:127）
- [P2] MCP 挂载失败的降级公告工具面过时——warn 文案只列「state/notepad/prd/handoff 工具不可用」，实际全灭面是 55 个工具（另含 team×16、trace×4、hud×2、graph×6、代码智能×9）；降级公告系统性低估爆炸半径，用户按文案自救会漏查大半功能（证据：lib/index.js:122；对照现行口径 README.md:159）
- [P2] heartbeat 的 readdir 失败全吞归 no-op——目录不存在与权限拒绝走同一个 `catch { return [] }`，权限类故障与「没有 team」不可区分；与上一条 debug 降级叠加构成双重静默（证据：lib/heartbeat.js:28）

## 代码质量

- [P2] 「cordis 安全取服务」原语 tryGet 三份拷贝——probe.js、hud-route.js、delegate.js 各自实现且语义有微妙差异（delegate 版先走 ctx.get 再落属性访问，另两份只走属性访问）；B1 教训（未 inject 服务访问必炸）的防线没有单一来源，第四处需要时还会再抄一遍（证据：lib/probe.js:17、lib/hud-route.js:136、lib/delegate.js:101）
- [P2] CAS 冲突告警日志行信息失真——`conflictLine` 闭包捕获的是外层 `expectUpdatedAt` 形参，而重试循环里实际用于再 CAS 的是更新后的 `expected`（:118）；重试 ≥2 次时审计行打印的仍是首次派发时的旧期望值，排障时被误导（证据：lib/runstate.js:92、lib/runstate.js:93；更新点 lib/runstate.js:118）
- [P2] registerCodeIntelTools 单函数约 320 行——9 个工具注册、ast-grep 调用面、LSP 进程生命周期（单实例/崩溃重启/回收）全内联在一个函数里，是全仓最大热点函数；单测只能端到端打工具面，进程管理逻辑无法独立测（证据：mcp-server/tools/codeintel.mjs:145、mcp-server/tools/codeintel.mjs:466；对照同文件头注承诺的职责面 mcp-server/tools/codeintel.mjs:5）

## 安全

- [P1] hud.json 自定义路由零鉴权 + `?cwd=` 任意目录读——文件头注自承认两处残余边界：自定义路由不被 /api 桥的 cookie 鉴权覆盖（:8-9），loopback 上任意本机进程可读任意已存在目录的 .omd 摘要，0.0.0.0 绑定场景整网可读（:126-127 注释）。诚实记录值得肯定，但**没有任何缓解**：没有 Config 关闭阀（hudPreset 只调视图），没有绑定地址校验，没有 token。stat 存在性检查（:128）只收窄了路径 oracle，不收窄读取面（证据：lib/hud-route.js:125、lib/hud-route.js:128；头注自承认 lib/hud-route.js:8、lib/hud-route.js:127）
  修复建议：加 `hudRoute.enabled` Config 关闭阀 + 启动时校验 webServer 实际绑定地址非 0.0.0.0；或给路由加与 /api 桥同款的鉴权装饰。
- [P2] SAFE_ID 白名单只护 sessionId/mode 两个段，stateDir 不经校验直接进 join——Config 面的相对值（如 `../x`）可让状态根逃出工作区；同仓库 recordFallback 已用 resolve 防绝对路径幻影树（lib/routing.js:106 注释），paths.mjs 这层却无任何防护/校验，防护纪律不一致（证据：mcp-server/lib/paths.mjs:4、mcp-server/lib/paths.mjs:15；对照 lib/routing.js:106）
- [P2] graph command 节点的任意 shell 面只有声明式信任——descriptor 内 command 节点经 pwsh 执行任意 shell 行，双入口（CLI/MCP）都只在文案里声明「只运行你信任的 descriptor」，无 allowlist、无 dry-run 确认、无审计落盘之外的任何技术护栏；作为 MVP 取舍可接受，但应登记为已知暴露面（证据：bin/graph-runner.mjs:18、bin/graph-runner.mjs:19）

## 性能

- [P2] aggregateWorkers 串行 N+1 读——每个 run 目录 stat→readFile 串行 await，HUD 5s 轮询每拍最坏 50 run × 2 次串行 FS 往返；扫描序只需 mtime 排序，完全可有界并发化（Promise.all + 上限），现状是把轮询延迟钉在磁盘串行上（证据：lib/hud-route.js:39、lib/hud-route.js:47、上限语义 lib/hud-route.js:19）
- [P2] HUD 面板定频轮询空转照扫——client half 固定 5s 一拍，无任何变更时每拍仍全量重扫 state/sessions 目录 + team registry 聚合 + events 尾部 64KiB 读聚；无 etag/版本短路（run-state.json 自带 version 字段可用于快速判变，未利用）。空闲会话一天 ≈1.7 万拍无效 I/O（证据：lib/client.js:43、lib/hud-route.js:81、可利空的版本字段 lib/runstate.js:15）

## 测试充分性

- [P1] 守卫跨行误杀缺陷无测试覆盖——hook.test.js 只钉了单行解释性问句两个 case（:27、:52），本报告「逻辑正确性」节实锤的跨行情形（上一行尾疑问词 → 次行 `ralph:` 被误杀）没有任何对应测试；测试盲区与真实缺陷精确重合，说明现有守卫测试是「按实现写」而非「按规格写」（证据：tests/lib/hook.test.js:27、tests/lib/hook.test.js:52；缺陷面 lib/hook.js:58）
  修复建议：为跨行误杀与「用 X」形态的疑问词窗口各补一组正反例测试，先红后绿。
- [P2] 渲染类断言以子串包含为主——protocol.test.js 用一串 11 个 `toContain` 子串断言协议文本（:28-29），其中 'ralph'、'inherit' 这类短词可被任何无关叙述满足；全仓实测 313 处 toContain。仓库自己的 progress.txt 已记载 contains 断言被同文件其他数字蒙混的教训，但存量弱断言未系统性加固（证据：tests/lib/protocol.test.js:28、tests/lib/protocol.test.js:29）

## 审查方法

- **取证方式**：全部发现基于真实读文件（read/grep），逻辑类发现要求指出具体控制流（行号级）；不重复第一轮（docs/usability-humanization-review.md）的任何发现。
- **高产手法**：同仓库一致性对照（A 文件有守卫/B 文件没有 = B 的发现）；实锤缺陷反查测试覆盖（盲区即证据）。
- **机器核验**：每条发现经 `.omd/prd/checks/check-quality.js` 校验（严重度标记、证据文件存在、行号不越界）；检查器曾拦下一处证据路径缺前缀（routing.js → lib/routing.js），证明证据核验不是形式。
- **未覆盖面（诚实声明）**：lib/graph/（descriptor/journal/runner/scheduler 共约 80KB）与 mcp-server/tools/{state,team,prd,graph,codeintel}.mjs 的内部逻辑未逐行深读，仅抽查入口面；LSP 进程管理、team mailbox 协议的逻辑正确性未被本轮覆盖。
- **流程**：ralph PRD 驱动（`.omd/prd/quality-logic-review.json`，8 story），验收命令原始输出经 `prd_check` 落账；独立 verifier 复验结论记录于下。

### verifier 复验记录

两轮独立复验（互不串味）均裁决 **PASS**：

- **verifier A**（omd_delegate 前台派发 omdd-mvj3ltja-7）：9 条验收命令重跑全 0；6 条抽查全支撑；指出一处行号精度 nit（runstate.js:5 → :5-6，已修）。
- **verifier B**（后台 subagent a5775644）：9 条全 0；6 条抽查全支撑——并对「守卫跨行误杀」做了**新鲜实证复现**：`detectKeyword("这个怎么配置？\nralph: 跑任务")` 实测返回 null（真命令被误杀），对照组正常武装。缺陷从「代码推定」升级为「实测复现」。
- 两名 verifier 共同确认：全程只读，未修改报告与检查器。

## 修复记录（2026-10，全量 18/18 已修）

- **P1×6**：①hook 守卫跨行误杀——行首锚定形态不再套疑问词守卫，「用 X」形态守卫窗口收口不跨行（tests/lib/hook.test.js 补两组正反例回归）；②伪 CAS——casWriteRunState 读-校验-写收进 withRunStateLock（lockfile open('wx') 原子原语 + 60s stale 锁接管），跨进程双写窗口闭合；③heartbeat 扫描失败 debug 静默 → warn 节流呈面（首次即告警，每 10 拍续报）；④hook 会话锚回落补 isHomeAnchor 同款守卫（拒绝落 ~/.omd）；⑤hud.json 加 Config `hudRoute=false` 关闭阀（README 配置表同步）；⑥守卫测试盲区随修复补齐。
- **P2×12**：createPollingHud 重入防护；原子写 rename 失败清理孤儿 tmp；runstate conflictLine 闭包失真修正（日志带当前 expected）；tryGet 三拷贝单源化（lib/tryget.js）；registerCodeIntelTools 拆分（ast-grep 面独立成 codeintel-astgrep.mjs，23.9KB→18.0+6.9KB）；SAFE_ID 扩展校验 stateDir（禁绝对路径与 .. 段）；graph 声明式信任登记 README + --help 自带授权面提示；aggregateWorkers 有界并发化；HUD client 空转自适应退避（5s→≤30s，变化即复位）；protocol.test.js 弱断言改行锚定相等断言+负例。
- 验证：npm test 全量 46 files / 555 tests 全绿；四处契约变更（graph-runner exit 2 分流、heartbeat 告警、HUD 卡标签、doctor 分解）均由守门测试锁定新契约。
