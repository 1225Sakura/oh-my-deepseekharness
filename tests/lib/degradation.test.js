// tests/lib/degradation.test.js
// 计划任务 17 步骤 1：probe 各探测项降级路径回归防线。
// 矩阵：core/storage/mcpClient/hooksBridge × unavailable/failure/timeout。
// 注意 probe 的真实状态机（lib/probe.js）：
//   - core      只有 ok/failure（inject 四服务缺失 → failure），且 apply 在探测前先抛错（§6.1 例外条款）
//   - storage   ok/unavailable/failure/timeout 四态齐全（唯一有 timeout 的探测项）
//   - mcpClient / hooksBridge 只有 ok/unavailable（纯存在性检查，无 failure/timeout 分支）
import { test, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, Config } from '../../lib/index.js'
import { probeCapabilities, _resetCache } from '../../lib/probe.js'
import { renderProtocol } from '../../lib/protocol.js'

// mock 形状与 tests/lib/index.test.js 一致：宿主真实 API（§7-7 核验）
function mockCtx({ storage } = {}) {
  const reg = { sections: [], contexts: [], skills: [], commands: [], tools: [], effects: [] }
  const ctx = {
    systemPrompt: { section: (s) => reg.sections.push(s), context: (c) => reg.contexts.push(c) },
    skills: { register: (s) => reg.skills.push(s) },
    commands: { register: (c) => reg.commands.push(c) },
    tools: { register: (t) => reg.tools.push(t) },
    effect: (fn) => reg.effects.push(fn),
    on: () => {},
  }
  if (storage !== undefined) ctx.storage = storage
  // mcpClient / hooksBridge 有意缺席（unavailable 是它们唯一的降级态）
  return { ctx, reg }
}

// 最小资产 fixture（同 index.test.js）：1 skill + 1 角色
async function makeAssets() {
  const assetsRoot = await mkdtemp(join(tmpdir(), 'omd-deg-'))
  await mkdir(join(assetsRoot, 'skills', 'x'), { recursive: true })
  await writeFile(join(assetsRoot, 'skills', 'x', 'SKILL.zh.md'), '---\nname: x\ndescription: d\n---\nbody\n')
  await mkdir(join(assetsRoot, 'agents'), { recursive: true })
  await writeFile(join(assetsRoot, 'agents', 'r.zh.md'), '---\nname: omd-agent-r\ndescription: d\ntier: low\n---\nrole\n')
  return assetsRoot
}

const OPTS = () => ({ defineTool: (x) => x })

/** apply 后取协议 section 文本（renderProtocol 的输出载体）。 */
function protocolText(reg) {
  expect(reg.sections).toHaveLength(1)
  return reg.sections[0].text()
}

beforeEach(() => _resetCache())   // probe 有模块级缓存，每个用例独立探测

// ---------- core ----------
// §6.1 例外条款：核心 inject 服务缺失时插件无法工作，apply 必须启动即报错——
// 与其他探测项的「不崩+降级」语义相反，这是有意设计。

test('core 缺 systemPrompt：apply 抛错（§6.1 例外条款，断言语义相反）', async () => {
  const { ctx } = mockCtx()
  delete ctx.systemPrompt
  await expect(apply(ctx, Config.parse({}), { assetsRoot: '/nonexistent', ...OPTS() }))
    .rejects.toThrow(/systemPrompt/)
})

test('core failure 时 renderProtocol 输出对应降级行', () => {
  const report = {
    core: { status: 'failure', detail: '核心 inject 服务缺失，插件无法工作' },
    storage: { status: 'ok' }, mcpClient: { status: 'ok' }, hooksBridge: { status: 'ok' },
  }
  const text = renderProtocol({ config: Config.parse({}), probeReport: report, roles: [{ name: 'omd-agent-r', tier: 'low' }] })
  expect(text).toContain('| core | failure |')
})

// ---------- storage ----------

test('storage unavailable：apply 不崩，协议含降级行 + 运行时降级公告', async () => {
  const { ctx, reg } = mockCtx({ storage: undefined })
  await apply(ctx, Config.parse({}), { assetsRoot: await makeAssets(), ...OPTS() })
  expect(protocolText(reg)).toContain('| storage | unavailable |')
  // §4 动态 context 的降级公告同步反映
  expect(reg.contexts[0].text()).toContain('storage')
  // storage 缺席时不注册记忆工具
  expect(reg.tools).toHaveLength(0)
})

