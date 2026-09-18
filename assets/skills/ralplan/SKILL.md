---
name: ralplan
description: Consensus planning entrypoint that auto-gates vague ralph/autopilot/team requests before execution
when-to-use: User says "ralplan" or wants a consensus-refined plan before execution; also the redirect target when a ralph/autopilot/team request is too vague to execute (no file paths, symbols, issue numbers, or testable anchors). Not for well-specified requests that can execute directly.
---

# ralplan (Consensus Planning Alias)

Ralplan is the shorthand entrypoint for `plan --consensus`. It runs iterative planning with Planner, Architect, and Critic passes until consensus, using **RALPLAN-DR structured deliberation** (short mode by default, deliberate mode for high-risk work).

## Usage

```
ralplan "task description"
ralplan --interactive "task description"
```

## Flags

- `--interactive`: user prompts at the two key decision points (draft review in step 2, final approval in step 6). Without it the workflow runs fully automated — Planner → Architect → Critic loop — marks the final plan `pending approval`, outputs it, and stops without asking or executing.
- `--deliberate`: force deliberate mode for high-risk work — adds a pre-mortem (3 scenarios) and an expanded test plan (unit/integration/e2e/observability). Without the flag, deliberate mode still auto-enables when the request explicitly signals high risk (auth/security, migrations, destructive changes, production incidents, compliance/PII, public API breakage).
- `--architect <provider>` / `--critic <provider>`: OMC could outsource these passes to an external CLI. omd has no external-CLI dependency (spec dependency boundary), so these flags are accepted for compatibility and fall back to the default role-card passes with a one-line note.

## Planning/Execution Boundary

Ralplan is a planning module. It may inspect context and draft or update plan artifacts, but it MUST mark them `pending approval` unless the user has explicitly opted into execution in the current turn or via the structured approval UI. Before explicit execution approval it MUST NOT run mutation-oriented shell commands, edit source files, commit, push, open PRs, invoke execution skills, or delegate implementation tasks.

## Role mapping (omd MVP roster)

The OMC Architect/Critic passes map onto the omd MVP roster:

| Pass | omd role card | Stance injected into the delegation prompt |
|---|---|---|
| Planner | `omd-agent-planner` (high) | plan authorship + RALPLAN-DR summary |
| Architect | `omd-agent-planner` (high) | architectural soundness review, steelman antithesis |
| Critic | `omd-agent-analyst` (high) | quality/testability evaluation, verdict APPROVE/ITERATE/REJECT |

Spawn each pass as a `subagent` (load the role card with the `skill` tool first). The two review passes get the **same fixed plan snapshot** and run **strictly sequentially**.

## Consensus workflow

1. **Planner** creates the initial plan and a compact **RALPLAN-DR summary** before any review:
   - Principles (3–5)
   - Decision Drivers (top 3)
   - Viable Options (≥2) with bounded pros/cons; if only one option remains, an explicit invalidation rationale for the rejected alternatives
   - Deliberate mode only: pre-mortem (3 failure scenarios) + expanded test plan (unit/integration/e2e/observability)
2. **User feedback** (*--interactive only*): present the draft plan plus the Principles/Drivers/Options summary via `ask_user_question` — Proceed to review / Request changes / Skip review. Otherwise proceed automatically.
3. **Architect** reviews the fixed snapshot for architectural soundness: strongest steelman antithesis, at least one real tradeoff tension, and (when possible) synthesis; deliberate mode also flags principle violations. **Await completion before step 4.** Architect output MUST NOT reach the Critic.
4. **Critic** evaluates the same fixed snapshot independently — as a separate, individually awaited `subagent` call issued only after step 3 completes: principle-option consistency, fair alternatives, risk mitigation clarity, testable acceptance criteria, concrete verification steps. Deliberate mode: MUST reject a missing/weak pre-mortem or expanded test plan.

   > **Independent sequential reviews of one fixed plan snapshot.** Never run Architect and Critic in parallel. Neither review mutates the snapshot. Results are combined only by the Planner during revision, after both reviews complete.
