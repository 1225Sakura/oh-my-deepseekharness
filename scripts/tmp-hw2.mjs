#!/usr/bin/env node
// 一次性：hud-route.test 最终清理（workers 面退役断言迁移；跑完可删）
import { readFileSync, writeFileSync } from 'node:fs'
let p = 'tests/lib/hud-route.test.js'
let t = readFileSync(p, 'utf8')
// S4 out-mail 用例整体删除（alerts 源随 heartbeat 退役）
t = t.replace(/test\('S4 out-mail 老化：领队信件超 staleAfterMs 未 ack → 告警行'[\s\S]*?\n\}\)\n/, '')
// helper 注释与本体删除（team registry fixture 不再有消费面）
t = t.replace(/\/\/ U8 S2 辅助：写 run registry[\s\S]*?return dir\n\}\n/, '')
// AC-6 用例：workers 键断言删除，registry 注入段改为纯坏 JSON 不炸验证
t = t.replace("    expect(s0.workers).toEqual({ list: [], truncated: false, filteredRuns: 0, filteredWorkers: 0 })\n", '')
t = t.replace(/    \/\/ 坏 registry 注入：run-bad 是坏 JSON（跳过该 run），run-good 正常聚合，整体不 500\n    const badDir = join\(cwd, '\.omd', 'team', 'run-bad'\)\n    await mkdir\(badDir, \{ recursive: true \}\)\n    await writeFile\(join\(badDir, 'registry\.json'\), '\{broken json', 'utf8'\)\n    await writeRegistryFixture\(cwd, 'run-good', \{[\s\S]*?\}, '2026-01-02T00:00:00\.000Z'\)\n/, "    // team registry 面已退役：目录出现与否均不影响快照（不 500 即契约）\n    const badDir = join(cwd, '.omd', 'team', 'run-bad')\n    await mkdir(badDir, { recursive: true })\n    await writeFile(join(badDir, 'registry.json'), '{broken json', 'utf8')\n")
t = t.replace("    expect(s1.workers.truncated).toBe(false)\n    expect(s1.workers.list).toHaveLength(1)\n    expect(s1.workers.list[0]).toMatchObject({ runId: 'run-good', workerId: 'w-1', role: 'omd-agent-executor', status: 'running' })\n", "    expect(s1.ok).toBe(true) // registry 残渣不再参与快照\n")
// 注释更新
t = t.replace('// AC5：顶层键集白名单锁定（U8 S2 扩为 10 键；S5 扩 {alerts}；HUD 重设计扩 {lastActivity}）', '// AC5：顶层键集白名单锁定（二期③ team 运行时退役 → {workers}/{alerts} 键移除）')
writeFileSync(p, t)
console.log('done:', !t.includes('writeRegistryFixture'), !t.includes('snap.alerts'))
