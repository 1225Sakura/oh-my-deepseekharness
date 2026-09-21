---
name: graph
description: 声明式 DAG 流水线契约——确定性图语义与 journal 崩溃恢复；在 omd 二期运行时落地前由模型驱动执行
when-to-use: 带显式依赖（DAG）的可重复多步流水线、必须能扛中断的工作、可审计的运行。不用于探索性一次性工作（用对话或 team），也不用于运行中需要自适应重规划的场景（图是确定性的）。
---

# graph（编排图）

从一份声明式 JSON descriptor 运行一个确定性编排图。

> **移植状态（先读）。** OMC 原版经独立 OS 进程（`omc graph run`）执行，背后是 `src/graph/*` 的 sealed-descriptor 与 pure-scheduler 契约，崩溃恢复靠 OCC journal 真实生效。**该运行时未移植——列 omd 二期。**本 skill 当前承载的是完整方法论骨架：descriptor 契约、节点/边语义与恢复纪律。omd 中的执行是**模型驱动**的（见下）：下文标注为运行时强制的保证，在这里是约定而非硬保证。

## 用法

```
graph <descriptor.json>
graph "先构建再测试，部署前问我"   （先撰写 descriptor）
```

## 何时使用

- 带显式依赖（DAG）的可重复多步流水线
- 必须扛中断的工作：重跑从 journal 恢复
- 可审计的运行：journal + 快照存于 `.omd/graph-runs/<run_id>/`

不适用：探索性一次性工作（用对话或 team）；运行中需要自适应重规划的工作（图是确定性的）。

## 流程

1. **已给 descriptor** → 跳到步骤 3。
2. **只描述了流水线** → 撰写 descriptor JSON（schema 见下），写到项目旁（建议 `.omd/graphs/<name>.json`），运行前先给用户过目。`run_id` 对每个逻辑流水线必须唯一；用同一 `run_id` 重跑是**恢复**，不是重启。
3. **审批节点**：descriptor 含 `"kind": "human-approval"` 节点时，运行到该点用 `ask_user_question` 工具裁决。（OMC 原版在交互终端上以活 stdin 跑这类节点；dsh 的 `ask_user_question` 是等价门禁。）
4. **模型驱动执行**：按拓扑序、遵守 `concurrency_limit`：
   - `"kind": "command"` → 用 `pwsh` 执行
   - `"kind": "agent"` → 带节点 `instructions` spawn `subagent`；默认保持只读（调研/评审类角色卡），除非 descriptor 显式要求变更
   - `"kind": "human-approval"` → `ask_user_question`；无答复时 fail-closed 视为拒绝
   - 每个节点提交后**追加 journal** `.omd/graph-runs/<run_id>/journal.jsonl`（每条提交 transition 一行 JSON：节点 id、状态、时间戳、输出摘要），并刷新快照 `.omd/graph-runs/<run_id>/descriptor.json` 与各节点结果。
5. **恢复**：中断后用同一 descriptor 重跑会回放 journal 并继续。已完成节点绝不重跑——先读 journal，跳过已提交节点。
6. 边跑边播报进度：`[run]`、`[node]`、`[ok]`、`[fail]`、`[join]`、`[done]`。

### 运行时退出码（OMC 原版契约，omd 二期生效）

记录在此以保持 descriptor 前向兼容：`0` 成功 | `1` 终态失败 | `19` 另一写者持有本 run（忙） | `20` journal 损坏/被篡改（fail-closed） | `21` 恢复时 descriptor 漂移 | `70` 运行时崩溃。模型驱动执行以文字报告同样的状态，不用退出码。

## Descriptor Schema（最小集）

```json
{
  "descriptor_version": 1,
  "run_id": "unique-pipeline-id",
  "revision_id": "rev-1",
  "goal": "one line",
  "nodes": [
    { "id": "n1", "kind": "command", "title": "...", "timeout_ms": 60000,
      "max_attempts": 2, "effect_policy": { "policy": "side_effect_free" },
      "command": "npm test" },
    { "id": "a1", "kind": "agent", "title": "...", "timeout_ms": 300000,
      "max_attempts": 1, "effect_policy": { "policy": "side_effect_free" },
      "instructions": "..." },
    { "id": "gate", "kind": "human-approval", "title": "...",
      "prompt": "Proceed?" }
  ],
  "edges": [ { "id": "e1", "kind": "fixed", "from": "n1", "to": "a1" } ],
  "entry_node_ids": ["n1"],
  "concurrency_limit": 2,
  "terminal_verification_node_id": "a1"
}
```

边种类：`fixed` | `conditional` | `fan_out`/`join` 对 | `back_edge`（经 `max_traversals` 有界重试）。OMC 的权威 Zod schema 在 `src/graph/schema.ts`；omd 尚无 schema 校验器——靠检视校验，descriptor 畸形即快速失败。

## 能力边界与语义（撰写前必读）

- **边支持**：模型驱动执行下，`fixed` 边与 `fan_out`/`join` 对今天可用。`conditional` 与 `back_edge` 路由需要能产生 route 的结果——OMC 内建 executor 从不产生 route，会以 `route_required` 快速失败；在 omd 中，依赖它们的图**在二期运行时落地前视为不支持**，明说而不是猜路由。
- **崩溃恢复保证是 at-least-once**（command 节点）：外部副作用与 journal 追加之间崩溃，恢复时该节点会重跑。`idempotent` 命令的解析键以 `GRAPH_IDEMPOTENCY_KEY` 环境值暴露给命令并记录供下游去重。外部副作用的 exactly-once 不在范围内。
- **命令信任边界**：command 节点是经 `pwsh` 执行的任意 shell 行，在当前工作目录拥有真实进程权限。只运行你撰写或信任的 descriptor。命令不做文件系统/进程沙箱。
- **agent 权限边界**：内建 agent 节点按约定只读——omd 中这是 prompt 层纪律（dsh `subagent` 无工具限制参数），要在节点 `instructions` 里写明并优先用只读角色卡。把 `.omd/graph-runs/<run_id>/descriptor.json` 当作可执行内容对待。

## 状态契约

graph **不持模式状态**：`.omd/graph-runs/<run_id>/` 下的 journal 与快照**就是**状态，用普通文件工具读写。没有 `state_write`/`state_clear` 周期。恢复的含义是：读 journal、跳过已提交节点、继续。含交互审批的图必须在 `ask_user_question` 可用的会话中运行——否则在门禁处 fail-closed。
