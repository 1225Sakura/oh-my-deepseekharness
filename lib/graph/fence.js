// lib/graph/fence.js
// Run 级 owner fence（单写者互斥）——裁剪移植 reference/oh-my-claudecode v5.7.0
// src/graph/runtime/fence.ts 的契约（U4 S4a，计划
// .omd/plans/ralplan-u4-graph-runtime.md §5 Q9、§7 步骤 4）：
// - owner.lock：O_CREAT|O_EXCL 创建并持有 fd，内容是 JSON payload
//   {pid, epoch, started_at}——payload 的 epoch 是持有身份判据；
// - owner.epoch sidecar：单调递增整数文本（原子写 temp+rename），记录本 run
//   曾发出的最大 epoch；新建/接管的 candidate=max(1, ceiling+1)，release 后
//   续号不回退（fence.ts L157-187）；
// - owner.json：{pid, started_at, lease_ts} 心跳（原子写）。stalled 判定 =
//   lease_ts 距今 > staleGraceMs（默认 30s，fence.ts L98-99/L134）且 owner pid
//   不存活（双条件缺一不可）；
// - acquire 占用中 → FenceError(FENCED_OUT, exitCode 19)，绝不自动接管；
//   takeover 是唯一显式接管口（要求 isStalled() 为真），接管后 epoch 只升不降。
//
// 上游裁剪声明（计划 §5 Q9 明文）：fence.ts L166-172 的 tombstone/rename
// 接管竞态协议不移植，以 lease 过期 + pid 死亡双条件判定替代；pid 复用为已知
// 残余风险。fence 元数据全部在 run 目录旁文件，不进 journal（原则 3）。
//
// Windows 实证（D:/omd，2026-10-13，实证脚本 .omd/u4-empir-*/empir.mjs）：
// - process.kill(死 pid, 0) 抛 ESRCH；system pid 4 抛 EPERM（存在但不可开 →
//   判存活）；本进程 pid 返回成功 → isProcessAlive 映射 ESRCH=false、EPERM=true。
// - owner.lock 的互斥靠 O_EXCL 创建语义（win32 无 flock；fd 持有期内路径存在
//   即占用），接管路径 unlink + O_EXCL 重建，EEXIST 竞态落败者收 FENCED_OUT。

import {
  closeSync,
  constants as fsConstants,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export const FENCE_LOCK_NAME = 'owner.lock'
export const FENCE_EPOCH_NAME = 'owner.epoch'
export const FENCE_OWNER_NAME = 'owner.json'
export const DEFAULT_STALE_GRACE_MS = 30_000

export const FENCED_OUT_CODE = 'FENCED_OUT'

/** Fence 语义错误：占用/失权恒 exitCode 19（SKILL.zh.md L41-43 契约）。 */
export class FenceError extends Error {
  constructor(code, message, exitCode = 19) {
    super(message)
    this.name = 'FenceError'
    this.code = code
    this.exitCode = exitCode
  }
}

/**
 * pid 存活性（Windows 实证语义）：process.kill(pid, 0) 成功 → 存活；
 * ESRCH → 不存在；EPERM → 存在但无权开句柄（判存活，绝不误判死亡）。
 */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error && error.code === 'ESRCH') return false
    if (error && error.code === 'EPERM') return true
    throw error
  }
}

function isSafeEpoch(value) {
  return Number.isSafeInteger(value) && value >= 1
}

/** 原子写文本文件（temp + rename 同目录替换）。 */
function atomicWriteText(filePath, text) {
  const tmp = `${filePath}.tmp.${randomBytes(6).toString('hex')}`
  writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, filePath)
}

