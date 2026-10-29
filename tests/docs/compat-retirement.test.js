// tests/docs/compat-retirement.test.js
// P1-W3-2/W3-4 验收：退役兼容矩阵为已提交资产，断言 fresh clone 恒绿（不依赖 .omd/ 运行态）
import { test, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RETIRED_KEYWORDS, RETIRED_NOTE } from '../../lib/keywords.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const doc = await readFile(join(root, 'docs/compat-retirement.md'), 'utf8')

test('compat 矩阵存在且覆盖全部退役名（4 触发词 + 16 技能）', () => {
  for (const w of [...RETIRED_KEYWORDS, 'ultraqa', 'ultrapilot', 'swarm', 'pipeline', 'merge-readiness', 'deep-dive', 'sciomc', 'omc-teams', 'mcp-setup', 'omc-reference', 'learner', 'writer-memory', 'local-build-reminder'])
    expect(doc, w).toContain(w)
})

test('compat 矩阵含 defer 台账 schema 与三要素字段', () => {
  expect(doc).toContain('defer 台账 schema')
  expect(doc).toContain('计量处')
  expect(doc).toContain('复核触发点')
  expect(doc).toContain('owner')
})

test('RETIRED_NOTE 引用 compat 矩阵路径（可发现性闭环）', () => {
  expect(RETIRED_NOTE).toContain('docs/compat-retirement.md')
})

test('上游处置实证来源入档（removed-not-aliased + alias-retirement registry）', () => {
  expect(doc).toContain('removed, not aliased')
  expect(doc).toContain('alias-retirement')
})
