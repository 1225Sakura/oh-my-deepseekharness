# omd 双源功能点对齐审查报告（v0.4.4 重基线）

> 重基线日期：2026-10（omd v0.4.4，U7 执行循环 S2 全量重评）
> 对比基线：`reference/oh-my-claudecode`（OMC **v5.7.0**，HEAD `8262f9f`）、`reference/oh-my-codex`（OMX **v0.21.9**，HEAD `02ef37e`）——本地快照，git tag 级锚定（本会话实测复核）
> 形态速查：上游形态卡 `docs/upstream-form-omc.md` / `docs/upstream-form-omx.md`；reference/ 快照升级时本文与形态卡**同轮更新**，并必跑 `npm test -- upstream-forms`（两层门：仓内一致性恒跑 + reference 漂移检测缺席 skip）拦数字漂移
> 口径：行 = 用户/agent 可见能力；两源共有能力合并一行标双来源；源库内部实现细节不单独成行
> 状态图例：✅ 已完成（有接线/测试证据）｜⚠️ 降级完成（库能力或文档级，接线未做）｜❌ 未做（未见决定记录）｜🚫 决定不做 / 不适用
> 历史存档原则：v0.4.0 复审（基线 OMC v5.4.0 / OMX 0.21.5）与 v0.4.1 复验节原样保留于本文后半，旧证据不删不作废；存档节内数字只反映其时点，**本节为当前权威段**。U7-S1 勘误表（`.omd/state/u7-drift.md`）为重基线输入。

# v0.4.4 重基线（2026-10）

## 方法与全局证据

- 快照锚（`git log -1` 实证，本会话复核）：OMC HEAD `8262f9f` = tag v5.7.0；OMX HEAD `02ef37e` = tag v0.21.9。
- 上游权威数字复核（本会话实测，与 S1 勘误表逐项一致）：OMC skills **48**（目录枚举 = `.claude-plugin/plugin.json` 注册 48 项，双口径一致）｜hooks **30 条注册**（14 matcher / 11 事件类型，逐事件分布与 u7-drift §1 一致）｜agents **19**｜commands **21**；OMX root skills **29**（0.21.5→0.21.9 零增删）。
- omd 侧实测（2026-10-13）：`assets/skills/` **42 目录**｜`assets/agents/` **66 文件**（33 角色×双语）｜MCP `server.registerTool` 逐文件枚举 **55**（9 个工具文件）｜斜杠命令 2（`lib/commands.js`：omd-doctor / omd-cancel）｜tests **44 文件 / 523 tests 全绿**（`npm test` 2026-10-14 复核；较 10-13 的 43/519 +1 文件 +4 tests = upstream-forms 守门纳入）。
- 口径声明：①team/ralph 全流程 E2E 仍受 autopilot 模式互斥硬约束（v0.4.1 口径延续），以测试矩阵 + 接线证据判定；②S1 判定「不纳入」的 14 项上游增量（u7-drift §3.2/§3.3）按契约不重评，结论直接复用；③`.omd/` 下证据指针为文件系统级事实（gitignored）；④本轮重基线基于 v0.4.4 代码事实；U10（tiers 默认值改为 inherit）已在 ec96619 落地、随 0.4.5 发版，#16/#17 证据行经落地核对机制面未变、无需随行改写，dsh 0.2.0 stable 二次复评仍待触发。

## 总览计数（45 点 + 11 项上游新增评估行）

| 状态 | v0.4.0 | **v0.4.4** | 变迁 |
|---|---|---|---|
| ✅ 已完成 | 34 | **35** | +1（#45 graph ⚠️→✅：U4 一期确定性运行时落地） |
| ⚠️ 降级完成 | 1 | **0** | −1（#45 转 ✅） |
| ❌ 未做 | 0 | **0** | — |
| 🚫 决定不做 / 不适用 | 10 | **10** | 零变迁（R-1～R-8 全部维持，复评触发条件均未点燃） |
| **45 点基数小计** | 45 | **45** | 状态迁移 1 项，行口径不变 |
| 上游新增评估行（U7-S1 纳入，不并入 45 点基数） | — | **11** | ⚠️部分 4 + ❌未做 7（无 ✅/🚫）；移植裁决留共识流程 |
| **评估全集** | 45 | **56** | — |

体量对照（v0.4.4 实测）：omd = 1 根 hook 电线（agent/pre-step）+ 插件侧 heartbeat 定时器 / **42 skills**（双语）/ 33 角色（双语）/ 2 斜杠命令 / **55 MCP 工具** / 4 宿主工具（口径沿 v0.4.0 存档节：dsh 原生 goal/ralph/subagent/workflow 编排面）/ **44 files / 523 tests 全过**（2026-10-14 复核更新）。

## 45 点逐行重评

（各点 = 状态复核 + omd 证据刷新到当前代码 + 上游对照。45 点中仅 #45 状态迁移；其余维持 v0.4.0 判定，证据全部为 2026-10-13 实测。）

### A. 执行模式（8）

