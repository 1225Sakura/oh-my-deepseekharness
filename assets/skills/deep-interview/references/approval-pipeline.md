---
name: approval-pipeline
description: Reference detail for the deep-interview 3-stage approval-gated pipeline — load only when wiring the handoff to ralplan/autopilot or auditing gate semantics.
---

### The 3-stage approval-gated pipeline

```
Stage 1: deep-interview   →  Stage 2: ralplan consensus   →  Stage 3: separate approval
Socratic Q&A + scoring       Planner → Architect → Critic     User explicitly chooses
Gate: clarity                Gate: feasibility               Gate: consent — no auto-handoff
Output: spec                 Output: consensus plan           Output: pending approval
```

Each stage gates a different quality axis. Skipping Stage 3 is by design: a refined plan without execution is a valid outcome.

</Steps>

<Tool_Usage>
- `ask_user_question` for every interview question — clickable UI with contextual options.
- `omd-agent-explore` via `subagent` for brownfield exploration — run BEFORE asking the user about the codebase; cite the evidence it returns.
- High tier model for ambiguity scoring — consistency is critical.
- `mcp__omd-state__state_write` / `state_read` for interview state; include `threshold` + `threshold_source` in every payload.
- `write` tool for the final spec at `.omd/specs/deep-interview-<slug>.md` exactly.
- Challenge modes are prompt injections, not separate subagent spawns.
- Bridge to execution modes via the `skill` tool only after explicit execution approval.
</Tool_Usage>

<Escalation_And_Stop_Conditions>
- **Hard cap 20 rounds**; soft warning at 10; early exit allowed from round 3 with a warning when ambiguity > threshold.
- **User says "stop"/"cancel"/"abort"**: stop immediately, keep state for resume.
- **Ambiguity stalls** (±0.05 for 3 rounds): activate Ontologist mode to reframe.
- **All dimensions ≥ 0.9**: skip to spec generation.
- **Codebase exploration fails**: proceed as greenfield, note the limitation.
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Phase 0 completed first; the first user-visible line was the threshold marker with its source
- [ ] State and spec metadata both record `threshold` and `threshold_source`
- [ ] Oversized initial context summarized before scoring/question/spec/handoff
- [ ] Round 0 topology gate completed before scoring; `topology.confirmed_at` persisted
- [ ] Ambiguity displayed after every round; weakest component/dimension named each round
- [ ] Multi-component interviews rotated targeting across active components
- [ ] Challenge modes fired at rounds 4 / 6 / 8, each once
- [ ] Spec written to `.omd/specs/deep-interview-<slug>.md`; includes Topology, Goal, Constraints, Acceptance Criteria, Clarity Breakdown, Ontology + Convergence, Transcript
- [ ] Execution bridge presented via `ask_user_question`; chosen mode invoked via `skill` only after explicit approval — never direct implementation
- [ ] State cleaned up after execution handoff
</Final_Checklist>

<Advanced>
