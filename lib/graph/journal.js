// lib/graph/journal.js
// Graph Core 扁平格式 append-only OCC journal（<runsRoot>/<run_id>/journal.jsonl）——
// 格式冻结于 assets/skills/graph/SKILL.zh.md L83-91（{seq,ts,type,...} 七 type +
// fence_acquired/agent_pending 两个新增 type，计划
// .omd/plans/ralplan-u4-graph-runtime.md §5 Q3/Q9、§7 步骤 2；U4 S2）。
// 上游包络格式（reference/oh-my-claudecode v5.7.0 src/graph/runtime/journal.ts）
// 一期不采（模型可手写性，计划 §2 driver 1）；此处移植其「神」：
// - O_APPEND 单行 writeSync+fsync（journal.ts L138-148）；
// - append 临界区绑 fence 持有期：assertOwnership 三段式（写前 L127 / 打开后
//   L162 / fsync 后 L171），写/fsync 在飞期间失权 → 经原 fd ftruncate 自家后缀
//  （L172-186；win32 O_APPEND 句柄 ftruncate 恒 EPERM → 第二 fd 回退截断，
//   size 守卫不变），截断失败遗留 durable suffix 供 fail-closed 重放；
// - safe-fs 两函数移植（ELOOP symlink 拒绝 L150-157 +
//   assertPrivateRegularFile L216-221）。上游的目录 FD 遍历 containment
//   （withContainedOperations）在 win32 无原子 no-follow open 即 fail-closed
//   （safe-fs.ts L16/L73-77），本地单用户场景不移植该机制；win32 下以 lstat
//   前置检查实现 symlink 拒绝，TOCTOU 窗口明文接受。
//
// fence 注入缝：构造器 options.assertOwnership: () => void —— 与上游
// FileJournal 第四参同形同语义；失权时由回调抛带 FENCED_OUT 语义（exit_code 19）
// 的错，journal 原样传播。缺省=无 fence 的本地模式，必须显式传
// allowUnfencedAppend: true opt-in；⚠️ 无 fence 时跨进程 OCC（写前读 max seq
// 续号）无互斥保证，仅供单写者本地/测试场景（计划 §5 Q3：跨进程互斥由 fence
// 提供，omd 既有 withFileLock 仅单进程有效）。

import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  ftruncateSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'

import { computeDescriptorHash } from './descriptor.js'

export const JOURNAL_FILE_NAME = 'journal.jsonl'
export const OUTPUTS_DIR_NAME = 'outputs'
export const DESCRIPTOR_SNAPSHOT_NAME = 'descriptor.json'
/** 输出内联上限（字节）：超过即旁路写 outputs/，journal 行只记 output_ref。 */
export const DEFAULT_OUTPUT_REF_THRESHOLD = 4096
/** 扁平格式 seq 从 1 起（SKILL.zh.md L84 首行 seq:1），严格连续无缺。 */
export const JOURNAL_BASE_SEQ = 1

/** 冻结词汇表：SKILL.zh.md L83-91 七 type + 计划 §7 步骤 5 登记的两个新 type。 */
export const JOURNAL_RECORD_TYPES = Object.freeze([
  'run_started',
  'node_scheduled',
  'node_committed',
  'node_failed',
  'gate_waiting',
  'gate_resolved',
  'run_finished',
  'fence_acquired',
  'agent_pending',
])

const DESCRIPTOR_HASH_PATTERN = /^[a-f0-9]{64}$/
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
// win32 无 O_NOFOLLOW（上游 safe-fs.ts L16 同判）；lstat 前置检查兜底。
const NO_FOLLOW = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0)

/** Journal 损坏/截断/乱序（fail-closed，退出码 20 语义）。 */
export class JournalCorruptionError extends Error {
  /** 坏行/不完整行计数（含截断尾部）。 */
  constructor(message, truncatedCount) {
    if (!Number.isInteger(truncatedCount) || truncatedCount < 1) {
      throw new Error('truncatedCount must be a positive integer')
    }
    super(message)
    this.name = 'JournalCorruptionError'
    this.truncatedCount = truncatedCount
    this.exitCode = 20
  }
}

/** 恢复时 descriptor 漂移：run_started.descriptor_hash 与快照重算不符（21 语义）。 */
export class DescriptorDriftError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DescriptorDriftError'
    this.exitCode = 21
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value >= 1
}