| # | 功能点 | 状态 | omd 证据（v0.4.4 实测） | 上游对照（v5.7.0） |
|---|---|---|---|---|
| 1 | autopilot 全自治流水线 | ✅ 维持 | `assets/skills/autopilot/` + dsh 原生 goal 续跑（create_goal/update_goal 续跑轮）；收尾沉淀检查点维持 | 仍在（`skills/autopilot`） |
| 2 | ralph PRD 迭代循环 | ✅ 维持 | `assets/skills/ralph/` + dsh 原生 ralph 工具 + prd 工具面（#21，4 工具实测）；E2E 受模式互斥约束以测试矩阵判定 | 仍在（`skills/ralph`） |
| 3 | ultragoal 持久多目标 | ✅ 维持 | `assets/skills/ultragoal/` | 仍在（`skills/ultragoal`） |
| 4 | team 五阶段流水线 | ✅ 维持 | `lib/team.js` + `mcp-server/tools/team.mjs` **16 工具**（本轮逐名枚举）+ `tests/lib/team.test.js` + `tests/mcp-server/team.test.js`；阶段状态机强制 fix≤3；HUD 队员区聚合见 #36 | 仍在（`skills/team` + `bridge/team*.cjs` 形态）——上游无 lib 级运行时，omd 形态为自有承载 |
| 5 | deep-interview 模糊度门禁 | ✅ 维持 | `assets/skills/deep-interview/` + Config `deepInterview.*`（阈值 0.2 / 软提醒 10 / 硬上限 20） | 仍在（`skills/deep-interview`） |
| 6 | ralplan 共识规划 | ✅ 维持 | `assets/skills/ralplan/` + 共识链档案 `.omd/state/ralplan-reviews/` **29 份**（u6/u8/u9/u4 的 planner-architect-critic 多轮台账） | 仍在（`skills/ralplan`） |
| 7 | autoresearch 有状态改进循环 | ✅ 维持 | `assets/skills/autoresearch/`（dsh goal 驱动严格超集，U1 裁决引用） | 仍在（`skills/autoresearch`）；OMX autoresearch-goal 日落存根不纳入（u7-drift §3.4） |
| 8 | cancel + 退役词拦截 | ✅ 维持 | `lib/keywords.js`（cancel 独占 + RETIRED 退役词）+ `/omd-cancel`（`lib/commands.js`）+ 扫描面白名单修复 e65e963 在案；本轮 S2 任务自身即经 keyword-hook 激活（活证） | 仍在（`skills/cancel`） |

### B. 技能资产（4）

| # | 功能点 | 状态 | omd 证据（v0.4.4 实测） | 上游对照（v5.7.0 / 0.21.9） |
|---|---|---|---|---|
| 9 | OMC skill 资产移植 | ✅ 维持 | `assets/skills/` **42 目录**（本轮实测再证；`tests/assets/skills.test.js` 校验）——存档节记 44 系 v0.4.0 时点数，−2 = configure-notifications / omc-doctor（47b5050 删除）；上游权威数更正 **48**（存档节记 38 系工作态旧数，见「S1 勘误落实」） | **已变**：v5.4.0→v5.7.0 skills +9/−0，9 个新 skill 全部纳入评估（见「上游新增能力评估」） |
| 10 | 双语资产（zh/en） | ✅ 维持 | 42 skills + 33 agents 全双语（`assets/**/(*.zh.md|SKILL.zh.md)`），Config `language` | 不适用（上游无双语面，omd 增值维度） |
| 11 | OMX 独有 skill | ✅ 维持 | `assets/skills/{analyze,best-practice-research,design,performance-goal}/` 双语 ×4 | OMX 0.21.5→0.21.9 skills **零增删**（tag diff 为空）；root 29 / 打包 24 结构差 5 项均为退役或已有等价物（u7-drift §3.3–3.4） |
| 12 | visual-verdict / visual-ralph | ✅ 维持 | `assets/skills/visual-verdict/`（严格 JSON 裁决契约） | 仍在（`skills/visual-verdict`）；OMX visual-ralph 覆盖口径维持 |

### C. 角色卡与模型路由（5）

| # | 功能点 | 状态 | omd 证据（v0.4.4 实测） | 上游对照（v5.7.0） |
|---|---|---|---|---|
| 13 | 19 委派角色卡 | ✅ 维持 | `assets/agents/` **66 文件**（33 角色×双语；`tests/assets/agents.test.js` 全量名册断言） | OMC agents **19 零增删**（仅 debugger/explore 内容微调） |
| 14 | OMX 扩展角色 | ✅ 维持 | 名册恰 14 张（api-reviewer / style-reviewer / performance-reviewer / quality-reviewer / quality-strategist / build-fixer / dependency-expert / information-architect / vision / product-analyst / product-manager / ux-researcher / researcher / explore-harness）；tier 映射断言在案 | OMX 打包面无 agents 目录（u7-drift §1）——上游无此面，omd 扩编维持；R-6 维持 |
| 15 | 三档模型路由 + roleOverrides | ✅ 维持 | `lib/config.js` resolveModel + roleOverrides | **补记**：上游档位集含 fable（高于 opus；v5.4.0 已在，初审未列名）——omd 三档钳制表语义映射不变，fable 无 dsh 承载需求，不立项 |
| 16 | c3 自适应路由 | ✅ 维持 | `lib/routing.js` + `tests/lib/routing.test.js`（35 角色×81 组合钳制抽样）；派发档位桶落 events.jsonl（U8） | 上游无此机制（omd 自有） |
| 17 | omd_delegate 硬路由工具 | ✅ 维持 | `lib/delegate.js`（tier/model 经 spawn 路径强制生效）+ 每次派发恰一条事件落盘（`lib/events.js` recordRouteEvent，route/fallback 1:1） | 上游无对应工具（omd 自有面） |

