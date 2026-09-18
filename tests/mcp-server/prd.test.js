// tests/mcp-server/prd.test.js
import { test, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makePrdTools } from '../../mcp-server/tools/prd.mjs'
import { atomicWriteJson } from '../../mcp-server/lib/atomic.mjs'

const samplePrd = {
  topic: 'demo', revision: 1,
  stories: [{
    id: 'S1', title: '第一条', passes: false, architectVerified: false,
    acceptanceCriteria: [{ id: 'C1', text: '运行 npm test 全绿', revision: 1 }],
    criterionAmendments: [],
  }],
}

async function tools() {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-'))
  const t = makePrdTools({ stateDir: '.omd' })
  await atomicWriteJson(join(cwd, '.omd', 'prd', 'demo.json'), samplePrd)
  return { t, cwd }
}

test('check 置 passes:true 并记录证据；uncheck 回退', async () => {
  const { t, cwd } = await tools()
  await t.check({ cwd, topic: 'demo', storyId: 'S1', evidence: 'npm test 输出：12 passed' })
  let s = await t.status({ cwd, topic: 'demo' })
  expect(s.stories[0].passes).toBe(true)
  await t.uncheck({ cwd, topic: 'demo', storyId: 'S1', reason: '回归失败' })
  s = await t.status({ cwd, topic: 'demo' })
  expect(s.stories[0].passes).toBe(false)
})

test('check 要求 evidence 非空（证据契约，规格 §3.3-3）', async () => {
  const { t, cwd } = await tools()
  await expect(t.check({ cwd, topic: 'demo', storyId: 'S1', evidence: '' })).rejects.toThrow(/evidence/)
})

test('amend 追加修订台账并保留原文', async () => {
  const { t, cwd } = await tools()
  await t.amend({ cwd, topic: 'demo', storyId: 'S1', criterionId: 'C1', kind: 'superseded', newText: 'vitest 全绿', reason: '换了测试框架', evidence: 'package.json 已改' })
  const prd = (await t.status({ cwd, topic: 'demo' })).raw
  const story = prd.stories[0]
  expect(story.criterionAmendments).toHaveLength(1)
  expect(story.criterionAmendments[0]).toMatchObject({ kind: 'superseded', originalText: '运行 npm test 全绿', newText: 'vitest 全绿' })
  expect(story.acceptanceCriteria[0].text).toBe('vitest 全绿')
  expect(story.acceptanceCriteria[0].revision).toBe(2)
})

test('amend 引用不存在的 criterion → fail-closed 报错', async () => {
  const { t, cwd } = await tools()
  await expect(t.amend({ cwd, topic: 'demo', storyId: 'S1', criterionId: 'C99', kind: 'superseded', newText: 'x', reason: 'y', evidence: 'z' }))
    .rejects.toThrow(/C99/)
})

test('status 渲染 markdown 视图含勾选状态', async () => {
  const { t, cwd } = await tools()
  const s = await t.status({ cwd, topic: 'demo' })
  expect(s.markdown).toContain('- [ ] S1')
  await t.check({ cwd, topic: 'demo', storyId: 'S1', evidence: 'done' })
  expect((await t.status({ cwd, topic: 'demo' })).markdown).toContain('- [x] S1')
})
