---
name: team
description: 仅限显式调用的多代理流水线——队长编排加载角色卡的 subagent 队员，走五阶段流水线，阶段间强制写交接文档
when-to-use: **仅限显式调用**（"用 team 做…"、"/team …"）。无关键词触发——普通文本里的 "team" 一词不得激活本 skill；队员会话内整个关键词路由表失效。用于可拆解任务的并行多代理执行。**v0.4 起有领队运行时**（lib/team.js）：阶段状态机（`team_phase_transition`）、队员 UUID 生命周期（`team_register_worker`/`team_worker_update`/`team_registry`）、mailbox（`team_mail_*`）、heartbeat 扫描（`team_heartbeat_scan`）、merge 计划（`team_merge_plan`）全部经 MCP 工具面可用。实际 spawn 仍由队长经 `subagent`/`omd_delegate` 完成（运行时管生命周期与协调数据面，不替队长做派发决策）；无 tmux pane 守护（dsh 无承载面，🚫）。
---

# team

<Purpose>
主会话（队长）拆解任务、背景 spawn 加载角色卡的 subagent 队员，驱动他们走完五阶段流水线，阶段之间强制写交接文档。本文档是按 dsh 对 OMC team skill 的重写：队员是 `subagent` spawn，协调靠 `send_message` + `list_agents`；这里没有 tmux、没有外部 CLI worker、没有共享 SQLite——OMC 的这些承载面被刻意舍弃。
</Purpose>

<Hard_Constraints>
- **显式调用 only，无关键词触发。**（OMC v5 刻意移除关键词触发：worker 提示词里的 "team" 字样会引发无限繁殖。）队员会话内关键词路由整体失效——worker prompt 是委派任务文本，永远不是模式触发器。
- **MVP 模式互斥**：team active 时不得启动 autopilot/ralph，反之亦然。启动前先读状态。
- **队长编排，队员执行。** 队员永远是叶子（见 Worker 协议）。
</Hard_Constraints>

## 流水线

```
team-plan → team-prd → team-exec → team-verify → team-fix（有界循环）→ complete | failed | cancelled
```

### 阶段角色路由

| 阶段 | 必配角色 | 升级规则 |
|---|---|---|
| team-plan | `omd-agent-explore`（low）+ `omd-agent-planner`（high） | — |
| team-prd | `omd-agent-analyst`（high） | 仅当范围与验收标准已经明确时可跳过——该决定记进 handoff |
| team-exec | `omd-agent-executor`（medium），并行 worker | — |
| team-verify | `omd-agent-verifier`（medium）——**必跑** | **改动 >20 文件或安全敏感变更：加 `omd-agent-code-reviewer`（high）** |
| team-fix | `omd-agent-executor`（medium） | — |

**team-fix 界限**：`max_fix_loops = 3`。循环为 exec → verify → fix → exec …；超过 3 轮 fix 即转 terminal `failed` 并附证据——绝不允许无限循环。**该界限由阶段状态机强制**（`team_phase_transition` 在 fix→exec 超限时显式拒绝，只剩 failed/cancelled 可走）。

### 运行时工具面（v0.4+，lib/team.js 经 MCP 暴露）

| 工具 | 用途 | 调用时机 |
|---|---|---|
| `team_phase_transition({ cwd, runId, to, note? })` | 阶段迁移（状态机校验，非法显式拒绝） | 每次阶段变化必调（与 handoff 同临界点） |
| `team_phase_status({ cwd, runId })` | 读阶段状态（phase/fixLoops/history） | resume 时先读 |
| `team_register_worker({ cwd, runId, worker })` | 登记队员生命周期（workerId 自动生成 `w-<uuid8>`；runId 即 owner-epoch） | **每次 spawn 队员后立即落账**（dispatchId/agentId 一并登记） |
| `team_worker_update({ cwd, runId, workerId, patch })` | 状态迁移（dispatched→running→blocked/done/failed；终态不可复活） | 队员状态变化时 |
| `team_worker_heartbeat({ cwd, runId, workerId })` | 队员心跳（复位 stale） | 队员每次汇报时由队长代打 |
| `team_mail_send / team_mail_read / team_mail_ack` | mailbox：in=队员→队长（progress/blocker/done/question），out=队长→队员（nudge/assign/answer） | 阻塞/提问必落信；队长处置后 ack |
| `team_heartbeat_scan({ cwd, runId })` | stale 检测 + 未 ack blocker/question 汇总（**绝不自动杀**） | 队长每次活跃时必跑（Watchdog 的确定性形态） |
| `team_merge_plan({ cwd, runId })` | 树∩主仓冲突候选 + 建议合并序（只出计划，执行归队长/executor） | team-verify 通过后、拆树合并前 |

数据落点：`.omd/team/<runId>/{phase.json, registry.json, mailbox/{in,out}/<workerId>.jsonl}`——append-only/原子写，崩溃后 resume 先读它们再读 handoff。

