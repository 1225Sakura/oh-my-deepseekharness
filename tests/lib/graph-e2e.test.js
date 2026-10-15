// tests/lib/graph-e2e.test.js
// U4 S4b — graph runtime e2e 矩阵（计划 .omd/plans/ralplan-u4-graph-runtime.md
// §4 e2e 段、§6 验收 2/3/4/5/7）——全部真实跨进程：tests/lib/helpers/
// graph-e2e-driver.mjs 由 vitest 进程 spawn 为独立 node 进程跑 runGraph，
// 中途 process.kill 模拟 MCP server 崩溃（fence lock 遗留 → stale 接管路径）。
// 任务书七组 ↔ 验收条目：
//  ① kill 恢复（验收 2）：committed 零重跑 / scheduled-uncommitted 重跑 /
//     seq 从 max+1 续号（journal 行序逐行断言）；
//  ② descriptor 快照篡改 → exit 21（验收 3 前半）；
//  ③ journal 截半行 → exit 20（验收 3 后半）；
//  ④ 跨进程双写者 fence-19（验收 4 前半）：进程 A 持 fence 运行中，进程 B
//     同 run_id → exit 19，A 不受影响跑完；
//  ⑤ stale 接管续跑（验收 4 后半）：owner kill + staleGraceMs 缩短 →
//     --takeover resume → fence_acquired{epoch+1,owner_pid} 落 journal +
//     续跑至 completed（与 ① 同走 takeover 路径，本组断言 fence 审计语义）；
//  ⑥ timeout 强杀（验收 7）：Start-Sleep 超 timeout_ms → node_failed
//     {retryable:true} → 重试 → 超限 run failed exit 1；以 pid 旁证文件 +
//     isProcessAlive 轮询断言 pwsh 子/孙进程全部被 taskkill /T /F 收割；
//  ⑦ concurrency_limit=2 并发峰值（验收 5）：3 个独立 command 节点经 fixed
//     边汇入 terminal，
//     UtcNow.Ticks 起止文件 + 区间扫描确定性断言峰值 <=2（解读钉死 A），
//     并以 journal 行序断言首批恰好放行 2 个。
// flake 防御：所有现场等待走轮询（journal 记录出现 / fence isStalled /
// marker 行数 / 进程死亡），零定长 sleep 依赖；fixture 全落 mkdtemp(tmpdir)。
// fixture 说明：tests/lib/fixtures/graph-simple-linear.json 的链式结构被 ①
// 借形，但命令改为 Add-Content 追加式 marker——fixture 自带的 writeFileSync
// 覆盖写 marker 无法用行数证明「committed 零重跑」，e2e 断言需要 append 语义。

import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FENCE_LOCK_NAME,
  OwnerFence,
  isProcessAlive,
} from '../../lib/graph/fence.js'
import {
  DESCRIPTOR_SNAPSHOT_NAME,
  JOURNAL_FILE_NAME,
} from '../../lib/graph/journal.js'

const DRIVER_PATH = fileURLToPath(
  new URL('./helpers/graph-e2e-driver.mjs', import.meta.url),
)

const temps = []
function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}
afterEach(() => {
  while (temps.length > 0) {
    try {
      rmSync(temps.pop(), {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      })
    } catch {
      // orphan
    }
  }
})

// ---- fixture 组装（tmp 落盘，driver 经 --descriptor 读入重新 seal） ----

let draftSeq = 0

function commandNode(id, command, overrides = {}) {
  return {
    id,
    kind: 'command',
    title: id,
    timeout_ms: 60_000,
    max_attempts: 3,
    effect_policy: { policy: 'side_effect_free' },
    command,
    ...overrides,
  }
}

function agentNode(id) {
  return {
    id,
    kind: 'agent',
    title: id,
    timeout_ms: 60_000,
    max_attempts: 3,
    effect_policy: { policy: 'side_effect_free' },
    instructions: 'park here (e2e)',
  }
}

function writeDraft(dir, name, spec) {
  draftSeq += 1
  const draft = {
    descriptor_version: 1,
    run_id: 'e2e-s4b-' + name + '-' + draftSeq,
    revision_id: 'rev-' + name,
    goal: 'e2e ' + name,
    nodes: spec.nodes,
    edges: spec.edges ?? [],
    entry_node_ids: spec.entries,
    concurrency_limit: spec.concurrency,
    terminal_verification_node_id: spec.terminal,
  }
  const path = join(dir, name + '.draft.json')
  writeFileSync(path, JSON.stringify(draft, null, 2), 'utf8')
  return path
}

