---
name: skill
description: Manage local dsh skills — list, add, remove, edit, search, info, sync, setup wizard
when-to-use: The user wants to manage skills — list what is installed, create a new skill, edit or remove an existing one, search the skill library, or sync skills between user and project scope. Explicit invocation only.
---

# Skill Management

Meta-skill for managing dsh skills through CLI-like subcommands (`skill list`, `skill add <name>`, ...). When invoked without arguments, run the setup wizard (`skill setup`).

## dsh Skill System Semantics

- **Skill format**: every skill is a directory containing `SKILL.md` with YAML frontmatter — `name` (must equal the directory name), `description` (one line), `when-to-use` (one line). Frontmatter key names may only contain `[A-Za-z-]`. An optional `SKILL.zh.md` carries the Chinese copy in bilingual projects.
- **Scan roots** (three scopes):
  - **omd built-in**: the `assets/skills/` directory inside the installed oh-my-dsh plugin package — discoverable and readable, never removed or edited through this skill
  - **User**: `~/.dsh/skills/` — available across all projects for this operator
  - **Project**: `.dsh/skills/` — committable with the repo, shared with the team
- **Invocation**: skills registered by dsh are user-invocable and model-invocable by name; there is no OMC-style plugin marketplace or generated command directory — adding a skill is just writing its directory into a scan root.
- **No quality/usage stats**: OMC's mnemosyne-derived quality scores and usage counters do not exist in omd; do not fabricate them.

## Subcommands

### skill list

Show all available skills organized by scope.

**Behavior:**
1. Scan omd built-in skills in the plugin `assets/skills/` directory (read-only)
2. Scan user skills at `~/.dsh/skills/`
3. Scan project skills at `.dsh/skills/`
4. Parse YAML frontmatter (`name`, `description`, `when-to-use`) for metadata
5. Display in organized table format:

```
BUILT-IN SKILLS (bundled with oh-my-dsh, read-only):
| Name              | Description                    | Scope    |
|-------------------|--------------------------------|----------|
| ralph             | PRD-driven persistence loop    | built-in |
| verify            | Evidence-backed completion     | built-in |

USER SKILLS (~/.dsh/skills/):
| Name              | Description                    | Scope    |
|-------------------|--------------------------------|----------|
| error-handler     | Project-specific error patterns| user     |

PROJECT SKILLS (.dsh/skills/):
| Name              | Description                    | Scope    |
|-------------------|--------------------------------|----------|
| test-runner       | How this repo runs tests       | project  |
```

---

### skill add [name]

Interactive wizard for creating a new skill.

**Behavior:**
1. **Ask for skill name** (if not provided)
   - Validate: lowercase, hyphens only, no spaces
2. **Ask for description** — clear, concise one-liner
3. **Ask for when-to-use** — one line naming the situations that should trigger the skill
4. **Ask for scope:**
   - `user` → `~/.dsh/skills/<name>/SKILL.md`
   - `project` → `.dsh/skills/<name>/SKILL.md`
5. **Create the skill file** with this template:

```markdown
---
name: <name>
description: <description>
when-to-use: <when-to-use>
---

# <Name>

## Purpose

[Describe what this skill does]

## When to Use

[Describe the situations that trigger this skill]

## Workflow

1. [Step 1]
2. [Step 2]
3. [Step 3]

## Notes

[Additional context, edge cases, gotchas]
```

6. **Report success** with the file path
7. **Suggest:** "Edit with `skill edit <name>` to customize content"

---

### skill remove <name>

Remove a skill by name.

**Behavior:**
1. **Search for the skill** in both writable scopes:
   - `~/.dsh/skills/<name>/SKILL.md`
   - `.dsh/skills/<name>/SKILL.md`
2. **If found:** display skill info (name, description, scope) and **ask for confirmation**: "Delete '<name>' skill from <scope>? (yes/no)"
3. **If confirmed:** delete the entire skill directory and report: "✓ Removed skill '<name>' from <scope>"
4. **If not found:** report: "✗ Skill '<name>' not found in user or project scope"

**Safety:** Never delete without explicit user confirmation. Built-in omd skills are never removable through this skill.

---

### skill edit <name>

Edit an existing skill interactively.

**Behavior:**
1. **Find the skill** by name (search both writable scopes)
2. **Read current content** with the `read` tool
3. **Display current values** (name, description, when-to-use, scope)
4. **Ask what to change:**
   - `description` — update description
   - `when-to-use` — update the trigger conditions
   - `content` — edit the full markdown body
   - `rename` — rename the skill (move directory, update frontmatter `name`)
   - `cancel` — exit without changes
