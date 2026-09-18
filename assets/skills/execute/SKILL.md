---
name: execute
description: Carry an approved task through to working, verified code
when-to-use: The work is understood and the job is to build it — an approved plan or spec exists and needs implementing with verification evidence. Not for vague ideas (plan or deep-interview first) or pure evaluation of existing work (review/verify).
---

# Execute

Use this skill when the work is understood and the job is to build it. This is the canonical execution workflow: `autopilot`, `ralph`, and `team` route their implementation work through these rules.

## Goal

Take a task from agreed intent to working code, with evidence that it works.

## Workflow

1. Confirm the task is clear enough to build. If it is not, plan first (`plan` / `deep-interview`).
2. Break the work into independent units; run genuinely independent units in parallel.
3. Implement the smallest correct change per unit, reusing existing utilities and patterns.
4. Verify as you go, not only at the end.
5. Report what changed, what was verified, and what remains.

## Scale

Match the machinery to the task:

- **Single unit** — implement directly, verify, done.
- **Several independent units** — delegate to `omd-agent-executor` subagents in parallel (load the role card with the `skill` tool; background spawn is the default).
- **Long-running or unbounded** — keep a durable task list with `todo_write` and continue until it is empty.
- **Needs coordinated parallel workers** — use the `team` skill.

Do not spin up coordination for work that one focused pass would finish.

## Rules

- Prefer deletion over addition when behavior is preserved.
- Do not add dependencies without an explicit request.
- Keep diffs small and reversible.
- Placeholder TODOs, `test.skip`, and stub tests are blockers, not progress.
- Authoring and approval are separate passes — do not self-approve in the same active context; hand off to `review` or `verify` (spawn `omd-agent-code-reviewer` / `omd-agent-verifier` as separate subagents).

## Completion

Before claiming done:

- No pending tasks
- Tests pass, or failures are reported plainly
- Verification evidence collected (commands run, raw output read)

## Output

- Files changed
- What was implemented
- Evidence it works
- What is still open

## State Contract (状态契约)

Execute is a lightweight workflow and **holds no mode state** — no `state_write`/`state_clear` of its own. When invoked inside an enclosing mode (autopilot phase 2, ralph round, team-exec stage), the enclosing mode's state contract governs persistence; execute only maintains its working task list via `todo_write` and leaves durable artifacts (plans, handoffs) under `.omd/` untouched.
