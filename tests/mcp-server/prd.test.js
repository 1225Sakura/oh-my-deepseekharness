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

// ---------- 终审修复：authority 参数 + 台账孤儿校验 ----------

test('amend 支持可选 authority 参数并写入台账；缺省为 user', async () => {
  const { t, cwd } = await tools()
  await t.amend({ cwd, topic: 'demo', storyId: 'S1', criterionId: 'C1', kind: 'superseded', newText: 'v2', reason: 'r', evidence: 'e', authority: 'verifier' })
  let prd = (await t.status({ cwd, topic: 'demo' })).raw
  expect(prd.stories[0].criterionAmendments[0].authority).toBe('verifier')
  await t.amend({ cwd, topic: 'demo', storyId: 'S1', criterionId: 'C1', kind: 'replaced', newText: 'v3', reason: 'r2', evidence: 'e2' })
  prd = (await t.status({ cwd, topic: 'demo' })).raw
  expect(prd.stories[0].criterionAmendments[1].authority).toBe('user')
})

test('status 返回 warnings 字段：正常 PRD 为空数组', async () => {
  const { t, cwd } = await tools()
  const s = await t.status({ cwd, topic: 'demo' })
  expect(s.warnings).toEqual([])
})

test('孤儿 amendment（引用的 criterion 已不存在）在 status 中产生 warning', async () => {
  const { t, cwd } = await tools()
  const { readFile, writeFile } = await import('node:fs/promises')
  const file = join(cwd, '.omd', 'prd', 'demo.json')
  const prd = JSON.parse(await readFile(file, 'utf8'))
  // 手工构造矛盾台账：amendment 引用 C99，acceptanceCriteria 里没有
  prd.stories[0].criterionAmendments.push({
    kind: 'superseded', criterionId: 'C99', originalText: 'ghost', newText: 'x',
    reason: 'r', evidence: 'e', authority: 'user', at: new Date().toISOString(),
  })
  await writeFile(file, JSON.stringify(prd, null, 2), 'utf8')
  const s = await t.status({ cwd, topic: 'demo' })
  expect(s.warnings.length).toBeGreaterThan(0)
  expect(s.warnings[0]).toContain('C99')
})
