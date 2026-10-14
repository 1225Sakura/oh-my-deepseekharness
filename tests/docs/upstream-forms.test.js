// tests/docs/upstream-forms.test.js
// 两层门守门（见 .omd/plans/ralplan-memory-omc-omx-forms.md S3）：
//   Layer 1 仓内一致性门——只依赖 git 内文件，fresh clone 恒跑；
//   Layer 2 reference 活体漂移检测——reference/ 是 gitignored 本机快照，缺席 skip+警告。
import { test, expect, describe } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const execFileP = promisify(execFile)

async function runAudit() {
  const { stdout } = await execFileP(process.execPath, [join(ROOT, 'scripts/audit-upstream-forms.mjs')], { cwd: ROOT })
  return JSON.parse(stdout) // 通道分离契约：stdout 必为纯 JSON
}
async function read(rel) { return readFile(join(ROOT, rel), 'utf8') }
async function exists(rel) { return access(join(ROOT, rel)).then(() => true, () => false) }

// 从 omd-doctor 的 MCP 行括号分解解析 {name: count}，与脚本分量对齐（不手抄第二份）
function parseBreakdown(text, marker) {
  const line = text.split(/\r?\n/).find(l => l.includes(marker))
  if (!line) return null
  const m = line.match(/[（(]([^)）]*×\d+[^)）]*)[)）]/)
  if (!m) return null
  const out = {}
  for (const part of m[1].split(/[,、]/)) {
    const kv = part.trim().match(/^([a-z]+)×(\d+)$/)
    if (kv) out[kv[1]] = Number(kv[2])
  }
  return out
}

describe('Layer 1：仓内一致性门（恒跑，fresh clone 可分发）', () => {
  test('L1a omd 侧三面计数 == 42/33/55，分量加总自洽且含 graph×6', async () => {
    const j = await runAudit()
    expect(j.omd.assets.skillsDirs).toBe(42)
    expect(j.omd.assets.agentRoles).toBe(33)
    expect(j.omd.mcpToolsTotal).toBe(55)
    const byFile = j.omd.mcpToolsByFile
    expect(byFile.graph).toBe(6)
    expect(Object.values(byFile).reduce((a, b) => a + b, 0)).toBe(55)
  })

  test('L1b package.json / README / omd-doctor 双语计数 == 实测', async () => {
    const j = await runAudit()
    const pkg = JSON.parse(await read('package.json'))
    expect(pkg.description).toContain('42 skills')
    expect(pkg.description).toContain('55 MCP tools')
    const readme = await read('README.md')
    expect(readme).toMatch(/注册 42 个 skill/)
    expect(readme).toMatch(/提供 55 个/)
    for (const [file, skillsMarker, mcpMarker, sumMarker] of [
      ['assets/skills/omd-doctor/SKILL.md', '| Skills | **42**', '**55** `mcp__omd-state__*`', '(42/33/2/4/55)'],
      ['assets/skills/omd-doctor/SKILL.zh.md', '| skill | **42**', '**55** 个 `mcp__omd-state__*`', '（42/33/2/4/55）'],
    ]) {
      const t = await read(file)
      expect(t, file + ' skills 计数').toContain(skillsMarker)
      expect(t, file + ' MCP 计数').toContain(mcpMarker)
      expect(t, file + ' 汇总行').toContain(sumMarker)
      // 分量分解与脚本实测对齐（含 graph），加总=总数
      const bd = parseBreakdown(t, 'mcp__omd-state__*')
      expect(bd, file + ' 括号分解可解析').not.toBeNull()
      for (const [name, count] of Object.entries(j.omd.mcpToolsByFile)) {
        expect(bd[name], file + ' 分解缺 ' + name).toBe(count)
      }
      expect(Object.keys(bd).length, file + ' 分解无多余分量').toBe(Object.keys(j.omd.mcpToolsByFile).length)
    }
  })

  test('L1c parity-audit 头部权威数字 == 形态卡数字（解析限定「## 方法与全局证据」小节，禁全文件扫描）', async () => {
    const audit = await read('docs/feature-parity-audit.md')
    const lines = audit.split(/\r?\n/)
    const start = lines.findIndex(l => l.startsWith('## 方法与全局证据'))
    expect(start, '方法与全局证据小节存在').toBeGreaterThan(-1)
    let end = lines.length
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) { end = i; break }
    }
    const scope = lines.slice(start, end).join('\n')
    // 权威行（L14 行域）逐字段抽取
    const grab = (re, label) => {
      const m = scope.match(re)
      expect(m, '权威行字段 ' + label + ' 可解析').not.toBeNull()
      return Number(m[1])
    }
    const auth = {
      omcSkills: grab(/OMC skills \*\*(\d+)\*\*/, 'OMC skills'),
      hooks: grab(/hooks \*\*(\d+) 条注册\*\*/, 'hooks'),
      matchers: grab(/（(\d+) matcher \/ (\d+) 事件类型/, 'matchers'),
      agents: grab(/agents \*\*(\d+)\*\*/, 'agents'),
      omxSkills: grab(/OMX root skills \*\*(\d+)\*\*/, 'OMX skills'),
    }
    // 形态卡逐字段抽取并成对相等断言（子串 contains 不足以拦漂移，必须解析对比）
    const omcCard = await read('docs/upstream-form-omc.md')
    const omxCard = await read('docs/upstream-form-omx.md')
    const grabCard = (text, re, label) => {
      const m = text.match(re)
      expect(m, '形态卡字段 ' + label + ' 可解析').not.toBeNull()
      return Number(m[1])
    }
    expect(grabCard(omcCard, /skills = \*\*(\d+)\*\*/, 'OMC 卡 skills')).toBe(auth.omcSkills)
    expect(grabCard(omcCard, /agents = \*\*(\d+)\*\*/, 'OMC 卡 agents')).toBe(auth.agents)
    expect(grabCard(omcCard, /hook actions = \*\*(\d+)\*\*/, 'OMC 卡 hook actions')).toBe(auth.hooks)
    expect(grabCard(omcCard, /matchers = \*\*(\d+)\*\*/, 'OMC 卡 matchers')).toBe(auth.matchers)
    expect(grabCard(omxCard, /root skills = \*\*(\d+)\*\*/, 'OMX 卡 root skills')).toBe(auth.omxSkills)
  })
})

