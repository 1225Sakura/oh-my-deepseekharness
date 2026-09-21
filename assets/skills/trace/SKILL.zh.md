---
name: trace
description: 证据驱动的追踪通道——把相互竞争的 tracer 假设编排为并行子代理
when-to-use: 模糊的、因果性的、证据密集的"为什么会这样"问题——运行时 bug/回归、性能行为、事后复盘、配置/编排谜团——适合先并行探索多种竞争解释、再谈修复的场景。
---

# trace（因果追踪）

当问题是模糊的、因果性的、证据密集的，目标是解释观察到的结果**为什么**发生、而不是直接跳进修复或重写时，使用本技能。

这是 `omd-agent-tracer` 角色之上的编排层。目标是把追踪变成 omd 可复用的工作通道：重述观察、生成竞争解释、并行取证、给解释排序、提出能最快坍缩不确定性的下一个探针。

## 适用入口

当问题具有以下特征时使用 `trace`：

- 模糊
- 因果性
- 证据密集
- 最适合并行探索多种竞争解释

示例：
- 运行时 bug 与回归
- 性能 / 延迟 / 资源行为
- 架构 / premortem / postmortem 分析
- 科学或实验结果追踪
- 配置 / 路由 / 编排行为解释
- "给定这个输出，回溯最可能的原因"

## 核心追踪契约

始终保住以下区分：

1. **Observation**——实际观察到了什么
2. **Hypotheses**——相互竞争的解释
3. **Evidence For**——支持各解释的证据
4. **Evidence Against / Gaps**——反驳它的或仍缺失的
5. **Current Best Explanation**——当前领先的解释
6. **Critical Unknown**——把头部解释彼此隔开的那条缺失事实
7. **Discriminating Probe**——能最快坍缩不确定性的最高价值下一步

**不要**退化成：
- 泛泛的修 bug 循环
- 泛泛的 debugger 摘要
- worker 输出的原始倾倒
- 证据不全时的假确定

## 证据强度层级

证据要分级，不平视。

从强到弱：

1. **受控复现 / 直接实验 / 唯一区分性 artifact**
2. **来源清晰的一手 artifact**（trace 事件、日志、指标、benchmark 输出、配置、git 历史、file:line 行为）
3. **多个独立来源收敛到同一解释**
4. **单一来源的代码路径或行为推断**
5. **弱的旁证**（时序、命名、栈顺序、与既往 bug 的相似性）
6. **直觉 / 类比 / 推测**

当存在更强的矛盾证据时，显式下调主要依赖低层级证据的假设。

## 强证伪 / 反证规则

每次认真的 `trace` 都必须尝试证伪自己最喜欢的解释。

对每个头部假设：

- 收集**支持**它的证据
- 收集**反对**它的证据
- 陈述它做出的独特预测
- 陈述什么观察会与它难以调和
- 找出能把它与次优替代区分开的最便宜探针

出现以下情况时下调假设：

- 直接证据与之矛盾
- 只能靠新增未验证假设存活
- 与竞争对手相比没有独特预测
- 更强的替代能用更少假设解释同样的事实
- 其支撑多为旁证而对手有更强证据层级

## 编排形态（dsh）

OMC 原版用 Claude 内建 team 模式。**omd 在这条通道没有 team 原语——由 lead（主会话）把各 lane spawn 为并行 `subagent`。** lead 应当：

1. 精确重述观察到的结果或"为什么"问题
2. 抽出追踪目标
3. 生成多个刻意不同的候选假设
4. 默认 spawn **3 条 tracer lane**，以后台 `subagent` 形式，各带 `omd-agent-tracer` 角色卡
5. 每条 lane 指派一个 tracer worker
6. 指示每个 tracer worker 同时收集**支持**与**反对**其 lane 的证据
7. 在领先假设与最强替代之间跑一轮**反驳（rebuttal）**
8. 检测头部 lane 是真的不同，还是收敛到同一根因
9. 合并为带显式 critical unknown 与 discriminating probe 的分级综合

重要：worker 应追求刻意不同的解释，而不是并行验证同一个解释。

## v1 默认假设 lane

除非 prompt 强烈提示更好的切分，使用这 3 条默认 lane：

1. **代码路径 / 实现原因**
2. **配置 / 环境 / 编排原因**
3. **测量 / artifact / 假设错配原因**——覆盖验证方法缺陷，不只是系统缺陷。例如：验证查询把同一个维度键套用到了不同实体、租户、流或分组上；对比过滤的形状与 schema 粒度不匹配；目录或列名未经枚举就假定跨运行时通用。包括多实体前提/键假设错配。

lane 3 的跨实体差异需要先做过前提审计再升级：枚举实体维度，检查零行或 mismatch 结果是否来自"一个键套多个实体"而非系统缺陷——结果可能是验证方法论缺陷。

默认 lane 刻意宽泛，让第一刀在 bug、性能、架构与实验追踪上都下得去。

## 强制交叉检查透镜

首轮取证后，在相关时用以下透镜压测领先假设：

