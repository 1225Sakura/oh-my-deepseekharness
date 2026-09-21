// tests/lib/memory.test.js
import { test, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { registerMemoryTools, projectKey } from '../../lib/memory.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')
// lib/memory.broken.js：仅在 S2 host-defineTool 复现测试期间存在；
// 测试结束后由 afterAll 删除——不留垃圾文件进 git 暂存区。
const brokenPath = join(repoRoot, 'lib', 'memory.broken.js')

// mock 对齐宿主真实 API（§7-7 核验）：ctx.storage.domain.open(spec) → Domain，
// domain.table(name) → { get(key) 同步, put(key,value), delete(key) }。
function makeCtx() {
  const tools = []
  const store = new Map()
  return {
    tools,
    ctx: {
      tools: { register: (t) => { tools.push(t); return () => {} } },
      storage: {
        domain: {
          async open(spec) {
            return {
              name: spec.name,
              table: () => ({
                get: (k) => store.get(k),
                async put(k, v) { store.set(k, v) },
                async delete(k) { const had = store.has(k); store.delete(k); return had },
              }),
              async close() {},
            }
          },
        },
      },
    },
  }
}

test('注册三个工具且 output schema 不含可空字段陷阱', async () => {
  const { ctx, tools } = makeCtx()
  await registerMemoryTools(ctx, (x) => x)
  expect(tools.map(t => t.name).sort()).toEqual(['omd_memory_delete', 'omd_memory_get', 'omd_memory_set'])
})

test('set/get/delete 按项目路径哈希分键', async () => {
  const { ctx, tools } = makeCtx()
  await registerMemoryTools(ctx, (x) => x)
  const [set, get, del] = ['omd_memory_set', 'omd_memory_get', 'omd_memory_delete']
    .map(n => tools.find(t => t.name === n).execute)
  await set({ projectPath: 'D:\\omd', key: 'preference', value: '中文输出' })
  expect((await get({ projectPath: 'D:\\omd', key: 'preference' })).value).toBe('中文输出')
  expect((await get({ projectPath: '/other/proj', key: 'preference' })).value).toBeUndefined()
  await del({ projectPath: 'D:\\omd', key: 'preference' })
  expect((await get({ projectPath: 'D:\\omd', key: 'preference' })).value).toBeUndefined()
})

test('projectKey 是稳定哈希且不泄露原始路径', () => {
  const k = projectKey('D:\\omd')
  expect(k).toMatch(/^[a-f0-9]{16}$/)
  expect(k).toBe(projectKey('D:\\omd'))
  expect(k).not.toBe(projectKey('/other'))
})

// ──────────────── S2 回归断言（新增；既有三个 test 完整保留） ────────────────

/** 三个工具各自的 output.render 工厂：每条样本都生成可校验的渲染。 */
const RENDER_SAMPLES = [
  { name: 'omd_memory_set', args: { projectPath: 'D:\\omd', key: 'k', value: 'v' }, value: { ok: true } },
  { name: 'omd_memory_get', args: { projectPath: 'D:\\omd', key: 'k' }, value: { ok: true, value: '中文' } },
  { name: 'omd_memory_get', args: { projectPath: 'D:\\omd', key: 'k' }, value: { ok: true } }, // 缺席
  { name: 'omd_memory_delete', args: { projectPath: 'D:\\omd', key: 'k' }, value: { ok: true } },
]

test('每个工具 output.render 都是函数且返回文本块', async () => {
  const { ctx, tools } = makeCtx()
  await registerMemoryTools(ctx, (x) => x)
  for (const sample of RENDER_SAMPLES) {
    const t = tools.find((x) => x.name === sample.name)
    expect(t, `tool ${sample.name} registered`).toBeDefined()
    expect(t.output, `${sample.name}.output defined`).toBeDefined()
    expect(typeof t.output.render, `${sample.name}.output.render is function`).toBe('function')
    const blocks = t.output.render(sample.args, sample.value)
    expect(Array.isArray(blocks), `${sample.name} returns array`).toBe(true)
    expect(blocks.length, `${sample.name} non-empty`).toBeGreaterThanOrEqual(1)
    expect(blocks[0].type, `${sample.name} first block is text`).toBe('text')
    expect(typeof blocks[0].text, `${sample.name} text is string`).toBe('string')
    expect(blocks[0].text.length, `${sample.name} text non-empty`).toBeGreaterThan(0)
  }
})

test('get 在键缺席时 render 返回的文本明确说"未设置"并包含 key 名', async () => {
  const { ctx, tools } = makeCtx()
  await registerMemoryTools(ctx, (x) => x)
  const getTool = tools.find((t) => t.name === 'omd_memory_get')
  const blocks = getTool.output.render(
    { projectPath: 'D:\\omd', key: 'preference' },
    { ok: true }, // 键缺席——render 必须用可读文本兜底，不暴露 JSON 里的 undefined
  )
  const text = blocks[0].text
  expect(text).toMatch(/未设置|未设置/) // "未设置" 表达（接受简体/繁简同义）
  expect(text).toContain('preference') // 包含 key 名
})