### D. 状态 / 记忆 / 数据面（9）

| # | 功能点 | 状态 | omd 证据（v0.4.4 实测） | 上游对照（v5.7.0） |
|---|---|---|---|---|
| 18 | 模式状态 state_* | ✅ 维持 | `mcp-server/tools/state.mjs` **5 工具**（本轮枚举） | 上游模式状态为文档约定 + 文件形态，无 MCP 工具面——omd 自有承载 |
| 19 | notepad 三区记事本 | ✅ 维持 | `notepad.mjs` **6 工具**（本轮枚举：read/priority/working/manual/prune/stats） | 上游 plan notepads 为文档约定面；omd MCP 化维持 |
| 20 | 跨会话项目记忆 | ✅ 维持 | `lib/memory.js` 3 工具 + autopilot/ralph 收尾沉淀检查点（R-3 维持） | 上游 learner 已于 v5.0 退役——无对照变化 |
| 21 | PRD 台账 prd_* | ✅ 维持 | `prd.mjs` **4 工具**（check/uncheck/status/amend，本轮枚举） | 上游 PRD 为 ralph skill 约定面，无 MCP 工具 |
| 22 | 阶段交接 handoff_* | ✅ 维持 | `handoff.mjs` **3 工具**（本轮枚举） | 上游交接为 team skill 交接文档约定 |
| 23 | wiki 知识库 | ✅ 维持 | `assets/skills/wiki/`「会话边界清单」（R-4 维持） | 仍在（`skills/wiki`） |
| 24 | trace 时间线工具面 | ✅ 维持 | `trace.mjs` **4 工具** + `.omd/trace/<id>.jsonl` append-only；另有 events.jsonl 派发审计面（U8，`lib/events.js`） | 仍在（`skills/trace`）；上游新 refit 消费同类仪表面 → 评估 #7 ⚠️部分 |
| 25 | 代码智能 MCP | ✅ 维持 | `codeintel.mjs` **9 工具**（ast_grep_search/replace + lsp 七面；napi 缺席显式报错） | 上游无对应 MCP 面（omd 自有） |
| 26 | 会话历史搜索 | 🚫 维持（R-1） | dsh 宿主 `recall` 为正规面 | 仍在上游（`src/tools/session-history-tools.ts` + `cli session-search`）——上游存在不改变宿主面判定，R-1 维持 |

### E. Hook 矩阵（3）

| # | 功能点 | 状态 | omd 证据（v0.4.4 实测） | 上游对照（v5.7.0） |
|---|---|---|---|---|
| 27 | 关键词触发 hook（c2） | ✅ 维持 | `lib/hook.js`（agent/pre-step 唯一拦截点，零 LLM）+ source.kind 白名单严格 user 侧（e65e963 回归在案） | 上游 30 条注册为其宿主形态参照；omd 单电线判定不变 |
| 28 | 其余事件点 hook | 🚫 维持（R-2） | 复评 2026-10-12 完成：0.1.7-rc.1 vs 0.2.0-rc.2 拦截面逐包零新增（存档节台账） | **已变**：hooks 25→30 条注册、13→14 matcher、11 事件类型集合不变——增量全落 dsh 无注册面事件，不点燃复评 |
| 29 | 持久续跑（boulder） | ✅ 维持 | dsh 原生 goal/ralph 续跑 | 仍在上游（"The boulder never stops"，CLAUDE.md 实测在案） |

### F. Team 运行时（6）

| # | 功能点 | 状态 | omd 证据（v0.4.4 实测） | 上游对照（v5.7.0 / 0.21.9） |
|---|---|---|---|---|
| 30 | 领队运行时 / 队员编排 | ✅ 维持 | `lib/team.js`（阶段状态机 + mailbox + heartbeat 扫描 + merge 计划）+ 16 team_* 工具 + `lib/heartbeat.js` 周期检测；队员/工具调用聚合上 HUD（#36） | 仍在（`skills/team` + `bridge/team*.cjs`）；诚实边界维持：heartbeat=检测+呈面，催促归领队模型 |
| 31 | tmux pane 通道 | 🚫 维持 | team SKILL 明示刻意舍弃 | OMX tmux HUD 生命周期改进（0.21.6 #3660/83/85）不纳入（u7-drift §3.3：dsh 无 tmux 承载面） |
| 32 | UUID / owner-epoch 生命周期 | ✅ 维持 | workerId=`w-<uuid8>`、runId=owner-epoch、终态不可复活（状态迁移测试矩阵在案） | OMX #3761 原生 Stop 完成证据不纳入：registry 终态 + heartbeat = 已有等价物（u7-drift §3.3） |
| 33 | c5 worktree 隔离 | ✅ 维持 | `lib/worktree.js` + team_begin/dispose/scan_orphans（两阶段拆除 CAS） | 上游无对应运行时（文档级指引） |
| 34 | c6 run-state 七字段 CAS 镜像 | ✅ 维持 | `lib/runstate.js` + team_write_mirror（CAS 重读 ≤3） | 上游无对应运行时 |
| 35 | c8 多仓锚定 | ✅ 维持 | `lib/multirepo.js`（树内懒建 + 豁免向上 marker；测试卫生封闭化 0f21ee3） | 上游无对应运行时 |

