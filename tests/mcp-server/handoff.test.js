// tests/mcp-server/handoff.test.js
import { test, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeHandoffTools } from '../../mcp-server/tools/handoff.mjs'

const sections = { decided: '用方案 A', rejected: '方案 B：太重', risks: '无', files: 'a.js', remaining: '无' }

async function tools() {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-'))
  return { t: makeHandoffTools({ stateDir: '.omd' }), cwd }
}

test('write 按固定模板生成文件，read 读回', async () => {
  const { t, cwd } = await tools()
  await t.write({ cwd, stage: 'team-plan', sections })
  const doc = await t.read({ cwd, stage: 'team-plan' })
  for (const h of ['## Decided', '## Rejected', '## Risks', '## Files', '## Remaining'])
    expect(doc).toContain(h)
  expect(doc).toContain('用方案 A')
})

test('write 缺段落报错（格式稳定是自研工具的立身之本）', async () => {
  const { t, cwd } = await tools()
  await expect(t.write({ cwd, stage: 'team-exec', sections: { decided: 'x' } })).rejects.toThrow(/rejected/i)
})

test('list 返回已有 handoff 的阶段名', async () => {
  const { t, cwd } = await tools()
  await t.write({ cwd, stage: 'team-plan', sections })
  await t.write({ cwd, stage: 'team-prd', sections })
  expect((await t.list({ cwd })).sort()).toEqual(['team-plan', 'team-prd'])
})

test('超 20 行的段落截断并带警告标记', async () => {
  const { t, cwd } = await tools()
  const long = Array.from({ length: 30 }, (_, i) => `行${i}`).join('\n')
  const r = await t.write({ cwd, stage: 'team-exec', sections: { ...sections, decided: long } })
  expect(r.warnings.length).toBeGreaterThan(0)
  const doc = await t.read({ cwd, stage: 'team-exec' })
  expect(doc).toContain('[truncated]')
})
