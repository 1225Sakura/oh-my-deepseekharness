// mcp-server/tools/codeintel.mjs
// 代码智能 MCP（v0.4.0 P2-E，对标 OMC lsp_*/ast_grep_* 工具面）：
// - ast_grep_search / ast_grep_replace：@ast-grep/napi 结构化语法检索/重写（动态 import，
//   原生依赖缺席 → 显式报错，不静默降级成文本 grep）
// - lsp_*：LSP 语言服务器进程管理（vscode-jsonrpc stdio + vscode-languageserver-protocol，
//   注册表来自插件 Config codeIntel.lspServers 经 OMD_CODE_INTEL 环境变量注入）；
//   单 server 单实例、崩溃自动重启 ≤2 次、进程随 MCP server 退出回收
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, extname, relative } from 'node:path'
import { spawn } from 'node:child_process'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// ast-grep
// ---------------------------------------------------------------------------

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
  async function walk(dir) {
    if (out.length >= maxFiles) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (out.length >= maxFiles) return
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
  return out
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

// ---------------------------------------------------------------------------
// LSP 进程管理
// ---------------------------------------------------------------------------

const MAX_RESTARTS = 2

function guessLanguageId(file, fallback) {
  const ext = extname(file).toLowerCase()
  for (const [lang, exts] of Object.entries(LANG_EXT)) if (exts.includes(ext)) return lang
  return fallback ?? 'plaintext'
}

export function makeCodeIntelTools(env, opts = {}) {
  const loadNapi = opts.loadNapi ?? defaultLoadNapi
  const registry = env?.codeIntel?.lspServers ?? {}
  /** 运行中 server：name → { child, connection, openDocs:Set, diagnostics:Map, restarts, starting } */
  const servers = new Map()

  // ---- ast-grep ----

  async function astGrepSearch({ cwd, pattern, lang, paths, maxResults = DEFAULT_MAX_RESULTS }) {
    if (env?.codeIntel?.astGrep === false) throw new Error('ast_grep: 已被配置 codeIntel.astGrep=false 禁用')
    if (typeof pattern !== 'string' || !pattern) throw new Error('ast_grep_search: pattern 必填')
    const napi = await loadNapi()
    const limit = Math.min(Math.max(1, maxResults), HARD_MAX_RESULTS)
    const files = await collectFiles(cwd, lang, paths)
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
    return { pattern, lang, scannedFiles: files.length, count: matches.length, truncated, matches }
  }

  async function astGrepReplace({ cwd, pattern, rewrite, lang, paths, dryRun = true, maxResults = HARD_MAX_RESULTS }) {
    if (typeof rewrite !== 'string' || !rewrite) throw new Error('ast_grep_replace: rewrite 必填（$VAR 元变量引用 pattern 捕获）')
    const napi = await loadNapi()
    const files = await collectFiles(cwd, lang, paths)
    const edits = []
    let changedFiles = 0
    for (const file of files) {
      if (edits.length >= maxResults) break
      let src
      try { src = await readFile(file, 'utf8') } catch { continue }
      let root
      try { root = napi.parse(lang, src) } catch { continue }
      const hits = root.root().findAll({ rule: { pattern } })
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
    return { pattern, rewrite, lang, dryRun, changedFiles, editCount: edits.length, edits: edits.slice(0, HARD_MAX_RESULTS) }
  }

  // ---- LSP ----

  function registryEntry(name) {
    const entry = registry[name]
    if (!entry) throw new Error(`lsp: 未注册的语言服务器 '${name}'（Config codeIntel.lspServers 已注册: ${Object.keys(registry).join('/') || '无'}）`)
    if (!entry.command) throw new Error(`lsp: 注册项 '${name}' 缺 command`)
    return entry
  }

  async function connect(name, entry, cwd) {
    const child = spawn(entry.command, entry.args ?? [], {
      cwd, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(entry.env ?? {}) },
    })
    try {
      return await handshake(name, entry, cwd, child)
    } catch (e) {
      try { child.kill() } catch { /* 已退出 */ }
      throw e
    }
  }

  async function handshake(name, entry, cwd, child) {
    const { createMessageConnection, StreamMessageReader, StreamMessageWriter } = await import('vscode-jsonrpc/node')
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    )
    const handle = {
      name, child, connection, cwd,
      openDocs: new Set(), diagnostics: new Map(), restarts: servers.get(name)?.restarts ?? 0,
      closed: false,
    }
    connection.onNotification('textDocument/publishDiagnostics', (p) => {
      handle.diagnostics.set(p.uri, p.diagnostics ?? [])
    })
    child.on('exit', () => {
      handle.closed = true
      servers.delete(name)
    })
    connection.onClose(() => { handle.closed = true })
    connection.listen()
    const { URI } = await import('vscode-uri')
    await connection.sendRequest('initialize', {
      processId: process.pid,
      rootUri: URI.file(cwd).toString(),
      capabilities: {
        textDocument: {
          documentSymbol: { hierarchicalDocumentSymbolSupport: false },
          references: {}, definition: {}, publishDiagnostics: {},
        },
      },
      workspaceFolders: [{ uri: URI.file(cwd).toString(), name: 'workspace' }],
      clientInfo: { name: 'omd-codeintel', version: '0.4.0' },
    })
    await connection.sendNotification('initialized', {})
    child.stderr?.on('data', () => {}) // 排干 stderr 防背压（语言服务器日志不进 omd 日志）
    return handle
  }

  async function ensureServer(name, cwd) {
    const cur = servers.get(name)
    if (cur && !cur.closed) return cur
    if (cur?.closed) servers.delete(name)
    const entry = registryEntry(name)
    const restarts = cur?.restarts ?? 0
    if (restarts >= MAX_RESTARTS && cur !== undefined)
      throw new Error(`lsp: server '${name}' 崩溃重启已达上限（${MAX_RESTARTS}）——检查语言服务器安装后调 lsp_stop 重置再 lsp_start`)
    const handle = await connect(name, entry, cwd)
    handle.restarts = servers.has(name) ? restarts + 1 : restarts
    servers.set(name, handle)
    return handle
  }

  async function ensureDoc(handle, file) {
    const { URI } = await import('vscode-uri')
    const uri = URI.file(file).toString()
    if (handle.openDocs.has(uri)) return uri
    const text = await readFile(file, 'utf8')
    await handle.connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: guessLanguageId(file, registry[handle.name]?.languages?.[0]), version: 1, text },
    })
    handle.openDocs.add(uri)
    return uri
  }

  const normLoc = (l) => l ? {
    uri: l.uri, range: l.range,
    file: l.uri?.startsWith('file://') ? decodeURIComponent(new URL(l.uri).pathname).replace(/^\/([A-Za-z]:)/, '$1') : l.uri,
  } : null

  async function lspStart({ cwd, server }) {
    const handle = await ensureServer(server, cwd)
    return { ok: true, server, pid: handle.child.pid, openDocs: handle.openDocs.size }
  }

  async function lspStop({ server }) {
    const handle = servers.get(server)
    if (!handle) return { ok: true, server, note: '未运行' }
    try { await handle.connection.sendRequest('shutdown') } catch { /* 已死也继续回收 */ }
    try { await handle.connection.sendNotification('exit') } catch { /* 同上 */ }
    handle.restarts = 0 // 显式 stop 重置重启预算（允许干净地再 start）
    servers.delete(server)
    // 等子进程真退出（≤2s）再返回——调用方（含测试）常紧接着清理 cwd，进程未退会占文件锁（EBUSY）
    await new Promise((resolve) => {
      const timer = setTimeout(() => { try { handle.child.kill() } catch { /* 已退出 */ } resolve() }, 2000)
      timer.unref?.()
      if (handle.child.exitCode !== null || handle.closed) { clearTimeout(timer); resolve() }
      else handle.child.once('exit', () => { clearTimeout(timer); resolve() })
    })
    return { ok: true, server, stopped: true }
  }

  async function lspStatus() {
    return {
      registered: Object.keys(registry),
      running: [...servers.values()].filter(h => !h.closed)
        .map(h => ({ server: h.name, pid: h.child.pid, openDocs: h.openDocs.size, restarts: h.restarts })),
    }
  }

  async function lspDocumentSymbols({ cwd, server, file }) {
    const handle = await ensureServer(server, cwd)
    const abs = join(cwd, file)
    const uri = await ensureDoc(handle, abs)
    const result = await handle.connection.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri },
    })
    const flat = []
    const walk = (syms, container) => {
      for (const s of syms ?? []) {
        flat.push({
          name: s.name, kind: s.kind, container: container ?? null,
          line: (s.selectionRange ?? s.range)?.start?.line + 1,
        })
        if (s.children) walk(s.children, s.name)
      }
    }
    if (Array.isArray(result) && result[0]?.location) {
      // DocumentSymbol[] 之外还有 SymbolInformation[] 形态
      for (const s of result) flat.push({ name: s.name, kind: s.kind, container: s.containerName ?? null, line: s.location.range.start.line + 1 })
    } else walk(result)
    return { server, file, count: flat.length, symbols: flat }
  }

  async function lspReferences({ cwd, server, file, line, character }) {
    const handle = await ensureServer(server, cwd)
    const abs = join(cwd, file)
    const uri = await ensureDoc(handle, abs)
    const result = await handle.connection.sendRequest('textDocument/references', {
      textDocument: { uri },
      position: { line: line - 1, character: character - 1 }, // 输入 1-based，LSP 0-based
      context: { includeDeclaration: true },
    })
    return { server, file, count: result?.length ?? 0, locations: (result ?? []).map(normLoc) }
  }

  async function lspDefinition({ cwd, server, file, line, character }) {
    const handle = await ensureServer(server, cwd)
    const abs = join(cwd, file)
    const uri = await ensureDoc(handle, abs)
    const result = await handle.connection.sendRequest('textDocument/definition', {
      textDocument: { uri },
      position: { line: line - 1, character: character - 1 },
    })
    const locs = Array.isArray(result) ? result : (result ? [result] : [])
    return { server, file, count: locs.length, locations: locs.map(l => normLoc(l?.targetUri ? { uri: l.targetUri, range: l.targetSelectionRange ?? l.targetRange } : l)) }
  }

  async function lspDiagnostics({ cwd, server, file, waitMs = 1500 }) {
    const handle = await ensureServer(server, cwd)
    const abs = join(cwd, file)
    const uri = await ensureDoc(handle, abs)
    const deadline = Date.now() + Math.max(0, waitMs)
    while (!handle.diagnostics.has(uri) && Date.now() < deadline)
      await new Promise(r => setTimeout(r, 50))
    const diags = handle.diagnostics.get(uri) ?? []
    return {
      server, file, count: diags.length,
      diagnostics: diags.map(d => ({
        line: d.range.start.line + 1, character: d.range.start.character + 1,
        severity: d.severity ?? null, code: d.code ?? null, source: d.source ?? null, message: d.message,
      })),
    }
  }

  return {
    astGrepSearch, astGrepReplace,
    lspStart, lspStop, lspStatus, lspDocumentSymbols, lspReferences, lspDefinition, lspDiagnostics,
    _servers: servers, // 测试观测面
  }
}

