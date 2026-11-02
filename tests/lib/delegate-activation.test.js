// tests/lib/delegate-activation.test.js
// startActivation 调用面单测（ralplan-dsh-021-compat D4 A1-A6；stub 形状锚宿主
// dsh-subagent@0.2.1-rc.5：startActivation({provider,label,request,signal,delivery})→
// {childId,result,dispose}，出处 types/types.d.ts:25-38；resolveMaxDepth 出处 index.d.ts:129）。
import { test, expect } from 'vitest'
import { Config } from '../../lib/config.js'
import { DELEGATE_PROVIDER, registerDelegateTool } from '../../lib/delegate.js'

const VALID_ROUTES = [{ provider: 'glm', model: 'glm-5.3-flash' }]

function makeActivationFakes({ childText = 'OK-DELEGATE', stopReason = 'completed', diagnostic, resultError, disposeError, startError, withResolveMaxDepth = true } = {}) {
  const calls = { preflight: [], activation: [], disposed: 0 }
  const llm = {
    async resolveCallConfig(config) {
      calls.preflight.push(config)
      if (!VALID_ROUTES.some(r => r.provider === config.provider && r.model === config.model))
        throw new Error(`model "${config.provider}/${config.model}" is not resolvable`)
      return config
    },
  }
  const subagents = {
    getProvider: name => name === DELEGATE_PROVIDER ? { name } : undefined,
    list: () => [DELEGATE_PROVIDER],
    ...(withResolveMaxDepth ? { resolveMaxDepth: v => (v === undefined ? 1 : v) } : {}),
    async startActivation(spec) {
      calls.activation.push(spec)
      if (startError) throw startError
      return {
        childId: 'child-1',
        result: resultError
          ? Promise.reject(resultError)
          : Promise.resolve({ output: [{ type: 'text', text: childText }], stopReason, ...(diagnostic ? { diagnostic } : {}) }),
        dispose: async () => { calls.disposed++; if (disposeError) throw disposeError },
      }
    },
  }
  const parent = {
    session: { requestHeader: () => ({ config: { provider: 'glm', model: 'glm-5.3-flash', reasoningEffort: 'high' } }) },
    options: {},
  }
  return { calls, llm, subagents, parent }
}

async function setupTool(fakeOpts = {}) {
  const fakes = makeActivationFakes(fakeOpts)
  const events = []
  let captured
  const ctx = { tools: { register(def) { captured = def } }, logger: { info() {}, warn() {} } }
  await registerDelegateTool(ctx, def => def, {
    config: Config.parse({}),
    roles: [{ name: 'omd-agent-explore', tier: 'low' }],
    subagents: fakes.subagents,
    llm: fakes.llm,
    recordRouteEvent: async e => { events.push(e) },
  })
  return { ...fakes, def: captured, events }
}

const EXEC_ARGS = { description: '探针', prompt: '只输出 OK-DELEGATE', model: 'glm-5.3-flash' }

test('A1：spec 全字段精确形状（provider/label 顶层/content-blocks/parent 同一引用/agentOptions/maxDepth/delivery/signal；request 内无 label/signal）', async () => {
  const { def, calls, parent } = await setupTool()
  const out = await def.execute(EXEC_ARGS, { agent: parent })
  expect(out.ok).toBe(true)
  expect(calls.activation).toHaveLength(1)
  const spec = calls.activation[0]
  expect(spec.provider).toBe('spawn')
  expect(spec.label).toBe('探针')
  expect(spec.delivery).toBe('caller')
  expect(spec.request.prompt).toEqual([{ type: 'text', text: '只输出 OK-DELEGATE' }])
  expect(spec.request.parent).toBe(parent) // exact live 同一引用（:3045 恒等校验）
  expect(spec.request.agentOptions).toEqual({ provider: 'glm', model: 'glm-5.3-flash' })
  expect(spec.request.maxDepth).toBe(1)
  expect(spec.request).not.toHaveProperty('label')
  expect(spec.request).not.toHaveProperty('signal')
  expect(spec.signal).toBeInstanceOf(AbortSignal)
})

test('A2：activation.result reject → 执行失败前缀 + dispose 恰一次', async () => {
  const { def, calls, parent } = await setupTool({ resultError: new Error('CONTINUATION_UNAVAILABLE: child lost') })
  await expect(def.execute(EXEC_ARGS, { agent: parent }))
    .rejects.toThrow(/^omd_delegate: 子代理执行失败: CONTINUATION_UNAVAILABLE: child lost$/)
  expect(calls.disposed).toBe(1)
})

test('A3：dispose 失败不吞子代理结果', async () => {
  const { def, calls, parent } = await setupTool({ disposeError: new Error('teardown boom') })
  const out = await def.execute(EXEC_ARGS, { agent: parent })
  expect(out.ok).toBe(true)
  expect(out.text).toBe('OK-DELEGATE')
  expect(calls.disposed).toBe(1)
})

test('A4：stopReason≠completed → 既有 diagnostic 呈面语义不变', async () => {
  const { def, parent } = await setupTool({ stopReason: 'error', diagnostic: 'child route rejected' })
  await expect(def.execute(EXEC_ARGS, { agent: parent }))
    .rejects.toThrow(/子代理异常结束 stopReason=error；diagnostic=child route rejected/)
})

test('A5：resolveMaxDepth 缺席（0.1.2/0.1.5 线形状）→ request 省略 maxDepth', async () => {
  const { def, calls, parent } = await setupTool({ withResolveMaxDepth: false })
  const out = await def.execute(EXEC_ARGS, { agent: parent })
  expect(out.ok).toBe(true)
  expect(calls.activation[0].request).not.toHaveProperty('maxDepth')
})

test('A6：startActivation reject → 启动失败前缀 + 原文透传（(a)-(d) 可判别）', async () => {
  const { def, parent } = await setupTool({ startError: new Error('UNAUTHORIZED: exact live parent required') })
  await expect(def.execute(EXEC_ARGS, { agent: parent }))
    .rejects.toThrow(/^omd_delegate: 子代理启动失败（startActivation）: UNAUTHORIZED: exact live parent required$/)
})

test('A7：exec.signal 缺席时 signal 兜底为 AbortController（spec 必填契约）', async () => {
  const { def, calls, parent } = await setupTool()
  await def.execute(EXEC_ARGS, { agent: parent }) // 无 signal 的 exec
  expect(calls.activation[0].signal).toBeInstanceOf(AbortSignal)
})
