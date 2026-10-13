// tests/lib/graph-fence.test.js
// U4 S4a — lib/graph/fence.js owner fence unit 测试（计划
// .omd/plans/ralplan-u4-graph-runtime.md §5 Q9、§7 步骤 4、§4 unit 段）。
// 覆盖：acquire（标记三件套 + epoch=1）/占用拒绝（FENCED_OUT/19）/心跳刷新/
// stale 双条件判定（注入缩短 staleGraceMs + 假死 pid）/显式接管 epoch 单调/
// 接管后旧主失权（assertOwnership 抛 FENCED_OUT、journal append 原样传播并
// 截回自家后缀）/release 后续号不回退/owner.epoch 坏值 fail-closed/
// isProcessAlive Windows 语义（ESRCH vs EPERM 实证锚定）。
// 全部 fixture 落 os.tmpdir() mkdtemp 临时目录，仓库活 .omd 零触碰。

import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_STALE_GRACE_MS,
  FENCED_OUT_CODE,
  FENCE_EPOCH_NAME,
  FENCE_LOCK_NAME,
  FENCE_OWNER_NAME,
  FenceError,
  OwnerFence,
  isProcessAlive,
} from '../../lib/graph/fence.js'
import { FileJournal } from '../../lib/graph/journal.js'

const temps = []

function makeRunsRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'omd-graph-fence-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop(), { recursive: true, force: true })
  }
})

const HASH = 'a'.repeat(64)

function readOwnerJson(runsRoot, runId) {
  return JSON.parse(readFileSync(join(runsRoot, runId, FENCE_OWNER_NAME), 'utf8'))
}

/** 伪造失租 owner.json（假死 pid + 指定 lease 时间），驱动 stalled 判定。 */
function plantStaleOwnerJson(runsRoot, runId, { pid = 999999, leaseTs }) {
  writeFileSync(
    join(runsRoot, runId, FENCE_OWNER_NAME),
    JSON.stringify({ pid, started_at: leaseTs, lease_ts: leaseTs }),
    'utf8',
  )
}