function draftRunId(draftPath) {
  return JSON.parse(readFileSync(draftPath, 'utf8')).run_id
}

function appendMarker(marker) {
  return (
    "Add-Content -Path (Join-Path $env:GRAPH_E2E_MARKER_DIR '" +
    marker +
    ".markers') -Value $env:GRAPH_ATTEMPT"
  )
}

// ---- driver 子进程与轮询基建 ----

function spawnDriver(workDir, args, extraEnv = {}) {
  const child = spawn(process.execPath, [DRIVER_PATH, ...args], {
    cwd: workDir,
    env: { ...process.env, ...extraEnv },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk) => {
    stdout += chunk.toString('utf8')
  })
  const exited = new Promise((resolve) => {
    child.on('close', (code) => resolve(code))
    child.on('error', () => resolve(-1))
  })
  return { child, exited, stdoutText: () => stdout }
}

async function runDriver(workDir, args, extraEnv = {}) {
  const driver = spawnDriver(workDir, args, extraEnv)
  const code = await driver.exited
  return { code, stdout: driver.stdoutText() }
}

function parseResultLine(stdout) {
  const lines = stdout.split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].startsWith('GRAPH_E2E_RESULT ')) {
      return JSON.parse(lines[i].slice('GRAPH_E2E_RESULT '.length))
    }
  }
  throw new Error('driver emitted no GRAPH_E2E_RESULT line; output: ' + stdout)
}

function journalPath(runsRoot, runId) {
  return join(runsRoot, runId, JOURNAL_FILE_NAME)
}

function readJournalRecords(runsRoot, runId) {
  const path = journalPath(runsRoot, runId)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter((record) => record !== null)
}

function markerLines(dir, marker) {
  const path = join(dir, marker + '.markers')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.replace(/\r$/, '')) // pwsh Add-Content 写 CRLF
    .filter((line) => line.length > 0)
}

const POLL_INTERVAL_MS = 40

