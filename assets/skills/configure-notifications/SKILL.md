---
name: configure-notifications
description: Notification setup for omd — honest status and the closest dsh equivalents. OMC's notifier rides Claude Code session hooks (session-end, idle, ask-user-question) writing ~/.claude/.omc-config.json; dsh has no session-event notification surface, so there is nothing to wire inside the plugin today. This skill documents the replacement paths.
when-to-use: The user asks to configure Telegram/Discord/Slack notifications, session-end alerts, or "notify me when the agent finishes". Not for in-session progress reporting (that is ordinary goal/subagent reporting).
---

# Configure Notifications (dsh reality + replacement paths)

> **Honest status:** OMC's notification system is driven by Claude Code session hooks (`SessionEnd`, `Notification`, `Stop`) plus a config file at `~/.claude/.omc-config.json` and CLI activation flags (`omc --telegram` etc.). Under dsh, **none of these surfaces exist for omd**: the hooks bridge (when present at all) exposes no session-end/idle event the plugin can consume, and omd has no background daemon. There is therefore **nothing to configure inside omd** — do not write config files, do not invent a notification panel, and say this plainly to the user.

## What still works without any notification surface

- **Goal completion reporting** — an `autopilot`/goal-driven run reports back in the session when it settles; the GUI shows the finished turn. For "tell me when it's done" inside one session, this is the answer.
- **State pull** — `mcp__omd-state__state_get_status` / `state_list_active` answer "is anything still running" from any session.
- **`job_list` / `list_agents`** — background jobs and subagents report settlement in-session automatically.

## Replacement paths (user-owned, outside the plugin)

If the user genuinely needs push notifications (Telegram/Discord/Slack) when a long run finishes, the honest options are:

1. **External watcher script (recommended).** omd persists mode state under `.omd/state/` and goal/mode artifacts on disk. A small user-owned script (PowerShell/Python) can poll the workspace's `.omd/` (or watch it with a filesystem watcher) and POST to a webhook when a mode goes terminal. omd never manages this script; `scripts/` in the user's repo is the shipyard slot for it.
2. **Custom MCP server.** A user-built MCP server can expose a `notify` tool; the skill/protocol layer can then call it at mode boundaries (e.g. the completion-report step). MCP servers are declared in the dsh profile's cordis patch — not inside omd.
3. **Provider-native webhooks.** Telegram bot / Discord webhook / Slack incoming-webhook mechanics are unchanged (OMC's wizard text for obtaining tokens and URLs still applies as external documentation) — but the *sending* must come from path 1 or 2, not from omd.

## Answering the wizard questions honestly

- If asked to "configure telegram/discord/slack": explain the missing surface, then offer to scaffold path 1 (a watcher script in the repo's `scripts/`) or describe path 2. That is the entire scope of this skill.
- Never collect bot tokens into omd-owned files — omd has no notification config schema and should not grow one silently; this gap is a recorded spec-divergence candidate.

## State Contract (状态契约)

configure-notifications **holds no mode state** and writes nothing on its own. Scaffolding a watcher script (option 1) writes only to the user's `scripts/` at the user's explicit request; nothing goes under `.omd/`.
