---
name: ralph
description: PRD-driven fresh-agent persistence loop — iterates until every story passes with command evidence and an independent verifier signs off
when-to-use: A task requires guaranteed, evidence-backed completion across multiple rounds. Explicit invocation only ("ralph: <task>", "run ralph on …"); only the direct human can start it, in the main session. Not for one-shot fixes or autonomous idea-to-code pipelines (use autopilot).
---

# ralph

<Purpose>
Ralph is a PRD-driven persistence loop built on the native dsh `ralph` tool: each round is a fresh agent with no conversation memory, the shared workspace is the durable memory, and only a bounded structured report crosses rounds. The loop runs until EVERY story in the structured PRD has `passes: true` backed by raw command evidence, and an independent verifier subagent has signed off (`architectVerified: true`). This is a rewrite of the OMC ralph skill for dsh semantics — no Stop hook, no same-context continuation.
</Purpose>

<Hard_Constraints>
- **Main session only, direct human request.** The `ralph` tool rejects non-human and subagent authority. Never start ralph from inside a subagent, a workflow, or another mode.
- **Foreground blocking.** While the ralph loop runs, the main session cannot do other interactive work. If a goal continuation or another mode is active, refuse and report (read state first).
- **Modes are mutually exclusive (MVP)** — no linked team/autopilot compositions.
</Hard_Constraints>

## Step 1 — PRD setup (before calling the ralph tool)

1. **Read state first**: `mcp__omd-state__state_read({ cwd, sessionId, mode: "ralph" })` and `state_list_active({ cwd })`. Refuse if another mode is active; if a stale ralph PRD exists, apply the stale protocol below.
2. **Create/refine the structured PRD** (prd.json) at `.omd/prd/<topic>.json`, starting from the template `assets/templates/prd-template.json`. The PRD is structured JSON, not a markdown checklist. Each story carries:
   - `passes: boolean` — the completion claim; may only be set with evidence.
   - `acceptanceCriteria: [{ id, text, revision }]` — concrete and verifiable, each with an executable check. **Generic entries ("implementation is complete") are forbidden**: replace scaffold criteria with task-specific ones before starting the loop.
   - `architectVerified: boolean` — the independent review sign-off. The loop itself NEVER sets this field; only the verifier pass in Step 3 does.
   - `criteriaRevision` / per-criterion `revision` — completion claims bind to the criterion version, so "amend the criteria, then claim done" is detectable.
   - `criterionAmendments[]` — the amendment ledger (below).
3. Order stories by dependency; each story should be completable in roughly one round.
4. Initialize `.omd/prd/progress.txt` if absent.

## Step 2 — Start the loop

```
ralph(objective = "<PRD path> + completion criteria + evidence contract", maxRounds = <cap>)
```

- `maxRounds` is **mandatory** — it is the circuit breaker; reaching it stops the loop with a report of remaining stories.
- The objective text must instruct every round to:
  1. Read the PRD and `progress.txt`; pick the highest-priority story with `passes: false`.
  2. Implement it (delegate to `omd-agent-executor` via `subagent` when useful; independent work in parallel, in the background).
  3. **Evidence contract**: run the story's verification command(s) and write the RAW output into the round's handoff report. Never set `passes: true` without having run the checks — a `prd_check` call without evidence is rejected by the tool.
  4. Mark completion through `mcp__omd-state__prd_check` (structured PRD operation — prefer it over hand-editing the JSON).
  5. Append to `.omd/prd/progress.txt`: what was implemented, files changed, learnings and codebase patterns for later rounds.

## Criterion amendments

When measurement proves a criterion empirically false, do NOT silently delete or weaken it. Amend through `mcp__omd-state__prd_amend`:

- Keep the original criterion verbatim in `criterionAmendments[]`, with `kind` (`replaced` | `superseded`), `reason`, bounded `evidence`, and optional `authority` (defaults to `user`); the timestamp is recorded automatically by the tool (`at` field).
- An amendment missing evidence/reason is invalid — the PRD **fails closed** on read. A contradictory ledger (original still active, or amended twice) likewise invalidates the PRD.
- Completion checks verify only the ACTIVE criteria. This is not a goal-weakening tool: it exists so that "the measurement disagrees with the plan" resolves toward the measurement.

## Step 3 — Independent review (after all stories pass)

When every story has `passes: true`, the **main session** spawns an `omd-agent-verifier` subagent for independent review against the PRD acceptance criteria — a fresh context by construction, which is exactly the point:

- The verifier re-runs the evidence commands and checks each criterion; vague "looks done" verdicts are invalid.
- **On approval**: set `architectVerified: true` (via the PRD tools), then completion per the State Contract.
- **On rejection**: fix the findings and re-verify with the verifier. Rejection is not a stop condition.

MVP note: a single verifier pass is the floor. Tiered review depth and a mandatory deslop pass are deferred to a later milestone (documented divergence from OMC).

## Stale detection & reconciliation

- A PRD/state untouched for **> 2 hours** (`staleAfterMs: 7200000`) is stale. On restart after an abnormal exit (crash, kill, cancel), print `[STALE PRD WARNING]` with the unfinished-story count and last-touched age — report to the user, never auto-resume.
- A story may be auto-reconciled to `passes: true` ONLY when its configured `observableChecks` (`fileExists` / `fileContains`) ALL pass. Reconciled stories keep `architectVerified: false` and still require verifier sign-off.
- Append every reconciliation decision to `.omd/prd/reconciliation.jsonl` — the audit log is part of the contract.

## progress.txt

Cross-iteration memory: files changed, codebase patterns discovered, mistakes not to repeat. Append every round; each fresh round reads it first. This replaces conversation memory, which fresh rounds do not have.

## Stop conditions

- All stories `passes: true` + verifier approved → complete (State Contract cleanup).
- `maxRounds` reached → stop; report remaining stories with their evidence state.
- Fundamental blocker (missing credentials, unclear requirements, external outage) → stop and report.
- User says stop → cancel semantics: state cleared; PRD, progress.txt, reconciliation.jsonl preserved.

## Degradation

`ralph` tool unavailable → goal-driven loop (`create_goal` + advance one story per round, same PRD/evidence contract). Goal also unavailable → pure PRD + manual user-driven advancement. Announce the degradation once, visibly.

## State Contract (状态契约)

**Call shape convention**: `cwd` (current workspace path) and `sessionId` (current session id) are REQUIRED top-level params of every `state_*` call; mode fields nest under the `state` key.

- **Start**: `state_write({ cwd, sessionId, mode: "ralph", state: { active: true, started_at: <ISO 8601>, current_phase: "execution", prompt_echo: <compressed ≤1200 chars>, max_rounds: <cap>, prd_path: ".omd/prd/<topic>.json" } })`. State file: `.omd/state/sessions/{sessionId}/ralph-state.json`.
- **Transitions**: update iteration/progress fields (inside `state`) at every round boundary and whenever the phase changes.
- **Complete / cancel**: `state_clear({ cwd, sessionId, mode: "ralph" })`. Everything under `.omd/prd/` (PRD JSON, progress.txt, reconciliation.jsonl) is **preserved** for audit and resume.
- **Abnormal exit**: state and PRD stay on disk; stale (>2h) state is reported, never auto-continued.
- **MCP server down**: same reads/writes with plain file tools against `.omd/`, announced explicitly.
