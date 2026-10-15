# omd 全维度审查框架（16 维登记权威）

> 地位：本文档是 16 维（D1-D16）的**登记权威**（应然面）；映射闭包的**机器权威**是 `scripts/audit-dimension-closure.mjs` 的 MAP 表（实然枚举）——本文 §6 映射表键集须与脚本 MAP 键集**逐字一致**，由 `tests/docs/dimension-chain.test.js` L1e 互断断言兜底（防双源漂移）。
> 链路面：问题生命周期台账 = `.omd/plans/upgrade-tracking.md`「## 全维度问题链台账（IC）」节（五段表 + 排序表 + 上游观察节）。
> 对照面：45 点逐行重评权威段 = `docs/feature-parity-audit.md`「# v0.4.4 重基线（2026-10） › ## 45 点逐行重评」；节锚一律带父节路径，**禁指存档段、禁行号引用**。
> 来源：`.omd/plans/ralplan-full-dimension-issue-chain.md` S1（同计划 S2 落闭包脚本）。

## §1 逐维登记 schema（八字段）

每维按下列八字段登记，缺一即不合格（AC1①）：

| 字段 | 含义 |
|---|---|
| id | D1-D16 |
| name | 维度名 |
| 类别 | `upstream-gap`（与上游 45 点对照的差距维）\| `omd-quality`（omd 自有承载面质量维，无 45 点对照） |
| 定义 | 维度覆盖的能力域边界 |
| 判定标准 | 「本维健康」的可判条件 |
| 发现手段 | `diff`（名册/文本机械比对）\| `probe`（行为实测）\| `manual`（契约人工比对），登记具体命令或比对面 |
| 对照面锚点 | 45 点组节锚（带父节路径）+ omd 承载面路径 |
| 登记格式 | 指向 upgrade-tracking IC 表列：\`\| ID \| 维度 \| 项 \| 发现 \| 诊断 \| 共识 \| 执行 \| 守门 \| 定档 \|\`（本维发现以「维度=Dn」成行入 IC 表） |

## §2 逐维登记（D1-D16）

### D1 执行模式

| 字段 | 内容 |
|---|---|
| id | D1 |
| name | 执行模式 |
| 类别 | upstream-gap |
| 定义 | autopilot / ralph / ultragoal / team / deep-interview / ralplan / autoresearch / cancel 八模式的生命周期面与上游对齐度（含退役词拦截） |
| 判定标准 | 45 点 A 组 #1-8 各行状态与 omd 资产、dsh 原生 goal/ralph 续跑接线证据一致；🚫 行复评触发条件在位 |
| 发现手段 | diff：`node scripts/audit-upstream-forms.mjs` 上游 counts.skills 名册 vs `git ls-files assets/skills` 执行模式 8 目录；A 组表逐行比对 |
| 对照面锚点 | `## 45 点逐行重评 › ### A. 执行模式（8）` + `assets/skills/{autopilot,ralph,ultragoal,team,deep-interview,ralplan,autoresearch,cancel}/` + `lib/keywords.js` |
| 登记格式 | IC 表行 `维度=D1`，列 schema 见 §1 |

### D2 技能资产

| 字段 | 内容 |
|---|---|
| id | D2 |
| name | 技能资产 |
| 类别 | upstream-gap |
| 定义 | OMC/OMX skill 资产移植面（42 目录双语）与上游 48 名册的漂移监控 |
| 判定标准 | 45 点 B 组 #9-12 各行状态与 `assets/skills/` 实测目录集一致；上游新增 skill 逐项有评估记录 |
| 发现手段 | diff：`node scripts/audit-upstream-forms.mjs` counts.skills 双仓枚举 vs `assets/skills/` 目录差集；`tests/assets/skills.test.js` 名册断言 |
| 对照面锚点 | `## 45 点逐行重评 › ### B. 技能资产（4）` + `assets/skills/` + `lib/skills.js` |
| 登记格式 | IC 表行 `维度=D2`，列 schema 见 §1 |

