---
name: omc-doctor
description: DEPRECATED in oh-my-dsh — legacy oh-my-claudecode (OMC) install diagnostics for Claude Code; retained as a migration-side checklist only. For diagnosing the omd installation itself, use omd-doctor.
when-to-use: Only when the user is migrating FROM oh-my-claudecode (Claude Code) TO oh-my-dsh and asks to inspect/clean leftover OMC artifacts (~/.claude hooks, CLAUDE.md markers, plugin cache). For any "diagnose omd" / "omd not working" request, load omd-doctor instead.
---

# omc-doctor (deprecated in omd — migration-side checklist only)

> **Deprecation notice.** The OMC original of this skill diagnosed an *OMC-on-Claude-Code* installation: plugin cache under `~/.claude/plugins/cache/omc/`, `<!-- OMC:START -->` markers in `CLAUDE.md`, legacy curl-installed hooks, and the `omc` CLI. **None of those artifacts exist in oh-my-dsh** — omd is a dsh plugin installed via `dsh plugin add`, carries no CLI, no CLAUDE.md, and no hook scripts. Diagnosing the omd installation is **omd-doctor's** job (host version, registration counts, Config resolvability, MCP smoke, `.omd/` writability, probe matrix). This skill survives only for one scenario: a user who previously ran OMC on Claude Code wants to check for / clean up OMC leftovers while moving to omd.

## When to redirect

- "check my omd install", "omd doctor", "omd not working" → **load `omd-doctor`**, do not run this checklist.
- "I used to use oh-my-claudecode; is anything left over / will it conflict with omd?" → run the checklist below.

## Migration-side OMC leftover checklist (read-only by default)

All paths respect `CLAUDE_CONFIG_DIR` when set; default root is `~/.claude`. Report each row as ✅ clean / ⚠️ note / ❌ leftover found. **Never delete anything without explicit user confirmation** — this skill proposes, the user disposes.

1. **OMC markers in CLAUDE.md** — look for `<!-- OMC:START -->` / `<!-- OMC:VERSION:... -->` in `~/.claude/CLAUDE.md` and any `CLAUDE-*.md` companion files. Found → ⚠️ note that these only affect Claude Code sessions, not dsh; removal is optional.
2. **Legacy OMC hook scripts** — `~/.claude/hooks/{keyword-detector,persistent-mode,session-start,stop-continuation}.{sh,mjs}` and any `"hooks"` entries referencing them in `~/.claude/settings.json` or project `.claude/settings.json`. Found → ⚠️; they are inert under dsh but can cause duplicate behavior if the user still runs Claude Code with OMC.
3. **OMC plugin cache** — versions under `~/.claude/plugins/cache/omc/oh-my-claudecode`. Multiple versions → ⚠️ stale cache (Claude Code side cleanup).
4. **Legacy curl-installed content** — `~/.claude/{agents,commands,skills}/` entries matching OMC plugin names (e.g. `executor.md`, `planner.md`, `autopilot`, `ralph`, `omc-setup`). Only flag names that match OMC-provided assets; never flag the user's custom files.
5. **OMC state directories in the workspace** — a stray `.omc/` next to omd's `.omd/`. Found → ⚠️ note; the two never conflict (different directory names), but old `.omc/` state can be archived or deleted on user request.

## Report format

```
omc-doctor (migration check) — <date>

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 1 | OMC markers in CLAUDE.md | ✅/⚠️ | … |
| 2 | Legacy OMC hooks/scripts | ✅/⚠️ | … |
| 3 | OMC plugin cache versions | ✅/⚠️ | … |
| 4 | Legacy curl-installed assets | ✅/⚠️ | … |
| 5 | Stray .omc/ in workspace | ✅/⚠️ | … |

Note: this checklist says nothing about omd health. Run /omd-doctor for that.
```

## State Contract (状态契约)

omc-doctor holds **no mode state**: no `state_write`/`state_clear`. It is read-only inspection; any cleanup it suggests is executed only after explicit user confirmation, and only against Claude Code / OMC artifacts — never against omd's own files.
