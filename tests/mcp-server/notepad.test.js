// tests/mcp-server/notepad.test.js
import { test, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeNotepadTools } from '../../mcp-server/tools/notepad.mjs'

async function tools() {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-'))
  return { t: makeNotepadTools({ stateDir: '.omd' }), cwd }
}

test('两个分区分别写入并读回', async () => {
  const { t, cwd } = await tools()
  await t.writePriority({ cwd, text: '永远记住这个' })
  await t.writeWorking({ cwd, text: '临时事项' })
  const doc = await t.read({ cwd })
  expect(doc).toContain('## Priority Context')
  expect(doc).toContain('永远记住这个')
  expect(doc).toContain('临时事项')
})

test('Working Memory 超过 7 天的条目在写入时被惰性清理', async () => {
  const { t, cwd } = await tools()
  await t.writeWorking({ cwd, text: '旧条目', at: new Date(Date.now() - 8 * 86400_000).toISOString() })
  await t.writeWorking({ cwd, text: '新条目' })
  const doc = await t.read({ cwd })
  expect(doc).not.toContain('旧条目')
  expect(doc).toContain('新条目')
})

test('Priority 区条目永不清理（旧时间戳也保留）', async () => {
  const { t, cwd } = await tools()
  await t.writePriority({ cwd, text: '古董', at: '2020-01-01T00:00:00Z' })
  expect(await t.read({ cwd })).toContain('古董')
})

test('stats 返回三区条目数', async () => {
  const { t, cwd } = await tools()
  await t.writePriority({ cwd, text: 'a' })
  await t.writeWorking({ cwd, text: 'b' })
  const s = await t.stats({ cwd })
  expect(s).toEqual({ priority: 1, working: 1, manual: 0 })
})

// ---------- H2 回归：raw 行保留（各区用户内容永不丢失） ----------

test('Priority 区手写多行段落+注释在 writeWorking 后原样保留', async () => {
  const { t, cwd } = await tools()
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(join(cwd, '.omd'), { recursive: true })
  const manual = [
    '# omd Notepad', '',
    '## Priority Context',
    '这是一段手写的多行说明：',
    '第一行内容保留',
    '', '  - 甚至包括缩进的伪列表',
    '<!-- 注释也要保留 -->',
    '最后一行',
    '',
    '## Working Memory', '',
    '## MANUAL', '',
  ].join('\n')
  await writeFile(join(cwd, '.omd', 'notepad.md'), manual, 'utf8')
  await t.writeWorking({ cwd, text: '新工作条目' })
  const doc = await t.read({ cwd })
  for (const frag of ['这是一段手写的多行说明：', '第一行内容保留', '  - 甚至包括缩进的伪列表', '<!-- 注释也要保留 -->', '最后一行'])
    expect(doc).toContain(frag)
  expect(doc).toContain('新工作条目')
  // H2 修复断言：用户写在 Priority 区的 raw 段落必须落在 Priority 区（不在 Working 区内）；
  // 此前写的是 'Priority Context' < 'Working Memory' 的标题顺序——serializeNotepad 恒按 ZONES
  // 顺序输出，断言恒真，无法捕获 fixture 错乱。改为：fixture 段落必须落在 Priority 区段内。
  const priIdx = doc.indexOf('## Priority Context')
  const workIdx = doc.indexOf('## Working Memory')
  const fragIdx = doc.indexOf('这是一段手写的多行说明')
  expect(priIdx).toBeGreaterThanOrEqual(0)
  expect(workIdx).toBeGreaterThan(priIdx)
  expect(fragIdx).toBeGreaterThan(priIdx)
  expect(fragIdx).toBeLessThan(workIdx)
})

test('working 区非条目 raw 行保留，过期条目被清理', async () => {
  const { t, cwd } = await tools()
  const old = new Date(Date.now() - 8 * 86400_000).toISOString()
  await t.writeWorking({ cwd, text: '过期条目', at: old })
  const { writeFile, readFile } = await import('node:fs/promises')
  const file = join(cwd, '.omd', 'notepad.md')
  // 手工塞入一行非条目 raw 文本到 Working 区
  const doc = await readFile(file, 'utf8')
  await writeFile(file, doc.replace('## Working Memory\n', '## Working Memory\n这段是手绘说明不是条目\n'), 'utf8')
  await t.writeWorking({ cwd, text: '新条目' })   // 触发惰性清理
  const after = await t.read({ cwd })
  expect(after).toContain('这段是手绘说明不是条目')
  expect(after).not.toContain('过期条目')
  expect(after).toContain('新条目')
})

test('stats 只统计条目行（raw 行不计数）', async () => {
  const { t, cwd } = await tools()
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(join(cwd, '.omd'), { recursive: true })
  await writeFile(join(cwd, '.omd', 'notepad.md'),
    '# omd Notepad\n\n## Priority Context\n\n## Working Memory\n说明性 raw 行\n\n## MANUAL\n手写段落\n', 'utf8')
  await t.writePriority({ cwd, text: '真条目' })
  const s = await t.stats({ cwd })
  expect(s).toEqual({ priority: 1, working: 0, manual: 0 })
})