### D3 角色卡与路由

| 字段 | 内容 |
|---|---|
| id | D3 |
| name | 角色卡与路由 |
| 类别 | upstream-gap |
| 定义 | 33 角色（OMC 19 + OMX 扩编 14）双语角色卡名册与三档模型路由 / roleOverrides / 档位 overlay 资产 |
| 判定标准 | 45 点 C 组 #13-17 各行状态与 `assets/agents/` 66 文件（33×2 双语对）名册一致；tier 映射断言在案 |
| 发现手段 | diff：上游 agents 19 名册 vs `git ls-files assets/agents` 双语对差集；`tests/assets/agents.test.js` 全量名册断言 |
| 对照面锚点 | `## 45 点逐行重评 › ### C. 角色卡与模型路由（5）` + `assets/agents/` + `assets/overlays/` |
| 登记格式 | IC 表行 `维度=D3`，列 schema 见 §1 |

### D4 状态 / 记忆 / 数据面（含 memory 复核）

| 字段 | 内容 |
|---|---|
| id | D4 |
| name | 状态 / 记忆 / 数据面 |
| 类别 | upstream-gap |
| 定义 | state 之外的 notepad / memory / prd / handoff / trace / codeintel 数据面工具集与跨会话项目记忆；**含 memory 维复核（AC7）**：`lib/memory.js` ↔ 宿主 omd_memory_* 工具契约比对 |
| 判定标准 | 45 点 D 组 #18-26 各行状态与对应 MCP 工具文件 `registerTool(` 枚举数一致；memory 复核结论落本维登记 |
| 发现手段 | manual（主）：MCP 工具契约人工比对（memory 复核 = AC7）；辅 diff：`registerTool(` 逐文件计数 vs 45 点 D 组证据行 |
| 对照面锚点 | `## 45 点逐行重评 › ### D. 状态 / 记忆 / 数据面（9）` + `mcp-server/tools/{notepad,prd,handoff,trace,codeintel}.mjs` + `lib/memory.js` + `assets/templates/` |
| 登记格式 | IC 表行 `维度=D4`，列 schema 见 §1 |

### D5 Hook 矩阵

| 字段 | 内容 |
|---|---|
| id | D5 |
| name | Hook 矩阵 |
| 类别 | upstream-gap |
| 定义 | c2 keyword-hook 单电线（agent/pre-step）与上游 30 条 hook 注册的覆盖差距；R-2 复评面 |
| 判定标准 | 45 点 E 组 #27-29 各行状态与 `lib/hook.js` 白名单回归证据一致；上游 hooks 增量全部落 dsh 无注册面事件时 R-2 维持 |
| 发现手段 | probe：发一条含触发词的 prompt 实发观察（MAGIC KEYWORD 注入块 + state_write 激活）；`lib/keywords.js` 路由表 diff |
| 对照面锚点 | `## 45 点逐行重评 › ### E. Hook 矩阵（3）` + `lib/hook.js` + `lib/keywords.js` |
| 登记格式 | IC 表行 `维度=D5`，列 schema 见 §1 |

### D6 Team 运行时

| 字段 | 内容 |
|---|---|
| id | D6 |
| name | Team 运行时 |
| 类别 | upstream-gap |
| 定义 | 领队运行时（阶段状态机 fix≤3 / mailbox / heartbeat 扫描 / merge 计划）+ 16 个 team_* MCP 工具 + UUID 生命周期 |
| 判定标准 | 45 点 F 组 #30-35 各行状态与 `lib/team.js` 行为面、`tests/lib/team.test.js` 状态迁移矩阵一致 |
| 发现手段 | probe：team_begin / mail / heartbeat / dispose 行为面按既有测试矩阵对照实测 |
| 对照面锚点 | `## 45 点逐行重评 › ### F. Team 运行时（6）` + `lib/team.js` + `lib/heartbeat.js` + `mcp-server/tools/team.mjs` |
| 登记格式 | IC 表行 `维度=D6`，列 schema 见 §1 |

