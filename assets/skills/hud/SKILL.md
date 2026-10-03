---
name: hud
description: Status visibility for omd sessions — the five-element HUD contract (mode, round, story, agents, todos) and its three shipped surfaces: MCP hud_render/hud_summary, the web GUI right-sidebar HUD panel (client half), and the /oh-my-dsh/hud.json data route
when-to-use: The user asks about HUD/statusline setup, wants persistent session status visibility, or asks "where is my HUD". Since v0.4 all three surfaces are live; CLI sessions without a panel use the MCP tools for the same summary.
---

# HUD (status visibility)

> **v0.4 honest status:** OMC's HUD is a Claude Code `statusLine` script and dsh has no statusline surface — but omd's HUD has landed in three dsh-native layers:
>
> 1. **Client-half panel** (`lib/client.js`): registers the `omd-hud` tab type in the dsh web GUI's right sidebar (open it from the "omd HUD" capsule on the guide page), polling `/oh-my-dsh/hud.json` every 5s to render a semantic panel: three payload-driven presets (minimal/focused/full, default focused), idle guidance rendering the payload modeCatalog (mode name + Chinese label pairs), an active primary-mode card with Chinese labels (模式/阶段/轮次/任务/记忆 = mode/phase/round/tasks/memory, with a 「未更新」 line when stale), and three tier levels (ok/warn/danger — CSS-variable colors as a visual-only signal, always paired with a text marker). Visibility prerequisite: the dsh web host has loaded the omd plugin AND was restarted to pick up the client bundle (HMR does not cover first-time plugin activation).
> 2. **Data route** (`lib/hud-route.js`): exact GET `/oh-my-dsh/hud.json?cwd=` on the web host — the panel's fetch source (loopback read-only, no-store; `?cwd=` overrides the default host-process anchor). The response carries the panel-private keys `detail`/`modeCatalog`/`preset` alongside summary/card (never on the MCP wire). CLI sessions have no webServer → the `hudRoute` probe row reads `skipped`, which is not a degradation.
> 3. **MCP server surface**: `mcp__omd-state__hud_render` (five-element summary JSON + the Chinese status-card text, at most 8 lines) / `hud_summary` (pure JSON) — available in every session including CLI; the data sources are strictly the two existing read surfaces `state_get_status` + `notepad_stats` (the lib/hud.js design constraint).
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

> **agents count semantics (U6 interim note)**: the count reads the `active_agents` field that the leader model **explicitly writes** into mode state — the team runtime does not populate it automatically, so a 0 is normal, not a fault. The authoritative per-worker lifecycle (workerId/role/status/heartbeat age) lives in the `team_registry` MCP tool and `.omd/team/<runId>/registry.json`. The multi-line agent tree (U6) will settle its data-plane design in its own ralplan.

## Render contract and the panel data plane

Render contract (at most 8 bounded lines): `renderCard` titles the card `[omd] 编排状态`; active = five Chinese-labeled lines (模式/阶段/轮次/任务/记忆 = mode/phase/round/tasks/memory) plus a minor-modes footnote (「另有 N 个…」); when stale it appends 「状态已超过 2 小时未更新（上次更新：<updatedAt>）」; empty state = 「当前没有运行中的 omd 模式。」 plus one guidance line per mode (mode name + Chinese label) and a memory line. Active sample:

```
[omd] 编排状态
模式: Ralph 循环（ralph）
阶段: exec
轮次: 3
任务: 2 个 agent
记忆: 工作区 1 / 优先区 2 / 手动区 0
另有 1 个模式：autopilot（自动驾驶）
状态已超过 2 小时未更新（上次更新：2026-02-06T10:00:00.000Z）
```

Panel-private data plane (delivered only via `/oh-my-dsh/hud.json`, never on the MCP wire): `detail` ({primary, modes[]}, fresh-first, passing through label/current_phase/stale status fields), `modeCatalog` (the constant five-mode "mode name + Chinese label" catalog, single-sourced in lib — the client renders only what is sent), and `preset` (minimal/focused/full, default focused, from the dsh Config key hud.preset).

Tier colors (client panel only; the MCP card stays plain text, no ANSI): ok = 状态正常 (active and not stale); warn = 警告 (primary mode stale, or an active mode whose current_phase is fix with fixLoops >= 2); danger = 危险 (any active mode whose state is failed). The tier lands in the DOM as a data-tier attribute and always carries a text marker (状态正常/警告/危险) — color is never the only information carrier.

Name-vs-content note: the five-element data contract (mode/round/story/agents/todo) and the tool names `hud_render`/`hud_summary` are unchanged; the card and panel presentation is renamed 「编排状态」 with Chinese labels — showing 阶段 (current_phase) instead of story (current_story) on the card is a presentation-layer choice, the data plane still passes story through. The old title "HUD 摘要卡" exists only in history.

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
