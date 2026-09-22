// tests/lib/worktree.test.js
// c5 team worktree 隔离验收（台账 m3-advance S5，R18 表逐行落槽）：
// C1 断言①：run 启动 → .omd/worktrees/{run-id} 存在（gitignored，从当前 HEAD git worktree add）
// C2 断言②：verify 通过 → run-state 先写 disposed 终态（CAS 成功）→ 树删除后目录消失（终态时间戳 < 删树时间）
// C3 断言③：取消 → 删前列树内与 HEAD 差异文件（只提示不阻塞）；孤儿扫描只提示绝不自动删
// G6：全部落 OS 临时夹具仓，零触碰日常 .omd。
import { test, expect } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  TERMINAL_STATES, worktreesPath, runStatePath, ensureGitignored,
  beginTeamRun, listTreeDiff, disposeRunWorktree, cancelTeamRun, scanOrphans,
} from '../../lib/worktree.js'
import { readJson } from '../../mcp-server/lib/atomic.mjs'

/** 临时 git 夹具仓（单提交 HEAD）；g 现场执行 git 命令。 */
async function makeFixtureRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'omd-c5-'))
  const g = (...args) => execFileSync('git', args.flat(), { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  g(['init', '-q'])
  g(['config', 'user.email', 'omd-test@example.com'])
  g(['config', 'user.name', 'omd-test'])
  g(['config', 'commit.gpgsign', 'false'])
  await writeFile(join(dir, 'README.md'), '# fixture\n', 'utf8')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'init'])
  return { dir, g }
}

test('TERMINAL_STATES 仅 disposed（spec out-of-scope：不含新终态）', () => {
  expect(TERMINAL_STATES).toEqual(['disposed'])
})