function readTextOrNull(filePath) {
  try {
    return readFileSync(filePath, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }
}

/** owner.epoch sidecar 读：缺席 → null；非规范整数 → fail-closed 抛错。 */
function readEpochCeiling(epochPath) {
  const text = readTextOrNull(epochPath)
  if (text === null) return null
  if (!/^[1-9][0-9]*$/.test(text)) {
    throw new Error('owner.epoch is not a canonical plain integer')
  }
  const value = Number(text)
  if (!isSafeEpoch(value) || String(value) !== text) {
    throw new Error('owner.epoch is outside the safe integer range')
  }
  return value
}

/** owner.lock payload 读：缺席/不可解析 → null。 */
function readLockPayload(lockPath) {
  const text = readTextOrNull(lockPath)
  if (text === null) return null
  try {
    const parsed = JSON.parse(text)
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !Number.isInteger(parsed.pid) ||
      !isSafeEpoch(parsed.epoch) ||
      typeof parsed.started_at !== 'string'
    ) {
      return null
    }
    return { pid: parsed.pid, epoch: parsed.epoch, started_at: parsed.started_at }
  } catch {
    return null
  }
}

/** owner.json 心跳读：缺席/不可解析 → null。 */
function readOwnerJson(ownerPath) {
  const text = readTextOrNull(ownerPath)
  if (text === null) return null
  try {
    const parsed = JSON.parse(text)
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !Number.isInteger(parsed.pid) ||
      typeof parsed.started_at !== 'string' ||
      typeof parsed.lease_ts !== 'string' ||
      Number.isNaN(Date.parse(parsed.lease_ts))
    ) {
      return null
    }
    return {
      pid: parsed.pid,
      started_at: parsed.started_at,
      lease_ts: parsed.lease_ts,
      // P2-3（IC-03）：持久化宽限期透传（旧形状缺席 → undefined，inspect 回落本实例默认）
      stale_grace_ms: Number.isFinite(parsed.stale_grace_ms) ? parsed.stale_grace_ms : undefined,
    }
  } catch {
    return null
  }
}

/**
 * 绑定单个 run 的 owner fence。同一进程可对同一 run 建多实例——占用语义由
 * owner.lock 文件保证跨实例/跨进程互斥。
 */
export class OwnerFence {
  /**
   * @param {string} runsRoot 如 `<cwd>/.omd/graph-runs`
   * @param {string} runId
   * @param {object} [options]
   * @param {number} [options.staleGraceMs] stalled 宽限（默认 30s，测试可缩短）
   * @param {() => number} [options.now] 时钟注入缝（默认 Date.now）
   */
  constructor(runsRoot, runId, options = {}) {
    this.runsRoot = runsRoot
    this.runId = runId
    this.runDir = join(runsRoot, runId)
    this.staleGraceMs = options.staleGraceMs ?? DEFAULT_STALE_GRACE_MS
    this.now = options.now ?? Date.now
    // 测试缝（P2-13②）：takeover 的 lock unlink 注入点——覆盖「inspect 后 lock 外部
    // 消失 → ENOENT 容忍续接管」分支（真实场景：清理进程/AV 抖动竞态）。
    this.unlinkImpl = options.unlinkImpl
    this.fd = null
    this.heldEpoch = null
    this.startedAt = null
  }

  get lockPath() {
    return join(this.runDir, FENCE_LOCK_NAME)
  }

  get epochPath() {
    return join(this.runDir, FENCE_EPOCH_NAME)
  }

  get ownerPath() {
    return join(this.runDir, FENCE_OWNER_NAME)
  }

  /** 当前持有 epoch（未持有 → null）。 */
  get epoch() {
    return this.heldEpoch
  }

  /** 是否由本实例持有。 */
  get held() {
    return this.fd !== null && this.heldEpoch !== null
  }

