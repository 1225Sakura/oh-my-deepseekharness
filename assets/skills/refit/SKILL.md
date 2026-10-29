---
name: refit
description: "Cross-session environment retrospective driven by omd instrumentation - trace timelines, events.jsonl, hb.log, notepads. Every finding lands on the surface that owns the fix (deterministic check, steering volume, tooling, or information access); nothing lands without user approval."
when-to-use: 回顾数个会话/运行累积的环境摩擦（不是代码评审、不是单次 run 复盘）；把仪表面记录的摩擦转成环境修复，逐条经用户批准落地。
---

Refit surveys the environment the agent worked in - not the code it produced (review and verify own that) and not one run's lessons. Every kind of work leaves friction behind: a ralph loop that kept tripping on the same check, an autopilot run stalled waiting for a signal, a debugging session whose decisive output was never captured. omd instruments all of it. Refit reads the instruments and converts recorded friction into environment changes, so the next run starts in a better yard.

## Evidence first

Start from the instruments, not a checklist. Read before asking the user anything:

- `trace_summary` / `trace_list` (MCP) - where turns stalled, repeated, or fanned out wastefully
- `events_read` (MCP) - the dispatch audit trail (route/fallback 1:1)
- `.omd/hb.log` and session state under `.omd/state/` - stale workers, swallowed failures
- notepad (working zone) - problems that accumulated across recent sessions
- the repo's own check surface (`package.json` scripts, CI workflows) - read before proposing any new check, because a check that exists but sits unwired or silently broken is the finding, not a reinvention

Findings emerge from what the data shows. An empty survey is a valid result, stated plainly; an invented finding is the same violation as skipping the survey.

## Four fix-owner surfaces

Every finding names the surface that owns its fix. A finding that fits no surface is declined, explicitly and with the reason.

1. **Deterministic check** - the failure was mechanical (fixed syntactic pattern, banned API, import shape, file-location rule). The fix is a lint rule, gate test, or CI job - whichever existing guardrail makes it cheapest. Default to building the check over writing the rule.
2. **Steering surface** - the failure was judgement no guardrail substitutes for (cross-file consistency, matches-surrounding-style). The fix lands in AGENTS.md / docs / the omd wiki - navigation pointers over prose.
3. **Tool surface** - the drag was tooling itself (token-inefficient MCP calls, missing automation, checks too slow to run when they matter). The fix lands in Config keys, `scripts/`, or the plugin's tool surface.
4. **Information surface** - the agent needed a signal it could not reach (dev-server logs, service state, remote access). The fix tees the log, exposes the state, or documents the access path.

## The approval gate - refit vs self-improve

self-improve edits code autonomously (tournament-selected, no gate). **Refit never lands anything without the user's explicit approval**: the survey produces a findings table (finding / evidence / owning surface / proposed fix), the user approves lines individually, and only approved lines become changes. A refit run that edits without approval has violated its one hard rule.

## Division of labor

| need | surface |
|---|---|
| code-quality findings on produced code | review / verify |
| autonomous code improvement | self-improve (no approval gate) |
| knowledge sedimentation | remember / wiki |
| environment friction to approved environment fixes | this card |