test('非法 runId（路径分隔/空/非法字符）在写入任何状态前抛错', async () => {
  const { dir } = await makeFixtureRepo()
  try {
    for (const bad of ['../evil', 'a/b', '', 'run id', 'x.y']) {
      await expect(beginTeamRun({ cwd: dir, runId: bad })).rejects.toThrow(/runId/)
    }
    expect(existsSync(worktreesPath(dir))).toBe(false) // 未发生任何建树
    expect(existsSync(runStatePath(dir))).toBe(false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---- C1 断言①：run 启动 → .omd/worktrees/{run-id} 存在（gitignored，从当前 HEAD 建） ----
test('C1 run 启动建树：目录存在、gitignored、树 HEAD == 主仓 HEAD、run-state 记 active', async () => {
  const { dir, g } = await makeFixtureRepo()
  try {
    const head = g(['rev-parse', 'HEAD'])
    const r = await beginTeamRun({ cwd: dir, runId: 'run-c1' })
    const tree = join(dir, '.omd', 'worktrees', 'run-c1')
    expect(r.path).toBe(tree)
    expect(existsSync(tree)).toBe(true) // 断言①：目录存在
    expect(g(['check-ignore', '-q', '.omd/worktrees/run-c1'])).toBe('') // gitignored（exit 0 即忽略）
    expect(g(['-C', tree, 'rev-parse', 'HEAD'])).toBe(head) // 从当前 HEAD 建
    const state = await readJson(runStatePath(dir))
    expect(state).toMatchObject({ runId: 'run-c1', status: 'active', version: 1 })
    expect(typeof state.createdAt).toBe('string')
    expect(existsSync(runStatePath(dir))).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('ensureGitignored：未忽略仓恰追加一行且幂等；整仓忽略 .omd/ 的仓库零追加', async () => {
  const { dir } = await makeFixtureRepo()
  try {
    const first = await ensureGitignored(dir)
    expect(first.appended).toBe(true)
    const content1 = await readFile(join(dir, '.gitignore'), 'utf8')
    expect(content1).toContain('.omd/worktrees/')
    expect(content1.split('\n').filter(l => l.trim() === '.omd/worktrees/').length).toBe(1) // 规则行恰一条
    const second = await ensureGitignored(dir)
    expect(second.appended).toBe(false) // 幂等：已忽略不再追加
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe(content1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  const { dir: dir2 } = await makeFixtureRepo()
  try {
    await writeFile(join(dir2, '.gitignore'), '.omd/\n', 'utf8')
    const r = await ensureGitignored(dir2)
    expect(r.appended).toBe(false) // 整仓忽略 .omd/ → check-ignore 已命中，零改动
  } finally {
    await rm(dir2, { recursive: true, force: true })
  }
})

// ---- C2 断言②：CAS 写 disposed → 删树（时序：终态先于删树；CAS 不成功绝不删树） ----
test('C2 两阶段拆除：disposed 先落 run-state（CAS 成功）→ 树消失；终态时间戳 < 删树时间', async () => {
  const { dir } = await makeFixtureRepo()
  try {
    await beginTeamRun({ cwd: dir, runId: 'run-c2' })
    const tree = join(dir, '.omd', 'worktrees', 'run-c2')
    const before = await readJson(runStatePath(dir))
    const r = await disposeRunWorktree({ cwd: dir, runId: 'run-c2', expectUpdatedAt: before.updatedAt })
    expect(existsSync(tree)).toBe(false) // 断言②：树删除后目录消失
    const state = await readJson(runStatePath(dir))
    expect(state.status).toBe('disposed') // 终态落 run-state
    expect(state.disposedReason).toBe('verified')
    expect(state.version).toBe(before.version + 1)
    // 时序断言：disposedAt ≤ run-state mtime ≤ removedAt（终态时间戳 < 删树时间）
    const mtimeMs = (await stat(runStatePath(dir))).mtimeMs
    expect(Date.parse(state.disposedAt)).toBeLessThanOrEqual(mtimeMs)
    expect(Date.parse(r.disposedAt)).toBeLessThanOrEqual(Date.parse(r.writeDoneAt))
    expect(Date.parse(r.writeDoneAt)).toBeLessThanOrEqual(Date.parse(r.removedAt))
    expect(r.removed).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('C2 负例：stale expectUpdatedAt → CAS 冲突抛错且树原样保留（CAS 不成功绝不删树）', async () => {
  const { dir } = await makeFixtureRepo()
  try {
    await beginTeamRun({ cwd: dir, runId: 'run-c2x' })
    const tree = join(dir, '.omd', 'worktrees', 'run-c2x')
    const stateFile = runStatePath(dir)
    await expect(disposeRunWorktree({ cwd: dir, runId: 'run-c2x', expectUpdatedAt: '2000-01-01T00:00:00.000Z' }))
      .rejects.toThrow(/conflict/)
    expect(existsSync(tree)).toBe(true) // 删树被 CAS 门禁挡下
    expect((await readJson(stateFile)).status).toBe('active') // 终态也未写入
    // 持正确 expectUpdatedAt 重试 → 成功拆除
    const cur = await readJson(stateFile)
    const r = await disposeRunWorktree({ cwd: dir, runId: 'run-c2x', expectUpdatedAt: cur.updatedAt })
    expect(r.removed).toBe(true)
    expect(existsSync(tree)).toBe(false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---- C3 断言③：取消列差异只提示不阻塞；孤儿扫描只提示绝不自动删 ----
test('C3 取消：删树前列出树内与 HEAD 差异（tracked 修改 ∪ untracked），差异非空也继续拆除', async () => {
  const { dir } = await makeFixtureRepo()
  try {
    const { path: tree } = await beginTeamRun({ cwd: dir, runId: 'run-c3' })
    await writeFile(join(tree, 'README.md'), '# modified in tree\n', 'utf8')
    await writeFile(join(tree, 'scratch.txt'), 'untracked\n', 'utf8')
    const diffs = await listTreeDiff({ cwd: dir, runId: 'run-c3' })
    expect(diffs).toEqual(['README.md', 'scratch.txt']) // tracked 修改 ∪ untracked，排序
    const lines = []
    const r = await cancelTeamRun({ cwd: dir, runId: 'run-c3', log: l => lines.push(l) })
    expect(r.diffs).toEqual(['README.md', 'scratch.txt'])
    expect(r.promptLines.join('\n')).toContain('只提示不阻塞')
    expect(lines.join('\n')).toContain('README.md') // 提示面收到差异清单
    expect(r.state.disposedReason).toBe('cancelled')
    expect(r.removed).toBe(true) // 只提示不阻塞：差异非空也完成拆除
    expect(existsSync(tree)).toBe(false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('C3 孤儿扫描：崩溃遗留（非终态无活跃会话）→ 报告且绝不自动删；活跃会话/终态不报', async () => {
  const { dir } = await makeFixtureRepo()
  try {
    const { path: treeA } = await beginTeamRun({ cwd: dir, runId: 'run-crash' })
    // 模拟崩溃：不 dispose，直接进入下一次队长 run 启动扫描
    const live = await scanOrphans({ cwd: dir, isSessionActive: async () => true })
    expect(live.orphans).toEqual([]) // 有活跃会话 → 不算孤儿
    const scan = await scanOrphans({ cwd: dir, isSessionActive: async () => false })
    expect(scan.orphans).toEqual([{ runId: 'run-crash', status: 'active', path: treeA }])
    expect(scan.lines[0]).toContain('绝不自动删')
    expect(existsSync(treeA)).toBe(true) // 绝不自动删：树仍在
    // 正常拆除后同树不再报
    const st = await readJson(runStatePath(dir))
    await disposeRunWorktree({ cwd: dir, runId: 'run-crash', expectUpdatedAt: st.updatedAt })
    const after = await scanOrphans({ cwd: dir, isSessionActive: async () => false })
    expect(after.orphans).toEqual([])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('C3 孤儿扫描：权威 run-state 不描述的遗留树按 unknown 报告（不描述 = 按非终态论）', async () => {
  const { dir } = await makeFixtureRepo()
  try {
    await beginTeamRun({ cwd: dir, runId: 'run-old' })
    // 新 run 覆写权威 run-state（run-old 未收尾 = 崩溃遗留形态；其会话已不在 → 允许覆写）
    await beginTeamRun({ cwd: dir, runId: 'run-new' })
    const scan = await scanOrphans({ cwd: dir, isSessionActive: async () => false })
    // 判据字面语义：两树皆「run-state 非终态（active/unknown）且无活跃会话」→ 均报孤儿候选
    expect(scan.orphans.map(o => o.runId).sort()).toEqual(['run-new', 'run-old'])
    expect(scan.orphans.find(o => o.runId === 'run-old').status).toBe('unknown')
    expect(scan.orphans.find(o => o.runId === 'run-new').status).toBe('active')
    expect(existsSync(join(dir, '.omd', 'worktrees', 'run-old'))).toBe(true) // 绝不自动删
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('begin 拒绝覆写存活 run：前一 run 非终态且会话仍活跃 → 抛错不动 run-state', async () => {
  const { dir } = await makeFixtureRepo()
  try {
    await beginTeamRun({ cwd: dir, runId: 'run-live' })
    const before = await readJson(runStatePath(dir))
    await expect(beginTeamRun({ cwd: dir, runId: 'run-other', isSessionActive: async id => id === 'run-live' }))
      .rejects.toThrow(/拒绝覆写/)
    expect(await readJson(runStatePath(dir))).toEqual(before)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
