---
name: omd-doctor
description: Diagnose an oh-my-dsh installation — host version, registration counts, Config model resolvability, MCP smoke, .omd/ writability, probe matrix — as a checklist table with fix suggestions
when-to-use: Invoked via the `/omd-cancel`-sibling command `/omd-doctor` (the command is a thin shell that loads this skill), or when the user asks to verify/diagnose their omd installation ("doctor", "check omd", "omd not working"). Not a substitute for E2E release gates.
---

# omd-doctor

Original omd skill — the diagnostic brain behind the `/omd-doctor` command (the command is a thin forwarder; this skill is the single source of truth, spec §6.3). Runs a fixed checklist, prints one result table, and gives a fix suggestion for every failing item.

## How to run the checks

Work through the checklist in order. Every check lands in the final table with a status: ✅ pass / ⚠️ warning / ❌ fail. A ❌ or ⚠️ row MUST carry a concrete fix suggestion.

### 1. Host version vs peerDependencies

- Determine the running dsh host version (session runtime context, or the installed `@deepseek-ai/dsh-*` package versions).
- Compare against the plugin's peerDep range: `@deepseek-ai/dsh-*` pinned to **0.1.5-rc.1** (see omd `package.json`).
- Below the range → ❌ (fix: upgrade dsh, or accept best-effort degraded operation — omd warns but does not refuse to load, spec §6.1). Mismatch above the range → ⚠️ "newer than tested".

### 2. Registration counts

Count what is actually visible in this session and compare with expectations:

| Item | Expected | How to count |
|---|---|---|
| Skills | **44** (full roster in `tests/assets/skills.test.js` EXPECTED) | session skill catalog |
| Role cards | **33** `omd-agent-*` (roster in `tests/assets/agents.test.js` TIERS) | skill catalog entries prefixed `omd-agent-` |
| Commands | **2** (`/omd-doctor`, `/omd-cancel`) | command list |
| Plugin tools | **4** (`omd_memory_set/get/delete` + `omd_delegate`) | tool list |
| MCP tools | **49** `mcp__omd-state__*` (state×5, notepad×6, prd×4, handoff×3, team×16, trace×4, hud×2, codeintel×9) | tool list prefix count |

Any shortfall → ❌ with the missing names (fix: check that `assets/skills` / `assets/agents` shipped intact and the loader registered them with `source: 'oh-my-dsh'`; check cordis.patch.yml mount). **When the memory tools (omd_memory_*) are missing**: check that omd's `inject` declaration includes `storage` and that the current profile is base-backed (dsh-base mounts the dsh-storage trio — a non-base profile missing storage is expected degradation) — this is an omd-declaration/profile-layer matter, not a host defect.

### 3. Config model identifier resolvability

- Read the effective omd Config: `tiers.low/medium/high` and any `roleOverrides` — read the effective values from the model routing table in the omd protocol section of the system prompt (the model cannot read plugin Config directly).
- For each configured value: `inherit` is always valid; anything else must be resolvable as a model identifier by the host LLM service.
- Unresolvable identifier → ❌ (fix: correct the identifier in the plugin config, or set it to `inherit` to follow the main session model). Note the MVP caveat: model routing is hard only on the `workflow` path; `subagent` inherits the main session (soft routing), so a broken identifier degrades rather than crashes there.

### 4. MCP server smoke

