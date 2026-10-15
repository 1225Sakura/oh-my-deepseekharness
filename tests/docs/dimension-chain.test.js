// tests/docs/dimension-chain.test.js
// 全维度问题链守门（见 .omd/plans/ralplan-full-dimension-issue-chain.md S4）：
//   Layer 1 恒跑层——只依赖 git 内文件（C-1 方案 A 后台账 .omd/plans/upgrade-tracking.md 经
//     .gitignore 外科式再包含随 git 分发），fresh clone 恒跑；
//   Layer 2 reference 活体漂移检测——reference/ 是 gitignored 本机快照，缺席 skip+警告。
// 解析域纪律：台账只解析「## 全维度问题链台账（IC）」节（锚定起止，禁全文件扫描）；
// 互断纪律：L1e 以脚本 MAP 为机器权威，与 docs/dimension-framework.md §6 人读表双向集合相等。
import { test, expect, describe } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const execFileP = promisify(execFile)

async function runClosure() {
  const { stdout } = await execFileP(process.execPath, [join(ROOT, 'scripts/audit-dimension-closure.mjs')], { cwd: ROOT })
  return JSON.parse(stdout) // 通道分离契约：stdout 必为纯 JSON
}
async function read(rel) { return readFile(join(ROOT, rel), 'utf8') }
async function exists(rel) { return access(join(ROOT, rel)).then(() => true, () => false) }

