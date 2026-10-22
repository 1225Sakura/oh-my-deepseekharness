#!/usr/bin/env node
// bin/graph-runner.mjs
// U4 S5（计划 .omd/plans/ralplan-u4-graph-runtime.md §5 Q1 Option A/Q8、§7 步骤 5）：
// graph 运行时的薄 pwsh 后台入口——与 MCP 六工具面共用 lib/graph 核心
// （runGraph + guardrails 入口契约），供 dsh 后台 job / 计划任务托管长推进。
// 用法：
//   node bin/graph-runner.mjs --descriptor <draft.json> --runs-root <dir>
//       [--takeover] [--stale-grace-ms <ms>] [--cwd <dir>]
// 行为：
//   - 读 draft JSON → 护栏前缀注入（Q7，与 MCP 入口同 lib/graph/guardrails.js，
//     双入口对同一 draft 封印同一 descriptor_hash——跨入口恢复不因前缀漂移）
//     → sealGraphDescriptor → assertSupportedEdges（UNSUPPORTED_EDGE fail-fast）
//     → runGraph；
//   - stdout 末行打印 "GRAPH_RUN_RESULT <json>"（完整返回形状，Q8）；
//   - 进程退出码 = runGraph exit_code（0/1/19/20/21/70）；
//   - 顶层 catch 兜底 exit 70（SKILL.zh.md 退出码契约的运行时崩溃语义）；
//   - 用法/输入错误（缺参、--help、descriptor 不可读/坏 JSON）走 exit 2 + 人话 stderr，
//     不再与真崩溃同码同文案（刻板审查修复：用法错误≠崩溃）。
//
// 授权面诚实声明：本入口与 MCP graph_run 同权——descriptor 内 command 节点是
// 经 pwsh 执行的任意 shell 行，只运行你撰写或信任的 descriptor。
import { readFileSync } from 'node:fs'

import {
  parseGraphDescriptor,
  sealGraphDescriptor,
} from '../lib/graph/descriptor.js'
import { applyAgentGuardrails } from '../lib/graph/guardrails.js'
import { assertSupportedEdges } from '../lib/graph/scheduler.js'
import { EXIT_CODES, runGraph } from '../lib/graph/runner.js'

function argValue(args, name) {
  const index = args.indexOf(name)
  return index === -1 ? null : args[index + 1]
}

function emitResult(result) {
  process.stdout.write('GRAPH_RUN_RESULT ' + JSON.stringify(result) + '\n')
}

const USAGE = 'usage: node bin/graph-runner.mjs --descriptor <draft.json> --runs-root <dir> [--takeover] [--stale-grace-ms <ms>] [--cwd <dir>]'

async function main() {
  const args = process.argv.slice(2)
  // 显式 --help/-h：打印用法，exit 0（用户求助不是错误）；无参仍属用法错误（exit 2）
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(USAGE + '\n\n授权面：descriptor 内 command 节点是经 pwsh 执行的任意 shell 行，只运行你撰写或信任的 descriptor。\n')
    return
  }
  const descriptorPath = argValue(args, '--descriptor')
  const runsRoot = argValue(args, '--runs-root')
  // 用法错误：stderr 人话 + exit 2（不进 crash JSON 通道）
  if (!descriptorPath || !runsRoot) {
    process.stderr.write('graph-runner: 缺必需参数\n' + USAGE + '\n')
    process.exitCode = 2
    return
  }
  const takeover = args.includes('--takeover')
  const staleGraceRaw = argValue(args, '--stale-grace-ms')
  const staleGraceMs = staleGraceRaw === null ? undefined : Number(staleGraceRaw)
  const commandCwd = argValue(args, '--cwd')

  // descriptor 读取/解析失败 = 用户输入错误（exit 2 + 人话），不甩原始 Node 堆栈
  let draft
  try {
    draft = JSON.parse(readFileSync(descriptorPath, 'utf8'))
  } catch (e) {
    process.stderr.write(`graph-runner: descriptor 读取/解析失败: ${descriptorPath}: ${e?.message ?? e}\n`)
    process.exitCode = 2
    return
  }
  // 入口契约与 MCP graph_run 一致：护栏前缀 → 封印 → UNSUPPORTED_EDGE fail-fast。
  const sealed = sealGraphDescriptor(applyAgentGuardrails(parseGraphDescriptor(draft)))
  assertSupportedEdges(sealed)
  const result = await runGraph({
    sealedDescriptor: sealed,
    runsRoot,
    takeover,
    staleGraceMs,
    cwd: commandCwd ?? undefined,
  })
  emitResult(result)
  process.exitCode = result.exit_code
}

main().catch((error) => {
  emitResult({
    exit_code: EXIT_CODES.CRASH,
    terminal_status: null,
    status: 'in_progress',
    error: 'graph-runner crash: ' + String((error && error.message) || error),
  })
  process.exitCode = EXIT_CODES.CRASH
})