### 阶段交接 handoff（强制）

只活在队长对话里的上下文，在压缩或重启后会丢失。因此**每个完成的阶段必须在下一阶段 spawn 之前写 `.omd/handoffs/<stage>.md`**（经 `mcp__omd-state__handoff_write`；MCP 挂了用普通文件工具）：

```markdown
# Handoff: <stage>

## Decided
本阶段定下的关键决策
## Rejected
考虑过但被否决的方案及原因
## Risks
下一阶段必须知道的风险
## Files
关键新建/修改文件
## Remaining
留给下一阶段的事项
```

（与 `handoff_write` 工具的产出格式一致：一级标题 + 五个独立小节；五段必填，单段超 20 行会被截断并警告。）

规则：

1. 上限 10–20 行——只记决策与理由，不抄完整规格（那些放交付物文件里）。
2. **队长在 spawn 下一阶段之前必读全部既往 handoff**，并把内容注入队员的 spawn prompt，保证队员带完整上下文开工。
3. handoff 逐阶段累积（verify 阶段可读 plan + prd + exec 的全部历史），取消后保留供 resume。

## 队长工作流

1. **team-plan**：背景并行 spawn `explore`（代码库/上下文扫描）与 `planner`（任务拆解）——**spawn 后立刻 `team_register_worker` 落账**。拆成文件级边界的任务，相互独立或依赖关系明确，每个任务带 subject + 详细 description + 验证命令。写 handoff，`team_phase_transition` 转下一阶段。
2. **team-prd**：范围模糊时由 `analyst` 提炼验收标准与边界。写 handoff。
3. **team-exec**：用 `subagent` spawn executor 队员（默认即背景——独立队员全部并行 spawn，绝不串行等待），**每个队员 spawn 后立刻 `team_register_worker`**（role/tier/phase/dispatchId 落账）。每个队员 prompt = 角色卡内容 + Worker 协议（逐字注入）+ 其任务分配 + 全部既往 handoff + 其 workerId（汇报信件要用）。分配表记进队长自己的 `todo_write`。
4. **监控**：队员结果以结算通知的形式送达——**yield，不轮询**。每次活跃必跑 `team_heartbeat_scan`（见 Watchdog）；对运行中/空闲的队员用 `send_message` 转向；队员汇报后代打 `team_worker_heartbeat`。
5. **team-verify**：verifier 必跑；按升级规则加 code-reviewer。评审对照验收标准、以新鲜命令证据为准。写 handoff。verify 通过后、拆树合并前跑 `team_merge_plan` 出合并计划。
6. **team-fix**：上限 3 轮（阶段状态机强制）；带着评审发现 spawn 修复 executor；回到 team-exec/team-verify。
7. **终态**：complete | failed | cancelled（`team_phase_transition` 落终态）→ 关闭协议 → 状态契约清理。

## Worker 协议（逐字注入每个队员 prompt）

```
你是队员 "<worker-N>"，向队长汇报。六个步骤：

1. CLAIM —— 任务分配随本 prompt 或队长后续消息到达；
   确认收到，并镜像进自己的 todo_write（in_progress）。
2. WORK —— 用自己的工具直接执行。
3. COMPLETE —— 只有手握验证证据才准把 todo 标 completed。
4. REPORT —— 你的最后一条 assistant 消息就是交付物：
   完整的结构化结果（改动内容、证据、验证命令原始输出）。
   禁止 "done" 式空洞收尾。
5. NEXT —— 队长发了后续任务就回到第 1 步；否则明确报告待命。
6. SHUTDOWN —— 收到队长 shutdown 指令后确认并停止。

阻塞任务：依赖未完成就跳过该任务并向队长报告 blocked——
不许做一半，更不许标 completed。

== LEAF-GUARD（绝对禁令） ==
- 禁止再 spawn 孙代理（禁用 subagent / subagent_fork）。
- 禁用编排工具：workflow、ralph、create_goal / update_goal。
- 禁止激活任何执行模式——你的会话里关键词路由是失效的。
- 你是叶子执行者。违反即任务失败。
```

## Watchdog（heartbeat 扫描驱动版）

v0.4 起有两层心跳（对齐 OMC 墙钟阈值的 dsh 改写，如实注明边界）：

