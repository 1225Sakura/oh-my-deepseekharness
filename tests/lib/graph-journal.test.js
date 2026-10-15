// tests/lib/graph-journal.test.js
// U4 S2 — lib/graph/journal.js unit 测试（扁平格式 + fence 绑定 append + safe-fs）。
// 覆盖（计划 .omd/plans/ralplan-u4-graph-runtime.md §5 Q3/Q9、§4 unit/observability、
// §7 步骤 2；PRD S2 C1/C2）：
//  ① 扁平格式逐行校验 fail-closed：坏行 / 截断半行 / seq 乱序（跳号、重复）/
//    未知 type → JournalCorruptionError（exitCode 20 语义），坏行计数聚合一次抛；
//  ② descriptor_hash 漂移拒恢复：readAll({verifyDescriptorHash:true}) 读路径
//    run_started.hash vs descriptor.json 快照重算比对 → DescriptorDriftError（21）；
//  ③ append/读回/seq 续号：OCC 写前读 max 续号、跨实例续号、seq 由 journal 拥有
//    （自带 seq 拒绝）、每行 seq/ts/type 三字段 + seq 严格连续（observability 断言）；
//  ④ output_ref 旁路 4KB±1 边界：4096 字节内联、4097 字节旁路写 outputs/；
//  ⑤ safe-fs：journal.jsonl 为 symlink → append/readAll 均 fail-closed 拒绝；
//  ⑥ fence 注入缝：缺 assertOwnership 且未 opt-in 拒绝；三段式恰调三次
//    （写前/打开后/fsync 后）；失权（FENCED_OUT 语义错，exitCode 19）在各段的
//    行为——写前/打开后失权零落盘，fsync 后失权经原 fd 截回自家后缀。
// 全部 fixture 落 mkdtemp 临时目录，仓库活 .omd 零触碰。

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { computeDescriptorHash } from '../../lib/graph/descriptor.js'
import {
  DEFAULT_OUTPUT_REF_THRESHOLD,
  DescriptorDriftError,
  FileJournal,
  JOURNAL_FILE_NAME,
  JOURNAL_RECORD_TYPES,
  JournalCorruptionError,
  truncateSuffixViaFreshFd,
} from '../../lib/graph/journal.js'

// ---------- fixtures ----------

let root

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'omd-graph-journal-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function journal(runId = 'run-1', options = { allowUnfencedAppend: true }) {
  return new FileJournal(root, runId, options)
}

function journalPath(runId = 'run-1') {
  return join(root, runId, JOURNAL_FILE_NAME)
}

/** 最小九字段 descriptor 快照（computeDescriptorHash 只取九字段）。 */
function snapshotDescriptor(runId, goal = 'fixture goal') {
  return {
    descriptor_version: 1,
    run_id: runId,
    revision_id: 'rev-1',
    goal,
    nodes: [],
    edges: [],
    entry_node_ids: [],
    concurrency_limit: 1,
    terminal_verification_node_id: 'n1',
  }
}

/** 写 descriptor.json 快照并以其 hash 追加 run_started；返回 hash。 */
function startRun(j, runId, goal) {
  const snapshot = snapshotDescriptor(runId, goal)
  const hash = computeDescriptorHash(snapshot)
  mkdirSync(join(root, runId), { recursive: true })
  writeFileSync(
    join(root, runId, 'descriptor.json'),
    JSON.stringify(snapshot),
    'utf8',
  )
  j.append({ type: 'run_started', run_id: runId, descriptor_hash: hash })
  return hash
}

function line(type, extra = {}, seq = 1) {
  return JSON.stringify({ seq, ts: new Date().toISOString(), type, ...extra })
}

/** 手工写原始 journal 内容（损坏 fixture 直通，绕过 append 的写前校验）。 */
function writeRaw(runId, content) {
  mkdirSync(join(root, runId), { recursive: true })
  writeFileSync(journalPath(runId), content, 'utf8')
}

function fencedOutError() {
  const error = new Error('FENCED_OUT: ownership lost')
  error.exitCode = 19
  return error
}

// ---------- ③ append / 读回 / seq 续号 / observability ----------

