---
name: remember
description: Review reusable project knowledge and decide what belongs in project memory, notepad, or durable docs
when-to-use: The user wants to preserve or organize useful knowledge discovered during a session — promoting durable facts, operator preferences, or hard-won findings into the right memory surface. Not for transient task state.
---

# Remember

Use this skill when the user wants to preserve or organize useful knowledge discovered during a session.

## Goal

Promote durable, reusable knowledge into the right memory surface instead of leaving it buried in chat history.

## Memory surfaces (omd mapping)

- **Project memory** — durable team/project knowledge. Write with the in-plugin tool `omd_memory_set({ projectPath, key, value })`, read with `omd_memory_get`, remove with `omd_memory_delete` (profile-level storage, isolated per project path — this replaces OMC's `project_memory_*` MCP tools and `.omc/project-memory.json`; see the spec divergence table).
- **Notepad priority** — short high-signal context meant to survive indefinitely. Write with `mcp__omd-state__notepad_write_priority({ cwd, text })`.
- **Notepad working** — temporary active-session notes (7-day TTL). Write with `mcp__omd-state__notepad_write_working({ cwd, text })`.
- **Docs / AGENTS files** — durable instructions and conventions that truly belong in the repo (`AGENTS.md`, `CLAUDE.md`, `docs/`) — edit them directly only when the knowledge is repo doctrine.

Note: OMC captured `<remember>x</remember>` tags from model output via a hook. dsh has no equivalent hook surface, so omd makes capture an **explicit tool call** — there is no tag syntax; call the notepad tool directly (spec divergence table).

## Workflow

1. Gather the relevant session findings.
2. Classify each item:
   - durable project fact
   - temporary working note
   - operator preference or instruction
   - duplicate / stale / conflicting information
3. Propose the best destination for each item.
4. Write or update only the appropriate memory surface.
5. Call out duplicates or conflicts that should be cleaned up.

## Rules

- Do not dump everything into one store.
- Prefer project memory (`omd_memory_*`) for durable team knowledge.
- Prefer notepad for short-lived working context.
- Keep entries concise and actionable.
- If something is uncertain, mark it as uncertain rather than storing it as fact.

## Output

- What was stored
- Where it was stored
- Any duplicates/conflicts found

## State Contract (状态契约)

Remember **holds no mode state**. It performs no `state_write`/`state_clear`; its only persistence is the memory surfaces above — notepad entries under `.omd/notepad.md` (via the MCP tools) and project memory in profile-level storage (via `omd_memory_*`). When running inside an enclosing mode, that mode's state contract governs mode persistence.