  /**
   * 观测占用/停滞状态（不要求持有）：
   * occupied = owner.lock 存在；stalled = lease 过期且 pid 不存活。
   * owner.json 缺席/不可解析时以 lock payload 的 pid 与 lock mtime 兜底判读。
   */
  inspect() {
    let lockStat = null
    try {
      lockStat = statSync(this.lockPath)
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return { occupied: false, stalled: false, owner: null, epoch: null }
      }
      throw error
    }
    const owner = readOwnerJson(this.ownerPath)
    const payload = readLockPayload(this.lockPath)
    const pid = owner?.pid ?? payload?.pid ?? null
    const leaseMs = owner !== null ? Date.parse(owner.lease_ts) : lockStat.mtimeMs
    const leaseAgeMs = this.now() - leaseMs
    const pidAlive = pid !== null && isProcessAlive(pid)
    // P2-3（IC-03）：stalled 判定优先读 owner.json 持久化的 grace（run 的保护意图随行），
    // 缺席（旧 run/无 owner.json）回落本实例构造值——观测/接管口径不再背离原 run。
    const graceMs = Number.isFinite(owner?.stale_grace_ms) ? owner.stale_grace_ms : this.staleGraceMs
    const stalled = leaseAgeMs > graceMs && !pidAlive
    return {
      occupied: true,
      stalled,
      owner: owner ?? payload,
      epoch: payload?.epoch ?? null,
    }
  }

  /** stalled 判定便捷口（计划 §5 Q9 双条件）。 */
  isStalled() {
    return this.inspect().stalled
  }

  /**
   * 占用获取：O_CREAT|O_EXCL 创建 owner.lock 并持有 fd。占用中（无论是否
   * stalled）→ FenceError(FENCED_OUT, 19)——接管必须走显式 takeover()。
   * 成功路径：读 sidecar ceiling → candidate=max(1, ceiling+1) → 写 lock
   * payload → 原子持久化 sidecar（失败则清理自家 lock 再抛）→ 写 owner.json。
   */
  acquire() {
    return this.createUnderLock(false)
  }

  /**
   * 显式接管（graph_resume 唯一续驱动口）：前置 isStalled() 必须为真，否则
   * FENCED_OUT/19。接管 = unlink 失权 lock → O_EXCL 重建（竞态落败收
   * FENCED_OUT）→ epoch 只升不降。无 lock 时等价 acquire。
   */
  takeover() {
    const state = this.inspect()
    if (!state.occupied) {
      const result = this.createUnderLock(true)
      return { ...result, tookOver: false }
    }
    if (!state.stalled) {
      throw new FenceError(
        FENCED_OUT_CODE,
        `run ${this.runId} is owned by a live writer or still within the stale grace period (lease/pid dual condition not met)`,
      )
    }
    // 刻板审查修复（R3 fence②）：inspect→unlink 之间重核锁 payload——inspect 之后若
    // 有第三方已接管重建（epoch 变化/锁消失），本 unlink 会误删活锁致双持。重核不一致
    // 即放弃接管（FENCED_OUT）。残余窗口（重核→unlink 的微秒级间隙）如实登记为已知边界。
    const before = readLockPayload(this.lockPath)
    if (before === null || before.epoch !== state.epoch)
      throw new FenceError(
        FENCED_OUT_CODE,
        `run ${this.runId} lock changed between inspect and takeover (epoch ${String(state.epoch)} → ${String(before?.epoch)}); aborting takeover`,
      )
    try {
      ;(this.unlinkImpl ?? unlinkSync)(this.lockPath)
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error
    }
    const result = this.createUnderLock(true)
    return { ...result, tookOver: true }
  }

  /** 心跳：刷新 owner.json lease_ts（仅持有期可调）。
   *  刻板审查修复（R3 fence②放大器）：此前只查内存 this.held——被废黜者（锁已被接管）
   *  心跳会重写 owner.json 污染 stalled 判定。现先 assertOwnership（payload epoch/pid
   *  仍是自家才放行），失权即 FENCED_OUT 显式失败。 */
  heartbeat() {
    this.assertOwnership()
    this.writeOwnerJson()
  }

  /**
   * FileJournal append 三段式注入缝：失权（未持有 / owner.lock 消失 /
   * payload epoch 或 pid 不再是自家）→ FenceError(FENCED_OUT, 19)，
   * journal 原样传播并截回自家后缀。
   */
  assertOwnership() {
    if (!this.held) {
      throw new FenceError(FENCED_OUT_CODE, 'fence is not held by this process')
    }
    const payload = readLockPayload(this.lockPath)
    if (
      payload === null ||
      payload.epoch !== this.heldEpoch ||
      payload.pid !== process.pid
    ) {
      throw new FenceError(
        FENCED_OUT_CODE,
        `ownership of run ${this.runId} lost (lock payload epoch ${String(
          payload?.epoch,
        )} !== held ${String(this.heldEpoch)})`,
      )
    }
  }

  /**
   * 释放：仅当 owner.lock payload 仍是自家 epoch 时 unlink（绝不误删接管者的
   * lock）；owner.epoch / owner.json 保留供续号与审计。返回是否真正移除。
   */
  release() {
    if (!this.held) return false
    const heldEpoch = this.heldEpoch
    const fd = this.fd
    this.fd = null
    this.heldEpoch = null
    this.startedAt = null
    // 身份检查先于任何变更：payload 在 fd 仍持有时读取，此刻锁内容若已不是
    // 自家 epoch（被接管替换）则只关 fd、绝不 unlink 接管者的 lock。
    const payload = readLockPayload(this.lockPath)
    try {
      closeSync(fd)
    } catch {
      // 已关闭。
    }
    if (payload === null || payload.epoch !== heldEpoch) return false
    try {
      unlinkSync(this.lockPath)
      return true
    } catch (error) {
      if (error && error.code === 'ENOENT') return false
      throw error
    }
  }

  /** 创建临界区：O_EXCL 建锁 + payload + sidecar + owner.json。 */
  createUnderLock(isTakeover) {
    if (this.held) {
      throw new FenceError(FENCED_OUT_CODE, 'this fence instance already holds the run')
    }
    mkdirSync(this.runDir, { recursive: true })
    let fd
    try {
      fd = openSync(
        this.lockPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR,
        0o600,
      )
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        const state = this.inspect()
        throw new FenceError(
          FENCED_OUT_CODE,
          `run ${this.runId} is owned by another writer (stalled=${state.stalled}); use takeover for an explicitly stalled run`,
        )
      }
      throw error
    }
    const startedAt = new Date(this.now()).toISOString()
    let epoch
    try {
      // 刻板审查修复（R3 fence①）：readEpochCeiling 挪进清理 try——此前在 try 外，
      // 坏 owner.epoch 值 fail-closed 抛错时 fd 未关、空 owner.lock 残留，后续 acquire 全收 19。
      const ceiling = readEpochCeiling(this.epochPath) ?? 0
      epoch = Math.max(1, ceiling + 1)
      // P2-7（IC-07）：写序对调——先 sidecar 后 payload。崩溃落在两写之间时 sidecar 领先
      // 只产生无害空洞（epoch 跳号），反向序则后续 takeover 重发同号（SKILL「接管只升不降」破例）。
      // sidecar 持久化失败 → 清理自家 lock 再抛（绝不发出续号会重发的 epoch）。
      atomicWriteText(this.epochPath, String(epoch))
      writeSync(fd, JSON.stringify({ pid: process.pid, epoch, started_at: startedAt }))
    } catch (error) {
      try {
        closeSync(fd)
      } catch {
        // 已关闭。
      }
      try {
        unlinkSync(this.lockPath)
      } catch {
        // 锁路径可能已被替换；best-effort。
      }
      throw error
    }
    this.fd = fd
    this.heldEpoch = epoch
    this.startedAt = startedAt
    try {
      this.writeOwnerJson()
    } catch (error) {
      // 刻板审查修复（R3 fence③）：owner.json 写失败回滚——此前 fd/heldEpoch 已先赋值，
      // acquire 抛错但实例已持锁（held=true 状态矛盾 + 锁残留）。回滚：清实例状态、
      // 关 fd、仅当 payload 仍是自家 epoch 时 unlink（绝不动接管者的锁）。
      this.fd = null
      this.heldEpoch = null
      this.startedAt = null
      try { closeSync(fd) } catch { /* 已关闭 */ }
      try {
        const p = readLockPayload(this.lockPath)
        if (p !== null && p.epoch === epoch && p.pid === process.pid) unlinkSync(this.lockPath)
      } catch { /* best-effort */ }
      throw error
    }
    return { outcome: 'acquired', epoch, tookOver: isTakeover }
  }

  writeOwnerJson() {
    atomicWriteText(
      this.ownerPath,
      JSON.stringify({
        pid: process.pid,
        epoch: this.heldEpoch, // 刻板审查修复（R3 fence②）：持久化 epoch——观测/接管面可交叉核对
        started_at: this.startedAt,
        lease_ts: new Date(this.now()).toISOString(),
        stale_grace_ms: this.staleGraceMs, // P2-3（IC-03）：宽限期持久化——观测面读回
      }),
    )
  }
}
