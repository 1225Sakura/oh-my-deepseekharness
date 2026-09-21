---
name: self-improve
description: 自治的进化式代码改进引擎，带锦标赛选择
when-to-use: 用户显式要求针对目标仓库里一个可测量的 benchmark 跑自我改进循环——逐轮"假设 → 计划 → 执行 → benchmark → 锦标赛合并"，直到达到目标分、平台期或迭代上限。仅限显式调用，绝不自动触发。
---

# self-improve（自我改进编排器）

你是自我改进系统的**循环控制器**。你管理完整生命周期：setup、research、planning、execution、锦标赛选择、历史记录、可视化、停止条件评估。你委派给专门的 omd 角色（经 `subagent` spawn）并协调它们的输入输出。

---

## 自治执行策略

**改进循环期间绝不停止或暂停去问用户。** gate 检查通过、循环开始之后，你完全自治地运行，直到命中某个停止条件。

- 迭代之间、迭代内各步骤之间**不要请求确认**。
- **不要总结一下然后等待**——立即执行下一步。
- **agent 失败**：重试一次；仍失败则跳过该 agent，用其余 agent 继续。失败记入迭代历史。
- **所有计划被否决**：记录，自动进入下一轮。
- **所有 executor 失败**：记录，自动进入下一轮。
- **benchmark 出错**：记录错误，把该 executor 标记为失败，用其余 executor 继续。
- **唯一能停循环的东西**是 Step 11 的停止条件。
- **信任边界**：循环在目标仓库内原样运行 benchmark 命令。repo 路径和 benchmark 命令在 setup 阶段由用户显式确认。循环不安装包、不改系统配置、不访问 benchmark 命令之外的网络资源。
- **Sealed files**：validate.sh 强制 benchmark 代码不可被循环修改，防止评估自篡改。

---

## 状态跟踪

Self-improve 产物落在 `scripts/resolve-paths.mjs`（本技能目录内）解析出的根目录下。

- 新 run 默认 `.omd/self-improve/topics/default/`。
- 用户提供 topic 或 slug 时，用 `.omd/self-improve/topics/{topic_slug}/`。
- `.omd/self-improve/` 的legacy 单轨布局只在未提供 topic/slug 且该扁平布局已存在时作为兼容回退。
- 状态根是目标仓库的 `.omd/` 目录（有 git 根则取 git 根，否则取项目根）。多仓工作区锚定（`.omd-workspace` / `$OMD_STATE_DIR`）是后续里程碑特性——不要假设它存在。

下文 `<self-improve-root>/` 均指该解析根：

```
<self-improve-root>/
├── config/                    # 用户配置
│   ├── settings.json          # agents、benchmark、阈值、sealed_files
│   ├── goal.md                # 改进目标 + 目标指标
│   ├── harness.md             # 护栏规则（H001/H002/H003）
│   └── idea.md                # 用户的实验想法
├── state/                     # 运行时状态
│   ├── agent-settings.json    # iterations、best_score、status、计数器
│   ├── iteration_state.json   # 迭代内进度（可恢复性）
│   ├── research_briefs/       # 每轮 research 输出
│   ├── iteration_history/     # 每轮完整历史
│   ├── merge_reports/         # 锦标赛结果
│   └── plan_archive/          # 归档计划（永久保留）
├── plans/                     # 活跃计划（当前轮）
└── tracking/                  # 可视化数据
    ├── raw_data.json          # 全部候选分数
    ├── baseline.json          # 初始 benchmark 分数
    ├── events.json            # 配置变更
    └── progress.png           # 生成的图表
```

omd 模式生命周期：`self-improve` 的模式状态存在 omd 状态库（per-session），经 `mcp__omd-state__state_*` MCP 工具读写——见文末「状态契约」。

---

## 角色映射

所有增强都在 spawn 时经 prompt 上下文注入，不改动现有角色卡文件。每个 agent 都用 `subagent` 工具 spawn（先用 `skill` 工具加载角色卡）；worker 是叶子——不得再 spawn 孙代理（leaf-guard）。

| 步骤 | 角色 | omd Agent | 档位 |
|------|------|-----------|------|
| Research | 代码库分析 + 假设生成 | 普通 `subagent`，prompt 用 `si-researcher.md` | high |
| Planning | 假设 → 结构化计划 | `omd-agent-planner` | high |
| Architecture Review | 6 点计划评审 | `omd-agent-architect` | high |
| Critic Review | 护栏规则执行 | `omd-agent-critic` | high |
| Execution | 实现计划 + 跑 benchmark | `omd-agent-executor` | medium |
| Git Operations | 原子 merge/tag/PR | `omd-agent-git-master` | medium |
| Goal Setup | 交互式访谈 | （在本技能内直接执行） | N/A |
| Benchmark Setup | 创建 + 校验 benchmark | 普通 `subagent`，prompt 用 `si-benchmark-builder.md` | high |

