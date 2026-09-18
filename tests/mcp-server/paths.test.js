// tests/mcp-server/paths.test.js
import { test, expect } from 'vitest'
import { omdPaths } from '../../mcp-server/lib/paths.mjs'

test('按 stateDir + sessionId 生成全部标准路径', () => {
  const p = omdPaths({ cwd: '/work/proj', stateDir: '.omd', sessionId: 's-1' })
  expect(p.root).toBe('/work/proj/.omd')
  expect(p.stateFile('ralph')).toBe('/work/proj/.omd/state/sessions/s-1/ralph-state.json')
  expect(p.boulder).toBe('/work/proj/.omd/state/boulder.json')
  expect(p.sessionDir).toBe('/work/proj/.omd/state/sessions/s-1')
})

test('sessionId 含路径分隔符时拒绝（防路径逃逸）', () => {
  expect(() => omdPaths({ cwd: '/w', stateDir: '.omd', sessionId: '../evil' })).toThrow()
})