describe('Layer 2：reference 活体漂移检测（缺席 skip+警告）', async () => {
  const present = await exists('reference/oh-my-claudecode') && await exists('reference/oh-my-codex')
  if (!present) {
    console.warn('WARNING reference/ 缺席，上游漂移检测跳过（gitignored 本机快照）')
  }
  test.runIf(present)('上游实测 == 形态卡声明（逐字段解析对比，非子串）', async () => {
    const j = await runAudit()
    const omc = j.upstream['oh-my-claudecode']
    const omx = j.upstream['oh-my-codex']
    const omcCard = await read('docs/upstream-form-omc.md')
    const omxCard = await read('docs/upstream-form-omx.md')
    const grabCard = (text, re, label) => {
      const m = text.match(re)
      expect(m, '形态卡字段 ' + label + ' 可解析').not.toBeNull()
      return m[1]
    }
    expect(grabCard(omcCard, /skills = \*\*(\d+)\*\*/, 'skills')).toBe(String(omc.counts.skills))
    expect(grabCard(omcCard, /agents = \*\*(\d+)\*\*/, 'agents')).toBe(String(omc.counts.agentsMd))
    expect(grabCard(omcCard, /hook actions = \*\*(\d+)\*\*/, 'hook actions')).toBe(String(omc.hooks.actions))
    expect(grabCard(omcCard, /matchers = \*\*(\d+)\*\*/, 'matchers')).toBe(String(omc.hooks.matchers))
    expect(grabCard(omxCard, /root skills = \*\*(\d+)\*\*/, 'omx skills')).toBe(String(omx.counts.skills))
    expect(grabCard(omcCard, /tag：\*\*(v[\d.]+)\*\*/, 'omc tag')).toBe(omc.tag)
    expect(grabCard(omxCard, /tag：\*\*(v[\d.]+)\*\*/, 'omx tag')).toBe(omx.tag)
  })
})
