# OMX 上游形态卡（oh-my-codex）

> 取数来源：`scripts/audit-upstream-forms.mjs`（S1 已验收，本卡数字与该脚本输出逐项一致）。
> 映射目标：[feature-parity-audit.md](feature-parity-audit.md)（382 行台账）的 `## 45 点逐行重评` 权威段。

## 版本锚

- tag：**v0.21.9**
- HEAD：**02ef37e1**

## 顶层子系统地图

顶层目录清单：.agents / .github / .gjc / artifacts / crates / docs / geobench / missions / notes / packages / playground / plugins / prompts / scripts / skills / src / templates

结构面（S1 JSON `dirs`）：

- `crates/`：存在，6 个子目录（omx-api / omx-explore / omx-mux / omx-runtime / omx-runtime-core / omx-sparkshell）——Rust 运行时核
- `packages/`：存在，1 个子目录（vscode-extension）
- `plugins/`：存在，1 个子目录（oh-my-codex）
- `prompts/`：存在，0 个子目录（角色 prompt 平铺为 .md 文件）
- `skills/`：root skills 名册（见下节）

## 名册摘要

权威计数（S1 JSON `counts`）：root skills = **29**（0.21.5→0.21.9 零增删，tag diff 为空）。

分组摘要（按目录名粗分组，名册全称见 S1 JSON 对应仓库枚举）：

- 执行模式类（8）：autopilot / autoresearch / autoresearch-goal（日落存根）/ deep-interview / ralph / ralplan / team / ultragoal
- 流程与评审类：pipeline / plan / ultraqa / ultrawork / code-review / cancel
- 资产与辅助类：ai-slop-cleaner / analyze / ask / best-practice-research / configure-notifications / design / doctor / git-master / hud / omx-setup / performance-goal / skill / visual-ralph / wiki / worker
- 打包口径注记：root 29 / 打包 24，结构差 5 项均为退役或已有等价物（parity-audit 引用 u7-drift 勘误表口径）

## CLI/hook/状态面清单

- CLI 面：package.json `bin.omx = dist/cli/omx.js`（omx CLI，setup/doctor 等子命令）；构建链 tsc + cargo（build:runtime / build:explore / build:full）。
- capabilities lock：`omx-capabilities.lock.json` 存在（S1 JSON `capabilitiesLockExists = true`），kind = `omx_capabilities_lock`，逐 surface 记录 agents 等资产的 sha256 digest 与文件清单——上游资产完整性锁，omd 侧无对应面（以测试断言名册替代）。
- hook/状态面：bridge 面（cli / mcp-server / runtime-cli / team-bridge）在其位，形态未变。
- omd 侧对照体量（S1 JSON `omd` 段）：assets/skills 42 目录 / assets/agents 66 文件（33 角色×双语）/ MCP 工具 55（逐文件枚举，sum check 通过）。

## omd 映射表

| OMX 形态 | omd 承载 | parity-audit 节锚 |
|---|---|---|
| root skills 29（0.21.5→0.21.9 零增删） | `assets/skills/` 42 目录（含 OMX 独有 analyze/best-practice-research/design/performance-goal 双语 ×4） | `## 45 点逐行重评 › ### B. 技能资产（4）` |
| prompts/ 角色 prompt + capabilities lock 完整性锁 | `assets/agents/` 66 文件（33 角色×双语；OMX 扩编 14 张）；名册断言在测试 | `## 45 点逐行重评 › ### C. 角色卡与模型路由（5）` |
| tmux HUD / team bridge 生命周期（0.21.6 起改进） | 刻意舍弃 tmux 通道；team SKILL 明示；registry 终态 + heartbeat 为等价物 | `## 45 点逐行重评 › ### F. Team 运行时（6）` |
| omx CLI（bin.omx）/ packages/vscode-extension | 均判定不移植（R-8：dsh Web GUI 覆盖） | `## 45 点逐行重评 › ### H. CLI 与分发（4）` |
| crates/ Rust 运行时核 + bridge（cli/mcp-server/runtime-cli/team-bridge） | 无对应运行时核；omd 以 lib/* JS 运行时承载 | `## 45 点逐行重评 › ### I. 跨进程 / Rust / 运行时核（3）` |
| ultrawork/ultraqa/pipeline 等退役词系 | omd 退役词拦截（cancel 独占 + RETIRED 表） | `## 45 点逐行重评 › ### A. 执行模式（8）` |

## 保鲜约定

两层门语义：

1. **reference/ 升级 → 必跑 `npm test -- upstream-forms`**：上游快照（`reference/oh-my-codex`）换 tag 或 HEAD 后，本卡数字必须经该守门测试重核。
2. **fresh clone 上漂移层 skip 属预期**：新克隆仓库尚未落 reference 快照时守门测试跳过属设计行为，不算失败。

数字以 `tests/docs/upstream-forms.test.js` 守门为准——本卡任何数字与该测试断言冲突时，先跑 `node scripts/audit-upstream-forms.mjs` 取权威 JSON 再改卡。