### D7 HUD 与通知

| 字段 | 内容 |
|---|---|
| id | D7 |
| name | HUD 与通知 |
| 类别 | upstream-gap |
| 定义 | c4 HUD 五要素卡（server 面 hud_render/hud_summary + client 右栏面板 + hud.json 数据路由）与通知面（R-7 分歧记录） |
| 判定标准 | 45 点 G 组 #36-38 各行状态与 HUD 渲染实测一致；上游 HUD 增量（如 effort level）有评估记录 |
| 发现手段 | probe：`mcp__omd-state__hud_render` / `mcp__omd-state__hud_summary` 实调 + `/oh-my-dsh/hud.json` 路由实测 |
| 对照面锚点 | `## 45 点逐行重评 › ### G. HUD 与通知（3）` + `mcp-server/tools/hud.mjs` + `lib/hud.js` + `lib/hud-route.js` + `lib/client.js` |
| 登记格式 | IC 表行 `维度=D7`，列 schema 见 §1 |

### D8 CLI 与分发

| 字段 | 内容 |
|---|---|
| id | D8 |
| name | CLI 与分发 |
| 类别 | upstream-gap |
| 定义 | CLI 入口 / marketplace / inventory / VSCode 扩展四面（全 🚫 档）与 omd 分发包边界（package.json 无 bin、.gitignore/.gitattributes 分发语义、斜杠命令面） |
| 判定标准 | 45 点 H 组 #39-42 各行维持 🚫 且判据文本与 package.json 实测一致；🚫 行复评触发条件未点燃 |
| 发现手段 | diff：`package.json` bin 字段 absence 实测 + 上游 bridge/cli.cjs、.claude-plugin/plugin.json、inventory、packages/vscode-extension 面比对 |
| 对照面锚点 | `## 45 点逐行重评 › ### H. CLI 与分发（4）` + `package.json` + `lib/commands.js` + `.gitignore` / `.gitattributes` / `LICENSE` |
| 登记格式 | IC 表行 `维度=D8`，列 schema 见 §1 |

### D9 跨进程 / 运行时核

| 字段 | 内容 |
|---|---|
| id | D9 |
| name | 跨进程 / 运行时核 |
| 类别 | upstream-gap |
| 定义 | lease_mutex 跨进程互斥 / 运行时核 sidecar / graph DAG（#45 已 ✅）三面；omd 侧以 expectUpdatedAt CAS 与 graph fence 为领域内等价物 |
| 判定标准 | 45 点 I 组 #43-45 各行状态与 `lib/runstate.js` CAS、`lib/graph/fence.js` 证据一致；🚫 行判据未点燃 |
| 发现手段 | probe：CAS 冲突重读与 graph fence 行为实测（跨进程场景按 `tests/lib/graph-e2e.test.js` 矩阵） |
| 对照面锚点 | `## 45 点逐行重评 › ### I. 跨进程 / Rust / 运行时核（3）` + `lib/runstate.js` + `lib/graph/fence.js` |
| 登记格式 | IC 表行 `维度=D9`，列 schema 见 §1 |

### D10 插件运行时与 cordis 集成

| 字段 | 内容 |
|---|---|
| id | D10 |
| name | 插件运行时与 cordis 集成 |
| 类别 | omd-quality |
| 定义 | dsh 插件入口装载、apply 返回契约（dispose 函数或 null/undefined，返回普通对象抛 Invalid effect 炸插件树）、Config 模型、能力探测四态矩阵、编排协议段装配 |
| 判定标准 | `lib/index.js` 为无返回值薄包装；`cordis.patch.yml` 补丁契约在位；probe 四态矩阵与 omd-doctor 冒烟一致 |
| 发现手段 | probe：`dsh web` 起服装载实测 + probe 报告四态核对；manual 辅：cordis apply 契约人工比对 |
| 对照面锚点 | `lib/index.js`（插件入口 + cordis apply 契约）+ `lib/runtime.js` + `lib/config.js` + `lib/probe.js` + `lib/protocol.js` + `cordis.patch.yml` |
| 登记格式 | IC 表行 `维度=D10`，列 schema 见 §1 |

