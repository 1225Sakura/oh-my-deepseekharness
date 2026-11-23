// lib/worktree.js
// run-state 原语层（二期③ team 领队运行时退役后余部，d0bc54f）：
// - runStatePath：run-state.json 权威路径（delegate fallback 审计写入 + HUD W4-1 镜像回退读）
// - monotonicIsoNow：CAS token 同毫秒单调递增（IC-23 实证防线）
// - withCrossProcessFileLock / withRunStateLock / casWriteRunState：跨进程 CAS 写原语
//   （run-state 审计面互斥；team worktree 隔离函数已随领队运行时退役）
import { mkdir, open, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteJson, readJson } from './state/lib/atomic.mjs'
import { assertSafeWorkspaceCwd as assertSafeCwd } from './cwd-guard.js'

/** run-state.json 权威路径（主仓 stateDir）。 */
export function runStatePath(cwd, stateDir = '.omd') {
  assertSafeCwd(cwd) // 直读面守卫（R2/R5 评审：hud readMirrorRunState / hud-route 均经此收口）
  return join(cwd, stateDir, 'state', 'run-state.json')
}

/**
 * 单调 ISO token（IC-23）：CAS token 单调严格递增——同毫秒双写时 toISOString() 串相同，
 * 「重打」即 no-op、旧 token 照样过 CAS（ABA 守门测试在 0.4.8 轮实测必现，IC-23 实证升格）。
 * prev 非法/缺席时按现状返回当前时间。
 */
export function monotonicIsoNow(prev) {
  const now = new Date().toISOString()
  if (Number.isFinite(Date.parse(prev)) && now <= prev) return new Date(Date.parse(prev) + 1).toISOString()
  return now
}

/**
 * 跨进程互斥锁（lockfile，open('wx') 原子创建=操作系统级 CAS 原语）。
 * 刻板审查修复（报告二：伪 CAS）——此前 casWriteRunState 的 读→校验→rename 跨进程
 * 是 check-then-act，双进程可持同一 expectUpdatedAt 双双通过校验后双写（后写静默覆盖）。
 * 现读-校验-写整体收进 lockfile 临界区；holder 崩溃遗留的 stale 锁（mtime > 60s）被接管删除。
 */
const LOCK_STALE_MS = 60_000
/** 通用跨进程文件锁（lockfile open('wx') 原子原语 + stale 接管）；R3-⑨ 泛化自 run-state 专用版。 */
export async function withCrossProcessFileLock(lockPath, fn) {
  await mkdir(join(lockPath, '..'), { recursive: true })
  let fh = null
  for (let i = 0; i < 200 && !fh; i++) {
    try { fh = await open(lockPath, 'wx') } // EEXIST=他人持有
    catch (e) {
      if (e.code !== 'EEXIST') throw e
      try { // stale 锁接管（holder 崩溃防线）
        const st = await stat(lockPath)
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) await rm(lockPath, { force: true })
      } catch { /* 竞态：他人已释放/接管 */ }
      await new Promise(r => setTimeout(r, 25))
    }
  }
  if (!fh) throw new Error(`worktree: 跨进程锁获取超时: ${lockPath}`)
  try { return await fn() }
  finally { try { await fh.close() } finally { await rm(lockPath, { force: true }).catch(() => {}) } }
}

/** run-state 专用锁（泛化原语的便捷包装）。 */
export function withRunStateLock(cwd, stateDir, fn) {
  return withCrossProcessFileLock(runStatePath(cwd, stateDir) + '.lock', fn)
}

/**
 * CAS 写 run-state（state.mjs write 原语同款 expectUpdatedAt 冲突语义）：
 * expectUpdatedAt 与当前 updatedAt 不符即抛 conflict（不写不删）；version 每写 +1。
 * 跨进程互斥由 withRunStateLock 提供（读-校验-写在同一 lockfile 临界区内）。
 */
export async function casWriteRunState({ cwd, stateDir = '.omd', expectUpdatedAt, mutate }) {
  return withRunStateLock(cwd, stateDir, async () => {
    const file = runStatePath(cwd, stateDir)
    const cur = await readJson(file, null)
    if (!cur) throw new Error('worktree: run-state.json 不存在（run-state 审计面未初始化——delegate fallback 审计首写前为空）')
    if (expectUpdatedAt !== undefined && cur.updatedAt !== expectUpdatedAt)
      throw new Error(`conflict: run-state CAS 冲突：当前 updatedAt='${cur.updatedAt}'，你携带的是 '${expectUpdatedAt}'——先重读 run-state.json 取最新 updatedAt 再携新值重试`)
    const next = mutate({ ...cur })
    next.version = (cur.version ?? 0) + 1
    next.updatedAt = monotonicIsoNow(cur.updatedAt) // IC-23：同毫秒碰撞防线
    await atomicWriteJson(file, next)
    return next
  })
}
