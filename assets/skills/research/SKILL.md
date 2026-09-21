---
name: research
description: Investigate an open question and return grounded, sourced findings
when-to-use: The next step depends on something not yet known — codebase facts, external SDK/framework/API behavior, history. Research answers questions; it does not implement. Not for stateful iterative improvement loops (use autoresearch).
---

# Research

Use this skill when the next step depends on something not yet known. Research answers questions; it does not implement.

This is the canonical research lane. OMC's retired `deep-dive` / `sciomc` lanes converge here; in omd, `autoresearch` is a separate stateful improvement loop, not a research entry point.

## Goal

Replace assumptions with evidence, and say plainly what remains uncertain.

## Workflow

1. State the question precisely enough to know when it is answered.
2. Search the repo and its docs first — `grep` / `glob` / `read`; local evidence outranks recollection.
3. For external SDKs, frameworks, or APIs, consult official documentation via `web_search` / `read_page`.
4. Sweep more than one way when the answer could hide: by file, by symbol, by caller, by history (`git log` / `git_diff`).
5. Synthesize into findings, each tied to where it came from.

## Scale

- **Narrow lookup** — answer it directly.
- **Multiple independent questions** — investigate in parallel: spawn background `subagent`s (`omd-agent-explore` for code questions, `omd-agent-document-specialist` for external documentation).
- **Unknown-size discovery** — keep going until additional passes surface nothing new.

## Rules

- Cite the source: file and line, or the document/URL consulted.
- Distinguish what was verified from what was inferred.
- Report contradicting evidence rather than picking the tidier story.
- Do not implement as a side effect of researching.

## Output

- The question
- Findings, each with its source
- What remains unknown or unverifiable
- Recommended next step, if one follows

## State Contract (状态契约)

Research **holds no mode state**. Findings are delivered as the final message (when running as a subagent) or the session summary; durable facts worth keeping go to `mcp__omd-state__notepad_write_priority` / `notepad_write_working`. Research itself creates no files under `.omd/state/`.
