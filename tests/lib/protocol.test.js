// tests/lib/protocol.test.js
import { test, expect } from 'vitest'
import { KEYWORD_REGISTRY, RETIRED_KEYWORDS } from '../../lib/keywords.js'
import { renderProtocol } from '../../lib/protocol.js'
import { Config } from '../../lib/config.js'

test('注册表覆盖模式与 M2 关键词且 cancel 优先级最高、只匹配专有词', () => {
  expect(KEYWORD_REGISTRY[0].target).toBe('cancel')
  expect(KEYWORD_REGISTRY[0].triggers).toEqual(['cancelomd', 'stopomd'])
  for (const e of KEYWORD_REGISTRY) expect(e.target).toMatch(/^(cancel|ralph|autopilot|ralplan|deep-interview|review|ai-slop-cleaner|wiki)$/)
})

test('退役词表包含 ultrawork 系列', () => {
  for (const w of ['ultrawork', 'ulw', 'uw', 'ccg']) expect(RETIRED_KEYWORDS).toContain(w)
})

test('team 不在注册表中（显式调用 only，规格 §3.0-4）', () => {
  expect(KEYWORD_REGISTRY.some(e => e.target === 'team')).toBe(false)
})

test('renderProtocol 输出包含路由表、文本守卫、能力矩阵、委派规则、状态契约', () => {
  const config = Config.parse({})
  const probe = { core: { status: 'ok' }, storage: { status: 'unavailable' } }
  const roles = [{ name: 'omd-agent-explore', tier: 'low' }, { name: 'omd-agent-planner', tier: 'high' }]
  const text = renderProtocol({ config, probeReport: probe, roles })
  for (const s of ['cancelomd', 'ralph', '什么是', '能力矩阵', 'unavailable', 'omd-agent-explore', 'glm-5.3-flash', 'inherit', 'leaf-guard', 'state_write', '互斥'])
    expect(text).toContain(s)
})

test('S8-C1/C2：协议路由表注记 omd_delegate 硬路由语义（档位钳制+不可用 id 显式报错）', () => {
  const text = renderProtocol({ config: Config.parse({}), probeReport: {}, roles: [] })
  expect(text).toContain('omd_delegate')
  expect(text).toContain('不静默继承')
})

test('renderProtocol 是同步函数且输出有界（<8000 字符）', () => {
  const text = renderProtocol({ config: Config.parse({}), probeReport: {}, roles: [] })
  expect(typeof text).toBe('string')
  expect(text.length).toBeLessThan(8000)
})

test('终审修复 #1：状态契约的 MCP 伪调用是真实 schema 形状（cwd/sessionId 顶层必填、状态嵌套 state 键）', () => {
  const text = renderProtocol({ config: Config.parse({}), probeReport: {}, roles: [] })
  expect(text).toContain('cwd')
  expect(text).toContain('sessionId')
  expect(text).toContain('state: {')
  // 错误旧形状不得残留
  expect(text).not.toContain('{mode}-state.json')
})

test('终审修复 #2：MCP 工具引用统一带 mcp__omd-state__ 前缀', () => {
  const text = renderProtocol({ config: Config.parse({}), probeReport: {}, roles: [] })
  expect(text).toContain('mcp__omd-state__state_write')
  expect(text).toContain('mcp__omd-state__notepad_write_priority')
  // 不带前缀的裸引用不得出现在工具调用语境
  expect(text).not.toMatch(/(?<!__)notepad_write_working/)
})

test('终审修复 #3：协议段渲染 deep-interview 当前生效配置（模型无法读插件 Config）', () => {
  const text = renderProtocol({ config: Config.parse({}), probeReport: {}, roles: [] })
  expect(text).toContain('0.2')
  expect(text).toContain('10')
  expect(text).toContain('20')
  expect(text).toMatch(/deep-interview|deepInterview/)
  const custom = renderProtocol({ config: Config.parse({ deepInterview: { ambiguityThreshold: 0.7 } }), probeReport: {}, roles: [] })
  expect(custom).toContain('0.7')
})

test('终审修复 #4：状态契约含 get_goal 前置指引', () => {
  const text = renderProtocol({ config: Config.parse({}), probeReport: {}, roles: [] })
  expect(text).toMatch(/update_goal.*get_goal|get_goal.*update_goal/s)
})

