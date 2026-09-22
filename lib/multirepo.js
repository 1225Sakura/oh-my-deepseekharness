// lib/multirepo.js
// c8 多仓锚定（M3，spec R9 树内自建+run-state 命名空间豁免 / R10 双向断言 不外溢不内渗 / 约束 8 / R18 表 c8 行）
// - 树内懒建（C1）：运行树内写 omd 状态 → `<tree>/.omd` 首次写才懒创建，父仓 .omd 零新增写入（不外溢）
// - 豁免向上 marker 解析（C3）：run-state 命名空间在运行树内锚定树根，不向上走——
//   父级 .omd / .omd-workspace 锚不截胡树内状态（树内自建，R9：重定向主仓被否）
// - 残渣随树丢弃（C2）：树拆除（c5 两阶段）→ 树内 .omd 随树消失；run-state.json 权威在主仓，树内只读参考
// - 纯多仓（非 run-tree）场景语义留执行期按 spec OQ 处理：非运行树侧仅提供最近 .omd / workspace 锚的
//   基础解析形态（对比面），树外写入显式拒绝
import { createHash } from 'node:crypto'
import { existsSync, statSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, basename, isAbsolute, relative, sep } from 'node:path'
import { atomicWriteJson, readJson } from '../mcp-server/lib/atomic.mjs'

/** 多仓工作区锚 marker（宿主约定：marker 所在目录的 `<stateDir>/` 为工作区共享状态根）。 */
export const WORKSPACE_MARKER = '.omd-workspace'

/** linked worktree 管理区形态：gitdir 指回主仓 `.git/worktrees/{name}`（submodule 是 .git/modules/，不匹配）。 */
const WORKTREE_GITDIR = /[\\/]\.git[\\/]worktrees[\\/][^\\/]+\/?$/

/**
 * 解析 `<dir>/.git` 指针（linked worktree 的 `.git` 是文件：`gitdir: <主仓>/.git/worktrees/<name>`；
 * 普通仓的 `.git` 是目录）→ { gitdir } | null。相对 gitdir 按 dir 解析。
 */
function readGitPointer(dir) {
  const dotGit = join(dir, '.git')
  let st
  try { st = statSync(dotGit) } catch { return null }
  if (st.isDirectory()) return null
  const m = /^gitdir:\s*(.+)\s*$/.exec(readFileSync(dotGit, 'utf8'))
  if (!m) return null
  const p = m[1]
  return { gitdir: isAbsolute(p) ? p : join(dir, p) }
}

/**
 * dir 是否 c5 运行树根（每运行一树形态）：.git 为指针文件且 gitdir 落在
 * `<主仓>/.git/worktrees/{name}` → 返回 runId（管理区目录名），否则 null。
 */
export function isRunTreeRoot(dir, { stateDir = '.omd' } = {}) {
  void stateDir // 形态判定走 git 自身管理区路径，与 stateDir 命名无关（保留参数与解析面一致）
  const ptr = readGitPointer(dir)
  if (!ptr) return null
  if (!WORKTREE_GITDIR.test(ptr.gitdir)) return null // submodule（.git/modules/…）等非运行树指针
  return basename(ptr.gitdir)
}

/**
 * 自 startDir 向上找最近的运行树根（停在第一个 git 边界：树根即边界，绝不越界向上——
 * 越界即被父仓 .omd 截胡）。→ { root, runId } | null（非运行树 / 非 git 目录）。
 */
export function findRunTreeRoot(startDir, opts = {}) {
  let dir = startDir
  for (;;) {
    const dotGit = join(dir, '.git')
    if (existsSync(dotGit)) {
      const runId = isRunTreeRoot(dir, opts)
      return runId ? { root: dir, runId } : null // 第一个 git 边界即裁决（普通仓/非运行树指针 → null）
    }
    const parent = dirname(dir)
    if (parent === dir) return null // 文件系统根
    dir = parent
  }
}

