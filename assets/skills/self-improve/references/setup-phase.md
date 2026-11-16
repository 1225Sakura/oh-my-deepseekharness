---
name: setup-phase
description: Reference detail for the self-improve setup phase — load only when initializing a fresh improvement campaign (candidate discovery, baseline capture, budget setup).
---

## Setup Phase

1. Check if target repo path exists. If not configured, ask user for the path to the repository to improve.
2. Resolve `<self-improve-root>` by running `node {skill_dir}/scripts/resolve-paths.mjs --project-root {repo_path} [--topic "..."] [--slug "..."] [--session-id <sid>] --ensure-dirs`.
3. Create the `<self-improve-root>/` directory structure by copying from `templates/` in this skill directory into the resolved `config/` root.
4. Read `<self-improve-root>/state/agent-settings.json`. Check `si_setting_goal`, `si_setting_benchmark`, `si_setting_harness`.
5. **Trust confirmation** (mandatory, cannot be skipped):
   a. If `trust_confirmed` is already `true` in agent-settings.json, skip to step 6 (resume path).
   b. Display the target repo path and ask user to confirm:
      `"Self-improve will run benchmark commands inside {repo_path}. This executes arbitrary code in that repository. Confirm? [yes/no]"`
   c. If user declines: abort setup and exit. Do NOT proceed.
   d. Record consent: set `trust_confirmed: true` in agent-settings.json.
6. Persist `topic_slug` into `config/settings.json` when the resolved root is topic-scoped so future resumes stay on the same track.
7. If goal not set → read `si-goal-clarifier.md` from this skill directory and run the 4-dimension Socratic interview directly in this context (Objective, Metric, Target, Scope). Write result to `<self-improve-root>/config/goal.md`.
8. If benchmark not set → read `si-benchmark-builder.md` from this skill directory, spawn a high-tier `subagent` with its content as prompt. The agent surveys the repo, creates or wraps a benchmark, validates 3x, and records baseline.
   After benchmark is set, confirm the benchmark command with user:
      `"Benchmark command: {benchmark_command}. This will be run repeatedly during the loop. Confirm? [yes/no]"`
   If user declines: abort setup and exit.
9. If harness not set → confirm default harness rules (H001/H002/H003) with user or customize.
10. **Gate**: All of `si_setting_goal`, `si_setting_benchmark`, `si_setting_harness`, `trust_confirmed` must be true.
11. **Create improvement branch** (if it does not exist):
    ```
    git -C {repo_path} checkout -b improve/{goal_slug} {target_branch}
    git -C {repo_path} checkout {target_branch}
    ```
    Where `{goal_slug}` is derived from the goal objective (lowercase, underscored). If the branch already exists, skip creation. Persist `goal_slug` in agent-settings.json.
12. **Mode exclusivity**: Call `omd_state_list_active({ cwd })`. If any omd mode is active (autopilot, ralph, team, ralplan, deep-interview), refuse to start — omd modes are mutually exclusive.
13. Write initial state per the State Contract: `omd_state_write` with `mode: "self-improve"`, `active: true`, `iteration: 0`, `started_at`.

---