### G. HUD 与通知（3）

| # | 功能点 | 状态 | omd 证据（v0.4.4 实测） | 上游对照（v5.7.0） |
|---|---|---|---|---|
| 36 | HUD 五要素摘要卡（c4） | ✅ 维持 | server 面 `hud.mjs`（hud_render/hud_summary）+ preset 三档（minimal/focused/full，`lib/client.js`）+ U8「队员」「工具调用」两区 + U6 自适应两级树（≥2 runId 渲染组头）+ 版本交叉免疫句（hud SKILL 双语） | **上游新增**：v5.7.0 HUD 显示 effort level（#4249）→ 评估 #10 ❌未做（dsh 数据缝待核） |
| 37 | statusline / 双层 HUD 持续渲染 | ✅ 维持 | 右栏 omd-hud 面板 5s 轮询 + `/oh-my-dsh/hud.json` exact 路由 + client bundle 沙箱测试 | 仍在上游（README statusline 面）；语义映射差异如实维持（dsh 无终端 statusline，右栏持续面板为等价物） |
| 38 | 多网关通知 | 🚫 维持（R-7） | `configure-notifications` 已删（47b5050） | 上游仍保留 `skills/configure-notifications`——分歧如实记录：上游服务 Claude Code hooks 通知面，dsh 无会话事件缝，判据不变 |

### H. CLI 与分发（4）

| # | 功能点 | 状态 | omd 证据（v0.4.4 实测） | 上游对照（v5.7.0 / 0.21.9） |
|---|---|---|---|---|
| 39 | CLI 入口 | 🚫 维持 | package.json 仍无 bin 字段（本轮实测）；U4 新增 `bin/graph-runner.mjs` 为 graph 运行时专用后台入口（与 MCP 六工具同 lib 核心、同 descriptor_hash），非通用 CLI，不改变判定 | 仍在上游（`bridge/cli.cjs`） |
| 40 | Marketplace / plugin.json | 🚫 维持 | 无 | 仍在上游（`.claude-plugin/plugin.json`，48 skills 注册） |
| 41 | inventory 库存图 / 构建产物 | 🚫 维持 | 无 | 仍在上游（`inventory/inventory-graph.json`） |
| 42 | VSCode 扩展 | 🚫 维持（R-8） | dsh Web GUI（含 HUD 面板）覆盖 | OMX `packages/vscode-extension` 仍在其位——R-8 判据不变 |

### I. 跨进程 / Rust / 运行时核（3）

| # | 功能点 | 状态 | omd 证据（v0.4.4 实测） | 上游对照（v5.7.0 / 0.21.9） |
|---|---|---|---|---|
| 43 | 跨进程互斥（lease_mutex） | 🚫 维持 | expectUpdatedAt CAS 兜底（`lib/runstate.js`）；U4 graph fence（`lib/graph/fence.js`）为领域内互斥，非通用 lease_mutex | 上游无对应 |
| 44 | 运行时核 + sidecar | 🚫 维持 | 无 | OMX bridge 面（cli / mcp-server / runtime-cli / team-bridge）仍在其位——宿主桥接件形态未变 |
| 45 | graph DAG 运行时 | ✅ **(⚠️→✅)** | **U4 一期落地**：`lib/graph/` 7 模块（descriptor/journal/scheduler/runner/fence/guardrails/schema）+ `mcp-server/tools/graph.mjs` 6 工具（graph_validate/run/status/resume/node_result/gate_resolve）+ `bin/graph-runner.mjs` 双入口同 descriptor_hash + e2e 七组真实跨进程（`tests/lib/graph-e2e.test.js` 7 ✓，本轮全量绿）；扁平 journal 一期坚守（driver=模型可手写性，包络升级触发条件见 u4 ADR §8） | 上游仍为技能契约（`skills/graph/SKILL.md` 单文件，模型驱动）；omd 一期确定性运行时为超越形态，上游无运行时新增 |
## 决定记录维持状态（R-1～R-8，本轮零新增开放项）

R-1～R-8 全文在下方 v0.4.0 存档节（一个含义一个家，此处不重抄），本轮逐条复核结论：