function isValidTs(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

/** 扁平记录逐行校验；返回错误消息或 null。额外键放行（扁平 "..." 可扩展）。 */
export function flatRecordError(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'record is not an object'
  }
  if (!isPositiveInt(value.seq)) return 'seq must be an integer >= 1'
  if (!isValidTs(value.ts)) return 'ts must be an ISO-8601 timestamp string'
  if (typeof value.type !== 'string' || !JOURNAL_RECORD_TYPES.includes(value.type)) {
    return 'type is not in the frozen journal vocabulary'
  }
  switch (value.type) {
    case 'run_started':
      if (!isNonEmptyString(value.run_id)) return 'run_started requires run_id'
      if (
        typeof value.descriptor_hash !== 'string' ||
        !DESCRIPTOR_HASH_PATTERN.test(value.descriptor_hash)
      ) {
        return 'run_started requires descriptor_hash matching /^[a-f0-9]{64}$/'
      }
      return null
    case 'node_scheduled':
    case 'agent_pending':
      if (!isNonEmptyString(value.node_id)) return `${value.type} requires node_id`
      if (!isPositiveInt(value.attempt)) return `${value.type} requires attempt >= 1`
      return null
    case 'node_committed':
      if (!isNonEmptyString(value.node_id)) return 'node_committed requires node_id'
      if (!isPositiveInt(value.attempt)) return 'node_committed requires attempt >= 1'
      if (!Number.isInteger(value.exit_code) || value.exit_code < 0) {
        return 'node_committed requires exit_code integer >= 0'
      }
      if (value.output_ref !== undefined) {
        if (!isNonEmptyString(value.output_ref))
          return 'node_committed output_ref must be a non-empty string'
        // 刻板审查修复（R3-⑲）：形态钉死 outputs/<safe-name>（sanitizeFileComponent 同款
        // 字符集）——此前任意字符串可落账，防未来回读消费者的路径安全债
        if (!/^outputs\/[A-Za-z0-9._:-]+$/.test(value.output_ref))
          return 'node_committed output_ref must match outputs/<safe-name>（[A-Za-z0-9._:-]）'
      }
      return null
    case 'node_failed':
      if (!isNonEmptyString(value.node_id)) return 'node_failed requires node_id'
      if (!isPositiveInt(value.attempt)) return 'node_failed requires attempt >= 1'
      if (typeof value.error !== 'string') return 'node_failed requires error string'
      if (typeof value.retryable !== 'boolean') return 'node_failed requires retryable boolean'
      return null
    case 'gate_waiting':
      if (!isNonEmptyString(value.node_id)) return 'gate_waiting requires node_id'
      if (typeof value.prompt !== 'string') return 'gate_waiting requires prompt string'
      return null
    case 'gate_resolved':
      if (!isNonEmptyString(value.node_id)) return 'gate_resolved requires node_id'
      if (value.decision !== 'approved' && value.decision !== 'denied') {
        return 'gate_resolved decision must be approved|denied'
      }
      return null
    case 'run_finished':
      if (!['completed', 'failed', 'cancelled'].includes(value.terminal_status)) {
        return 'run_finished terminal_status must be completed|failed|cancelled'
      }
      return null
    case 'fence_acquired':
      if (!isPositiveInt(value.epoch)) return 'fence_acquired requires epoch >= 1'
      if (!isPositiveInt(value.owner_pid)) return 'fence_acquired requires owner_pid >= 1'
      return null
    default:
      return 'type is not in the frozen journal vocabulary'
  }
}

/** 拒绝特殊文件与逃出 run 目录的硬链接（移植上游 safe-fs.ts L82-90）。 */
export function assertPrivateRegularFile(fileDescriptor, filePath) {
  const stats = fstatSync(fileDescriptor)
  if (!stats.isFile() || stats.nlink !== 1) {
    throw new Error(`contained artifact is not a private regular file: ${filePath}`)
  }
}

