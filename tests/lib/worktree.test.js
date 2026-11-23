// tests/lib/worktree.test.js
// 二期③：team 领队运行时退役后，本文件只钉 run-state 原语层语义（lib/worktree.js 余部）。
import { test, expect } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runStatePath, monotonicIsoNow, withCrossProcessFileLock, withRunStateLock, casWriteRunState } from '../../lib/worktree.js'
import { atomicWriteJson } from '../../lib/state/lib/atomic.mjs'

async function fixtureRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'omd-wt-'))
  return { dir }
}

test('casWriteRunState 缺 run-state → 显式报错（审计面未初始化）', async () => {
  const { dir } = await fixtureRepo()
  await expect(casWriteRunState({ cwd: dir, mutate: s => s }))
    .rejects.toThrow(/run-state\.json 不存在/)
})

test('casWriteRunState CAS 往返：seed 后 mutate + version 递增 + expectUpdatedAt 冲突', async () => {
  const { dir } = await fixtureRepo()
  try {
    const seed = { runId: 'audit-seed', version: 0, updatedAt: '2026-01-01T00:00:00.000Z', fallbackCount: 0 }
    await atomicWriteJson(runStatePath(dir, '.omd'), seed)
    const next = await casWriteRunState({ cwd: dir, expectUpdatedAt: seed.updatedAt, mutate: s => ({ ...s, fallbackCount: s.fallbackCount + 1 }) })
    expect(next.version).toBe(1)
    expect(next.fallbackCount).toBe(1)
    await expect(casWriteRunState({ cwd: dir, expectUpdatedAt: seed.updatedAt, mutate: s => s }))
      .rejects.toThrow(/conflict/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('IC-23 monotonicIsoNow：同毫秒严格 +1ms；非法 prev 按现状', () => {
  expect(monotonicIsoNow('not-a-date')).toMatch(/^\d{4}-/)
  const pinned = '2026-10-15T00:00:00.000Z'
  const bumped = monotonicIsoNow(pinned)
  expect(Date.parse(bumped)).toBeGreaterThan(Date.parse(pinned))
  const bumped2 = monotonicIsoNow(bumped)
  expect(Date.parse(bumped2)).toBeGreaterThan(Date.parse(bumped))
})

test('withRunStateLock：run-state 临界区串行（并发请求临界区成对不交错）', async () => {
  const { dir } = await fixtureRepo()
  try {
    const log = []
    await Promise.all([
      withRunStateLock(dir, '.omd', async () => { log.push('a-start'); await new Promise(r => setTimeout(r, 20)); log.push('a-end') }),
      withRunStateLock(dir, '.omd', async () => { log.push('b-start'); await new Promise(r => setTimeout(r, 20)); log.push('b-end') }),
    ])
    // 串行语义：临界区成对出现且不交错（先后序不钉死——排队取决于事件循环时序）
    const joined = log.join(',')
    expect(joined).toMatch(/^(a-start,a-end,b-start,b-end|b-start,b-end,a-start,a-end)$/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('withCrossProcessFileLock：stale 锁（mtime > 60s）被接管', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omd-lock-'))
  try {
    const lock = join(dir, 'x.lock')
    const old = new Date(Date.now() - 120_000)
    const { open } = await import('node:fs/promises')
    const fh = await open(lock, 'wx')
    await fh.close()
    const { utimes } = await import('node:fs/promises')
    await utimes(lock, old, old)
    const r = await withCrossProcessFileLock(lock, async () => 'took-over')
    expect(r).toBe('took-over')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('runStatePath：非法 cwd 拒绝（assertSafeCwd 收口）', () => {
  expect(() => runStatePath('relative/path')).toThrow(/unsafe cwd/)
  expect(() => runStatePath('C:/ok/dir')).not.toThrow()
})