describe('append + readAll + seq OCC', () => {
  it('appends records and reads them back with strict continuous seq', () => {
    const j = journal()
    j.append({
      type: 'run_started',
      run_id: 'run-1',
      descriptor_hash: 'a'.repeat(64),
    })
    j.append({ type: 'node_scheduled', node_id: 'n1', attempt: 1 })
    j.append({
      type: 'node_committed',
      node_id: 'n1',
      attempt: 1,
      exit_code: 0,
    })

    const records = j.readAll()
    expect(records).toHaveLength(3)
    // observability：每行含 seq/ts/type 三字段且 seq 严格连续无缺（§4）。
    records.forEach((record, index) => {
      expect(Number.isInteger(record.seq)).toBe(true)
      expect(typeof record.ts).toBe('string')
      expect(Number.isNaN(Date.parse(record.ts))).toBe(false)
      expect(JOURNAL_RECORD_TYPES.includes(record.type)).toBe(true)
      expect(record.seq).toBe(index + 1)
    })
    expect(records[0].type).toBe('run_started')
    expect(records[2].exit_code).toBe(0)
  })

  it('resumes seq from max+1 across instances (OCC read-before-write)', () => {
    journal().append({
      type: 'run_started',
      run_id: 'run-1',
      descriptor_hash: 'b'.repeat(64),
    })
    journal().append({ type: 'node_scheduled', node_id: 'n1', attempt: 1 })
    expect(journal().maxSeq()).toBe(2)
    const fresh = journal()
    fresh.append({ type: 'node_committed', node_id: 'n1', attempt: 1, exit_code: 0 })
    expect(fresh.readAll().map((r) => r.seq)).toEqual([1, 2, 3])
  })

  it('returns [] when the journal file is absent', () => {
    expect(journal().readAll()).toEqual([])
    expect(journal().maxSeq()).toBe(0)
  })

  it('rejects caller-supplied seq (journal owns OCC numbering)', () => {
    expect(() =>
      journal().append({
        seq: 1,
        type: 'run_started',
        run_id: 'run-1',
        descriptor_hash: 'c'.repeat(64),
      }),
    ).toThrow(/journal owns seq/)
  })

  it('rejects invalid run_id and invalid records fail-closed', () => {
    expect(() => new FileJournal(root, '../escape')).toThrow(RangeError)
    expect(() => new FileJournal(root, 'a/b')).toThrow(RangeError)
    expect(() => journal().append({ type: 'node_committed', node_id: 'n1' })).toThrow(
      /invalid journal record/,
    )
    expect(() => journal().append(null)).toThrow(RangeError)
  })
})

// ---------- ① 损坏 / 截断 / 乱序 fixture fail-closed（20 语义） ----------

describe('corrupt fixtures fail closed (exit 20 semantics)', () => {
  it('rejects a non-JSON interior line', () => {
    writeRaw(
      'run-1',
      line('run_started', { run_id: 'run-1', descriptor_hash: 'd'.repeat(64) }, 1) + '\n' +
        'this is not json\n',
    )
    try {
      journal().readAll()
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(JournalCorruptionError)
      expect(error.exitCode).toBe(20)
      expect(error.truncatedCount).toBe(1)
    }
  })

  it('rejects a truncated half-line tail', () => {
    writeRaw(
      'run-1',
      line('run_started', { run_id: 'run-1', descriptor_hash: 'd'.repeat(64) }, 1) + '\n' +
        '{"seq":2,"ts":"2026-',
    )
    try {
      journal().readAll()
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(JournalCorruptionError)
      expect(error.exitCode).toBe(20)
      expect(error.truncatedCount).toBe(1)
    }
  })

  it('counts all bad lines before throwing once', () => {
    writeRaw('run-1', 'bad-one\nbad-two\n')
    try {
      journal().readAll()
      expect.unreachable()
    } catch (error) {
      expect(error.truncatedCount).toBe(2)
    }
  })

  it('rejects seq gaps and duplicates', () => {
    const started = line('run_started', {
      run_id: 'run-1',
      descriptor_hash: 'd'.repeat(64),
    })
    writeRaw('run-1', started + '\n' + line('node_scheduled', { node_id: 'n1', attempt: 1 }, 3) + '\n')
    expect(() => journal().readAll()).toThrow(JournalCorruptionError)
    writeRaw(
      'run-1',
      started + '\n' + line('node_scheduled', { node_id: 'n1', attempt: 1 }, 1) + '\n',
    )
    try {
      journal().readAll()
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(JournalCorruptionError)
      expect(error.truncatedCount).toBe(1)
    }
  })

  it('rejects types outside the frozen vocabulary', () => {
    writeRaw('run-1', line('envelope', { epoch: 1 }, 1) + '\n')
    expect(() => journal().readAll()).toThrow(JournalCorruptionError)
    writeRaw('run-1', line('node_committed', { node_id: 'n1', attempt: 1 }, 1) + '\n')
    // node_committed 缺 exit_code —— 逐行字段校验 fail-closed。
    expect(() => journal().readAll()).toThrow(JournalCorruptionError)
  })

  it('accepts the two registered vocabulary extensions', () => {
    const j = journal()
    j.append({
      type: 'run_started',
      run_id: 'run-1',
      descriptor_hash: 'e'.repeat(64),
    })
    j.append({ type: 'fence_acquired', epoch: 2, owner_pid: 4321 })
    j.append({ type: 'agent_pending', node_id: 'a1', attempt: 1 })
    const records = j.readAll()
    expect(records.map((r) => r.type)).toEqual([
      'run_started',
      'fence_acquired',
      'agent_pending',
    ])
    // fence_acquired 字段校验：epoch/owner_pid 必须为正整数。
    expect(() =>
      j.append({ type: 'fence_acquired', epoch: 0, owner_pid: 1 }),
    ).toThrow(/invalid journal record/)
  })
})

