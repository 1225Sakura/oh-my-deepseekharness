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
  for (const s of ['cancelomd', 'ralph', '什么是', '能力矩阵', 'unavailable', 'omd-agent-explore', 'deepseek-chat', 'inherit', 'leaf-guard', 'state_write', '互斥'])
    expect(text).toContain(s)
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
