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

## Merge-readiness mode (opt-in dual-lane gate)

When explicitly used as a merge gate ("merge-ready review", "pre-release dual-lane"), review upgrades from single-lane advisory to a dual-lane independent gate:

1. **Record scope**: record the review scope first (`git status --short` + `git diff --stat`); never widen it silently.
2. **Parallel lanes**: spawn two clean-context reviewers via `subagent`, neither seeing the other's output; load each role card with the `skill` tool first and embed the lane contract explicitly in the lane prompt — `omd-agent-code-reviewer`: "review security/quality/performance/best practices/maintainability only, not architecture; return file:line evidence and an APPROVE / REQUEST CHANGES / COMMENT verdict" (findings rated CRITICAL/HIGH/MEDIUM/LOW); `omd-agent-architect`: "return file:line evidence and an Architectural Status: CLEAR / WATCH / BLOCK (CLEAR = no concerns, WATCH = non-blocking concerns, BLOCK = merge blocker)" — this vocabulary is not in the architect role card and must come from the lane prompt. Do not pass `model`/`reasoning_effort` overrides to review lanes.
3. **Evidence gate (fail-closed)**: APPROVE iff code-reviewer=APPROVE ∧ architect=CLEAR ∧ both lanes returned evidence. Any missing or failed lane = an "independent review unavailable" blocking state — never an approval fallback; do not substitute the authoring lane.
4. **Synthesis matrix**: architect=BLOCK → REQUEST CHANGES; else reviewer=REQUEST CHANGES → REQUEST CHANGES; else architect=WATCH → COMMENT; else follow the reviewer's verdict.
5. **Finding discipline**: every finding names `file:line` + the issue + risk + a concrete fix; facts separated from suggestions.
6. **Report contract**: the final report presents both lanes' original verdicts side by side with the synthesized verdict; architect BLOCK items go first and must not be buried; an unavailable state is reported as "independent review unavailable", never recorded as APPROVE or merge-ready.
7. Boundary: the default advisory posture and all other gates are unchanged — other explicit gates (the autopilot dual-review gate, ralph's independent review layer, team-verify escalation) remain defined by their own modes; this mode serves independently invoked merge gates. It holds no mode state and never calls `state_write`/`state_clear`.

(Adapted from the OMX code-review card — gate matrix, fail-closed unavailable state, and dual-lane discipline are ported verbatim; OMX-specific surfaces (`omx state write` CLI, hook-owned `skill-active-state.json`, and the Autopilot `handoff_artifacts.code_review`→`ultraqa` flow) are intentionally not carried: verdicts and follow-up flow belong to the invoking outer mode's own state. Upstream: reference/oh-my-codex/skills/code-review. This section must be written identically (translated) into both SKILL.zh.md and SKILL.md.)
