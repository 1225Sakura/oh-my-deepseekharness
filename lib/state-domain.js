// lib/state-domain.js
// 二期 dsh-native ②：mode-state 从 .omd JSON 文件迁宿主 storageDomain（用户已授权放弃
// .omd 跨 CLI 兼容）。官方契约（docs/subsystems/storage.md + 实机 inspect）：
//   - defineDomain({name(UNIT_NAME_RE 小写), version, tables}) → ctx.storage.domain.open(spec)
//   - table: get/keys 同步内存权威态；put/delete 排每域单写链（落盘→内存→domain/changed）
//   - close() 必须挂消费方自己的 ctx.effect（memory.js 同款纪律）
// 键空间：`${projectKey(cwd)}:${mode}:${sessionId}`（projectKey=sha256 前 16 hex，复用
// lib/memory.js 单源）——所有权扫描/跨会话清单都以 cwdHash(:mode) 前缀命中。
// 并发语义：域写链只串行单个 put/delete；makeStateTools 的「扫描-supersede-CAS-写」
// read-modify-write 序列跨多个 await，需应用级互斥——serialized() 按域键排队，
// 同进程零依赖（旧文件锁的存在理由「跨进程」已随子进程消失）。
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { projectKey } from './memory.js'

/** mode-state 值形状：用户自由字段 + _meta（record(any) 加载期 parse 任何对象）。 */
const StateValue = z.record(z.any())

export const OmdStateDomain = defineDomain({
  name: 'oh_my_dsh_state',
  version: 0,
  tables: { state: domainTable(StateValue) },
})

/** 打开 mode-state 域并返回 state 表；close 挂 ctx.effect（插件重放/卸载即释放句柄）。 */
export async function openStateDomain(ctx) {
  const opened = ctx.storage.domain.open(OmdStateDomain)
  ctx.effect?.(() => async () => { await (await opened).close?.() })
  const domain = await opened
  return domain.table('state')
}

/** mode-state 键（单一来源：makeStateTools 与扫描面共用同一拼装）。 */
export function stateKey(cwd, mode, sessionId) {
  return `${projectKey(cwd)}:${mode}:${sessionId}`
}

// G6 域安全（原 paths.mjs SAFE_ID 语义平移）：sessionId/mode 进键空间，':' 可伪造键前缀
// 碰撞（冒名他会话）——键拼装前置同一白名单校验，文案与旧 SAFE_ID 保持可判别。
const SAFE_ID = /^[A-Za-z0-9_-]+$/
export function assertSafeKeyId(kind, value) {
  if (!SAFE_ID.test(value ?? '')) throw new Error(`unsafe ${kind}: ${String(value)}`)
}

/** mode-state 扫描前缀：同 cwd 同 mode 的全部会话键（所有权扫描面）。 */
export function stateModePrefix(cwd, mode) {
  return `${projectKey(cwd)}:${mode}:`
}

/** mode-state 扫描前缀：同 cwd 全部键（list_active/scan_all 聚合面）。 */
export function stateCwdPrefix(cwd) {
  return `${projectKey(cwd)}:`
}

const queues = new Map()
/** 同进程应用级互斥：read-modify-write 序列按域键排队（旧文件锁的进程内继任者）。 */
export function serialized(queueKey, fn) {
  const prev = queues.get(queueKey) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(fn)
  queues.set(queueKey, next)
  return next
}