- **R-1 维持**：上游 session-history-search 仍在（`src/tools/session-history-tools.ts`），但 dsh 宿主 recall 正规面判定不变。
- **R-2 维持**：复评已于 2026-10-12 完成（0.1.7-rc.1 vs 0.2.0-rc.2 拦截面零新增，存档节台账）；上游 hooks 25→30 的增量全部落在 dsh 无注册面事件上，不点燃复评。
- **R-3 / R-4 / R-7 不点燃**（挂 R-2 解除）；R-7 上游对照：OMC 仍保留 configure-notifications skill，omd 侧已删——分歧如实记录，判据不变。
- **R-5 / R-6 / R-8 维持**：OMX 侧对应物均无变化（skills 零增删 / packages/vscode-extension 仍在其位）。

## S1 勘误落实（本节即更正后的权威口径）

| 勘误项 | 旧值（出处） | 权威值 | 依据 |
|---|---|---|---|
| OMC skill 资产数（存档节 #9 记「OMC 38」） | 38（工作态旧数，与任何 tag 不齐） | **48**（v5.7.0） | 目录枚举 = plugin.json 注册，双口径一致；v5.4.0 tag 实为 39（u7-drift §2） |
| omd assets/skills（存档节体量行记 44） | 44（v0.4.0 时点） | **42** | 本轮实测再证；−2 = configure-notifications / omc-doctor（47b5050 删除） |
| OMC hooks 注册数（轮 9 曾记「hooks 40」） | 40（无实证记忆值，作废） | **30 条注册**（14 matcher / 29 引用脚本） | hooks.json 解析：UserPromptSubmit 2 · SessionStart 7 · PreToolUse 2 · PermissionRequest 1 · PostToolUse 4 · PostToolUseFailure 1 · SubagentStart 1 · SubagentStop 2 · PreCompact 3 · Stop 5 · SessionEnd 2（本轮解析与 u7-drift §1 逐项一致） |
| omd 体量行（存档节记 49 MCP / 251 tests） | 49 MCP / 251 tests（30 文件） | **55 MCP 工具 / 44 files / 523 tests**（2026-10-14 复核） | registerTool 逐文件枚举 + `npm test` 本轮新鲜全绿 |

## 上游新增能力评估（U7-S1 纳入 11 项，逐条裁决）

（裁决口径：✅已覆盖 = omd 有等价或超集能力；⚠️部分 = 主路径有承载、存在明确缺口；❌未做 = 无对应资产；🚫不采纳 = 有决定记录。14 项「不纳入」增量不在本表——其裁决已在 u7-drift §3.2/§3.3，45 点重评直接复用，无需重评。）

| # | 能力项 | 上游证据（落版） | 裁决 | 一句证据 / 决定记录 |
|---|---|---|---|---|
| 1 | architecture-survey | `skills/architecture-survey/`（v5.5.0） | ⚠️部分 | `analyze` 通道（只读深度仓库分析，带置信度/证据边界）+ `omd-agent-architect` 覆盖分析场景；「周期性盘点→排序加深候选、只勘不救（survey, not rescue）」的专门形态无对应资产 |
| 2 | diagram | `skills/diagram/`（v5.5.0） | ❌未做 | omd 无「散文承载结构时选最小视觉（伪代码/调用树/Mermaid/diff）」写作纪律资产；vision 工具面是图像理解，不覆盖此维度 |
| 3 | intent | `skills/intent/`（v5.5.0） | ⚠️部分 | `ask-navigator`→`launch` 使命简报交接链与 intent 的「问题报告→intent.md→launch」主路径同构；非工程师受众的编号批量提问 intake 语法与 harbor 四记录 tracker 评审无对应 |
| 4 | minimal-prose-discipline | `skills/minimal-prose-discipline/`（v5.5.0） | ❌未做 | 近邻纪律齐（minimal-code-discipline 管代码、agent-doc-discipline 管文档），均不约束 agent 对人发言面（受保护核心 / filler 死刑 / 零旁白） |
| 5 | map | `skills/map/`（v5.6.0） | ❌未做 | HUD modeCatalog 只路由执行模式；42 技能面无「哪个 skill 归哪个活」的路由地图资产（map 只路由不执行，与 HUD 面性质不同） |
| 6 | pr | `skills/pr/`（v5.6.0） | ❌未做 | omd 无 PR 组装资产；上游强依赖 OMC paper-trail 面（verify 协议证据不重收 / ADR 测试 / GLOSSARY 语言），移植前须先做 dsh 适配分析（u7-drift §3.1 预判成立） |
| 7 | refit | `skills/refit/`（v5.6.0） | ⚠️部分 | 重叠分析：输入仪表面已在（trace 4 工具 + events.jsonl 审计 + notepad），知识出口已在（remember）；分工 = remember 盘点知识去处、self-improve 自治改码（无审批门）、refit 盘点环境摩擦并落修复承载面（确定性检查/转向/工具/信息获取四分类，用户审批门禁）——该回顾工作流本身无对应资产 |
| 8 | tdd | `skills/tdd/`（v5.6.0） | ⚠️部分 | 诚实评估：omd 承载 = 仅 `omd-agent-test-engineer` 角色卡 TDD 纪律段（RED/GREEN/REFACTOR + TDD_Enforcement，双语在案）；`lib/keywords.js` 零 tdd 键——omd 无关键词注入（与 OMC 全局指令块的 "tdd"→TDD 触发不同源）；上游「预同意接缝表 + 接缝边界类替换」的 test-first 纪律无独立资产承载——缺口形态 = 独立 skill，非关键词 |
| 9 | session-flow | `skills/session-flow/`（v5.7.0，#4319） | ❌未做 | notepad 三区 / wiki 会话边界清单提供记忆承载；「会话重定向证据地图（目标/转向/产出/当前步/未决决策）」工作流无对应资产 |
| 10 | HUD effort level | OMC CHANGELOG v5.7.0 feat(hud) #4249 | ❌未做 | omd HUD 数据面（state_get_status + notepad_stats）无 effort 字段；dsh 宿主 effort 数据缝未核实（**待核**）——核实前不立项 |
| 11 | GLOSSARY 一致性（CONTEXT.md→GLOSSARY.md 改名跟进） | OMC CHANGELOG v5.7.0 #4273 | ❌未做 | 实测 omd 移植船坞资产 66 处 `CONTEXT.md` 引用（drydock / launch / ask-navigator / agent-doc-discipline 双语）未跟进改名；omd 资产自洽、仅为上游词汇对齐漂移——低优先，一次机械改名可收口，留共识流程批准 |

