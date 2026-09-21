---
name: autoresearch
description: Stateful single-mission improvement loop with strict evaluator contract, markdown decision logs, and max-runtime stop behavior
when-to-use: You already have a mission and an evaluator and want persistent single-mission iterative improvement with durable experiment logs under .omd/autoresearch/. Not for evaluator generation at runtime (interview or author it first) and not for multi-mission orchestration (v1 forbids it).
---

<Purpose>
Autoresearch is a stateful skill for bounded, evaluator-driven iterative improvement. It owns one mission at a time, keeps iterating through non-passing results, records each evaluation and decision as durable artifacts, and stops only when an explicit max-runtime ceiling or another explicit terminal condition is reached.
</Purpose>

<Use_When>
- You already have a mission and evaluator. In OMC these come from `/deep-interview --autoresearch`; the `--autoresearch` flag variant is **not yet ported to omd** — run the `deep-interview` skill normally and pin down the mission spec + evaluator contract with the user, or author them directly.
- You want persistent single-mission improvement with strict evaluation.
- You need durable experiment logs under `.omd/autoresearch/`.
</Use_When>

<Do_Not_Use_When>
- You need evaluator generation at runtime — interview or author it first.
- You need multiple missions orchestrated together — v1 forbids that.
- You want OMC's deprecated `omc autoresearch` CLI flow — no omd equivalent exists.
</Do_Not_Use_When>

<Contract>
- Single-mission only in v1.
- Evaluator output must be structured JSON with required boolean `pass` and optional numeric `score`.
- Non-passing iterations do **not** stop the run.
- Stop conditions are explicit and bounded, with max-runtime as the primary strict stop ceiling.
- Loop driver: the dsh `goal` mechanism carries the iterations — `create_goal` with a mandatory `max_goal_rounds` as the round-count circuit breaker; the wall-clock max-runtime/deadline recorded in mode state is re-checked against timestamps at every round.
</Contract>

<Required_Artifacts>
Canonical persistent storage lives under `.omd/autoresearch/<mission-slug>/` and/or `.omd/logs/autoresearch/<run-id>/`.

Minimum required artifacts:
- mission spec
- evaluator script or command reference
- per-iteration evaluation JSON
- markdown decision logs

Recommended canonical shape:
```text
.omd/autoresearch/<mission-slug>/
  mission.md
  evaluator.json
  runs/<run-id>/
    evaluations/
      iteration-0001.json
      iteration-0002.json
    decision-log.md
```
Reuse existing runtime artifacts when available rather than duplicating them unnecessarily.
</Required_Artifacts>

<Workflow>
1. Confirm a single mission exists and evaluator setup is already available.
2. Ensure mode state is active for `autoresearch` (see State Contract) and records:
   - mission slug/dir
   - evaluator reference
   - iteration count
   - started/updated timestamps
   - explicit max-runtime or deadline
3. On every iteration (one goal round):
   - run exactly one experiment/change cycle
   - run the evaluator via `pwsh`
   - persist machine-readable evaluation JSON
   - append a human-readable markdown decision log entry
   - continue even when evaluation does not pass
4. Stop when:
   - the max-runtime ceiling is reached (re-checked per round against state timestamps)
   - `max_goal_rounds` is exhausted
   - the user explicitly cancels (cancel semantics)
   - another explicit terminal condition is recorded
</Workflow>

<Periodic_Reruns>
OMC integrated with Claude Code native cron for periodic mission reruns. **dsh has no native cron primitive — this integration is omd phase-2.** Until then, if periodic reruns are needed, schedule them at the OS level (Windows Task Scheduler / cron launching a dsh session).

If periodic reruns are used:
- keep one mission per scheduled job
- preserve the same mission/evaluator contract
- append new run artifacts rather than overwriting prior experiments
</Periodic_Reruns>

<Execution_Policy>
- Do not create multi-mission orchestration.
- OMC's `src/autoresearch/*` runtime/schema helpers have no omd counterpart — enforce the contract at prompt level.
- Keep logs useful to humans, not only machines.
</Execution_Policy>

## State Contract (状态契约)

**Call shape convention**: `cwd` and `sessionId` are required top-level params of every `state_*` call; mode fields nest under the `state` key.

- **Start**: `mcp__omd-state__state_write({ cwd, sessionId, mode: "autoresearch", state: { active: true, started_at: <ISO 8601>, current_phase: "running", mission_slug, mission_dir, evaluator_ref, iteration: 0, max_runtime, deadline } })`. State file: `.omd/state/sessions/{sessionId}/autoresearch-state.json`.
- **Transitions**: update `iteration` and the updated timestamp at every round boundary.
- **Complete / cancel**: `mcp__omd-state__state_clear({ cwd, sessionId, mode: "autoresearch" })`. Everything under `.omd/autoresearch/` and `.omd/logs/autoresearch/` is **preserved** for audit and resume.
- **MCP server down**: same reads/writes with plain file tools against `.omd/`, announced explicitly.