- **插件侧周期检测**（Config `team.heartbeatIntervalMs`，默认 60s，0=关闭）：后台定时扫描 `.omd/team/*/registry.json`，stale 队员与未处置信件写宿主日志呈面——**只检测不催促**（插件无法替模型发言，催促是你的活）。
- **队长侧按需扫描**：你每次活跃时（队员报告送达、阶段转换）必跑 `team_heartbeat_scan({ cwd, runId })`——这是 Watchdog 的确定性形态：
  - `stale` 队员（超 `staleAfterMs` 无心跳，绝不自动杀）→ `send_message` 询问状态；下次活跃仍无回应 → 先用 `interrupt_agent` 停掉卡死队员，`team_worker_update` 标 failed，重分配其任务，必要时补 spawn 替补（替补走 `team_register_worker` 新 workerId）。
  - `outstanding`（未 ack 的 blocker/question）→ 逐条处置后 `team_mail_ack`。
  - 同时用 `list_agents` 盘点：谁在 running / idle / ready，与 registry 对账（registry 是权威生命周期台账）。
- 连续失败 **2+** 任务的队员 → 停止给它分配新工作。
- 等待 = yield 并结束当前轮——队员完成会把你唤醒。禁止忙轮询，禁止 sleep 循环。

## 关闭协议（有序、阻塞）

1. 核实全部任务已到终态（completed 带证据，或 failed 带记录原因）。
2. 经 `send_message` 向每个活跃队员发 shutdown 指令。
3. 等每个队员的确认（以其最后一条消息 / 结算通知形式到达）。
4. 全部确认或判死之后，才准 `mcp__omd-state__state_clear({ cwd, sessionId, mode: "team" })`。
5. 向用户报告总结。

关闭流程未走完之前，绝不清 team 状态。

## 协调纪律

- 默认背景 spawn；绝不为了等一个队员而推迟 spawn 下一个独立队员。
- 用 `send_message` 转向；绝不为了传递指导而重新 spawn 队员。
- 等待时 yield；不写轮询循环。
- 不重复委派已在跑的任务；不把已委派的工作再委派一遍。
- **同质任务扇出 ~5+ → 改用 `workflow` 工具**：写 JS 编排脚本，其 `agent()` 调用接受显式 `provider`/`model`——这是唯一模型路由**硬生效**的委派路径。参数照当前生效路由表填（角色 → 档位 → 模型，来自插件 Config）。注意：普通 `subagent` spawn 继承主会话模型，角色卡上的档位在这条路径只是建议（软路由，如实说明）。

## 恢复 / 取消

- **Resume**：读 team 状态 + 全部 handoff；从最后一个非终态阶段重启；已分配的任务不重复 spawn 队员。
- **取消**（`/omd-cancel` 或用户说停）：尽力走完关闭协议，然后 `state_clear`。handoffs 与 plans 保留。终态：`complete`、`failed`、`cancelled`。

## 降级

`subagent` 不可用 → 队长自己顺序执行各阶段，并公告"单代理模式"；此时模型路由整体失效。`workflow` 不可用 → 无论任务多少都留在背景 `subagent` 扇出。

## 状态契约

**调用形状约定**：`cwd`（当前工作区路径）与 `sessionId`（当前会话 id）是每个 `state_*` 调用的**必填顶层参数**；模式字段嵌套在 `state` 键下。

- **开始**：先调 `mcp__omd-state__team_begin({ cwd, runId, stateDir })` 建工作树（c5）——返回孤儿列表（人工处置）与新 runId + head。再 `state_write({ cwd, sessionId, mode: "team", state: { active: true, started_at: <ISO 8601>, current_phase: "team-plan", prompt_echo: <压缩 ≤1200 字符>, team_name: <slug>, fix_loop_count: 0, max_fix_loops: 3 } })`。状态文件：`.omd/state/sessions/{sessionId}/team-state.json`。若 cwd 在新工作树内，非状态写优先用 `mcp__omd-state__team_write_tree_state`（c8：父仓 .omd 不外溢）。
- **阶段转换**：每次阶段变化都做三件事：①`team_phase_transition({ cwd, runId, to, note })`——阶段状态机是权威（fix 循环上限由它强制）；②`state_write` 更新 `state.current_phase`（`team-plan|team-prd|team-exec|team-verify|team-fix|complete|failed|cancelled`）与阶段历史；③`team_write_mirror({ cwd, stateDir, patch: { mode: 'team', round, current_story, active_agents, todo }, expectUpdatedAt })`——c6 把七字段镜像快照写进 `.omd/state/run-state.json`（CAS 冲突重读 ≤3 次，每次写 version +1；active_agents 与 registry 对账）。
- **完成/取消**：先关闭流程（通知全部队员、等待确认），再 `mcp__omd-state__team_dispose({ cwd, runId, reason: 'verified' | 'cancelled', expectUpdatedAt })`（c5 两阶段拆除：CAS 写 disposed 终态 → 删树），最后 `state_clear({ cwd, sessionId, mode: "team" })`。`.omd/handoffs/` 与 `.omd/plans/` 永不删除。
- **异常退出**：状态与 handoffs 留在盘上供 resume；>2h 未更新的状态视为 stale——只报告不自动续。
- **MCP server 挂了**：用普通文件工具对 `.omd/` 做同样的读写，并显式说明。
