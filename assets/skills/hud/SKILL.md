---
name: hud
description: Status visibility for omd sessions — the five-element HUD contract (mode, round, story, agents, todos) and its three shipped surfaces: MCP hud_render/hud_summary, the web GUI right-sidebar HUD panel (client half), and the /oh-my-dsh/hud.json data route
when-to-use: The user asks about HUD/statusline setup, wants persistent session status visibility, or asks "where is my HUD". Since v0.4 all three surfaces are live; CLI sessions without a panel use the MCP tools for the same summary.
---

# HUD (status visibility)

> **v0.4 honest status:** OMC's HUD is a Claude Code `statusLine` script and dsh has no statusline surface — but omd's HUD has landed in three dsh-native layers:
>
> 1. **Client-half panel** (`lib/client.js`): registers the `omd-hud` tab type in the dsh web GUI's right sidebar (open it from the "omd HUD" capsule on the guide page), polling every 5s to render the six-line five-element card plus cwd/fetch-time details. Visibility prerequisite: the dsh web host has loaded the omd plugin AND was restarted to pick up the client bundle (HMR does not cover first-time plugin activation).
> 2. **Data route** (`lib/hud-route.js`): exact GET `/oh-my-dsh/hud.json?cwd=` on the web host — the panel's fetch source (loopback read-only, no-store; `?cwd=` overrides the default host-process anchor). CLI sessions have no webServer → the `hudRoute` probe row reads `skipped`, which is not a degradation.
> 3. **MCP server surface**: `mcp__omd-state__hud_render` (five-element summary JSON + six-line card text) / `hud_summary` (pure JSON) — available in every session including CLI; the data sources are strictly the two existing read surfaces `state_get_status` + `notepad_stats` (the lib/hud.js design constraint).
>
> The statusline's dsh equivalent IS this right-sidebar panel (webServer/client-bundle form), not a terminal statusline — the semantic difference is recorded honestly.

## What the HUD shows (content contract v1)

The five elements (`lib/hud.js#HUD_FIELDS`, the per-field diff traversal order):

| Element | Meaning | Source |
|---|---|---|
| mode | all active mode names (`idle` when none) | `state_get_status` |
| round | freshest active mode's iteration | `state_get_status` |
| story | freshest active mode's current_story | `state_get_status` |
| agents | freshest active mode's active_agents count | `state_get_status` |
| todo | notepad three-zone counts (working/priority/manual) | `notepad_stats` |

Render contract: `renderCard` produces six bounded lines (`[omd] HUD 摘要卡` + one line per element); the empty state renders (idle/0). OMC's color discipline (green/yellow/red) and the focused/full presets remain design input for later panel iterations — the current panel is the minimal form.

## Getting the HUD per session shape

- **dsh web GUI**: right-sidebar guide page → "omd HUD" capsule (or an already pinned omd-hud tab). Panel missing → check `/omd-doctor`'s `hudRoute` probe row and client-bundle loading first (the host must restart to load a new client plugin).
- **Any session (incl. CLI)**: `mcp__omd-state__hud_render` for the card in one call; or derive it yourself with `state_get_status` + `notepad_stats` (same contract as the table above).
- **Worker/review lanes**: `hud_summary` returns pure JSON for machine consumption.

## Answering HUD questions honestly

- Do NOT write scripts into `~/.claude/` or edit `settings.json` — those surfaces do not exist under dsh.
- A panel that doesn't appear usually means the host hasn't restarted to load the client bundle, or the session is CLI (where the MCP surface is the correct answer); diagnose honestly, never promise "just refresh".
- The data route is read-only and loopback-only; the /api bridge's cookie auth does not cover it — the exposure is mode/count-level low-sensitivity summary, and this boundary is recorded in the lib/hud-route.js header.

## State Contract (状态契约)

hud **holds no mode state** and writes nothing — it is a visibility skill. Read surfaces: `hud_render` / `hud_summary` / `state_get_status` / `state_list_active`; never call `state_write`/`state_clear`, never touch files.
