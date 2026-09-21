---
name: external-context
description: Spawn parallel document-specialist subagents for external web searches and documentation lookup
when-to-use: A question needs external documentation, references, or context from the web — best practices, library comparisons, latest framework patterns. Explicit invocation only; not for repo-local questions (use research).
---

# External Context

Fetch external documentation, references, and context for a query. Decomposes into 2-5 facets and spawns parallel `omd-agent-document-specialist` subagents.

## Usage

```
external-context <topic or question>
```

### Examples

```
external-context What are the best practices for JWT token rotation in Node.js?
external-context Compare Prisma vs Drizzle ORM for PostgreSQL
external-context Latest React Server Components patterns and conventions
```

## Protocol

### Step 1: Facet Decomposition

Given a query, decompose into 2-5 independent search facets:

```markdown
## Search Decomposition

**Query:** <original query>

### Facet 1: <facet-name>
- **Search focus:** What to search for
- **Sources:** Official docs, GitHub, blogs, etc.

### Facet 2: <facet-name>
...
```

### Step 2: Parallel Subagent Invocation

Fire independent facets in parallel via the `subagent` tool (background), each carrying the `omd-agent-document-specialist` role card:

```
subagent(description="Facet: <facet-name>", run_in_background=true, prompt="<omd-agent-document-specialist role card>

Task: Search for: <facet description>. Use web_search and read_page to find official documentation and examples. Cite all sources with URLs.")
```

Maximum 5 parallel document-specialist subagents. Collect each settled subagent's final message before synthesizing.

> OMC note: the original invoked `Task(subagent_type="oh-my-claudecode:document-specialist", model="sonnet", ...)` with WebSearch/WebFetch. In omd the `subagent` tool inherits the main-session model (soft routing) — the role card passed in the prompt is what makes it a document-specialist; `web_search` / `read_page` are the dsh equivalents of WebSearch/WebFetch.

### Step 3: Synthesis Output Format

Present synthesized results in this format:

```markdown
## External Context: <query>

### Key Findings
1. **<finding>** - Source: [title](url)
2. **<finding>** - Source: [title](url)

### Detailed Results

#### Facet 1: <name>
<aggregated findings with citations>

#### Facet 2: <name>
<aggregated findings with citations>

### Sources
- [Source 1](url)
- [Source 2](url)
```

## Configuration

- Maximum 5 parallel document-specialist subagents
- No magic keyword trigger — explicit invocation only

## State Contract (状态契约)

External-context **holds no mode state**: one-shot fan-out plus synthesis; nothing is written under `.omd/state/`. If a finding is worth keeping across sessions, write it to `mcp__omd-state__notepad_write_working` / `notepad_write_priority` explicitly.
