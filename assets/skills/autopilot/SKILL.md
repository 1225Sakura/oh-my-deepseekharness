---
name: autopilot
description: Autonomous end-to-end pipeline from a brief idea to verified working code, driven by the native dsh goal mechanism
when-to-use: User wants hands-off end-to-end execution from an idea to working code ("autopilot", "full auto", "build me …"); the task spans planning, implementation, QA and validation. Not for quick fixes, brainstorming, or single focused changes.
---

# autopilot

<Purpose>
Autopilot takes a 2–3 line idea and autonomously runs the full lifecycle: requirements expansion, planning, parallel implementation, QA cycling, and dual-gate validation — then delivers working, verified code. In omd it rides the native dsh goal continuation mechanism (`create_goal` / `update_goal`), not a Stop hook. This document is a rewrite of the OMC autopilot skill against the omd design spec; where this file and OMC disagree, this file wins.
</Purpose>

<Hard_Constraints>
- **Main session only.** `create_goal` rejects subagent authority — autopilot may only be started by the direct human in the main session. Never delegate mode startup to a teammate.
- **Modes are mutually exclusive (MVP).** Before starting, read state (`mcp__omd-state__state_read` per mode, or `mcp__omd-state__state_list_active` for the cross-session view). If any mode is active, refuse and report instead of nesting.
- **No evidence, no completion.** Every "done" claim must be backed by fresh verification command output, quoted raw.
</Hard_Constraints>

<Pipeline>
Five phases: **Expansion → Planning → Execution → QA → Validation**. Each phase completes before the next begins; parallelism lives inside phases (Execution and Validation).
</Pipeline>

## Phase 0 — Expansion

Entry checks, in this order (linkage clauses):

1. **ralplan consensus plan exists** (`.omd/plans/ralplan-*.md`): skip BOTH Phase 0 and Phase 1 — the plan is already requirements- and architecture-validated. Jump straight to Phase 2 (Execution) with that plan.
2. **deep-interview spec exists** (`.omd/specs/deep-interview-*.md`): skip the expansion itself; adopt the pre-validated spec as the Phase 0 output and continue to Phase 1 (Planning).
3. **Vague input** (no file paths, function names, or concrete anchors): offer a redirect to the `deep-interview` skill via `ask_user_question` before expanding — e.g. "Run deep-interview first (Recommended)" vs "Expand directly".
4. **Otherwise**: expand the idea yourself. Use `ask_user_question` to settle the few decisions that materially change the build (scope, stack, interface) — 1–3 focused questions, 2–4 options each.

Output: write the spec to `.omd/plans/<topic>.md` (`<topic>` = lowercase slug derived from the task).

## Phase 1 — Planning

Skipped when a ralplan consensus plan was detected in Phase 0.

Derive an implementation plan from the spec: decompose into independent, file-scoped tasks, each with its verification command(s); order by dependency. Append the plan to `.omd/plans/<topic>.md`. For non-trivial plans you may delegate: load the `omd-agent-planner` role card with the `skill` tool, then spawn it via `subagent`.

## Startup threshold and goal creation

- **Threshold**: if the whole task can plausibly be finished in a single round, just do it — do NOT create a goal.
- Otherwise, before entering Execution:
  ```
  create_goal(objective = <spec summary + completion criteria>, max_goal_rounds = <limit>)
  ```
  `max_goal_rounds` is **mandatory** — protocol default **10** (config `autopilot.maxIterations`). A goal without a round cap is a protocol violation.

## Phase 2 — Execution (goal loop body)

Each goal round:

1. `todo_write` — refresh the task list from the plan; exactly one in_progress item per work stream.
2. Delegate implementation in the background: load the `omd-agent-executor` role card, spawn `subagent` workers for independent tasks in parallel (background is the default). Never duplicate a running subagent's work.
3. Run each task's verification command yourself; read the raw output before marking anything completed in `todo_write`.
4. Update state (State Contract below) with `current_phase: "execution"` plus progress, then end the round — the goal mechanism re-enters automatically until completion or a bound is hit.

## Phase 3 — QA

Cycle build → lint → test → fix until green:

- At most **5 QA cycles** (config `autopilot.maxQaCycles`, default 5).
- If the **same error repeats 3 times**, stop early — that signals a fundamental issue. Report the error pattern and escalate to the user instead of cycling further.
- Leave QA only with fresh, passing verification output in hand.

## Phase 4 — Validation (dual review gate)

Spawn two independent reviewers in parallel — separate subagent contexts, never self-approval in the authoring context:

1. `omd-agent-verifier` — verifies every requirement in the spec/plan against fresh evidence (runs the commands, reads the output).
2. `omd-agent-code-reviewer` — logic defects, maintainability, anti-patterns, style.

**Both must approve.** On rejection: fix, then re-validate with the rejecting reviewer.

- **Re-validation is bounded to 3 rounds** (config `autopilot.maxValidationRounds`, default 3).
- **Security-related changes escalate depth**: add an explicit security review pass (auth, crypto, trust boundaries, injection surface) and use the deepest available review effort.
- Only when both reviewers approve: `update_goal(action="complete")`, then State Contract cleanup.

## Numeric bounds (hard limits)

| Bound | Value | On exceed |
|---|---|---|
| Goal rounds | `max_goal_rounds` (default 10) | loop stops; report progress and remaining work |
| QA cycles | ≤ 5 (`maxQaCycles`) | stop, escalate with the error pattern |
| Same error repeats | 3 | early stop — fundamental issue |
| Re-validation rounds | ≤ 3 (`maxValidationRounds`) | `update_goal(action="blocked", blocked_reason=<concrete condition + evidence>)` |

## Cancel and resume

- **Cancel** (`/omd-cancel`, or the user says stop): `update_goal(action="pause")` + `mcp__omd-state__state_clear(mode="autopilot")`. `.omd/plans/` and `.omd/specs/` are **preserved**.
- **Resume**: invoking autopilot again reads the preserved plans/specs and continues from the last recorded phase (OMC resume semantics). State older than 2h is stale — report and confirm with the user instead of auto-resuming.

## Degradation

If `create_goal`/`update_goal` is unavailable, fall back to a manual loop: record progress in `.omd/state/sessions/{sessionId}/autopilot-state.json` and prompt the user to say "continue" at the end of each round. Announce the degraded mode once, visibly.

## State Contract (状态契约)

- **Start**: `state_write(mode="autopilot", active=true, started_at=<ISO 8601>, current_phase="expansion", prompt_echo=<original request, compressed ≤1200 chars>)`. State file: `.omd/state/sessions/{sessionId}/autopilot-state.json`.
- **Phase transitions**: `state_write` with updated `current_phase` (`expansion|planning|execution|qa|validation`) plus progress fields — on every transition and at every goal round end.
- **Complete / cancel**: `state_clear(mode="autopilot")` after the corresponding `update_goal`. Plans, specs and handoffs under `.omd/` are never deleted.
- **Abnormal exit**: leave state and plans on disk; on the next start, read state first, and treat >2h-old state as stale — report, don't auto-continue.
- **MCP server down**: perform the same reads/writes with plain file tools against `.omd/` and say so explicitly.
