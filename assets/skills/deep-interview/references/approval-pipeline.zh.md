---
name: approval-pipeline.zh
description: deep-interview 三段式批准门禁流水线的参考细节——仅在接线 ralplan/autopilot 交接或审计门禁语义时加载。
---

### 三段式批准门禁流水线

```
Stage 1: deep-interview   →  Stage 2: ralplan 共识         →  Stage 3: 独立批准
苏格拉底问答 + 评分           Planner → Architect → Critic     用户显式选择执行方式
门禁：清晰度                   门禁：可行性                     门禁：同意——不自动衔接
产出：spec                    产出：共识计划                    产出：pending approval
```

每段把守不同的质量轴。跳过 Stage 3 是设计使然：只有精炼计划、不执行，也是合法结果。

</步骤>

<工具用法>
- 每个访谈问题用 `ask_user_question`——带上下文选项的可点击 UI。
- brownfield 探索用 `omd-agent-explore` + `subagent`——先查再问用户；引用它返回的证据。
- 模糊度评分委派 `omd-agent-analyst`（high 档）子代理——一致性至关重要。
- `mcp__omd-state__state_write` / `state_read` 管访谈状态；每个载荷都带 `threshold` + `threshold_source`。
- 最终 spec 用 `write` 工具写到 `.omd/specs/deep-interview-<slug>.md`，路径严格如此。
- challenge 模式是 prompt 注入，不是单独 spawn 子代理。
- 只有显式执行批准之后才经 `skill` 工具桥接执行模式。
</工具用法>

<升级与停止条件>
- **硬上限 20 轮**；第 10 轮软警告；第 3 轮起允许带警告提前退出（模糊度 > 阈值时）。
- **用户说 "stop"/"cancel"/"abort"**：立即停止，保留状态供恢复。
- **模糊度停滞**（3 轮 ±0.05）：激活 Ontologist 模式重构问题。
- **全部维度 ≥ 0.9**：直接跳到 spec 生成。
- **代码库探索失败**：按 greenfield 继续并注明局限。
</升级与停止条件>

<收尾清单>
- [ ] Phase 0 最先完成；用户可见首行是带来源的阈值标记
- [ ] state 与 spec Metadata 都记录了 `threshold` 与 `threshold_source`
- [ ] 过大初始上下文在评分/提问/spec/交接之前已摘要
- [ ] Round 0 拓扑门先于评分完成；`topology.confirmed_at` 已持久化
- [ ] 每轮展示模糊度；每轮点名最弱 component/dimension
- [ ] 多组件访谈在活跃组件间轮换瞄准
- [ ] challenge 模式在第 4/6/8 轮各触发一次
- [ ] spec 写到 `.omd/specs/deep-interview-<slug>.md`；含 Topology、Goal、Constraints、Acceptance Criteria、Clarity Breakdown、Ontology + Convergence、Transcript
- [ ] 执行桥接经 `ask_user_question` 呈现；显式批准后才经 `skill` 调用目标模式——绝不直接实现
- [ ] 执行交接后清理状态
</收尾清单>

<进阶>
