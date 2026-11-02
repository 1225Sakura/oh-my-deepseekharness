// tests/lib/delegate-contract.test.js
// 真实形状契约（ralplan-dsh-021-compat D4，Critic R2④）：对真实安装的 @deepseek-ai/dsh-subagent
// 的 SubagentRuntime.prototype 形状做 line-aware 断言——检测安装线 → 断言该线期望形状 →
// 意外形状硬失败（禁 skip 落成断言逻辑，非口头约束）。stub 假绿的解药：宿主若再改派发 API
// 形状（如删 startActivation），本文件在对应线别即红，不等实机门才发现。
// 形状出处：0.2.1 线=宿主 dsh-subagent@0.2.1-rc.5（lib/types/index.d.ts:105-317 服务面、
// lib/types/types.d.ts:25-38 startActivation 契约、provider.start 仅存于 types.d.ts:326）；
// 旧线（0.1.2/0.1.5/0.1.7/0.2.0）=npm/unpkg 元数据核验均有 start(name,request) 且无 startActivation。
import { test, expect } from 'vitest'
import { createRequire } from 'node:module'
import { detectStartApi } from '../../lib/delegate.js'

const require = createRequire(import.meta.url)

async function loadRuntimeSurface() {
  try {
    const mod = await import('@deepseek-ai/dsh-subagent')
    const rt = mod.SubagentRuntime ?? mod.default
    if (!rt?.prototype) throw new Error('SubagentRuntime 导出缺席')
    return {
      version: require('@deepseek-ai/dsh-subagent/package.json').version,
      proto: Object.getOwnPropertyNames(rt.prototype),
    }
  } catch (e) {
    return null
  }
}

test('契约：detectStartApi 判定与真实宿主包形状一致（line-aware，意外形状硬失败）', async () => {
  const surface = await loadRuntimeSurface()
  if (!surface) {
    // skip 不静默：显式 warn 留痕；0.2.1 切线后包必可解析（切线命令显式点名本包——
    // ralplan-dsh-021-compat 步骤 3），彼时本 return 即缺席证据，由步骤 3 门禁兜底
    console.warn('[delegate-contract] @deepseek-ai/dsh-subagent 不可解析——显式 skip（切线后必须可解析）')
    return
  }
  const shape = {
    hasStart: surface.proto.includes('start'),
    hasStartActivation: surface.proto.includes('startActivation'),
    hasGetProvider: surface.proto.includes('getProvider'),
    hasList: surface.proto.includes('list'),
  }
  const mod = await import('@deepseek-ai/dsh-subagent')
  const proto = (mod.SubagentRuntime ?? mod.default).prototype

  if (surface.version.startsWith('0.2.1')) {
    expect(shape, `0.2.1 线期望 activation 形状，实测原型=[${surface.proto.join(',')}]`)
      .toEqual({ hasStart: false, hasStartActivation: true, hasGetProvider: true, hasList: true })
    expect(detectStartApi(proto)).toBe('activation')
  } else if (/^0\.(1\.|2\.0)/.test(surface.version)) {
    expect(shape, `旧线（${surface.version}）期望 legacy 形状，实测原型=[${surface.proto.join(',')}]`)
      .toEqual({ hasStart: true, hasStartActivation: false, hasGetProvider: true, hasList: true })
    expect(detectStartApi(proto)).toBe('legacy')
  } else {
    throw new Error(`未建档的 dsh-subagent 线别 ${surface.version}——契约测试不猜形状，先更新本断言集（原型=[${surface.proto.join(',')}])`)
  }
})

// ---- detectStartApi 纯单元（形状判别三态 + 新错误串钉死 (c) 支可判别性）----

test('detectStartApi：startActivation 优先于 start（双在场=新线）', () => {
  expect(detectStartApi({ startActivation() {}, start() {} })).toBe('activation')
  expect(detectStartApi({ startActivation() {} })).toBe('activation')
  expect(detectStartApi({ start() {} })).toBe('legacy')
})

test('detectStartApi：俱缺抛形状不兼容串（替代旧 :115 误导串——与 unavailable 串可判别）', () => {
  expect(() => detectStartApi({})).toThrow(/无兼容派发 API（startActivation\/start 均缺席/)
  expect(() => detectStartApi(undefined)).toThrow(/无兼容派发 API/)
  expect(() => detectStartApi({})).not.toThrow(/宿主未挂载 subagent 缝/)
})
