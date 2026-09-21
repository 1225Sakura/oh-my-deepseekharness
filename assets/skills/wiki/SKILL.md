---
name: wiki
description: LLM Wiki — persistent markdown knowledge base under .omd/wiki that compounds across sessions (Karpathy model), maintained with plain file tools
when-to-use: The user wants to store, query, or groom durable project/session knowledge ("wiki this", "wiki add", "wiki query", "wiki lint"), or significant discoveries should be captured as wiki pages instead of being lost at session end.
---

# wiki — persistent markdown knowledge base

A persistent, self-maintained markdown knowledge base for project and session knowledge (Karpathy's LLM Wiki concept): pages compound across sessions instead of evaporating with the context window.

**Port mapping (OMC → dsh).** OMC backed this skill with seven `wiki_*` MCP tools (ingest/query/lint/add/list/read/delete). omd ships **no wiki MCP server** (spec: wiki tooling is an explicit phase-2 item) — the same operations are executed with plain file tools against `.omd/wiki/`. The methodology (categories, cross-references, lint checks, git-ignored storage) is unchanged.

## Storage layout

```
.omd/wiki/
├── index.md            # catalog of all pages (maintained on every write)
├── log.md              # append-only operation chronicle
└── <category>/
    └── <page-slug>.md  # markdown with YAML frontmatter
```

Page frontmatter:

```markdown
---
title: Auth Architecture
category: architecture
tags: [auth, architecture]
updated: <ISO-8601>
---
```

## Operations (file-tool equivalents of the OMC wiki_* tools)

| Operation | How (dsh file tools) |
|---|---|
| **Ingest** | Decompose the knowledge into one or more pages; `write` each page, then update `index.md` and append to `log.md`. One ingest may touch multiple pages — prefer updating an existing page over creating a near-duplicate. |
| **Add** | Single-page quick ingest: `write` one page + index + log entries. |
| **Query** | `grep` over `.omd/wiki/` for keywords, filter by `category`/`tags` from frontmatter; read the matching pages and **synthesize the answer yourself with citations** (page names) — there is no search engine, you are it. |
| **List / Read** | Read `index.md` / read the specific page file. |
| **Delete** | Remove the page file, update `index.md`, append a log entry. Confirm with the user first. |
| **Lint** | Health-check pass: orphan pages (not in `index.md`), stale content (old `updated` vs recent project changes), broken `[[cross-references]]`, oversized pages (split candidates), structural contradictions between pages. Report findings; fix only after user confirms. |

## Categories

`architecture`, `decision`, `pattern`, `debugging`, `environment`, `session-log`

## Cross-references

Use `[[page-slug]]` wiki-link syntax between pages. Keep slugs stable — a rename must update every inbound link (lint catches misses).

## Hard constraints

- **No vector embeddings** — query is keyword + tag matching only (grep-driven).
- Wiki pages are git-ignored by default: `.omd/` (including `.omd/wiki/`) is project-local operational state.
- Prefer updating pages over proliferating them; the wiki compounds by accretion, not duplication.

## Auto-capture (phase-2)

OMC auto-captured significant discoveries as `session-log` pages at session end via a hook. omd's MVP does not wire the hooks bridge (`dsh-hooks-claude-code` is a host-native package, to be wired in phase 2), so **capture is manual**: when something significant is learned, wiki-add it immediately rather than waiting for session end. A deterministic session-end capture hook is a phase-2 item.

## State Contract (状态契约)

wiki **holds no omd mode state**: no `state_write`/`state_clear`. Its entire state is the `.omd/wiki/` content it maintains. For short-lived working notes prefer the notepad MCP tools (`mcp__omd-state__notepad_*`); the wiki is for knowledge meant to compound.
