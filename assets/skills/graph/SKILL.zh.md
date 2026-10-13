---
name: graph
description: 声明式 DAG 流水线契约——确定性图语义与 journal 崩溃恢复；在 omd 二期运行时落地前由模型驱动执行
when-to-use: 带显式依赖（DAG）的可重复多步流水线、必须能扛中断的工作、可审计的运行。不用于探索性一次性工作（用对话或 team），也不用于运行中需要自适应重规划的场景（图是确定性的）。
---

# graph（编排图）

从一份声明式 JSON descriptor 运行一个确定性编排图。

> **移植状态（先读）。** OMC 原版经独立 OS 进程（`omc graph run`）执行，背后是 `src/graph/*` 的 sealed-descriptor 与 pure-scheduler 契约，崩溃恢复靠 OCC journal 真实生效。**omd 一期运行时已落地（U4）**：确定性核心在 `lib/graph/`（schema/descriptor/journal/scheduler/fence/runner），MCP 六工具面与后台脚本双入口共用（见下「运行时工具面」）。模型驱动执行仍是合法旁路——journal 契约不变，今天模型写的 journal 就是明天的恢复输入。

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

### 运行时退出码（omd 一期运行时已生效）

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

边种类：`fixed` | `fan_out`/`join` 对今天可运行；`conditional` 与 `back_edge` 在入口即被 `UNSUPPORTED_EDGE` fail-fast 拒绝（不支持，明说不猜）。权威 Zod schema 移植为 `lib/graph/schema.js`——`graph_validate` 入口做 strict 校验，descriptor 畸形即快速失败。

## 能力边界与语义（撰写前必读）

- **边支持**：`fixed` 边与 `fan_out`/`join` 对可运行。`conditional` 与 `back_edge` 路由在一期运行时**不支持**：入口（graph_validate/graph_run）以 `UNSUPPORTED_EDGE` fail-fast（exit 1，显式列出违例边），明说而不是猜路由。
- **崩溃恢复保证是 at-least-once**（command 节点）：外部副作用与 journal 追加之间崩溃，恢复时该节点会重跑。`idempotent` 命令的解析键以 `GRAPH_IDEMPOTENCY_KEY` 环境值暴露给命令并记录供下游去重。外部副作用的 exactly-once 不在范围内。
- **命令信任边界**：command 节点是经 `pwsh` 执行的任意 shell 行，在当前工作目录拥有真实进程权限。只运行你撰写或信任的 descriptor。命令不做文件系统/进程沙箱。
- **agent 权限边界**：内建 agent 节点按约定只读——omd 中这是 prompt 层纪律（dsh `subagent` 无工具限制参数），要在节点 `instructions` 里写明并优先用只读角色卡。把 `.omd/graph-runs/<run_id>/descriptor.json` 当作可执行内容对待。

## Journal 格式约定（二期运行时的锚点，模型驱动执行今天也照此写）

`.omd/graph-runs/<run_id>/journal.jsonl` 是 append-only JSONL——每行一个事件，**只追加、不改写、不重排**。恢复语义完全由它导出（读 journal、跳过已 committed 节点、继续），所以模型驱动执行也必须严格按此格式写：

```jsonl
{"seq":1,"ts":"<ISO-8601>","type":"run_started","run_id":"...","graph_id":"...","descriptor_hash":"<sha256>"}
{"seq":2,"ts":"...","type":"node_scheduled","node_id":"a1","attempt":1}
{"seq":3,"ts":"...","type":"node_committed","node_id":"a1","attempt":1,"exit_code":0,"output_ref":"outputs/a1.md"}
{"seq":4,"ts":"...","type":"node_failed","node_id":"a2","attempt":1,"error":"...","retryable":true}
{"seq":5,"ts":"...","type":"gate_waiting","node_id":"gate","prompt":"Proceed?"}
{"seq":6,"ts":"...","type":"gate_resolved","node_id":"gate","decision":"approved"}
{"seq":7,"ts":"...","type":"run_finished","terminal_status":"completed|failed|cancelled"}
```

规则：
- `seq` 严格递增（恢复时以最大 seq 续号）；`node_committed` 是节点完成的唯一判据——有 `node_scheduled` 无 `node_committed` 的节点恢复时重跑（at-least-once）。
- 大输出不落 journal：`output_ref` 指向 `.omd/graph-runs/<run_id>/outputs/` 下的文件。
- `descriptor.json` 快照与 journal 同目录；`descriptor_hash` 不一致即拒绝恢复（防 descriptor 中途被改）。
- 二期确定性运行时落地时消费同一格式——今天模型写的 journal 就是明天的恢复输入。

## 运行时工具面（U4 一期已落地）