小计：⚠️部分 4（#1/#3/#7/#8）+ ❌未做 7（#2/#4/#5/#6/#9/#10/#11）= 11；无 ✅ / 🚫。移植裁决（做哪几个、按什么顺序）超出重基线权限，留 U7 后续轮或独立共识流程。

## 重基线遗留输入

- 11 项评估的移植裁决 → U7 后续轮或独立共识流程。
- HUD effort level 前置核实（dsh 宿主 effort 数据缝是否存在）→ 待核项。
- GLOSSARY 机械改名（66 处引用）→ 低优先待批准项。
- U10（tiers 默认值改为 inherit 的行为变更）已在 ec96619 落地、随 0.4.5 发版，#16/#17 证据行经落地核对无需随行改写（机制面未变）；dsh 0.2.0 stable 二次复评仍待触发（见 upgrade-tracking 轮 15 推进序）。

---

# v0.4.0 复审存档（2026-09，基线 OMC v5.4.0 / OMX 0.21.5）

> 以下为 v0.4.0 时点全量复审原文（历史证据，不回写；其 #9「OMC 38」、体量行 44 skills / 49 MCP / 251 tests 等数字已经「S1 勘误落实」更正，以本文件上方权威段为准）。

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
| 38 | 多网关通知 | 🚫 **(❌→🚫)** | 决定记录 R-7 | dsh 无会话事件通知面；替代路径结论保留于本行（原 `configure-notifications` skill 已于 v0.4.1 经用户批准移除） |

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
  - **复评完成（2026-10-12，宿主 0.1.7-rc.1 → 0.2.0-rc.2 大版本升级触发）：结论维持。** 探测证据：①两版宿主全包拦截面（waterfall/serial/intercept emit 字面量扫描）逐包对比——agent-loop（agent/pre-step、agent/request、agent/request-error、agent/turn-stopping）、tool-fs 与 str-replace-editor（fs/write-intent、fs/edit-intent）、user-questions/request、compaction/summary-error、session-telemetry/record、workspace/session-activity、connection/request 在 0.1.7-rc.1 与 0.2.0-rc.2 **完全一致，零新增**；②agent/pre-step 仍在 dsh-agent-loop/lib/index.js 经 `dispatch.waterfall` 派发（0.2.0-rc.2 行 911）；③omd ctx.on('agent/pre-step') 在 0.2.0-rc.2 注册成功（插件加载未抛错，lib/hook.js:151 契约反证）。勘误补记：原结论「仅 agent/pre-step 一个拦截点」措辞偏窄——上述 waterfall/serial 面在 0.1.7 即存在，但它们均为特定领域缝（fs 写入意图/提问请求/压缩错误等），不构成 OMC hook 矩阵所需的通用 session-start/session-end/通用 PreToolUse 面；fs/write-intent 与 agent/turn-stopping 是未来候选缝，记入 U7 重基线评估输入。R-3/R-4/R-7 复评触发条件（挂 R-2 解除）不点燃。证据台账：.omd/plans/dsh-02-compat-evidence.md。
- **R-3 项目记忆 hook 自动沉淀 → 显式检查点替代。** 理由：OMC 的 learner 依赖 session-end hook（R-2 同面缺失）。替代实装：autopilot/ralph SKILL 的「收尾沉淀检查点」（完成前显式把耐久事实 → `omd_memory_set`、可复利知识 → wiki/notepad；无沉淀项须显式声明）。复评触发：R-2 解除。
- **R-4 wiki session hook → 会话边界清单替代。** 理由同 R-2/R-3。替代实装：wiki SKILL「会话边界清单」（session-start 挂载三步骤 + 落盘三步骤，模型驱动）。复评触发：R-2 解除。
- **R-5 OMX ultraqa / worker → 🚫 不移植。** 理由：ultraqa 在 OMC v5.0 已退役（双源均不应复活）；worker 协议已并入 omd team skill 的 Worker 协议段（逐字注入契约在案）。
- **R-6 OMX team-executor / team-orchestrator → 🚫 不移植。** 理由：二者绑定 OMX team 运行时（mailbox CLI/tmux 形态）；其职责由 omd team 运行时的阶段角色路由（team SKILL 表）+ lib/team.js registry 覆盖。复评触发：omd team 运行时出现这两卡覆盖不了的编排角色缺口。
- **R-7 多网关通知 → 🚫 不做。** 理由：通知器依赖会话事件 hook（session-end/idle），宿主无此面（R-2）；替代路径结论原记录于 `configure-notifications` skill（v0.4.1 移除，见 #38）——dsh 下最接近的替代路径。复评触发：R-2 解除或宿主提供通知缝。
- **R-8 VSCode 扩展 → 🚫 不做。** 理由：OMX 的 VSCode 扩展是其宿主 GUI；dsh 的对应物是 dsh Web GUI（omd v0.4 已向其交付 HUD 面板 client half），再写 VSCode 扩展是双倍维护面。复评触发：用户出现 VSCode 内使用 dsh 的明确需求。

