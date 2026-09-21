---
name: ask
description: Second-opinion advisor lane — route a question to an independent subagent (optionally with a different role card) and persist the answer as an ask artifact
when-to-use: You want an outside perspective on a question or task — a security read of a patch, UX suggestions, a fresh plan draft — from a context that did not author the work. Not for questions answerable from the repo itself (use research).
---

# Ask

> **Port note (read first).** The OMC original routed prompts through local external CLIs (`omc ask <claude|codex|gemini|antigravity|grok|cursor>`). **omd is zero-external-dependency: those CLI advisors are replaced by an independent `subagent` spawned for a second opinion.** The advisor is another model context, not another vendor's CLI. This is a documented substitution, not a hidden gap.

Use omd's advisor lane to route a prompt to a fresh subagent context — optionally with a different role card for a different perspective — and persist the result as an ask artifact.

## Usage

```
ask <role-or-perspective> <question or task>
```

Examples:

```
ask code-reviewer "review this patch from a security perspective"
ask designer "suggest UX improvements for this flow"
ask planner "draft an implementation plan for issue #123"
ask default "sanity-check this migration order"
```

## Routing

**Required execution path — always spawn, never self-answer:**

```
subagent(description="ask: <perspective>", run_in_background=false,
         prompt="<omd-agent-<role> role card, when a role is named>

You are an independent advisor. The following question/task comes from another
context that wants a second opinion. Answer from your own analysis; do not
assume the requesting context's conclusions.

<question or task>")
```

- A named role (`code-reviewer`, `designer`, `planner`, `security-reviewer`, …) selects the matching `omd-agent-*` role card — that is what makes the perspective real.
- `default` (or no role) spawns a plain subagent with no role card.
- The point of the lane is an **independent context**: do not answer the question yourself and relay it as advice.

## Requirements

- None beyond dsh itself — no external CLI to install or authenticate. (OMC's per-provider `claude --version` / `codex --version` / `gemini --version` checks have no omd counterpart.)

## Artifacts

Persist each answer as an ask artifact with the `write` tool:

```text
.omd/artifacts/ask/<role>-<slug>-<timestamp>.md
```

The artifact contains the question, the role/perspective used, and the advisor's full answer. The artifact path is part of the reply so the caller can link it.

## State Contract (状态契约)

Ask **holds no mode state**: the artifact under `.omd/artifacts/ask/` is the whole trail. No `state_write`/`state_clear`; nothing under `.omd/state/`.
