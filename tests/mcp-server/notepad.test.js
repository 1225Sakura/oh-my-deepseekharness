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

test('三个分区分别写入并读回', async () => {
  const { t, cwd } = await tools()
  await t.writePriority({ cwd, text: '永远记住这个' })
  await t.writeWorking({ cwd, text: '临时事项' })
  await t.writeManual({ cwd, text: '用户手写区' })
  const doc = await t.read({ cwd })
  expect(doc).toContain('## Priority Context')
  expect(doc).toContain('永远记住这个')
  expect(doc).toContain('临时事项')
  expect(doc).toContain('用户手写区')
})

test('Working Memory 超过 7 天的条目在写入时被惰性清理', async () => {
  const { t, cwd } = await tools()
  await t.writeWorking({ cwd, text: '旧条目', at: new Date(Date.now() - 8 * 86400_000).toISOString() })
  await t.writeWorking({ cwd, text: '新条目' })
  const doc = await t.read({ cwd })
  expect(doc).not.toContain('旧条目')
  expect(doc).toContain('新条目')
})

test('MANUAL 区即使带旧时间戳也永不清理', async () => {
  const { t, cwd } = await tools()
  await t.writeManual({ cwd, text: '古董', at: '2020-01-01T00:00:00Z' })
  await t.prune({ cwd })
  expect(await t.read({ cwd })).toContain('古董')
})

test('stats 返回三区条目数', async () => {
  const { t, cwd } = await tools()
  await t.writePriority({ cwd, text: 'a' })
  await t.writeWorking({ cwd, text: 'b' })
  const s = await t.stats({ cwd })
  expect(s).toEqual({ priority: 1, working: 1, manual: 0 })
})
