// tests/docs/glossary-rename.test.js
// P2-W2-#11（共识计划 .omd/plans/ralplan-plugin-ecosystem-audit.md）：上游 OMC v5.7.0 #4273
// 将约定文件 CONTEXT.md 改名 GLOSSARY.md；omd 资产 70 处引用随行改名（8 文件）。
// 守门：assets 全部 .md 零 CONTEXT.md 残留 + 全仓至少一处 GLOSSARY.md 引用——fresh clone 恒绿。
import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'skills')

async function walkMd(dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const fp = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walkMd(fp)))
    else if (e.name.endsWith('.md')) out.push(fp)
  }
  return out
}

describe('GLOSSARY rename follow-up (upstream v5.7.0 #4273)', () => {
  it('assets/skills/**/*.md 零 CONTEXT.md 残留', async () => {
    const files = await walkMd(assetsRoot)
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      const t = await readFile(f, 'utf8')
      expect(t, `${f} 仍引用旧约定名 CONTEXT.md`).not.toContain('CONTEXT.md')
    }
  })

  it('全仓至少一处 GLOSSARY.md 引用（改名确已生效）', async () => {
    const files = await walkMd(assetsRoot)
    let hits = 0
    for (const f of files) {
      hits += (await readFile(f, 'utf8')).split('GLOSSARY.md').length - 1
    }
    expect(hits).toBeGreaterThanOrEqual(70)
  })
})
