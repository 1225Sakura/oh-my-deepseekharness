// tests/lib/protocol.test.js
import { test, expect } from 'vitest'
import { KEYWORD_REGISTRY, RETIRED_KEYWORDS } from '../../lib/keywords.js'
import { renderProtocol } from '../../lib/protocol.js'
import { Config } from '../../lib/config.js'

test('注册表覆盖模式与 M2 关键词且 cancel 优先级最高、只匹配专有词', () => {
  expect(KEYWORD_REGISTRY[0].target).toBe('cancel')
  expect(KEYWORD_REGISTRY[0].triggers).toEqual(['cancelomd', 'stopomd'])
  for (const e of KEYWORD_REGISTRY) expect(e.target).toMatch(/^(cancel|ralph|autopilot|ralplan|deep-interview|review|tdd|ai-slop-cleaner|wiki)$/)
})

test('tdd 键与 review 同形态（P1-W2-#8：natural + injectGuide，不武装状态）', () => {
  const tdd = KEYWORD_REGISTRY.find(e => e.target === 'tdd')
  expect(tdd).toBeDefined()
  expect(tdd.triggers).toEqual(['tdd', 'TDD 模式'])
  expect(tdd.intent).toBe('natural')
  expect(tdd.hook).toEqual({ arm: false, injectGuide: true, match: 'token' })
})

test('w-P1-2：deep-interview/ai-slop-cleaner 武装为 messageStart（对齐 autopilot 形态）', () => {
  for (const key of ['deep-interview', 'ai-slop-cleaner']) {
    const e = KEYWORD_REGISTRY.find(x => x.target === key)
    expect(e).toBeDefined()
    expect(e.intent).toBe('natural')
    expect(e.hook).toEqual({ arm: true, match: 'messageStart' })
  }
})

test('退役词表包含 ultrawork 系列', () => {
  for (const w of ['ultrawork', 'ulw', 'uw', 'ccg']) expect(RETIRED_KEYWORDS).toContain(w)
})

test('RETIRED_NOTE 引用 compat 矩阵且该资产含 defer 台账 schema（fresh clone 恒绿）', async () => {
  const { RETIRED_NOTE } = await import('../../lib/keywords.js')
  expect(RETIRED_NOTE).toContain('docs/compat-retirement.md')
  // w-P2-5（P2-W3-4 软别名评估）：机制 b 采纳——逐词继任示例段（单行分段，消费方 lib/protocol.js:42 内嵌协议行）
  expect(RETIRED_NOTE).toContain('ultrawork → autopilot')
  expect(RETIRED_NOTE).toContain('ulw → autopilot')
  expect(RETIRED_NOTE).toContain('uw → autopilot')
  expect(RETIRED_NOTE).toContain('ccg → autopilot')
  expect(RETIRED_NOTE).toContain('`autopilot <你的任务>`')
  const { readFile } = await import('node:fs/promises')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
  const doc = await readFile(join(root, 'docs/compat-retirement.md'), 'utf8')
  expect(doc).toContain('defer 台账 schema')
  expect(doc).toContain('计量处')
  expect(doc).toContain('merge-readiness')
})

test('team 不在注册表中（显式调用 only，规格 §3.0-4）', () => {
  expect(KEYWORD_REGISTRY.some(e => e.target === 'team')).toBe(false)
})

test('renderProtocol 保留关键词、硬约束与委派，移除角色表、probe 矩阵和 team 实现细节', () => {
  const config = Config.parse({})
  const probe = { core: { status: 'ok' } }
  const roles = [{ name: 'omd-agent-explore', tier: 'low' }, { name: 'omd-agent-planner', tier: 'high' }]
  const text = renderProtocol({ config, probeReport: probe, roles })
  for (const s of ['cancelomd', '什么是', '引号内', '回显块', '多关键词命中', 'team 无关键词触发',
    'leaf-guard', 'state_write', '互斥', '只能在主会话直接启动', '机械隐藏编排工具', '前台阻塞主会话', 'omd_delegate'])
    expect(text).toContain(s)
  expect(text).toMatch(/^\| \d+ \| ralph \| ralph \| explicit \|$/m)
  for (const s of ['## 模型路由表', '## 能力矩阵', '| core |', 'omd-agent-explore | low',
    'c5 team worktree 隔离', 'c6 run-state 镜像契约', 'c8 多仓锚定', 'team_write_tree_state'])
    expect(text).not.toContain(s)
  // native catalog 与全 ok probe 不再改变常驻协议正文。
  expect(renderProtocol({ config, probeReport: {}, roles: [] })).toBe(text)
})

test('MCP smoke 从 ok 变 failure 时静态协议前缀逐字节稳定', () => {
  const config = Config.parse({})
  const before = renderProtocol({ config, probeReport: { mcpServer: { status: 'ok' } }, roles: [] })
  const after = renderProtocol({ config, probeReport: { mcpServer: { status: 'failure', detail: 'x'.repeat(1000) } }, roles: [] })
  expect(after).toBe(before)
  expect(after).not.toContain('mcpServer')
  expect(after).not.toContain('降级公告')
  expect(Buffer.byteLength(after, 'utf8')).toBeLessThanOrEqual(7 * 1024)
})