### D11 MCP state 契约与多会话锚定

| 字段 | 内容 |
|---|---|
| id | D11 |
| name | MCP state 契约与多会话锚定 |
| 类别 | omd-quality |
| 定义 | state_* 五工具的 cwd/sessionId 锚定、所有权强制、expectUpdatedAt CAS、stale 检测；.omd 状态树锚定（含残留状态回收面） |
| 判定标准 | 多会话下 state_write/read/list_active/clear 语义与测试矩阵一致；.omd 锚定不越仓 |
| 发现手段 | probe：state_write → state_list_active → state_clear 多会话实测；残留状态场景复跑（访谈期 session-3249cea4 活样本位） |
| 对照面锚点 | `mcp-server/tools/state.mjs` + `.omd/` 锚定（stateDir 解析）+ `mcp-server/index.mjs`（根域白名单承载） |
| 登记格式 | IC 表行 `维度=D11`，列 schema 见 §1 |

### D12 委派路由 c1/c3

| 字段 | 内容 |
|---|---|
| id | D12 |
| name | 委派路由 c1/c3 |
| 类别 | omd-quality |
| 定义 | omd_delegate 硬路由（tier/model 经 spawn 强制生效、表上限钳制只降不升）+ c3 自适应路由四特征评估 + 每次派发恰一条 route 事件落盘 |
| 判定标准 | 派发档位桶与 events.jsonl 1:1；35 角色 × 81 组合钳制抽样断言绿；fallback 审计入 run-state |
| 发现手段 | probe：omd_delegate 实派一次，核对 `lib/events.js` recordRouteEvent 恰一条 + 档位钳制结果 |
| 对照面锚点 | `lib/delegate.js` + `lib/routing.js` + `lib/events.js` |
| 登记格式 | IC 表行 `维度=D12`，列 schema 见 §1 |

### D13 worktree c5/c6/c8

| 字段 | 内容 |
|---|---|
| id | D13 |
| name | worktree c5/c6/c8 |
| 类别 | omd-quality |
| 定义 | c5 team worktree 隔离（孤儿扫描 + 两阶段拆除 CAS）/ c6 run-state 七字段镜像（队长独占写）/ c8 多仓锚定（树内懒建 + 豁免向上 marker） |
| 判定标准 | team_begin/dispose 两阶段次序（先 CAS 终态后删树）与测试矩阵一致；孤儿绝不自动删 |
| 发现手段 | probe：team_begin → 注入崩溃场景 → scan_orphans → dispose 全链路实测 |
| 对照面锚点 | `lib/worktree.js` + `lib/runstate.js` + `lib/multirepo.js` |
| 登记格式 | IC 表行 `维度=D13`，列 schema 见 §1 |

### D14 graph DAG 运行时

| 字段 | 内容 |
|---|---|
| id | D14 |
| name | graph DAG 运行时 |
| 类别 | omd-quality |
| 定义 | U4 一期确定性运行时：`lib/graph/` 7 模块 + graph_* 6 工具 + bin/graph-runner.mjs 双入口同 descriptor_hash + 扁平 journal 崩溃恢复 |
| 判定标准 | `tests/lib/graph-e2e.test.js` 七组真实跨进程全绿；descriptor_hash 双入口一致 |
| 发现手段 | probe：graph_validate / run / resume / gate_resolve 实测 + e2e 矩阵复跑 |
| 对照面锚点 | `lib/graph/` + `mcp-server/tools/graph.mjs` + `bin/graph-runner.mjs` |
| 登记格式 | IC 表行 `维度=D14`，列 schema 见 §1 |

