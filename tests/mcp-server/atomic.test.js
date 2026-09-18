// tests/mcp-server/atomic.test.js
import { test, expect } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteJson, readJson } from '../../mcp-server/lib/atomic.mjs'

test('atomicWriteJson 写入后可读回等价对象', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omd-'))
  const file = join(dir, 'a.json')
  await atomicWriteJson(file, { x: 1, nested: { y: [2] } })
  expect(await readJson(file)).toEqual({ x: 1, nested: { y: [2] } })
})

test('readJson 对不存在的文件返回 fallback 而不抛异常', async () => {
  expect(await readJson('/nonexistent-omd/none.json', { empty: true })).toEqual({ empty: true })
})

test('atomicWriteJson 自动创建父目录', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omd-'))
  const file = join(dir, 'deep/deeper/b.json')
  await atomicWriteJson(file, { ok: true })
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ ok: true })
})
