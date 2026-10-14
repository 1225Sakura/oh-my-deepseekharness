# OMC 上游形态卡（oh-my-claudecode）

> 取数来源：`scripts/audit-upstream-forms.mjs`（S1 已验收，本卡数字与该脚本输出逐项一致）。
> 映射目标：[feature-parity-audit.md](feature-parity-audit.md)（382 行台账）的 `## 45 点逐行重评` 权威段。

## 版本锚

- tag：**v5.7.0**
- HEAD：**8262f9f79**

## 顶层子系统地图

顶层目录清单（S1 JSON `topLevelDirs`，32 项）：
.claude-plugin / .clawhip / .git / .github / .omc / .omx / agents / assets / benchmark / benchmarks / bin / bridge / commands / design-system / dist / docs / examples / generated / geobench / hooks / inventory / missions / native / receipts / research / scripts / seminar / shellmark / skills / src / templates / tests

src/ 子系统清单（S1 JSON `srcSubsystems`，**34 个**）：
__tests__ / agents / alias-retirement / autoresearch / cli / commands / config / constants / factory / features / goal-workflows / graph / hooks / hud / installer / interop / lib / mcp / notifications / openclaw / planning / platform / projection / providers / ralphthon / shared / skills / team / tools / types / ultragoal / utils / verification / workflow

## 名册摘要

权威计数（S1 JSON `counts`）：skills = **48** ｜ agents = **19** ｜ commands = **21**。

分组摘要（按目录名粗分组，名册全称见 S1 JSON 对应仓库枚举）：

- 执行模式类（8）：autopilot / ralph / ultragoal / team / deep-interview / ralplan / autoresearch / cancel
- 资产与工作流类：agent-doc-discipline / ai-slop-cleaner / architecture-survey / diagram / drydock / execute / harbor / intent / launch / loft / map / minimal-code-discipline / minimal-prose-discipline / plan / pr / project-session-manager / release / review / self-improve / session-flow / skill / skillify / tdd / verify / visual-verdict / wiki
- 检索与会话类：ask / ask-navigator / debug / deepinit / external-context / hud / omc-doctor / omc-setup / remember / research / trace / configure-notifications / graph / refit
- agents 19 张角色卡（analyst / architect / code-reviewer / code-simplifier / critic / debugger / designer / document-specialist / executor / explore / git-master / planner / qa-tester / scientist / security-reviewer / test-engineer / tracer / verifier / writer）
- commands 21 项（ask / autoresearch / compact / configure-notifications / debug / deepinit / external-context / hud / omc-doctor / omc-setup / project-session-manager / psm / release / remember / self-improve / skill / skillify / trace / verify / visual-verdict / wiki）

## CLI/hook/状态面清单

- hooks（口径 = `hooks/hooks.json` 内 hook actions 总数，**非** `src/hooks` 下 .ts 文件数——后者仅 10 个，不同源，防误数）：
  - hook actions = **30**
  - matchers = **14**
  - 事件类型 = **11**（UserPromptSubmit / SessionStart / PreToolUse / PermissionRequest / PostToolUse / PostToolUseFailure / SubagentStart / SubagentStop / PreCompact / Stop / SessionEnd）
- CLI 面：`bridge/cli.cjs`（宿主桥接形态，omd 判定不移植）。
- 状态面：文档约定 + 文件形态（无 MCP 工具面）；持久续跑（"The boulder never stops"）为 CLAUDE.md 级约定。

## omd 映射表

| OMC 形态 | omd 承载 | parity-audit 节锚 |
|---|---|---|
| 执行模式 8 skill（autopilot/ralph/ultragoal/team/deep-interview/ralplan/autoresearch/cancel） | `assets/skills/` 同名资产 + dsh 原生 goal/ralph 续跑 | `## 45 点逐行重评 › ### A. 执行模式（8）` |
| skills 48（plugin.json 注册双口径一致） | `assets/skills/` 42 目录（双语；−2 = configure-notifications/omc-doctor 已删） | `## 45 点逐行重评 › ### B. 技能资产（4）` |
| agents 19 角色卡 | `assets/agents/` 66 文件（33 角色×双语，含 OMX 扩编 14 张） | `## 45 点逐行重评 › ### C. 角色卡与模型路由（5）` |
| hooks 30 actions / 14 matchers / 11 事件类型 | omd 单电线 c2 keyword-hook（agent/pre-step）；R-2 维持 | `## 45 点逐行重评 › ### E. Hook 矩阵（3）` |
| team skill + bridge/team*.cjs 形态 | `lib/team.js` 运行时 + 16 个 team_* MCP 工具（超越形态） | `## 45 点逐行重评 › ### F. Team 运行时（6）` |
| HUD effort level（v5.7.0 #4249）/ statusline | 右栏 omd-hud 面板 + hud_render/hud_summary；effort 字段 ❌未做待核 | `## 45 点逐行重评 › ### G. HUD 与通知（3）` |
| bridge/cli.cjs / .claude-plugin/plugin.json / inventory 库存图 | 均判定不移植（dsh 插件面替代） | `## 45 点逐行重评 › ### H. CLI 与分发（4）` |

## 保鲜约定

两层门语义：

1. **reference/ 升级 → 必跑 `npm test -- upstream-forms`**：上游快照（`reference/oh-my-claudecode`）换 tag 或 HEAD 后，本卡数字必须经该守门测试重核。
2. **fresh clone 上漂移层 skip 属预期**：新克隆仓库尚未落 reference 快照时守门测试跳过属设计行为，不算失败。

数字以 `tests/docs/upstream-forms.test.js` 守门为准——本卡任何数字与该测试断言冲突时，先跑 `node scripts/audit-upstream-forms.mjs` 取权威 JSON 再改卡。

## 附：OMC 时代孤儿文件登记

`C:\Users\36084\.dsh\profiles\web\.omc\project-memory.json` 是 OMC（oh-my-claudecode）时代遗留的 auto-scan 骨架：customNotes/directoryMap/hotPaths/userDirectives 全空，projectRoot 错指 dsh web profile 目录，**omd 代码路径不消费它**（omd 项目记忆走宿主 storage domain + sha256 projectKey）。定性=孤儿，无守门、无读者；**删除需用户显式确认，任何自动化流程不得动它**。