### D15 测试与发布门禁

| 字段 | 内容 |
|---|---|
| id | D15 |
| name | 测试与发布门禁 |
| 类别 | omd-quality |
| 定义 | tests/ 套件健康（44 文件 / 523 tests 口径随版本刷新）+ package.json prepublishOnly 门禁链 + vitest 配置 + 依赖锁定 |
| 判定标准 | `npm test` 全绿；prepublishOnly 链完整（测试 → 构建 → 打包门禁次序）；peer range 断言在案 |
| 发现手段 | manual（主）：prepublishOnly 门禁链逐步核对；辅 probe：`npm test` 全量复跑 |
| 对照面锚点 | `tests/` + `package.json`（prepublishOnly）+ `vitest.config.js` + `package-lock.json` |
| 登记格式 | IC 表行 `维度=D15`，列 schema 见 §1 |

### D16 文档 / 计数一致性

| 字段 | 内容 |
|---|---|
| id | D16 |
| name | 文档 / 计数一致性 |
| 类别 | omd-quality |
| 定义 | README / docs/ 台账（本框架、45 点重评、两形态卡、适配审查）与实测计数的一致面；omd-doctor 计数面；两审计脚本取数口径 |
| 判定标准 | 文档数字与 `node scripts/audit-upstream-forms.mjs` / `node scripts/audit-dimension-closure.mjs` 权威 JSON 输出一致；徽章计数无漂移 |
| 发现手段 | manual（主）：文档逐数字 vs 脚本输出比对；辅 diff：两审计脚本输出差集 |
| 对照面锚点 | `README.md` + `assets/skills/omd-doctor/`（计数面）+ `scripts/audit-upstream-forms.mjs` + `scripts/audit-dimension-closure.mjs` + `docs/` |
| 登记格式 | IC 表行 `维度=D16`，列 schema 见 §1 |

## §3 16 维 ↔ A-I 组映射总表（45 点全覆盖）

| 维度 | 类别 | 45 点组锚（父节路径） | 覆盖点号 | omd 承载面 |
|---|---|---|---|---|
| D1 | upstream-gap | `## 45 点逐行重评 › ### A. 执行模式（8）` | A #1-8 | assets/skills 执行模式 8 目录 + lib/keywords.js |
| D2 | upstream-gap | `## 45 点逐行重评 › ### B. 技能资产（4）` | B #9-12 | assets/skills/ + lib/skills.js |
| D3 | upstream-gap | `## 45 点逐行重评 › ### C. 角色卡与模型路由（5）` | C #13-17 | assets/agents/ + assets/overlays/ |
| D4 | upstream-gap | `## 45 点逐行重评 › ### D. 状态 / 记忆 / 数据面（9）` | D #18-26 | mcp-server/tools 数据面 5 文件 + lib/memory.js + assets/templates/ |
| D5 | upstream-gap | `## 45 点逐行重评 › ### E. Hook 矩阵（3）` | E #27-29 | lib/hook.js + lib/keywords.js |
| D6 | upstream-gap | `## 45 点逐行重评 › ### F. Team 运行时（6）` | F #30-35 | lib/team.js + lib/heartbeat.js + mcp-server/tools/team.mjs |
| D7 | upstream-gap | `## 45 点逐行重评 › ### G. HUD 与通知（3）` | G #36-38 | mcp-server/tools/hud.mjs + lib/hud.js + lib/hud-route.js + lib/client.js |
| D8 | upstream-gap | `## 45 点逐行重评 › ### H. CLI 与分发（4）` | H #39-42 | package.json + lib/commands.js + 分发三件套 |
| D9 | upstream-gap | `## 45 点逐行重评 › ### I. 跨进程 / Rust / 运行时核（3）` | I #43-45 | lib/runstate.js + lib/graph/fence.js |
| D10 | omd-quality | —（omd 自有质量维，无 45 点对照） | — | lib/index.js + cordis.patch.yml + lib/{runtime,config,probe,protocol}.js |
| D11 | omd-quality | — | — | mcp-server/tools/state.mjs + .omd/ 锚定 |
| D12 | omd-quality | — | — | lib/delegate.js + lib/routing.js + lib/events.js |
| D13 | omd-quality | — | — | lib/worktree.js + lib/runstate.js + lib/multirepo.js |
| D14 | omd-quality | — | — | lib/graph/ + mcp-server/tools/graph.mjs + bin/graph-runner.mjs |
| D15 | omd-quality | — | — | tests/ + package.json prepublishOnly + vitest.config.js |
| D16 | omd-quality | — | — | README.md + omd-doctor 计数面 + scripts/ 两审计脚本 + docs/ |

