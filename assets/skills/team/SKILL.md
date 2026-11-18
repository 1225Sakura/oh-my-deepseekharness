---
name: team
description: Use when the user explicitly invokes team — the lead orchestrates role-carded teammates through the five-stage pipeline on the host-native agentTeams surface, with handoff docs between stages.
when-to-use: EXPLICIT INVOCATION ONLY ("use team to …", "/team …"). No keyword trigger — the word "team" in ordinary text must NOT activate this skill, and inside worker sessions the whole keyword routing table is inert. Use for parallel multi-agent execution of a decomposable task. **Since the dsh-native rework the runtime IS the host**: durable teammates (`spawn_teammate`), the mailbox (`send_message` / inbox), the shared task board (`team_task_*`), waiting (`wait_agent`), and interruption (`interrupt_agent`) are all host-native — omd contributes the five-stage discipline, handoff docs, and role-card routing, not a runtime (🚫 no custom mailbox/worktree registry anymore).
---

# team

## 定位（dsh-native 二期③）

team 的运行时就是宿主：`spawn_teammate`（创建 durable 队员）、`send_message`（消息总线，双向）、`team_task_create/get/list/update`（共享任务板，CAS 修订）、`wait_agent`（等待变更）、`interrupt_agent`（打断）、`list_agents`（名册）。omd 只贡献三样东西：

1. **五阶段纪律**（本文件的流程骨架）
2. **阶段交接文档**（`omd_handoff_write`/`omd_handoff_read`，五段固定格式）
3. **角色卡路由**（`omd-agent-*` 走 `omd_delegate` 或宿主 `subagent` 的 provider/model 硬路由）

## 模式生命周期（互斥约束不变）

- **开始**：关键词 hook 预写态携 expectUpdatedAt，接管续写同一 token；`omd_state_write({ mode: "team", state: { active: true, started_at, current_phase: "team-plan", prompt_echo: <压缩 ≤1200 字符>, team_name: <slug> } })`；先 `omd_state_list_active()` 确认无其它活跃模式。
- **完成**：全队收尾确认后 `omd_state_clear({ mode: "team" })`。
- **取消**（`/omd-cancel` 或用户说停）：尽力通知全队（`send_message` + `interrupt_agent`），然后 `omd_state_clear({ mode: "team" })`。`.omd/handoffs/` 与 `.omd/plans/` 永不删除。

## 五阶段流水线

```
team-plan → team-prd → team-exec → team-verify → team-fix(≤3) → complete/failed/cancelled
```

每阶段完成、下一阶段 spawn 之前，**必须** `omd_handoff_write({ stage, sections })` 写交接（五段固定格式）——只活在队长对话里的上下文，压缩/重启后会丢失。

- **team-plan**：拆解目标 → 队员角色选型（`omd-agent-*` 目录）→ `team_task_create` 落任务板（`write_scopes` 标注各任务的文件写入边界，`blocked_by` 标依赖）。
- **team-prd**：需求层面收敛为可验收标准（可写 `.omd/plans/team-<slug>.md`）。
- **team-exec**：`spawn_teammate`（角色卡全文进 prompt，或 `omd_delegate` 硬路由）并行派发；队员结果经 `send_message` 回报或共享任务完成。大改动可先用宿主 `worktrees` 工具建隔离工作树。
- **team-verify**：`omd-agent-verifier`/`qa-tester` 角色独立复核；裁决用 `userQuestions` 问用户（有唯一答案或高代价错误时归人类）。
- **team-fix（≤3）**：verify 不过 → 定向修复重验；3 轮封顶 → failed。

## 协作纪律

- 队员是**叶子执行者**：不编排、不再派发（宿主/插件机械限制已就位）。
- 派发前恰一次静态评估档位（见 `omd_delegate` 工具描述）；表外角色落会话默认档。
- 任务板是唯一权威：认领用 `team_task_update` CAS（携 `expected_revision`）；完成必须附证据。
- 队员回报统一走 `send_message`（progress/blocker/done/question 四类）；队长用 `wait_agent` 收变、`send_message` 处置。
- 终态前：全队员确认或判死（`interrupt_agent`）；`team_task_list` 清板（完成的 complete、废弃的 delete）。