test('终审修复 #5：能力矩阵附固定说明（宿主工具可用性以实际调用为准）', () => {
  const text = renderProtocol({ config: Config.parse({}), probeReport: {}, roles: [] })
  expect(text).toMatch(/goal\/ralph\/subagent\/workflow/)
  expect(text).toContain('以实际调用结果为准')
})

test('终审修复 #6：mcpServer 状态 ok 渲染为 mounted（挂载成功≠server 真起来）', () => {
  const text = renderProtocol({
    config: Config.parse({}),
    probeReport: { mcpServer: { status: 'ok' } },
    roles: [],
  })
  expect(text).toContain('| mcpServer | mounted |')
  expect(text).not.toContain('| mcpServer | ok |')
})

test('c3 自适应路由段：4 特征+表钳制+1:1 日志+fallback 语义入协议（会话默认档跟随 Config）', () => {
  const text = renderProtocol({ config: Config.parse({}), probeReport: {}, roles: [] })
  expect(text).toContain('c3 自适应路由')
  expect(text).toContain('taskType=routine/standard/critical')
  expect(text).toContain('表上限权威')
  expect(text).toContain('禁止运行中重路由')
  expect(text).toContain('[routing] dispatch=<id>')
  expect(text).toContain('fallback:true')
  expect(text).toContain('会话默认档 medium')
  const custom = renderProtocol({ config: Config.parse({ routing: { defaultTier: 'low' } }), probeReport: {}, roles: [] })
  expect(custom).toContain('会话默认档 low')
})

test('c6 run-state 镜像契约段：七字段+队长独占写+双时机+CAS 冲突语义入协议（路径跟随 stateDir）', () => {
  const text = renderProtocol({ config: Config.parse({}), probeReport: {}, roles: [] })
  expect(text).toContain('c6 run-state 镜像契约')
  expect(text).toContain('mode/round/current_story/active_agents/todo')
  expect(text).toContain('队长独占写')
  expect(text).toContain('expectUpdatedAt')
  expect(text).toContain('重试 ≤3 次')
  expect(text).toContain('覆盖写')
  expect(text).toContain('warning 日志行')
  expect(text).toContain('.omd/state/run-state.json')
  const custom = renderProtocol({ config: Config.parse({ stateDir: '.custom' }), probeReport: {}, roles: [] })
  expect(custom).toContain('.custom/state/run-state.json')
})

test('c5 worktree 隔离段：每运行一树+两阶段拆除+取消列差异+孤儿绝不自动删入协议（路径跟随 stateDir）', () => {
  const text = renderProtocol({ config: Config.parse({}), probeReport: {}, roles: [] })
  expect(text).toContain('c5 team worktree 隔离')
  expect(text).toContain('.omd/worktrees/{run-id}')
  expect(text).toContain('绝不自动删')
  expect(text).toContain('CAS 写 disposed 终态')
  expect(text).toContain('只提示不阻塞')
  const custom = renderProtocol({ config: Config.parse({ stateDir: '.custom' }), probeReport: {}, roles: [] })
  expect(custom).toContain('.custom/worktrees/{run-id}')
})

test('c2 关键词 hook 段：原生拦截点+预写状态+MAGIC KEYWORD 激活块+未命中直通入协议', () => {
  const text = renderProtocol({ config: Config.parse({}), probeReport: {}, roles: [] })
  expect(text).toContain('关键词 hook')
  expect(text).toContain('agent/pre-step')
  expect(text).toContain('[MAGIC KEYWORD')
  expect(text).toContain('零成本直通')
  expect(text).toContain('expectUpdatedAt=<注入块 updatedAt>')
})

test('c8 多仓锚定段：树内懒建+豁免向上 marker+残渣随树丢弃入协议（路径跟随 stateDir）', () => {
  const text = renderProtocol({ config: Config.parse({}), probeReport: {}, roles: [] })
  expect(text).toContain('c8 多仓锚定')
  expect(text).toContain('首次写才懒创建')
  expect(text).toContain('基线 hash 前后一致')
  expect(text).toContain('豁免向上 marker')
  expect(text).toContain('不截胡树内状态')
  expect(text).toContain('残渣随树丢弃')
  expect(text).toContain('留执行期')
  const custom = renderProtocol({ config: Config.parse({ stateDir: '.custom' }), probeReport: {}, roles: [] })
  expect(custom).toContain('`.custom/`') // 树内状态目录路径跟随 stateDir
})
