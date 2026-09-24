# oh-my-dsh (omd)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE) [![Node.js >=22.19.0](https://img.shields.io/badge/node-%3E%3E22.19.0-brightgreen)](https://nodejs.org/) [![Tests: 251 passed](https://img.shields.io/badge/tests-251%20passed-brightgreen)](./tests)

**DeepSeek Harness 的多智能体编排层** —— OMC / OMX 编排理念的 dsh 宿主适配实现。
Multi-agent orchestration layer for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), adapted from:

- [oh-my-claudecode (OMC)](https://github.com/Yeachan-Heo/oh-my-claudecode) — Claude Code 编排层
- [oh-my-codex (OMX)](https://github.com/Yeachan-Heo/oh-my-codex) — Codex 编排层

omd 以单个 dsh 插件交付：注入编排协议到系统提示词、注册 42 个 skill + 33 个 `omd-agent-*` 角色卡（共 75 个技能目录条目）与 2 个斜杠命令、挂载内置 MCP server 提供 49 个状态/记忆/协调/代码智能工具。三种执行模式（autopilot / ralph / team）：autopilot 与 ralph 由 dsh 原生 `goal` / `ralph` 工具驱动前台循环；team 由 `lib/team.js` 领队运行时驱动（阶段状态机 + 队员 UUID 生命周期 + mailbox + heartbeat + merge 计划，无 tmux——dsh 无承载面）。

---

## 安装 / Install

```bash
# 发布后（npm 包名 @sakura12/oh-my-deepseekharness）
dsh plugin --profile <name> add @sakura12/oh-my-deepseekharness

# 本地开发（指向本仓库路径；以你的检出路径替换）
dsh plugin --profile <profile> add /path/to/oh-my-deepseekharness
```

要求：Node.js ≥ 22.19，dsh 宿主 0.1.7-rc.1+（session format v4）。所有 `@deepseek-ai/*` 依赖均为宿主义务（peerDependencies，缺失自动降级，见下文「依赖边界」）。可选能力依赖（optionalDependencies，缺席显式降级不阻断）：`@ast-grep/napi`（ast_grep_* 工具）、`vscode-jsonrpc` / `vscode-languageserver-protocol` / `vscode-uri`（lsp_* 工具）。

验装：安装后在会话中输入 `/omd-doctor`。

---

## 快速上手 / Quick Start

三种执行模式，一句话启动：

| 模式 | 一句话示例 | 说明 |
|---|---|---|
| **autopilot** | `autopilot 帮我做一个 CLI 字数统计工具` | 自然语言触发，goal 驱动的全流程自动编排（访谈→规划→执行→双评审门→沉淀检查点） |
| **ralph** | `ralph: 把 README 的测试徽章数字同步到当前实际值` | 显式触发（`ralph:` 前缀），PRD + 证据契约的迭代循环，前台阻塞 |
| **team** | `用 team 调研插件市场生态并出报告` | 无关键词，只能显式调用；五阶段流水线 + 领队运行时（`team_phase_transition` 状态机 / `team_register_worker` 生命周期 / `team_mail_*` 信箱 / `team_heartbeat_scan` / `team_merge_plan`） |

取消与诊断：

| 操作 | 命令 |
|---|---|
| 取消当前模式 | 输入 `cancelomd`（或 `stopomd`），或斜杠命令 `/omd-cancel` |
| 验装诊断 | `/omd-doctor`（注册计数 / Config / MCP 冒烟 / `.omd` 可写性） |

> 退役关键词 `ultrawork` / `ulw` / `uw` / `ccg` 不再触发，命中时会提示改用 autopilot 或 team。

---

## 能力速览 / Capabilities

| 维度 | 内容 |
|---|---|
| 执行模式 | **3** 种：autopilot（goal 循环）/ ralph（PRD 迭代）/ team（五阶段流水线 + 领队运行时），模式互斥 + 触发守卫防误触发 |
| 角色 | **33** 个委派角色卡（`omd-agent-*`：OMC 19 + OMX 移植 14——api-reviewer / style-reviewer / performance-reviewer / quality-reviewer / quality-strategist / build-fixer / dependency-expert / information-architect / vision / product-analyst / product-manager / ux-researcher / researcher / explore-harness），各带档位（low 5 / medium 17 / high 11）与职责资产 |
| Skills | **42** 个（中英双语资产）：3 执行模式 + 规划 + 质量 + 研究 + 记忆 + 基础设施与元 + OMX 移植 4（analyze / best-practice-research / design / performance-goal） |
| MCP 工具 | **49** 个（内置 `omd-state` MCP server）：`state_*`×5 / `notepad_*`×6 / `prd_*`×4 / `handoff_*`×3 / `team_*`×16（c5/c6/c8 + 领队运行时）/ `trace_*`×4 / `hud_*`×2 / 代码智能×9（`ast_grep_*`×2 + `lsp_*`×7） |
| Team 运行时 | `lib/team.js`：阶段状态机（team-plan→prd→exec→verify→fix(≤3，状态机强制)→终态）/ 队员 registry（workerId=UUID，runId=owner-epoch，终态不可复活）/ mailbox（in=队员→队长 progress/blocker/done/question，out=队长→队员 nudge/assign/answer）/ heartbeat（`team_heartbeat_scan` 按需扫描 + 插件侧周期检测定时器——检测+呈面，催促归队长模型，绝不自动杀）/ merge 计划（树∩主仓冲突候选 + 建议序，执行归模型） |
| HUD | 三层承载：web GUI 右侧边栏 `omd-hud` 面板（client half，`lib/client.js`，5s 轮询五要素卡）/ 数据路由 `GET /oh-my-dsh/hud.json` / MCP `hud_render` `hud_summary`（CLI 会话同款摘要） |
| 代码智能 | `ast_grep_search` / `ast_grep_replace`（结构化语法检索/重写，$VAR/$$$VARS 元变量，dryRun 默认不落盘）；`lsp_start/stop/status/document_symbols/references/definition/diagnostics`（Config `codeIntel.lspServers` 注册表驱动，单实例/崩溃重启 ≤2/随 MCP server 退出回收） |
| Hook 与定时 | c2 keyword-hook（`agent/pre-step` 原生拦截点，唯一 hook 电线）+ team heartbeat 周期检测定时器（Config `team.heartbeatIntervalMs`，默认 60s，0=关闭） |
| 跨会话记忆 | `omd_memory_set/get/delete`（宿主 storage domain 承载）+ notepad 三区（priority 永久 / working 7 天 / MANUAL 永不清理）+ autopilot/ralph 收尾沉淀检查点（替代 OMC hook 自动 learner） |
| 路由 | c3 自适应路由（4 特征 + 表上限钳制 + fallback 审计）+ `omd_delegate` 硬路由工具（tier/model 经 spawn 路径强制生效） |

功能点对齐全景（OMC/OMX 45 功能点：✅34 / ⚠️1 / ❌0 / 🚫10 含决定记录）见 `docs/feature-parity-audit.md`。

---

## 配置 / Config

插件配置（cordis Config，schemastery 校验）：

| 键 | 类型 / 默认 | 说明 |
|---|---|---|
| `language` | `'zh' \| 'en' \| 'both'`，默认 `'zh'` | 资产语言：中文 / 英文 / 中文正文+英文术语 |
| `tiers.low` | 模型标识，默认 `glm-5.3-flash` | 档位→模型映射；值可为 `provider/model` 或 **`'inherit'`**（继承主会话模型） |
| `tiers.medium` | 同上，默认 `glm-5.3-flash` | 同上 |
| `tiers.high` | 同上，默认 `glm-5.3-flash` | 同上 |
| `roleOverrides` | `dict<string>`，默认 `{}` | 角色级覆盖，优先于 tiers，如 `{ "omd-agent-code-reviewer": "deepseek/deepseek-reasoner" }` |
| `stateDir` | 字符串，默认 `'.omd'` | 项目状态目录名 |
| `autopilot.maxIterations` | 自然数 ≥1，默认 `10` | autopilot 最大轮次（`create_goal` 的 max_goal_rounds 默认值） |
| `autopilot.maxQaCycles` | 自然数 ≥1，默认 `5` | QA 循环上限 |
| `autopilot.maxValidationRounds` | 自然数 ≥1，默认 `3` | re-validation 轮次上限 |
| `team.heartbeatIntervalMs` | 自然数，默认 `60000` | 插件侧 heartbeat 周期检测间隔（0=关闭定时器；`team_heartbeat_scan` 按需扫描仍可用） |
| `team.staleAfterMs` | 自然数 ≥1，默认 `300000` | 队员无心跳 stale 阈值 |
| `codeIntel.astGrep` | 布尔，默认 `true` | ast_grep_* 开关（`@ast-grep/napi` 缺席时工具显式报错） |
| `codeIntel.lspServers` | `dict`，默认 `{}` | LSP 注册表：`{ <name>: { command, args?, languages?, env? } }`——语言服务器本体由用户环境提供 |

配置示例：

```yaml
# cordis.patch.yml
oh-my-dsh:
  language: zh
  tiers:
    low: inherit          # 继承主会话
    high: deepseek-reasoner
  roleOverrides:
    omd-agent-verifier: deepseek/deepseek-reasoner
  autopilot:
    maxIterations: 15
  team:
    heartbeatIntervalMs: 60000
  codeIntel:
    lspServers:
      typescript:
        command: typescript-language-server
        args: ["--stdio"]
        languages: [typescript]
```

---

## 状态目录 / `.omd/` Layout

所有模式状态落在项目目录的 `.omd/`（可用 `stateDir` 改名），取消/崩溃后可恢复：

```
.omd/
├── state/
│   ├── sessions/<sessionId>/<mode>-state.json   # 每会话每模式状态（active/phase/iteration）
│   ├── run-state.json                           # c6 七字段镜像（CAS，队长独占写）
│   └── boulder.json                             # ralph 进度石
├── plans/          # autopilot/team 计划
├── specs/          # 规格文档
├── prd/            # ralph PRD（JSON + reconciliation.jsonl 台账）
├── handoffs/       # team 阶段交接（五段固定格式）
├── team/<runId>/   # team 运行时：phase.json / registry.json / mailbox/{in,out}/*.jsonl
├── trace/          # trace 时间线（<traceId>.jsonl，append-only）
├── worktrees/      # c5 team 运行树（gitignored，两阶段拆除）
├── graph-runs/     # graph 运行（descriptor.json + journal.jsonl + outputs/）
├── checkpoints/    # 恢复快照
├── logs/
├── wiki/           # LLM Wiki 知识库（index.md + log.md + 分类页）
└── notepad.md      # 三区记事本（Priority 永久 / Working 7 天过期 / MANUAL 永不清理）
```

> `.omd/` 是运行时产物，建议加入 `.gitignore`。

---

## 降级与依赖边界 / Graceful Degradation

- **零第三方 dsh 插件依赖**：不依赖任何非 `@deepseek-ai/*` 官方插件。
- 启动时 probe 探测能力（core / storage / mcpServer / hooksBridge / delegate / keywordHook / teamHeartbeat / hudRoute / codeIntel），结果渲染进系统提示词的能力矩阵，降级时协议指导模型走文件直读兜底：
  - 核心 inject 服务（tools/skills/systemPrompt/commands）缺失 → 插件启动即报错（唯一硬依赖）；
  - `storage` 缺失 → 记忆工具不注册；
  - MCP server 挂载失败 → `state_*`/`notepad_*`/`prd_*`/`handoff_*`/`team_*`/`trace_*`/`hud_*` 不可用，协议降级为直接读写 `.omd/` 文件；
  - `@ast-grep/napi` 缺失 → `ast_grep_*` 显式报错（probe 记 `codeIntel: unavailable`），LSP 不受影响；
  - `webServer` 缺席（CLI 会话）→ HUD 数据路由不注册（probe 记 `hudRoute: skipped`，MCP `hud_render` 同款可用）；
  - 运行 `/omd-doctor` 可随时查看当前降级状态。

---

## 开发 / Development

```bash
npm test            # vitest 全量（30 files / 251 tests）
npm run test:watch
```

`lib/client.js`（HUD client half）是**手工维护的懒加载 CJS bundle**（无构建步骤），格式经 `tests/lib/client-bundle.test.js` 沙箱断言；dsh web 宿主需重启以装载/更新 client 插件。

## License

MIT
