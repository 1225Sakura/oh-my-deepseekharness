#!/usr/bin/env node
// audit-upstream-forms.mjs — 上游(omc/omx)与 omd 本仓形态取数脚本
// 契约: 零依赖(node 标准库) / 只读 / JSON 只走 stdout / WARNING 只走 stderr / exit 恒 0
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = path.join(ROOT, 'reference');

const warn = (msg) => process.stderr.write('WARNING ' + msg + '\n');
const ABSENT_WARN = 'reference/ 缺席，上游漂移检测跳过（gitignored 本机快照）';

function listDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
  } catch { return null; }
}
function countFilesRecursive(dir, filter) {
  let n = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (!filter || filter(e.name)) n++;
    }
  };
  try { walk(dir); return n; } catch { return null; }
}
function gitRef(repoDir) {
  const run = (args) => {
    try {
      return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() || null;
    } catch { return null; }
  };
  const tag = run(['describe', '--tags']);
  const head = run(['rev-parse', '--short', 'HEAD']);
  const out = { tag, head };
  if (tag === null || head === null) out.note = 'git describe/rev-parse 失败（目录非 git 仓库或 git 不可用），字段为 null';
  return out;
}

function auditOmc() {
  const dir = path.join(REF, 'oh-my-claudecode');
  if (!existsSync(dir)) { warn('reference/oh-my-claudecode: ' + ABSENT_WARN); return null; }

  // hooks 口径钉死: hooks/hooks.json 的 hook actions 总数；matchers/eventTypes 为参照字段
  let hooks = { caliber: 'hooks/hooks.json 内 hook actions 总数（非 src/hooks 下 .ts 文件数——后者仅 10 个，不同源，防误数）', actions: null, matchers: null, eventTypes: null, events: null };
  const hooksPath = path.join(dir, 'hooks', 'hooks.json');
  try {
    const j = JSON.parse(readFileSync(hooksPath, 'utf8'));
    const events = Object.keys(j.hooks ?? {});
    let matchers = 0, actions = 0;
    for (const ev of events) {
      const arr = j.hooks[ev] ?? [];
      matchers += arr.length;
      for (const m of arr) actions += (m.hooks ?? []).length;
    }
    hooks = { ...hooks, actions, matchers, eventTypes: events.length, events };
  } catch (e) {
    hooks.error = 'hooks/hooks.json 读取或解析失败: ' + e.message;
  }

  return {
    present: true,
    ...gitRef(dir),
    counts: {
      skills: (listDirs(path.join(dir, 'skills')) ?? []).length,
      agentsMd: countFilesRecursive(path.join(dir, 'agents'), n => n.endsWith('.md')),
      commands: countFilesRecursive(path.join(dir, 'commands')),
    },
    hooks,
    srcSubsystems: listDirs(path.join(dir, 'src')),
    topLevelDirs: listDirs(dir),
  };
}

function auditOmx() {
  const dir = path.join(REF, 'oh-my-codex');
  if (!existsSync(dir)) { warn('reference/oh-my-codex: ' + ABSENT_WARN); return null; }
  const dirInfo = (name) => {
    const p = path.join(dir, name);
    const exists = existsSync(p);
    return { exists, subdirs: exists ? (listDirs(p) ?? []).length : null };
  };
  return {
    present: true,
    ...gitRef(dir),
    counts: { skills: (listDirs(path.join(dir, 'skills')) ?? []).length },
    dirs: { crates: dirInfo('crates'), packages: dirInfo('packages'), plugins: dirInfo('plugins'), prompts: dirInfo('prompts') },
    capabilitiesLockExists: existsSync(path.join(dir, 'omx-capabilities.lock.json')),
  };
}

function auditOmd() {
  // 本仓面恒可测，不受 reference 缺席影响
  const skillsDirs = listDirs(path.join(ROOT, 'assets', 'skills')) ?? [];
  const agentMd = countFilesRecursive(path.join(ROOT, 'assets', 'agents'), n => n.endsWith('.md'));
  const toolsDir = path.join(ROOT, 'mcp-server', 'tools');
  const mcpToolsByFile = {};
  let mcpToolsTotal = 0;
  for (const f of readdirSync(toolsDir).filter(n => n.endsWith('.mjs')).sort()) {
    const c = (readFileSync(path.join(toolsDir, f), 'utf8').match(/registerTool\(/g) ?? []).length;
    mcpToolsByFile[f.replace(/\.mjs$/, '')] = c;
    mcpToolsTotal += c;
  }
  const byFileSum = Object.values(mcpToolsByFile).reduce((a, b) => a + b, 0);
  return {
    assets: {
      skillsDirs: skillsDirs.length,
      agentMdFiles: agentMd,
      agentRoles: agentMd === null ? null : agentMd / 2, // 双语口径: 角色数 = .md 文件数 / 2
    },
    mcpToolsTotal,
    mcpToolsByFile,
    mcpToolsSumCheck: byFileSum === mcpToolsTotal, // 分量加总须等于总量
  };
}

const omc = auditOmc();
const omx = auditOmx();
const absentReferences = [];
if (omc === null) absentReferences.push('oh-my-claudecode');
if (omx === null) absentReferences.push('oh-my-codex');

const report = {
  generatedAt: new Date().toISOString(),
  root: ROOT,
  upstream: { 'oh-my-claudecode': omc, 'oh-my-codex': omx },
  absentReferences,
  omd: auditOmd(),
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.exit(0);
