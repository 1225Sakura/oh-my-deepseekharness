---
name: graph
description: Declarative DAG pipeline contract — deterministic graph semantics and journal-based crash recovery, executed model-driven in omd until the phase-2 runtime lands
when-to-use: Repeatable multi-step pipelines with explicit dependencies (DAG), work that must survive interruption, auditable runs. Not for exploratory one-off work (use conversation or team) or anything needing adaptive re-planning mid-run (graphs are deterministic).
---

# Graph

Run a deterministic orchestration graph from a declarative JSON descriptor.

> **Port status (read first).** The OMC original executes through an independent OS process (`omc graph run`) backed by the sealed-descriptor and pure-scheduler contracts in `src/graph/*`, with an OCC journal for real crash recovery. **That runtime is not ported — it is omd phase-2.** What this skill carries today is the full methodology skeleton: the descriptor contract, node/edge semantics, and the recovery discipline. Execution in omd is **model-driven** (see below): the guarantees below marked as runtime-enforced are conventions here, not hard guarantees.

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

### Runtime exit codes (OMC original, phase-2 in omd)

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

Edge kinds: `fixed` | `conditional` | `fan_out`/`join` pairs | `back_edge` (bounded retries via `max_traversals`). OMC's authoritative Zod schema lives in `src/graph/schema.ts`; omd has no schema validator yet — validate by inspection and fail fast on malformed descriptors.

## Capability Boundary & Semantics (read before authoring)

- **Edge support**: in model-driven execution, `fixed` edges and `fan_out`/`join` pairs are practical today. `conditional` and `back_edge` routes require route-emitting results — OMC's built-in executors never produce routes and fail fast with `route_required`; in omd, treat graphs relying on them as **unsupported until the phase-2 runtime**, and say so instead of guessing routes.
- **Crash-recovery guarantee is at-least-once** for command nodes: a crash between an external side effect and its journal append re-executes that node on resume. For `idempotent` commands, expose the resolved key to the command as the `GRAPH_IDEMPOTENCY_KEY` environment value and record it for downstream dedupe. Exactly-once for external side effects is out of scope.
- **Command trust boundary**: command nodes are arbitrary shell lines run via `pwsh` with real process authority in the current working directory. Only run descriptors you wrote or trust. Commands are not filesystem/process sandboxed.
- **Agent authority boundary**: built-in agent nodes are read-only by convention — in omd this is prompt-level discipline (dsh `subagent` has no tool-restriction parameter), so state it in the node's `instructions` and prefer read-only role cards. Treat `.omd/graph-runs/<run_id>/descriptor.json` as executable content.

## State Contract (状态契约)

Graph **holds no mode state**: the journal and snapshots under `.omd/graph-runs/<run_id>/` ARE the state, written with plain file tools. No `state_write`/`state_clear` cycle. Resume means: read the journal, skip committed nodes, continue. A graph that needs interactive approvals must run in a session where `ask_user_question` is available — otherwise it fails closed at the gate.