5. **For the selected field:** show the current value, ask for the new value, update the YAML frontmatter or content, write back with `edit`/`write`
6. **Report success** with a summary of changes

---

### skill search <query>

Search skills by name, description, when-to-use, or content.

**Behavior:**
1. **Scan all skills** in all three scopes
2. **Match the query** (case-insensitive) against name, description, when-to-use, and full markdown content
3. **Display matches** with context:

```
Found 2 skills matching "typescript error":

1. typescript-fixer (user)
   Description: Fix common TypeScript errors
   Match: "typescript error handling patterns"

2. lint-fix (project)
   Description: Auto-fix linting errors
   Match: "TypeScript ESLint error resolution"
```

**Ranking:** prioritize matches in name/when-to-use over body-content matches.

---

### skill info <name>

Show detailed information about a skill.

**Behavior:**
1. **Find the skill** by name (search all three scopes)
2. **Parse the YAML frontmatter** and content
3. **Display complete details:** name, scope, description, when-to-use, file path, bilingual status (`SKILL.zh.md` present?), then the full content
4. **If not found:** report the error and suggest `skill search`

---

### skill sync

Sync skills between user and project scopes.

**Behavior:**
1. **Scan both writable scopes** (`~/.dsh/skills/`, `.dsh/skills/`)
2. **Compare and categorize:** user-only, project-only, common (in both)
3. **Display sync opportunities** and offer:
   - [1] Copy user skill to project
   - [2] Copy project skill to user
   - [3] View differences for common skills
   - [4] Cancel
4. **Handle the user's choice**, confirming every copy

**Safety:** never overwrite without confirmation.

---

### skill setup

Interactive wizard for setting up and managing local skills.

**Behavior:**

#### Step 1: Directory Check and Setup

```powershell
# User-level skills directory
$UserSkillsDir = Join-Path $HOME '.dsh\skills'
if (Test-Path $UserSkillsDir) { "User skills directory exists: $UserSkillsDir" }
else { New-Item -ItemType Directory -Force $UserSkillsDir | Out-Null; "Created: $UserSkillsDir" }

# Project-level skills directory
$ProjectSkillsDir = '.dsh\skills'
if (Test-Path $ProjectSkillsDir) { "Project skills directory exists: $ProjectSkillsDir" }
else { New-Item -ItemType Directory -Force $ProjectSkillsDir | Out-Null; "Created: $ProjectSkillsDir" }
```

#### Step 2: Skill Scan and Inventory

Scan both directories (`glob` for `**/SKILL.md` under each root, parse frontmatter `name`/`description`) and show an inventory with modification times and a total.

#### Step 3: Quick Actions Menu

Use the `ask_user_question` tool to offer:

1. **Add new skill** — start the creation wizard (`skill add`)
2. **List all skills with details** — full inventory (`skill list`)
3. **Scan conversation for patterns** — analyze the current conversation for skill-worthy patterns, then invoke `skillify` for anything the user wants to capture
4. **Import skill** — import from a URL or pasted content
5. **Done** — exit the wizard

**Option 3: Scan Conversation for Patterns**

Look for: recent debugging sessions with non-obvious solutions, tricky bugs that required investigation, codebase-specific workarounds, error patterns that took time to resolve. Report findings and ask whether to extract any as skills via `skillify`.

**Option 4: Import Skill**

Ask for either a URL (fetch with `read_page`) or pasted markdown content, then ask for scope (user vs project). Validate the dsh skill format (frontmatter with `name`/`description`/`when-to-use`, valid key names, directory name matches `name`) and save to the chosen location.

---

### skill scan

Quick command to scan both writable skill directories (Step 2 of `skill setup` without the wizard).

---

## Skill Templates

Offer these when creating skills via `skill add` / `skill setup`:

### Error Solution Template

```markdown
---
name: error-[short-slug]
description: Solution for [specific error in specific context]
when-to-use: The error "[exact message fragment]" appears in [specific context]
---

# [Error Name]

## The Insight
What is the underlying cause of this error? What principle did you discover?

## Why This Matters
What goes wrong if you don't know this? What symptom led here?

## Recognition Pattern
- Error message: "[exact error]"
- File: [specific file path]
- Context: [when does this occur]

## The Approach
1. [Specific action with file/line reference]
2. [Specific action with file/line reference]
3. [Verification step]

## Example
\`\`\`
// Before (broken) / After (fixed)
\`\`\`
```

### Workflow Skill Template

