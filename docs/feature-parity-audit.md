# omd 双源功能点对齐审查报告（v0.4.0 复审）

> 复审日期：2026-09（omd v0.4.0，M4–M8 里程碑落地后）
> 初审：2026-09（omd v0.3.0）——见文末「v0.3.0 初审存档」的口径说明
> 对比基线：`reference/oh-my-claudecode`（OMC v5.4.0）、`reference/oh-my-codex`（OMX v0.21.5）本地快照
> 口径：行 = 用户/agent 可见能力；两源共有能力合并一行标双来源；源库内部实现细节不单独成行
> 状态图例：✅ 已完成（有接线/测试证据）｜⚠️ 降级完成（库能力或文档级，接线未做）｜❌ 未做（未见决定记录）｜🚫 决定不做 / 不适用

## 总览计数（45 个功能点）

| 状态 | 计数 | v0.3.0 | 变迁 |
|---|---|---|---|
| ✅ 已完成 | **34** | 22 | +12（4 项 ⚠️ 升级 + 8 项 ❌ 建成） |
| ⚠️ 降级完成 | **1** | 6 | −5（4 升 ✅、1 转 ✅ 替代实装、graph 保持） |
| ❌ 未做 | **0** | 11 | −11（8 建成 + 3 转 🚫 决定记录；D-3 消除） |
| 🚫 决定不做 / 不适用 | **10** | 6 | +4（D-3 三项 + team-executor/orchestrator 并入记录） |

体量对照（v0.4.0 实测）：omd = 1 根 hook 电线 + 插件侧 heartbeat 定时器 / 44 skills（双语）/ 33 角色（双语）/ 2 斜杠命令 / **49 MCP 工具** / 4 宿主工具 / **251 tests 全过（30 文件）**。

---

## A. 执行模式（8）

| # | 功能点 | 状态 | omd 证据（v0.4） | 备注 |
|---|---|---|---|---|
| 1 | autopilot 全自治流水线 | ✅ | `assets/skills/autopilot/` + dsh 原生 goal 续跑 | v0.4 增量：收尾沉淀检查点（见 D-20） |
| 2 | ralph PRD 迭代循环 | ✅ | `assets/skills/ralph/` + dsh 原生 ralph 工具 + prd 工具面 | 同上沉淀检查点 |
| 3 | ultragoal 持久多目标 | ✅ | `assets/skills/ultragoal/` | — |
| 4 | team 五阶段流水线 | ✅ **(⚠️→✅)** | `lib/team.js` + `mcp-server/tools/team.mjs` 16 工具 + `tests/lib/team.test.js`（12 测试）+ `tests/mcp-server/team.test.js` v0.4 段 | 阶段状态机强制 fix≤3；见 F-30/32 |
| 5 | deep-interview 模糊度门禁 | ✅ | `assets/skills/deep-interview/` + Config `deepInterview.*` | — |
| 6 | ralplan 共识规划 | ✅ | `assets/skills/ralplan/` | — |
| 7 | autoresearch 有状态改进循环 | ✅ | `assets/skills/autoresearch/` | — |
| 8 | cancel + 退役词拦截 | ✅ | `lib/keywords.js` + `/omd-cancel` | — |

## B. 技能资产（4）

| # | 功能点 | 状态 | omd 证据（v0.4） | 备注 |
|---|---|---|---|---|
| 9 | OMC 38 skill 资产移植 | ✅ | `assets/skills/`（44 目录，tests/assets 校验） | — |
| 10 | 双语资产（zh/en） | ✅ | `assets/**/(*.zh.md|SKILL.zh.md)`、Config `language` | — |
| 11 | OMX 独有 skill | ✅ **(❌→✅)** | `assets/skills/{analyze,best-practice-research,design,performance-goal}/` 双语 ×4 | ultraqa（OMC 已退役）/ worker（已并入 team skill）转 🚫 决定记录 R-5 |
| 12 | visual-verdict / visual-ralph | ✅ | `assets/skills/visual-verdict/` | — |

