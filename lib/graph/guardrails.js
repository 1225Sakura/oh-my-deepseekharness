// lib/graph/guardrails.js
// U4 S5（计划 .omd/plans/ralplan-u4-graph-runtime.md §5 Q7、§7 步骤 5）：
// agent 节点护栏前缀——effect_policy=side_effect_free 的 agent 节点，
// instructions 在运行入口封印前由运行时强制拼只读/leaf-guard 契约前缀
// （非模型自由裁量）。注入点在入口封印之前（MCP graph_run/graph_validate 与
// bin/graph-runner.mjs 共用本模块），保证双入口对同一 draft 封印出同一
// descriptor_hash——跨入口恢复不因前缀漂移（21）。
//
// 幂等：已带前缀的 instructions 不重复拼接（同 draft 重入 / descriptor.json
// 快照回流再封印，hash 稳定）。本模块不做 schema 校验——畸形输入原样透传，
// 由 sealGraphDescriptor 的 strict 校验 fail-closed。

/** 只读/leaf-guard 契约前缀（运行时生成的常量文本）。 */
export const AGENT_GUARDRAIL_PREFIX = (
  '[graph 只读契约|read-only contract] 本节点 effect_policy=side_effect_free：' +
  '只读执行，仅调研/分析/评审；禁止写文件、改仓库状态、git 提交、安装依赖、' +
  '对外发送或任何其他副作用。' +
  '[leaf-guard] 你是叶子代理，禁止再派生 subagent/子代理。' +
  '完成后只返回文本报告。'
)

function isGuardrailedAgentNode(node) {
  return (
    node !== null &&
    typeof node === 'object' &&
    node.kind === 'agent' &&
    node.effect_policy?.policy === 'side_effect_free' &&
    typeof node.instructions === 'string'
  )
}

/**
 * 返回应用护栏前缀后的 draft（浅拷贝，不改输入；无 agent 节点需拼前缀时
 * 原样返回同一引用）。仅处理 kind=agent 且 effect_policy=side_effect_free
 * 且 instructions 为字符串的节点；其余节点原样透传（idempotent policy 的
 * agent 节点与畸形节点均不动）。
 */
export function applyAgentGuardrails(draft) {
  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) {
    return draft
  }
  if (!Array.isArray(draft.nodes)) return draft
  let changed = false
  const nodes = draft.nodes.map((node) => {
    if (!isGuardrailedAgentNode(node)) return node
    if (node.instructions.startsWith(AGENT_GUARDRAIL_PREFIX)) return node
    changed = true
    return {
      ...node,
      instructions: AGENT_GUARDRAIL_PREFIX + '\n\n' + node.instructions,
    }
  })
  return changed ? { ...draft, nodes } : draft
}