覆盖校验：A 8 + B 4 + C 5 + D 9 + E 3 + F 6 + G 3 + H 4 + I 3 = **45 点全映射，无一点遗漏**；D10-D16 为 omd 自有承载面质量维，不占 45 点基数。

## §4 发现手段 - 维度配比表

| 发现手段 | 维度 | 计数 | 对应发现批次（计划 §3 问题 5） |
|---|---|---|---|
| diff（名册/文本机械比对） | D1 / D2 / D3 / D8 | 4 | 批 1 机械 diff（explore 子代理） |
| probe（行为实测） | D5 / D6 / D7 / D9 / D10 / D11 / D12 / D13 / D14 | 9 | 批 2 行为 probe（主会话实测 + qa-tester） |
| manual（契约人工比对） | D4 / D15 / D16 | 3 | 批 3 契约比对（analyst 子代理；D4 含 memory 复核 = AC7） |

合计 4 + 9 + 3 = **16 维全配平，无沉默维**；每维每批至少产出「零发现」或「≥1 条 IC 行」的显式登记。

## §5 闭包算子声明

1. **零孤儿**：`scripts/audit-dimension-closure.mjs` 输出 `orphans.omd` 与 `orphans.ref` 两数组皆空；未命中任一映射规则的枚举条目即孤儿，红为预期摩擦（NTH2）。
2. **只顶层不进传递依赖**：枚举只取顶层（reference 两仓顶层目录 / omd 声明面顶层条目），**不可放宽为递归**——reference/awesome-fork 内存 Windows 非法文件名（尾部 `.`），递归遍历会炸（脚本头注释钉死同款声明）。reference 顶层枚举排除 `.git` 元目录（非用户/agent 可见能力面，不入闭包）。
3. **根域白名单（M-2）**：omd 侧枚举基 = `git ls-files`（git 内事实，结构性免疫未跟踪流浪文件；docs/会话.txt 属有意排除：未跟踪转录不回写）。顶层去重 ⊆ 白名单 15 项：`.gitattributes / .gitignore / assets / bin / cordis.patch.yml / docs / lib / LICENSE / mcp-server / package-lock.json / package.json / README.md / scripts / tests / vitest.config.js`；显式排除项 = `reference/`、`node_modules/`、`*.tgz`；`.omd` 特殊规则 = 允许且仅允许恰一条 `.omd/plans/upgrade-tracking.md`，其余 .omd 路径进 orphans。
4. **映射语义**：禁文件级 catch-all、允许目录级前缀（键以 `/` 结尾）；命中取维度并集（多维归属合法）。
5. **reference 面**：按名取两仓（oh-my-claudecode / oh-my-codex）顶层目录清单；任一缺席 → 该仓 ref 字段 null + stderr WARNING + exit 恒 0（两层门语义，fresh clone skip 属设计内行为）。`referenceTopLevel` = reference/ 全清单（实测当前恰 4 目录：awesome-dsh-plugin / awesome-fork / oh-my-claudecode / oh-my-codex），声明外目录出现 → stderr WARNING 告警不红（顶层漂移哨兵）。
6. **新增承载面协议**：新增顶层承载面 = ①改脚本 MAP（机器权威）+ ②本文 §6 映射表同步 + ③L1e 互断兜底（`tests/docs/dimension-chain.test.js` 断言两键集逐字一致）。三者缺一即红。
7. **会签**：本框架的维度全集与映射表经 architect + critic 会签（AC1④），档案落 `.omd/state/ralplan-reviews/dim-framework-{architect,critic}-r1.md`，双 SOUND/APPROVE 后方可进发现执行。

