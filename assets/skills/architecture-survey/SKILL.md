---
name: architecture-survey
description: "Periodic architecture survey — walk the module graph and report ranked deepening candidates (shallow modules, hypothetical seams, logic behind the wrong seam). Survey, not rescue: it finds candidates and hands them over with evidence; it never refactors on its own."
when-to-use: 每隔数天活跃构建后、一批 ticket 落地后，或仓库「比上周更难改」时做周期性架构盘点；只产出排序候选，不动手修。
---

**A surveyor charts the reef; the captain decides whether to dredge.** The survey reads the water, reports what it found with evidence, and stops. It is the maintenance twin of the analyze channel: analyze answers one deep question with a confidence-graded verdict; the survey answers "where is this repo getting harder to change, and what would deepen it" — periodically, and in ranked bulk.

## When to survey

- Periodically — every few days of active building, or after a batch of tickets lands.
- Out of turn, when edits start touching more files than they should, interfaces grow to satisfy one caller, or tests must change in lockstep for unrelated reasons.

Scope the survey to one directory when the ask names one; otherwise cover the repo, weighted toward where future edits will land (read recent history first; let hot spots pull the walk).

## The survey

1. Read the repo's own rule surfaces first — AGENTS.md / CLAUDE.md / design docs and any architecture notes (for omd's own repo: docs/ and the omd wiki) — for the local definitions of seam and deep module.
2. Walk the module graph of the target area. Look for three finding classes:
   - **Shallow modules** — wide interface, thin behavior; callers know more than the module hides.
   - **Hypothetical seams** — a boundary crossed by exactly one adapter with no second caller; checkable by counting callers.
   - **Logic behind the wrong seam** — behavior living on the far side of a boundary that does not own its data.
3. Apply the **demolition test** to every suspect: if the module were removed, would its complexity vanish (a pass-through wearing a uniform) or reappear across its callers (load-bearing)? Only load-bearing shallowness is a finding.

## The report

Rank candidates by leverage against risk. Each candidate carries:

- **Evidence** — file:line for the interface, its callers, and the behavior.
- **The deepening move** — what to deepen, merge, or move, in one sentence.
- **The risk note** — what the move touches and what could break.

Every candidate states three vocabulary fields — **severity** (how much friction the shallowness causes), **confidence** (a survey finding is heuristic-class and therefore low by construction; the mechanically checkable end belongs to deterministic audits like the drydock --check), and **actionable** (is the deepening move specific enough to start from the report alone). End with the **top recommendation**: the one candidate to deepen first, and why.

**Survey, not rescue.** Findings are handed to the captain (or a planned ralph/team run) — the survey never refactors, patches, or "fixes one small thing" on its own. The boundary is the same one that keeps an audit from becoming an edit: evidence in, candidates out, hands off.

## Division of labor

| need | surface |
|---|---|
| one deep question, confidence-graded verdict | analyze channel |
| periodic ranked candidate list | this survey |
| deterministic rule checks | drydock --check / lint / CI |
| actually deepening a candidate | execute / a planned exec run |