describe('acquire / 占用拒绝', () => {
  it('acquire 创建 owner.lock/owner.epoch/owner.json，epoch=1 且持有', () => {
    const runsRoot = makeRunsRoot()
    const fence = new OwnerFence(runsRoot, 'run-a')
    const result = fence.acquire()
    expect(result).toEqual({ outcome: 'acquired', epoch: 1, tookOver: false })
    expect(fence.held).toBe(true)
    expect(fence.epoch).toBe(1)
    expect(readFileSync(join(runsRoot, 'run-a', FENCE_EPOCH_NAME), 'utf8')).toBe('1')
    const owner = readOwnerJson(runsRoot, 'run-a')
    expect(owner.pid).toBe(process.pid)
    expect(Number.isNaN(Date.parse(owner.lease_ts))).toBe(false)
    const payload = JSON.parse(readFileSync(join(runsRoot, 'run-a', FENCE_LOCK_NAME), 'utf8'))
    expect(payload).toMatchObject({ pid: process.pid, epoch: 1 })
    fence.release()
  })

  it('占用中第二实例 acquire → FenceError(FENCED_OUT, exitCode 19)', () => {
    const runsRoot = makeRunsRoot()
    const first = new OwnerFence(runsRoot, 'run-a')
    first.acquire()
    const second = new OwnerFence(runsRoot, 'run-a')
    let caught = null
    try {
      second.acquire()
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(FenceError)
    expect(caught.code).toBe(FENCED_OUT_CODE)
    expect(caught.exitCode).toBe(19)
    first.release()
  })

  it('活主未过期 takeover 同样拒绝（显式接管只认 stalled）', () => {
    const runsRoot = makeRunsRoot()
    const first = new OwnerFence(runsRoot, 'run-a')
    first.acquire()
    const second = new OwnerFence(runsRoot, 'run-a', { staleGraceMs: 50 })
    expect(() => second.takeover()).toThrowError(
      expect.objectContaining({ code: FENCED_OUT_CODE, exitCode: 19 }),
    )
    first.release()
  })
})

describe('心跳 / stalled 判定', () => {
  it('heartbeat 刷新 owner.json lease_ts（注入时钟）', () => {
    const runsRoot = makeRunsRoot()
    let clock = 1_000_000
    const fence = new OwnerFence(runsRoot, 'run-a', { now: () => clock })
    fence.acquire()
    const before = readOwnerJson(runsRoot, 'run-a').lease_ts
    clock += 5_000
    fence.heartbeat()
    const after = readOwnerJson(runsRoot, 'run-a').lease_ts
    expect(Date.parse(after)).toBeGreaterThan(Date.parse(before))
    fence.release()
  })

  it('未持有 heartbeat → FENCED_OUT', () => {
    const fence = new OwnerFence(makeRunsRoot(), 'run-a')
    expect(() => fence.heartbeat()).toThrowError(
      expect.objectContaining({ code: FENCED_OUT_CODE, exitCode: 19 }),
    )
  })

  it('stalled = lease 过期且 pid 不存活（双条件逐一钉死）', () => {
    const runsRoot = makeRunsRoot()
    const holder = new OwnerFence(runsRoot, 'run-a')
    holder.acquire()
    const observer = new OwnerFence(runsRoot, 'run-a', { staleGraceMs: 1_000 })

    const old = new Date(Date.now() - 60_000).toISOString()
    const fresh = new Date(Date.now()).toISOString()

    // ① 旧 lease + 活 pid（本进程）→ 不 stalled（pid 存活兜底）
    plantStaleOwnerJson(runsRoot, 'run-a', { pid: process.pid, leaseTs: old })
    expect(observer.isStalled()).toBe(false)

    // ② 新 lease + 死 pid → 不 stalled（宽限期内）
    plantStaleOwnerJson(runsRoot, 'run-a', { pid: 999999, leaseTs: fresh })
    expect(observer.isStalled()).toBe(false)

    // ③ 旧 lease + 死 pid → stalled
    plantStaleOwnerJson(runsRoot, 'run-a', { pid: 999999, leaseTs: old })
    expect(observer.isStalled()).toBe(true)

    holder.release()
    // ④ 无 lock → occupied=false/stalled=false
    expect(observer.inspect()).toEqual({ occupied: false, stalled: false, owner: null, epoch: null })
  })

  it('owner.json 缺席时以 lock mtime + lock payload pid 兜底判读', () => {
    const runsRoot = makeRunsRoot()
    const holder = new OwnerFence(runsRoot, 'run-a')
    holder.acquire()
    rmSync(join(runsRoot, 'run-a', FENCE_OWNER_NAME))
    const observer = new OwnerFence(runsRoot, 'run-a', { staleGraceMs: 30_000 })
    // lock payload pid = 本进程（活）且 mtime 新鲜 → 不 stalled
    expect(observer.inspect()).toMatchObject({ occupied: true, stalled: false })
    holder.release()
  })

  it('isProcessAlive：本进程 true；死 pid 999999 false（ESRCH 实证）', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
    expect(isProcessAlive(999999)).toBe(false)
    expect(isProcessAlive(0)).toBe(false)
    expect(isProcessAlive(-1)).toBe(false)
  })

  it('默认 staleGraceMs = 30000（上游 fence.ts L98-99 锚）', () => {
    expect(DEFAULT_STALE_GRACE_MS).toBe(30_000)
  })
})

