# oh-my-dsh (omd)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE) [![Node.js >=22.19.0](https://img.shields.io/badge/node-%3E%3D22.19.0-brightgreen)](https://nodejs.org/) [![Tests: 95 passed](https://img.shields.io/badge/tests-95%20passed-brightgreen)](./tests)

**DeepSeek Harness 的多智能体编排层** —— OMC / OMX 编排理念的 dsh 宿主适配实现。
Multi-agent orchestration layer for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), adapted from:

- [oh-my-claudecode (OMC)](https://github.com/Yeachan-Heo/oh-my-claudecode) — Claude Code 编排层
- [oh-my-codex (OMX)](https://github.com/Yeachan-Heo/oh-my-codex) — Codex 编排层

omd 以单个 dsh 插件交付：注入编排协议到系统提示词、注册 11 个 skill 与 2 个斜杠命令、挂载内置 MCP server 提供状态/记忆工具。三种执行模式（autopilot / ralph / team）覆盖从一句话需求到多智能体流水线的完整光谱。

---

## 安装 / Install

```bash
# 发布后（npm 包名 oh-my-dsh）
dsh plugin --profile <name> add oh-my-dsh

# 本地开发（指向本仓库路径）
dsh plugin --profile web add D:\omd
```

要求：Node.js ≥ 22.19，dsh 宿主 0.1.5-rc.1+。所有 `@deepseek-ai/*` 依赖均为宿主义务（peerDependencies，缺失自动降级，见下文「依赖边界」）。

验装：安装后在会话中输入 `/omd-doctor`。

---

## 快速上手 / Quick Start

三种执行模式，一句话启动：

| 模式 | 一句话示例 | 说明 |
|---|---|---|
| **autopilot** | `autopilot 帮我做一个 CLI 字数统计工具` | 自然语言触发，goal 驱动的全流程自动编排（访谈→规划→执行→双评审门） |
| **ralph** | `ralph: 给仓库加 LICENSE 和 README 徽章` | 显式触发（`ralph:` 前缀），PRD + 证据契约的迭代循环，前台阻塞 |
| **team** | `用 team 调研插件市场生态并出报告` | 无关键词，只能显式调用；多角色五阶段流水线（AgentTeams 承载） |

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
| 执行模式 | **3** 种：autopilot（goal 循环）/ ralph（PRD 迭代）/ team（AgentTeams 流水线），模式互斥 + 触发守卫防误触发 |
| 角色 | **7** 个委派角色：`omd-agent-explore` / `planner` / `analyst` / `executor` / `verifier` / `code-reviewer` / `designer`，各带档位（low/medium/high）与职责资产 |
| Skills | **11** 个：autopilot、ralph、team、ralplan、plan、execute、verify、review、deep-interview、cancel、omd-doctor（中英双语资产） |
| MCP 工具 | **18** 个（内置 `omd-state` MCP server）：`state_*`（模式状态，5）/ `notepad_*`（三区记事本，6）/ `prd_*`（需求台账，4）/ `handoff_*`（阶段交接，3） |
| 跨会话记忆 | `omd_memory_set` / `omd_memory_get` / `omd_memory_delete`（宿主 storage domain 承载，按项目哈希键隔离） |

---

## 配置 / Config

插件配置（cordis Config，schemastery 校验）：

| 键 | 类型 / 默认 | 说明 |
|---|---|---|
| `language` | `'zh' \| 'en' \| 'both'`，默认 `'zh'` | 资产语言：中文 / 英文 / 中文正文+英文术语 |
| `tiers.low` | 模型标识，默认 `deepseek-chat` | 档位→模型映射；值可为 `provider/model` 或 **`'inherit'`**（继承主会话模型） |
| `tiers.medium` | 同上，默认 `deepseek-chat` | 同上 |
| `tiers.high` | 同上，默认 `deepseek-reasoner` | 同上 |
| `roleOverrides` | `dict<string>`，默认 `{}` | 角色级覆盖，优先于 tiers，如 `{ "omd-agent-code-reviewer": "deepseek/deepseek-reasoner" }` |
| `stateDir` | 字符串，默认 `'.omd'` | 项目状态目录名 |
| `autopilot.maxIterations` | 自然数 ≥1，默认 `10` | autopilot 最大轮次（`create_goal` 的 max_goal_rounds 默认值） |
| `autopilot.maxQaCycles` | 自然数 ≥1，默认 `5` | QA 循环上限 |
| `autopilot.maxValidationRounds` | 自然数 ≥1，默认 `3` | re-validation 轮次上限 |

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
```

---

## 状态目录 / `.omd/` Layout

所有模式状态落在项目目录的 `.omd/`（可用 `stateDir` 改名），取消/崩溃后可恢复：

```
.omd/
├── state/
│   ├── sessions/<sessionId>/<mode>-state.json   # 每会话每模式状态（active/phase/iteration）
│   └── boulder.json                             # ralph 进度石
├── plans/          # autopilot/team 计划
├── specs/          # 规格文档
├── prd/            # ralph PRD（JSON + reconciliation.jsonl 台账）
├── handoffs/       # team 阶段交接（五段固定格式）
├── checkpoints/    # 恢复快照
├── logs/
└── notepad.md      # 三区记事本（MANUAL 永不清理 / Priority 永久 / Working 7 天过期）
```

> `.omd/` 是运行时产物，建议加入 `.gitignore`。

---

## 降级与依赖边界 / Graceful Degradation

- **零第三方 dsh 插件依赖**：不依赖任何非 `@deepseek-ai/*` 官方插件。
- 启动时 probe 探测四项能力（core / storage / mcpClient / hooksBridge），结果渲染进系统提示词的能力矩阵，降级时协议指导模型走文件直读兜底：
  - 核心 inject 服务（tools/skills/systemPrompt/commands）缺失 → 插件启动即报错（唯一硬依赖）；
  - `storage` 缺失 → 记忆工具不注册；
  - MCP server 挂载失败 → `state_*`/`notepad_*`/`prd_*`/`handoff_*` 不可用，协议降级为直接读写 `.omd/` 文件；
  - 运行 `/omd-doctor` 可随时查看当前降级状态。

---

## 开发 / Development

```bash
npm test            # vitest 全量（75 tests）
npm run test:watch
```

设计规格：`docs/superpowers/specs/2026-09-15-oh-my-dsh-design.md`
实现计划：`docs/superpowers/plans/2026-09-15-oh-my-dsh-m1.md`

## License

MIT