/**
 * run-state 命名空间状态目录解析（C3 断言③核心）：
 * - startDir 在运行树内 → 锚定树根 `<tree>/{stateDir}`（树内自建；exempted=true——豁免向上
 *   marker 解析，父级 .omd / .omd-workspace 锚不截胡；树内 .omd 尚不存在也照样锚树内，绝不回落父仓）
 * - 非运行树 → 向上最近 `${stateDir}/` 或 WORKSPACE_MARKER（marker 锚定 marker 目录的
 *   `<stateDir>/`，允许尚不存在=懒建路径）。纯多仓场景语义留执行期（spec OQ），本分支仅基础形态。
 * - 非 git 环境且无任何锚 → anchored='none'（resolved=null，不猜测）。
 * @returns { resolved, anchored: 'tree'|'nearest'|'workspace'|'none', exempted, treeRoot?, runId?, workspaceAnchor? }
 */
export function resolveRunStateDir(startDir, { stateDir = '.omd' } = {}) {
  const tree = findRunTreeRoot(startDir, { stateDir })
  if (tree)
    return {
      resolved: join(tree.root, stateDir),
      anchored: 'tree',
      exempted: true,
      treeRoot: tree.root,
      runId: tree.runId,
    }
  let dir = startDir
  for (;;) {
    const marker = join(dir, WORKSPACE_MARKER)
    if (existsSync(marker))
      return { resolved: join(dir, stateDir), anchored: 'workspace', exempted: false, workspaceAnchor: dir }
    if (existsSync(join(dir, stateDir)))
      return { resolved: join(dir, stateDir), anchored: 'nearest', exempted: false }
    const parent = dirname(dir)
    if (parent === dir) return { resolved: null, anchored: 'none', exempted: false }
    dir = parent
  }
}

/** rel 路径安全校验：相对、规范化后不逃出根。 */
function assertRel(rel) {
  if (!rel || isAbsolute(rel) || rel.split(/[\\/]/).includes('..'))
    throw new Error(`multirepo: 非法 rel 路径: ${String(rel)}（须为状态目录内相对路径）`)
  return rel
}

/**
 * 树内状态写（C1 断言①生产入口）：startDir（树内任意深度）→ 解析（豁免）→ 懒创建
 * `<tree>/{stateDir}`（首次写才建；atomicWriteJson 递归建父目录）→ 原子写 `<stateDir>/<rel>`。
 * 写面恒在树根之下，父仓状态树零触碰（不外溢）。非运行树显式拒绝（纯多仓语义留执行期）。
 * @returns { file, treeRoot, runId, stateDir, lazyCreated }
 */
export async function writeTreeRunState({ startDir, rel, data, stateDir = '.omd' } = {}) {
  assertRel(rel)
  const r = resolveRunStateDir(startDir, { stateDir })
  if (r.anchored !== 'tree')
    throw new Error(`multirepo: 非运行树（anchored=${r.anchored}）——树内状态写仅在 c5 运行树内可用（纯多仓场景语义留执行期，spec OQ）`)
  const file = join(r.resolved, rel)
  const lazyCreated = !existsSync(r.resolved)
  await atomicWriteJson(file, data)
  return { file, treeRoot: r.treeRoot, runId: r.runId, stateDir: r.resolved, lazyCreated }
}

/**
 * 树内只读参考读面（零副作用：不建目录、不写盘——懒建只发生在写路径）。
 * 文件不存在/解析失败 → null。
 */
export async function readTreeRunState({ startDir, rel, stateDir = '.omd' } = {}) {
  assertRel(rel)
  const r = resolveRunStateDir(startDir, { stateDir })
  if (r.anchored !== 'tree') return null // 非运行树无树内参考面
  return readJson(join(r.resolved, rel), null)
}

/**
 * 目录基线 hash（C1 证据面：父仓 .omd 基线前后一致断言；R10 不外溢的可复核形态）。
 * 递归收敛文件（按 relpath 排序），hash = Σ(relpath + 内容)；skip 为相对前缀豁免
 * （如 ['worktrees']——c5 检疫区，树及其树内 .omd 物理居于其下，不计入父仓状态基线）。
 */
export function hashDir(dir, { skip = [] } = {}) {
  const skips = skip.map(s => s.split(sep).join('/'))
  const isSkipped = rel => skips.some(s => rel === s || rel.startsWith(`${s}/`))
  const hash = createHash('sha256')
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const child = join(d, e.name)
      const rel = relative(dir, child).split(sep).join('/')
      if (isSkipped(rel)) continue
      if (e.isDirectory()) { walk(child); continue }
      hash.update(rel); hash.update('\n')
      hash.update(readFileSync(child)); hash.update('\n')
    }
  }
  if (existsSync(dir)) walk(dir)
  return hash.digest('hex')
}
