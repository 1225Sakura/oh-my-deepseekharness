---
name: team
description: Explicit-invocation multi-agent pipeline — the lead orchestrates role-carded subagents through a five-stage pipeline with mandatory stage handoffs
when-to-use: EXPLICIT INVOCATION ONLY ("use team to …", "/team …"). No keyword trigger — the word "team" in ordinary text must NOT activate this skill, and inside worker sessions the whole keyword routing table is inert. Use for parallel multi-agent execution of a decomposable task. **Since v0.4 there IS a leader runtime** (lib/team.js): the phase state machine (`team_phase_transition`), worker UUID lifecycle (`team_register_worker`/`team_worker_update`/`team_registry`), mailbox (`team_mail_*`), heartbeat scan (`team_heartbeat_scan`), and merge planning (`team_merge_plan`) are all available as MCP tools. Actual spawning is still done by the lead via `subagent`/`omd_delegate` (the runtime owns lifecycle + coordination data, not dispatch decisions); there is no tmux pane guardian (no dsh surface, 🚫).
---

# team

<Purpose>
The lead session decomposes a task, spawns role-carded subagent workers in the background, and drives them through a canonical five-stage pipeline with mandatory handoff documents between stages. This is a rewrite of the OMC team skill for dsh: teammates are `subagent` spawns, coordination is `send_message` + `list_agents`, and there is no tmux, no CLI workers, no shared SQLite — those OMC surfaces deliberately do not exist here.
</Purpose>

<Hard_Constraints>
- **Explicit invocation only. No keyword trigger.** (OMC v5 removed it on purpose: the word "team" inside worker prompts would cause infinite spawning.) Inside worker sessions, keyword routing is entirely inert — a worker prompt is delegation text, never a mode trigger.
- **Modes are mutually exclusive (MVP):** while team is active, autopilot/ralph must not start, and vice versa. Read state before starting.
- **The lead orchestrates; workers execute.** A worker is always a leaf (see Worker Protocol).
</Hard_Constraints>

## Pipeline

```
team-plan → team-prd → team-exec → team-verify → team-fix (bounded loop) → complete | failed | cancelled
```

### Stage role routing

| Stage | Required agents | Escalation |
|---|---|---|
| team-plan | `omd-agent-explore` (low) + `omd-agent-planner` (high) | — |
| team-prd | `omd-agent-analyst` (high) | skippable only when scope + acceptance criteria are already explicit — record that decision in the handoff |
| team-exec | `omd-agent-executor` (medium), parallel workers | — |
| team-verify | `omd-agent-verifier` (medium) — **always runs** | **>20 changed files or security-sensitive changes: add `omd-agent-code-reviewer` (high)** |
| team-fix | `omd-agent-executor` (medium) | — |

**team-fix bound:** `max_fix_loops = 3`. The loop is exec → verify → fix → exec …; exceeding 3 fix loops transitions to terminal `failed` with evidence — never an infinite loop. **This bound is enforced by the phase state machine** (`team_phase_transition` rejects fix→exec beyond the limit, leaving only failed/cancelled).

### Runtime tool surface (v0.4+, lib/team.js exposed via MCP)

| Tool | Purpose | When to call |
|---|---|---|
| `team_phase_transition({ cwd, runId, to, note? })` | Phase transition (state-machine validated, illegal transitions rejected) | at every phase change (same critical point as the handoff) |
| `team_phase_status({ cwd, runId })` | Read phase state (phase/fixLoops/history) | first thing on resume |
| `team_register_worker({ cwd, runId, worker })` | Register a worker's lifecycle (workerId auto `w-<uuid8>`; runId is the owner-epoch) | **immediately after every worker spawn** (record dispatchId/agentId too) |
| `team_worker_update({ cwd, runId, workerId, patch })` | Status flow (dispatched→running→blocked/done/failed; terminal states are final) | on worker status changes |
| `team_worker_heartbeat({ cwd, runId, workerId })` | Worker heartbeat (resets stale) | the lead beats on each worker report |
| `team_mail_send / team_mail_read / team_mail_ack` | Mailbox: in=worker→lead (progress/blocker/done/question), out=lead→worker (nudge/assign/answer) | blockers/questions must land as mail; the lead acks after handling |
| `team_heartbeat_scan({ cwd, runId })` | Stale detection + unacked blocker/question summary (**never auto-kills**) | every time the lead is active (the deterministic Watchdog) |
| `team_merge_plan({ cwd, runId })` | Tree∩main conflict candidates + suggested merge order (plan only; execution stays with the lead/executor) | after verify passes, before tree teardown/merge |

