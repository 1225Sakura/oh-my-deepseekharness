---
name: setup-phase.zh
description: self-improve Setup 阶段的参考细节——仅在初始化新改进战役时加载（候选发现、基线采集、预算设定）。
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
