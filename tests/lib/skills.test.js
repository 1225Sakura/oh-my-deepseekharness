import { test, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadAssets } from '../../lib/skills.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'omd-'))
  await mkdir(join(root, 'skills', 'demo'), { recursive: true })
  await writeFile(join(root, 'skills', 'demo', 'SKILL.md'),
    '---\nname: demo\ndescription: demo skill en\n---\nEN body\n')
  await writeFile(join(root, 'skills', 'demo', 'SKILL.zh.md'),
    '---\nname: demo\ndescription: 演示技能\n---\n中文正文\n')
  await mkdir(join(root, 'agents'), { recursive: true })
  await writeFile(join(root, 'agents', 'executor.md'),
    '---\nname: omd-agent-executor\ndescription: exec\ntier: medium\n---\nEN role\n')
  await writeFile(join(root, 'agents', 'executor.zh.md'),
    '---\nname: omd-agent-executor\ndescription: 实现者\ntier: medium\n---\n中文角色\n')
  await mkdir(join(root, 'overlays'), { recursive: true })
  await writeFile(join(root, 'overlays', 'medium.zh.md'), '## 档位：medium\n行为指引\n')
  return root
}

test('language=zh 选中文资产且带 source', async () => {
  const assets = await loadAssets({ assetsRoot: await fixture(), language: 'zh' })
  const skill = assets.skills.find(s => s.name === 'demo')
  expect(skill.content).toContain('中文正文')
  expect(skill.source).toBe('oh-my-dsh')
  expect(skill.invocation).toEqual({ modelInvocable: true, userInvocable: true })
})

test('language=en 选英文资产', async () => {
  const assets = await loadAssets({ assetsRoot: await fixture(), language: 'en' })
  expect(assets.skills.find(s => s.name === 'demo').content).toContain('EN body')
})

test('language=en 不混入 .zh.md 角色卡（每角色恰好一份，英文正文）', async () => {
  const assets = await loadAssets({ assetsRoot: await fixture(), language: 'en' })
  expect(assets.roles).toHaveLength(1)
  expect(assets.roles[0].name).toBe('omd-agent-executor')
  expect(assets.roles[0].content).toContain('EN role')
  expect(assets.roles[0].content).not.toContain('中文角色')
})

test('角色卡拼接档位 overlay（zh）', async () => {
  const assets = await loadAssets({ assetsRoot: await fixture(), language: 'zh' })
  const role = assets.roles.find(r => r.name === 'omd-agent-executor')
  expect(role.tier).toBe('medium')
  expect(role.content).toContain('中文角色')
  expect(role.content).toContain('## 档位：medium')
})

test('zh 文件缺失时 fallback 到英文资产', async () => {
  const root = await fixture()
  await rm(join(root, 'skills', 'demo', 'SKILL.zh.md'))
  const assets = await loadAssets({ assetsRoot: root, language: 'zh' })
  const skill = assets.skills.find(s => s.name === 'demo')
  expect(skill).toBeDefined()
  expect(skill.content).toContain('EN body')
})

test('缺 frontmatter 的资产生成明确报错', async () => {
  const root = await fixture()
  await writeFile(join(root, 'skills', 'demo', 'SKILL.md'), '没有 frontmatter')
  await expect(loadAssets({ assetsRoot: root, language: 'en' })).rejects.toThrow(/frontmatter/)
})