## v0.3.0 初审发现闭环

- **D-1（工具面不一致）→ 已修复。** 仓库 `notepad.mjs` 补齐 `notepad_write_manual` / `notepad_prune` 注册（6 工具），与在线挂载面对齐；+3 测试。
- **D-2（README 失实）→ 已修复。** 徽章/正文测试数、MCP 工具数、notepad 区数全部改为实测值并随 v0.4 再更新（见 README；omd-doctor 注册计数表同步 44/33/2/4/49）。
- **D-3（❌ 行隐含决定缺失）→ 已消除。** 11 个 ❌ 全部处置：8 建成（✅）+ 3 转 🚫 决定记录（R-1/R-2/R-7）+ VSCode（R-8）；另补 R-5/R-6 两条移植去重决定。

## 口径说明（v0.3.0 初审存档）

- 「✅ 替代实装」计入已完成：OMC/OMX 用 hook/CLI 实现、omd 用 dsh 宿主原生机制（goal/ralph/subagent/webServer/client bundle）等价承载的能力。
- reference/ 为本地快照，未追 npm 最新版漂移；OMC v5.0 退役项（ultrawork/swarm/pipeline 等）不计入差异。
- v0.4 全部状态迁移附文件/测试证据指针；测试基线 30 文件 251 tests 全过（`npx vitest run`）。


---

# v0.4.1 复验节（dsh 0.1.7-rc.1，2026-09-24）

> 触发：dsh 0.1.5→0.1.7-rc.1 升级适配（docs/dsh-017-adapt-audit.md）；复验环境 = 终版 0.4.1 tarball（SHA256 5C27E091DB1F4A3BF28BD25EF4C4D92CE92706BEED673E29C464B43195D0F024（终版，含 e65e963 扫描面修复））安装于 profile omd-verify，headless 实测通过（PING/SUBAGENT/DELEGATE/MCP/DOCTOR 五冒烟）。
> 方法：45 点逐点复验，四批次并行回收证据（子代理分派即通道活体证据）；主会话裁决与登记。
> 全局证据：npm test **270/270**（终版候选实测；含复验期新增 2 个回归）；OMD-DOCTOR-PASS（11 项 probe 0 失败）。
> 口径声明：受 autopilot 模式互斥硬约束，ralph/team 全流程 E2E 不能在本自治会话内真实拉起——该两点以测试矩阵+接线探针为证据并如实标注"E2E 待会话外人工门禁"；其余各点均为新鲜命令/文件行证据。

## 逐点复验



### 复验环境与全局证据
- 宿主 dsh 0.1.7-rc.1 ｜ omd 0.4.1 tarball（SHA256 5C27E091DB1F4A3BF28BD25EF4C4D92CE92706BEED673E29C464B43195D0F024）安装于 profile omd-verify
- 全量测试 **270/270**（34 文件；含本次复验期新增 2 个回归）｜ OMD-DOCTOR-PASS（probe 11 项 0 失败）
- 真实会话冒烟：subagent 派发（SMOKE-OK/DISPATCH-SUBAGENT-OK）、omd_delegate 硬路由（DELEGATE-OK，routing 日志 final=low 无钳制无 fallback）、MCP state_list_active 实调、SCANFIX-V2-OK
- 口径声明：受 autopilot 模式互斥硬约束，ralph/team 全流程 E2E 未在本自治会话内拉起（会话外人工门禁），该两点以测试矩阵+接线证据判定；概览"45"为 v0.4.0 口径（含 3 项并入决定记录），台账正文实为 42 行，本次全量覆盖

