// tests/lib/mcp-smoke.test.js
// P0-W1-3：mcpServer 真冒烟——probe.js smokeMcpServer 三态（成功/超时/失败）+ index.js 接线（挂载/降级/兼容）。
import { test, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { smokeMcpServer } from '../../lib/probe.js'
import { setup, Config } from '../../lib/index.js'

// ---------- smokeMcpServer 三态（clientFactory 注入，绝不真 spawn） ----------

const okFactory = (count, detail) => async () => ({ smoke: 'ok', tools: count, ...(detail ? { detail } : {}) })

test('smoke ok：initialize+tools/list 通过，返回真实工具计数', async () => {
  const r = await smokeMcpServer({ clientFactory: async () => ({
    connect: async () => {},
    request: async () => ({ tools: Array.from({ length: 56 }, () => ({})) }),
    close: async () => {},
  }), timeoutMs: 1000 })
  expect(r.smoke).toBe('ok')
  expect(r.tools).toBe(56)
  expect(r.detail).toContain('56 个工具')
})

test('smoke 超时：server 不应答 → fail + tools=null + 超时 detail', async () => {
  const r = await smokeMcpServer({
    clientFactory: async () => ({
      connect: () => new Promise(() => {}),
      request: async () => { throw new Error('unreachable') },
      close: async () => {},
    }),
    timeoutMs: 80,
  })
  expect(r.smoke).toBe('fail')
  expect(r.tools).toBe(null)
  expect(r.detail).toContain('超时')
})

test('smoke 失败：connect 拒绝（spawn 失败等）→ fail + tools=null', async () => {
  const r = await smokeMcpServer({
    clientFactory: async () => ({
      connect: async () => { throw new Error('spawn ENOENT') },
      request: async () => { throw new Error('unreachable') },
      close: async () => {},
    }),
    timeoutMs: 1000,
  })
  expect(r.smoke).toBe('fail')
  expect(r.tools).toBe(null)
  expect(r.detail).toContain('spawn ENOENT')
})

test('smoke 失败：客户端构造抛错 → fail，smokeMcpServer 不抛出', async () => {
  const r = await smokeMcpServer({ clientFactory: async () => { throw new Error('bad factory') }, timeoutMs: 1000 })
  expect(r.smoke).toBe('fail')
  expect(r.tools).toBe(null)
  expect(r.detail).toContain('bad factory')
})

test('smoke ok 但应答畸形（tools 非数组）→ tools=null 不猜计数', async () => {
  const r = await smokeMcpServer({
    clientFactory: async () => ({ connect: async () => {}, request: async () => ({}), close: async () => {} }),
    timeoutMs: 1000,
  })
  expect(r.smoke).toBe('ok')
  expect(r.tools).toBe(null)
})

// ---------- 诊断：dsh-mcp-client 在 vitest 解析面是否可用（挂载前置条件） ----------

test('诊断：@deepseek-ai/dsh-mcp-client 可动态 import 且导出 cordis 插件形状', async () => {
  const mcp = await import('@deepseek-ai/dsh-mcp-client')
  expect(typeof mcp.name).toBe('string')
  expect(typeof mcp.apply).toBe('function')
  expect(Array.isArray(mcp.inject)).toBe(true)
})

// ---------- index.js 接线（fake ctx.plugin + opts.mcpSmoke 注入，沿 defineTool 注入先例） ----------

function mcpCtx() {
  const reg = { sections: [], contexts: [], skills: [], commands: [], tools: [], effects: [], plugins: [], logs: [] }
  return {
    reg,
    ctx: {
      systemPrompt: { section: (s) => reg.sections.push(s), context: (c) => reg.contexts.push(c) },
      skills: { register: (s) => reg.skills.push(s) },
      commands: { register: (c) => reg.commands.push(c) },
      tools: { register: (t) => reg.tools.push(t) },
      storage: { domain: { open: async () => ({ table: () => ({ get() {}, async put() {}, async delete() {} }), async close() {} }) } },
      effect: (fn) => reg.effects.push(fn),
      on: () => {},
      logger: { warn: (m) => reg.logs.push('warn: ' + String(m)), info: (m) => reg.logs.push('info: ' + String(m)), error: (m) => reg.logs.push('error: ' + String(m)) },
      plugin: async (p, cfg) => { reg.plugins.push({ name: p?.name, transport: cfg?.transport }) },
    },
  }
}

async function fixtureAssets() {
  const assetsRoot = await mkdtemp(join(tmpdir(), 'omd-smoke-'))
  await mkdir(join(assetsRoot, 'skills', 'x'), { recursive: true })
  await writeFile(join(assetsRoot, 'skills', 'x', 'SKILL.zh.md'), '---\nname: x\ndescription: d\n---\nbody\n')
  await mkdir(join(assetsRoot, 'agents'), { recursive: true })
  await writeFile(join(assetsRoot, 'agents', 'r.zh.md'), '---\nname: omd-agent-r\ndescription: d\ntier: low\n---\nrole\n')
  return assetsRoot
}

test('W1-3 接线：挂载 ok + 冒烟 ok → mcpServer={status:ok, smoke:ok, tools 真实计数}', async () => {
  const { ctx, reg } = mcpCtx()
  const assetsRoot = await fixtureAssets()
  const out = await setup(ctx, Config.parse({}), {
    assetsRoot,
    defineTool: (x) => x,
    mcpSmoke: okFactory(56, 'initialize+tools/list 冒烟通过（56 个工具）'),
  })
  expect(reg.plugins).toHaveLength(1)
  expect(out.probeReport.mcpServer.status).toBe('ok') // 挂载先行（冒烟不阻塞注册）
  await out.mcpSmokePromise
  expect(out.probeReport.mcpServer).toMatchObject({ status: 'ok', smoke: 'ok', tools: 56 })
})

test('W1-3 接线：挂载 ok + 冒烟 fail → status 降 failure（doctor 显红）+ 降级公告含 mcpServer', async () => {
  const { ctx, reg } = mcpCtx()
  const assetsRoot = await fixtureAssets()
  const out = await setup(ctx, Config.parse({}), {
    assetsRoot,
    defineTool: (x) => x,
    mcpSmoke: async () => ({ smoke: 'fail', tools: null, detail: '冒烟超时（>5000ms）——server 未在窗口内完成 initialize/tools-list' }),
  })
  await out.mcpSmokePromise
  expect(out.probeReport.mcpServer.status).toBe('failure')
  expect(out.probeReport.mcpServer.smoke).toBe('fail')
  expect(out.probeReport.mcpServer.tools).toBe(null)
  expect(out.probeReport.mcpServer.detail).toContain('挂载成功但冒烟失败')
  expect(out.probeReport.mcpServer.detail).toContain('冒烟超时')
  expect(reg.contexts[0].text()).toContain('mcpServer')
})

test('W1-3 兼容：挂载失败路径不跑冒烟 → 旧形态 { status: failure }，mcpSmokePromise=null', async () => {
  const { ctx, reg } = mcpCtx()
  delete ctx.plugin
  const assetsRoot = await fixtureAssets()
  const out = await setup(ctx, Config.parse({}), { assetsRoot, defineTool: (x) => x })
  expect(out.probeReport.mcpServer).toEqual({ status: 'failure' })
  expect(out.mcpSmokePromise).toBe(null)
})

test('W1-3 兼容：opts.mcpSmoke=null 显式关闭 → 旧形态 { status: ok } 不扩展', async () => {
  const { ctx, reg } = mcpCtx()
  const assetsRoot = await fixtureAssets()
  const out = await setup(ctx, Config.parse({}), { assetsRoot, defineTool: (x) => x, mcpSmoke: null })
  expect(out.probeReport.mcpServer).toEqual({ status: 'ok' })
  expect(out.mcpSmokePromise).toBe(null)
})

test('超时后输掉竞速的 promise reject 不得成为 unhandled rejection（宿主崩溃路径回归钉）', async () => {
  const factory = async () => ({
    connect: () => new Promise((_, rej) => setTimeout(() => rej(new Error('ConnectionClosed')), 120)),
    request: async () => { throw new Error('unreachable') },
    close: async () => {},
  })
  const r = await smokeMcpServer({ clientFactory: factory, timeoutMs: 50 })
  expect(r.smoke).toBe('fail')
  await new Promise(r2 => setTimeout(r2, 220)) // 给输掉的竞速时间 reject——无修复时此处触发进程级 unhandled rejection
})