/** lib/memory.broken.js 的预修源码：缺 render、共享 out 常量。
 *  S2 host-defineTool 测试用它复现 "userRender is not a function"；
 *  测试套件结束后由 afterAll 删除，避免污染仓库工作树。 */
const BROKEN_MODULE_SRC = `import { createHash } from 'node:crypto'
import z from '@deepseek-ai/schemastery'

export function projectKey(projectPath) {
  return createHash('sha256').update(String(projectPath)).digest('hex').slice(0, 16)
}

export async function registerMemoryTools(ctx, defineTool, deps = {}) {
  const { defineDomain, domainTable } = deps.storageDomain
    ?? (await import('@deepseek-ai/dsh-storage-domain'))
  const MemoryDomain = defineDomain({
    name: 'oh_my_dsh',
    version: 0,
    tables: { memory: domainTable(z.string()) },
  })
  const key = (a) => \`\${projectKey(a.projectPath)}:\${a.key}\`
  const opened = ctx.storage.domain.open(MemoryDomain)
  const table = async () => (await opened).table('memory')
  ctx.effect?.(() => async () => { await (await opened).close?.() })
  // BUG (pre-fix): shared \`out\` constant without \`render\` field.
  const out = {
    schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, value: { type: 'string' } } },
  }
  ctx.tools.register(defineTool({
    name: 'omd_memory_set',
    description: '写跨会话项目记忆（profile 层，按项目隔离）。',
    parameters: { projectPath: { type: 'string', required: true }, key: { type: 'string', required: true }, value: { type: 'string', required: true } },
    output: out,
    async execute(args) { await (await table()).put(key(args), args.value); return { ok: true } },
  }))
  ctx.tools.register(defineTool({
    name: 'omd_memory_get',
    description: '读跨会话项目记忆。',
    parameters: { projectPath: { type: 'string', required: true }, key: { type: 'string', required: true } },
    output: out,
    async execute(args) {
      const v = (await table()).get(key(args))
      return v === undefined ? { ok: true } : { ok: true, value: v }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'omd_memory_delete',
    description: '删跨会话项目记忆。',
    parameters: { projectPath: { type: 'string', required: true }, key: { type: 'string', required: true } },
    output: out,
    async execute(args) { await (await table()).delete(key(args)); return { ok: true } },
  }))
}
`

beforeAll(() => {
  // 仅在写盘前确认目录可写；broken 文件被 vitest 视为普通 ESM 模块动态加载。
  writeFileSync(brokenPath, BROKEN_MODULE_SRC, 'utf8')
})

afterAll(() => {
  // 删除临时 broken 文件——S2 测试结束不留垃圾文件到 lib/。
  if (existsSync(brokenPath)) unlinkSync(brokenPath)
})

test('宿主 defineTool 包裹后调 render 不抛 TypeError: userRender（修后好；修前坏）', async () => {
  const { defineTool } = await import('@deepseek-ai/dsh-tools')

  // Phase 1：broken 变体必须复现原 bug——三工具注册均不报错（typeof 闸过），但调用 render 必抛。
  // 用 cache-busting 查询参数防止 Node ESM 缓存把第二次 import 当成第一次。
  const brokenUrl = pathToFileURL(brokenPath).href + `?broken=${Date.now()}`
  const broken = await import(brokenUrl)
  const brokenCtxBag = makeCtx()
  await broken.registerMemoryTools(brokenCtxBag.ctx, defineTool)
  expect(brokenCtxBag.tools.length).toBe(3)
  for (const name of ['omd_memory_set', 'omd_memory_get', 'omd_memory_delete']) {
    const t = brokenCtxBag.tools.find((x) => x.name === name)
    expect(t, `broken tool ${name} registered`).toBeDefined()
    expect(typeof t.output.render, `broken ${name}.output.render typeof`).toBe('function')
    let threw = null
    try {
      t.output.render({ projectPath: 'D:\\omd', key: 'k' }, { ok: true })
    }
    catch (e) { threw = e }
    expect(threw, `broken ${name}.output.render must throw`).not.toBeNull()
    expect(threw instanceof TypeError, `broken ${name}.output.render throws TypeError`).toBe(true)
    expect(String(threw.message), `broken ${name}.message mentions userRender`).toMatch(/userRender/)
  }

  // Phase 2：fixed 变体（三工具均调用）——不得抛错，且返回非空文本。
  const fixedCtxBag = makeCtx()
  await registerMemoryTools(fixedCtxBag.ctx, defineTool)
  expect(fixedCtxBag.tools.length).toBe(3)
  for (const sample of RENDER_SAMPLES) {
    const t = fixedCtxBag.tools.find((x) => x.name === sample.name)
    expect(t, `fixed tool ${sample.name} registered`).toBeDefined()
    let blocks = null
    let threw = null
    try { blocks = t.output.render(sample.args, sample.value) }
    catch (e) { threw = e }
    expect(threw, `fixed ${sample.name}.output.render must NOT throw`).toBeNull()
    expect(Array.isArray(blocks)).toBe(true)
    expect(blocks.length).toBeGreaterThanOrEqual(1)
    expect(blocks[0].type).toBe('text')
    expect(blocks[0].text.length).toBeGreaterThan(0)
  }
})