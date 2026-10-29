// tests/mcp-server/paths-cwd.test.js
// 2026-10-29 code-review 立项：mcp-server 工具 cwd 白名单收口（reviewer: runStatePath 仅校验 stateDir）
import { describe, test, expect } from 'vitest'
import { assertSafeCwd, omdPaths } from '../../mcp-server/lib/paths.mjs'
import { makeEventsTools } from '../../mcp-server/tools/events.mjs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('assertSafeCwd（cwd 白名单收口）', () => {
  test('合法绝对路径通过（Win 盘符 / POSIX / UNC）', () => {
    expect(assertSafeCwd('D:\\proj')).toBe('D:\\proj')
    expect(assertSafeCwd('D:\\proj\\sub')).toBe('D:\\proj\\sub')
    expect(assertSafeCwd('/home/user/proj')).toBe('/home/user/proj')
    expect(assertSafeCwd('\\\\server\\share\\proj')).toBe('\\\\server\\share\\proj')
  })
  test.each([
    ['', '空串'],
    ['relative/path', '相对路径'],
    ['D:\\..\\escape', '.. 段'],
    ['/tmp/../escape', '.. 段（POSIX）'],
    ['C:drive-relative', '盘符相对'],
    ['x'.repeat(5000), '超长'],
    [undefined, '缺席'],
  ])('非法 cwd 拒绝：%s（%s）', (bad) => {
    expect(() => assertSafeCwd(bad)).toThrow(/unsafe cwd/)
    expect(() => omdPaths({ cwd: bad, sessionId: 's1' })).toThrow(/unsafe cwd/)
  })
  test('omdPaths 合法路径不受影响', () => {
    const p = omdPaths({ cwd: 'D:\\proj', sessionId: 's1' })
    expect(p.root).toContain('proj/.omd')
  })
})

describe('工具边界：直读面显式拒绝非法 cwd', () => {
  test('events_read 对非法 cwd 显式拒绝（不静默跨仓读）', async () => {
    const t = makeEventsTools({ stateDir: '.omd' })
    await expect(t.read({ cwd: 'relative/path' })).rejects.toThrow(/unsafe cwd/)
    await expect(t.read({ cwd: 'D:\\..\\escape' })).rejects.toThrow(/unsafe cwd/)
  })
})