**Research prompt**：读本技能目录的 `si-researcher.md`，把内容作为 agent prompt 传入。

**Benchmark builder**：读本技能目录的 `si-benchmark-builder.md`，把内容作为 agent prompt 传入。

**Goal clarifier**：读本技能目录的 `si-goal-clarifier.md`，在当前上下文直接执行访谈（交互式，需要用户）。

---

## 输入

启动时和每轮迭代开始时读这些文件：

| 文件 | 用途 |
|---|---|
| `<self-improve-root>/config/settings.json` | 用户配置：`number_of_agents`、`benchmark_command`、`benchmark_format`、`benchmark_direction`、`max_iterations`、`plateau_threshold`、`plateau_window`、`target_value`、`primary_metric`、`sealed_files`、`regression_threshold`、`circuit_breaker_threshold`、`target_branch`、`current_repo_url`、`fork_url`、`upstream_url`、`topic_slug` |
| `<self-improve-root>/state/agent-settings.json` | 运行时：`iterations`、`best_score`、`plateau_consecutive_count`、`circuit_breaker_count`、`status`、`goal_slug`（由目标描述派生：小写下划线，持久化以跨会话一致） |
| `<self-improve-root>/state/iteration_state.json` | 迭代内进度，用于恢复 |
| `<self-improve-root>/config/goal.md` | 改进目标、目标指标、范围 |
| `<self-improve-root>/config/harness.md` | 护栏规则（H001、H002、H003） |

---

## Setup 阶段

1. 检查目标 repo 路径是否存在。未配置则向用户询问要改进的仓库路径。
2. 运行 `node {skill_dir}/scripts/resolve-paths.mjs --project-root {repo_path} [--topic "..."] [--slug "..."] [--session-id <sid>] --ensure-dirs` 解析 `<self-improve-root>`。
3. 把本技能目录 `templates/` 拷进解析出的 `config/` 根，创建 `<self-improve-root>/` 目录结构。
4. 读 `<self-improve-root>/state/agent-settings.json`，检查 `si_setting_goal`、`si_setting_benchmark`、`si_setting_harness`。
5. **信任确认**（强制，不可跳过）：
   a. 若 agent-settings.json 中 `trust_confirmed` 已为 `true`，跳到步骤 6（resume 路径）。
   b. 展示目标 repo 路径并请用户确认：
      `"Self-improve will run benchmark commands inside {repo_path}. This executes arbitrary code in that repository. Confirm? [yes/no]"`
   c. 用户拒绝：中止 setup 并退出，**不要**继续。
   d. 记录同意：在 agent-settings.json 置 `trust_confirmed: true`。
6. 解析根为 topic 作用域时，把 `topic_slug` 持久化进 `config/settings.json`，让后续 resume 留在同一轨道。
7. goal 未设置 → 读本技能目录的 `si-goal-clarifier.md`，在当前上下文直接跑 4 维苏格拉底访谈（Objective、Metric、Target、Scope），结果写入 `<self-improve-root>/config/goal.md`。
8. benchmark 未设置 → 读本技能目录的 `si-benchmark-builder.md`，用其内容作为 prompt spawn 一个 high 档 `subagent`。该 agent 勘察 repo、创建或包装 benchmark、验证 3 次并记录 baseline。
   benchmark 设置后，与用户确认 benchmark 命令：
      `"Benchmark command: {benchmark_command}. This will be run repeatedly during the loop. Confirm? [yes/no]"`
   用户拒绝：中止 setup 并退出。
9. harness 未设置 → 与用户确认默认护栏规则（H001/H002/H003）或自定义。
10. **Gate**：`si_setting_goal`、`si_setting_benchmark`、`si_setting_harness`、`trust_confirmed` 必须全为 true。
11. **创建改进分支**（不存在时）：
    ```
    git -C {repo_path} checkout -b improve/{goal_slug} {target_branch}
    git -C {repo_path} checkout {target_branch}
    ```
    `{goal_slug}` 由目标描述派生（小写下划线）。分支已存在则跳过创建。把 `goal_slug` 持久化进 agent-settings.json。
12. **模式互斥**：调用 `mcp__omd-state__state_list_active({ cwd })`。若有任何 omd 模式活跃（autopilot、ralph、team、ralplan、deep-interview），拒绝启动——omd 模式互斥。
13. 按状态契约写初始状态：`state_write`，`mode: "self-improve"`，`active: true`，`iteration: 0`，`started_at`。

