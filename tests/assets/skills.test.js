// tests/assets/skills.test.js
import { test, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), '../../assets/skills')
const EXPECTED = ['autopilot', 'ralph', 'team', 'deep-interview', 'ralplan', 'plan', 'execute', 'verify', 'review', 'cancel', 'omd-doctor']

test('11 个 skill 目录 × 双语文件齐全', async () => {
  const dirs = await readdir(SKILLS)
  for (const s of EXPECTED) {
    expect(dirs).toContain(s)
    const files = await readdir(join(SKILLS, s))
    expect(files).toContain('SKILL.md')
    expect(files).toContain('SKILL.zh.md')
  }
})

test('每个 frontmatter 有 name 和 description', async () => {
  for (const s of EXPECTED) {
    const text = await readFile(join(SKILLS, s, 'SKILL.zh.md'), 'utf8')
    expect(text).toMatch(/^---\r?\n[\s\S]*?name: .+?\r?\n[\s\S]*?description: .+?\r?\n[\s\S]*?---/)
  }
})

test('关键协议内容断言（规格 §3）', async () => {
  const read = (s) => readFile(join(SKILLS, s, 'SKILL.zh.md'), 'utf8')
  const autopilot = await read('autopilot')
  expect(autopilot).toContain('5')            // QA ≤5 循环
  expect(autopilot).toContain('max_goal_rounds')
  expect(autopilot).toContain('verifier')
  expect(autopilot).toContain('code-reviewer')
  const ralph = await read('ralph')
  expect(ralph).toContain('prd.json')
  expect(ralph).toMatch(/evidence|证据/)
  expect(ralph).toContain('verifier')
  expect(ralph).toContain('architectVerified')
  const team = await read('team')
  expect(team).toContain('team-plan')
  expect(team).toContain('team-fix')
  expect(team).toContain('显式调用')
  expect(team).toContain('max_fix_loops')
  const cancel = await read('cancel')
  expect(cancel).toContain('state_clear')
  const review = await readFile(join(SKILLS, 'review', 'SKILL.md'), 'utf8')
  expect(review).toContain('name: review')
})

test('omd-doctor 原创 skill 含诊断清单要点（规格 §6.3）', async () => {
  const doc = await readFile(join(SKILLS, 'omd-doctor', 'SKILL.zh.md'), 'utf8')
  expect(doc).toContain('state_get_status')
  expect(doc).toMatch(/gitignore/i)
  expect(doc).toMatch(/端到端/)
})
