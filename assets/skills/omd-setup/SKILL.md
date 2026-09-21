---
name: omd-setup
description: Install and configure oh-my-dsh — dsh plugin add (npm or local path), Config keys explained, verify with /omd-doctor, update and uninstall flows
when-to-use: The user asks to install, configure, update, repair, or uninstall oh-my-dsh ("setup omd", "install omd", "configure omd", "omd update"). Also the landing skill when omd is freshly added to a profile and the user asks what to do next.
---

# omd-setup — install & configuration guide

omd is a **dsh plugin**, not a CLI. There is no `omd setup` command and nothing to write into a CLAUDE.md — installation is one `dsh plugin add`, configuration lives in the plugin's Config (cordis profile layer), and verification is `/omd-doctor`. This skill walks through install → configure → verify → update.

## Phase 1 — Install

Pick one source:

```bash
# From npm (published package)
dsh plugin --profile <name> add oh-my-dsh

# From a local checkout (development / pre-release)
dsh plugin --profile <name> add D:\omd        # or the checkout path on your OS
```

What happens on install:

- `cordis.patch.yml` (shipped in the bundle) **inserts the `oh-my-dsh` plugin** into the profile composition — the protocol section, bilingual skills/role cards, `/omd-doctor` `/omd-cancel` commands, and `omd_memory_*` tools are registered by `lib/index.js`.
- The bundled MCP server (`omd-state`, 18 tools: state×5, notepad×6, prd×4, handoff×3) is **mounted dynamically at runtime** via `ctx.plugin()` inside `apply()` — a static patch cannot express package-internal absolute paths (spec §7-1). `failOnStartupError: false` means a broken MCP mount degrades (protocol announces it) instead of crashing the host.

After adding, **restart or reload the profile** (`dsh web` / the target profile) so the plugin tree reloads, then open a fresh session.

## Phase 2 — Configure (optional; defaults work)

Config is set on the plugin instance in the profile (cordis Config layer). All keys with defaults:

| Key | Default | Meaning |
|---|---|---|
| `language` | `zh` | Asset language: `zh` Chinese / `en` English / `both` Chinese body + English terms |
| `tiers.low` | `deepseek-chat` | Model identifier for low-tier roles, or `inherit` |
| `tiers.medium` | `deepseek-chat` | Model identifier for medium-tier roles, or `inherit` |
| `tiers.high` | `deepseek-reasoner` | Model identifier for high-tier roles, or `inherit` |
| `roleOverrides` | `{}` | Per-role override, e.g. `{ "omd-agent-code-reviewer": "provider/model" }` |
| `stateDir` | `.omd` | Project state directory name |
| `autopilot.maxIterations` | `10` | autopilot goal round cap (also `create_goal`'s `max_goal_rounds`) |
| `autopilot.maxQaCycles` | `5` | autopilot QA loop bound |
| `autopilot.maxValidationRounds` | `3` | autopilot re-validation bound |
| `deepInterview.ambiguityThreshold` | `0.2` | deep-interview ambiguity gate |
| `deepInterview.maxRounds` | `20` | deep-interview hard round cap |
| `deepInterview.softWarningRounds` | `10` | deep-interview soft warning round |

Notes:

- Model routing is **hard only on the `workflow` path**; `subagent` inherits the main session model (soft routing). A bad identifier degrades rather than crashes on the soft path. `inherit` follows the main session model.
- The model cannot read plugin Config at runtime — the effective values are rendered into the **model routing table of the omd protocol section** in the system prompt. Check there to confirm what is live.
- omd **never edits user files unprompted** (spec §5.5): it may suggest adding `.omd/` to `.gitignore`, but will not do it for you.

## Phase 3 — Verify

In a fresh session of the configured profile, run:

```
/omd-doctor
```

Expected green items: host version within peerDep range; registration counts (skills / 7 `omd-agent-*` role cards / 2 commands / 3 `omd_memory_*` tools / 18 `mcp__omd-state__*` tools); Config identifiers resolvable; MCP smoke (`state_get_status` answers); `.omd/` writable. Any ❌/⚠️ row comes with a fix suggestion from the doctor itself.

Remember: doctor proves installation and wiring health only — **end-to-end usability is the separate E2E gate** (run autopilot / ralph / team once for real, spec §6.4).

## Phase 4 — Update

```bash
dsh plugin --profile <name> add oh-my-dsh@latest   # or re-add the updated local path
```

Then reload the profile. There is no separate migration wizard: Config keys keep their defaults, `.omd/` state carries over, and `/omd-doctor` re-verifies the new install. If a future version changes Config keys, the release notes will say so.

## Uninstall / repair

- Remove: `dsh plugin --profile <name> remove oh-my-dsh`, then reload the profile. `.omd/` project state is left on disk (delete it manually if unwanted).
- Repair: if registration counts are short or the MCP smoke fails, re-add the plugin (force refresh of the bundle), reload, and re-run `/omd-doctor`. Persistent MCP failure → check the degradation announcement in the protocol section and the `omd-state` server entry (`mcp-server/index.mjs`).

## State Contract (状态契约)

omd-setup is an install/configuration guide and **holds no mode state**: no `state_write`/`state_clear`. It changes nothing in the workspace; the only writes happen through the `dsh plugin` CLI and the profile's cordis Config layer, executed by the user (or confirmed with the user first).