- Call `mcp__omd-state__state_get_status` once. A structured response (even "no active modes") → ✅.
- Tool missing or call fails → ❌ (fix: check the MCP mount in cordis.patch.yml / the dynamic mount in `apply()`; `failOnStartupError: false` means a dead server fails silently — look for the degradation announcement in the protocol layer; reconnect is the host mcp-client's job).

### 5. `.omd/` writability + .gitignore

- Write and delete a probe file under `.omd/` (e.g. `.omd/.doctor-probe`) to prove writability. Not writable → ❌ (fix: directory permissions; on read-only workspaces expect full degradation to conversation-only operation).
- Check `.gitignore` covers `.omd/`. Missing → ⚠️ (fix: add `.omd/` to `.gitignore` — omd suggests but never edits user files unprompted, spec §5.5).

### 6. Probe four-state overview

Render the capability probe results (protocol-layer probe.js + apply-time additions) as a table — one row per item with its four-state result:

| Probe item | ok / unavailable / failure / timeout | Detail |
|---|---|---|
| core (four inject services) | … | … |
| `ctx.storage` backend (domain-API shape check) | … | … |
| hooksBridge (phase-2 prerequisite, M3 keyword hooks — unavailable is NOT a degradation) | … | … |
| mcpServer (apply-time dynamic mount result: mounted/failure) | … | … |
| memoryTools / commands (registration outcome) | … | see "memoryTools render gate" below — **registration alone is NOT sufficient** |

#### memoryTools render gate (registration ≠ callable)

`memoryTools:ok` only proves `defineTool({...})` returned a tool whose `output` passed the registry's `typeof output.render === 'function'` gate. The host `defineTool` (lib/types/schema.js, near the userRender closure) actually captures `options.output.render` into a closure named `userRender`; registration sees the outer wrapper function (typeof passes) but at runtime `tool.output.render(args, value)` calls `userRender(args, value)`. When `options.output.render` was undefined, the captured `userRender` is undefined → first invoke throws `output.render failed: userRender is not a function`. To verify the gate is real, each of `omd_memory_set`, `omd_memory_get`, `omd_memory_delete` must additionally show a callable `render present & callable` check (e.g. `tool.output.render(sampleArgs, sampleValue)` returns a non-empty ContentBlock without throwing). Failure here → ❌ with the specific tool name(s); fix per "Host render contract" below.

#### Host render contract (≤120 words)

The host `defineTool(options)` reads `options.output.render` once at registration, captures it into the closure as `userRender`, and replaces `tool.output.render(args, value)` with a wrapper calling `userRender(args, value)`. The capture happens before the registry's `typeof output.render === 'function'` gate runs, so an undefined render slips past registration (the wrapper itself is a function). The contract for plugin authors: every tool's `output` MUST carry `render: (args, value) => ContentBlock[]` returning at least one `{ type: 'text', text: <string> }` block; never share one `output` object across multiple `defineTool` calls (factory pattern), otherwise all three tools capture the same broken closure. Fix: `output: { schema: <json-schema>, render: (args, value) => [{ type: 'text', text: '...' }] }`.

Note: host tools like goal/ralph/subagent/workflow/ask_user_question are **not statically probed** (spec §7-6) — treat their actual invocation results as authoritative; try calling them if verification is needed. Core services (`tools`/`skills`/`systemPrompt`/`commands`) missing would have failed startup already — if reachable here, mark ❌ "should have been a startup error". Any non-`ok` that triggers a degradation → ⚠️ with the degradation path (spec §6.1 matrix).

### 7. Profile patch layering (best effort)

- If `dsh --profile <name> --dump-config` is runnable, verify the omd bundle patch expanded correctly (plugin instance present, config values landed; the MCP server is mounted dynamically at apply() runtime and won't appear in the patch — that's normal, item 4's smoke check is authoritative). Note: bare `dsh --dump-config` without a profile errors out (exit code 1, observed).
- Not runnable in-session → mark "not checked (manual step)" rather than guessing.

## Output format

One summary table plus details:

```
omd doctor — <date>

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 1 | Host version vs peerDep (0.1.5-rc.1) | ✅/⚠️/❌ | host=<v> |
| 2 | Registration counts (44/33/2/4/49) | … | missing: … |
| 3 | Config model identifiers | … | … |
| 4 | MCP smoke (state_get_status) | … | … |
| 5 | .omd/ writable + .gitignore | … | … |
| 6 | Probe four-state matrix | … | N not-ok |
| 7 | Patch layering (--dump-config) | … | … |

Fixes:
- ❌ <check>: <concrete fix>
- ⚠️ <check>: <concrete suggestion>
```

## Closing disclaimer (always print)

> doctor checks installation and wiring health only. **It does not prove end-to-end usability** — the E2E gates (autopilot / ralph / team each run once for real) are a separate, manual release gate (spec §6.4).

## State Contract (状态契约)

omd-doctor is read-only diagnostics and **holds no mode state**: no `state_write`/`state_clear`, and the only filesystem touch is the create-then-delete writability probe at `.omd/.doctor-probe`. It never modifies Config, patches, or plugin files.