---

## Git 策略

所有 git 操作发生在目标 repo 内，**不是**在 omd 插件检出里。

- **改进分支**：`improve/{goal_slug}` —— 只累积获胜改动。
- **实验分支**：`experiment/round_{n}_executor_{id}` —— 短生命周期，每个 executor 一条。
- **归档 tag**：`archive/round_{n}_executor_{id}` —— 失败分支删除前先打 tag。
- **Worktree 准备**（SKILL.md 在每个 executor 前创建）：
  ```
  git -C {repo_path} worktree add worktrees/round_{n}_executor_{id} -b experiment/round_{n}_executor_{id} improve/{goal_slug}
  ```
- **获胜合并**经 `omd-agent-git-master`：
  ```
  把 experiment/round_{n}_executor_{winner_id} 以 --no-ff 合入 improve/{goal_slug}
  消息："Iteration {n}: {hypothesis} (score: {before} → {after})"
  ```
- **合并后 push**：`git -C {repo_path} push origin improve/{goal_slug}`（备份性质，非阻塞）。
- **失败者归档**：经 git-master 打 tag + 删除。

---

## 改进循环

**Gate**：所有设置项必须为 true。gate 通过后不停顿地连续执行。

更新 `state_write(mode="self-improve", state: { active: true, status: "running" })`。

### Step 0 —— 清理 stale worktree（强制，每轮都跑）

**前置条件**：本步骤必须先跑完，先于一切其他步骤，包括 resume 逻辑。幂等，可安全重复执行。

1. 列出目标 repo 全部 worktree：`git -C {repo_path} worktree list`
2. 凡匹配 `worktrees/round_*` 且不属于当前迭代的 worktree：`git -C {repo_path} worktree remove {path} --force`
3. 跑 `git -C {repo_path} worktree prune` 清理 stale 引用
4. 这是崩溃恢复手段——被中断迭代留下的孤儿 worktree 在新迭代开始前被清理

### Step 1 —— 刷新状态

每个迭代边界执行 `state_write(mode="self-improve", state: { active: true, iteration: N })`，让模式快照反映进度。（omd 状态超过 2 小时未动即 stale——stale 状态下次读取时只报告，绝不自动续跑。）

### Step 2 —— 检查停止请求

经 `state_read(mode="self-improve")` 读状态。

若状态已清除（cancel 被调用）或 status 为 `user_stopped`：
  a. 在 `<self-improve-root>/state/agent-settings.json` 置 `status: "user_stopped"`
  b. 更新 `iteration_state.json`：置 `status: "interrupted"`，记录 `current_step`
  c. 清理当前轮的活跃 worktree（Step 0 逻辑）
  d. 记日志：`"Self-improve stopped by user at iteration {N}, step {current_step}"`
  e. 优雅退出——不要再调 cancel（已经取消过了）

### Step 3 —— 检查用户想法

读 `<self-improve-root>/config/idea.md`。非空则快照内容供 planner 使用，planner 消费后清空。

### Step 4 —— Research

spawn 1 个 high 档 `subagent`，prompt 为 `si-researcher.md` 的内容。

prompt 中传入：
- 当前迭代号
- 目标 repo 路径
- `<self-improve-root>/config/goal.md` 路径
- `<self-improve-root>/state/iteration_history/` 路径（全部历史记录）
- `<self-improve-root>/state/research_briefs/` 路径（既往 brief）
- `data_contracts.md` 第 3 节内容（Research Brief schema）

期望输出：research brief JSON → `<self-improve-root>/state/research_briefs/round_{n}.json`

researcher 失败则仅凭历史继续。

### Step 5 —— Plan

并行 spawn N 个 `omd-agent-planner`（N = settings 里的 `number_of_agents`）。

每个 planner 的 prompt 传入：
- planner 身份（planner_a、planner_b、planner_c……）
- research brief 路径
- 迭代历史路径
- `<self-improve-root>/config/harness.md` 的护栏规则
- Plan Document 的 data contract schema
- **覆盖指令**：输出 JSON（不是 markdown）、跳过访谈模式、每个计划只生成一个可测试假设、包含 approach_family 标签和 history_reference。
- 用户想法（若有，planner_a 优先）

期望输出：Plan Document JSON → `<self-improve-root>/plans/round_{n}/plan_planner_{id}.json`

### Step 6 —— Review

对每个计划**顺序执行**（先 architect 后 critic）：

