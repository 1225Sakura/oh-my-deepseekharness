---
name: ask-navigator
description: Navigator lane — chart a foggy effort (destination unclear, questions not yet stateable) into a map of decision tickets, work the frontier one ticket per session, then hand the collapsed decisions off as a mission brief. Wayfinding, not building — it produces decisions, never deliverables.
when-to-use: An effort is wrapped in fog — the destination cannot be stated in one sentence, or the first three decisions cannot be stated precisely. Invoke with a loose idea, with residual questions, with a map path, or with nothing to continue the open map. Not for work whose route is already clear (deliver with autopilot/team instead).
---

# Ask Navigator

Ask-navigator is the **navigator**: it takes an effort wrapped in fog — the way from here to the destination isn't visible yet — and charts it as a **map of decision tickets**, then works the frontier one ticket per session until the route is clear. It produces **decisions, never deliverables**: when the way is clear it hands off, it doesn't build.

> **Port note.** OMC's original belongs to the Shipyard family (`drydock`, `launch`, `loft`, `harbor`) — **all four are ported to omd**, so cross-references are live. One honest substitution remains:
> - Issue tracker (GitHub/GitLab) → omd is zero-external-dependency: **local markdown is the default map home**; a tracker-backed map is optional only when the user explicitly has `gh`/`glab` available and asks for it.

**The role contract.** The captain (the human) signs the destination (W1) and the chart (W2); the navigator drafts everything else and **never answers a question that belongs to the captain** — a grilling session in which the agent answers its own questions has broken the role, not just the process. Facts are the navigator's job; decisions are the captain's.

**Fog test.** An effort has fog when either answer is no:

1. **Q1** — Can the destination be stated in one sentence: the spec, decision, or change this effort is finding its way to?
2. **Q2** — Can the first three decisions be stated precisely right now, even though none of them can be answered yet?

Both yes → no map is needed; deliver directly (autopilot/team). Either no → chart first. `ask-navigator` is also reachable directly: invoke it with a loose idea, with residual questions, or with no argument to continue the open map.

## Map home

The default map home is **local markdown**: `.omd/wayfinder/<map-slug>/map.md` plus `decisions/NN-<slug>.md`, one file per ticket, numbered in dependency order. Local mode has no concurrent-claim guarantee: it is single-driver by convention, stated once in the map's Notes.

If — and only if — the user explicitly asks for a tracker-backed map and has the CLI available (`gh`/`glab`, checked via `pwsh`): one map issue labelled `navigator:map`, child issues per ticket, native blocking/sub-issue relationships. The map then lives where humans already look.

Either way, the map is an **index, not a store**: a decision lives in exactly one place — its ticket. The map gists each resolution in one line and links; it never restates the detail.

## Document language

Map and ticket prose follow the repo's document language: read `documentLanguage` from `CONTEXT.md` frontmatter when present; if the yard is not laid, ask the language question once during charting (W2) and record the resolved tag in the map's Notes. Paths, labels, the `navigator:map` label, ticket-type names (`research`, `loft`, `grilling`, `task`), `HITL`/`AFK`, and `blockedBy` are stable tokens and stay byte-for-byte stable in every language.

## Chart the map

Invoked with a loose idea (or residual questions). Charting is one session's work; it hand-resolves nothing.

1. **Yard check, defer the findings.** Optionally run the `drydock` skill's `--check` audit first; if the yard is not laid (no `CONTEXT.md`, no `docs/adr/`), note it once in the map's Notes under `Deferred sediment` and proceed; never block charting on it.
2. **W1 — name the destination.** Load the `deep-interview` skill and pin down what this map is finding its way to: the spec, decision, or change. The destination fixes the scope, so it is settled first. **W1 is a captain signature: present the destination statement and get explicit confirmation.** If the captain cannot state a destination even with the interview's help, that is not an error — present the best candidates ranked and let the captain pick one to chart toward or park the effort.
3. **Map the frontier.** Grill again with `deep-interview`, **breadth-first**: fan out across the whole space rather than deep on any one thread, surfacing the open decisions and the first steps takeable now. **If this surfaces no fog** — the way to the destination is already clear and the journey fits one session — no map is needed: stop and recommend direct delivery (autopilot/team).
4. **W2 — sign the chart.** Present the proposed map: destination, initial tickets with types and blocking edges, and the fog sketch. **W2 is a captain signature**: granularity wrong here wastes every later session. Iterate until signed.
5. **Create the map and tickets.** Local mode: write `map.md` and one `decisions/NN-<slug>.md` per ticket; wire blocking edges (`blockedBy`) in a second pass once ticket numbers exist. Everything not yet sharp enough to ticket stays in **Not yet specified**.
6. **Fire the research subagents.** For each `research` ticket just created, spawn a background `subagent` to resolve it in parallel (see Ticket types), capturing findings where the ticket can link them.
7. **Stop** with the session-close pointer: the map path, how many tickets are on the frontier, and "next session, run `ask-navigator` to work the next decision."

## Work through the map

Invoked with a map (path) or with no argument (pick up the open map under `.omd/wayfinder/`). A ticket is optional: without one, take the next frontier ticket, not one the captain must choose.

