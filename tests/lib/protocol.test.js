// tests/lib/protocol.test.js
import { test, expect } from 'vitest'
import { KEYWORD_REGISTRY, RETIRED_KEYWORDS } from '../../lib/keywords.js'
import { renderProtocol } from '../../lib/protocol.js'
import { Config } from '../../lib/config.js'

test('注册表覆盖 MVP 模式且 cancel 优先级最高、只匹配专有词', () => {
  expect(KEYWORD_REGISTRY[0].target).toBe('cancel')
  expect(KEYWORD_REGISTRY[0].triggers).toEqual(['cancelomd', 'stopomd'])
  for (const e of KEYWORD_REGISTRY) expect(e.target).toMatch(/^(cancel|ralph|autopilot|ralplan|deep-interview|review)$/)
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
