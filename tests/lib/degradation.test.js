// tests/lib/degradation.test.js
// 计划任务 17 步骤 1：probe 各探测项降级路径回归防线。
// 矩阵（2026-10-26 审查后）：core/storage × unavailable/failure/timeout。
// 注意 probe 的真实状态机（lib/probe.js）：
//   - core      只有 ok/failure（CORE_SERVICES 缺失 → failure），且 apply 在探测前先抛错（§6.1 例外条款）
//   - storage   ok/unavailable/failure/timeout 四态齐全（唯一有 timeout 的探测项；storage 已进 inject，缺失仍降级）
//   - hooksBridge 探测残件已移除（宿主无 ctx.hooks 服务，构造性恒 unavailable 纯噪音）
//   - mcpClient 探测行已删除（服务不存在，固有假阴性）；MCP 真实信号是 probeReport.mcpServer
//   - skills    资产零加载/目录不可读 → failure（2026-10-26 审查 S4：原 catch{} 静默已修）
import { test, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, setup, Config } from '../../lib/index.js'
import { probeCapabilities, _resetCache } from '../../lib/probe.js'

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

// ---------- storage ----------

test('storage unavailable：apply 不崩，运行时降级公告可见（状态工具不受影响）', async () => {
  const { ctx, reg } = mockCtx({ storage: undefined })
  await apply(ctx, Config.parse({}), { assetsRoot: await makeAssets(), ...OPTS() })
  // §4 动态 context 的降级公告同步反映
  expect(reg.contexts[0].text()).toContain('storage')
  // storage 缺席时不注册记忆工具；58 个状态面工具进程内直注册与 storage 无关（一期 dsh-native）
  expect(reg.tools.filter(t => t.name.startsWith('omd_memory_'))).toHaveLength(0)
  expect(reg.tools).toHaveLength(58)
})

// storage failure 降级（bug 已修复：门控改为 probeReport.storage.status === 'ok'，
// storage 处于 failure 态时跳过记忆工具注册，apply 降级不崩）。
test('storage failure（domain 访问抛错）：apply 不崩，运行时公告且记忆工具不注册', async () => {
  const { ctx, reg } = mockCtx({ storage: { get domain() { throw new Error('backend down') } } })
  await apply(ctx, Config.parse({}), { assetsRoot: await makeAssets(), ...OPTS() })
  expect(reg.contexts[0].text()).toContain('storage')
  // failure 态不注册记忆工具；状态工具与 storage 无关照常注册
  expect(reg.tools.filter(t => t.name.startsWith('omd_memory_'))).toHaveLength(0)
  expect(reg.tools).toHaveLength(58)
})

test('storage timeout：探测超时归 timeout 态，apply 不崩且运行时公告', async () => {
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
  expect(reg.contexts[0].text()).toContain('storage')
})

// ---------- hooksBridge 残件移除（2026-10-26 审查 S4） ----------

test('hooksBridge 探测残件已移除：report 无该行，协议矩阵与降级公告均无', async () => {
  const { ctx, reg } = mockCtx({ storage: undefined })
  const report = await probeCapabilities(ctx)
  expect('hooksBridge' in report).toBe(false)
  expect('mcpClient' in report).toBe(false)   // M1.1：固有假阴性行已删
  await apply(ctx, Config.parse({}), { assetsRoot: await makeAssets(), ...OPTS() })
  expect(protocolText(reg)).not.toContain('hooksBridge')
})

// ---------- skills 资产加载可观测（2026-10-26 审查 S4：原 catch{} 静默零 skill 已修） ----------

test('skills 资产目录不可读：probeReport.skills=failure 且进运行时降级公告', async () => {
  const { ctx, reg } = mockCtx({ storage: undefined })
  const { probeReport } = await setup(ctx, Config.parse({}), { assetsRoot: '/nonexistent', ...OPTS() })
  expect(probeReport.skills.status).toBe('failure')
  expect(probeReport.skills.detail).toContain('目录不可读')
  expect(reg.contexts[0].text()).toContain('skills') // 降级公告可见（真降级，不静默）
})

test('skills 资产齐备：probeReport.skills=ok', async () => {
  const { ctx } = mockCtx({ storage: undefined })
  const { probeReport } = await setup(ctx, Config.parse({}), { assetsRoot: await makeAssets(), ...OPTS() })
  expect(probeReport.skills.status).toBe('ok')
})

test('stateTools ok 不进降级公告', async () => {
  const { ctx, reg } = mockCtx({ storage: undefined })
  const { probeReport } = await setup(ctx, Config.parse({}), { assetsRoot: await makeAssets(), ...OPTS() })
  // mock ctx 有 tools.register → 进程内注册恒成功（旧 mcpServer 挂载形态已废除）
  probeReport.stateTools = { status: 'ok', tools: 58 }
  const text = reg.contexts[0].text()
  expect(text).not.toContain('stateTools')
})

// ---------- 附带防线：进程内注册失败（如 defineTool 抛错）须降级为 stateTools failure 而非崩溃 ----------
//（一期 dsh-native：注册面即失败面，无子进程假绿灯形态）

test('状态工具注册失败不阻断 apply：probeReport 与运行时公告记录 failure', async () => {
  const { ctx, reg } = mockCtx({ storage: undefined })
  const { probeReport } = await setup(ctx, Config.parse({}), { assetsRoot: await makeAssets(), defineTool: () => { throw new Error('no dsh-tools') } })
  expect(probeReport.stateTools.status).toBe('failure')
  expect(probeReport.memoryTools.status).toBe('skipped') // storage 未注入 → 记忆工具走 skipped（与 defineTool 无关）
  expect(reg.contexts[0].text()).toContain('stateTools')
})
