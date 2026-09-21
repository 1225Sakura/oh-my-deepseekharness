---
name: debug
description: Diagnose the current omd session or repo state using mode state, notepad, logs, and focused reproduction
when-to-use: The user wants help diagnosing a current omd/DeepSeek-Harness session problem, workflow breakage, or confusing runtime behavior — stuck modes, stale state, orchestration misbehavior. Not for prescribing fixes before the failure is isolated.
---

# Debug

Use this skill when the user wants help diagnosing a current omd/DeepSeek-Harness session problem, workflow breakage, or confusing runtime behavior.

## Goal

Find the real failure signal quickly and explain the next corrective step.

## Workflow

1. Read the user's issue description carefully.
2. Inspect the most relevant local evidence first:
   - mode state: `mcp__omd-state__state_get_status({ cwd })` and `state_list_active({ cwd })`; read one mode with `state_read({ cwd, sessionId, mode })`
   - when MCP is degraded, read `.omd/` artifacts directly with `glob`/`read` — state files live at `.omd/state/sessions/{sessionId}/<mode>-state.json`
   - `mcp__omd-state__notepad_read({ cwd })` when session memory matters
   - failing tests or commands — rerun the narrowest one with `pwsh`
   - `git log` / `git_diff` for recent-change correlation
3. Reproduce the issue narrowly if possible.
4. Distinguish symptoms from root cause.
5. Recommend the smallest next fix or verification step.

## Rules

- Prefer real evidence over guesses.
- Use the state surfaces when the issue involves orchestration, modes, or agent flow.
- OMC's original trace MCP tools (`trace_timeline` / `trace_summary`) are **omd phase-2**; until then, reconstruct agent flow from `.omd/` state and handoff files, `git log`, and focused `grep` over logs.
- If the issue is actually a product/runtime bug (dsh host itself, not omd or app code), say so plainly.
- Do not prescribe broad rewrites before isolating the failure.

## Output

- Observed failure
- Root-cause hypothesis
- Evidence for that hypothesis
- Smallest next action

## State Contract (状态契约)

Debug **holds no mode state**: it is a read-mostly diagnostic lane and creates nothing under `.omd/state/`. Findings worth keeping go to `mcp__omd-state__notepad_write_working`; if a fix follows, the enclosing mode (if any) owns persistence. For deeper causal hunts with competing hypotheses, escalate to the `trace` skill.