```markdown
---
name: workflow-[short-slug]
description: Process for [specific task in this codebase]
when-to-use: [task description or goal keyword that should trigger it]
---

# [Workflow Name]

## The Insight
What makes this workflow different from the obvious approach?

## Why This Matters
What fails if you don't follow this process?

## Recognition Pattern
- Task type: [specific task]
- Files involved: [specific patterns]
- Indicators: [how to recognize]

## The Approach
1. [Step with specific commands/files]
2. [Step with specific commands/files]
3. [Verification]

## Gotchas
- [Common mistake and how to avoid it]
- [Edge case and how to handle it]
```

### Code Pattern Template

```markdown
---
name: pattern-[short-slug]
description: Pattern for [specific use case in this codebase]
when-to-use: Working on [file types / problem domain] where [recognition cue]
---

# [Pattern Name]

## The Insight
What's the key principle behind this pattern?

## Why This Matters
What problems does this pattern solve in THIS codebase?

## Recognition Pattern
- File types: [specific files]
- Problem: [specific problem]
- Context: [codebase-specific context]

## The Approach
1. [Principle-based step]
2. [Principle-based step]

## Anti-Pattern
What NOT to do and why.
```

### Integration Skill Template

```markdown
---
name: integration-[short-slug]
description: How [system A] integrates with [system B] in this codebase
when-to-use: Touching the integration between [system A] and [system B]
---

# [Integration Name]

## The Insight
What's non-obvious about how these systems connect?

## Why This Matters
What breaks if you don't understand this integration?

## Recognition Pattern
- Files: [specific integration files]
- Config: [specific config locations]
- Symptoms: [what indicates integration issues]

## The Approach
1. [Configuration step with file paths]
2. [Setup step with specific details]
3. [Verification step]

## Gotchas
- [Integration-specific pitfall #1]
- [Integration-specific pitfall #2]
```

---

## Error Handling

**All commands must handle:**
- File/directory doesn't exist
- Permission errors
- Invalid YAML frontmatter
- Duplicate skill names
- Invalid skill names (spaces, special chars)

**Error format:**
```
✗ Error: <clear message>
→ Suggestion: <helpful next step>
```

---

## Usage Modes

### Direct Command Mode

When invoked with an argument, skip the interactive wizard: `skill list`, `skill add`, `skill scan`, etc.

### Interactive Mode

When invoked without arguments, run the full guided wizard (`skill setup`).

---

## Benefits of Local Skills

**Automatic Application**: the harness surfaces matching skills via `when-to-use` — no need to remember or search for solutions.

**Version Control**: project-level skills (`.dsh/skills/`) are intended to be committed with your code so the whole team benefits. In linked worktrees, uncommitted skills remain local to that worktree and disappear if it is removed.

**Evolving Knowledge**: skills improve over time as you discover better approaches and refine the `when-to-use` conditions.

**Reduced Token Usage**: instead of re-solving the same problems, the model applies known patterns efficiently.

**Codebase Memory**: preserves institutional knowledge that would otherwise be lost in conversation history.

---

## Skill Quality Guidelines

Good skills are:

1. **Non-Googleable** — can't easily be found via search
   - BAD: "How to read files in TypeScript"
   - GOOD: "This codebase uses custom path resolution requiring fileURLToPath"

2. **Context-Specific** — references actual files/errors from THIS codebase
   - BAD: "Use try/catch for error handling"
   - GOOD: "The aiohttp proxy in server.py:42 crashes on ClientDisconnectedError"

3. **Actionable with Precision** — tells exactly WHAT to do and WHERE
   - BAD: "Handle edge cases"
   - GOOD: "When seeing 'Cannot find module' in dist/, check tsconfig.json moduleResolution"

4. **Hard-Won** — required significant debugging effort
   - BAD: generic programming patterns
   - GOOD: "Race condition in worker.ts — Promise.all at line 89 needs await"

---

## Related Skills

- `skillify` — extract a skill from the current conversation
- `remember` — route durable knowledge into notepad / project memory (lighter than a skill)
- `deepinit` — generate an AGENTS.md codebase hierarchy

## Implementation Notes

1. **YAML parsing:** frontmatter extraction only; reject unknown-key formats gracefully
2. **File operations:** use `read`/`write`/`edit` tools; never `edit` for new files
3. **User confirmation:** always confirm destructive operations
4. **Clear feedback:** use checkmarks (✓), crosses (✗), arrows (→)
5. **Scope resolution:** built-in scope is read-only; writes only ever target user or project scope
6. **Validation:** enforce naming conventions (lowercase, hyphens only) and the `[A-Za-z-]` frontmatter key rule

## State Contract (状态契约)

Skill **holds no mode state**. It performs no `state_write`/`state_clear`; its only side effects are the skill files it creates, edits, moves, or deletes under the user/project scan roots. When invoked inside an enclosing mode, that mode's state contract governs mode persistence.
