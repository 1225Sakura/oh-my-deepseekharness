---
name: graph
description: Declarative DAG pipeline contract — deterministic graph semantics and journal-based crash recovery, executed model-driven in omd until the phase-2 runtime lands
when-to-use: Repeatable multi-step pipelines with explicit dependencies (DAG), work that must survive interruption, auditable runs. Not for exploratory one-off work (use conversation or team) or anything needing adaptive re-planning mid-run (graphs are deterministic).
---

# Graph

Run a deterministic orchestration graph from a declarative JSON descriptor.

> **Port status (read first).** The OMC original executes through an independent OS process (`omc graph run`) backed by the sealed-descriptor and pure-scheduler contracts in `src/graph/*`, with an OCC journal for real crash recovery. **The omd phase-1 runtime has landed (U4)**: the deterministic core lives in `lib/graph/` (schema/descriptor/journal/scheduler/fence/runner), shared by the MCP six-tool surface and a background script entry (see "Runtime tool surface" below). Model-driven execution remains a legitimate fallback — the journal contract is unchanged; journals written by the model today are tomorrow's resume input.

## Usage

```
graph <descriptor.json>
graph "build then test then ask me before deploy"   (author the descriptor first)
```

## When To Use

- Repeatable multi-step pipelines with explicit dependencies (DAG)
- Work that must survive interruption: rerun resumes from the journal
- Auditable runs: journal + snapshots under `.omd/graph-runs/<run_id>/`

When NOT to use: exploratory one-off work (use conversation or team); anything needing adaptive re-planning mid-run (graphs are deterministic).

## Workflow

1. **Descriptor given** → go to step 3.
2. **Pipeline described** → author the descriptor JSON (schema below), write it next to the project (suggest `.omd/graphs/<name>.json`) and show it to the user before running. `run_id` must be unique per logical pipeline; rerunning with the same `run_id` RESUMES, not restarts.
3. **Approval nodes**: if the descriptor contains any `"kind": "human-approval"` node, resolve it through the `ask_user_question` tool at that point in the run. (OMC's original ran these on an interactive terminal with live stdin; dsh's `ask_user_question` is the equivalent gate.)
4. **Execute model-driven**, in topological order, honoring `concurrency_limit`:
   - `"kind": "command"` → run with `pwsh`
   - `"kind": "agent"` → spawn a `subagent` with the node's `instructions`; keep it read-only (research/review role cards) unless the descriptor explicitly demands mutation
   - `"kind": "human-approval"` → `ask_user_question`; EOF/absence of an answer fails closed to denied
   - After each node commits, **append to the journal** `.omd/graph-runs/<run_id>/journal.jsonl` (one JSON line per committed transition: node id, status, timestamp, output digest) and refresh the snapshot `.omd/graph-runs/<run_id>/descriptor.json` + node results.
5. **Resume**: rerunning the same descriptor after an interruption replays the journal and continues. Completed nodes never re-execute — read the journal first and skip committed nodes.
6. Relay progress as you go: `[run]`, `[node]`, `[ok]`, `[fail]`, `[join]`, `[done]`.

### Runtime exit codes (live in the omd phase-1 runtime)

Normative for the future runtime, recorded here so descriptors stay forward-compatible: `0` succeeded | `1` terminal failed | `19` another writer owns this run (busy) | `20` corrupt/tampered journal (fail-closed) | `21` descriptor drift on resume | `70` runtime crash. Model-driven execution reports the same states in prose instead of exit codes.

## Descriptor Schema (minimal)

```json
{
  "descriptor_version": 1,
  "run_id": "unique-pipeline-id",
  "revision_id": "rev-1",
  "goal": "one line",
  "nodes": [
    { "id": "n1", "kind": "command", "title": "...", "timeout_ms": 60000,
      "max_attempts": 2, "effect_policy": { "policy": "side_effect_free" },
      "command": "npm test" },
    { "id": "a1", "kind": "agent", "title": "...", "timeout_ms": 300000,
      "max_attempts": 1, "effect_policy": { "policy": "side_effect_free" },
      "instructions": "..." },
    { "id": "gate", "kind": "human-approval", "title": "...",
      "prompt": "Proceed?" }
  ],
  "edges": [ { "id": "e1", "kind": "fixed", "from": "n1", "to": "a1" } ],
  "entry_node_ids": ["n1"],
  "concurrency_limit": 2,
  "terminal_verification_node_id": "a1"
}
```

