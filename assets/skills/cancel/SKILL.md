---
name: cancel
description: Cancel any active omd execution mode (autopilot, ralph, team, ralplan, deep-interview) and clean up mode state
when-to-use: Triggered by the `cancelomd` / `stopomd` keywords or the `/omd-cancel` command; also when the user says stop while a mode is active, or when a mode finished and needs proper state cleanup. Deliberately does NOT match bare "cancel"/"stop" to avoid false triggers in everyday language.
---

# cancel

Intelligent cancellation that detects and cancels the active omd mode. Cancel has special status in the keyword routing table: it is matched only by `cancelomd` / `stopomd` or `/omd-cancel`, can fire exclusively in any mode, and cannot be disabled.

## What it does

Auto-detects which mode is active and cancels it in dependency order:

1. **team** (graceful shutdown first — teammates must be released before state cleanup)
2. **autopilot** (goal pause — progress preserved for resume)
3. **ralph** (loop stop)
4. **ralplan** (consensus planning session)
5. **deep-interview** (interview session)

## Usage

```
/omd-cancel            # or say: cancelomd / stopomd
/omd-cancel --force    # clear every session's mode state (full workspace reset)
```

## Implementation steps

### 1. Parse arguments

`--force` / `--all` → force mode (clear all sessions' state, not just the current one).

### 2. Detect active modes

- Call `mcp__omd-state__state_list_active` to enumerate `.omd/state/sessions/{sessionId}/…` and find every session with active modes.
- For each session (or just the current one in default mode), call `mcp__omd-state__state_get_status` to learn which mode is active and its phase.
- State files are the single source of truth — never infer "a mode is running" from conversation vibes.

### 3. Cancel per mode

#### team active

Follow the team shutdown protocol (spec §3.4):

1. Read team state (`state_read({ cwd, sessionId, mode: "team" })`) for the roster of active teammates.
2. Send each teammate a shutdown instruction via `send_message`; idle/ready teammates wake on the message.
3. Wait for confirmations. Because dsh is message-driven (no timer face), confirmation is event-driven: process responses as they arrive at the next model step; do not busy-poll.
4. `list_agents` to confirm no member is still running; `interrupt_agent` any member that ignores shutdown.
5. Only after all members are confirmed stopped or interrupted: `state_clear({ cwd, sessionId, mode: "team" })`.
6. Record unresponsive members in the cancellation report.

#### autopilot active

1. `update_goal(action="pause")` — pauses the goal loop; plans/specs stay on disk for resume (OMC resume semantics).
2. `state_clear({ cwd, sessionId, mode: "autopilot" })`.
3. Report: "Autopilot cancelled at phase: {phase}. Progress preserved for resume — re-running autopilot continues from the preserved plans."

#### ralph active

1. `state_clear({ cwd, sessionId, mode: "ralph" })`. The ralph tool's foreground loop ends with the current round; `maxRounds` and the PRD stay intact.
2. `.omd/prd/` artifacts (prd.json, reconciliation.jsonl, progress.txt) are preserved — a later ralph invocation resumes from them after stale-check.

#### ralplan active

`state_clear({ cwd, sessionId, mode: "ralplan" })`. The consensus plan under `.omd/plans/ralplan-<slug>.md` is preserved.

#### autoresearch active

1. If the loop is goal-backed: `get_goal` for goal_id/revision → `update_goal(action="pause")`.
2. `state_clear({ cwd, sessionId, mode: "autoresearch" })`.
3. Audit artifacts under `.omd/autoresearch/` and `.omd/logs/autoresearch/` are preserved — resumable later after stale-check.

#### deep-interview active

`state_clear({ cwd, sessionId, mode: "deep-interview" })`. Any spec under `.omd/specs/` is preserved; if no spec was crystallized yet, the interview transcript in state is discarded — note this in the report.

#### No active modes

Report: "No active omd modes detected. Use `--force` to clear all session state anyway."

### 4. Always preserved

Regardless of mode or flags, these are NEVER deleted:

- `.omd/plans/` (autopilot specs, ralplan consensus plans)
- `.omd/specs/` (deep-interview specs)
- `.omd/prd/` (ralph PRDs, reconciliation log, progress.txt)
- `.omd/handoffs/` (team stage handoffs)
- `.omd/checkpoints/` (compaction-recovery snapshots)
- `.omd/notepad.md`

Cancel removes **mode state only** — resume depends on the preserved artifacts.

### 5. Report

Emit a structured cancellation report:

```
Cancelled:
- {mode}: {what was done — goal paused / teammates shut down M of N / state cleared}
Preserved:
- {artifact paths that remain for resume}
Warnings:
- {unresponsive teammates, failed clears, stale-state notes}
```

## Messages reference

| Mode | Success message |
|---|---|
| team | "Team cancelled. {M}/{N} teammates confirmed shutdown; state cleared." |
| autopilot | "Autopilot cancelled at phase: {phase}. Progress preserved for resume." |
| ralph | "Ralph cancelled. PRD and progress preserved under .omd/prd/." |
| ralplan | "Ralplan cancelled. Consensus plan preserved under .omd/plans/." |
| deep-interview | "Deep interview cancelled. {Spec preserved | No spec was written; transcript discarded}." |
| force | "All omd mode state cleared. Plans, PRDs, handoffs and checkpoints preserved." |
| none | "No active omd modes detected." |

## Degradation

If the MCP server is unavailable, perform the same detection and clearing with plain file tools against `.omd/state/sessions/{sessionId}/*-state.json` and say so explicitly. If `update_goal` is unavailable while an autopilot goal exists, clear the state file and tell the user the goal may still be armed — they can pause it from their side.

## State Contract (状态契约)

**Call shape convention**: `cwd` (current workspace path) and `sessionId` (current session id) are REQUIRED top-level params of every `state_*` call; `state_list_active`/`state_get_status` take `{ cwd }` only.

Cancel is the cleanup endpoint of every mode's contract: it reads state (`state_list_active({ cwd })` / `state_get_status({ cwd })` / `state_read({ cwd, sessionId, mode })`), performs the mode-specific graceful stop (goal pause for autopilot, shutdown protocol for team), then `state_clear`s the affected modes. It writes no new mode state itself. Artifact directories under `.omd/` are preserved in all paths.