export function registerCodeIntelTools(server, env) {
  const t = makeCodeIntelTools(env)
  const jsonOut = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }] })
  const base = { cwd: z.string() }
  const astBase = { ...base, pattern: z.string(), lang: z.string(), paths: z.array(z.string()).optional() }

  server.registerTool('ast_grep_search', {
    description: 'ast-grep 结构化语法检索（$VAR/$$$VARS 元变量模式；按语言过滤文件；返回 file:line 命中，有界）',
    inputSchema: { ...astBase, maxResults: z.number().int().min(1).max(500).optional() },
  }, async a => jsonOut(await t.astGrepSearch(a)))

  server.registerTool('ast_grep_replace', {
    description: 'ast-grep 结构化重写（pattern 捕获 $VAR → rewrite 引用；dryRun 默认 true 只出计划不落盘）',
    inputSchema: { ...astBase, rewrite: z.string(), dryRun: z.boolean().optional(), maxResults: z.number().int().optional() },
  }, async a => jsonOut(await t.astGrepReplace(a)))

  const lspBase = { ...base, server: z.string() }
  const lspPos = { ...lspBase, file: z.string(), line: z.number().int().min(1), character: z.number().int().min(1) }

  server.registerTool('lsp_start', {
    description: '启动已注册的语言服务器（Config codeIntel.lspServers 注册表；单实例，崩溃重启 ≤2）',
    inputSchema: lspBase,
  }, async a => jsonOut(await t.lspStart(a)))

  server.registerTool('lsp_stop', {
    description: '关闭语言服务器（shutdown+exit；显式 stop 重置崩溃重启预算）',
    inputSchema: { server: z.string() },
  }, async a => jsonOut(await t.lspStop(a)))

  server.registerTool('lsp_status', {
    description: 'LSP 状态（已注册注册表 + 运行中 server/openDocs/重启计数）',
    inputSchema: {},
  }, async a => jsonOut(await t.lspStatus(a)))

  server.registerTool('lsp_document_symbols', {
    description: '文档符号（函数/类/变量大纲；自动 didOpen）',
    inputSchema: { ...lspBase, file: z.string() },
  }, async a => jsonOut(await t.lspDocumentSymbols(a)))

  server.registerTool('lsp_references', {
    description: '符号引用（line/character 为 1-based）',
    inputSchema: lspPos,
  }, async a => jsonOut(await t.lspReferences(a)))

  server.registerTool('lsp_definition', {
    description: '跳转定义（line/character 为 1-based）',
    inputSchema: lspPos,
  }, async a => jsonOut(await t.lspDefinition(a)))

  server.registerTool('lsp_diagnostics', {
    description: '文件诊断（等 publishDiagnostics 至 waitMs；返回 severity/message 有界列表）',
    inputSchema: { ...lspBase, file: z.string(), waitMs: z.number().int().min(0).max(30000).optional() },
  }, async a => jsonOut(await t.lspDiagnostics(a)))
}
