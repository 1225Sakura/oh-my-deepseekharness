---
name: closeout.zh
description: launch Phase 5 收尾的参考细节——仅在实际收尾一次 launch 运行时加载（agent 报告汇总、C5 验收门）。
---

## Phase 5——收尾（agent 报告 → C5 验收）

- 所有 ticket 带证据终态 → 对全改动跑 `verify`
- 对账 paper trail：GLOSSARY.md 准确、ADR 齐全、实现教会规格的地方更新规格
- yard 复查：重跑 drydock `--check` 审计；入门以来新冒出的发现报告为 **yard 漂移**，附 `drydock` 技能指针
- **沉淀 pass——回答：这艘船教会了船坞什么？** 先扫来源清单（三连败根因、C4 答案、评审拒绝、verify 发现、本跑程带入的任何延后沉淀行），再作答。每条教训按 `教训 → 槽位 → 打算的改动` 对照下表提出，或显式带理由拒绝；没啥可教的船必须逐字说"no new lessons"。该要求拦的是不回答，不是空回答——为凑数发明教训与跳过问题同罪。教训清单随完成报告、与 Open Assumptions 并列，逐行可否决；批准的教训在验收后才写入槽位，报告记录每个落点的文件位置。把任何教训写进槽位之前，`agent-doc-discipline` 已加载则用 `skill` 工具调它并应用其规则；该技能的验证清单过了，沉淀 pass 才算完。

  | 教训种类 | 槽位 |
  |---|---|
  | 跑程中敲定的术语与边界 | `GLOSSARY.md` 术语表 |
  | 可检查的行为规则（带 why） | `docs/standards/` 匹配卷（architecture / data / process） |
  | 最常违反的约定（薄入口级） | `CLAUDE.md` 正文——只提议 |
  | 难逆转决策 | `docs/adr/`（C4 答案已落此处） |
  | 业务规则 / 背景 | `docs/business/` |
  | UI 模式 / 组件契约 | `design-system/` |
  | 可复用手艺 | `.dsh/skills/`（过质量门） |
  | 反复需要的自动化 / 集成 | `scripts/`（MCP 接线走 dsh profile 的 cordis patch——记入 docs/standards/process.md） |
  | 没有槽位合适 | 显式带理由拒绝 |

- **薄入口预算：** `CLAUDE.md` 正文至多五条热条目。教训够薄入口级，仅当来源清单证明同一违反在本跑程出现至少两次，或船长标记为 load-bearing。条目按最近晋升在前排列；最冷条目确定性地是所列最后一条，超预算的晋升必须在同一提案中恰好降级那一条，把它的全文移回 `docs/standards/`——不删任何东西，只重新分层。臃肿逐船再平衡，刻意不作为 `--check` 发现。
- 发出**完成报告**：交付范围、验证证据、paper-trail 位置、yard 漂移发现（如有）、沉淀清单（逐行可否决）、按人类可能想否决的程度排序的 Open Assumptions