确定性运行时核心在 `lib/graph/`（schema 校验 / descriptor 封印 / 扁平 OCC journal / 纯函数 scheduler / owner fence / runner 推进循环），**双入口共用**：MCP 六工具（`omd-state` server）与后台脚本 `node bin/graph-runner.mjs --descriptor <draft.json> --runs-root <dir> [--takeover] [--stale-grace-ms <ms>] [--cwd <dir>]`（进程退出码 = exit_code，stdout 末行 `GRAPH_RUN_RESULT <json>`）。

- **graph_validate** `{cwd, descriptor}`：写 descriptor 先自检——strict schema + 结构校验 + `UNSUPPORTED_EDGE` fail-fast；返回将封印的 `descriptor_hash`。
- **graph_run** `{cwd, descriptor, takeover?, stale_grace_ms?}`：封印并**同步推进至首个等待点**（gate_waiting / agent_pending / 终态）再返回；恒返回 `{exit_code, terminal_status, status, waiting, projection, ...}`。同 `run_id` 重入：fence 存活 → `19`；owner 死且 stale 过期 → `takeover:true` 显式接管。
- **graph_status** `{cwd, run_id}`：`projectGraph` 投影（ready/waiting/blocked/done/failed/max_seq）+ fence 观测（`stalled`）。
- **graph_resume** `{cwd, run_id, takeover?, stale_grace_ms?}`：唯一续驱动口——从 run 目录 `descriptor.json` 快照重水化并推进；`takeover:true` 是 stalled run 的显式接管（成功写 `fence_acquired`）。
- **graph_node_result** `{cwd, run_id, node_id, attempt, exit_code, output_ref?, output?}`：agent 节点唯一提交口；必须匹配最新 `agent_pending`（attempt 一致且尚无 committed），同 payload 重复提交幂等返回、异 payload 拒绝。
- **graph_gate_resolve** `{cwd, run_id, node_id, decision: approved|denied, output_summary?}`：human-approval 唯一裁决口；必须匹配该 gate 最新 `gate_waiting`（错位/已裁决/终态 run 拒绝）；`denied` 是一等结局（run 以 gate_denied 终结）。

### journal 词汇表登记（上文冻结 7 type 之外的新增，运行时与模型手写同遵）

```jsonl
{"seq":N,"ts":"<ISO-8601>","type":"agent_pending","node_id":"a1","attempt":1}
{"seq":N,"ts":"...","type":"fence_acquired","epoch":2,"owner_pid":12345}
```

- `agent_pending`：agent 节点等待模型闭环（`{node_id, attempt}`，watchdog 超 `timeout_ms` 标 `node_failed{retryable}`）；提交走 `graph_node_result` → `node_committed`。
- `fence_acquired`：恢复/接管获取 fence 的审计行（`{epoch, owner_pid}`；fresh run 首启不写）。fence 元数据本体不进 journal。

### fence 旁文件布局（run 目录内，均不进 journal）

- `owner.lock`：O_CREAT|O_EXCL 创建并持有 fd，payload `{pid, epoch, started_at}`——占用互斥与持有身份判据。
- `owner.epoch`：单调递增整数 sidecar（接管只升不降，release 后续号不回退）。
- `owner.json`：`{pid, started_at, lease_ts}` 心跳。**stalled = lease 距今 > 30s（默认）且 owner pid 不存活**，双条件缺一不可；接管（takeover）只在 stalled 时放行。

### agent 护栏（运行时生成，非模型自由裁量）

`effect_policy=side_effect_free` 的 agent 节点，入口封印前由运行时给 `instructions` **强制拼只读/leaf-guard 契约前缀**（幂等：已带前缀不重复拼；MCP 与 bin 双入口同前缀 → 同 `descriptor_hash`，跨入口恢复不因前缀漂移）。例外：sealed 输入（带 `descriptor_hash` 的 descriptor）以封印态原样采用、永不重算——运行时前缀对其不适用。

### 授权面诚实声明（prompt 层约定，非安全边界）

`graph_gate_resolve` 与 `graph_node_result` **信任 MCP 调用者**，无用户在场证明——gate 是工作流构造而非安全边界（模型本就持 pwsh，绕过成本为零）。缓解：裁决/提交必须匹配最新 pending（错位 fail-closed 拒绝）。graph_run/resume 同步推进的单次调用时长无上限；客户端超时/断连不影响 run 推进，以 graph_status 轮询。

## 状态契约

graph **不持模式状态**：`.omd/graph-runs/<run_id>/` 下的 journal 与快照**就是**状态，用普通文件工具读写。没有 `state_write`/`state_clear` 周期。恢复的含义是：读 journal、跳过已提交节点、继续。含交互审批的图必须在 `ask_user_question` 可用的会话中运行——否则在门禁处 fail-closed。