## C. 角色卡与模型路由（5）

| # | 功能点 | 状态 | omd 证据（v0.4） | 备注 |
|---|---|---|---|---|
| 13 | 19 委派角色卡 | ✅ | `assets/agents/` 33×双语 66 文件 | v0.4 扩编至 33（含下行） |
| 14 | OMX 扩展角色 | ✅ **(❌→✅)** | 新增 14：api-reviewer/style-reviewer/performance-reviewer/quality-reviewer/quality-strategist/build-fixer/dependency-expert/information-architect/vision/product-analyst/product-manager/ux-researcher/researcher/explore-harness | team-executor/team-orchestrator 转 🚫 决定记录 R-6（team 运行时角色路由覆盖）；tier 映射经 `tests/assets/agents.test.js` 名册断言 |
| 15 | 三档模型路由 + roleOverrides | ✅ | `lib/config.js` + `resolveModel` | — |
| 16 | c3 自适应路由 | ✅ | `lib/routing.js` + `tests/lib/routing.test.js`（35 项路由表 × 81 组合全抽样钳制） | — |
| 17 | omd_delegate 硬路由工具 | ✅ | `lib/delegate.js` + 协议路由表 | — |

## D. 状态 / 记忆 / 数据面（9）

| # | 功能点 | 状态 | omd 证据（v0.4） | 备注 |
|---|---|---|---|---|
| 18 | 模式状态 state_* | ✅ | `mcp-server/tools/state.mjs`（5 工具） | — |
| 19 | notepad 三区记事本 | ✅ **(⚠️→✅)** | `notepad.mjs` 注册 6 工具（v0.4 补 write_manual/prune + 3 测试） | D-1 修复：仓库与在线挂载面已对齐 |
| 20 | 跨会话项目记忆 | ✅ **(⚠️→✅ 替代实装)** | `lib/memory.js` + autopilot/ralph 收尾沉淀检查点（SKILL 段「收尾沉淀检查点」） | hook 自动沉淀无宿主面 → 显式检查点替代，决定记录 R-3 |
| 21 | PRD 台账 prd_* | ✅ | `mcp-server/tools/prd.mjs`（4 工具） | — |
| 22 | 阶段交接 handoff_* | ✅ | `mcp-server/tools/handoff.mjs`（3 工具） | — |
| 23 | wiki 知识库 | ✅ **(⚠️→✅ 替代实装)** | `assets/skills/wiki/`「会话边界清单」（挂载/落盘双清单） | session hook 无宿主面 → 模型驱动清单替代，决定记录 R-4 |
| 24 | trace 时间线工具面 | ✅ **(❌→✅)** | `mcp-server/tools/trace.mjs`（trace_begin/event/summary/list，`.omd/trace/<id>.jsonl` append-only）+ 10 测试 | 对标 OMC trace_timeline/trace_summary |
| 25 | 代码智能 MCP | ✅ **(❌→✅)** | `mcp-server/tools/codeintel.mjs`：ast_grep_search/replace（@ast-grep/napi）+ lsp_start/stop/status/document_symbols/references/definition/diagnostics | Config `codeIntel.lspServers` 注册表；napi 缺席显式报错；mock LSP 全链测试在案 |
| 26 | 会话历史搜索 | 🚫 **(❌→🚫)** | 决定记录 R-1 | 宿主 `recall` 为正规面（本部署禁用属部署配置，非功能缺口） |

## E. Hook 矩阵（3）

| # | 功能点 | 状态 | omd 证据（v0.4） | 备注 |
|---|---|---|---|---|
| 27 | 关键词触发 hook | ✅ | `lib/hook.js`（agent/pre-step 原生拦截点，零 LLM） | — |
| 28 | 其余 10 事件点 24 条 hook | 🚫 **(❌→🚫)** | 决定记录 R-2 | dsh 宿主事件面探测仅 agent/pre-step 可用；复评触发条件已记录 |
| 29 | 持久续跑（boulder） | ✅ | dsh 原生 goal/ralph 续跑 | — |

## F. Team 运行时（6）

