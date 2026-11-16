// mcp-server/tools/codeintel-astgrep.mjs
// ast-grep 工具面（刻板审查修复：从 codeintel.mjs 的 ~320 行热点工厂拆出——
// ast-grep 与 LSP 进程管理互不共享状态，天然可分；本模块自含全部 ast-grep 依赖）。
// 行为与原实现逐行一致（纯搬移，零逻辑改动）。
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, extname, relative } from 'node:path'

/** 语言 → 扩展名映射（ast-grep Lang id 与 napi parse() 的语言串一致）。 */
export const LANG_EXT = {
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  typescript: ['.ts', '.tsx', '.mts', '.cts'],
  python: ['.py'],
  rust: ['.rs'],
  go: ['.go'],
  java: ['.java'],
  c: ['.c', '.h'],
  cpp: ['.cpp', '.cc', '.cxx', '.hpp', '.hh'],
  csharp: ['.cs'],
  html: ['.html', '.htm'],
  css: ['.css'],
  json: ['.json'],
  yaml: ['.yml', '.yaml'],
  markdown: ['.md'],
}
const SKIP_DIRS = new Set(['.git', 'node_modules', '.omd', 'dist', 'build', 'out', '.next', 'coverage'])
const DEFAULT_MAX_RESULTS = 50
const HARD_MAX_RESULTS = 500

/**
 * 嵌套命中过滤（评审修复#3，实测文件损坏）：findAll 会返回嵌套命中（如 `$A + $B`
 * 命中 `a + b + c` 与其内层 `a + b`）——重叠编辑切片会写坏文件。保外层弃内层：
 * 凡范围被另一命中完整包含的命中直接过滤（保留最外层匹配集，彼此不重叠）。
 */
function dropNestedHits(hits) {
  const ranges = hits.map(h => ({ start: h.range().start.index, end: h.range().end.index }))
  return hits.filter((_, i) =>
    !ranges.some((r, j) => j !== i
      && r.start <= ranges[i].start && r.end >= ranges[i].end
      && (r.start < ranges[i].start || r.end > ranges[i].end)))
}

async function defaultLoadNapi() {
  try { return await import('@ast-grep/napi') }
  catch (e) {
    throw new Error(`ast_grep: @ast-grep/napi 加载失败（原生依赖缺席/不兼容）：${e?.message ?? e}——`
      + 'ast_grep_* 不可用（LSP 工具不受影响）；安装/重装依赖后重试，绝不静默降级成文本 grep')
  }
}

async function collectFiles(cwd, lang, paths, maxFiles = 2000) {
  const exts = LANG_EXT[lang]
  if (!exts) throw new Error(`ast_grep: 未知语言 '${lang}'（支持: ${Object.keys(LANG_EXT).join('/')}）`)
  const roots = (paths?.length ? paths : ['.']).map(p => join(cwd, p))
  const out = []
  let truncated = false // 评审修复#14：截断不再静默
  async function walk(dir) {
    if (out.length >= maxFiles) { truncated = true; return }
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (out.length >= maxFiles) { truncated = true; return }
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(full)
      } else if (exts.includes(extname(e.name).toLowerCase())) {
        out.push(full)
      }
    }
  }
  for (const r of roots) {
    // paths 也可直接指文件
    if (exts.includes(extname(r).toLowerCase())) { out.push(r); continue }
    await walk(r)
  }
  return { files: out, truncated }
}

/** 元变量替换：$NAME → getMatch(NAME)，$$$NAME → getMultipleMatches(NAME) 逗号联结
 * （multi-match 含匿名分隔符节点——实测逗号以 unnamed node 混入，过滤 isNamed 防 '2, ,, 3' 畸变）。 */
export function substituteRewrite(match, rewrite) {
  return rewrite
    .replace(/\$\$\$([A-Z_][A-Z0-9_]*)/g, (_, name) =>
      match.getMultipleMatches(name).filter(n => n.isNamed()).map(n => n.text()).join(', '))
    .replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, name) =>
      match.getMatch(name)?.text() ?? '')
}

/** ast-grep 两个工具的实现（env.codeIntel.astGrep 开关在此强制；loadNapi 可注入测试替身）。 */
export function makeAstGrepTools(env, loadNapi = defaultLoadNapi) {
  async function astGrepSearch({ cwd, pattern, lang, paths, maxResults = DEFAULT_MAX_RESULTS }) {
    if (env?.codeIntel?.astGrep === false) throw new Error('ast_grep: 已被配置 codeIntel.astGrep=false 禁用')
    if (typeof pattern !== 'string' || !pattern) throw new Error('ast_grep_search: pattern 必填')
    const napi = await loadNapi()
    const limit = Math.min(Math.max(1, maxResults), HARD_MAX_RESULTS)
    const { files, truncated: filesTruncated } = await collectFiles(cwd, lang, paths)
    const matches = []
    let truncated = false
    for (const file of files) {
      if (matches.length >= limit) { truncated = true; break }
      let src
      try { src = await readFile(file, 'utf8') } catch { continue }
      let root
      try { root = napi.parse(lang, src) } catch { continue } // 单文件解析失败不阻断扫描
      const hits = root.root().findAll({ rule: { pattern } })
      for (const h of hits) {
        if (matches.length >= limit) { truncated = true; break }
        const r = h.range()
        matches.push({
          file: relative(cwd, file).replaceAll('\\', '/'),
          line: r.start.line + 1, column: r.start.column + 1,
          endLine: r.end.line + 1, endColumn: r.end.column + 1,
          kind: h.kind(), text: h.text(),
        })
      }
    }
    return { pattern, lang, scannedFiles: files.length, filesTruncated, count: matches.length, truncated, matches }
  }

  async function astGrepReplace({ cwd, pattern, rewrite, lang, paths, dryRun = true, maxResults = HARD_MAX_RESULTS }) {
    if (env?.codeIntel?.astGrep === false) throw new Error('ast_grep: 已被配置 codeIntel.astGrep=false 禁用')
    if (typeof rewrite !== 'string' || !rewrite) throw new Error('ast_grep_replace: rewrite 必填（$VAR 元变量引用 pattern 捕获）')
    const napi = await loadNapi()
    const { files, truncated: filesTruncated } = await collectFiles(cwd, lang, paths)
    const edits = []
    let changedFiles = 0
    for (const file of files) {
      if (edits.length >= maxResults) break
      let src
      try { src = await readFile(file, 'utf8') } catch { continue }
      let root
      try { root = napi.parse(lang, src) } catch { continue }
      const hits = dropNestedHits(root.root().findAll({ rule: { pattern } }))
      if (!hits.length) continue
      // 逆序应用编辑（索引不漂移）
      const fileEdits = hits.map(h => ({
        start: h.range().start.index, end: h.range().end.index,
        before: h.text(), after: substituteRewrite(h, rewrite),
      })).sort((a, b) => b.start - a.start)
      let next = src
      for (const e of fileEdits) next = next.slice(0, e.start) + e.after + next.slice(e.end)
      changedFiles++
      for (const e of fileEdits.reverse()) {
        const line = src.slice(0, e.start).split('\n').length
        edits.push({ file: relative(cwd, file).replaceAll('\\', '/'), line, before: e.before, after: e.after })
      }
      if (!dryRun) await writeFile(file, next, 'utf8')
    }
    return { pattern, rewrite, lang, dryRun, changedFiles, filesTruncated, editCount: edits.length, edits: edits.slice(0, HARD_MAX_RESULTS) }
  }

  return { astGrepSearch, astGrepReplace }
}
