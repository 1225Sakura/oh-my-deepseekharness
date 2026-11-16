import { test, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Config } from '../../lib/config.js'
import { loadAssets, registerAssets } from '../../lib/skills.js'
import { renderProtocol } from '../../lib/protocol.js'

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets')
const skillDirs = readdirSync(join(assetsRoot, 'skills'), { withFileTypes: true })
  .filter(e => e.isDirectory()).map(e => e.name)

/** A4 门禁：常驻开销固化为不变量——任何超限改动直接红（对照 superpowers test-skill-size.sh）。 */

test('门禁：每条技能描述 ≤200 字符，双语（触发条件式，常驻目录预算）', async () => {
  for (const language of ['en', 'zh']) {
    const assets = await loadAssets({ assetsRoot, language })
    expect(assets.skills).toHaveLength(skillDirs.length)
    for (const s of assets.skills) {
      const chars = [...s.description].length
      expect(chars, language + ' ' + s.name + ' 描述超预算').toBeLessThanOrEqual(200)
      expect(s.description, s.name + ' 描述不得概括工作流清单').not.toMatch(/（[^）]{40,}）$/)
    }
  }
})

test('门禁：目录描述总量 ≤7000 字符（49 条预算带，防 creep）', async () => {
  const assets = await loadAssets({ assetsRoot, language: 'en' })
  const total = assets.skills.reduce((sum, s) => sum + [...s.description].length, 0)
  expect(total).toBeLessThanOrEqual(7000)
})

test('门禁：每个 SKILL.md ≤20KB（compaction 截断线，superpowers #2481 同款）', () => {
  for (const dir of skillDirs) {
    const p = join(assetsRoot, 'skills', dir, 'SKILL.md')
    expect(statSync(p).size, dir).toBeLessThanOrEqual(20 * 1024)
  }
})

test('门禁：角色卡不进模型目录（A2 契约，条目数=技能数）', async () => {
  const assets = await loadAssets({ assetsRoot, language: 'en' })
  const registered = []
  const ctx = { skills: { register: entry => registered.push(entry) } }
  registerAssets(ctx, assets)
  expect(registered).toHaveLength(assets.skills.length)
  expect(registered.some(e => e.name.startsWith('omd-agent-'))).toBe(false)
})

test('门禁：静态协议 ≤5120 字节（阶段一后 4938，预留 creep 空间）', () => {
  const text = renderProtocol({ config: Config.parse({}) })
  const bytes = Buffer.byteLength(text, 'utf8')
  expect(bytes).toBeLessThanOrEqual(5120)
  expect(bytes).toBeGreaterThanOrEqual(4000) // 防止把协议误删到失去路由职责
})