// ---------- ② descriptor_hash 漂移拒恢复（21 语义） ----------

describe('descriptor hash drift (exit 21 semantics)', () => {
  it('passes when snapshot hash matches run_started.descriptor_hash', () => {
    const j = journal()
    startRun(j, 'run-1')
    const records = j.readAll({ verifyDescriptorHash: true })
    expect(records).toHaveLength(1)
  })

  it('rejects recovery when the snapshot drifts', () => {
    const j = journal()
    startRun(j, 'run-1', 'original goal')
    // 篡改快照：同 run_id 但 goal 不同 → 重算 hash 漂移。
    writeFileSync(
      join(root, 'run-1', 'descriptor.json'),
      JSON.stringify(snapshotDescriptor('run-1', 'tampered goal')),
      'utf8',
    )
    try {
      j.readAll({ verifyDescriptorHash: true })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(DescriptorDriftError)
      expect(error.exitCode).toBe(21)
    }
  })

  it('rejects when the snapshot is missing or the first record is not run_started', () => {
    const j = journal()
    j.append({
      type: 'run_started',
      run_id: 'run-1',
      descriptor_hash: 'f'.repeat(64),
    })
    expect(() => j.readAll({ verifyDescriptorHash: true })).toThrow(DescriptorDriftError)

    writeRaw('run-2', line('node_scheduled', { node_id: 'n1', attempt: 1 }, 1) + '\n')
    expect(() => journal('run-2').readAll({ verifyDescriptorHash: true })).toThrow(
      /no run_started record to bind/,
    )
    // 空 journal + verify：无 run_started 可绑定 → 21。
    expect(() => journal('run-3').readAll({ verifyDescriptorHash: true })).toThrow(
      DescriptorDriftError,
    )
  })
})

// ---------- ④ output_ref 旁路 4KB±1 边界 ----------

describe('output_ref bypass boundary', () => {
  it('keeps output inline at threshold and bypasses at threshold+1', () => {
    expect(DEFAULT_OUTPUT_REF_THRESHOLD).toBe(4096)
    const j = journal()
    j.append({
      type: 'node_committed',
      node_id: 'n1',
      attempt: 1,
      exit_code: 0,
      output: 'x'.repeat(4096),
    })
    j.append({
      type: 'node_committed',
      node_id: 'n1',
      attempt: 2,
      exit_code: 0,
      output: 'y'.repeat(4097),
    })
    const [inline, bypassed] = j.readAll()
    expect(inline.output).toBe('x'.repeat(4096))
    expect(inline.output_ref).toBeUndefined()
    expect(bypassed.output).toBeUndefined()
    expect(bypassed.output_ref).toBe('outputs/n1.2.md')
    expect(
      readFileSync(join(root, 'run-1', 'outputs', 'n1.2.md'), 'utf8'),
    ).toBe('y'.repeat(4097))
  })

  it('honours an injected outputRefThreshold', () => {
    const j = journal('run-1', { allowUnfencedAppend: true, outputRefThreshold: 4 })
    j.append({
      type: 'node_committed',
      node_id: 'n1',
      attempt: 1,
      exit_code: 0,
      output: '12345',
    })
    const [record] = j.readAll()
    expect(record.output_ref).toBe('outputs/n1.1.md')
  })
})

// ---------- ⑤ safe-fs：symlink 拒绝 ----------

describe('safe-fs symlink rejection', () => {
  it('refuses a symlinked journal on append and readAll', () => {
    const target = join(root, 'real-journal.jsonl')
    writeFileSync(target, '', 'utf8')
    let linked = true
    try {
      mkdirSync(join(root, 'run-1'), { recursive: true })
      // Windows 建文件 symlink 需开发者模式/管理员；不可建则环境跳过。
      symlinkSync(target, journalPath('run-1'), 'file')
    } catch {
      linked = false
    }
    if (!linked) return // 环境不允许建 symlink —— 跳过断言。
    expect(() =>
      journal().append({
        type: 'run_started',
        run_id: 'run-1',
        descriptor_hash: '0'.repeat(64),
      }),
    ).toThrow(JournalCorruptionError)
    expect(() => journal().readAll()).toThrow(JournalCorruptionError)
  })
})

// ---------- ⑥ fence 注入缝 ----------

