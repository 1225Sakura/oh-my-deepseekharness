// tests/lib/helpers/graph-e2e-driver.mjs
// U4 S4b e2e 驱动：在独立 node 进程中跑 runGraph（vitest 不被本文件匹配，
// vitest.config.js include=tests/**/*.test.js）。测试进程经 child_process
// spawn 本脚本，可中途 kill 模拟 MCP server 崩溃（kill -9 等价）。
//
// 用法：
//   node graph-e2e-driver.mjs --descriptor <draft.json> --runs-root <dir>
//       [--takeover] [--stale-grace-ms <ms>]
// 行为：
//   - 读 draft JSON → parseGraphDescriptor → sealGraphDescriptor（确定性
//     hash，同一 draft 多次调用 hash 相同）；
//   - 调 runGraph（env 全继承，测试经 spawn env 注入 GRAPH_E2E_MARKER_DIR
//     等）；stdout 末行打印 "GRAPH_E2E_RESULT <json>"（完整返回形状）；
//   - 进程退出码 = runGraph exit_code（0/1/19/20/21/70）；runGraph 自身
//     不抛（mapRunFailure），兜底 catch 映射 70。

import { readFileSync } from 'node:fs'

import {
  parseGraphDescriptor,
  sealGraphDescriptor,
} from '../../../lib/graph/descriptor.js'
import { EXIT_CODES, runGraph } from '../../../lib/graph/runner.js'

function argValue(args, name) {
  const index = args.indexOf(name)
  return index === -1 ? null : args[index + 1]
}

function emitResult(result) {
  process.stdout.write('GRAPH_E2E_RESULT ' + JSON.stringify(result) + '\n')
}

async function main() {
  const args = process.argv.slice(2)
  const descriptorPath = argValue(args, '--descriptor')
  const runsRoot = argValue(args, '--runs-root')
  if (descriptorPath === null || runsRoot === null) {
    throw new Error('usage: --descriptor <draft.json> --runs-root <dir> [--takeover] [--stale-grace-ms <ms>]')
  }
  const takeover = args.includes('--takeover')
  const staleGraceRaw = argValue(args, '--stale-grace-ms')
  const staleGraceMs = staleGraceRaw === null ? undefined : Number(staleGraceRaw)

  const draft = JSON.parse(readFileSync(descriptorPath, 'utf8'))
  const sealed = sealGraphDescriptor(parseGraphDescriptor(draft))
  const result = await runGraph({
    sealedDescriptor: sealed,
    runsRoot,
    takeover,
    staleGraceMs,
  })
  emitResult(result)
  process.exitCode = result.exit_code
}

main().catch((error) => {
  emitResult({
    exit_code: EXIT_CODES.CRASH,
    error: 'driver crash: ' + String((error && error.message) || error),
  })
  process.exitCode = EXIT_CODES.CRASH
})