| # | 功能点 | 状态 | omd 证据（v0.4） | 备注 |
|---|---|---|---|---|
| 30 | 领队运行时 / 队员编排 | ✅ **(❌→✅)** | `lib/team.js`：阶段状态机（phase-controller 对应）+ mailbox（leader-inbox 对应）+ heartbeat 扫描 + 插件侧周期检测（`lib/heartbeat.js`，Config `team.heartbeatIntervalMs`）+ merge 计划（merge-orchestrator MVP） | 诚实边界：heartbeat=检测+呈面，催促归领队模型（dsh 无插件→subagent 消息缝）；merge 执行归模型 |
| 31 | tmux pane 通道 | 🚫 | team SKILL 明示刻意舍弃 | dsh 无 tmux 承载面 |
| 32 | UUID / owner-epoch 队员生命周期 | ✅ **(❌→✅)** | `lib/team.js` registry：workerId=`w-<uuid8>`，runId=owner-epoch 等价物；状态流 dispatched→running→blocked/done/failed，终态不可复活 | 测试覆盖状态迁移矩阵 |
| 33 | c5 worktree 隔离 | ✅ | `lib/worktree.js` + team_begin/dispose/scan_orphans | — |
| 34 | c6 run-state 七字段 CAS 镜像 | ✅ | `lib/runstate.js` + team_write_mirror | — |
| 35 | c8 多仓锚定 | ✅ | `lib/multirepo.js` + team_write_tree_state | — |

## G. HUD 与通知（3）

| # | 功能点 | 状态 | omd 证据（v0.4） | 备注 |
|---|---|---|---|---|
| 36 | HUD 五要素摘要卡（c4） | ✅ **(⚠️→✅)** | server 面 `mcp-server/tools/hud.mjs`（hud_render/hud_summary）+ client half `lib/client.js` + 数据路由 `lib/hud-route.js`（/oh-my-dsh/hud.json） | client bundle 沙箱测试在案；面板可见需宿主重启装载（记录在 hud skill） |
| 37 | statusline / 双层 HUD 持续渲染 | ✅ **(❌→✅)** | 右栏 omd-hud 面板 5s 轮询（`lib/client.js` useHudSnapshot） | 语义映射：dsh 无终端 statusline，右栏持续面板为其等价物——差异如实记录 |
| 38 | 多网关通知 | 🚫 **(❌→🚫)** | 决定记录 R-7 | dsh 无会话事件通知面；`configure-notifications` skill 记录替代路径 |

## H. CLI 与分发（4）

| # | 功能点 | 状态 | omd 证据（v0.4） | 备注 |
|---|---|---|---|---|
| 39 | CLI 入口 | 🚫 | package.json 无 bin 字段 | 维持 v0.3.0 决定 |
| 40 | Marketplace / plugin.json | 🚫 | 无 | 维持 |
| 41 | inventory 库存图 / 构建产物 | 🚫 | 无 | 维持 |
| 42 | VSCode 扩展 | 🚫 **(❌→🚫)** | 决定记录 R-8 | 实质被 dsh Web GUI 覆盖（含 v0.4 HUD 面板） |

## I. 跨进程 / Rust / 运行时核（3）

| # | 功能点 | 状态 | omd 证据（v0.4） | 备注 |
|---|---|---|---|
| 43 | 跨进程互斥（lease_mutex） | 🚫 | expectUpdatedAt CAS 兜底（`lib/runstate.js`） | 维持 v0.3.0 决定 |
| 44 | 运行时核 + sidecar | 🚫 | 无 | OMX 宿主桥接件，dsh 无对应需求面 |
| 45 | graph DAG 运行时 | ⚠️（保持） | `assets/skills/graph/` 契约 + 模型驱动执行；v0.4 补 **Journal 格式约定**（二期运行时锚点，今天模型驱动执行照此写） | 确定性运行时归 omd 二期；journal 格式已冻结为恢复输入契约 |

---

## v0.4 决定记录（D-3 消除：每条含理由与复评触发条件）

