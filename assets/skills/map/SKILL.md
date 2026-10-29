---
name: map
description: The skill map — which skill owns which job, in delivery-loop order. Use when something needs doing but not which of the shipped skills owns it; the map routes, it never executes.
when-to-use: The user knows what kind of work is needed but not which skill owns it; or asks "which skill should I use for X". The map only routes across shipped skills — it never executes them.
---

# Map

You know something needs doing; you do not know which skill owns it. Find the job below and follow its route. Each row resolves to one Skill-tool call — make it, then follow that skill's doctrine. The map routes and explains nothing twice.

## The delivery loop

| You are here | Skill |
|---|---|
| External work arrived (issues, PRs, reports) | `harbor` |
| The destination is foggy — the first three decisions cannot be stated yet | `ask-navigator` |
| Vague idea; questions must come before anything else | `deep-interview` |
| Requirements are clear; you need a plan | `plan` (multi-perspective consensus: `ralplan`) |
| Approved plan; decompose and ship end to end with human checkpoints | `launch` |
| One task; persistence until verified complete | `ralph` |
| Hands-off idea-to-code | `autopilot` |
| Work needs coordinated parallel workers | `team` (explicit invocation only) |
| One approved task carried through verified code | `execute` |
| A design question prose cannot settle | `loft` |
| The repo needs a shared foundation before work starts | `drydock` |
| Finished work needs judgment | `review` |
| Something claims to be done | `verify` |
| Work is landing as a release | `release` |
| An issue/PR needs an isolated worktree session | `project-session-manager` |

## On-ramps (off the main loop)

| Job | Skill |
|---|---|
| A bug needs its root cause | `debug`; competing-hypothesis tracing: `trace` |
| Tests should drive the implementation | `tdd` |
| The codebase is getting harder to change | `analyze` (read-only deep analysis, evidence-bounded) |
| AI-generated slop needs cleanup | `ai-slop-cleaner` |
| An open question needs grounded answers | `research`; official/external docs: `external-context`; a second opinion: `ask` |
| Knowledge should compound across sessions | `wiki`; durable project memory: `remember` |
| A recurring autonomous improvement loop | `self-improve`; durable goal ledger: `ultragoal`; stateful single-task loop: `autoresearch` |
| Performance work needs a gate | `performance-goal` |
| A visual/UI verdict is needed | `visual-verdict` |
| A design source of truth is missing | `design` |
| New code must stay minimal and principled | `minimal-code-discipline`; agent-facing docs: `agent-doc-discipline` |
| A fresh repo needs orientation docs | `deepinit` |

## Utilities

| Job | Skill |
|---|---|
| Install, diagnose, configure | `omd-setup`; `omd-doctor` |
| Manage skills themselves | `skill` (local); `skillify` (extract from session) |
| Inspect orchestration state | `trace` (also the tracing lane); `graph` (DAG runtime); `hud` (status card) |
| Cancel a mode | `cancel` |

## Rules

- The map routes; it never executes. Each row resolves to one Skill-tool call — make it, then follow that skill's doctrine.
- The map only routes skills that are actually shipped. A job matching no row is itself information: say so plainly rather than picking the nearest-sounding skill.
- When two rows both fit, the delivery loop above is the tiebreak: earlier legs come first.
- Keyword routing note: `autopilot`, `deep-interview`, `review`, `tdd`, `ai-slop-cleaner` trigger on the spoken keyword; `ralph`, `ralplan`, `wiki` need the anchored explicit form (`ralph: <task>` / 用 ralph…); `team` has no keyword — explicit invocation only; every routed skill can always be invoked explicitly by name.
