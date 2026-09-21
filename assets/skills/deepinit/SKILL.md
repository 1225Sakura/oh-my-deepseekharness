---
name: deepinit
description: Deep codebase initialization with hierarchical AGENTS.md documentation
when-to-use: A repo lacks AI-readable documentation and agents/humans keep re-discovering structure; you want a navigable AGENTS.md hierarchy covering every directory. Re-run in update mode to refresh stale files. Not for throwaway prototypes or single-file scripts.
---

# Deep Init

Creates comprehensive, hierarchical AGENTS.md documentation across the entire codebase. AGENTS.md is a first-class project-rules surface in dsh — this skill generates the hierarchy.

## Core Concept

AGENTS.md files serve as **AI-readable documentation** that helps agents understand:
- What each directory contains
- How components relate to each other
- Special instructions for working in that area
- Dependencies and relationships

## Hierarchical Tagging System

Every AGENTS.md (except root) includes a parent reference tag:

```markdown
<!-- Parent: ../AGENTS.md -->
```

This creates a navigable hierarchy:
```
/AGENTS.md                          ← Root (no parent tag)
├── src/AGENTS.md                   ← <!-- Parent: ../AGENTS.md -->
│   ├── src/components/AGENTS.md    ← <!-- Parent: ../AGENTS.md -->
│   └── src/utils/AGENTS.md         ← <!-- Parent: ../AGENTS.md -->
└── docs/AGENTS.md                  ← <!-- Parent: ../AGENTS.md -->
```

## AGENTS.md Template

```markdown
<!-- Parent: {relative_path_to_parent}/AGENTS.md -->
<!-- Generated: {timestamp} | Updated: {timestamp} -->

# {Directory Name}

## Purpose
{One-paragraph description of what this directory contains and its role}

## Key Files
{List each significant file with a one-line description}

| File | Description |
|------|-------------|
| `file.ts` | Brief description of purpose |

## Subdirectories
{List each subdirectory with brief purpose}

| Directory | Purpose |
|-----------|---------|
| `subdir/` | What it contains (see `subdir/AGENTS.md`) |

## For AI Agents

### Working In This Directory
{Special instructions for AI agents modifying files here}

### Testing Requirements
{How to test changes in this directory}

### Common Patterns
{Code patterns or conventions used here}

## Dependencies

### Internal
{References to other parts of the codebase this depends on}

### External
{Key external packages/libraries used}

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
```

## Execution Workflow

### Step 1: Map Directory Structure

Spawn `omd-agent-explore` via `subagent`:

```
subagent(prompt="List all directories recursively using glob. Exclude: node_modules, .git, dist, build, __pycache__, .venv, coverage, .next, .nuxt, .omd")
```

### Step 2: Create Work Plan

Generate todo items (`todo_write`) for each directory, organized by depth level:

```
Level 0: / (root)
Level 1: /src, /docs, /tests
Level 2: /src/components, /src/utils, /docs/api
...
```

### Step 3: Generate Level by Level

**IMPORTANT**: Generate parent levels before child levels to ensure parent references are valid.

For each directory:
1. Read all files in the directory
2. Analyze purpose and relationships
3. Generate AGENTS.md content
4. Write file with proper parent reference

### Step 4: Compare and Update (if exists)

When AGENTS.md already exists:

1. **Read existing content**
2. **Identify sections**:
   - Auto-generated sections (can be updated)
   - Manual sections (`<!-- MANUAL -->` preserved)
3. **Compare**:
   - New files added?
   - Files removed?
   - Structure changed?
4. **Merge**:
   - Update auto-generated content
   - Preserve manual annotations
   - Update timestamp

### Step 5: Validate Hierarchy

After generation, run validation checks:

| Check | How to Verify | Corrective Action |
|-------|--------------|-------------------|
| Parent references resolve | Read each AGENTS.md, check `<!-- Parent: -->` path exists | Fix path or remove orphan |
| No orphaned AGENTS.md | Compare AGENTS.md locations to directory structure | Delete orphaned files |
| Completeness | List all directories, check for AGENTS.md | Generate missing files |
| Timestamps current | Check `<!-- Generated: -->` dates | Regenerate outdated files |

Validation pattern (dsh tools, not shell):
- Use `glob` with pattern `AGENTS.md` to find every AGENTS.md file.
- Use `grep` with pattern `<!-- Parent:` over the repo to audit parent references.

## Smart Delegation

