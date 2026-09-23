---
name: performance-goal
description: Evaluator-gated performance optimization workflow — baseline measurement, bottleneck analysis, small reversible optimizations, re-measurement loop, gated completion
when-to-use: The user asks to optimize performance and wants a goal-oriented loop with a measurable target rather than a one-off review. Requires an evaluator command and a pass/fail contract before any optimization starts.
---

# Performance Goal Workflow

Use this skill when the user asks to optimize performance and wants a goal-oriented loop rather than a one-off review. For a one-off performance audit without a numeric target, use `review` / `omd-agent-performance-reviewer` instead.

## Contract

- Durable workflow state lives under `.omd/perf/<slug>/` (plain files: `state.json`, `checkpoints.md`) — **OMX's `omx performance-goal` CLI has no dsh equivalent**; write and read these artifacts with the `write` / `read` / `edit` file tools instead of shelling out to a CLI.
- The dsh native goal tools (`create_goal` / `get_goal` / `update_goal`) own the active-session focus and continuation accounting — they replace Codex goal mode. `create_goal` must set `max_goal_rounds` (default 10).
- No optimization work may start until an evaluator command and a pass/fail contract exist.
- Do not call `update_goal` with action `complete` until the evaluator has a passing checkpoint and a completion audit proves the objective is done. `update_goal` requires the exact `goal_id` and `revision` from a fresh `get_goal` call — always read before writing.

## Setup (replaces `omx performance-goal create`)

1. Slug the objective (e.g. `startup-latency`).
2. Write `.omd/perf/<slug>/state.json`:

```json
{
  "objective": "Reduce CLI startup latency by 20%",
  "evaluatorCommand": "npm run perf:startup",
  "evaluatorContract": "PASS when p95 latency improves by 20% and regression tests pass",
  "slug": "startup-latency",
  "baseline": { "metric": "p95 ms", "value": null, "measuredAt": null },
  "lastValidation": { "status": "none", "evidence": null, "at": null }
}
```

3. Run the evaluator command once to fill in the baseline before touching any code — a goal without a measured baseline is not a goal, it is a wish.
4. Start the goal: call `get_goal`; call `create_goal` only when no active goal exists and the objective is explicit, with `max_goal_rounds` set.

## Agent Loop

1. Confirm `.omd/perf/<slug>/state.json` exists; if not, run Setup first.
2. Work only against the evaluator contract.
3. Find the bottleneck before optimizing: profile or instrument the hot path; rank candidate causes by measured share, not by intuition. Delegate deep dives to `omd-agent-tracer` / `omd-agent-analyst` when causality is unclear.
4. Optimize in small reversible patches — one hypothesis per patch.
5. After each patch, run the evaluator and the related regression tests.
6. Record every pass/fail/blocker: append to `.omd/perf/<slug>/checkpoints.md` and update `lastValidation` in `state.json` (status `pass` | `fail` | `blocked`, with evidence and timestamp).
7. Complete only when the pass artifact exists and no required work remains: run a completion audit (evaluator pass + regression tests green + no placeholder shortcuts), then `get_goal`, then `update_goal` with action `complete` using that fresh snapshot.

## Completion Gate

A performance goal is incomplete unless `.omd/perf/<slug>/state.json` contains a `lastValidation.status` of `pass` whose evidence names the evaluator output, and the completion audit is green. Passing ordinary tests alone is not sufficient unless they are the declared evaluator contract.

Lifecycle: `create_goal` starts the session goal (dsh owns continuation across rounds), the loop iterates baseline → bottleneck → patch → re-measure, `update_goal` with action `complete` marks terminal success only after the evaluator and audit pass. If the same blocking condition persists across 3+ goal rounds, call `update_goal` with action `blocked` and a concrete `blocked_reason` instead of spinning.

## Boundaries

- The evaluator command is user- or repo-provided (a benchmark script, a test target, a timing harness). If none exists, creating that harness **is** the first work item — optimization before an evaluator exists violates the contract.
- dsh goal tools are per-session; `.omd/perf/<slug>/` artifacts carry state across sessions. On resume, read the artifacts first, then re-arm with `update_goal` action `resume`.
- For multi-objective performance programs (several slugs sequenced), escalate to `ultragoal` rather than stacking goals in one session.
