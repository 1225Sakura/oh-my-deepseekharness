# 退役词软别名机制评估（P2-W3-4 · team eco-completion · w-P2-5）

> 对象：`RETIRED_KEYWORDS = ['ultrawork', 'ulw', 'uw', 'ccg']`（lib/keywords.js）
> 消费面实证：lib/protocol.js:42（协议文本内嵌：`- 退役词 …：不触发，告知用户——${RETIRED_NOTE}`）；lib/hook.js（确定性拦截：命中即吞掉不触发，RETIRED_NOTE 仅经协议面呈达模型）
> 日期：2026-10-29

## 三机制评估

| 机制 | 行为 | 优点 | 缺点 | 裁决 |
|---|---|---|---|---|
| a) 现状：吞掉 + 聚合提示 | 命中退役词→不触发任何模式，RETIRED_NOTE 一句话告知继任者 | 零误触发风险；实现最小；行为可预测 | 聚合式提示（四词共用一句），强缩写用户（ulw/uw）需自行推断逐词映射 | 被 b 包含 |
| b) NOTE 携带逐词继任示例 | 提示升级为逐词「退役词 → 继任者：用法示例」段 | 肌肉记忆翻译零推断；纯常量数据变更（零行为风险）；与 compat 矩阵互补；fresh-clone 可测 | 无（载体形态需适配消费方，见形态决策） | **采纳** |
| c) 真别名：退役词直接激活继任模式 | `ultrawork: xxx` 触发 autopilot 模式激活 | 老用户零学习成本 | 见否决理由 | **否决** |

## 决定记录

**采纳 b**：RETIRED_NOTE 升级为逐词继任示例（ultrawork/ulw/uw→autopilot 含用法示例；ccg→autopilot/team 双继任按 compat A 表语义分段）。a 的全部行为（吞掉、不触发）在 b 下原样保留——b 是 a 的提示内容增强，非行为变更。

**否决 c（真别名）**，四条理由：
1. **最小惊讶**：用户输入退役词期望得到「此词已退役」的显式信号；静默改道激活 autopilot 会掩盖迁移事实，退役永不真正发生。
2. **肌肉记忆迁移应显式**：一次性显式修正（读提示→改用 autopilot）成本低于长期静默改道（错误的心智模型被系统固化）。
3. **上游对齐**：OMC v5.0 退役口径为 removed, not aliased（reference/oh-my-claudecode/.github/CLAUDE.md:31 实证；src/alias-retirement/registry.ts 的别名是文档映射面而非触发面）。
4. **安全分析（与关键词 hook 匹配形态的交互）**：anchored 形态下做真别名需 hook 在拦截点预写模式状态（autopilot-state）——旧词会污染模式状态生命周期（cancel/互斥/所有权语义要处理「由退役词激活」这一从未声明的来源）；token/messageStart 形态下别名注入指引块，等于把系统主动改道伪装成用户显式选择。两形态复杂度俱增而用户收益为零（b 已提供完整翻译）。

## 形态决策（实现级调适）

唯一消费方 lib/protocol.js:42 将 NOTE 内嵌在协议文本的列表行内——**多行 NOTE 会破坏协议块布局**。故「每词一行」调适为「**单行内逐词分段**」（分号分隔，每段含 映射+用法示例），语义完整保留。 compat A 表映射为唯一事实来源：ultrawork/ulw→autopilot（`autopilot <任务>`，并行面 team 承载）、uw→autopilot（同）、ccg→autopilot（生成引擎）或 team（多代理协同）。

## 与 docs/compat-retirement.md 的关系

- **矩阵 = 地图**：16 技能 + 4 触发词的全量映射与等效工作流配方（查全量去 compat）。
- **RETIRED_NOTE = 运行时入口**：命中瞬间的最小可用翻译（四词逐词示例 + 指回矩阵）。
- **本评估 = 机制决定记录**：为何是「提示」而非「改道」，以及形态为何单行。

## 变更清单

- lib/keywords.js：RETIRED_NOTE 升级（逐词示例段；compat 引用句保留）
- tests/lib/protocol.test.js：RETIRED_NOTE 断言扩展（示例段 + compat 引用）
- 本文档（机制决定记录）

## 附：现状实证（并入自重契约流 retired-soft-alias-eval.md，2026-10-29 去重合并）

- `RETIRED_KEYWORDS = ['ultrawork', 'ulw', 'uw', 'ccg']`（lib/keywords.js:51）——命中即吞掉、不触发任何模式。
- `RETIRED_NOTE`（lib/keywords.js:52）现为软别名形态 (b)：内联逐词继任示例 + docs/compat-retirement.md 完整映射指引。
- 守门：tests/lib/protocol.test.js（注册表白名单/NOTE 内容断言）、tests/lib/hook.test.js（退役词口径回归）。
