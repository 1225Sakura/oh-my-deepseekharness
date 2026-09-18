// tests/lib/config.test.js
import { test, expect } from 'vitest'
import { Config, resolveModel } from '../../lib/config.js'

test('默认值符合规格 §4.3', () => {
  const c = Config.parse({})
  expect(c.language).toBe('zh')
  expect(c.tiers).toEqual({ low: 'deepseek-chat', medium: 'deepseek-chat', high: 'deepseek-reasoner' })
  expect(c.stateDir).toBe('.omd')
  expect(c.autopilot).toEqual({ maxIterations: 10, maxQaCycles: 5, maxValidationRounds: 3 })
})

test('resolveModel：roleOverrides 优先于 tiers', () => {
  const c = Config.parse({ tiers: { high: 'x/y' }, roleOverrides: { 'omd-agent-planner': 'a/b' } })
  expect(resolveModel(c, { name: 'omd-agent-planner', tier: 'high' })).toBe('a/b')
  expect(resolveModel(c, { name: 'omd-agent-code-reviewer', tier: 'high' })).toBe('x/y')
})

test("resolveModel：档位值 'inherit' 返回 undefined（委派时不填 model）", () => {
  const c = Config.parse({ tiers: { low: 'inherit' } })
  expect(resolveModel(c, { name: 'omd-agent-explore', tier: 'low' })).toBeUndefined()
})

test('非法 language 拒绝', () => {
  expect(() => Config.parse({ language: 'fr' })).toThrow()
})
