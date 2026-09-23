---
name: hud
description: Status visibility for omd sessions — what a heads-up display would show (mode, iteration, story, agents, todos) and how to get that visibility today. omd's c4 HUD panel was **retired in 0.3.0** (systemPrompt context does not support polling); current visibility comes from /omd-doctor and mcp__omd-state__state_get_status.
when-to-use: The user asks about HUD/statusline setup, wants persistent session status visibility, or asks "where is my HUD". Not a config writer — there is no dsh statusline surface to configure today, and c4 HUD is no longer planned.
---

# HUD (status visibility)

> **Honest status up front:** OMC's HUD is a Claude Code `statusLine` command script (`~/.claude/hud/omc-hud.mjs` + `settings.json`). dsh has **no statusline surface**, so there is nothing to install or configure here. The omd **c4 HUD panel was retired in 0.3.0** — systemPrompt `context` is synchronous and does not support polling, which ruled out the lib/hud.js shape; the file was deleted (commit `ed3b28a`). This skill preserves the methodology skeleton: what would belong on a HUD if one is ever shipped, and the visibility paths that exist **today**.

## What a HUD should show (the methodology, kept for M3)

Presets from the OMC original, as design input for the future panel:

| Preset | Contents |
|---|---|
| minimal | `[omd] <mode> | todos:n/m` |
| focused (default) | branch, mode iteration (e.g. `ralph:3/10`), current PRD story, last skill, context %, agent count, background jobs, todos |
| full | everything + multi-line per-agent details (role code, duration, current action) |

Color discipline: green normal; yellow warning (context >70%, ralph >7 iterations); red critical (context >85%, ralph at max).

## How to get status visibility today

1. **`/omd-doctor`** — installation and wiring health: registration counts, MCP smoke, probe four-state matrix, degradation notices.
2. **`mcp__omd-state__state_get_status`** — aggregated mode state with stale detection: which modes are active, current phase, iteration.
3. **`mcp__omd-state__state_list_active`** — cross-session list of active modes.
4. **`list_agents` / `job_list`** — live subagent and background-job inventory (the "agents:n / bg:n/m" equivalents).
5. **`todo_write` state** — the todos element is already visible in-session.
6. Context usage — read from the session's runtime context snapshot (the focused preset's `ctx:%` equivalent).

When a user asks to "set up the HUD", answer with the table above plus this list, and state plainly: the GUI panel ships at M3; until then these six paths are the HUD.

## Answering HUD questions honestly

- Do **not** write scripts to `~/.claude/` or edit `settings.json` — those surfaces do not exist under dsh.
- Do **not** promise auto-refreshing status lines; describe what each today's-path query returns and let the user pull when needed.
- If the user needs M3 panel status, point at the spec roadmap entry (HUD panel via `dsh.client` slot) — that is the tracked plan, not a workaround.

## State Contract (状态契约)

hud **holds no mode state** and writes nothing — it is an advisory skill. It may *read* `mcp__omd-state__state_get_status` / `state_list_active` to answer status questions; it never calls `state_write`/`state_clear` and never touches files.