async function pollUntil(label, timeoutMs, probe) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = probe()
    if (value) return value
    if (Date.now() >= deadline) {
      throw new Error('pollUntil timeout after ' + timeoutMs + 'ms: ' + label)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

// ---- 七组 e2e ----

describe('graph e2e（U4 S4b，真实跨进程）', () => {
  it('① kill 恢复：committed 零重跑 / scheduled-uncommitted 重跑 / seq 从 max+1 续号', async () => {
    const workDir = makeTempDir('omd-graph-e2e-kill-')
    const runsRoot = join(workDir, 'runs')
    const draftPath = writeDraft(workDir, 'kill', {
      nodes: [
        commandNode('n1', appendMarker('n1')),
        commandNode('n2', appendMarker('n2') + '; Start-Sleep -Milliseconds 2500'),
        commandNode('n3', appendMarker('n3')),
        commandNode('term', appendMarker('term')),
      ],
      edges: [
        { id: 'e-n1-n2', kind: 'fixed', from: 'n1', to: 'n2' },
        { id: 'e-n2-n3', kind: 'fixed', from: 'n2', to: 'n3' },
        { id: 'e-n3-term', kind: 'fixed', from: 'n3', to: 'term' },
      ],
      entries: ['n1'],
      concurrency: 1,
      terminal: 'term',
    })
    const runId = draftRunId(draftPath)

    // P2-3（IC-03）后 stalled 判定以 run 持久化宽限为准——首跑显式给短宽限，
    // 否则 30s 默认随行，观测侧短宽限不再生效（这正是本修复的语义）。
    const first = spawnDriver(
      workDir,
      ['--descriptor', draftPath, '--runs-root', runsRoot, '--stale-grace-ms', '200'],
      { GRAPH_E2E_MARKER_DIR: workDir },
    )
    // 等 n2 的 attempt1 副作用可见（marker 落盘）再杀：此刻 n2 仍在 2500ms
    // sleep 窗口内必然未 committed；杀后孤儿进程存活与否不影响任何断言。
    await pollUntil('n2 attempt1 marker 落盘（副作用已发生）', 15_000, () =>
      markerLines(workDir, 'n2').length >= 1,
    )
    process.kill(first.child.pid)
    const firstCode = await first.exited
    expect(firstCode).not.toBe(0)

    const graceMs = 200
    await pollUntil('fence stalled（pid 死亡 + lease 过期）', 10_000, () =>
      new OwnerFence(runsRoot, runId, { staleGraceMs: graceMs }).isStalled(),
    )
    const resume = spawnDriver(
      workDir,
      [
        '--descriptor',
        draftPath,
        '--runs-root',
        runsRoot,
        '--takeover',
        '--stale-grace-ms',
        String(graceMs),
      ],
      { GRAPH_E2E_MARKER_DIR: workDir },
    )
    const resumeCode = await resume.exited
    const result = parseResultLine(resume.stdoutText())
    expect(resumeCode).toBe(0)
    expect(result.exit_code).toBe(0)
    expect(result.terminal_status).toBe('completed')
    expect(result.status).toBe('completed')

    const records = readJournalRecords(runsRoot, runId)
    expect(records.map((record) => record.type)).toEqual([
      'run_started',
      'node_scheduled',
      'node_committed',
      'node_scheduled',
      'fence_acquired',
      'node_scheduled',
      'node_committed',
      'node_scheduled',
      'node_committed',
      'node_scheduled',
      'node_committed',
      'run_finished',
    ])
    expect(records.map((record) => record.seq)).toEqual(records.map((record, index) => index + 1))
    const n1Rows = records.filter((record) => record.node_id === 'n1')
    expect(n1Rows.map((record) => record.type + '@' + String(record.attempt))).toEqual([
      'node_scheduled@1',
      'node_committed@1',
    ])
    const n2Rows = records.filter((record) => record.node_id === 'n2')
    expect(n2Rows.map((record) => record.type + '@' + String(record.attempt))).toEqual([
      'node_scheduled@1',
      'node_scheduled@2',
      'node_committed@2',
    ])
    const fenceRow = records.find((record) => record.type === 'fence_acquired')
    expect(fenceRow.epoch).toBe(2)
    expect(fenceRow.owner_pid).toBe(resume.child.pid)
    expect(records[records.length - 1].terminal_status).toBe('completed')

    // 副作用证据：n1 恰执行一次（committed 零重跑）；n2 两次（attempt1 副作用
    // 杀前已落盘 + attempt2 重跑，at-least-once）。
    await pollUntil('n2 重跑 marker 落盘', 10_000, () => markerLines(workDir, 'n2').length >= 2)
    expect(markerLines(workDir, 'n1')).toEqual(['1'])
    const n2Markers = [...markerLines(workDir, 'n2')].sort()
    expect(n2Markers).toEqual(['1', '2'])
    expect(markerLines(workDir, 'n3')).toEqual(['1'])
    expect(markerLines(workDir, 'term')).toEqual(['1'])
  }, 45_000)

  it('② descriptor 快照篡改 → resume exit 21（journal 原样不动）', async () => {
    const workDir = makeTempDir('omd-graph-e2e-tamper-')
    const runsRoot = join(workDir, 'runs')
    const draftPath = writeDraft(workDir, 'tamper', {
      nodes: [agentNode('a1')],
      entries: ['a1'],
      concurrency: 1,
      terminal: 'a1',
    })
    const runId = draftRunId(draftPath)

    // 首跑停在 agent_pending 等待点：fence 已随返回释放，resume 无需 takeover。
    const first = await runDriver(workDir, ['--descriptor', draftPath, '--runs-root', runsRoot], {
      GRAPH_E2E_MARKER_DIR: workDir,
    })
    const parked = parseResultLine(first.stdout)
    expect(first.code).toBe(0)
    expect(parked.exit_code).toBe(0)
    expect(parked.status).toBe('waiting')

    const snapshotPath = join(runsRoot, runId, DESCRIPTOR_SNAPSHOT_NAME)
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))
    snapshot.goal = 'tampered goal (e2e)'
    writeFileSync(snapshotPath, JSON.stringify(snapshot), 'utf8')

    const before = readFileSync(journalPath(runsRoot, runId), 'utf8')
    const second = await runDriver(workDir, ['--descriptor', draftPath, '--runs-root', runsRoot], {
      GRAPH_E2E_MARKER_DIR: workDir,
    })
    const result = parseResultLine(second.stdout)
    expect(second.code).toBe(21)
    expect(result.exit_code).toBe(21)
    // 漂移在 fence_acquired 落账之前被拒：journal 一个字节都不动。
    expect(readFileSync(journalPath(runsRoot, runId), 'utf8')).toBe(before)
  }, 20_000)

  it('③ journal 截半行 → resume exit 20', async () => {
    const workDir = makeTempDir('omd-graph-e2e-trunc-')
    const runsRoot = join(workDir, 'runs')
    const draftPath = writeDraft(workDir, 'trunc', {
      nodes: [agentNode('a1')],
      entries: ['a1'],
      concurrency: 1,
      terminal: 'a1',
    })
    const runId = draftRunId(draftPath)

    const first = await runDriver(workDir, ['--descriptor', draftPath, '--runs-root', runsRoot], {
      GRAPH_E2E_MARKER_DIR: workDir,
    })
    expect(first.code).toBe(0)

    // 人为截掉最后一条记录的后半行（fail-closed 重放的真实损坏形态）。
    const path = journalPath(runsRoot, runId)
    const lines = readFileSync(path, 'utf8').split('\n')
    const last = lines[lines.length - 2]
    lines[lines.length - 2] = last.slice(0, Math.floor(last.length / 2))
    writeFileSync(path, lines.join('\n'), 'utf8')

    const before = readFileSync(path, 'utf8')
    const second = await runDriver(workDir, ['--descriptor', draftPath, '--runs-root', runsRoot], {
      GRAPH_E2E_MARKER_DIR: workDir,
    })
    const result = parseResultLine(second.stdout)
    expect(second.code).toBe(20)
    expect(result.exit_code).toBe(20)
    expect(readFileSync(path, 'utf8')).toBe(before)
  }, 20_000)

  it('④ 跨进程双写者：A 持 fence 运行中，B 同 run_id → exit 19，A 不受影响', async () => {
    const workDir = makeTempDir('omd-graph-e2e-fence19-')
    const runsRoot = join(workDir, 'runs')
    const draftPath = writeDraft(workDir, 'fence19', {
      nodes: [commandNode('slow', 'Start-Sleep -Seconds 4')],
      entries: ['slow'],
      concurrency: 1,
      terminal: 'slow',
    })
    const runId = draftRunId(draftPath)

    const first = spawnDriver(workDir, ['--descriptor', draftPath, '--runs-root', runsRoot], {
      GRAPH_E2E_MARKER_DIR: workDir,
    })
    // owner.lock 在 run_started 之前创建：出现即 A 已持 fence。
    await pollUntil('owner.lock 出现', 15_000, () =>
      existsSync(join(runsRoot, runId, FENCE_LOCK_NAME)),
    )

    const second = await runDriver(workDir, ['--descriptor', draftPath, '--runs-root', runsRoot], {
      GRAPH_E2E_MARKER_DIR: workDir,
    })
    const rejected = parseResultLine(second.stdout)
    expect(second.code).toBe(19)
    expect(rejected.exit_code).toBe(19)

    // A 不受影响，续跑至完成；journal 无 B 痕迹（fence_acquired 仅 resume 出现）。
    const firstCode = await first.exited
    expect(firstCode).toBe(0)
    const records = readJournalRecords(runsRoot, runId)
    expect(records[0].type).toBe('run_started')
    expect(records.some((record) => record.type === 'fence_acquired')).toBe(false)
    expect(records[records.length - 1]).toMatchObject({
      type: 'run_finished',
      terminal_status: 'completed',
    })
  }, 30_000)

  it('⑤ stale 接管续跑：owner kill + 缩短宽限 → takeover → fence_acquired + completed', async () => {
    const workDir = makeTempDir('omd-graph-e2e-takeover-')
    const runsRoot = join(workDir, 'runs')
    const draftPath = writeDraft(workDir, 'takeover', {
      nodes: [commandNode('slow', 'Start-Sleep -Seconds 5')],
      entries: ['slow'],
      concurrency: 1,
      terminal: 'slow',
    })
    const runId = draftRunId(draftPath)

    const graceMs = 250
    // P2-3（IC-03）后 stalled 判定以 run 持久化宽限为准——首跑带同值短宽限（语义对齐）。
    const first = spawnDriver(
      workDir,
      ['--descriptor', draftPath, '--runs-root', runsRoot, '--stale-grace-ms', String(graceMs)],
      { GRAPH_E2E_MARKER_DIR: workDir },
    )
    // 等子进程确已出发（node_scheduled 先于 spawn 收尾落账）再杀 owner。
    await pollUntil('node_scheduled 出现', 15_000, () =>
      readJournalRecords(runsRoot, runId).some(
        (record) => record.type === 'node_scheduled',
      ),
    )
    process.kill(first.child.pid)
    await first.exited

    // 真实 stalled 条件轮询（lease 过期 + pid 死亡双条件），非定长 sleep。
    await pollUntil('fence stalled', 10_000, () =>
      new OwnerFence(runsRoot, runId, { staleGraceMs: graceMs }).isStalled(),
    )

    const resume = spawnDriver(
      workDir,
      [
        '--descriptor',
        draftPath,
        '--runs-root',
        runsRoot,
        '--takeover',
        '--stale-grace-ms',
        String(graceMs),
      ],
      { GRAPH_E2E_MARKER_DIR: workDir },
    )
    const resumeCode = await resume.exited
    const result = parseResultLine(resume.stdoutText())
    expect(resumeCode).toBe(0)
    expect(result.exit_code).toBe(0)
    expect(result.terminal_status).toBe('completed')

    const records = readJournalRecords(runsRoot, runId)
    expect(records.map((record) => record.type)).toEqual([
      'run_started',
      'node_scheduled',
      'fence_acquired',
      'node_scheduled',
      'node_committed',
      'run_finished',
    ])
    const fenceRow = records.find((record) => record.type === 'fence_acquired')
    expect(fenceRow.epoch).toBe(2)
    expect(fenceRow.owner_pid).toBe(resume.child.pid)
    expect(
      records
        .filter((record) => record.type === 'node_scheduled')
        .map((record) => record.attempt),
    ).toEqual([1, 2])
  }, 40_000)

  it('⑥ timeout 强杀：node_failed{retryable} + 重试 → 超限 exit 1；无 pwsh 孙子进程残留', async () => {
    const workDir = makeTempDir('omd-graph-e2e-timeout-')
    const runsRoot = join(workDir, 'runs')
    // timeout_ms 1200 > pwsh 启动 ~300-500ms 余量（S4a 实证）；孙子进程由
    // Start-Process 再生一层，taskkill /T /F 必须整树收割。
    const command =
      '$dir = $env:GRAPH_E2E_MARKER_DIR; ' +
      "Set-Content -Path (Join-Path $dir ('child-' + $env:GRAPH_ATTEMPT + '.pid')) -Value $PID; " +
      "$g = Start-Process pwsh -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 30' -PassThru -WindowStyle Hidden; " +
      "Set-Content -Path (Join-Path $dir ('grandchild-' + $env:GRAPH_ATTEMPT + '.pid')) -Value $g.Id; " +
      'Start-Sleep -Seconds 30'
    const draftPath = writeDraft(workDir, 'timeout', {
      nodes: [commandNode('slowpoke', command, { timeout_ms: 1200, max_attempts: 2 })],
      entries: ['slowpoke'],
      concurrency: 1,
      terminal: 'slowpoke',
    })
    const runId = draftRunId(draftPath)

    const { code, stdout } = await runDriver(workDir, ['--descriptor', draftPath, '--runs-root', runsRoot], {
      GRAPH_E2E_MARKER_DIR: workDir,
    })
    const result = parseResultLine(stdout)
    expect(code).toBe(1)
    expect(result.exit_code).toBe(1)
    expect(result.terminal_status).toBe('failed')

    const records = readJournalRecords(runsRoot, runId)
    const failures = records.filter((record) => record.type === 'node_failed')
    expect(failures.map((record) => [record.attempt, record.retryable])).toEqual([
      [1, true],
      [2, false],
    ])
    expect(failures.every((record) => record.error.includes('timeout'))).toBe(true)
    expect(records[records.length - 1]).toMatchObject({
      type: 'run_finished',
      terminal_status: 'failed',
    })

    // 两次 attempt 的 pwsh 子 + 孙全部死亡（pid 旁证文件 + isProcessAlive 轮询）。
    const pids = ['child-1', 'grandchild-1', 'child-2', 'grandchild-2'].map(
      (name) => Number(readFileSync(join(workDir, name + '.pid'), 'utf8').trim()),
    )
    expect(pids.every((pid) => Number.isInteger(pid) && pid > 0)).toBe(true)
    await pollUntil('全部子/孙进程死亡（无残留）', 10_000, () =>
      pids.every((pid) => !isProcessAlive(pid)),
    )
  }, 40_000)

  it('⑦ concurrency_limit=2：并发观测峰值 <=2（Ticks 区间扫描 + journal 首批放行断言）', async () => {
    const workDir = makeTempDir('omd-graph-e2e-conc-')
    const runsRoot = join(workDir, 'runs')
    const tickNode = (id) =>
      commandNode(
        id,
        '$dir = $env:GRAPH_E2E_MARKER_DIR; ' +
          "[DateTime]::UtcNow.Ticks | Set-Content -Path (Join-Path $dir ('" +
          id +
          ".start')); " +
          'Start-Sleep -Milliseconds 400; ' +
          "[DateTime]::UtcNow.Ticks | Set-Content -Path (Join-Path $dir ('" +
          id +
          ".end'))",
      )
    const draftPath = writeDraft(workDir, 'conc', {
      // 校验要求全节点可达 terminal：三个 tick 节点经 fixed 边汇入 t。
      nodes: [
        tickNode('c1'),
        tickNode('c2'),
        tickNode('c3'),
        commandNode('t', 'Write-Output done'),
      ],
      edges: [
        { id: 'e-c1-t', kind: 'fixed', from: 'c1', to: 't' },
        { id: 'e-c2-t', kind: 'fixed', from: 'c2', to: 't' },
        { id: 'e-c3-t', kind: 'fixed', from: 'c3', to: 't' },
      ],
      entries: ['c1', 'c2', 'c3'],
      concurrency: 2,
      terminal: 't',
    })
    const runId = draftRunId(draftPath)

    const { code, stdout } = await runDriver(workDir, ['--descriptor', draftPath, '--runs-root', runsRoot], {
      GRAPH_E2E_MARKER_DIR: workDir,
    })
    const result = parseResultLine(stdout)
    expect(code).toBe(0)
    expect(result.exit_code).toBe(0)
    expect(result.terminal_status).toBe('completed')

    // journal 行序：首批恰好放行 2 个（c1/c2 scheduled 相邻且先于首个 committed），
    // c3 被闸在下一波。
    const records = readJournalRecords(runsRoot, runId)
    expect(records[0].type).toBe('run_started')
    expect(records.slice(1, 3).map((record) => [record.type, record.node_id])).toEqual([
      ['node_scheduled', 'c1'],
      ['node_scheduled', 'c2'],
    ])
    expect(records[3].type).toBe('node_committed')
    expect(records.filter((record) => record.type === 'node_committed')).toHaveLength(4)
    expect(records[records.length - 1]).toMatchObject({
      type: 'run_finished',
      terminal_status: 'completed',
    })

    // 真实进程并发观测：UtcNow.Ticks 起止区间扫描，任一时刻在飞 <=2
    // （同刻 end 优先计入，保守方向）。
    const intervals = ['c1', 'c2', 'c3'].map((id) => ({
      id,
      start: BigInt(readFileSync(join(workDir, id + '.start'), 'utf8').trim()),
      end: BigInt(readFileSync(join(workDir, id + '.end'), 'utf8').trim()),
    }))
    expect(intervals.every((interval) => interval.end > interval.start)).toBe(true)
    const events = intervals.flatMap((interval) => [
      { at: interval.start, delta: 1 },
      { at: interval.end, delta: -1 },
    ])
    events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.delta - b.delta))
    let inflight = 0
    let peak = 0
    for (const event of events) {
      inflight += event.delta
      peak = Math.max(peak, inflight)
    }
    expect(peak).toBeLessThanOrEqual(2)
  }, 30_000)
})
