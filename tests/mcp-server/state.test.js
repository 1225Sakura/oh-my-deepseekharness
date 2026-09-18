import { test, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeStateTools } from '../../mcp-server/tools/state.mjs'

async function tools() {
  const cwd = await mkdtemp(join(tmpdir(), 'omd-'))
  const t = makeStateTools({ stateDir: '.omd' })
  return { t, cwd }
}

test('write 后 read 读回，自动带 _meta', async () => {
  const { t, cwd } = await tools()
  await t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true, iteration: 1 } })
  const got = await t.read({ cwd, sessionId: 's1', mode: 'ralph' })
  expect(got.active).toBe(true)
  expect(got._meta).toMatchObject({ mode: 'ralph', sessionId: 's1', updatedBy: 's1' })
  expect(typeof got._meta.updatedAt).toBe('string')
})

test('跨会话写被拒绝（所有权强制）', async () => {
  const { t, cwd } = await tools()
  await t.write({ cwd, sessionId: 's1', mode: 'team', state: { active: true } })
  await expect(t.write({ cwd, sessionId: 's2', mode: 'team', state: { active: false } }))
    .rejects.toThrow(/owned by session/)
})

test('写前读检查：expectRevision 不匹配时拒绝', async () => {
  const { t, cwd } = await tools()
  await t.write({ cwd, sessionId: 's1', mode: 'autopilot', state: { active: true, current_phase: 'plan' } })
  const cur = await t.read({ cwd, sessionId: 's1', mode: 'autopilot' })
  await expect(t.write({ cwd, sessionId: 's1', mode: 'autopilot', state: { current_phase: 'exec' }, expectUpdatedAt: ' stale' }))
    .rejects.toThrow(/conflict/)
  await t.write({ cwd, sessionId: 's1', mode: 'autopilot', state: { current_phase: 'exec' }, expectUpdatedAt: cur._meta.updatedAt }) // 不抛
})

test('listActive 只列 active:true 的模式，跨会话聚合只读', async () => {
  const { t, cwd } = await tools()
  await t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true } })
  await t.write({ cwd, sessionId: 's1', mode: 'team', state: { active: false } })
  await t.write({ cwd, sessionId: 's2', mode: 'autopilot', state: { active: true } })
  const list = await t.listActive({ cwd })
  expect(list.map(x => `${x._meta.sessionId}:${x._meta.mode}`).sort())
    .toEqual(['s1:ralph', 's2:autopilot'])
})

test('clear 删除文件，重复 clear 幂等', async () => {
  const { t, cwd } = await tools()
  await t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true } })
  await t.clear({ cwd, sessionId: 's1', mode: 'ralph' })
  await t.clear({ cwd, sessionId: 's1', mode: 'ralph' })
  expect(await t.read({ cwd, sessionId: 's1', mode: 'ralph' })).toBeUndefined()
})

test('prompt_echo 超过 1200 字符被截断', async () => {
  const { t, cwd } = await tools()
  await t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true, prompt_echo: 'x'.repeat(2000) } })
  const got = await t.read({ cwd, sessionId: 's1', mode: 'ralph' })
  expect(got.prompt_echo.length).toBeLessThanOrEqual(1200)
})

// ---------- 终审修复 L3：孤儿文件（缺 _meta）报错文案 ----------

test('孤儿 state 文件（缺 _meta）的报错文案显示 <unknown> 而非 undefined', async () => {
  const { t, cwd } = await tools()
  const { mkdir, writeFile } = await import('node:fs/promises')
  // 手工在别的会话目录放一个无 _meta 的孤儿文件
  await mkdir(join(cwd, '.omd', 'state', 'sessions', 'ghost'), { recursive: true })
  await writeFile(join(cwd, '.omd', 'state', 'sessions', 'ghost', 'ralph-state.json'),
    JSON.stringify({ active: true }), 'utf8')
  await expect(t.write({ cwd, sessionId: 's1', mode: 'ralph', state: { active: true } }))
    .rejects.toThrow(/<unknown>|ghost/)
})
