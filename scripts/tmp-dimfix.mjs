#!/usr/bin/env node
// 一次性：dimension MAP + docs §6 补 lib/state-domain.js（跑完可删）
import { readFileSync, writeFileSync } from 'node:fs'
let s = readFileSync('scripts/audit-dimension-closure.mjs', 'utf8')
s = s.replace("  'omd:lib/state-tools.js': ['D11'],", "  'omd:lib/state-domain.js': ['D11'],\n  'omd:lib/state-tools.js': ['D11'],")
writeFileSync('scripts/audit-dimension-closure.mjs', s)
let d = readFileSync('docs/dimension-framework.md', 'utf8')
d = d.replace('| `omd:lib/state-tools.js` | D11 |', '| `omd:lib/state-domain.js` | D11 |\n| `omd:lib/state-tools.js` | D11 |')
writeFileSync('docs/dimension-framework.md', d)
console.log('MAP/docs updated:', s.includes('state-domain'), d.includes('state-domain'))
