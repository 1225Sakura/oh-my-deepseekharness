---
name: skillify
description: Turn a repeatable workflow from the current session into a reusable dsh skill draft
when-to-use: The current session uncovered a repeatable, hard-won workflow that should become a reusable skill — after a tricky debugging session, a codebase-specific workaround, or a multi-step process worth capturing. Not for generic snippets or library usage examples.
---

# Skillify

Use this skill when the current session uncovered a repeatable workflow that should become a reusable dsh skill.

## Goal

Capture a successful multi-step workflow as a concrete skill draft instead of rediscovering it later.

## Quality Gate

Before extracting a skill, all three should be true:
- "Could someone Google this in 5 minutes?" → No.
- "Is this specific to this codebase, project, or workflow?" → Yes.
- "Did this take real debugging, design, or operational effort to discover?" → Yes.

Prefer skills that encode decision-making heuristics, constraints, pitfalls, and verification steps. Avoid generic snippets, boilerplate, or library usage examples that belong in normal documentation.

## Workflow

1. Identify the repeatable task the session accomplished.
2. Extract:
   - inputs
   - ordered steps
   - success criteria
   - constraints / pitfalls
   - verification evidence
   - best target location for the skill
3. Decide whether the workflow belongs as:
   - a project skill (`.dsh/skills/<name>/SKILL.md` — committable, shared with the team via the repo)
   - a user skill (`~/.dsh/skills/<name>/SKILL.md` — available across all projects for this operator)
   - documentation only
4. When drafting a skill file, output a complete `SKILL.md` that starts with YAML frontmatter.
   - Never emit plain markdown-only skill files.
   - Do **not** write plain markdown without frontmatter.
   - dsh frontmatter (key names may only contain `[A-Za-z-]`):
     ```yaml
     ---
     name: <skill-name>
     description: <one-line description>
     when-to-use: <one line naming the situations that should trigger this skill>
     ---
     ```
   - dsh scans the project root `.dsh/skills/` and the user root `~/.dsh/skills/`; each skill is its own directory containing `SKILL.md` (plus an optional `SKILL.zh.md` for the Chinese copy when the project works bilingually).
   - Remember that uncommitted project skills are still worktree-local until committed or copied to the user-level directory.
5. Draft the rest of the skill file with clear activation conditions, steps, success criteria, and pitfalls. Write for a reader with no chat history (see `agent-doc-discipline`).
6. Point out anything still too fuzzy to encode safely.

## Rules

- Only capture workflows that are actually repeatable.
- Keep the skill practical and scoped.
- Prefer explicit success criteria over vague prose.
- If the workflow still has unresolved branching decisions, note them before drafting.
- One skill, one directory, one `SKILL.md`; frontmatter `name` must match the directory name.

## Output

- Proposed skill name
- Target location
- Draft workflow structure or complete skill file
- Verification or quality-gate notes
- Open questions, if any

## State Contract (状态契约)

Skillify **holds no mode state**. It performs no `state_write`/`state_clear`; its deliverable is the drafted skill file. If the session produced durable knowledge that is not skill-shaped, route it through the `remember` skill's memory surfaces instead of force-fitting it into a skill.
