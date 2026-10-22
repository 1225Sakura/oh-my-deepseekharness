// tests/docs/setup-package-name.test.js
// 守门（刻板审查报告一 P0 修复建议落地）：omd-setup 双语的 dsh plugin add/remove
// 命令必须引用 package.json 的真实包名；裸 oh-my-dsh 是 npm 上另一个已停更的包。
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('omd-setup 双语 add/remove 命令包名与 package.json name 一致', () => {
  const pkgName = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name
  expect(pkgName).toBe('@sakura12/oh-my-deepseekharness')
  for (const rel of ['assets/skills/omd-setup/SKILL.md', 'assets/skills/omd-setup/SKILL.zh.md']) {
    const text = readFileSync(join(root, rel), 'utf8')
    const cmds = text.match(/dsh plugin --profile <profile> (?:add|remove) \S+/g) ?? []
    expect(cmds.length, rel + ' 应含 ≥3 条 plugin add/remove 命令').toBeGreaterThanOrEqual(3)
    for (const c of cmds) {
      if (/(?:add|remove) (?:\/|\.|~|[A-Za-z]:)/.test(c)) continue // 本地路径形态豁免（开发安装）
      expect(c, rel + ': ' + c).toContain(pkgName)
    }
    expect(text, rel + ' 不得在 add/remove 语境出现裸包名').not.toMatch(/(?:add|remove) oh-my-dsh\b/)
  }
})