/** 最终路径组件是 symlink 即 fail-closed（移植 journal.ts L150-157 的拒绝语义）。 */
function rejectSymbolicLink(filePath) {
  let stats
  try {
    stats = lstatSync(filePath)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  if (stats.isSymbolicLink()) {
    throw new JournalCorruptionError(`journal ${filePath} is a symbolic link`, 1)
  }
}

function openNoFollow(filePath, flags) {
  rejectSymbolicLink(filePath)
  try {
    return openSync(filePath, flags | NO_FOLLOW, 0o600)
  } catch (error) {
    if (error.code === 'ELOOP') {
      throw new JournalCorruptionError(`journal ${filePath} is a symbolic link`, 1)
    }
    throw error
  }
}

/**
 * 失权截断的 win32 回退：原 O_APPEND fd 无截断权限时，开无 O_APPEND 的
 * 第二 fd，仅在 size 仍恰为 expectedSize（后缀确属自家）时截回 initialSize。
 * （P2-13④：导出为测试缝——直接钉 size 守卫语义，不靠 win32 EPERM 时机碰运气。）
 */
export function truncateSuffixViaFreshFd(filePath, expectedSize, initialSize) {
  let fd
  try {
    fd = openNoFollow(filePath, fsConstants.O_WRONLY)
  } catch {
    return
  }
  try {
    if (fstatSync(fd).size !== expectedSize) return
    ftruncateSync(fd, initialSize)
    fsyncSync(fd)
  } catch {
    // 遗留 durable suffix 供 fail-closed 重放（调用处注释语义）。
  } finally {
    closeSync(fd)
  }
}

/** 读 journal 文件全文；文件缺席返回 null。symlink/特殊文件 fail-closed。 */
function readJournalFileNoFollow(filePath) {
  let fd
  try {
    fd = openNoFollow(filePath, fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  try {
    assertPrivateRegularFile(fd, filePath)
    return readFileSync(fd, 'utf8')
  } finally {
    closeSync(fd)
  }
}

function sanitizeFileComponent(value) {
  return String(value).replace(/[^A-Za-z0-9._:-]/g, '_')
}

/**
 * 绑定单个 run 的扁平格式 journal。构造形态对齐上游 FileJournal
 * （journal.ts L94-117）：runsRoot + runId 绑定，assertOwnership 可选回调注入。
 */
export class FileJournal {
  /**
   * @param {string} runsRoot 如 `<cwd>/.omd/graph-runs`
   * @param {string} runId descriptor 供给的 run_id（不信任输入，charset 校验）
   * @param {object} [options]
   * @param {() => void} [options.assertOwnership] fence 持有断言（S4 挂入点）；
   *   每次 append 恰调三次（写前/打开后/fsync 后），失权抛 FENCED_OUT 语义的错。
   * @param {boolean} [options.allowUnfencedAppend] 无 fence 本地模式显式 opt-in
   *   （无跨进程 OCC 互斥保证，见文件头 ⚠️）。
   * @param {number} [options.outputRefThreshold] output_ref 旁路阈值（字节）。
   */
  constructor(runsRoot, runId, options = {}) {
    if (
      typeof runId !== 'string' ||
      !RUN_ID_PATTERN.test(runId) ||
      runId.includes('/') ||
      runId.includes('\\') ||
      runId === '.' ||
      runId === '..'
    ) {
      throw new RangeError('invalid run_id')
    }
    const threshold = options.outputRefThreshold ?? DEFAULT_OUTPUT_REF_THRESHOLD
    if (!Number.isInteger(threshold) || threshold < 0) {
      throw new RangeError('outputRefThreshold must be an integer >= 0')
    }
    this.runsRoot = runsRoot
    this.runId = runId
    this.runDir = join(runsRoot, runId)
    this.assertOwnership = options.assertOwnership
    this.allowUnfencedAppend = options.allowUnfencedAppend === true
    this.outputRefThreshold = threshold
    // P2-11（IC-09）：maxSeq 进程内缓存的失权失效键——fence epoch 变化/缺席即重读。
    this.getOwnershipEpoch = options.getOwnershipEpoch
    this._seqCache = null
  }

  /**
   * 追加一条扁平记录（同步临界区；seq 由 journal 以 OCC 续号，调用方不得自带）。
   * record.ts 可显式供给（模型手写 journal 场景），缺省取当前时间。
   * record.output 超过 outputRefThreshold（字节）时旁路写 outputs/，行内只记
   * output_ref；outputs/ 孤儿文件（output 写完、journal append 前崩溃）良性，
   * 恢复重跑覆盖即可（计划 §5 Q3 末句）。
   */
  append(record) {
    if (this.assertOwnership === undefined && !this.allowUnfencedAppend) {
      throw new Error(
        'FileJournal.append requires an assertOwnership callback (fence-bound ' +
          'writer); pass allowUnfencedAppend: true to opt into unfenced local mode',
      )
    }
    this.assertOwnership?.() // 三段式 1/3：写前（上游 journal.ts L127）
    const committed = this.prepareRecord(record)
    const line = `${JSON.stringify(committed)}\n`
    mkdirSync(this.runDir, { recursive: true })
    const filePath = join(this.runDir, JOURNAL_FILE_NAME)
    const fd = openNoFollow(
      filePath,
      fsConstants.O_APPEND |
        fsConstants.O_CREAT |
        fsConstants.O_WRONLY |
        (fsConstants.O_NONBLOCK ?? 0),
    )
    try {
      assertPrivateRegularFile(fd, filePath)
      const initialSize = fstatSync(fd).size
      this.assertOwnership?.() // 三段式 2/3：打开后（上游 journal.ts L162）
      let writeCompleted = false
      try {
        // 刻板审查修复（R3-⑰）：短写校验——writeSync 返回值此前被丢弃，短写+fsync
        // 成功会留撕裂行（readAll fail-closed 后 run 永久卡死）。短写即显式失败。
        const written = writeSync(fd, line)
        if (written !== Buffer.byteLength(line))
          throw new Error(`journal short write: ${written}/${Buffer.byteLength(line)} bytes（撕裂行防线）`)
        writeCompleted = true
        fsyncSync(fd)
        // 发布边界：写/fsync 在飞期间失权 → 经原 fd 只截断自家后缀，
        // 再放行 stale transition（上游 journal.ts L168-171）。
        this.assertOwnership?.() // 三段式 3/3：fsync 后
        if (this._seqCache !== null) this._seqCache.max = committed.seq // P2-11：缓存随成功 append 前进
      } catch (error) {
        if (writeCompleted) {
          const expectedSize = initialSize + Buffer.byteLength(line)
          let truncated = false
          try {
            if (fstatSync(fd).size === expectedSize) {
              ftruncateSync(fd, initialSize)
              fsyncSync(fd)
              truncated = true
            }
          } catch {
            truncated = false
          }
          if (!truncated && fstatSync(fd).size === expectedSize) {
            // win32 实测：O_APPEND 句柄是 append-only，ftruncate 恒 EPERM——
            // 回退开无 O_APPEND 的第二 fd，size 守卫一致才截自家后缀。
            truncateSuffixViaFreshFd(filePath, expectedSize, initialSize)
          }
          // 仍失败或 size 已变（他人追加同 inode / fd 不可用）→ 遗留
          // durable suffix 供 fail-closed 重放，绝不误截他人数据
          // （上游 journal.ts L181-185 语义不变）。
        }
        throw error
      }
    } finally {
      closeSync(fd)
    }
  }

  /**
   * 读全部记录。逐行校验 fail-closed：坏行/截断半行/seq 乱序 →
   * JournalCorruptionError（20 语义），绝不静默返回部分数据。
   * options.verifyDescriptorHash=true 时比对首行 run_started.descriptor_hash
   * 与 descriptor.json 快照重算值，漂移 → DescriptorDriftError（21 语义）。
   * journal 文件缺席返回 []（verifyDescriptorHash 下空 journal 视为漂移：
   * 无 run_started 可绑定）。
   */
  readAll(options = {}) {
    const filePath = join(this.runDir, JOURNAL_FILE_NAME)
    const content = readJournalFileNoFollow(filePath)
    if (content === null || content.length === 0) {
      if (options.verifyDescriptorHash === true) {
        throw new DescriptorDriftError(
          `journal ${filePath} has no run_started record to bind`,
        )
      }
      return []
    }

    const lines = content.split('\n')
    const tailIsIncomplete = lines[lines.length - 1] !== ''
    const bodyLines = lines.slice(0, -1)

    // 先计数全部坏行（中间 + 截断尾部），再一次性抛（上游 journal.ts L234-269）。
    let badCount = tailIsIncomplete ? 1 : 0
    const records = []
    let prevSeq = JOURNAL_BASE_SEQ - 1

    for (const line of bodyLines) {
      let failure = null
      let parsed
      try {
        parsed = JSON.parse(line)
      } catch {
        failure = 'line is not valid JSON'
      }
      if (failure === null) failure = flatRecordError(parsed)
      if (failure === null) {
        const expectedSeq = prevSeq + 1
        if (parsed.seq !== expectedSeq) {
          failure = `seq ${parsed.seq} does not continue from ${prevSeq}`
        } else {
          prevSeq = parsed.seq
          records.push(parsed)
        }
      }
      if (failure !== null) badCount += 1
    }

    if (badCount > 0) {
      throw new JournalCorruptionError(
        `journal ${filePath} has ${badCount} corrupt or incomplete record(s)`,
        badCount,
      )
    }
    if (options.verifyDescriptorHash === true) {
      this.assertDescriptorBinding(records)
    }
    return records
  }

  /** 当前最大 seq（无记录时为 BASE_SEQ-1=0）；恢复续号语义 = maxSeq()+1。 */
  maxSeq() {
    // P2-11（IC-09）：fence 持有期内进程内缓存（append 每次全文件 readAll 的读放大闭合）。
    // 缓存键=所有权 epoch：失权/换主自动失效重读；无 fence 本地模式不缓存（无互斥保证）。
    const epoch = typeof this.getOwnershipEpoch === 'function' ? this.getOwnershipEpoch() : null
    if (epoch !== null && epoch !== undefined && this._seqCache?.epoch === epoch) return this._seqCache.max
    const records = this.readAll()
    const max = records.length === 0 ? JOURNAL_BASE_SEQ - 1 : records[records.length - 1].seq
    if (epoch !== null && epoch !== undefined) this._seqCache = { epoch, max }
    return max
  }

  /** run_started.descriptor_hash 与 descriptor.json 快照重算比对（21 语义）。 */
  assertDescriptorBinding(records) {
    const filePath = join(this.runDir, JOURNAL_FILE_NAME)
    const started = records[0]
    if (started === undefined || started.type !== 'run_started') {
      throw new DescriptorDriftError(
        `journal ${filePath} has no run_started record to bind`,
      )
    }
    const snapshotPath = join(this.runDir, DESCRIPTOR_SNAPSHOT_NAME)
    let raw
    try {
      // 刻板审查修复（R3-⑱）：快照读取收进本文件 safe-fs 纪律（openNoFollow +
      // assertPrivateRegularFile），不再裸 readFileSync——与 journal/outputs 全路径一致
      raw = readJournalFileNoFollow(snapshotPath)
      if (raw === null) throw Object.assign(new Error('snapshot missing'), { code: 'ENOENT' })
    } catch (error) {
      throw new DescriptorDriftError(
        `descriptor snapshot unreadable: ${error.code ?? error.message}`,
      )
    }
    let snapshot
    try {
      snapshot = JSON.parse(raw)
    } catch {
      throw new DescriptorDriftError('descriptor snapshot is not valid JSON')
    }
    let recomputed
    try {
      recomputed = computeDescriptorHash(snapshot)
    } catch (error) {
      throw new DescriptorDriftError(
        `descriptor snapshot cannot be hashed: ${error.message}`,
      )
    }
    if (recomputed !== started.descriptor_hash) {
      throw new DescriptorDriftError(
        'descriptor snapshot drifted from journal run_started.descriptor_hash',
      )
    }
  }

  /** OCC 续号 + ts 填充 + output_ref 旁路 + 写前校验（fail-closed writer）。 */
  prepareRecord(record) {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      throw new RangeError('journal record must be an object')
    }
    if ('seq' in record) {
      throw new RangeError('journal owns seq (OCC); do not supply it')
    }
    const seq = this.maxSeq() + 1 // fence 持有期内的写前读 max 续号（计划 §5 Q3）
    const committed = { seq, ts: new Date().toISOString(), ...record }
    const failure = flatRecordError(committed)
    if (failure !== null) {
      throw new RangeError(`invalid journal record: ${failure}`)
    }
    if (
      typeof committed.output === 'string' &&
      Buffer.byteLength(committed.output, 'utf8') > this.outputRefThreshold
    ) {
      committed.output_ref = this.writeOutput(committed)
      delete committed.output
    }
    return committed
  }

  /** 大输出旁路写 outputs/；返回 journal 行记录的相对 output_ref。 */
  writeOutput(committed) {
    const nodePart = sanitizeFileComponent(committed.node_id ?? 'output')
    const attemptPart = sanitizeFileComponent(committed.attempt ?? committed.seq)
    const name = `${nodePart}.${attemptPart}.md`
    const outputsDir = join(this.runDir, OUTPUTS_DIR_NAME)
    mkdirSync(outputsDir, { recursive: true })
    // P2-6（IC-06）：outputs 旁路写复用主路径同款 safe-fs 纪律——symlink 拒绝
    // （openNoFollow）+ 私有常规文件断言（assertPrivateRegularFile）；直写
    // writeFileSync 零检查的破口闭合，防护纪律全路径一致。
    const file = join(outputsDir, name)
    const fd = openNoFollow(file, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC)
    try {
      assertPrivateRegularFile(fd, file)
      writeFileSync(fd, committed.output, 'utf8')
    } finally {
      closeSync(fd)
    }
    return `${OUTPUTS_DIR_NAME}/${name}`
  }
}