describe('takeover / epoch 单调', () => {
  /** acquire 后伪造 stalled 现场（死 pid + 旧 lease），返回观察者。 */
  function acquireThenStale(runsRoot, runId, staleGraceMs = 1_000) {
    const holder = new OwnerFence(runsRoot, runId)
    holder.acquire()
    plantStaleOwnerJson(runsRoot, runId, {
      pid: 999999,
      leaseTs: new Date(Date.now() - 60_000).toISOString(),
    })
    return holder
  }

  it('stalled 后 takeover 成功：epoch 单调升、lock payload 换主', () => {
    const runsRoot = makeRunsRoot()
    const holder = acquireThenStale(runsRoot, 'run-a')
    const taker = new OwnerFence(runsRoot, 'run-a', { staleGraceMs: 1_000 })
    const result = taker.takeover()
    expect(result).toEqual({ outcome: 'acquired', epoch: 2, tookOver: true })
    expect(readFileSync(join(runsRoot, 'run-a', FENCE_EPOCH_NAME), 'utf8')).toBe('2')
    const payload = JSON.parse(readFileSync(join(runsRoot, 'run-a', FENCE_LOCK_NAME), 'utf8'))
    expect(payload.epoch).toBe(2)
    // 旧主失权：assertOwnership 抛 FENCED_OUT/19
    expect(() => holder.assertOwnership()).toThrowError(
      expect.objectContaining({ code: FENCED_OUT_CODE, exitCode: 19 }),
    )
    // 旧主 release 不误删新主 lock（返回 false，lock 仍在）
    expect(holder.release()).toBe(false)
    expect(existsSync(join(runsRoot, 'run-a', FENCE_LOCK_NAME))).toBe(true)
    taker.release()
  })

  it('release 后 owner.epoch 保留，再 acquire 续号不回退', () => {
    const runsRoot = makeRunsRoot()
    const first = new OwnerFence(runsRoot, 'run-a')
    first.acquire()
    expect(first.release()).toBe(true)
    expect(existsSync(join(runsRoot, 'run-a', FENCE_LOCK_NAME))).toBe(false)
    expect(readFileSync(join(runsRoot, 'run-a', FENCE_EPOCH_NAME), 'utf8')).toBe('1')
    const second = new OwnerFence(runsRoot, 'run-a')
    expect(second.acquire().epoch).toBe(2)
    second.release()
  })

  it('owner.epoch 非规范整数 → acquire fail-closed 抛错（非 FenceError）', () => {
    const runsRoot = makeRunsRoot()
    const first = new OwnerFence(runsRoot, 'run-a')
    first.acquire()
    first.release()
    writeFileSync(join(runsRoot, 'run-a', FENCE_EPOCH_NAME), 'not-an-int', 'utf8')
    const second = new OwnerFence(runsRoot, 'run-a')
    expect(() => second.acquire()).toThrowError(/owner.epoch is not a canonical/)
  })
})

describe('失权与 FileJournal 绑定', () => {
  it('失权后 journal append 抛 FENCED_OUT/19 且截回自家后缀', () => {
    const runsRoot = makeRunsRoot()
    const holder = new OwnerFence(runsRoot, 'run-a')
    holder.acquire()
    const journal = new FileJournal(runsRoot, 'run-a', {
      assertOwnership: () => holder.assertOwnership(),
    })
    journal.append({ type: 'run_started', run_id: 'run-a', descriptor_hash: HASH })

    // 模拟接管发生（死 pid + 旧 lease → stalled → takeover 换锁）
    plantStaleOwnerJson(runsRoot, 'run-a', {
      pid: 999999,
      leaseTs: new Date(Date.now() - 60_000).toISOString(),
    })
    const taker = new OwnerFence(runsRoot, 'run-a', { staleGraceMs: 1_000 })
    taker.takeover()

    let caught = null
    try {
      journal.append({
        type: 'node_scheduled',
        node_id: 'n1',
        attempt: 1,
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(FenceError)
    expect(caught.code).toBe(FENCED_OUT_CODE)
    expect(caught.exitCode).toBe(19)
    // 失权截断：自家后缀被截回，读回仅剩 run_started（seq=1）
    const records = new FileJournal(runsRoot, 'run-a', {
      allowUnfencedAppend: true,
    }).readAll()
    expect(records).toHaveLength(1)
    expect(records[0].type).toBe('run_started')
    taker.release()
  })

  it('持有期 append 正常（三段式回调均通过）', () => {
    const runsRoot = makeRunsRoot()
    const holder = new OwnerFence(runsRoot, 'run-a')
    holder.acquire()
    const journal = new FileJournal(runsRoot, 'run-a', {
      assertOwnership: () => holder.assertOwnership(),
    })
    journal.append({ type: 'run_started', run_id: 'run-a', descriptor_hash: HASH })
    journal.append({ type: 'node_scheduled', node_id: 'n1', attempt: 1 })
    expect(journal.readAll()).toHaveLength(2)
    holder.release()
  })
})