test('S8-C1/C2：协议路由表注记 omd_delegate 硬路由语义（档位钳制+不可用 id 显式报错）', () => {
  const text = renderProtocol({ config: Config.parse({}), probeReport: {}, roles: [] })
  expect(text).toContain('omd_delegate')
  expect(text).toContain('不静默继承')
})

test('renderProtocol 是同步函数且完整渲染遵守 4–7KiB 总字节预算', () => {
  const roles = Array.from({ length: 33 }, (_, i) => ({ name: `omd-agent-${i}`, tier: 'high' }))
  const probeReport = { core: { status: 'failure', detail: 'x'.repeat(1000) } }
  const text = renderProtocol({ config: Config.parse({}), probeReport, roles })
  expect(typeof text).toBe('string')
  expect(Buffer.byteLength(text, 'utf8')).toBeGreaterThanOrEqual(4 * 1024)
  expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(7 * 1024)
})

test('终审修复 #1：状态契约的 MCP 伪调用是真实 schema 形状（cwd/sessionId 顶层必填、状态嵌套 state 键）', () => {
  const text = renderProtocol({ config: Config.parse({}), probeReport: {}, roles: [] })
  expect(text).toContain('cwd')
  expect(text).toContain('sessionId')
  expect(text).toContain('state: {')
  // 错误旧形状不得残留
  expect(text).not.toContain('{mode}-state.json')
})

test('一期 dsh-native：协议段工具引用统一带 omd_ 前缀（MCP 传输名已废除）', () => {
  const text = renderProtocol({ config: Config.parse({}), probeReport: {}, roles: [] })
  expect(text).toContain('omd_state_write')
  expect(text).toContain('omd_notepad_write_priority')
  // MCP wire 名不得残留；会话锚已自动派生，调用形状不再要求 cwd/sessionId 必填
  expect(text).not.toContain('mcp__omd-state__')
  expect(text).not.toContain('sessionId=当前会话 id')
})

test('终审修复 #3：协议段渲染 deep-interview 当前生效配置（模型无法读插件 Config）', () => {
  const text = renderProtocol({ config: Config.parse({}), probeReport: {}, roles: [] })
  expect(text).toContain('0.2')
  expect(text).toContain('10')
  expect(text).toContain('20')
  expect(text).toMatch(/deep-interview|deepInterview/)
  const custom = renderProtocol({ config: Config.parse({ deepInterview: { ambiguityThreshold: 0.7 } }), probeReport: {}, roles: [] })
  expect(custom).toContain('0.7')
})

test('终审修复 #4：状态契约含 get_goal 前置指引', () => {
  const text = renderProtocol({ config: Config.parse({}), probeReport: {}, roles: [] })
  expect(text).toMatch(/update_goal.*get_goal|get_goal.*update_goal/s)
})

test('c3 自适应路由段：4 特征+表钳制+1:1 日志+fallback 语义入协议（会话默认档跟随 Config）', () => {
  const text = renderProtocol({ config: Config.parse({}), probeReport: {}, roles: [] })
  expect(text).toContain('c3 自适应路由')
  expect(text).toContain('taskType=routine/standard/critical')
  expect(text).toContain('表上限权威')
  expect(text).toContain('禁止运行中重路由')
  expect(text).toContain('[routing] dispatch=<id>')
  expect(text).toContain('fallback 审计记入权威 run-state')
  expect(text).toContain('会话默认档 medium')
  const custom = renderProtocol({ config: Config.parse({ routing: { defaultTier: 'low' } }), probeReport: {}, roles: [] })
  expect(custom).toContain('会话默认档 low')
})

test('c2 关键词 hook 段：原生拦截点+预写状态+MAGIC KEYWORD 激活块+未命中直通入协议', () => {
  const text = renderProtocol({ config: Config.parse({}), probeReport: {}, roles: [] })
  expect(text).toContain('关键词 hook')
  expect(text).toContain('agent/pre-step')
  expect(text).toContain('[MAGIC KEYWORD')
  expect(text).toContain('零成本直通')
  expect(text).toContain('expectUpdatedAt=<注入块 updatedAt>')
})

test('team 技能承载 c5/c6/c8 与孤儿接管规则，双语正文均可独立执行', async () => {
  const { readFile } = await import('node:fs/promises')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
  const zh = await readFile(join(root, 'assets/skills/team/SKILL.zh.md'), 'utf8')
  const en = await readFile(join(root, 'assets/skills/team/SKILL.md'), 'utf8')
  for (const doc of [zh, en]) {
    for (const tool of ['team_begin', 'team_scan_orphans', 'team_dispose', 'team_cancel',
      'team_write_mirror', 'team_write_tree_state', 'team_phase_status', 'team_registry'])
      expect(doc).toContain(tool)
    expect(doc).toContain('expectUpdatedAt')
    expect(doc).toMatch(/orphan|孤儿/i)
    expect(doc).toMatch(/never auto-delete|绝不自动删树/)
    expect(doc).toMatch(/two-phase|两阶段/)
    expect(doc).toMatch(/CAS/)
    expect(doc).toMatch(/retry ≤3|重试 ≤3/)
    expect(doc).toMatch(/parent.*marker|父级.*marker/)
  }
  expect(zh).toContain('孤儿接管')
  expect(zh).toContain('确认无活跃队长')
  expect(en).toContain('Orphan takeover')
  expect(en).toContain('confirm no active lead')
})
