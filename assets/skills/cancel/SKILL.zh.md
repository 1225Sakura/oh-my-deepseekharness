---
name: cancel
description: 取消任何活跃的 omd 执行模式（autopilot、ralph、team、ralplan、deep-interview）并清理模式状态
when-to-use: 由 `cancelomd` / `stopomd` 关键词或 `/omd-cancel` 命令触发；也用于模式活跃时用户说停、或模式完成后需要正规清理状态。刻意不匹配裸 "cancel"/"stop"，防日常用语误触发。
---

# cancel（取消）

智能取消：自动检测并取消活跃的 omd 模式。cancel 在关键词路由表中地位特殊：只匹配 `cancelomd` / `stopomd` 或 `/omd-cancel`，任何模式下都可独占触发，且不可被禁用。

## 它做什么

自动检测活跃模式并按依赖顺序取消：

1. **team**（先优雅关闭——队员必须先释放，再清状态）
2. **autopilot**（goal 暂停——进度保留供恢复）
3. **ralph**（循环停止）
4. **ralplan**（共识规划会话）
5. **deep-interview**（访谈会话）

## 用法

```
/omd-cancel            # 或说：cancelomd / stopomd
/omd-cancel --force    # 清除所有会话的模式状态（工作区整体重置）
```

## 实现步骤

### 1. 解析参数

`--force` / `--all` → force 模式（清理所有会话的 state，不只当前会话）。

### 2. 检测活跃模式

- 调 `mcp__omd-state__state_list_active` 枚举 `.omd/state/sessions/{sessionId}/…`，找出所有有活跃模式的会话。
- 对每个会话（默认模式只查当前会话）调 `mcp__omd-state__state_get_status`，弄清哪个模式活跃、处于什么阶段。
- state 文件是唯一事实源——绝不凭对话感觉判断"某模式在跑"。

### 3. 按模式取消

#### team 活跃

走 team 关闭协议（规格 §3.4）：

1. `state_read({ cwd, sessionId, mode: "team" })` 读活跃队员名册。
2. 用 `send_message` 给每个队员发 shutdown 指令；idle/ready 队员收到消息即唤醒。
3. 等确认。dsh 是消息驱动（无定时器面），确认是事件驱动的：在下一个模型步骤处理到达的回复，不轮询。
4. `list_agents` 确认无队员仍在运行；无视 shutdown 的队员用 `interrupt_agent` 打断。
5. 全部队员确认停止或被 interrupt 之后才 `state_clear({ cwd, sessionId, mode: "team" })`。
6. 无响应队员记入取消报告。

#### autopilot 活跃

1. `update_goal(action="pause")`——暂停 goal 循环；plans/specs 留盘供恢复（OMC resume 语义）。
2. `state_clear({ cwd, sessionId, mode: "autopilot" })`。
3. 报告："Autopilot 已取消于阶段：{phase}。进度已保留——再次运行 autopilot 即从保留的 plans 继续。"

#### ralph 活跃

1. `state_clear({ cwd, sessionId, mode: "ralph" })`。ralph 工具的前台循环随当前轮结束；`maxRounds` 与 PRD 保持完好。
2. `.omd/prd/` 产物（prd.json、reconciliation.jsonl、progress.txt）保留——之后 ralph 经 stale 检查后可从它们恢复。

#### ralplan 活跃

`state_clear({ cwd, sessionId, mode: "ralplan" })`。`.omd/plans/ralplan-<slug>.md` 下的共识计划保留。

#### deep-interview 活跃

`state_clear({ cwd, sessionId, mode: "deep-interview" })`。`.omd/specs/` 下已结晶的 spec 保留；若尚未结晶 spec，state 里的访谈 transcript 随之丢弃——在报告中注明。

#### 无活跃模式

报告："未检测到活跃的 omd 模式。要清理所有会话状态请用 `--force`。"

### 4. 永远保留

无论哪个模式、哪个参数，以下**绝不删除**：

- `.omd/plans/`（autopilot 规格、ralplan 共识计划）
- `.omd/specs/`（deep-interview 产出）
- `.omd/prd/`（ralph PRD、reconciliation 日志、progress.txt）
- `.omd/handoffs/`（team 阶段交接）
- `.omd/checkpoints/`（压缩恢复快照）
- `.omd/notepad.md`

cancel 只清**模式状态**——恢复依赖的就是这些保留产物。

### 5. 报告

输出结构化取消报告：

```
已取消：
- {mode}：{做了什么——goal 已暂停 / 队员 M/N 已关闭 / state 已清理}
已保留：
- {仍可用于恢复的产物路径}
警告：
- {无响应队员、清理失败项、stale 状态提示}
```

## 消息参考

| 模式 | 成功消息 |
|---|---|
| team | "Team 已取消。{M}/{N} 队员确认关闭；状态已清理。" |
| autopilot | "Autopilot 已取消于阶段：{phase}。进度已保留供恢复。" |
| ralph | "Ralph 已取消。PRD 与进度保留在 .omd/prd/。" |
| ralplan | "Ralplan 已取消。共识计划保留在 .omd/plans/。" |
| deep-interview | "Deep interview 已取消。{spec 已保留 | 尚未写出 spec，transcript 已丢弃}。" |
| force | "全部 omd 模式状态已清理。plans、prd、handoffs、checkpoints 已保留。" |
| 无 | "未检测到活跃的 omd 模式。" |

## 降级

MCP server 不可用时，用普通文件工具对 `.omd/state/sessions/{sessionId}/*-state.json` 做同样的检测与清理，并显式说明。autopilot 的 goal 存在但 `update_goal` 不可用时：清掉 state 文件，并告知用户 goal 可能仍在 armed 状态——可由用户侧暂停。

## 状态契约

**调用形状约定**：`cwd`（当前工作区路径）与 `sessionId`（当前会话 id）是每个 `state_*` 调用的**必填顶层参数**；`state_list_active`/`state_get_status` 只传 `{ cwd }`。

cancel 是每个模式状态契约的清理终点：读状态（`state_list_active({ cwd })` / `state_get_status({ cwd })` / `state_read({ cwd, sessionId, mode })`）→ 执行模式特定的优雅停止（autopilot 暂停 goal、team 走关闭协议）→ 对受影响模式 `state_clear`。cancel 自身不写入新的模式状态。`.omd/` 下产物目录在所有路径中保留。