| # | 功能点 | 复验裁决 | 证据（摘要） |
|---|---|---|---|
| 1 | autopilot | ✅ PASS | goal-4b32f166 活证（本复验即其续跑轮派发）；autopilot-state.json 在案 |
| 2 | ralph | ✅ PASS* | 双语 SKILL+prd_4 工具+prd.test 8 ✓（*E2E 受模式互斥约束） |
| 3 | ultragoal | ✅ PASS | 双语 SKILL 在，frontmatter 断言覆盖 |
| 4 | team 五阶段 | ✅ PASS | TEAM_PHASES 五态机+16 team_* 工具+team 测试 31 全绿 |
| 5 | deep-interview | ✅ PASS | config.js deepInterview{0.2/20/10}+双语 SKILL |
| 6 | ralplan | ✅ PASS | SKILL+keywords anchored+ralplan-state.json 交接实痕 |
| 7 | autoresearch | ✅ PASS | 双语 SKILL 在 |
| 8 | cancel+退役词拦截 | ✅ PASS | keywords cancel 独占+RETIRED 四词+hook.test 25 ✓（并现场捕获扫描面误触发缺陷→e65e963 修复） |
| 9 | 42 技能资产移植 | ✅ PASS | fs 实数 42 目录；skills.test 4 ✓ |
| 10 | 双语资产 | ✅ PASS | 双语齐全断言+抽查 13 目录 |
| 11 | OMX 独有 4 skill | ✅ PASS | 四目录实体内容+frontmatter 正常 |
| 12 | visual-verdict | ✅ PASS | SKILL 含严格 JSON 裁决样例 |
| 13 | 33 角色卡双语 | ✅ PASS | assets/agents 66 文件；agents.test ✓ |
| 14 | OMX 扩展角色 14 | ✅ PASS | 名册 L23-28 恰 14 张 |
| 15 | 三档路由+roleOverrides | ✅ PASS | config.js resolveModel；config.test 7 ✓ |
| 16 | c3 自适应路由 | ✅ PASS | routing.js 全链；routing.test 9 ✓ |
| 17 | omd_delegate 硬路由 | ✅ PASS | delegate.test 17 ✓+真实冒烟 DELEGATE-OK |
| 18 | state_*×5 | ✅ PASS | state.mjs 注册恰 5；state.test 8 ✓ |
| 19 | notepad_*×6 | ✅ PASS | 注册恰 6；notepad.test 11 ✓ |
| 20 | 跨会话项目记忆 | ✅ PASS | memory.js 三工具+memory.test 7 ✓ |
| 21 | prd_*×4 | ✅ PASS | 注册恰 4；prd.test 8 ✓ |
| 22 | handoff_*×3 | ✅ PASS | 注册恰 3；handoff.test 4 ✓ |
| 23 | wiki 知识库 | ✅ PASS | 双语 SKILL 在 |
| 24 | trace 时间线 | ✅ PASS | 注册恰 4；trace.test 13 ✓ |
| 25 | 代码智能 MCP | ✅ PASS | ast_grep+lsp 面；codeintel.test 13 ✓ |
| 26 | 会话历史搜索 | 🚫 PASS | R-1 决定记录在案（L66/L116） |
| 27 | keyword hook（c2） | ✅ PASS | 269→270 全绿含 v4 回归+扫描面回归；本会话/verify 会话注入实测 |
| 28 | 其余 hook 面 | 🚫 PASS | R-2 决定记录在案（L73/L117） |
| 29 | boulder 持久续跑 | ✅ PASS | goal 续跑轮活证（本节即产物） |
| 30 | 领队运行时 | ✅ PASS | team.js 五阶段机+mailbox 容错+heartbeat 托管；team.test 22 ✓ |
| 31 | tmux pane | 🚫 PASS | 行 31 舍弃记录在案 |
| 32 | UUID/owner-epoch 生命周期 | ✅ PASS | workerId 格式+终态不可复活断言 |
| 33 | c5 worktree 隔离 | ✅ PASS | begin/dispose 两阶段+孤儿扫描；worktree.test 10 ✓ |
| 34 | c6 run-state CAS | ✅ PASS | 七字段契约+expectUpdatedAt 重试；runstate.test 10 ✓ |
| 35 | c8 多仓锚定 | ✅ PASS | 树内豁免+懒建+检疫区；multirepo.test 7 ✓ |
| 36 | HUD 五要素卡 | ✅ PASS | hud.mjs renderCard+hud_render/summary；hud.test ✓ |
| 37 | 右栏持续渲染 | ✅ PASS | client.js 5s 轮询+hud-route exact；client-bundle(5)+hud-route(3) ✓ |
| 38 | 多网关通知 | 🚫 PASS | R-7 在案（L93/L122，configure-notifications 移除标注已同步） |
| 39 | CLI 入口 | 🚫 PASS | 无 bin 字段；维持决定 |
| 40 | Marketplace | 🚫 PASS | 维持决定 |
| 41 | inventory | 🚫 PASS | 维持决定 |
| 42 | VSCode 扩展 | 🚫 PASS | R-8 在案（L102/L123） |

### 复验期发现与处置
| 发现 | 处置 |
|---|---|
| keyword hook 扫描面误触发（子代理回报含触发词证据 → 误预写模式状态，实测两起） | **已修复**（e65e963）：消息级 source.kind==='user' 严格白名单+回归测试；终局活体冒烟 SCANFIX-V2-OK（同类场景预写 2→1，残存 1 次为人类任务自身设计内确定性命中） |
| README/技能文档计数漂移（44→42、251→269、宿主版本行） | **已同步**（47b5050/15525ee/e65e963） |
| A4 清单"team 12 测试"为旧数（实际 31） | 台账以实测为准，已更正 |

