// tests/assets/agents.test.js
import { test, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const AGENTS = join(dirname(fileURLToPath(import.meta.url)), '../../assets/agents')
const OVERLAYS = join(dirname(fileURLToPath(import.meta.url)), '../../assets/overlays')

// 33 角色全量名册（M1 7 + M2 12 + v0.4 OMX 移植 14），tier 与 OMC/OMX 源卡语义映射核验过：
// haiku→low, sonnet→medium, opus→high；OMX 卡按职责影响面定档（评审深度/破坏半径）
const TIERS = {
  // M1
  explore: 'low', planner: 'high', analyst: 'high', executor: 'medium',
  verifier: 'medium', 'code-reviewer': 'high', designer: 'medium',
  // M2 R1
  architect: 'high', debugger: 'medium', tracer: 'medium', 'security-reviewer': 'high',
  // M2 R2
  'test-engineer': 'medium', 'qa-tester': 'medium', scientist: 'medium', critic: 'high',
  // M2 R3
  writer: 'low', 'git-master': 'medium', 'document-specialist': 'medium', 'code-simplifier': 'high',
  // v0.4 OMX 移植（R4 评审线 / R5 专家线 / R6 产品研究线）
  'api-reviewer': 'high', 'style-reviewer': 'low', 'performance-reviewer': 'high',
  'quality-reviewer': 'medium', 'quality-strategist': 'high',
  'build-fixer': 'medium', 'dependency-expert': 'medium',
  'information-architect': 'medium', vision: 'medium',
  'product-analyst': 'medium', 'product-manager': 'high', 'ux-researcher': 'medium',
  researcher: 'low', 'explore-harness': 'low',
}
const EXPECTED = Object.keys(TIERS)
// 只读角色（源 frontmatter disallowedTools: Write, Edit 或等效判定）；build-fixer 是 execution 卡不在列
const READONLY = ['explore', 'planner', 'analyst', 'verifier', 'code-reviewer',
  'architect', 'security-reviewer', 'document-specialist', 'scientist', 'critic',
  'api-reviewer', 'style-reviewer', 'performance-reviewer', 'quality-reviewer', 'quality-strategist',
  'dependency-expert', 'information-architect', 'vision',
  'product-analyst', 'product-manager', 'ux-researcher', 'researcher', 'explore-harness']

test('33 角色 × 双语文件齐全', async () => {
  const files = await readdir(AGENTS)
  for (const r of EXPECTED) {
    expect(files).toContain(`${r}.md`)
    expect(files).toContain(`${r}.zh.md`)
  }
  // 名册外不得有多余角色卡（防漂移）
  const roleNames = new Set(files.filter(f => f.endsWith('.md')).map(f => f.replace(/\.zh\.md$|\.md$/, '')))
  for (const f of roleNames) expect(EXPECTED).toContain(f)
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

test('tier 分布符合预期（low 5 / medium 17 / high 11）', () => {
  const counts = { low: 0, medium: 0, high: 0 }
  for (const t of Object.values(TIERS)) counts[t]++
  expect(counts).toEqual({ low: 5, medium: 17, high: 11 })
})

test('3 档 overlay × 双语齐全', async () => {
  const files = await readdir(OVERLAYS)
  for (const t of ['low', 'medium', 'high']) {
    expect(files).toContain(`${t}.md`)
    expect(files).toContain(`${t}.zh.md`)
  }
})