describe('fence injection seam (assertOwnership)', () => {
  it('refuses append without assertOwnership unless explicitly opted in', () => {
    const j = new FileJournal(root, 'run-1')
    expect(() =>
      j.append({
        type: 'run_started',
        run_id: 'run-1',
        descriptor_hash: '1'.repeat(64),
      }),
    ).toThrow(/assertOwnership/)
  })

  it('invokes assertOwnership exactly three times per append (pre-write, post-open, post-fsync)', () => {
    const calls = []
    const j = journal('run-1', {
      assertOwnership: () => calls.push(calls.length + 1),
    })
    j.append({
      type: 'run_started',
      run_id: 'run-1',
      descriptor_hash: '2'.repeat(64),
    })
    expect(calls).toEqual([1, 2, 3])
    j.append({ type: 'node_scheduled', node_id: 'n1', attempt: 1 })
    expect(calls).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('propagates FENCED_OUT pre-write with zero bytes written', () => {
    const error = fencedOutError()
    const j = journal('run-1', {
      assertOwnership: () => {
        throw error
      },
    })
    expect(() =>
      j.append({
        type: 'run_started',
        run_id: 'run-1',
        descriptor_hash: '3'.repeat(64),
      }),
    ).toThrow(error)
    expect(journal().readAll()).toEqual([])
  })

  it('propagates FENCED_OUT post-open with zero bytes written', () => {
    const error = fencedOutError()
    let calls = 0
    const j = journal('run-1', {
      assertOwnership: () => {
        calls += 1
        if (calls === 2) throw error
      },
    })
    expect(() =>
      j.append({
        type: 'run_started',
        run_id: 'run-1',
        descriptor_hash: '4'.repeat(64),
      }),
    ).toThrow(error)
    expect(journal().readAll()).toEqual([])
  })

  it('truncates its own suffix via the original fd when ownership is lost post-fsync', () => {
    // 先正常落一行（seq=1）。
    journal().append({
      type: 'run_started',
      run_id: 'run-1',
      descriptor_hash: '5'.repeat(64),
    })
    const error = fencedOutError()
    let calls = 0
    const j = journal('run-1', {
      assertOwnership: () => {
        calls += 1
        if (calls === 3) throw error // 第三段（fsync 后）失权。
      },
    })
    expect(() =>
      j.append({ type: 'node_scheduled', node_id: 'n1', attempt: 1 }),
    ).toThrow(error)
    // 失权截断路径：自家后缀被经原 fd 截回，读回仅剩 seq=1，seq 连续性完好。
    const records = journal().readAll()
    expect(records).toHaveLength(1)
    expect(records[0].seq).toBe(1)
    expect(records[0].type).toBe('run_started')
  })
})

// ---------- IC-10 盲区④：win32 EPERM 回退原语直钉（轮 20 graph P2 批次） ----------

it('truncateSuffixViaFreshFd：size 守卫一致才截回自家后缀；不符（他人已写）绝不动', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omd-journal-trunc-'))
  try {
    const file = join(dir, 'journal.jsonl')
    writeFileSync(file, 'aaaaBBBB', 'utf8')
    truncateSuffixViaFreshFd(file, 8, 4) // size 恰 8 → 截回 initialSize 4
    expect(readFileSync(file, 'utf8')).toBe('aaaa')
    writeFileSync(file, 'aaaaXY', 'utf8')
    truncateSuffixViaFreshFd(file, 8, 4) // expectedSize 8 ≠ 实际 6 → 绝不动
    expect(readFileSync(file, 'utf8')).toBe('aaaaXY')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------- IC-06/P2-6：outputs/ 旁路写 safe-fs（轮 20 graph P2 批次） ----------

it('IC-06：outputs/ 旁路写遇 symlink → fail-closed 拒绝（与 journal 主路径同款纪律）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omd-journal-out-sym-'))
  try {
    const runDir = join(dir, 'run-sym')
    mkdirSync(join(runDir, 'outputs'), { recursive: true })
    const journal = new FileJournal(dir, 'run-sym', { allowUnfencedAppend: true, outputRefThreshold: 0 })
    const target = join(dir, 'real-output.md')
    writeFileSync(target, 'x', 'utf8')
    let linked = true
    try {
      // Windows 建文件 symlink 需开发者模式/管理员；不可建则环境跳过（同 ⑤ 先例）
      symlinkSync(target, join(runDir, 'outputs', 'n1.1.md'), 'file')
    } catch { linked = false }
    if (!linked) return
    expect(() => journal.append({
      type: 'node_committed', node_id: 'n1', attempt: 1, exit_code: 0, output: 'big-payload',
    })).toThrow(JournalCorruptionError) // 修复前：writeFileSync 直写穿透 symlink
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})