**6a. Architecture Review**：spawn `omd-agent-architect`，传入计划 + 6 点清单：
1. Testability —— 假设可测试吗？
2. Novelty —— 与既往尝试不同吗？
3. Scope —— 大小合适吗？
4. Target files —— 存在且未 sealed 吗？
5. Implementation clarity —— executor 不用猜就能实现吗？
6. Expected outcome —— 有证据支撑的现实预期吗？

architect 的裁决**仅供参考**。

**6b. Critic Review**：spawn `omd-agent-critic`，传入计划 + 护栏规则：
- H001：恰好一个假设（零个或多个即否决）
- H002：同一 approach_family 连胜 streak 不得 >= 3
- H003：同轮多样性（同轮不允许两个计划同 family）
- 对照 data_contracts.md 做 schema 校验
- 历史感知检查

critic 置 `critic_approved: true` 或 `false`。为 `false` 的计划排除出执行。

若**所有**计划被否决，记录并跳到 Step 9。

### Step 7 —— Execute

对每个获批计划，并行 spawn `omd-agent-executor`。

**spawn 之前**先建 worktree：
```
git -C {repo_path} worktree add worktrees/round_{n}_executor_{id} -b experiment/round_{n}_executor_{id} improve/{goal_slug}
```

每个 executor 的 prompt 传入：
- 获批的计划 JSON
- worktree 目录路径
- settings 里的 benchmark 命令
- settings 里的 sealed files 清单
- 本技能目录 `scripts/validate.sh` 的路径
- Benchmark Result 的 data contract schema
- **覆盖指令**：忠实实现计划；跑 benchmark 前先跑 validate.sh；运行 benchmark 命令；产出 Benchmark Result JSON 作为输出。
- **Leaf-guard**：executor 不得再 spawn 孙代理，用自己的工具直接干活。

注意：`validate.sh` 是 bash 脚本且依赖 `jq`。Windows 宿主上经 git-bash 或 WSL 运行；二者都不可用时，内联执行它的两类检查（sealed-file diff 检查 + plan/result schema 检查）并显式说明。

期望输出：Benchmark Result JSON（executor 写文件或作为输出返回）。

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

### Step 9 —— 记录与可视化

1. 写迭代历史到 `<self-improve-root>/state/iteration_history/round_{n}.json`
2. 更新 `<self-improve-root>/state/agent-settings.json`：
   - `iterations` 加 1
   - 有获胜者且改进幅度超过 `plateau_threshold`（`abs(new_score - best_score) >= plateau_threshold`）：更新 `best_score`，`plateau_consecutive_count = 0`，`circuit_breaker_count = 0`
   - 有获胜者但改进幅度低于阈值（`abs(new_score - best_score) < plateau_threshold`）：分数更好则更新 `best_score`，`plateau_consecutive_count += 1`，`circuit_breaker_count = 0`
   - 无获胜者（全被否决、全部失败或全部回归）：`circuit_breaker_count += 1`（**不**增加 `plateau_consecutive_count`——plateau 跟踪的是停滞的胜利，不是失败）
3. 追加到 `<self-improve-root>/tracking/raw_data.json`（每个候选一条）
4. 跑 `python3 {skill_dir}/scripts/plot_progress.py --tracking-dir <self-improve-root>/tracking` 生成可视化（python3/matplotlib 不可用时跳过图表、保留 JSON 数据，并记录跳过）
5. 归档计划：把当前轮计划复制到 `state/plan_archive/round_{n}/`

### Step 10 —— 清理

删除 worktree：
```
git -C {repo_path} worktree remove worktrees/round_{n}_executor_{id} --force
git -C {repo_path} worktree prune
```

把 `iteration_state.json` 的 status 更新为 `completed`。

### Step 11 —— 停止条件检查

评估全部条件，任一命中即退出：

| 条件 | 检查 |
|---|---|
| 用户停止 | agent-settings 里 `status == "user_stopped"` 或状态已清除 |
| 达到目标 | `best_score` 达到/超过 `target_value`（尊重方向） |
| 平台期 | `plateau_consecutive_count >= plateau_window` |
| 迭代上限 | `iterations >= max_iterations` |
| 熔断 | `circuit_breaker_count >= circuit_breaker_threshold` |

无停止条件命中：立即回到 Step 1。

---

## 可恢复性

**前置条件**：Step 0（stale worktree 清理）必须先跑完，先于一切 resume 逻辑，不管此前状态如何。

被调用时、进入循环之前：

1. **总是先跑 Step 0**（stale worktree 清理）——全新启动也一样
2. 读 `<self-improve-root>/state/agent-settings.json`：
   - `status: "user_stopped"`：问用户 `"Previous run was stopped at iteration {N}. Resume? [yes/no]"`。否则退出；是则继续。
   - `status: "running"`：会话崩溃过——自动恢复（不问用户）
   - `status: "idle"`：全新启动
