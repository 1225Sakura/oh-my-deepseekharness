---
name: ultragoal
description: Durable multi-goal initiative — ordered stories with attempt counts and per-story evidence persisted under .omd/ultragoal, driven by dsh's native goal mechanism (create_goal/update_goal) with a final review gate
when-to-use: The user wants a large, multi-step initiative tracked durably across sessions/worktrees ("ultragoal", "track this as a durable goal", "multi-story initiative") — bigger than one change (use ralph or direct delegation for that), and wanting execution with a final quality gate, not a planning-only artifact (use plan for that).
---

# ultragoal — durable multi-goal initiative

Break a brief into an ordered set of stories, record start/checkpoint/blocker/failure events in a durable append-only ledger, and drive the active session with dsh's native goal tools. The ledger survives session restarts and worktrees; the goal tools keep the live session focused.

**Port mapping (OMC → dsh).** OMC implemented this as the `omc ultragoal` CLI writing `.omc/ultragoal/` artifacts plus printed handoff text for Claude Code's `/goal` slash command (the shell could not touch `/goal` state). In omd both halves are first-class: durable artifacts are files under `.omd/ultragoal/` (written with `write`/`edit`), and the session goal is managed directly with `create_goal` / `get_goal` / `update_goal` — no handoff indirection needed. The `/goal`-snapshot reconciliation dance (`--claude-goal-json`) is **dropped**: dsh goal state is authoritative and directly queryable via `get_goal`.

## Workflow

### 1. Create the plan

Decompose the brief into ordered stories. Write the plan to `.omd/ultragoal/plans/<planId>/plan.md` (default `<planId>` = `default`; see "Parallel runs" below):

```markdown
# Ultragoal: <initiative title>
<!-- created: <ISO-8601> -->

## Aggregate objective
<one paragraph — becomes the create_goal objective>

## Stories
- [ ] G001 <slug>: <what> — evidence required: <tests/files/PR>
- [ ] G002 <slug>: …
```

Then start the dsh goal:

```
create_goal(objective: "<aggregate objective>", max_goal_rounds: <cap, default 10>)
```

`max_goal_rounds` is mandatory — set it from `autopilot.maxIterations` (default 10) unless the user says otherwise.

### 2. Work stories in order

For each story: mark it in-progress in the ledger, do the work, collect evidence (test output, changed files, PR links). A pending story may be started out of order when the user names it explicitly; never silently skip ahead.

Append events to `.omd/ultragoal/plans/<planId>/ledger.md` — append-only, one line per event:

```
<ISO-8601> start    G001 attempt=1
<ISO-8601> checkpoint G001 status=complete evidence="npm test green; files: src/x.ts"
<ISO-8601> blocker  G003 title="…" detail="…"
<ISO-8601> fail     G002 attempt=2 reason="…"
```

### 3. Checkpoint

When a story completes with evidence, tick it in `plan.md` and append the checkpoint event. Evidence is mandatory — no evidence, no tick (same contract as `prd_check`).

### 4. Final quality gate (before completing the initiative)

After the last story ticks, the initiative is **not** done until all three pass:

1. **ai-slop-cleaner** skill pass over the whole diff (slop, duplication, dead code, boundary violations — writer/reviewer lane separation; high-impact cleanup review delegates to `omd-agent-code-reviewer`)
2. **verify** skill pass — run the verification commands, read real output
3. Independent **code review** — delegate to `omd-agent-code-reviewer` (a fresh subagent context; never self-approve in the authoring context)

If the gate is not clean: do **not** complete. Append a new blocker story (e.g. `G0NN resolve-final-review-blockers`) carrying the review findings as its evidence requirement, keep the goal active, and work it.

### 5. Complete / pause / blocked

- **Complete:** `get_goal` first (copy exact `goal_id` + `revision`), then `update_goal({ action: "complete", … })` — only after the final gate is green.
- **Pause/resume:** `update_goal({ action: "pause" })` on user request; `resume` re-arms. Across a session restart the goal is disarmed — read the ledger to rebuild context, then `resume` (or recreate the goal with the same aggregate objective and remaining stories).
- **Blocked:** only when the *same* blocking condition persists for **≥ 3 consecutive goal rounds**; report the concrete condition in `blocked_reason`. Difficulty or remaining work is not blocked.

## Parallel runs (multiple sessions / worktrees)

Two concurrent ultragoal runs in one workspace must not share a plan directory. Use a distinct `<planId>` per run (e.g. `<epochMs>-<slug>`) so artifacts land in `.omd/ultragoal/plans/<planId>/`. Each session holds its own dsh goal — those never conflict. Note each worktree has its own `.omd/`; cross-worktree shared ledgers are a phase-2 design item.

## Do not use when

- Single small change → direct delegation or `ralph`
- Planning-only artifact, no execution loop → `plan`

## State Contract (状态契约)

ultragoal **does not hold omd mode state** (no `state_write`/`state_clear` — it is not an execution mode; the omd keyword router does not activate it). Its persistence lives in two places: the dsh goal (session-scoped, managed via `create_goal`/`get_goal`/`update_goal` — always `get_goal` before `update_goal` to copy the exact id/revision) and the durable repo artifacts `.omd/ultragoal/plans/<planId>/{plan.md,ledger.md}`.
