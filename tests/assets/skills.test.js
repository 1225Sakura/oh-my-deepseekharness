// tests/assets/skills.test.js
import { test, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), '../../assets/skills')
// 49 skill 全量名册（44 基线 + team eco-completion 五项 port）：M1 11 + M2 S1 8 + S2 7 + S3 6 + S4 6 + v0.4 OMX 移植 4 + 上游 tdd 移植 1（P1-W2-#8；v0.4.1 清理：omc-doctor / configure-notifications 经批准移除）
const EXPECTED = [
  // M1：3 模式 + 7 辅助 + omd-doctor（原创）
  'autopilot', 'ralph', 'team', 'deep-interview', 'ralplan', 'plan', 'execute', 'verify', 'review', 'cancel', 'omd-doctor',
  // M2 S1 分析研究类
  'debug', 'research', 'autoresearch', 'external-context', 'trace', 'graph', 'ask', 'ask-navigator',
  // M2 S2 质量与记忆类
  'ai-slop-cleaner', 'minimal-code-discipline', 'agent-doc-discipline', 'self-improve', 'skillify', 'skill', 'remember',
  // M2 S3 基础设施类
  'deepinit', 'drydock', 'harbor', 'loft', 'launch', 'hud',
  // M2 S4 元与发布类（omc-setup 已改名 omd-setup；omc-doctor 于 v0.4.1 经批准移除）
  'omd-setup', 'project-session-manager', 'release', 'ultragoal', 'visual-verdict', 'wiki',
  // v0.4 OMX 独有 skill 移植（ultraqa/worker 已记 🚫 决定：OMC 退役 / 并入 team）
  'analyze', 'best-practice-research', 'design', 'performance-goal',
  // 上游 OMC v5.6.0 tdd 移植（P1-W2-#8：预同意接缝表 + test-first 纪律）
  'tdd',
  'map',
  // P2 批次（W2-#1/#2/#4/#7/#9：单代理模式 port，含影子实例重复劳动对账）
  'architecture-survey', 'diagram', 'minimal-prose-discipline', 'session-flow', 'refit',
]

test('49 个 skill 目录 × 双语文件齐全', async () => {
  const dirs = await readdir(SKILLS)
  for (const s of EXPECTED) {
    expect(dirs).toContain(s)
    const files = await readdir(join(SKILLS, s))
    expect(files).toContain('SKILL.md')
    expect(files).toContain('SKILL.zh.md')
  }
  // 名册外不得有多余 skill 目录（防漂移）
  for (const d of dirs) expect(EXPECTED).toContain(d)
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
  const tddZh = await read('tdd')
  expect(tddZh).toMatch(/接缝/)
  expect(tddZh).toMatch(/红绿|red\/green/)
  expect(tddZh).toContain('一个测试')
  const tddEn = await readFile(join(SKILLS, 'tdd', 'SKILL.md'), 'utf8')
  expect(tddEn).toContain('name: tdd')
  expect(tddEn).toContain('seam')
})

test('omd-doctor 原创 skill 含诊断清单要点（规格 §6.3）', async () => {
  const doc = await readFile(join(SKILLS, 'omd-doctor', 'SKILL.zh.md'), 'utf8')
  expect(doc).toContain('state_get_status')
  expect(doc).toMatch(/gitignore/i)
  expect(doc).toMatch(/端到端/)
})

test('hud skill 双语同步：detail/modeCatalog/preset/tier 说明 + 新卡样例标记 + 旧 6 行契约字样清除（AC8 双向 grep）', async () => {
  const zh = await readFile(join(SKILLS, 'hud', 'SKILL.zh.md'), 'utf8')
  const en = await readFile(join(SKILLS, 'hud', 'SKILL.md'), 'utf8')
  // 正向（两文件一致）：current_phase/stale 说明 + modeCatalog/preset/tier 说明 + 新卡样例标记
  for (const [tag, text] of [['zh', zh], ['en', en]]) {
    expect(text, tag + ' 缺 current_phase 说明').toContain('current_phase')
    expect(text, tag + ' 缺 stale 说明').toMatch(/stale|未更新/)
    expect(text, tag + ' 缺 modeCatalog 说明').toContain('modeCatalog')
    expect(text, tag + ' 缺 preset 说明').toContain('preset')
    expect(text, tag + ' 缺 tier 说明').toContain('tier')
    expect(text, tag + ' 缺新卡样例标记').toContain('[omd] 编排状态')
  }
  // 负向：旧 6 行契约字样（en 曾有 six-line/six bounded 三处；zh 曾有 6 行卡/6 行有界 三处）
  expect(en).not.toMatch(/six-line|six bounded/)
  expect(zh).not.toMatch(/6 行卡|6 行有界/)
})
