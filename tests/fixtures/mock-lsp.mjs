// tests/fixtures/mock-lsp.mjs
// 测试用 LSP mock server：stdio JSON-RPC（Content-Length 帧），
// 支持 initialize/documentSymbol/references/definition/shutdown/exit，
// didOpen 后 30ms 发一条 publishDiagnostics。供 codeintel LSP 工具面测试。
let buffer = Buffer.alloc(0)

const docUriText = new Map()

function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8')
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`)
  process.stdout.write(body)
}

function result(id, value) { send({ jsonrpc: '2.0', id, result: value }) }

function onMessage(msg) {
  const { id, method, params } = msg
  switch (method) {
    case 'initialize':
      result(id, {
        capabilities: { documentSymbolProvider: true, referencesProvider: true, definitionProvider: true },
        serverInfo: { name: 'mock-lsp', version: '0.0.1' },
      })
      break
    case 'initialized':
      break
    case 'textDocument/didOpen': {
      const uri = params.textDocument.uri
      docUriText.set(uri, params.textDocument.text)
      setTimeout(() => send({
        jsonrpc: '2.0', method: 'textDocument/publishDiagnostics',
        params: {
          uri,
          diagnostics: [{
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
            severity: 2, code: 'mock-warning', source: 'mock-lsp', message: 'mock 诊断：变量命名风格',
          }],
        },
      }), 30)
      break
    }
    case 'textDocument/documentSymbol':
      result(id, [
        { name: 'foo', kind: 12, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 30 } }, selectionRange: { start: { line: 0, character: 9 }, end: { line: 0, character: 12 } } },
        { name: 'Bar', kind: 5, range: { start: { line: 2, character: 0 }, end: { line: 6, character: 1 } }, selectionRange: { start: { line: 2, character: 6 }, end: { line: 2, character: 9 } } },
      ])
      break
    case 'textDocument/references':
      result(id, [
        { uri: params.textDocument.uri, range: { start: { line: 0, character: 9 }, end: { line: 0, character: 12 } } },
        { uri: params.textDocument.uri, range: { start: { line: 4, character: 6 }, end: { line: 4, character: 9 } } },
      ])
      break
    case 'textDocument/definition':
      result(id, { uri: params.textDocument.uri, range: { start: { line: 0, character: 9 }, end: { line: 0, character: 12 } } })
      break
    case 'shutdown':
      result(id, null)
      break
    case 'exit':
      process.exit(0)
      break
    default:
      if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `mock-lsp: unsupported ${method}` } })
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) return
    const header = buffer.slice(0, headerEnd).toString('utf8')
    const m = /Content-Length: (\d+)/i.exec(header)
    if (!m) { buffer = buffer.slice(headerEnd + 4); continue }
    const len = +m[1]
    if (buffer.length < headerEnd + 4 + len) return
    const body = buffer.slice(headerEnd + 4, headerEnd + 4 + len).toString('utf8')
    buffer = buffer.slice(headerEnd + 4 + len)
    try { onMessage(JSON.parse(body)) } catch { /* 坏帧丢弃 */ }
  }
})