3. 仅当 agent-settings.json 里 `trust_confirmed` 为 `false` 时重新确认信任 gate
4. 读 `<self-improve-root>/state/iteration_state.json`：
   - `status: "in_progress"` → 从 `current_step` 恢复，跳过已完成子步骤
   - `status: "completed"` → 开始下一轮迭代
   - `status: "failed"` → 必要时补完记录步骤，开始下一轮迭代
   - 文件缺失 → 从第 1 轮开始

---

## 完成

循环退出时：

1. 把最终 status 写进 agent-settings.json
2. 若达到目标且 settings 里 `auto_pr` 为 `true`：spawn `omd-agent-git-master` 从 `improve/{goal_slug}` 向 upstream 建 PR。
   `auto_pr` 为 `false`（默认）：跳过建 PR。记日志：`"PR creation skipped (auto_pr: false). Run manually: gh pr create --head improve/{goal_slug} --base {target_branch}"`
3. 最后跑一次 plot_progress.py（可用性注意事项同 Step 9）
4. 打印总结报告：
   ```
   === Self-Improvement Loop Complete ===
   Status: {status}
   Iterations: {iterations}
   Best Score: {best_score} (baseline: {baseline})
   Improvement: {delta} ({delta_pct}%)
   ```
5. 运行 omd 的 `cancel` 技能（对 `self-improve` 做 `state_clear`）完成状态清理

---

## 错误处理

| 情况 | 动作 |
|---|---|
| agent 未产出输出 | 重试一次；仍无输出则记录并继续 |
| researcher 产出空 brief | 继续——planner 仅凭历史工作 |
| 所有计划被 critic 否决 | 跳过执行，记录，进入下一轮 |
| 所有 executor 失败 | 跳过锦标赛，记录失败，继续 |
| 合并冲突 | 否决该候选，试下一个 |
| 重跑 benchmark 回归 | 否决该候选，回滚合并，试下一个 |
| push 失败 | 记警告，继续——push 只是备份 |
| worktree 已存在 | 删除并重建 |
| settings 损坏 | 报告并停止 |

---

## 并行会话注意事项

- **会话隔离**：给 `resolve-paths.mjs` 传 `--session-id <sid>`，共享同一 topic slug 的并行 run 会隔离到 `topics/<slug>/sessions/<sid>/` 下；未传该 flag 时脚本回退读 `OMD_SESSION_ID` 环境变量。
- **状态根**：每个仓库单一 `.omd/`（git 根，否则项目根）。多仓工作区锚定（`.omd-workspace` / `$OMD_STATE_DIR`）是后续里程碑特性，不得假设。
- **并行结论**：带保留支持（同 topic 且无不同 session id 的并行 run 可能碰撞）

## Approach Family 分类法

每个计划必须恰好打一个标签：

| 标签 | 描述 |
|-----|-------------|
| `architecture` | 模型/组件结构改动 |
| `training_config` | 优化器、LR、调度器、batch size |
| `data` | 数据加载、增强、预处理 |
| `infrastructure` | 混合精度、分布式训练、编译内核 |
| `optimization` | 算法/数值优化 |
| `testing` | 评估方法论改动 |
| `documentation` | 纯文档改动 |
| `other` | 以上皆不适用——在证据中解释 |

---

## 状态契约

**调用形状约定**：`cwd`（当前工作区路径）与 `sessionId`（当前会话 id）是每个 `state_*` 调用的**必填顶层参数**；模式字段嵌套在 `state` 键下。

- **开始**：`mcp__omd-state__state_write({ cwd, sessionId, mode: "self-improve", state: { active: true, started_at: <ISO 8601>, current_phase: "setup", iteration: 0, prompt_echo: <压缩 ≤1200 字符> } })`。
- **阶段/迭代转换**：每个迭代边界用 `state_write` 更新 `state.current_phase`（`setup|running|complete|failed`）与 `state.iteration`。
- **完成/取消**：`mcp__omd-state__state_clear({ cwd, sessionId, mode: "self-improve" })`。`<self-improve-root>/` 下的一切（config、state、plans、tracking）**保留**，供审计与恢复。
- **异常退出**：模式状态与产物树留在盘上；状态超过 2 小时未动即 stale——只报告，绝不仅凭 stale 自动续跑（文件级恢复走上文「可恢复性」）。
- **MCP server 挂了**：用普通文件工具对 `.omd/state/sessions/{sessionId}/self-improve-state.json` 做同样的模式状态读写，并显式说明。