## §6 映射表（= 脚本 MAP 键集，逐字一致；L1e 互断对照面）

> 本表行集与 `scripts/audit-dimension-closure.mjs` 的 MAP 键集**逐字一致**（共 114 键）；脚本为机器权威，本表为人读面。改动协议见 §5-6。

| 映射键（前缀规则；以 `/` 结尾者为目录级前缀） | 维度 |
|---|---|
| `omd:root/.gitattributes` | D8 |
| `omd:root/.gitignore` | D8 |
| `omd:root/.omd` | D11 |
| `omd:root/LICENSE` | D8 |
| `omd:root/README.md` | D16 |
| `omd:root/assets` | D2 |
| `omd:root/bin` | D14 |
| `omd:root/cordis.patch.yml` | D10 |
| `omd:root/docs` | D16 |
| `omd:root/lib` | D10 |
| `omd:root/mcp-server` | D11 |
| `omd:root/package-lock.json` | D15 |
| `omd:root/package.json` | D15 |
| `omd:root/scripts` | D16 |
| `omd:root/tests` | D15 |
| `omd:root/vitest.config.js` | D15 |
| `omd:assets/agents/` | D3 |
| `omd:assets/overlays/` | D3 |
| `omd:assets/skills/` | D2 |
| `omd:assets/templates/` | D4 |
| `omd:lib/client.js` | D7 |
| `omd:lib/commands.js` | D8 |
| `omd:lib/config.js` | D10 |
| `omd:lib/delegate.js` | D12 |
| `omd:lib/events.js` | D12 |
| `omd:lib/graph/` | D14 |
| `omd:lib/heartbeat.js` | D6 |
| `omd:lib/hook.js` | D5 |
| `omd:lib/hud-route.js` | D7 |
| `omd:lib/hud.js` | D7 |
| `omd:lib/index.js` | D10 |
| `omd:lib/keywords.js` | D5 |
| `omd:lib/memory.js` | D4 |
| `omd:lib/multirepo.js` | D13 |
| `omd:lib/probe.js` | D10 |
| `omd:lib/protocol.js` | D10 |
| `omd:lib/routing.js` | D12 |
| `omd:lib/runstate.js` | D13 |
| `omd:lib/runtime.js` | D10 |
| `omd:lib/skills.js` | D2 |
| `omd:lib/team.js` | D6 |
| `omd:lib/worktree.js` | D13 |
| `omd:mcp-server/tools/codeintel.mjs` | D4 |
| `omd:mcp-server/tools/graph.mjs` | D14 |
| `omd:mcp-server/tools/handoff.mjs` | D4 |
| `omd:mcp-server/tools/hud.mjs` | D7 |
| `omd:mcp-server/tools/notepad.mjs` | D4 |
| `omd:mcp-server/tools/prd.mjs` | D4 |
| `omd:mcp-server/tools/state.mjs` | D11 |
| `omd:mcp-server/tools/team.mjs` | D6 |
| `omd:mcp-server/tools/trace.mjs` | D4 |
| `omd:tests/assets/` | D15 |
| `omd:tests/docs/` | D15 |
| `omd:tests/fixtures/` | D15 |
| `omd:tests/lib/` | D15 |
| `omd:tests/mcp-server/` | D15 |
| `omd:tests/package-peer-range.test.js` | D15 |
| `omd:tests/smoke.test.js` | D15 |
| `omd:docs/dimension-framework.md` | D16 |
| `omd:docs/dsh-017-adapt-audit.md` | D16 |
| `omd:docs/feature-parity-audit.md` | D16 |
| `omd:docs/upstream-form-omc.md` | D16 |
| `omd:docs/upstream-form-omx.md` | D16 |
| `omd:scripts/audit-dimension-closure.mjs` | D16 |
| `omd:scripts/audit-upstream-forms.mjs` | D16 |
| `omd:bin/graph-runner.mjs` | D14 |
| `ref:oh-my-claudecode/.claude-plugin` | D8 |
| `ref:oh-my-claudecode/.clawhip` | D11 |
| `ref:oh-my-claudecode/.github` | D15 |
| `ref:oh-my-claudecode/.omc` | D11 |
| `ref:oh-my-claudecode/.omx` | D11 |
| `ref:oh-my-claudecode/agents` | D3 |
| `ref:oh-my-claudecode/assets` | D2 |
| `ref:oh-my-claudecode/benchmark` | D15 |
| `ref:oh-my-claudecode/benchmarks` | D15 |
| `ref:oh-my-claudecode/bin` | D8 |
| `ref:oh-my-claudecode/bridge` | D6 / D8 |
| `ref:oh-my-claudecode/commands` | D8 |
| `ref:oh-my-claudecode/design-system` | D2 |
| `ref:oh-my-claudecode/dist` | D8 |
| `ref:oh-my-claudecode/docs` | D16 |
| `ref:oh-my-claudecode/examples` | D16 |
| `ref:oh-my-claudecode/generated` | D2 |
| `ref:oh-my-claudecode/geobench` | D15 |
| `ref:oh-my-claudecode/hooks` | D5 |
| `ref:oh-my-claudecode/inventory` | D8 |
| `ref:oh-my-claudecode/missions` | D4 |
| `ref:oh-my-claudecode/native` | D9 |
| `ref:oh-my-claudecode/receipts` | D4 |
| `ref:oh-my-claudecode/research` | D16 |
| `ref:oh-my-claudecode/scripts` | D15 |
| `ref:oh-my-claudecode/seminar` | D16 |
| `ref:oh-my-claudecode/shellmark` | D9 |
| `ref:oh-my-claudecode/skills` | D2 |
| `ref:oh-my-claudecode/src` | D9 |
| `ref:oh-my-claudecode/templates` | D2 |
| `ref:oh-my-claudecode/tests` | D15 |
| `ref:oh-my-codex/.agents` | D3 |
| `ref:oh-my-codex/.github` | D15 |
| `ref:oh-my-codex/.gjc` | D11 |
| `ref:oh-my-codex/artifacts` | D4 |
| `ref:oh-my-codex/crates` | D9 |
| `ref:oh-my-codex/docs` | D16 |
| `ref:oh-my-codex/geobench` | D15 |
| `ref:oh-my-codex/missions` | D4 |
| `ref:oh-my-codex/notes` | D16 |
| `ref:oh-my-codex/packages` | D8 |
| `ref:oh-my-codex/playground` | D15 |
| `ref:oh-my-codex/plugins` | D8 |
| `ref:oh-my-codex/prompts` | D2 |
| `ref:oh-my-codex/scripts` | D15 |
| `ref:oh-my-codex/skills` | D2 |
| `ref:oh-my-codex/src` | D9 |
| `ref:oh-my-codex/templates` | D2 |

## §7 会签记录位

| 角色 | 轮次 | 结论 | 档案 | 日期 |
|---|---|---|---|---|
| architect | R1 | （待签） | `.omd/state/ralplan-reviews/dim-framework-architect-r1.md` | — |
| critic | R1 | （待签） | `.omd/state/ralplan-reviews/dim-framework-critic-r1.md` | — |