1. **Load the map**: the low-res view, never every ticket body. Zoom into a ticket's full body on demand.
2. **Claim before work**: set `Claimed-by` in the ticket file **first** (tracker mode: assign to the captain or comment), so concurrent sessions skip it. An open, unclaimed ticket is unclaimed.
3. **Resolve it** according to its type (see Ticket types). Zoom as needed; load the `deep-interview` skill whenever the resolution needs the captain's input.
4. **Record the resolution**: write the answer as the ticket's Resolution section, mark the ticket closed (completed; a ticket ruled beyond the destination closes as not planned), and append one line to the map's **Decisions so far** — `[<ticket title>](path): <one-line gist>`.
5. **Advance the frontier**: graduate any fog the answer has made specifiable (remove it from **Not yet specified**, create the new tickets, wire edges); if the answer reveals a ticket sits beyond the destination, **close it** and leave one line in **Out of scope**; update or delete tickets the decision invalidated.
6. **Sediment** (see Sediment).
7. **Stop after one ticket.** One resolution per session is the cadence — it is the context-window budget, not a policy. The session-close pointer names what just resolved and what is now on the frontier.

## Ticket types

Every ticket is **HITL** (worked with the captain, who speaks for themselves) or **AFK** (driven by the navigator alone). A HITL ticket only resolves through live exchange; the agent never stands in for the captain's side.

| Type | Mode | Resolved by | Use when |
|---|---|---|---|
| `research` | AFK | Background `subagent`: investigate against primary sources (official docs, source code, specs), leave a cited Markdown file at `docs/research/<ticket-slug>.md` (or the repo's existing notes convention when one exists), link it from the ticket | A decision waits on knowledge outside the current working directory |
| `loft` | HITL | Load the `loft` skill to build a throwaway artifact that answers the ticket's question — a pure logic module in a runnable shell, or structurally different UI variants behind one route; the captain reacts, the answer folds into the resolution, the artifact stays on a `loft/<name>` branch | The question is precise but prose cannot settle it — it needs to be seen or clicked, not described |
| `grilling` | HITL | Load the `deep-interview` skill; the captain decides each round | Conversation is the resolution — the default case |
| `task` | HITL or AFK | The navigator drives it alone where it can; otherwise hands the captain a precise checklist | Manual work that unblocks a decision (sign up for a service, provision access, move data so its shape can be seen) — it earns its place by unblocking a decision, not by delivering the destination |

The answer is never part of the ticket body; it is recorded on resolution. Assets created while resolving are linked from the ticket, not pasted in.

## Map body

```markdown
## Destination

<what reaching the end of this map looks like: the spec, decision, or change this effort is finding its way to. One or two lines; every session orients to it before choosing a ticket.>

## Notes

<domain; skills every session should consult; standing preferences; yard-unlaid caveats; resolved documentLanguage tag; single-driver caveat for local mode>

## Decisions so far

<!-- the index: one line per closed ticket, enough to judge relevance, then zoom the link for the detail the ticket holds -->

- [<closed ticket title>](path): <one-line gist of the answer>

## Not yet specified

<!-- in-scope fog you cannot ticket yet; graduates as the frontier advances -->

## Out of scope

<!-- work ruled beyond the destination; closed, never graduates -->
```

**Fog or ticket?** The test is whether you can state the question precisely now, not whether you can answer it now. Ticket when the question is already sharp, even if it is blocked. Not-yet-specified when you cannot phrase it that sharply — do not pre-slice the fog into ticket-sized pieces; one patch may graduate into several tickets, or none. **Out of scope** is a scoping act, not a step on the route: scope, not sharpness, lands work there, and it returns only if the destination is redrawn.

## Sediment

Resolutions land in the paper trail the moment they settle:

- a term the resolutions settled or sharpened → `CONTEXT.md` glossary (one entry: definition, boundary, resolved ambiguity)
- a decision passing the ADR test (hard to reverse, surprising without context, a real tradeoff) → `docs/adr/NNNN-<slug>.md`
- a business rule or background fact → `docs/business/` (one article per business question)

When the yard is not laid, **defer, don't skip**: record each pending landing as one line in the map's Notes under a `Deferred sediment` heading, so the later delivery run knows exactly what to land first.

## Exit — hand off, don't build

The map is done when no open tickets remain and **Not yet specified** is empty. Then:

1. Collapse **Decisions so far** into a **mission brief**: objective, scope boundary, non-goals — writable now because the way is clear. Write it to `.omd/wayfinder/<map-slug>/brief.md` so the handoff passes a pointer, not content.
2. Recommend: "The way is clear. Run `launch` (or `autopilot`/`team`) with the brief at `.omd/wayfinder/<map-slug>/brief.md`." The map stays as the effort's logbook.

## Scope and non-goals

- No daemon, no mode, no always-on behavior, no runtime state machine: the map is ordinary repo files under `.omd/wayfinder/`.
- Never mutates team lifecycle, task statuses, or mode state; never publishes delivery tickets — build tickets belong to the delivery mode, and the navigator must not pre-slice fog into them.
- Never executes a decision beyond recording it. The one exception is a `task` ticket, which does only what unblocks a decision.
- The map's Decisions-so-far is an index; a decision lives in exactly one place, its ticket.

## Completion definition

A charting session ends with a captain-signed map and fired research tickets. A working session ends with exactly one resolution recorded, the frontier advanced, and the session-close pointer emitted. The effort ends when the way is clear and the mission brief is in the captain's hands with a delivery mode recommended — every decision the navigator made on the captain's behalf answerable with one pointer to where it was recorded.

## State Contract (状态契约)

Ask-navigator **holds no mode state** — deliberately: no `state_write`/`state_clear`, nothing under `.omd/state/`. The map files under `.omd/wayfinder/<map-slug>/` are the entire durable state; "resume" is just reading the open map. This matches the OMC original's no-daemon/no-mode contract.