// ── 台账 IC 节解析（节锚定起止：U 系列表与附记不进解析域）──
function parseIcSection(ledger) {
  const start = ledger.indexOf('## 全维度问题链台账（IC）')
  expect(start, 'IC 节标题存在').toBeGreaterThan(-1)
  const rest = ledger.slice(start)
  const endM = rest.slice(10).search(/^## (?!#)/m) // 下一个二级节
  return endM === -1 ? rest : rest.slice(0, endM + 10)
}
function parseIcRows(section) {
  // 主表 9 列：ID|维度|项|发现|诊断|共识|执行|守门|定档
  return section.split(/\r?\n/)
    .filter(l => l.startsWith('| IC-'))
    .map(l => l.split('|').slice(1, -1).map(c => c.trim()))
    .filter(c => c.length === 9)
    .map(([id, dim, item, found, diag, consensus, exec, gate, tier]) => ({ id, dim, item, found, diag, consensus, exec, gate, tier }))
}
function parseRankRows(section) {
  const m = section.match(/### 排序表[\s\S]*?(?=\n### |\n#### |$)/)
  if (!m) return []
  return m[0].split(/\r?\n/).filter(l => /^\| (P0|P1|P2|OBS) \|/.test(l))
    .map(l => l.split('|').slice(1, -1).map(c => c.trim()))
    .map(([tier, id, item, blockedBy]) => ({ tier, id, item, blockedBy }))
}

const ENUMS = {
  found: /^(diff|probe|manual|injected|empirical)$/,
  diag: /^(pending|root-caused)$/,
  consensus: /^(none-needed|pending|approved)$/,
  exec: /^(pending|done|observed-only|wontfix.*)$/,
  gate: /^(assertion-live\(.+\)|conditional-review\(.+\)|none-justified)$/,
  tier: /^(P0|P1|P2|OBS)$/,
  dim: /^D([1-9]|1[0-6])(\+D([1-9]|1[0-6]))*$/,
}
// 注入清单 9 类（spec 7 + 实证 2）：①P2 十项 ②flake ③home 锚定 ④徽章漂移 ⑤新能力四项 ⑥dsh 复评 ⑦MAGIC KEYWORD ⑧keyword 误触发 ⑨残留状态
const INJECTED_IDS = [
  ...Array.from({ length: 10 }, (_, i) => 'IC-' + String(i + 1).padStart(2, '0')),
  'IC-11', 'IC-12', 'IC-13', 'IC-14', 'IC-15', 'IC-16', 'IC-17', 'IC-18', 'IC-19', 'IC-20', 'IC-21',
]

describe('Layer 1：恒跑层（git 内事实，fresh clone 可分发）', () => {
  test('L1a 闭包零孤儿（omd 面）', async () => {
    const j = await runClosure()
    expect(j.orphans.omd, 'omd 面孤儿: ' + JSON.stringify(j.orphans.omd)).toEqual([])
  })

  test('L1b 台账 IC 表五段枚举合法 + 终态合法', async () => {
    const section = parseIcSection(await read('.omd/plans/upgrade-tracking.md'))
    const rows = parseIcRows(section)
    expect(rows.length, 'IC 主表非空').toBeGreaterThan(0)
    const ids = new Set()
    for (const r of rows) {
      expect(ids.has(r.id), r.id + ' 重复').toBe(false)
      ids.add(r.id)
      expect(r.dim, r.id + ' 维度').toMatch(ENUMS.dim)
      expect(r.found, r.id + ' 发现').toMatch(ENUMS.found)
      expect(r.diag, r.id + ' 诊断').toMatch(ENUMS.diag)
      expect(r.consensus, r.id + ' 共识').toMatch(ENUMS.consensus)
      expect(r.exec, r.id + ' 执行').toMatch(ENUMS.exec)
      expect(r.gate, r.id + ' 守门').toMatch(ENUMS.gate)
      expect(r.tier, r.id + ' 定档').toMatch(ENUMS.tier)
      if (r.diag === 'root-caused') {
        expect(section.includes('#### ' + r.id), r.id + ' root-caused 须有附记小节').toBe(true)
      }
      // 终态合法：closed（done/wontfix）与 observed（OBS）两分支
      if (r.exec === 'done' || r.exec.startsWith('wontfix')) {
        expect(r.diag, r.id + ' closed 须诊断=root-caused').toBe('root-caused')
        expect(r.consensus, r.id + ' closed 须共识≠pending').not.toBe('pending')
        if (r.exec.startsWith('wontfix')) {
          expect(r.consensus, r.id + ' wontfix 须共识=approved').toBe('approved')
          expect(section.includes('#### ' + r.id), r.id + ' wontfix 须附记含理由').toBe(true)
        }
      }
      if (r.tier === 'OBS') {
        expect(r.exec, r.id + ' observed 终态须执行=observed-only').toBe('observed-only')
        const noteM = section.match(new RegExp('#### ' + r.id + '([\\s\\S]*?)(?=\\n#### |$)'))
        expect(noteM, r.id + ' OBS 须有附记').not.toBeNull()
        expect(noteM[1].includes('升格'), r.id + ' OBS 附记须含升格条件').toBe(true)
      }
    }
  })

  test('L1c 注入在册：9 类注入（spec 7 + 实证 2）对应 IC-ID 全部存在', async () => {
    const section = parseIcSection(await read('.omd/plans/upgrade-tracking.md'))
    const ids = new Set(parseIcRows(section).map(r => r.id))
    for (const id of INJECTED_IDS) expect(ids.has(id), '缺注入行 ' + id).toBe(true)
  })

  test('L1d 排序完备：非 OBS IC-ID 恰现于一档，blocked-by 可解析', async () => {
    const section = parseIcSection(await read('.omd/plans/upgrade-tracking.md'))
    const rows = parseIcRows(section)
    const ranks = parseRankRows(section)
    const rankCount = new Map()
    for (const r of ranks) rankCount.set(r.id, (rankCount.get(r.id) ?? 0) + 1)
    const ids = new Set(rows.map(r => r.id))
    for (const r of rows) {
      if (r.tier === 'OBS') continue
      expect(rankCount.get(r.id) ?? 0, r.id + ' 须恰现于一档').toBe(1)
    }
    for (const r of ranks) {
      expect(ids.has(r.id), '排序表引用未知 ' + r.id).toBe(true)
      if (r.blockedBy !== '-') {
        for (const dep of r.blockedBy.split(/[,、]/).map(s => s.trim())) {
          expect(ids.has(dep), r.id + ' blocked-by 不可解析: ' + dep).toBe(true)
        }
      }
    }
  })

  test('L1e 框架互断：文档 §6 映射表行集 == 脚本 MAP 键集', async () => {
    const src = await read('scripts/audit-dimension-closure.mjs')
    const scriptKeys = new Set([...src.matchAll(/'((?:omd|ref):[^']+)':/g)].map(m => m[1]))
    const doc = await read('docs/dimension-framework.md')
    const s6 = doc.slice(doc.indexOf('## §6'), doc.indexOf('## §7'))
    const docKeys = new Set([...s6.matchAll(/\| `((?:omd|ref):[^`]+)` \|/g)].map(m => m[1]))
    expect([...scriptKeys].filter(k => !docKeys.has(k)), '仅脚本有: ').toEqual([])
    expect([...docKeys].filter(k => !scriptKeys.has(k)), '仅文档有: ').toEqual([])
  })
})

// ── Layer 2：reference 活体漂移检测（缺席 skip+警告）──
const refPresent = await exists('reference/oh-my-claudecode') && await exists('reference/oh-my-codex')
if (!refPresent) console.warn('WARNING reference/ 缺席，上游漂移检测跳过（gitignored 本机快照）')

describe('Layer 2：reference 活体漂移检测', () => {
  test.runIf(refPresent)('L2 闭包零孤儿（reference 两仓面）', async () => {
    const j = await runClosure()
    expect(j.orphans.ref, 'reference 面孤儿: ' + JSON.stringify(j.orphans.ref)).toEqual([])
  })
})