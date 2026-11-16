---
name: closeout
description: Reference detail for the launch Phase 5 closeout — load only when actually closing out a launch run (agent report assembly, C5 acceptance gates).
---

## Phase 5 — Closeout (agent reports → C5 accepts)

- all tickets terminal with evidence → run `verify` across the whole change
- reconcile the paper trail: GLOSSARY.md accurate, ADRs complete, spec updated where implementation taught it something
- yard re-check: re-run the drydock `--check` audit; any new findings since entry are reported as **yard drift**, with a pointer to the `drydock` skill
- **sediment pass — answer: what did this ship teach the yard?** Sweep the source checklist first (three-strike failure root causes, C4 answers, review rejections, verify findings, and any deferred-sediment lines this run carried in), then answer. Propose every lesson as `lesson → slot → intended change` against the slot table below, or decline it explicitly with a reason; a ship with nothing to teach must say so verbatim as "no new lessons". This requirement blocks non-answers, never empty answers — inventing lessons to have one is the same violation as skipping the question. The lesson list rides in the completion report next to the Open Assumptions, each line individually vetoable; approved lessons are written to their slots only after acceptance, and the report records each landing's file location. Before writing any lesson into a slot, call the `skill` tool with `agent-doc-discipline` if loaded and apply its rules; the sediment pass is complete only after the skill's verification checklist passes.

  | Lesson kind | Slot |
  |---|---|
  | terms and boundaries settled mid-run | `GLOSSARY.md` glossary |
  | checkable behavior rules (carry a why) | `docs/standards/` matching volume (architecture / data / process) |
  | most-violated conventions (thin-entry grade) | `CLAUDE.md` body — propose only |
  | hard-to-reverse decisions | `docs/adr/` (C4 answers already land here) |
  | business rules / background | `docs/business/` |
  | UI patterns / component contracts | `design-system/` |
  | reusable craft | `.dsh/skills/` (through the quality gate) |
  | repeatedly needed automation / integrations | `scripts/` (or the dsh profile's cordis patch for MCP wiring — recorded in docs/standards/process.md) |
  | no slot fits | decline explicitly with the reason |

- **thin-entry budget:** the `CLAUDE.md` body carries at most five hot entries. A lesson is thin-entry grade only when the source checklist evidences the same violation at least twice in this run, or the captain marks it load-bearing. Entries are listed most-recently-promoted first; the coldest entry is deterministically the last one listed, and a promotion over budget must demote exactly that entry in the same proposal, moving its full text back to `docs/standards/` — nothing is deleted, only re-tiered. Bloat is rebalanced ship by ship and is deliberately not a `--check` finding.
- emit the **completion report**: shipped scope, verification evidence, paper-trail locations, yard-drift findings (if any), the sediment list (each line vetoable), and Open Assumptions ranked by how much a human would likely want to veto them
