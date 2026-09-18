---
name: plan
description: Strategic planning with optional interview workflow and consensus mode
when-to-use: User wants to plan before implementing ("plan this", "let's plan"), wants structured requirements gathering for a vague idea, wants an existing plan reviewed ("--review"), or wants multi-perspective consensus ("--consensus" / ralplan). Not for autonomous end-to-end execution (autopilot), immediate coding on a clear task (ralph / executor), or simple questions.
---

# plan

<Purpose>
Plan creates comprehensive, actionable work plans through intelligent interaction. It auto-detects whether to interview the user (broad requests) or plan directly (detailed requests), and supports consensus mode (iterative Planner/Architect/Critic loop with RALPLAN-DR structured deliberation) and review mode (Critic evaluation of an existing plan).
</Purpose>

<Execution_Policy>
- Auto-detect interview vs direct mode from request specificity.
- Ask one question at a time during interviews — never batch.
- Gather codebase facts via the `omd-agent-explore` role (load with `skill`, spawn via `subagent`) before asking the user about them.
- Quality bars: 80%+ of claims cite file/line; 90%+ of acceptance criteria are testable.
- Consensus mode runs fully automated by default; `--interactive` enables user prompts at draft review and final approval.
- Consensus uses RALPLAN-DR short mode by default; `--deliberate` or explicit high-risk signals (auth/security, migration, destructive/irreversible change, production incident, compliance/PII, public API breakage) switch to deliberate mode.
- **Planning/execution boundary:** planning modes inspect context and produce plan/spec artifacts only. Artifacts are marked `pending approval` unless the user explicitly opted into execution this turn or via the structured approval UI. Before that approval: no mutation-oriented shell commands, no source edits, no commits/pushes/PRs, no execution-skill invocation, no implementation delegation.
- **Mode selection:** when a plan compares omd execution modes (autopilot goal-loop, ralph fresh-agent loop, team pipeline), name exactly one primary loop authority for the work and follow the protocol layer's mode-mutual-exclusion contract (MVP: modes never run simultaneously).
</Execution_Policy>

<Steps>

## Mode Selection

| Mode | Trigger | Behavior |
|---|---|---|
| Interview | Default for broad requests | Interactive requirements gathering |
| Direct | `--direct`, or a detailed request | Skip interview, plan immediately |
| Consensus | `--consensus`, "ralplan" | Planner → Architect → Critic loop with RALPLAN-DR; `--interactive` adds user gates |
| Review | `--review`, "review this plan" | Critic evaluation of an existing plan |

## Interview Mode (broad/vague requests)

1. **Classify the request**: vague verbs, no specific files, touches 3+ areas → interview mode.
2. **Ask one focused question** via `ask_user_question` (preferences, scope, constraints).
3. **Gather codebase facts first**: spawn `omd-agent-explore` before asking "what patterns does your code use?", then ask informed follow-ups citing what it found.
4. **Build on answers** — each question follows from the previous one.
5. **Consult `omd-agent-analyst`** (high tier) for hidden requirements, edge cases, and risks on non-trivial scopes.
6. **Create the plan** when the user signals readiness: "create the plan", "I'm ready", "make it a work plan".

## Direct Mode (detailed requests)

1. Optional brief `omd-agent-analyst` consultation.
2. Generate the full work plan immediately.
3. Optional Critic review if requested.

## Consensus Mode (`--consensus` / "ralplan")

This mode is exactly the workflow documented in the `ralplan` skill — RALPLAN-DR summary, sequential independent Architect/Critic reviews of one fixed snapshot (Architect → await → Critic, never parallel, no Architect output passed to Critic, Planner-only synthesis), max 5 re-review iterations, final ADR, `--interactive` approval gates. Follow the `ralplan` skill for the full contract; its state lifecycle rules apply here (they are reproduced in the State Contract below).

## Review Mode (`--review`)

1. Read the plan file from `.omd/plans/`.
2. Evaluate it with a Critic pass (`omd-agent-analyst` card + critic stance, spawned via `subagent`).
3. Return verdict: APPROVED, REVISE (with specific feedback), or REJECT (replanning required).

## Plan Output Format

Every plan includes:

- Requirements Summary
- Acceptance Criteria (testable)
- Implementation Steps (with file references)
- Risks and Mitigations
- Verification Steps
- Consensus/ralplan only: **RALPLAN-DR summary** (Principles, Decision Drivers, Options)
- Consensus/ralplan final output: **ADR** (Decision, Drivers, Alternatives considered, Why chosen, Consequences, Follow-ups)
- Deliberate consensus only: **Pre-mortem (3 scenarios)** + **Expanded Test Plan** (unit/integration/e2e/observability)

Plans are saved to **`.omd/plans/`** (consensus plans as `ralplan-<slug>.md`); unfinished drafts live there too, marked `Status: draft`.

</Steps>

<Tool_Usage>
- `ask_user_question` for preference questions (scope, priority, risk tolerance); plain text only for specific values (names, ports, clarifications).
- `omd-agent-explore` (low tier) via `subagent` for codebase facts before asking the user.
- `omd-agent-planner` for planning validation on large scopes; `omd-agent-analyst` for requirements analysis and the Critic pass.
- **CRITICAL — consensus passes are sequential, never parallel.** Await the Architect subagent before issuing the Critic subagent. Same fixed snapshot for both; results combine only in Planner synthesis after both complete.
- In `--interactive` consensus, approval questions go through `ask_user_question` — never plain text. Without `--interactive`: mark the plan `pending approval`, output it, and stop.
- On explicit approval, invoke the `team` or `ralph` skill via the `skill` tool — never implement directly from the planning module.
</Tool_Usage>

<Examples>
Good — fact-gathering before asking:
```
[spawn omd-agent-explore: "find authentication implementation"]
[receives: "Auth is in src/auth/ using JWT with passport.js"]
"I see JWT auth with passport.js in src/auth/. For this feature, extend the
existing auth or add a separate flow?"
```
Good — one question at a time, each building on the last:
```
Q1 "What's the main goal?" → A1 "Improve performance"
Q2 "Latency or throughput?" → A2 "Latency"
Q3 "p50 or p99?" → …
```
Bad — asking what the code already answers ("Where is auth implemented?"); batching three questions in one message; presenting four design options at once (decision fatigue — present one option with trade-offs, get a reaction, then the next).
</Examples>

<Escalation_And_Stop_Conditions>
- Stop interviewing when requirements are clear enough to plan — do not over-interview.
- Consensus mode stops after 5 iterations and presents the best version; state is cleared only on the user's final choice or non-interactive output, never mid-loop.
- If the user says "just do it" / "skip planning" without naming an execution path, end planning with the artifact marked `pending approval` and ask for explicit execution approval via the structured UI — do not invoke execution skills or mutate files.
- Escalate irreconcilable trade-offs requiring a business decision to the user.
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] 90%+ acceptance criteria are concrete/testable; 80%+ claims cite file/line
- [ ] Every risk has a mitigation; no vague terms without metrics ("fast" → "p99 < 200ms")
- [ ] Plan saved to `.omd/plans/`
- [ ] Consensus: RALPLAN-DR summary has 3–5 principles, top 3 drivers, ≥2 options (or invalidation rationale)
- [ ] Consensus final: ADR section included
- [ ] Deliberate: pre-mortem (3 scenarios) + expanded test plan included
- [ ] `--interactive`: explicit user approval before any execution; non-interactive: `pending approval` output only, no auto-execution
- [ ] ralplan state deactivated on every exit path — `state_write(active=false)` for execution handoff, `state_clear` for terminal exits
</Final_Checklist>

## State Contract (状态契约)

- Interview / Direct / Review modes are lightweight: **no mode state is held** — only the plan artifact under `.omd/plans/`.
- Consensus mode holds `ralplan` mode state (shared with the `ralplan` skill):
  - **Entry**: `state_write(mode="ralplan", active=true, started_at=<ISO 8601>, current_phase="consensus")` before the first Planner pass.
  - **Handoff to approved execution** (team/ralph): `state_write(mode="ralplan", active=false)` — deactivate, do NOT clear.
  - **Terminal exit** (rejection, non-interactive output, error): `state_clear(mode="ralplan")`.
  - Never clear mid-loop (Critic approval, max-iteration presentation).
- **Abnormal exit**: state and plan stay on disk; on resume, read state first and continue the loop.
- **MCP server down**: same reads/writes with plain file tools against `.omd/`, announced explicitly.