Data lives in `.omd/team/<runId>/{phase.json, registry.json, mailbox/{in,out}/<workerId>.jsonl}` — append-only/atomic writes; after a crash, resume by reading these before the handoffs.

### Stage handoff (mandatory)

Context that lives only in the lead's conversation is lost on compaction or restart. Therefore **every completing stage MUST write `.omd/handoffs/<stage>.md`** (via `mcp__omd-state__handoff_write`; plain file tools if MCP is down) BEFORE the next stage spawns:

```markdown
# Handoff: <stage>

## Decided
key decisions made this stage
## Rejected
alternatives considered and why they were rejected
## Risks
risks the next stage must know
## Files
key files created or modified
## Remaining
items left for the next stage
```

（与 `handoff_write` 工具的产出格式一致：一级标题 + 五个独立小节；五段必填，单段超 20 行会被截断并警告。）

Rules:

1. 10–20 lines max — decisions and rationale, not full specs (those live in deliverable files).
2. **The lead reads ALL prior handoffs before spawning the next stage** and injects their content into the worker spawn prompts, so workers start with full context.
3. Handoffs accumulate (verify reads plan + prd + exec) and survive cancellation for resume.

## Lead workflow

1. **team-plan**: spawn `explore` (codebase/context scan) and `planner` (decomposition) in background parallel — **register each with `team_register_worker` right after spawning**. Decompose into file-scoped tasks, independent or clearly dependency-ordered, each with subject + detailed description + verification command. Write the handoff, then `team_phase_transition` to the next stage.
2. **team-prd**: `analyst` extracts acceptance criteria and boundaries when scope is ambiguous. Write the handoff.
3. **team-exec**: spawn executor workers with `subagent` (background is the default — spawn all in parallel, never serialize independent workers), **registering each immediately via `team_register_worker`** (role/tier/phase/dispatchId). Each worker prompt = role card content + Worker Protocol (verbatim) + its assignments + all prior handoffs + its workerId (needed for report mail). Track the assignment table in your own `todo_write`.
4. **Monitor**: worker results arrive as settlement notices — **yield; never poll**. Run `team_heartbeat_scan` on every activity (see Watchdog); steer running or idle workers with `send_message`; beat `team_worker_heartbeat` for each reporting worker.
5. **team-verify**: verifier is mandatory; add code-reviewer per the escalation rule. Reviewers verify against the acceptance criteria with fresh command evidence. Write the handoff. After verify passes and before tree teardown/merge, run `team_merge_plan`.
6. **team-fix**: bounded to 3 loops (state-machine enforced); spawn fix executors with the findings; loop back to team-exec/team-verify.
7. **Terminal**: complete | failed | cancelled (land it with `team_phase_transition`) → Shutdown Protocol, then State Contract cleanup.

## Worker Protocol (inject verbatim into every worker prompt)

```
You are WORKER "<worker-N>" reporting to the lead. Six steps:

1. CLAIM — your assignment arrives in this prompt or a later lead message;
   acknowledge it and mirror it into your own todo_write (in_progress).
2. WORK — execute directly with your own tools.
3. COMPLETE — mark your todo completed only with verification evidence in hand.
4. REPORT — your final assistant message IS the deliverable: full structured
   result (changes made, evidence, raw verification output). No "done"-style
   empty endings.
5. NEXT — if the lead has sent follow-up work, continue at step 1; otherwise
   state clearly that you are standing by.
6. SHUTDOWN — on the lead's shutdown instruction, confirm and stop.

BLOCKED tasks: if a dependency is unfinished, skip the task and report it
blocked to the lead — never half-do it and never mark it completed.

== LEAF-GUARD (absolute) ==
- NEVER spawn sub-agents / grandchild agents (no subagent / subagent_fork).
- NEVER use orchestration tools: workflow, ralph, create_goal / update_goal.
- NEVER activate execution modes — keyword routing is inert in your session.
- You are a leaf executor. Any violation = task failure.
```

## Watchdog (heartbeat-scan driven)

