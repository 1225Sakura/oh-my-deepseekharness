---
name: hud
description: Status visibility for omd sessions — what a heads-up display would show (mode, iteration, story, agents, todos) and how to get that visibility today. **c4 HUD library capability was restored in 0.3.0 (commit `699377e` siblings — 9)** as a pure-function library (lib/hud.js + tests); client half that renders it as a persistent panel is an omd 1.x item.
when-to-use: The user asks about HUD/statusline setup, wants persistent session status visibility, or asks "where is my HUD". Library calls (`lib/hud.js#summarize` / `renderCard` / `diffSummary`) are available to any caller today; persistent panel rendering needs the omd client half (1.x).
---

# HUD (status visibility)

> **Honest status up front:** OMC's HUD is a Claude Code `statusLine` command script (`~/.claude/hud/omc-hud.mjs` + `settings.json`). dsh has **no statusline surface**, so there is nothing to install or configure here. omd's **c4 HUD library capability is restored in 0.3.0** (commit `699377e` siblings — `lib/hud.js` + `tests/lib/hud.test.js`, 133 + 128 lines, 7 tests passing). The library exposes the five-element contract (mode/round/story/agents/todo), the `summarize`/`renderCard`/`diffSummary` pure functions, and a `createPollingHud` factory for client-side polling. **Client half that registers a native sidebar tab via dsh's `ctx.betterSidebar` is an omd 1.x item** — pattern reference: [DSH-better-sidebar external-plugin-guide](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/docs/external-plugin-guide.md). Until the client half ships, users get visibility through the six paths below.

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
