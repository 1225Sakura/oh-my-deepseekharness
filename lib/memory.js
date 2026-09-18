// lib/memory.js
import { createHash } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/**
 * 规格 §7-7 核验结论：ctx.storage 没有 get(ns,key)/set(ns,key,val)/delete(ns,key)。
 * 宿主真实模型是 Storage hub + domain 数据形态：
 *   ctx.storage.domain.open(spec) → Promise<Domain>
 *   domain.table(name) → { get(key) 同步读 / put(key,value) / delete(key)→boolean }
 * 隔离单位是「域名 + 表名 + 键」，无 namespace 参数；
 * 域名/表名须匹配 UNIT_NAME_RE（^[a-z][a-z0-9_]*$，故 'oh-my-dsh' 非法，用 oh_my_dsh）。
 */
export const MemoryDomain = defineDomain({
  name: 'oh_my_dsh',
  version: 0,
  tables: { memory: domainTable(z.string()) },
})

/** 项目路径 → 16 位哈希键（规格 §5.1；不泄露原始路径）。 */
export function projectKey(projectPath) {
  return createHash('sha256').update(String(projectPath)).digest('hex').slice(0, 16)
}

export function registerMemoryTools(ctx, defineTool) {
  const key = (a) => `${projectKey(a.projectPath)}:${a.key}`
  // 注册时打开域（幂等由宿主 already-open 约束）；execute 时 await 句柄。
  // 域句柄的生命周期归属调用方：index.js 总装时用 ctx.effect 注册 close（任务 14）。
  const opened = ctx.storage.domain.open(MemoryDomain)
  const table = async () => (await opened).table('memory')
  const out = {
    schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, value: { type: 'string' } } },
  }
  ctx.tools.register(defineTool({
    name: 'omd_memory_set',
    description: '写跨会话项目记忆（profile 层，按项目隔离）。',
    parameters: {
      projectPath: { type: 'string', required: true }, key: { type: 'string', required: true },
      value: { type: 'string', required: true },
    },
    output: out,
    async execute(args) { await (await table()).put(key(args), args.value); return { ok: true } },
  }))
  ctx.tools.register(defineTool({
    name: 'omd_memory_get',
    description: '读跨会话项目记忆。',
    parameters: { projectPath: { type: 'string', required: true }, key: { type: 'string', required: true } },
    output: out,
    async execute(args) {
      const v = (await table()).get(key(args))  // 同步读（宿主契约），缺席返回 undefined
      return v === undefined ? { ok: true } : { ok: true, value: v }  // 不返回 null（规格 §2 规范 3）
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
