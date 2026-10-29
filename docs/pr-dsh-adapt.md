# pr skill 的 dsh 适配分析（defer #6 复评输入）

> 产出：共识计划《omd 插件全链路审查与生态补全计划》W2-#6 配套 · 2026-10-29 · team eco-completion（单代理模式）
> 上游对照：reference/oh-my-claudecode/skills/pr/（v5.7.0；原文 frontmatter 含 credits（show-me / humanlayer、mattpocock/skills），移植时必须保留）

## 上游 pr 的依赖面清单

| 依赖 | 上游形态 | 说明 |
|---|---|---|
| paper-trail·证据不重收 | verify 协议产出 BUILD/TEST/LINT/FUNCTIONALITY 证据，pr 只消费、freshness 规则继承 | pr 不自采证据，绝不声称 verify 没产出的证据 |
| paper-trail·ADR 测试 | launch 对决策跑逆转性三问（难逆转？无语境令人意外？真实取舍？），PR 的 Reversibility 节消费其结论 | 逆转性分类=PR 必填节 |
| GLOSSARY 语言约定 | PR 全文用 GLOSSARY.md 词汇（legacy 仓 CONTEXT.md 过渡） | 读者在会话外，词汇表是唯一共享语言 |
| 最小视觉摘要 | summary-visual 纪律（show-me 改编）：summary 一句断言 + 最小证明视觉（伪代码/调用树/组件树/文件树/Mermaid/按变更整形 diff） | omd 侧 diagram skill（本轮已落地）可直接承接 |
| 触发时机 | launch Phase 5（平台经 PR 评审时） | 上游 launch 流水线的一环 |

## omd 现状对照

| 上游依赖 | omd 现状 | 判定 |
|---|---|---|
| verify 证据协议 | assets/skills/verify（证据纪律+新鲜输出强制） | ✅ 可直移 |
| ADR 三问/逆转性 | .omd/plans 的 ADR 实践（ralplan 产物含 ADR 节）；无 launch 强制门 | ⚠️ 需改装：逆转性三问内联进 pr skill 自检 |
| GLOSSARY 词汇 | 2026-10-29 已完成 70 处改名（GLOSSARY.md） | ✅ 可直移 |
| 最小视觉 | diagram skill 已落地（本轮 W2-#2） | ✅ 可直移 |
| launch Phase 5 触发 | omd launch 已移植，但 PR 评审环节无宿主强制面 | ⚠️ 需改装：触发降为显式调用或 git-master 角色内调用 |
| PR 平台操作（gh 等） | omd 无 gh 集成承诺；project-session-manager 提及 gh/jira 方法论 | ⚠️ 可选：由使用者环境自备 |

## 三清单结论

- **可直移**：证据消费纪律（不重收）、最小视觉（经 diagram）、GLOSSARY 语言、模板三节（Summary/Evidence/Reversibility）。
- **需改装**：逆转性三问内联；触发面从 launch Phase 5 改为显式调用或 git-master 角色内调用；credits 块保留。
- **dsh 缺失项**：无宿主级 PR 评审强制点；无 CI 状态消费面——pr 在 omd 是「组装 bodies 的写作纪律」，不是发布门。

## 复评建议（defer #6 点燃条件对照）

最小可行 omd pr 工作流 = assets/skills/pr/（双语）：模板三节 + 证据只消费 verify 产出 + 逆转性三问自检 + diagram 选最小视觉 + GLOSSARY 用词。工程量小（纯资产），**真正的阻塞从来不是工程量，而是「omd 无 paper-trail 强制门时 pr 会不会退化成手工写作」**——因此维持 defer：待 omd 建立等价 paper-trail 约定（候选承载=wiki+handoff 台账，见台账行）后在一次 parity 重基线轮中按本清单直移。台账行 owner=插件维护者，触发=dsh 0.2.0 stable 复评轮。
