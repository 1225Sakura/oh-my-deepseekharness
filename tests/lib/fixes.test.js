// tests/lib/fixes.test.js
// 终审修复的回归测试：B1（可选服务访问抛错）、M3（probe 缓存随 apply 重置）、
// B2（defineTool 失效降级）、H1（宿主包懒加载源码断言）。
import { test, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probeCapabilities, _resetCache } from '../../lib/probe.js'
import { apply, Config } from '../../lib/index.js'

beforeEach(() => _resetCache())

// ---------- B1：cordis 访问未 inject 服务会 throw，probe 必须归 unavailable 而不崩 ----------

test('B1: 可选服务属性访问抛错时 probe 归 unavailable 而不崩', async () => {
  const ctx = {
    tools: {}, skills: {}, systemPrompt: {}, commands: {},
    get storage() { throw new Error('cannot get property "storage" without inject') },
    get mcpClient() { throw new Error('cannot get property "mcpClient" without inject') },
    get hooks() { throw new Error('cannot get property "hooks" without inject') },
  }
  const report = await probeCapabilities(ctx)
  expect(report.core.status).toBe('ok')
  expect(report.storage.status).toBe('unavailable')
  expect(report.mcpClient.status).toBe('unavailable')
  expect(report.hooksBridge.status).toBe('unavailable')
})

// ---------- M3：cordis 重放（再次 apply）必须重新探测 ----------

async function makeAssets() {
  const assetsRoot = await mkdtemp(join(tmpdir(), 'omd-fix-'))
  await mkdir(join(assetsRoot, 'skills', 'x'), { recursive: true })
  await writeFile(join(assetsRoot, 'skills', 'x', 'SKILL.zh.md'), '---\nname: x\ndescription: d\n---\nbody\n')
  await mkdir(join(assetsRoot, 'agents'), { recursive: true })
  await writeFile(join(assetsRoot, 'agents', 'r.zh.md'), '---\nname: omd-agent-r\ndescription: d\ntier: low\n---\nrole\n')
  return assetsRoot
}

function mockFullCtx(counter = { accesses: 0 }) {
  const reg = { sections: [], contexts: [], skills: [], commands: [], tools: [] }
  const ctx = {
    systemPrompt: { section: (s) => reg.sections.push(s), context: (c) => reg.contexts.push(c) },
    skills: { register: (s) => reg.skills.push(s) },
    commands: { register: (c) => reg.commands.push(c) },
    tools: { register: (t) => reg.tools.push(t) },
    effect: () => {},
    on: () => {},
    storage: {
      get domain() { counter.accesses++; return { async open() { return { table: () => ({ get() {}, async put() {}, async delete() {} }), async close() {} } } } },
    },
  }
  return { ctx, reg }
}

test('M3: 两次 apply（cordis 重放）各自重新探测，不吃陈旧缓存', async () => {
  const counter = { accesses: 0 }
  const assetsRoot = await makeAssets()
  // 每次 apply 中 domain getter 被访问两次：probe 形态校验一次 + 记忆工具 open 一次。
  // 若第二次 apply 吃了陈旧 probe 缓存，总数会是 3 而不是 4。
  const first = mockFullCtx(counter)
  await apply(first.ctx, Config.parse({}), { assetsRoot, defineTool: (x) => x })
  expect(counter.accesses).toBe(2)
  const second = mockFullCtx(counter)
  await apply(second.ctx, Config.parse({}), { assetsRoot, defineTool: (x) => x })
  expect(counter.accesses).toBe(4)   // 缓存被 apply 入口重置，第二次重新探测
})

// ---------- B2：defineTool/记忆工具注册失效 → 降级而非崩溃 ----------

test('B2: defineTool 失效时 apply 不崩，memoryTools 归 failure，协议含降级行', async () => {
  const { ctx, reg } = mockFullCtx()
  const { probeReport } = await apply(ctx, Config.parse({}), {
    assetsRoot: await makeAssets(),
    defineTool: () => { throw new Error('no dsh-tools') },
  })
  expect(probeReport.memoryTools.status).toBe('failure')
  expect(probeReport.memoryTools.detail).toContain('no dsh-tools')
  expect(reg.tools).toHaveLength(0)
  expect(reg.sections[0].text()).toContain('| memoryTools | failure |')
})

test('storage 不可用时 memoryTools 归 skipped 且不注册工具', async () => {
  const { ctx, reg } = mockFullCtx()
  delete ctx.storage
  const { probeReport } = await apply(ctx, Config.parse({}), {
    assetsRoot: await makeAssets(), defineTool: (x) => x,
  })
  expect(probeReport.memoryTools.status).toBe('skipped')
  expect(reg.tools).toHaveLength(0)
})

// ---------- H1：宿主包不许顶层静态 import（缺席时 import 阶段崩，probe 没机会跑） ----------

test('H1: commands.js / memory.js 无宿主包顶层静态 import', async () => {
  for (const [file, pkg] of [
    ['../../lib/commands.js', '@deepseek-ai/dsh-llm'],
    ['../../lib/memory.js', '@deepseek-ai/dsh-storage-domain'],
  ]) {
    const src = await readFile(new URL(file, import.meta.url), 'utf8')
    const staticImport = new RegExp(`^import .* from '${pkg.replace('/', '\\/')}'`, 'm')
    expect(src, `${file} 不应顶层静态 import ${pkg}`).not.toMatch(staticImport)
  }
})
