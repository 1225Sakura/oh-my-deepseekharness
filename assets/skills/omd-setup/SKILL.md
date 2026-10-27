---
name: omd-setup
description: Install and configure oh-my-dsh — dsh plugin add (npm or local path), Config keys explained, verify with /omd-doctor, update and uninstall flows
when-to-use: The user asks to install, configure, update, repair, or uninstall oh-my-dsh ("setup omd", "install omd", "configure omd", "omd update"). Also the landing skill when omd is freshly added to a profile and the user asks what to do next.
---

# omd-setup — install & configuration guide

omd is a **dsh plugin**, not a CLI. There is no `omd setup` command and nothing to write into a CLAUDE.md — installation is one `dsh plugin add`, configuration lives in the plugin's Config (cordis profile layer), and verification is `/omd-doctor`. This skill walks through install → configure → verify → update.

## Phase 1 — Install

Pick one source (`<profile>` = dsh's isolated config/plugin composition unit, e.g. `web` on this machine; `<profile>` is the placeholder throughout). Note `dsh plugin` forwards to pnpm inside the profile directory — add/remove take the **npm package name**:

```bash
# From npm (published package; the scoped full name — bare `oh-my-dsh` is a DIFFERENT, abandoned npm package)
dsh plugin --profile <profile> add @sakura12/oh-my-deepseekharness

# From a local checkout (development / pre-release)
dsh plugin --profile <profile> add /path/to/oh-my-deepseekharness        # or the checkout path on your OS
```

What happens on install:

- `cordis.patch.yml` (shipped in the bundle) **inserts the `oh-my-dsh` plugin** into the profile composition — the protocol section, bilingual skills/role cards, `/omd-doctor` `/omd` `/omd-cancel` commands, and `omd_memory_*` tools are registered by `lib/index.js`.
- The bundled MCP server (`omd-state`, 56 tools: state×5, notepad×6, prd×4, handoff×3, team×17, trace×4, hud×2, graph×6, code-intel×9) is **mounted dynamically at runtime** via `ctx.plugin()` inside `apply()` — a static patch cannot express package-internal absolute paths (spec §7-1). `failOnStartupError: false` means a broken MCP mount degrades (protocol announces it) instead of crashing the host.

After adding, **restart or reload the profile** (`dsh web` / the target profile) so the plugin tree reloads, then open a fresh session.

## Phase 2 — Configure (optional; defaults work)

Config is set on the plugin instance in the profile (cordis Config layer). **Where**: the profile directory's `cordis.patch.yml` (e.g. `C:\Users\<you>\.dsh\profiles\<profile>\cordis.patch.yml`) — NOT the read-only same-named file shipped inside the package. Append an id-targeted override, then reload the profile:

```yaml
- id: oh-my-dsh
  config:
    hudPreset: full   # example
```

All keys with defaults:

| Key | Default | Meaning |
|---|---|---|
| `language` | `zh` | Asset language: `zh` Chinese / `en` English / `both` Chinese body + English terms |
| `tiers.low` | `inherit` | Model identifier for low-tier roles; `inherit` = follow the main session route |
| `tiers.medium` | `inherit` | Medium tier, same |
| `tiers.high` | `inherit` | High tier, same |
| `roleOverrides` | `{}` | Per-role override (beats tiers), e.g. `{ "omd-agent-code-reviewer": "provider/model" }` |
| `routing.defaultTier` | `medium` | Fallback tier for off-table roles (audited as fallback in run-state.json) |
| `stateDir` | `.omd` | Project state directory name (renaming caveat: protocol/skill docs use `.omd/` in examples throughout; rename only if you must) |
| `team.heartbeatIntervalMs` | `60000` | team heartbeat scan interval (0 = timer off; on-demand scan still works) |
| `team.staleAfterMs` | `300000` | Worker no-heartbeat stale threshold |
| `codeIntel.astGrep` | `true` | ast_grep_* switch (tool errors explicitly when @ast-grep/napi is absent) |
| `codeIntel.lspServers` | `{}` | LSP registry: `{ <name>: { command, args?, languages?, env? } }`; servers themselves come from the user environment |
| `autopilot.maxIterations` | `10` | autopilot goal round cap (also `create_goal`'s `max_goal_rounds`) |
| `autopilot.maxQaCycles` | `5` | autopilot QA loop bound |
| `autopilot.maxValidationRounds` | `3` | autopilot re-validation bound |
| `deepInterview.ambiguityThreshold` | `0.2` | deep-interview ambiguity gate |
| `deepInterview.maxRounds` | `20` | deep-interview hard round cap |
| `deepInterview.softWarningRounds` | `10` | deep-interview soft warning round |

Notes:

- Model routing is **hard on the `workflow` and `omd_delegate` paths** (tier/model enforced through the spawn path; unresolvable ids error before dispatch); `subagent` inherits the main session model (soft routing). A bad identifier degrades rather than crashes on the soft path. `inherit` follows the main session model.
- The model cannot read plugin Config at runtime — the effective values are rendered into the **model routing table of the omd protocol section** in the system prompt. Check there to confirm what is live.
- omd **never edits user files unprompted** (spec §5.5): it may suggest adding `.omd/` to `.gitignore`, but will not do it for you.

## Phase 3 — Verify

In a fresh session of the configured profile, run:

```
/omd-doctor
```

Expected green items: host version within peerDep range; registration counts (42 skills / 33 `omd-agent-*` role cards / 3 commands / 5 in-plugin tools = `omd_memory_*`×4 + `omd_delegate` / 56 `mcp__omd-state__*` tools); Config identifiers resolvable; MCP smoke (`state_get_status` answers); `.omd/` writable. Any ❌/⚠️ row comes with a fix suggestion from the doctor itself.

Remember: doctor proves installation and wiring health only — **end-to-end usability is the separate E2E gate** (run autopilot / ralph / team once for real, spec §6.4).

## Phase 4 — Update

```bash
dsh plugin --profile <profile> add @sakura12/oh-my-deepseekharness@latest   # or re-add the updated local path
```

Then reload the profile. There is no separate migration wizard: Config keys keep their defaults, `.omd/` state carries over, and `/omd-doctor` re-verifies the new install. If a future version changes Config keys, the release notes will say so.

## Uninstall / repair

- Remove: `dsh plugin --profile <profile> remove @sakura12/oh-my-deepseekharness` (pnpm semantics: the package name; the cordis plugin name stays `oh-my-dsh`), then reload the profile. `.omd/` project state is left on disk (delete it manually if unwanted).
- Repair: if registration counts are short or the MCP smoke fails, re-add the plugin (force refresh of the bundle), reload, and re-run `/omd-doctor`. Persistent MCP failure → check the degradation announcement in the protocol section and the `omd-state` server entry (`mcp-server/index.mjs`).

## State Contract (状态契约)

omd-setup is an install/configuration guide and **holds no mode state**: no `state_write`/`state_clear`. It changes nothing in the workspace; the only writes happen through the `dsh plugin` CLI and the profile's cordis Config layer, executed by the user (or confirmed with the user first).
