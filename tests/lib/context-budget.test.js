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

test('门禁：目录描述总量 ≤7000 字符，双语（49 条预算带，防 creep）', async () => {
  for (const language of ['en', 'zh']) {
    const assets = await loadAssets({ assetsRoot, language })
    const total = assets.skills.reduce((sum, s) => sum + [...s.description].length, 0)
    expect(total, language).toBeLessThanOrEqual(7000)
  }
})

test('门禁：每个 SKILL.md 与 SKILL.zh.md ≤20KB（compaction 截断线，双语遍历防 zh 盲区）', () => {
  for (const dir of skillDirs) {
    for (const file of ['SKILL.md', 'SKILL.zh.md']) {
      const p = join(assetsRoot, 'skills', dir, file)
      if (!statSyncSafe(p)) continue
      expect(statSync(p).size, dir + '/' + file).toBeLessThanOrEqual(20 * 1024)
    }
  }
})

function statSyncSafe(p) {
  try { statSync(p); return true } catch { return false }
}

test('门禁：zh 覆盖不变量——每个技能必须有 SKILL.zh.md（zh 常驻面不被 en 回退静默接管）', () => {
  for (const dir of skillDirs) {
    expect(statSyncSafe(join(assetsRoot, 'skills', dir, 'SKILL.zh.md')), dir + ' 缺 zh 变体').toBe(true)
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

test('门禁：静态协议 ≤5120 字节（三期瘦身后 2368，路由表/守卫/互斥/状态契约最小面在位）', () => {
  const text = renderProtocol({ config: Config.parse({}) })
  const bytes = Buffer.byteLength(text, 'utf8')
  expect(bytes).toBeLessThanOrEqual(5120)
  expect(bytes).toBeGreaterThanOrEqual(2000) // 防止把协议误删到失去路由职责
})