- **R-1 会话历史搜索 → 🚫 不做。** 理由：dsh 宿主提供 `recall` 全历史搜索工具（跨会话全文），OMC session-history-search 的场景被宿主原生面覆盖；本部署 recall 禁用属部署配置而非功能缺口。复评触发：宿主移除 recall 或出现 omd 私有会话存储需要检索时。
- **R-2 hook 矩阵其余 24 条 → 🚫 0.x 不做。** 理由：dsh 宿主事件面经探测仅 `agent/pre-step` 一个拦截点可用（c2 已消费）；session-start/session-end/PreToolUse 等事件在宿主无注册面，写 hook 无处接线。复评触发：dsh 宿主开放新事件拦截点（probe.js 已留 hooksBridge 前置探测位）。
- **R-3 项目记忆 hook 自动沉淀 → 显式检查点替代。** 理由：OMC 的 learner 依赖 session-end hook（R-2 同面缺失）。替代实装：autopilot/ralph SKILL 的「收尾沉淀检查点」（完成前显式把耐久事实 → `omd_memory_set`、可复利知识 → wiki/notepad；无沉淀项须显式声明）。复评触发：R-2 解除。
- **R-4 wiki session hook → 会话边界清单替代。** 理由同 R-2/R-3。替代实装：wiki SKILL「会话边界清单」（session-start 挂载三步骤 + 落盘三步骤，模型驱动）。复评触发：R-2 解除。
- **R-5 OMX ultraqa / worker → 🚫 不移植。** 理由：ultraqa 在 OMC v5.0 已退役（双源均不应复活）；worker 协议已并入 omd team skill 的 Worker 协议段（逐字注入契约在案）。
- **R-6 OMX team-executor / team-orchestrator → 🚫 不移植。** 理由：二者绑定 OMX team 运行时（mailbox CLI/tmux 形态）；其职责由 omd team 运行时的阶段角色路由（team SKILL 表）+ lib/team.js registry 覆盖。复评触发：omd team 运行时出现这两卡覆盖不了的编排角色缺口。
- **R-7 多网关通知 → 🚫 不做。** 理由：通知器依赖会话事件 hook（session-end/idle），宿主无此面（R-2）；`configure-notifications` skill 已记录 dsh 下最接近的替代路径。复评触发：R-2 解除或宿主提供通知缝。
- **R-8 VSCode 扩展 → 🚫 不做。** 理由：OMX 的 VSCode 扩展是其宿主 GUI；dsh 的对应物是 dsh Web GUI（omd v0.4 已向其交付 HUD 面板 client half），再写 VSCode 扩展是双倍维护面。复评触发：用户出现 VSCode 内使用 dsh 的明确需求。

## v0.3.0 初审发现闭环

- **D-1（工具面不一致）→ 已修复。** 仓库 `notepad.mjs` 补齐 `notepad_write_manual` / `notepad_prune` 注册（6 工具），与在线挂载面对齐；+3 测试。
- **D-2（README 失实）→ 已修复。** 徽章/正文测试数、MCP 工具数、notepad 区数全部改为实测值并随 v0.4 再更新（见 README；omd-doctor 注册计数表同步 44/33/2/4/49）。
- **D-3（❌ 行隐含决定缺失）→ 已消除。** 11 个 ❌ 全部处置：8 建成（✅）+ 3 转 🚫 决定记录（R-1/R-2/R-7）+ VSCode（R-8）；另补 R-5/R-6 两条移植去重决定。

## 口径说明（v0.3.0 初审存档）

- 「✅ 替代实装」计入已完成：OMC/OMX 用 hook/CLI 实现、omd 用 dsh 宿主原生机制（goal/ralph/subagent/webServer/client bundle）等价承载的能力。
- reference/ 为本地快照，未追 npm 最新版漂移；OMC v5.0 退役项（ultrawork/swarm/pipeline 等）不计入差异。
- v0.4 全部状态迁移附文件/测试证据指针；测试基线 30 文件 251 tests 全过（`npx vitest run`）。