5. **Re-review loop (max 5 iterations)**: any non-`APPROVE` Critic verdict runs the full closed loop — Planner synthesizes both reviews → revise → Architect → Critic → repeat. If 5 iterations pass without `APPROVE`, present the best version to the user with a note that consensus was not reached.
6. On Critic approval, mark the plan `pending approval` unless execution was already explicitly approved. *(--interactive only)* Present via `ask_user_question`: Approve via team (Recommended) / Approve via ralph / Compact then return for approval / Request changes / Reject. Otherwise output the plan and stop.
7. *(--interactive only)* On approval: invoke the `team` skill (parallel execution, recommended) or the `ralph` skill (sequential with verification) via the `skill` tool — never implement directly.

## Output

The consensus plan is written to **`.omd/plans/ralplan-<slug>.md`** and MUST include:

- RALPLAN-DR summary (Principles, Decision Drivers, Options)
- ADR: Decision, Drivers, Alternatives considered, Why chosen, Consequences, Follow-ups
- Testable acceptance criteria and implementation steps with file references
- A short changelog of which reviewer improvements were applied
- `Status: pending approval` until the user explicitly approves execution

## Pre-Execution Gate

### Why the gate exists

Execution modes (ralph, autopilot, team) spin up heavy orchestration. Launched on "ralph improve the app", they burn cycles on scope discovery that belongs in planning. The ralplan-first gate intercepts underspecified execution requests and routes them through consensus planning, guaranteeing explicit scope, a test specification, consensus, and no wasted execution.

### Good vs bad prompts

**Passes the gate** (specific enough for direct execution):
- `ralph fix the null check in src/hooks/bridge.ts:326`
- `autopilot implement issue #42`
- `team add validation to function processKeywordDetector`
- `ralph do:\n1. Add input validation\n2. Write tests\n3. Update README`

**Gated — redirected to ralplan:**
- `ralph fix this` / `autopilot build the app` / `team improve performance` / `ralph add authentication`

**Bypass:** `force: ralph refactor the auth module` or `! autopilot optimize everything`.

### When the gate does NOT trigger

Any ONE concrete signal passes the gate:

| Signal | Example |
|---|---|
| File path | `ralph fix src/hooks/bridge.ts` |
| Issue/PR number | `ralph implement #42` |
| camelCase / PascalCase / snake_case symbol | `ralph fix processKeywordDetector`, `team fix user_model` |
| Test runner | `ralph npm test && fix failures` |
| Numbered steps | `ralph do:\n1. Add X\n2. Test Y` |
| Acceptance criteria | `ralph add login - acceptance criteria: …` |
| Error reference | `ralph fix TypeError in auth` |
| Code block | `ralph add: ```ts … ``` ` |
| Escape prefix | `force:` or `!` |

### End-to-end example

1. User: `ralph add user authentication`
2. Gate: execution keyword + underspecified prompt → redirect to ralplan with an explanation
3. Consensus runs: Planner plans (which files, what auth method, what tests) → Architect reviews → Critic validates
4. On approval the user chooses team (parallel, recommended) or ralph (sequential with verification)
5. Execution starts from a clear, bounded plan

### Troubleshooting

| Issue | Solution |
|---|---|
| Gate fires on a well-specified prompt | Anchor it: file reference, function name, or issue number |
| Want to bypass | Prefix `force:` or `!` |
| Gate misses a vague prompt | The gate catches short prompts with no concrete anchors; add detail or invoke `ralplan` explicitly |
| Redirected but want execution | Pick the structured approval option or name the execution skill explicitly; "just do it" alone only ends planning with a `pending approval` artifact |

## State Contract (状态契约)

- **Start**: `mcp__omd-state__state_write(mode="ralplan", active=true, started_at=<ISO 8601>, current_phase="consensus")` before step 1.
- **Handoff to an approved execution mode** (team/ralph): `state_write(mode="ralplan", active=false)` — deactivate, do NOT clear; the plan path stays referenceable.
- **True terminal exit** (rejection, non-interactive output, abort): `state_clear(mode="ralplan")`.
- **Never** clear at intermediate points (Critic approval, max-iteration presentation) — the user may still request changes.
- The consensus plan under `.omd/plans/` is never deleted by any path.
- **MCP server down**: same reads/writes with plain file tools against `.omd/`, announced explicitly.
