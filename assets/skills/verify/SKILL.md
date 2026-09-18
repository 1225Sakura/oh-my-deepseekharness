---
name: verify
description: Verify that a change really works before you claim completion
when-to-use: The user wants confidence that a feature, fix, or refactor actually works — before claiming completion, before a commit, or as the independent verification pass after implementation (omd-agent-verifier lane). Not for authoring changes.
---

# Verify

Use this skill when confidence is needed that a feature, fix, or refactor actually works.

## Goal

Turn vague "it should work" claims into concrete evidence.

## Workflow

1. Identify the exact behavior that must be proven.
2. Prefer existing tests first.
3. If coverage is missing, run the narrowest direct verification commands available.
4. If direct automation is not enough, describe the manual validation steps and gather concrete observable evidence.
5. Report only what was actually verified.

## Verification order

1. Existing tests
2. Typecheck / build
3. Narrow direct command checks
4. Manual or interactive validation

## Rules

- Do not say a change is complete without evidence.
- If a check fails, include the failure clearly — quote the raw output.
- If no realistic verification path exists, say that explicitly instead of bluffing.
- Prefer concise evidence summaries over noisy logs.
- As an independent gate, run in a separate context from the author — when delegated, spawn `omd-agent-verifier` via `subagent` (never self-approval in the authoring context).

## Output

- What was verified
- Which commands/tests were run
- What passed
- What failed or remains unverified

## State Contract (状态契约)

Verify **holds no mode state**. Inside an enclosing mode (autopilot validation gate, ralph's independent review layer, team-verify stage) the enclosing mode's state contract governs persistence; verify's deliverable is its evidence report — as a subagent, its final message; in the main session, the verification summary — and no files under `.omd/` are created by verify itself.
