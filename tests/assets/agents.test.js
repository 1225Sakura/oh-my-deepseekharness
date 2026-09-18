// tests/assets/agents.test.js
import { test, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const AGENTS = join(dirname(fileURLToPath(import.meta.url)), '../../assets/agents')
const OVERLAYS = join(dirname(fileURLToPath(import.meta.url)), '../../assets/overlays')
const EXPECTED = ['explore', 'planner', 'analyst', 'executor', 'verifier', 'code-reviewer', 'designer']
const TIERS = { explore: 'low', planner: 'high', analyst: 'high', executor: 'medium', verifier: 'medium', 'code-reviewer': 'high', designer: 'medium' }
const READONLY = ['explore', 'planner', 'analyst', 'verifier', 'code-reviewer']

test('7 角色 × 双语文件齐全', async () => {
  const files = await readdir(AGENTS)
  for (const r of EXPECTED) {
    expect(files).toContain(`${r}.md`)
    expect(files).toContain(`${r}.zh.md`)
  }
})

test('每张中文卡：frontmatter 正确 + Final_Response_Contract + leaf-guard', async () => {
  for (const r of EXPECTED) {
    const text = await readFile(join(AGENTS, `${r}.zh.md`), 'utf8')
    expect(text).toContain(`name: omd-agent-${r}`)
    expect(text).toContain(`tier: ${TIERS[r]}`)
    expect(text).toContain('最后一条')
    expect(text).toMatch(/孙代理|sub-agent/)
    if (READONLY.includes(r)) expect(text).toMatch(/禁止调用.*(write|edit)/i)
  }
})

test('3 档 overlay × 双语齐全', async () => {
  const files = await readdir(OVERLAYS)
  for (const t of ['low', 'medium', 'high']) {
    expect(files).toContain(`${t}.md`)
    expect(files).toContain(`${t}.zh.md`)
  }
})
