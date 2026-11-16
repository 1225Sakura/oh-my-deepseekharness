---
name: tournament-selection
description: Reference detail for self-improve Step 8 tournament selection — load only when actually running a selection round (pairing, judging, winner promotion).
---

### Step 8 — Tournament Selection

SKILL.md does this directly (not delegated):

1. **Collect** all executor results
2. **Filter** to `status: "success"` only. If zero candidates, skip to Step 9 (Record & Visualize).
3. **Rank** by `benchmark_score` (respecting `benchmark_direction`)
4. **Ranked-candidate loop** — for each candidate in rank order (best first):
   a. **No-regression check**: candidate score must improve or hold even vs `best_score`, respecting `benchmark_direction` (`higher_is_better`: score >= best_score; `lower_is_better`: score <= best_score)
   b. **Merge** via `omd-agent-git-master`: `git merge experiment/round_{n}_executor_{id} --no-ff -m "Iteration {n}: {hypothesis} (score: {before} → {after})"`
   c. **Re-benchmark** on merged state to confirm improvement
   d. If re-benchmark **confirms** improvement: **accept winner**, break loop
   e. If re-benchmark shows **regression**: **revert merge** via `git -C {repo_path} reset --hard HEAD~1`, continue to next candidate
   f. If merge **conflicts**: `git -C {repo_path} merge --abort`, continue to next candidate
5. If a winner was accepted AND `auto_push` is `true` in settings: **Push** improvement branch: `git -C {repo_path} push origin improve/{goal_slug}` (non-blocking).
   If `auto_push` is `false` (default): skip push. Log: `"Push skipped (auto_push: false). Run manually: git -C {repo_path} push origin improve/{goal_slug}"`
6. **Archive** all non-winner branches via git-master: tag + delete
7. If no candidate survived the loop: no merge this round. Improvement branch stays at prior state.
8. **Write Merge Report** JSON to `<self-improve-root>/state/merge_reports/round_{n}.json` (schema: data_contracts.md Section 9).
