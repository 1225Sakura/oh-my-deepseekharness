// tests/lib/multirepo.test.js
// c8 多仓锚定验收（台账 m3-advance S7，R18 表逐行落槽）：
// C1 断言①：worktree 内写状态 → <tree>/.omd 懒创建且父仓 .omd 无新增写入（父仓 .omd 基线 hash 前后一致）
// C2 断言②：树清理后树内 .omd 消失（残渣随树丢弃；run-state.json 权威在主仓，树内只读参考）
// C3 断言③：运行树豁免向上 marker 解析（run-state 命名空间）——父级 .omd-workspace 锚不截胡树内状态
// G6：全部落 OS 临时夹具仓，零触碰日常 .omd。
import { test, expect } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  WORKSPACE_MARKER, isRunTreeRoot, findRunTreeRoot, resolveRunStateDir,
  writeTreeRunState, readTreeRunState, hashDir,
} from '../../lib/multirepo.js'
import { beginTeamRun, disposeRunWorktree, runStatePath } from '../../lib/worktree.js'
import { readJson } from '../../mcp-server/lib/atomic.mjs'

/** 临时 git 夹具仓（单提交 HEAD）；g 现场执行 git 命令。 */
async function makeFixtureRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'omd-c8-'))
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

// ---- 运行树形态判定（c5 每运行一树的识别基础） ----
test('isRunTreeRoot：主仓根=null；c5 树根=runId；findRunTreeRoot 自树内深处命中树根', async () => {
  const { dir } = await makeFixtureRepo()
  try {
    expect(isRunTreeRoot(dir)).toBeNull() // 主仓 .git 是目录 → 非运行树
    const { path: tree } = await beginTeamRun({ cwd: dir, runId: 'run-c8-detect' })
    expect(isRunTreeRoot(tree)).toBe('run-c8-detect') // .git 指针文件 gitdir → .git/worktrees/{name}
    const deep = join(tree, 'src', 'lib')
    await mkdir(deep, { recursive: true })
    expect(findRunTreeRoot(deep)).toEqual({ root: tree, runId: 'run-c8-detect' })
    expect(findRunTreeRoot(dir)).toBeNull() // 主仓侧不是运行树
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---- C1 断言①：树内写状态 → <tree>/.omd 懒创建 + 父仓 .omd 零新增写入（基线 hash 前后一致） ----
test('C1 树内懒建：首写才建 <tree>/.omd；父仓 .omd 基线 hash（豁免 worktrees/）前后一致', async () => {
  const { dir } = await makeFixtureRepo()
  try {
    const { path: tree } = await beginTeamRun({ cwd: dir, runId: 'run-c8-c1' })
    const treeOmd = join(tree, '.omd')
    expect(existsSync(treeOmd)).toBe(false) // 懒建前置：建树本身不建 .omd
    const parentOmd = join(dir, '.omd')
    const baseline = hashDir(parentOmd, { skip: ['worktrees'] }) // worktrees/ = c5 检疫区（树物理居于其下）
    const deep = join(tree, 'packages', 'app')
    const w1 = await writeTreeRunState({ startDir: deep, rel: 'state/worker.json', data: { agent: 'explore', tick: 1 } })
    expect(w1.lazyCreated).toBe(true) // 首写懒创建
    expect(existsSync(treeOmd)).toBe(true)
    expect(w1.file).toBe(join(treeOmd, 'state', 'worker.json')) // 落树内，不落父仓
    expect(w1.treeRoot).toBe(tree)
    const w2 = await writeTreeRunState({ startDir: deep, rel: 'state/worker.json', data: { agent: 'explore', tick: 2 } })
    expect(w2.lazyCreated).toBe(false) // 已存在不再建
    expect((await readJson(join(treeOmd, 'state', 'worker.json'))).tick).toBe(2)
    expect(hashDir(parentOmd, { skip: ['worktrees'] })).toBe(baseline) // 断言①：父仓 .omd 基线 hash 前后一致
    expect(existsSync(join(parentOmd, 'state', 'worker.json'))).toBe(false) // 不外溢直接证物
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('C1 读面零副作用：树内读不存在的参考文件 → null 且不触发懒建', async () => {
  const { dir } = await makeFixtureRepo()
  try {
    const { path: tree } = await beginTeamRun({ cwd: dir, runId: 'run-c8-read' })
    const out = await readTreeRunState({ startDir: tree, rel: 'state/run-state.json' })
    expect(out).toBeNull()
    expect(existsSync(join(tree, '.omd'))).toBe(false) // 懒建只属于写路径
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---- C2 断言②：树清理后树内 .omd 消失（残渣随树丢弃；权威 run-state.json 在主仓保留） ----
test('C2 残渣随树丢弃：dispose 后树内 .omd 消失；主仓权威 run-state.json 完好（disposed）', async () => {
  const { dir } = await makeFixtureRepo()
  try {
    const { path: tree } = await beginTeamRun({ cwd: dir, runId: 'run-c8-c2' })
    // 队长写权威 run-state（主仓，c5/c6 面不变）→ 快照作树内只读参考（树内写经 c8 豁免解析落 <tree>/.omd）
    const authority = await readJson(runStatePath(dir))
    await writeTreeRunState({
      startDir: join(tree, 'src'), rel: 'state/run-state.json',
      data: { ...authority, readonlyReference: true },
    })
    expect(existsSync(join(tree, '.omd', 'state', 'run-state.json'))).toBe(true)
    const ref = await readTreeRunState({ startDir: join(tree, 'src'), rel: 'state/run-state.json' })
    expect(ref.readonlyReference).toBe(true) // 树内只读参考：权威快照的镜像
    const before = await readJson(runStatePath(dir))
    await disposeRunWorktree({ cwd: dir, runId: 'run-c8-c2', expectUpdatedAt: before.updatedAt })
    expect(existsSync(tree)).toBe(false) // 树拆除
    expect(existsSync(join(tree, '.omd'))).toBe(false) // 断言②：树内 .omd 残渣随树丢弃
    const authority2 = await readJson(runStatePath(dir))
    expect(authority2.status).toBe('disposed') // 权威 run-state.json 在主仓完好
    expect(authority2.runId).toBe('run-c8-c2')
    await expect(writeTreeRunState({ startDir: tree, rel: 'state/x.json', data: {} }))
      .rejects.toThrow(/运行树/) // 树已拆：树内写不再可用（残渣不再复生）
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---- C3 断言③：运行树豁免向上 marker 解析——父级 .omd-workspace 锚不截胡树内状态 ----
test('C3 豁免解析：父级 .omd-workspace 锚在场，树内解析（含懒建前）仍锚树内；树外对照走 workspace 锚', async () => {
  const { dir } = await makeFixtureRepo()
  try {
    await writeFile(join(dir, WORKSPACE_MARKER), '', 'utf8') // 父级多仓工作区锚
    await mkdir(join(dir, '.omd', 'state'), { recursive: true }) // 父仓状态树（潜在截胡目标）
    await writeFile(join(dir, '.omd', 'state', 'parent-only.json'), '{"from":"parent"}', 'utf8')
    const { path: tree } = await beginTeamRun({ cwd: dir, runId: 'run-c8-c3' })
    const deep = join(tree, 'a', 'b', 'c')
    await mkdir(deep, { recursive: true })
    // 关键断言：树内 .omd 尚未懒建时解析也锚树内（绝不回落父仓/.omd-workspace 锚）
    const r = resolveRunStateDir(deep)
    expect(r).toMatchObject({
      anchored: 'tree', exempted: true, treeRoot: tree, runId: 'run-c8-c3',
      resolved: join(tree, '.omd'),
    })
    expect(existsSync(r.resolved)).toBe(false) // 解析纯路径判断，零副作用
    // 树外对照（非 run-tree）：workspace 锚正常生效（纯多仓基础形态，语义留执行期）
    const outside = resolveRunStateDir(join(dir, 'docs'))
    expect(outside.anchored).toBe('workspace')
    expect(outside.resolved).toBe(join(dir, '.omd'))
    expect(outside.exempted).toBe(false)
    // 豁免生效的直接证物：树内首写落 <tree>/.omd，父仓 .omd/state 无新增文件
    await writeTreeRunState({ startDir: deep, rel: 'state/ns.json', data: { ns: 'run-state' } })
    expect(existsSync(join(tree, '.omd', 'state', 'ns.json'))).toBe(true)
    expect(existsSync(join(dir, '.omd', 'state', 'ns.json'))).toBe(false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('C3 边界：非运行树（普通仓/非 git 目录）不豁免——树内写显式拒绝（纯多仓语义留执行期）', async () => {
  const plain = await mkdtemp(join(tmpdir(), 'omd-c8-plain-'))
  try {
    const r = resolveRunStateDir(join(plain, 'x'))
    expect(r.anchored).toBe('none') // 无锚不猜测
    expect(r.resolved).toBeNull()
    await expect(writeTreeRunState({ startDir: plain, rel: 'state/x.json', data: {} }))
      .rejects.toThrow(/留执行期/)
  } finally {
    await rm(plain, { recursive: true, force: true })
  }
  const { dir } = await makeFixtureRepo()
  try {
    // 普通仓（.git 目录）内：解析走最近锚（非豁免），写拒绝
    await mkdir(join(dir, '.omd'), { recursive: true }) // 最近锚在场
    const inRepo = resolveRunStateDir(join(dir, 'docs'))
    expect(inRepo.anchored).toBe('nearest')
    expect(inRepo.resolved).toBe(join(dir, '.omd'))
    await expect(writeTreeRunState({ startDir: join(dir, 'docs'), rel: 'state/x.json', data: {} }))
      .rejects.toThrow(/非运行树/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---- hashDir（C1 证据面）：确定性 + 内容敏感 + skip 豁免 ----
test('hashDir：同树同 hash；内容变更即变；skip 前缀豁免不计入', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omd-c8-hash-'))
  try {
    await mkdir(join(root, 'a'), { recursive: true })
    await writeFile(join(root, 'a', 'x.txt'), 'v1', 'utf8')
    await writeFile(join(root, 'b.txt'), 'keep', 'utf8')
    const h1 = hashDir(root)
    expect(hashDir(root)).toBe(h1) // 确定性
    await writeFile(join(root, 'a', 'x.txt'), 'v2', 'utf8')
    expect(hashDir(root)).not.toBe(h1) // 内容敏感
    const h2 = hashDir(root)
    await mkdir(join(root, 'skipdir'), { recursive: true })
    await writeFile(join(root, 'skipdir', 'y.txt'), 'noise', 'utf8')
    expect(hashDir(root, { skip: ['skipdir'] })).toBe(h2) // skip 豁免：检疫区改动不影响基线
    expect(hashDir(root)).not.toBe(h2) // 不 skip 则计入
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