- **Systems 透镜**——队列、重试、背压、反馈环、上下游依赖、边界失败、协调效应
- **Premortem 透镜**——假设当前最佳解释不完整或错误：什么失败模式会让这次追踪日后难堪？
- **Science 透镜**——控制组、混杂因子、测量偏差、替代变量、可证伪预测

这些透镜不是凑数。当它们能翻出遗漏解释、隐藏依赖或弱推断时才用。

## Worker 契约

每个 worker 是 **`omd-agent-tracer` lane 负责人**，不是通用 executor。

每个 worker 必须：

- 只拥有一条假设 lane
- 显式重述本 lane 假设
- 收集**支持**本 lane 的证据
- 收集**反对**本 lane 的证据
- 给己方证据的强度分级
- 指出缺失证据、落空的预测与残余不确定性
- 点名本 lane 的 **critical unknown**
- 推荐本 lane 最佳的 **discriminating probe**
- 未被明确要求时不退化成实现

有用的证据来源：

- 相关代码、测试、配置、文档、日志、输出与 benchmark artifact（`grep` / `read` / `glob`）
- 用 `pwsh` 做聚焦复现与一次性探针
- `git log` / `git_diff` 做改动关联
- 编排行为存疑时查 `.omd/` 模式状态与 handoff 文件

> OMC 专用的 trace MCP 工具（`trace_timeline`、`trace_summary`）**在 omd 二期**；以上来源是 dsh 现实等价物。

推荐的 worker 返回结构：

1. **Lane**
2. **Hypothesis**
3. **Evidence For**
4. **Evidence Against / Gaps**
5. **Evidence Strength**
6. **Critical Unknown**
7. **Best Discriminating Probe**
8. **Confidence**

## Lead 综合契约

最终的 `trace` 答复要做综合，不是拼接。

返回：

1. **Observed Result**
2. **Ranked Hypotheses**
3. **Evidence Summary by Hypothesis**
4. **Evidence Against / Missing Evidence**
5. **Rebuttal Round**
6. **Convergence / Separation Notes**
7. **Most Likely Explanation**
8. **Critical Unknown**
9. **Recommended Discriminating Probe**
10. **Additional Trace Lanes**（可选，仅当不确定性仍高）

即便某一解释当前占优，也保留分级候选清单。

## 反驳轮与收敛检测

收尾之前：

- 让最强的非领先 lane 对当前领先者提出最有力的反驳
- 强制领先者用证据而非断言回应反驳
- 反驳实质削弱领先者时，重排表格
- 两个"不同"假设若归结为同一底层机制，合并并明说
- 两个假设若仍隐含不同的下一探针，即使听起来相似也保持分开

不要仅因多个 worker 措辞相近就宣称收敛。收敛要求以下之一：

- 同一根因机制，或
- 独立证据流指向同一解释

## 显式下调指引

lead 应显式说明某假设为何被下调：

- 被更强证据反驳
- 缺少它预测会出现的观察
- 需要额外临时假设
- 比领先者解释的事实更少
- 输了反驳轮
- 收敛进了更强的父解释

这很重要：`trace` 应让读者明白一个解释**为什么**排在另一个前面，而不是只甩出一张终表。

## 建议的 lead prompt 骨架

按此思路组织编排 prompt：

1. "精确重述观察。"
2. "生成 3 个刻意不同的假设。"
3. "每个假设 spawn 一个 `omd-agent-tracer` 子代理，后台并行。"
4. "每条 lane：取证支持与反对、给证据强度分级、点名 critical unknown 与最佳 discriminating probe。"
5. "有用就对领先者套 systems / premortem / science 透镜。"
6. "在前两名解释之间跑反驳轮。"
7. "返回分级解释表、收敛说明、critical unknown、单一最佳 discriminating probe。"

## 输出质量线

好的 `trace` 输出是：

- 有证据支撑
- 简洁但严谨
- 对过早确定保持怀疑
- 显式指出缺失证据
- 对下一步行动务实
- 显式说明较弱解释为何被下调

## 最终综合形态示例

### Observed Result
[发生了什么]

### Ranked Hypotheses
| Rank | Hypothesis | Confidence | Evidence Strength | Why it leads |
|------|------------|------------|-------------------|--------------|
| 1 | ... | High / Medium / Low | Strong / Moderate / Weak | ... |

### Evidence Summary by Hypothesis
- Hypothesis 1: ...
- Hypothesis 2: ...
- Hypothesis 3: ...

### Evidence Against / Missing Evidence
- Hypothesis 1: ...
- Hypothesis 2: ...
- Hypothesis 3: ...

### Rebuttal Round
- 对领先者的最佳反驳：...
- 领先者守住/失守的原因：...

### Convergence / Separation Notes
- ...

### Most Likely Explanation
[当前最佳解释]

### Critical Unknown
[让不确定性悬而未决的那一条缺失事实]

### Recommended Discriminating Probe
[单一的下一探针]

### Additional Trace Lanes
[仅当不确定性仍高]

## 状态契约

trace **不持模式状态**：它是当前会话内的有界编排通道，不在 `.omd/state/` 下写任何内容。分级综合就是交付物；若某个持久事实或未解的 critical unknown 值得保留，写 `mcp__omd-state__notepad_write_working` / `notepad_write_priority`。