// ⚠️ 已知真实 bug（任务 17 步骤 1 暴露，如实记录而非绕过）：
// lib/index.js:85 用 `if (ctx.storage)`（存在性）门控 registerMemoryTools，而非 probe 结论
// （report.storage.status === 'ok'）。storage 处于 failure 态（domain 缺失/抛错/非 domain API
// 形态）时，lib/memory.js:29 的 ctx.storage.domain.open(MemoryDomain) 必同步抛错 → apply 崩溃，
// 与规格 §6.1「可选服务降级不阻断插件」矛盾。修复方向：门控改为 probe 通过才注册记忆工具。
// test.fails：当前因 bug 按预期失败；bug 修复后本测试翻红，届时去掉 .fails 转正。
test.fails('storage failure（domain 访问抛错）：apply 不崩，协议含 failure 行', async () => {
  const { ctx, reg } = mockCtx({ storage: { get domain() { throw new Error('backend down') } } })
  await apply(ctx, Config.parse({}), { assetsRoot: await makeAssets(), ...OPTS() })
  expect(protocolText(reg)).toContain('| storage | failure |')
})

// bug 现状快照（bug 修复后应删除）：apply 当前在记忆工具注册处崩溃，而非降级
test('storage failure 现状：apply 在 registerMemoryTools 处崩溃（已知 bug 快照）', async () => {
  const { ctx } = mockCtx({ storage: { get domain() { throw new Error('backend down') } } })
  await expect(apply(ctx, Config.parse({}), { assetsRoot: await makeAssets(), ...OPTS() }))
    .rejects.toThrow('backend down')
})

test('storage timeout：探测超时归 timeout 态，apply 不崩，协议含 timeout 行', async () => {
  // domain 是永不 resolve 的 thenable，但带可用 open()——探测 await 挂起 → timeout；
  // open 附着其上是为了 apply 后续的记忆工具注册（lib/memory.js 同步调 domain.open）不崩。
  const hanging = new Promise(() => {})
  hanging.open = async () => ({ table: () => ({ get() {}, async put() {}, async delete() {} }), async close() {} })
  const storage = { get domain() { return hanging } }
  // 先用小超时播种 probe 缓存（apply 内 probeCapabilities 不传 timeoutMs，默认 3s 太慢）
  const report = await probeCapabilities(mockCtx({ storage }).ctx, { timeoutMs: 50 })
  expect(report.storage.status).toBe('timeout')

  const { ctx, reg } = mockCtx({ storage })
  await apply(ctx, Config.parse({}), { assetsRoot: await makeAssets(), ...OPTS() })  // 命中缓存，不再等 3s
  expect(protocolText(reg)).toContain('| storage | timeout |')
})

// ---------- mcpClient / hooksBridge ----------
// 二者是纯存在性检查（probe.js L54-57）：只有 ok/unavailable，无 failure/timeout 分支可构造。

test('mcpClient unavailable：apply 不崩，协议含 unavailable 行', async () => {
  const { ctx, reg } = mockCtx({ storage: undefined })
  await apply(ctx, Config.parse({}), { assetsRoot: await makeAssets(), ...OPTS() })
  expect(protocolText(reg)).toContain('| mcpClient | unavailable |')
})

test('hooksBridge unavailable：apply 不崩，协议含 unavailable 行', async () => {
  const { ctx, reg } = mockCtx({ storage: undefined })
  await apply(ctx, Config.parse({}), { assetsRoot: await makeAssets(), ...OPTS() })
  expect(protocolText(reg)).toContain('| hooksBridge | unavailable |')
})

test('mcpClient/hooksBridge 可用时归 ok（存在性检查，不做深度实测）', async () => {
  const { ctx } = mockCtx({ storage: undefined })
  ctx.mcpClient = {}
  ctx.hooks = {}
  const report = await probeCapabilities(ctx)
  expect(report.mcpClient.status).toBe('ok')
  expect(report.hooksBridge.status).toBe('ok')
})

// ---------- 附带防线：mock ctx 无 ctx.plugin，MCP 挂载失败须降级为 mcpServer failure 而非崩溃 ----------
//（与 index.test.js 的隐含行为一致，这里显式断言——import 失败走同一条 catch）

test('MCP server 挂载失败不阻断 apply：能力矩阵追加 mcpServer failure 行', async () => {
  const { ctx, reg } = mockCtx({ storage: undefined })
  const { probeReport } = await apply(ctx, Config.parse({}), { assetsRoot: await makeAssets(), ...OPTS() })
  expect(probeReport.mcpServer.status).toBe('failure')
  expect(protocolText(reg)).toContain('| mcpServer | failure |')
})