| Task | Agent |
|------|-------|
| Directory mapping | `omd-agent-explore` (low tier, `subagent`) |
| File analysis | `omd-agent-architect` (high tier) |
| Content generation | `omd-agent-writer` (medium tier) |
| AGENTS.md writes | `omd-agent-writer` |

Spawned agents are leaf executors: they must not spawn further sub-agents; they return findings/drafts and the orchestrating session writes the files.

## Empty Directory Handling

When encountering empty or near-empty directories:

| Condition | Action |
|-----------|--------|
| No files, no subdirectories | **Skip** - do not create AGENTS.md |
| No files, has subdirectories | Create minimal AGENTS.md with subdirectory listing only |
| Has only generated files (*.min.js, *.map) | Skip or minimal AGENTS.md |
| Has only config files | Create AGENTS.md describing configuration purpose |

Example minimal AGENTS.md for directory-only containers:
```markdown
<!-- Parent: ../AGENTS.md -->
# {Directory Name}

## Purpose
Container directory for organizing related modules.

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `subdir/` | Description (see `subdir/AGENTS.md`) |
```

## Parallelization Rules

1. **Same-level directories**: Process in parallel (multiple `subagent` calls in one turn)
2. **Different levels**: Sequential (parent first)
3. **Large directories**: Spawn dedicated agent per directory
4. **Small directories**: Batch multiple into one agent

## Quality Standards

### Must Include
- [ ] Accurate file descriptions
- [ ] Correct parent references
- [ ] Subdirectory links
- [ ] AI agent instructions

### Must Avoid
- [ ] Generic boilerplate
- [ ] Incorrect file names
- [ ] Broken parent references
- [ ] Missing important files

## Example Output

### Root AGENTS.md
```markdown
<!-- Generated: 2024-01-15 | Updated: 2024-01-15 -->

# my-project

## Purpose
A web application for managing user tasks with real-time collaboration features.

## Key Files
| File | Description |
|------|-------------|
| `package.json` | Project dependencies and scripts |
| `tsconfig.json` | TypeScript configuration |
| `.env.example` | Environment variable template |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `src/` | Application source code (see `src/AGENTS.md`) |
| `docs/` | Documentation (see `docs/AGENTS.md`) |
| `tests/` | Test suites (see `tests/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- Always install dependencies after modifying the project manifest
- Use TypeScript strict mode
- Follow ESLint rules

### Testing Requirements
- Run tests before committing
- Ensure >80% coverage

### Common Patterns
- Use barrel exports (index.ts)
- Prefer functional components

## Dependencies

### External
- React 18.x - UI framework
- TypeScript 5.x - Type safety
- Vite - Build tool

<!-- MANUAL: Custom project notes can be added below -->
```

### Nested AGENTS.md
```markdown
<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2024-01-15 | Updated: 2024-01-15 -->

# components

## Purpose
Reusable React components organized by feature and complexity.

## Key Files
| File | Description |
|------|-------------|
| `index.ts` | Barrel export for all components |
| `Button.tsx` | Primary button component |
| `Modal.tsx` | Modal dialog component |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `forms/` | Form-related components (see `forms/AGENTS.md`) |
| `layout/` | Layout components (see `layout/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- Each component has its own file
- Use CSS modules for styling
- Export via index.ts

### Testing Requirements
- Unit tests in `__tests__/` subdirectory
- Use React Testing Library

### Common Patterns
- Props interfaces defined above component
- Use forwardRef for DOM-exposing components

## Dependencies

### Internal
- `src/hooks/` - Custom hooks used by components
- `src/utils/` - Utility functions

### External
- `clsx` - Conditional class names
- `lucide-react` - Icons

<!-- MANUAL: -->
```

## Triggering Update Mode

When running on an existing codebase with AGENTS.md files:

1. Detect existing files first
2. Read and parse existing content
3. Analyze current directory state
4. Generate diff between existing and current
5. Apply updates while preserving manual sections

## Performance Considerations

- **Cache directory listings** - Don't re-scan same directories
- **Batch small directories** - Process multiple at once
- **Skip unchanged** - If directory hasn't changed, skip regeneration
- **Parallel writes** - Multiple agents drafting different files simultaneously

## State Contract (状态契约)

deepinit **holds no mode state**: no `state_write`/`state_clear`. Its deliverables are the AGENTS.md files on disk (user-owned, committed at the user's discretion) — nothing is written under `.omd/`. On interruption, re-run in update mode; existing files and `<!-- MANUAL -->` sections are preserved by the merge rules above.