Edge kinds: `fixed` and `fan_out`/`join` pairs run today; `conditional` and `back_edge` are rejected at the entry with `UNSUPPORTED_EDGE` fail-fast (unsupported — say so, don't guess routes). The authoritative Zod schema is ported to `lib/graph/schema.js` — `graph_validate` performs strict validation and malformed descriptors fail fast.

## Capability Boundary & Semantics (read before authoring)

- **Edge support**: `fixed` edges and `fan_out`/`join` pairs run today. `conditional` and `back_edge` routes are **unsupported in the phase-1 runtime**: entries (graph_validate/graph_run) fail fast with `UNSUPPORTED_EDGE` (exit 1, listing the offending edges) — say so instead of guessing routes.
- **Crash-recovery guarantee is at-least-once** for command nodes: a crash between an external side effect and its journal append re-executes that node on resume. For `idempotent` commands, expose the resolved key to the command as the `GRAPH_IDEMPOTENCY_KEY` environment value and record it for downstream dedupe. Exactly-once for external side effects is out of scope.
- **Command trust boundary**: command nodes are arbitrary shell lines run via `pwsh` with real process authority in the current working directory. Only run descriptors you wrote or trust. Commands are not filesystem/process sandboxed.
- **Agent authority boundary**: built-in agent nodes are read-only by convention — in omd this is prompt-level discipline (dsh `subagent` has no tool-restriction parameter), so state it in the node's `instructions` and prefer read-only role cards. Treat `.omd/graph-runs/<run_id>/descriptor.json` as executable content.

## Journal format contract (the phase-2 runtime's anchor — model-driven execution writes it today)

`.omd/graph-runs/<run_id>/journal.jsonl` is append-only JSONL — one event per line, **append only, never rewrite, never reorder**. Resume semantics derive entirely from it (read journal, skip committed nodes, continue), so model-driven execution must write it in exactly this format:

```jsonl
{"seq":1,"ts":"<ISO-8601>","type":"run_started","run_id":"...","graph_id":"...","descriptor_hash":"<sha256>"}
{"seq":2,"ts":"...","type":"node_scheduled","node_id":"a1","attempt":1}
{"seq":3,"ts":"...","type":"node_committed","node_id":"a1","attempt":1,"exit_code":0,"output_ref":"outputs/a1.md"}
{"seq":4,"ts":"...","type":"node_failed","node_id":"a2","attempt":1,"error":"...","retryable":true}
{"seq":5,"ts":"...","type":"gate_waiting","node_id":"gate","prompt":"Proceed?"}
{"seq":6,"ts":"...","type":"gate_resolved","node_id":"gate","decision":"approved"}
{"seq":7,"ts":"...","type":"run_finished","terminal_status":"completed|failed|cancelled"}
```

Rules:
- `seq` is strictly increasing (resume continues from the max seq); `node_committed` is the ONLY completion witness — a node with `node_scheduled` but no `node_committed` is re-run on resume (at-least-once).
- Large outputs never land in the journal: `output_ref` points at files under `.omd/graph-runs/<run_id>/outputs/`.
- The `descriptor.json` snapshot lives next to the journal; a `descriptor_hash` mismatch refuses resume (guards against mid-run descriptor edits).
- The phase-2 deterministic runtime will consume this same format — journals written by the model today are tomorrow's resume input.

## Runtime Tool Surface (U4 phase-1, landed)

The deterministic runtime core lives in `lib/graph/` (schema validation / descriptor sealing / flat OCC journal / pure-function scheduler / owner fence / runner loop), **shared by two entries**: the MCP six tools (`omd-state` server) and the background script `node bin/graph-runner.mjs --descriptor <draft.json> --runs-root <dir> [--takeover] [--stale-grace-ms <ms>] [--cwd <dir>]` (process exit code = exit_code; last stdout line `GRAPH_RUN_RESULT <json>`).

- **graph_validate** `{cwd, descriptor}`: self-check the descriptor before running — strict schema + structural validation + `UNSUPPORTED_EDGE` fail-fast; returns the `descriptor_hash` that would be sealed.
- **graph_run** `{cwd, descriptor, takeover?, stale_grace_ms?}`: seals and advances synchronously to the first waiting point (gate_waiting / agent_pending / terminal) before returning; always returns `{exit_code, terminal_status, status, waiting, projection, ...}`. Re-entering the same `run_id`: live fence → `19`; dead owner past the stale grace → `takeover:true` explicit takeover.
- **graph_status** `{cwd, run_id}`: `projectGraph` projection (ready/waiting/blocked/done/failed/max_seq) + fence observation (`stalled`).
- **graph_resume** `{cwd, run_id, takeover?, stale_grace_ms?}`: the only resume-driver entry — rehydrates from the run directory's `descriptor.json` snapshot and advances; `takeover:true` is the explicit takeover for stalled runs (writes `fence_acquired` on success).
- **graph_node_result** `{cwd, run_id, node_id, attempt, exit_code, output_ref?}`: the only commit port for agent nodes; must match the latest `agent_pending` (same attempt, no committed yet) — idempotent for identical payloads, rejects conflicting ones.
- **graph_gate_resolve** `{cwd, run_id, node_id, decision: approved|denied, output_summary?}`: the only adjudication port for human-approval nodes; must match that gate's latest `gate_waiting` (misaligned / already-resolved / terminal runs are rejected); `denied` is a first-class outcome (the run ends as gate_denied).

### Journal vocabulary registration (additions beyond the 7 frozen types above — binding for the runtime and hand-written journals alike)

```jsonl
{"seq":N,"ts":"<ISO-8601>","type":"agent_pending","node_id":"a1","attempt":1}
{"seq":N,"ts":"...","type":"fence_acquired","epoch":2,"owner_pid":12345}
```

- `agent_pending`: an agent node waiting for model-driven completion (`{node_id, attempt}`; the watchdog marks `node_failed{retryable}` past `timeout_ms`); commit via `graph_node_result` → `node_committed`.
- `fence_acquired`: audit line for fence acquisition on resume/takeover (`{epoch, owner_pid}`; not written on a fresh run's first start). Fence metadata itself never enters the journal.

### Fence sidecar layout (inside the run directory, none of it in the journal)

- `owner.lock`: created O_CREAT|O_EXCL with a held fd; payload `{pid, epoch, started_at}` — occupancy mutex and holder identity.
- `owner.epoch`: monotonically increasing integer sidecar (takeover only raises; numbering never rewinds after release).
- `owner.json`: `{pid, started_at, lease_ts}` heartbeat. **stalled = lease older than 30s (default) AND owner pid not alive** — both conditions required; takeover is only allowed when stalled.

### Agent guardrails (runtime-generated, not model discretion)

For agent nodes with `effect_policy=side_effect_free`, the runtime force-prepends a read-only/leaf-guard contract prefix to `instructions` before sealing (idempotent: already-prefixed text is not double-prefixed; MCP and bin share the prefix → same `descriptor_hash`, so cross-entry resume never drifts on the prefix).

### Authority-face honest declaration (prompt-level convention, not a security boundary)

`graph_gate_resolve` and `graph_node_result` **trust the MCP caller** with no proof of user presence — the gate is a workflow construct, not a security boundary (the model already holds pwsh; bypassing it costs nothing). Mitigation: decisions/commits must match the latest pending record (misaligned ones fail closed). A single graph_run/resume call runs unbounded until the first waiting point; client timeouts/disconnects do not affect run progress — poll with graph_status.

## State Contract (状态契约)

Graph **holds no mode state**: the journal and snapshots under `.omd/graph-runs/<run_id>/` ARE the state, written with plain file tools. No `state_write`/`state_clear` cycle. Resume means: read the journal, skip committed nodes, continue. A graph that needs interactive approvals must run in a session where `ask_user_question` is available — otherwise it fails closed at the gate.
