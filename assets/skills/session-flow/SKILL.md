---
name: session-flow
description: "Reorient in the current session with an evidence-backed map of its goal, pivots, outcomes, current step, and open decisions. Advisory summary — never a planner or executor."
when-to-use: 会话切换/压缩后需要快速重定向时；产出证据回路的会话地图（short 模式只报目标/当前步/待决），reset 模式清理由本 skill 持有的记录。
---

Build a compact, evidence-backed map of how this conversation actually unfolded, so the user can reorient after switching sessions or compacting. Advisory only — never a planner, executor, or replacement for the user's task list.

## Modes

- No argument: render the full map; persist owned stage records if the persistence surface is available.
- `short`: only the goal, current stage, and what (if anything) needs the user. Read-only.
- `reset`: remove only records owned by this skill, confirm what was removed; render nothing new.

## Workflow

1. Reconstruct the flow from this conversation's user messages and tool results. Repository state alone is not evidence a stage happened. Separate the original goal from explicit goal changes, pivots, completed outcomes, dropped paths, and decisions waiting on the user.
2. Make 4–8 meaningful stages when the history supports them; fewer over padding. One outcome marker per stage:
   - `✅` completed, with the outcome
   - `▶` current unfinished stage
   - `○` planned but unstarted
   - `✂` dropped, with the stated reason
   - `↪` pivot, old direction → evidenced new direction
3. Give every stage one compact evidence pointer — a real path or a distinctive short quote from the conversation. Never invent a link; mark reconstruction as `inferred` when evidence pre-dates a compaction.
4. Keep the full map to at most 15 lines: one line per stage, plus goal, `Needs you` (open decisions; `none` when absent), and `Next` (concrete next action only when the conversation supports one).

## Persistence (omd adaptation)

Upstream tracks owned stages in host Task tools; dsh has no such surface. Persistence uses the notepad working zone instead:

- Owned records live in the working-memory notepad with the exact marker `session-flow: managed stage` and a `[S<number>]` subject prefix.
- Default mode: reconcile owned records with the map (update surviving stage numbers stably; delete records for stages no longer in the map; add missing ones).
- `reset`: delete only records carrying both the `[S<number>]` prefix and the marker; confirm the removals.
- Records carrying the marker are descriptive history, never an execution-mode state — they must not arm or trigger any omd mode.
