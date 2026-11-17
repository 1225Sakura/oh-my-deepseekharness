#!/usr/bin/env node
// 一次性：state-tools graph 注册残留 + skills.test 名册（跑完可删）
import { readFileSync, writeFileSync } from 'node:fs'
let p = 'lib/state-tools.js'
let t = readFileSync(p, 'utf8')
t = t.replace("import { registerGraphTools } from './state/tools/graph.mjs'\n", '')
t = t.replace('  registerTeamTools, registerTraceTools, registerEventsTools, registerHudTools,\n  registerGraphTools, registerCodeIntelTools,\n', '  registerTeamTools, registerTraceTools, registerEventsTools, registerHudTools,\n  registerCodeIntelTools,\n')
writeFileSync(p, t)
p = 'tests/assets/skills.test.js'
t = readFileSync(p, 'utf8')
t = t.replace(" 'debug', 'research', 'autoresearch', 'external-context', 'trace', 'graph', 'ask', 'ask-navigator',", " 'debug', 'research', 'autoresearch', 'external-context', 'trace', 'ask', 'ask-navigator',")
t = t.replace("test('49 个 skill 目录 × 双语文件齐全'", "test('48 个 skill 目录 × 双语文件齐全'")
writeFileSync(p, t)
console.log('done:', !readFileSync('lib/state-tools.js', 'utf8').includes('GraphTools'), !t.includes("'graph',"))
