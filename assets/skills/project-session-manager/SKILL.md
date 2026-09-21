---
name: project-session-manager
description: Worktree-first isolated dev environments for issues, PRs, and features — git worktree + provider CLI (gh/jira) methodology adapted to dsh sessions
when-to-use: The user wants an isolated environment to review a PR, fix an issue, or develop a feature in parallel with other work ("review PR #123 in a worktree", "set up a session for issue #42", "psm", "teleport"). OMC's psm.sh/omc teleport CLI do not exist in omd — this skill executes the same methodology with plain git/gh commands and dsh sessions.
---

# Project Session Manager (worktree-first isolated dev environments)

**Port note (read first).** OMC shipped this skill with a bash implementation (`psm.sh`, `omc teleport` CLI, tmux session orchestration, a `~/.psm/` registry). omd ships **no CLI and no tmux integration** — this port keeps the methodology skeleton (worktree-first isolation, provider-driven metadata, lifecycle hygiene) and executes it with the tools dsh actually has: `pwsh`/shell for `git` + provider CLIs, one **dsh session per worktree** as the "session" concept, and `.omd/` for metadata. tmux orchestration and a managed session registry are noted as **phase-2** where they cannot be faithfully reproduced.

## Core idea

One task = one git worktree = one dsh session. Work on PR reviews, issue fixes, and features in parallel without touching the user's current checkout.

## Quick start (teleport-equivalent, worktree only)

```bash
# Issue/PR worktree (GitHub, from the repo root)
git fetch origin pull/123/head:pr-123-review   # PR ref; for issues branch from main instead
git worktree add ../worktrees/pr-123 pr-123-review

# Feature worktree
git fetch origin main
git worktree add ../worktrees/feat-add-webhooks -b feature/add-webhooks origin/main

# List / remove
git worktree list
git worktree remove ../worktrees/pr-123 --force
```

Then open a dsh session **with the worktree as the working directory** and hand it the task brief (see "Session kickoff" below).

## Session types and naming

| Type | Trigger | Branch convention | Worktree dir (suggested) |
|---|---|---|---|
| PR review | `review <repo>#<n>` | `pr-<n>-review` (fetched `pull/<n>/head`) | `<worktree_root>/pr-<n>` |
| Issue fix | `fix <repo>#<n>` | `fix/<n>-<slug>` | `<worktree_root>/issue-<n>` |
| Feature | `feature <name>` | `feature/<name>` | `<worktree_root>/feat-<name>` |

Suggested `<worktree_root>`: a sibling `../worktrees/` directory or a user-chosen root — omd does not impose `~/.psm/`. Keep it consistent per user.

## Provider references

Supported ref formats (resolve with the provider CLI, default GitHub `gh`):

- `owner/repo#123`, `alias#123` (alias = your own mapping, see below), full GitHub URL, or bare `#123` for the current repo.

Fetch context before creating the worktree:

```bash
gh pr view 123 --repo owner/repo --json number,title,author,headRefName,baseRefName,body,url
gh issue view 42 --repo owner/repo --json number,title,body,labels,url
```

Jira (or other trackers): works the same way — the tracker supplies the issue text, git supplies the repo. Use the `jira` CLI for `PROJ-123` refs. Only treat `PROJ-123` as a tracker ref when the user has said PROJ is a tracker project (avoids false positives from branch names like `FIX-123`).

Optional project alias file: if the user wants aliases, keep a small JSON (e.g. `.omd/psm-projects.json` in the anchor repo, or a user-global file they name) mapping `alias → { repo, local, default_base, provider? }`. This replaces `~/.psm/projects.json`.

## Session metadata

Drop a metadata file into each worktree so any later session can reconstruct context:

```json
// <worktree>/.omd-psm-session.json
{
  "id": "myrepo:pr-123",
  "type": "review",
  "ref": "pr-123",
  "branch": "pr-123-review",
  "base": "main",
  "created_at": "<ISO-8601>",
  "worktree_path": "<abs path>",
  "source_repo": "<abs path>",
  "provider": { "kind": "github", "number": 123, "title": "…", "author": "…", "url": "…" },
  "state": "active"
}
```

## Session kickoff

1. Resolve ref → fetch PR/issue/feature context via provider CLI.
2. Create branch + worktree (commands above).
3. Write the metadata file.
4. Open a dsh session in the worktree and give it a self-contained brief, e.g.:
   - review: `Review PR #123: "<title>" by @<author> (<head> → <base>). URL: <url>. Load the review skill.`
   - fix: `Fix issue #42: "<title>". URL: <url>. Branch: <branch>.`
   - feature: `Implement feature "<name>" for <project>. Branch: <branch>.`

**dsh reality:** there is no `claude` CLI to launch inside tmux and no `tmux send-keys` delivery. "Attach" = open/switch to the dsh session whose cwd is that worktree. If the user genuinely wants tmux-managed terminals, that is an external, user-driven setup — omd documents it but does not orchestrate it (phase-2 candidate).

## Lifecycle

- **List**: `git worktree list` in the source repo + glob for `.omd-psm-session.json` under the worktree root.
- **Status**: read the metadata file in the current worktree.
- **Kill/close**: `git worktree remove <path> --force` (confirm unmerged work first), delete the metadata, optionally delete the branch.
- **Cleanup**: for each recorded session, check provider state — `gh pr view <n> --json state,merged` / `gh issue view <n> --json state` — and remove worktrees whose PR merged / issue closed. Report kept vs removed. Suggested retention default: 14 days for untouched worktrees (ask before removing anything with uncommitted changes).

## Error handling

| Error | Resolution |
|---|---|
| Worktree path exists | Offer: reuse (open session there), recreate (remove + add), or abort |
| PR/issue not found | Verify ref and repo permissions (`gh auth status`) |
| `gh` missing | Tell the user to install GitHub CLI; non-GitHub hosts need their own CLI or manual ref resolution |
| Uncommitted changes on remove | Stop and ask — never force-remove silently |

## omd state caveat

Each worktree has its **own `.omd/` state directory** (state is anchored at the session cwd). Mode state (autopilot/ralph/team) does not transfer between the main checkout and a worktree — by design, isolation is the point. If shared state across worktrees is ever needed, that is a phase-2 design item (compare OMC's `.omc-workspace` marker).

## Phase-2 gaps (explicitly not ported)

- `psm.sh` script and `omc teleport` CLI (omd has no CLI surface)
- tmux session creation/attach and prompt delivery via `send-keys`
- `~/.psm/sessions.json` global registry + `cleanup_after_days` automation
- `claude --dangerously-skip-permissions` auto-launch

## State Contract (状态契约)

project-session-manager **holds no omd mode state**: no `state_write`/`state_clear`. Its only persistent artifacts are git worktrees/branches and the per-worktree `.omd-psm-session.json` metadata files it creates. Destructive steps (worktree removal, branch deletion) always require explicit user confirmation.
