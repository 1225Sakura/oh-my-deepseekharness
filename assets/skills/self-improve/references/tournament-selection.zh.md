---
name: tournament-selection.zh
description: self-improve Step 8 锦标赛选择的参考细节——仅在实际运行选择轮时加载（配对、评审、胜者晋升）。
---

### Step 8 —— 锦标赛选择

SKILL.md 直接执行本步（不委派）：

1. **收集**全部 executor 结果
2. **过滤**只留 `status: "success"`。零候选则跳到 Step 9（记录与可视化）。
3. 按 `benchmark_score` **排序**（尊重 `benchmark_direction`）
4. **候选循环**——按名次从优到劣逐个处理：
   a. **无回归检查**：候选分数相对 `best_score` 必须改进或持平，尊重 `benchmark_direction`（`higher_is_better`：score >= best_score；`lower_is_better`：score <= best_score）
   b. 经 `omd-agent-git-master` **合并**：`git merge experiment/round_{n}_executor_{id} --no-ff -m "Iteration {n}: {hypothesis} (score: {before} → {after})"`
   c. 在合并后的状态上**重跑 benchmark** 确认改进
   d. 重跑**确认**改进：**接受获胜者**，跳出循环
   e. 重跑显示**回归**：`git -C {repo_path} reset --hard HEAD~1` **回滚合并**，继续下一个候选
   f. 合并**冲突**：`git -C {repo_path} merge --abort`，继续下一个候选
5. 获胜者被接受且 settings 里 `auto_push` 为 `true`：**push** 改进分支 `git -C {repo_path} push origin improve/{goal_slug}`（非阻塞）。
   `auto_push` 为 `false`（默认）：跳过 push。记日志：`"Push skipped (auto_push: false). Run manually: git -C {repo_path} push origin improve/{goal_slug}"`
6. 经 git-master **归档**全部非获胜分支：打 tag + 删除
7. 无候选存活：本轮不合并，改进分支保持原状。
8. **写 Merge Report** JSON 到 `<self-improve-root>/state/merge_reports/round_{n}.json`（schema：data_contracts.md 第 9 节）。
