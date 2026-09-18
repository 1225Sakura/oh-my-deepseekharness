// tests/lib/memory.test.js
import { test, expect } from 'vitest'
import { registerMemoryTools, projectKey } from '../../lib/memory.js'

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
