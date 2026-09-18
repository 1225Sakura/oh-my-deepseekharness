---
name: review
description: Evaluate finished work for defects, risk, and simplification before it ships
when-to-use: Work already exists and needs evaluation — pre-merge review, the approval pass after an implementation lane, or the "code review" / "代码评审" keyword. Not for authoring changes; review never writes the change it judges.
---

# Review

Use this skill to evaluate work that already exists. Review never authors the change it is judging. This is the canonical review workflow in omd (the OMC source registered as `omc-review`; omd renames it `review` — see the spec divergence table).

## Goal

Find what is actually wrong, ranked by severity, with enough detail to act on.

## Workflow

1. Establish what changed and what it was meant to do (read the spec/plan/handoff under `.omd/` when one exists).
2. Read the change against that intent.
3. Check correctness first, then risk, then simplification.
4. Verify each candidate finding before reporting it.
5. Report findings most-severe first.

## What to check

- **Correctness** — logic defects, edge cases, error paths, concurrency
- **Risk** — security boundaries, destructive operations, data integrity
- **Reuse** — existing utilities or patterns the change should have used
- **Simplification** — code that could be deleted or collapsed
- **Coverage** — behavior that ships untested

## Rules

- Separate lanes: the reviewer must not be the author's same active context. As an independent gate, spawn `omd-agent-code-reviewer` via `subagent` (load the role card with the `skill` tool first).
- Verify before reporting. A plausible-sounding finding that does not reproduce is noise.
- State severity honestly; do not pad the list to look thorough.
- "No findings" is a valid result when the work is sound.
- Advisory by default — review informs, it does not gate. Hard gates (release, security, destructive operations) stay separate and fail closed. When invoked as an explicit review gate (autopilot Phase 4, ralph's independent review layer, team-verify escalation), the calling mode decides how the verdict gates progression.

## Output

- Findings, most-severe first, each with file, line, and a concrete failure scenario
- What was checked and found clean
- Anything that could not be assessed

## State Contract (状态契约)

Review **holds no mode state**. When it runs as a gate inside an enclosing mode (autopilot dual review gate, ralph verifier pass, team-verify), the enclosing mode records the verdict in its own state; review itself creates no files under `.omd/` and performs no `state_write`/`state_clear`.
