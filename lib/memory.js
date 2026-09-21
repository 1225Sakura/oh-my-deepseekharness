// lib/memory.js
import { createHash } from 'node:crypto'

/**
 * 规格 §7-7 核验结论：ctx.storage 没有 get(ns,key)/set(ns,key,val)/delete(ns,key)。
 * 宿主真实模型是 Storage hub + domain 数据形态：
 *   ctx.storage.domain.open(spec) → Promise<Domain>
 *   domain.table(name) → { get(key) 同步读 / put(key,value) / delete(key)→boolean }
 * 隔离单位是「域名 + 表名 + 键」，无 namespace 参数；
 * 域名/表名须匹配 UNIT_NAME_RE（^[a-z][a-z0-9_]*$，故 'oh-my-dsh' 非法，用 oh_my_dsh）。
 *
 * H1：@deepseek-ai/dsh-storage-domain 懒加载（参数注入或动态 import）——顶层静态 import
 * 在包缺席时会让插件在 import 阶段崩溃，probe/降级机制没机会跑。
 * schemastery 是非可选 peer（config.js 顶层就要用），可以静态 import。
 */
import z from '@deepseek-ai/schemastery'

/** 项目路径 → 16 位哈希键（规格 §5.1；不泄露原始路径）。 */
export function projectKey(projectPath) {
  return createHash('sha256').update(String(projectPath)).digest('hex').slice(0, 16)
}

/**
 * 输出 schema：宿主契约 `{ ok: boolean, value?: string }`，additionalProperties:false
 * 让 set/delete 返回的 `{ ok: true }` 与 get 缺席/命中两种形态都能合法落地。
 * 每次调用返回新对象——避免三个工具共享同一 schema 引用造成相互污染。
 */
function memoryOutputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: { ok: { type: 'boolean' }, value: { type: 'string' } },
  }
}

/**
 * 宿主 dsh-tools 的 defineTool（lib/types/schema.js:281）把 options.output.render
 * 捕获进闭包 userRender；注册时 typeof 闸看似过（tool.output.render 是函数），
 * 实际运行时调 tool.output.render(args, value) → userRender(args, value) →
 * userRender 为 undefined → 'userRender is not a function'。因此每个工具必须
 * 自带 render 工厂，且**各自**一份 output（不能三工具共用同一个对象，否则
 * 三份 defineTool 都会捕获同一份空 render 闭包）。
 *
 * 修复要点：
 *   ① 每工具一个工厂调用，得到独立的 output 对象；
 *   ② render 返回 ContentBlock[]（{type:'text', text:string}），不是裸对象；
 *   ③ get 在 key 缺席时返回可读文本，明确告诉模型该 key 当前未设置（并带 key 名）。
 */
/** set 工具：args + {ok:true} → 写入成功的确认文本。 */
function renderMemorySet(args, value) {
  if (!value || value.ok !== true) {
    return [{ type: 'text', text: `记忆写入失败：key=${args?.key ?? ''}` }]
  }
  return [{ type: 'text', text: `记忆已写入 key=${args.key}` }]
}

/** get 工具：args + {ok:true, value?} → value 文本 or "未设置" 提示。 */
function renderMemoryGet(args, value) {
  if (!value || value.ok !== true) {
    return [{ type: 'text', text: `记忆读取失败：key=${args?.key ?? ''}` }]
  }
  // §2 规范 3：键缺席时 execute 返回 {ok:true}（不返回 null），由 render 在此分支明示。
  if (value.value === undefined) {
    return [{ type: 'text', text: `key "${args.key}" 当前未设置任何内容` }]
  }
  return [{ type: 'text', text: value.value }]
}

/** delete 工具：args + {ok:true} → 删除成功的确认文本。 */
function renderMemoryDelete(args, value) {
  if (!value || value.ok !== true) {
    return [{ type: 'text', text: `记忆删除失败：key=${args?.key ?? ''}` }]
  }
  return [{ type: 'text', text: `已删除 key=${args.key}` }]
}

/**
 * @param ctx cordis 上下文（须含 tools + storage domain API）
 * @param defineTool 宿主 dsh-tools 的 defineTool（测试注入 identity）
 * @param deps.storageDomain 测试注入 { defineDomain, domainTable }；默认动态 import
 */
export async function registerMemoryTools(ctx, defineTool, deps = {}) {
  const { defineDomain, domainTable } = deps.storageDomain
    ?? (await import('@deepseek-ai/dsh-storage-domain'))
  const MemoryDomain = defineDomain({
    name: 'oh_my_dsh',
    version: 0,
    tables: { memory: domainTable(z.string()) },
  })
  const key = (a) => `${projectKey(a.projectPath)}:${a.key}`
  // 注册时打开域；execute 时 await 句柄。
  const opened = ctx.storage.domain.open(MemoryDomain)
  const table = async () => (await opened).table('memory')
  // 域句柄生命周期随插件 scope：cordis 配置变更会 dispose+重放插件（§7-9 核验），
  // effect dispose 允许 async（cordis effect 支持 thenable 返回值）。ctx.effect 缺席时静默跳过（测试 mock）。
  ctx.effect?.(() => async () => { await (await opened).close?.() })
  // 三工具各自一份 output（schema 工厂 + 专属 render）；不许再回到共享常量——
  // 共享会导致三份 defineTool 都捕获同一份 userRender 闭包、且任一被覆盖即污染。
  ctx.tools.register(defineTool({
    name: 'omd_memory_set',
    description: '写跨会话项目记忆（profile 层，按项目隔离）。',
    parameters: {
      projectPath: { type: 'string', required: true }, key: { type: 'string', required: true },
      value: { type: 'string', required: true },
    },
    output: { schema: memoryOutputSchema(), render: renderMemorySet },
    async execute(args) { await (await table()).put(key(args), args.value); return { ok: true } },
  }))
  ctx.tools.register(defineTool({
    name: 'omd_memory_get',
    description: '读跨会话项目记忆。',
    parameters: { projectPath: { type: 'string', required: true }, key: { type: 'string', required: true } },
    output: { schema: memoryOutputSchema(), render: renderMemoryGet },
    async execute(args) {
      const v = (await table()).get(key(args))  // 同步读（宿主契约），缺席返回 undefined
      return v === undefined ? { ok: true } : { ok: true, value: v }  // 不返回 null（规格 §2 规范 3）
    },
  }))
  ctx.tools.register(defineTool({
    name: 'omd_memory_delete',
    description: '删跨会话项目记忆。',
    parameters: { projectPath: { type: 'string', required: true }, key: { type: 'string', required: true } },
    output: { schema: memoryOutputSchema(), render: renderMemoryDelete },
    async execute(args) { await (await table()).delete(key(args)); return { ok: true } },
  }))
}