Since v0.4 there are two heartbeat layers (the dsh rewrite of OMC's wall-clock thresholds, boundary stated honestly):

- **Plugin-side periodic detection** (Config `team.heartbeatIntervalMs`, default 60s, 0=off): a background timer scans `.omd/team/*/registry.json` and surfaces stale workers + outstanding mail to the host log — **detection only, never nudging** (the plugin cannot speak for the model; nudging is your job).
- **Lead-side on-demand scan**: on every lead activity (a worker report arrives, a stage transitions) you MUST run `team_heartbeat_scan({ cwd, runId })` — the deterministic Watchdog:
  - `stale` workers (no heartbeat beyond `staleAfterMs`, never auto-killed) → `send_message` asking for status; still silent by your next activity → stop it with `interrupt_agent` first, mark it failed via `team_worker_update`, reassign its tasks, and respawn a replacement if needed (a replacement registers a NEW workerId via `team_register_worker`).
  - `outstanding` (unacked blockers/questions) → handle each, then `team_mail_ack`.
  - Also run `list_agents` to reconcile who is running / idle / ready against the registry (the registry is the authoritative lifecycle ledger).
- A worker that fails **2+ consecutive tasks** → stop assigning it new work.
- Waiting means yielding and ending your turn — worker completions wake you. Never busy-poll, never sleep-loop.

## Shutdown protocol (ordered, blocking)

1. Verify every task reached a terminal state (completed with evidence, or failed with a recorded reason).
2. Send each active worker a shutdown instruction via `send_message`.
3. Wait for each worker's acknowledgement (arrives as its final message / settlement notice).
4. Only after ALL workers confirmed or were judged dead: `mcp__omd-state__state_clear({ cwd, sessionId, mode: "team" })`.
5. Report the summary to the user.

Never clear team state before the shutdown pass completes.

## Coordination discipline

- Background spawn by default; never wait on one worker before spawning the next independent one.
- Steer with `send_message`; never respawn a worker just to deliver guidance.
- Yield while waiting; no polling loops.
- Do not duplicate a running worker's task; do not re-delegate delegated work.
- **Fan-out of ~5+ homogeneous tasks → switch to the `workflow` tool**: write a JS orchestration script whose `agent()` calls take explicit `provider`/`model` — the only delegation path where model routing is HARD. Fill them from the active routing table (role → tier → model, from the plugin Config). Note: plain `subagent` spawns inherit the main-session model; role-card tiers are advisory on that path (soft routing, stated honestly).

## Resume / cancel

- **Resume**: read team state + all handoffs; restart from the last non-terminal stage; never spawn duplicate workers for already-assigned tasks.
- **Cancel** (`/omd-cancel` or user stop): run the shutdown protocol best-effort, then `state_clear`. Handoffs and plans are preserved. Terminal states: `complete`, `failed`, `cancelled`.

## Degradation

`subagent` unavailable → the lead executes every stage sequentially itself and announces "single-agent mode"; model routing is then fully inert. `workflow` unavailable → stay on background `subagent` fan-out regardless of task count.

## State Contract (状态契约)

**Call shape convention**: `cwd` (current workspace path) and `sessionId` (current session id) are REQUIRED top-level params of every `state_*` call; mode fields nest under the `state` key.

- **Start**: first call `mcp__omd-state__team_begin({ cwd, runId, stateDir })` to provision the worktree (c5) — this returns orphans (manual cleanup) and the new runId + head. Then `state_write({ cwd, sessionId, mode: "team", state: { active: true, started_at: <ISO 8601>, current_phase: "team-plan", prompt_echo: <compressed ≤1200 chars>, team_name: <slug>, fix_loop_count: 0, max_fix_loops: 3 } })`. State file: `.omd/state/sessions/{sessionId}/team-state.json`. If cwd is inside the new worktree, prefer `mcp__omd-state__team_write_tree_state` for non-state writes (c8 — keeps parent `.omd/` clean).
- **Stage transitions**: on EVERY stage change do three things: ① `team_phase_transition({ cwd, runId, to, note })` — the phase state machine is authoritative (it enforces the fix-loop bound); ② `state_write` with updated `state.current_phase` (`team-plan|team-prd|team-exec|team-verify|team-fix|complete|failed|cancelled`) and stage history; ③ `team_write_mirror({ cwd, stateDir, patch: { mode: 'team', round, current_story, active_agents, todo }, expectUpdatedAt })` — c6 mirrors the seven-field snapshot into `.omd/state/run-state.json` (CAS-conflict retry ≤3, version +1 each write; reconcile active_agents against the registry).
- **Complete / cancel**: shutdown pass first (notify all workers, await confirmations), then `mcp__omd-state__team_dispose({ cwd, runId, reason: 'verified' | 'cancelled', expectUpdatedAt })` (c5 two-phase teardown — CAS-write disposed → delete tree), then `state_clear({ cwd, sessionId, mode: "team" })`. `.omd/handoffs/` and `.omd/plans/` are never deleted.
- **Abnormal exit**: state + handoffs remain for resume; state untouched for >2h is stale — report, don't auto-resume.
- **MCP server down**: same reads/writes with plain file tools against `.omd/`, announced explicitly.
