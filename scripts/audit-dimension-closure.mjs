#!/usr/bin/env node
// audit-dimension-closure.mjs — omd 全维度承载面闭包取数脚本（docs/dimension-framework.md 的机器面）
// 契约（同构 audit-upstream-forms.mjs）: 零依赖(node 标准库) / 只读 / JSON 只走 stdout / WARNING 只走 stderr / exit 恒 0
// 钉死：只顶层不递归，不可放宽为递归——reference/awesome-fork 内存 Windows 非法文件名（尾部 `.`），递归遍历会炸；
//       omd 侧枚举基 = git ls-files（git 内事实），结构性免疫未跟踪流浪文件与 %SystemDrive% 流浪目录
//       （docs/会话.txt 属有意排除：未跟踪转录不回写，同 memory 先例 dsh-017/会话.txt 排除原则）。
// 输出 schema 钉死：{entries, orphans:{omd:[],ref:[]}, referenceTopLevel}，全文唯一此形。
// 映射表 MAP 为机器权威：docs/dimension-framework.md §6 映射表键集须与本表逐字一致（tests/docs/dimension-chain.test.js L1e 互断）。
// 映射语义钉死（NTH2）：禁文件级 catch-all、允许目录级前缀（键以 / 结尾）；未命中→orphan，红为预期摩擦；
// 新增承载面协议 = 改本表 + 框架文档 §6 同步 + L1e 互断兜底。
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = path.join(ROOT, 'reference');

const warn = (msg) => process.stderr.write('WARNING ' + msg + '\n');

// reference 面：按名取两仓（缺席→ref 字段 null + stderr WARNING，exit 恒 0）
const REF_REPOS = ['oh-my-claudecode', 'oh-my-codex'];
// reference/ 顶层漂移哨兵：声明外目录出现→stderr WARNING（告警不红）。实测当前恰 4 目录。
const REF_TOP_DECLARED = ['awesome-dsh-plugin', 'awesome-fork', 'oh-my-claudecode', 'oh-my-codex'];

// 根域自闭合（M-2）：git ls-files 顶层去重 ⊆ 本白名单（实测 15 项）；
// 显式排除项 = reference/、node_modules/、*.tgz；.omd 特殊规则 = 允许且仅允许恰一条 .omd/plans/upgrade-tracking.md，其余 .omd 路径进 orphans。
const ROOT_WHITELIST = [
  '.gitattributes', '.gitignore', 'assets', 'bin', 'cordis.patch.yml', 'docs', 'lib', 'LICENSE',
  'mcp-server', 'package-lock.json', 'package.json', 'README.md', 'scripts', 'tests', 'vitest.config.js',
];
const OMD_ALLOWED_PATH = '.omd/plans/upgrade-tracking.md';

// ── 映射规则表（机器权威；维度编号 D1-D16 语义见 docs/dimension-framework.md §2/§3）──
const MAP = {
  // omd 根域（git ls-files 顶层去重；白名单 15 项 + .omd 特殊规则位）
  'omd:root/.gitattributes': ['D8'],
  'omd:root/.gitignore': ['D8'],
  'omd:root/.omd': ['D11'],
  'omd:root/LICENSE': ['D8'],
  'omd:root/README.md': ['D16'],
  'omd:root/assets': ['D2'],
  'omd:root/bin': ['D14'],
  'omd:root/cordis.patch.yml': ['D10'],
  'omd:root/docs': ['D16'],
  'omd:root/lib': ['D10'],
  'omd:root/mcp-server': ['D11'],
  'omd:root/package-lock.json': ['D15'],
  'omd:root/package.json': ['D15'],
  'omd:root/scripts': ['D16'],
  'omd:root/tests': ['D15'],
  'omd:root/vitest.config.js': ['D15'],
  // assets/ 声明面（skills/* 目录级前缀 / agents 双语对目录级前缀 / overlays / templates）
  'omd:assets/agents/': ['D3'],
  'omd:assets/overlays/': ['D3'],
  'omd:assets/skills/': ['D2'],
  'omd:assets/templates/': ['D4'],
  // lib/ 顶层（逐文件规则）+ lib/graph/ 目录级前缀
  'omd:lib/client.js': ['D7'],
  'omd:lib/commands.js': ['D8'],
  'omd:lib/config.js': ['D10'],
  'omd:lib/delegate.js': ['D12'],
  'omd:lib/events.js': ['D12'],
  'omd:lib/graph/': ['D14'],
  'omd:lib/heartbeat.js': ['D6'],
  'omd:lib/hook.js': ['D5'],
  'omd:lib/hud-route.js': ['D7'],
  'omd:lib/hud.js': ['D7'],
  'omd:lib/index.js': ['D10'],
  'omd:lib/keywords.js': ['D5'],
  'omd:lib/memory.js': ['D4'],
  'omd:lib/multirepo.js': ['D13'],
  'omd:lib/probe.js': ['D10'],
  'omd:lib/protocol.js': ['D10'],
  'omd:lib/routing.js': ['D12'],
  'omd:lib/runstate.js': ['D13'],
  'omd:lib/runtime.js': ['D10'],
  'omd:lib/skills.js': ['D2'],
  'omd:lib/team.js': ['D6'],
  'omd:lib/tryget.js': ['D10'],
  'omd:lib/worktree.js': ['D13'],
  // mcp-server/tools/*.mjs（逐文件规则）
  'omd:mcp-server/tools/codeintel.mjs': ['D4'],
  'omd:mcp-server/tools/codeintel-astgrep.mjs': ['D4'],
  'omd:mcp-server/tools/events.mjs': ['D12'],
  'omd:mcp-server/tools/graph.mjs': ['D14'],
  'omd:mcp-server/tools/handoff.mjs': ['D4'],
  'omd:mcp-server/tools/hud.mjs': ['D7'],
  'omd:mcp-server/tools/notepad.mjs': ['D4'],
  'omd:mcp-server/tools/prd.mjs': ['D4'],
  'omd:mcp-server/tools/state.mjs': ['D11'],
  'omd:mcp-server/tools/team.mjs': ['D6'],
  'omd:mcp-server/tools/trace.mjs': ['D4'],
  // tests/ 顶层（首级目录级前缀 + 顶层文件逐条）
  'omd:tests/assets/': ['D15'],
  'omd:tests/docs/': ['D15'],
  'omd:tests/fixtures/': ['D15'],
  'omd:tests/lib/': ['D15'],
  'omd:tests/mcp-server/': ['D15'],
  'omd:tests/package-peer-range.test.js': ['D15'],
  'omd:tests/smoke.test.js': ['D15'],
  // docs/（逐文件规则；docs/ 下出现首级子目录即 orphan——预期摩擦）
  'omd:docs/dimension-framework.md': ['D16'],
  'omd:docs/compat-retirement.md': ['D16'],
  'omd:docs/hud-effort-seam.md': ['D16'],
  'omd:docs/pr-dsh-adapt.md': ['D16'],
  'omd:docs/soft-alias-assessment.md': ['D16'],
  'omd:docs/plugin-review-logs-hud-2026-10-29.md': ['D16'],
  'omd:docs/dsh-017-adapt-audit.md': ['D16'],
  'omd:docs/feature-parity-audit.md': ['D16'],
  'omd:docs/upstream-form-omc.md': ['D16'],
  'omd:docs/upstream-form-omx.md': ['D16'],
  'omd:docs/usability-humanization-review.md': ['D16'],
  'omd:docs/code-quality-logic-review.md': ['D16'],
  'omd:docs/graph-runtime-review.md': ['D16'],
  'omd:docs/plugin-audit-2026-10-26.md': ['D16'],
  'omd:docs/plugin-review-closure-hud-ux-2026-10-26.md': ['D16'],
  // scripts/ + bin/（逐文件规则）
  'omd:scripts/audit-dimension-closure.mjs': ['D16'],
  'omd:scripts/audit-upstream-forms.mjs': ['D16'],
  'omd:scripts/install-local.ps1': ['D16'],
  'omd:bin/graph-runner.mjs': ['D14'],
  // reference/oh-my-claudecode 顶层（按名取仓；快照 v5.7.0 实测 32 目录，逐目录规则）
  'ref:oh-my-claudecode/.claude-plugin': ['D8'],
  'ref:oh-my-claudecode/.clawhip': ['D11'],
  'ref:oh-my-claudecode/.github': ['D15'],
  'ref:oh-my-claudecode/.omc': ['D11'],
  'ref:oh-my-claudecode/.omx': ['D11'],
  'ref:oh-my-claudecode/agents': ['D3'],
  'ref:oh-my-claudecode/assets': ['D2'],
  'ref:oh-my-claudecode/benchmark': ['D15'],
  'ref:oh-my-claudecode/benchmarks': ['D15'],
  'ref:oh-my-claudecode/bin': ['D8'],
  'ref:oh-my-claudecode/bridge': ['D6', 'D8'],
  'ref:oh-my-claudecode/commands': ['D8'],
  'ref:oh-my-claudecode/design-system': ['D2'],
  'ref:oh-my-claudecode/dist': ['D8'],
  'ref:oh-my-claudecode/docs': ['D16'],
  'ref:oh-my-claudecode/examples': ['D16'],
  'ref:oh-my-claudecode/generated': ['D2'],
  'ref:oh-my-claudecode/geobench': ['D15'],
  'ref:oh-my-claudecode/hooks': ['D5'],
  'ref:oh-my-claudecode/inventory': ['D8'],
  'ref:oh-my-claudecode/missions': ['D4'],
  'ref:oh-my-claudecode/native': ['D9'],
  'ref:oh-my-claudecode/receipts': ['D4'],
  'ref:oh-my-claudecode/research': ['D16'],
  'ref:oh-my-claudecode/scripts': ['D15'],
  'ref:oh-my-claudecode/seminar': ['D16'],
  'ref:oh-my-claudecode/shellmark': ['D9'],
  'ref:oh-my-claudecode/skills': ['D2'],
  'ref:oh-my-claudecode/src': ['D9'],
  'ref:oh-my-claudecode/templates': ['D2'],
  'ref:oh-my-claudecode/tests': ['D15'],
  // reference/oh-my-codex 顶层（按名取仓；快照 v0.21.9 实测 16 目录，逐目录规则）
  'ref:oh-my-codex/.agents': ['D3'],
  'ref:oh-my-codex/.github': ['D15'],
  'ref:oh-my-codex/.gjc': ['D11'],
  'ref:oh-my-codex/artifacts': ['D4'],
  'ref:oh-my-codex/crates': ['D9'],
  'ref:oh-my-codex/docs': ['D16'],
  'ref:oh-my-codex/geobench': ['D15'],
  'ref:oh-my-codex/missions': ['D4'],
  'ref:oh-my-codex/notes': ['D16'],
  'ref:oh-my-codex/packages': ['D8'],
  'ref:oh-my-codex/playground': ['D15'],
  'ref:oh-my-codex/plugins': ['D8'],
  'ref:oh-my-codex/prompts': ['D2'],
  'ref:oh-my-codex/scripts': ['D15'],
  'ref:oh-my-codex/skills': ['D2'],
  'ref:oh-my-codex/src': ['D9'],
  'ref:oh-my-codex/templates': ['D2'],
};

const MAP_KEYS = Object.keys(MAP);
// 前缀命中：目录级前缀键以 / 结尾；命中集合取并集（多维归属合法），零命中→orphan
function matchDims(entry) {
  const dims = new Set();
  for (const k of MAP_KEYS) {
    if (entry === k || (k.endsWith('/') && entry.startsWith(k))) for (const d of MAP[k]) dims.add(d);
  }
  return [...dims].sort();
}

function listTopDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
  } catch { return null; }
}

function gitLsFiles() {
  try {
    return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      .trim().split('\n').filter(Boolean);
  } catch (e) {
    warn('git ls-files 失败（git 不可用或仓损坏），omd 面枚举降级为 null: ' + e.message);
    return null;
  }
}

// ── omd 面枚举（基 git ls-files；声明面 = assets/skills/*、assets/agents 双语对、lib/ 顶层、
//    mcp-server/tools/*.mjs、tests/ 顶层、docs/、scripts/、bin/ + 根域顶层去重）──
function enumerateOmd() {
  const files = gitLsFiles();
  if (files === null) return { entries: null, orphans: [] };
  const visible = files.filter(f => !f.startsWith('reference/') && !f.startsWith('node_modules/') && !f.endsWith('.tgz'));

  // .omd 特殊规则：允许且仅允许恰一条 .omd/plans/upgrade-tracking.md，其余 .omd 路径直接进孤儿
  const omdBadPaths = visible.filter(f => f.startsWith('.omd/') && f !== OMD_ALLOWED_PATH);

  const entries = [];
  const tops = [...new Set(visible.filter(f => !f.startsWith('.omd/')).map(f => f.split('/')[0]))].sort();
  const topsAll = [...new Set(visible.map(f => f.split('/')[0]))].sort();
  // 根域自闭合（M-2）：顶层去重 ⊆ 白名单（.omd 走特殊规则位）；白名单外顶层照常产 entry，由映射器判孤儿
  for (const t of topsAll) entries.push('omd:root/' + t);
  for (const p of omdBadPaths) entries.push('omd:omd-path/' + p);

  const inTree = (prefix) => visible.filter(f => f.startsWith(prefix));
  // assets/skills/*（目录级条目）
  for (const s of [...new Set(inTree('assets/skills/').map(f => f.split('/')[2]))].sort()) entries.push('omd:assets/skills/' + s);
  // assets/agents 双语对（.md / .zh.md 去重为角色位）
  const agentRoles = [...new Set(inTree('assets/agents/').map(f => f.split('/').pop().replace(/\.zh\.md$|\.md$/, '')))].sort();
  for (const r of agentRoles) entries.push('omd:assets/agents/' + r);
  // assets/ 其余首级目录（目录级条目）
  const assetOther = [...new Set(visible.filter(f => f.startsWith('assets/') && !f.startsWith('assets/skills/') && !f.startsWith('assets/agents/')).map(f => f.split('/')[1]))].sort();
  for (const d of assetOther) entries.push('omd:assets/' + d + '/');
  // lib/ 顶层（文件逐条 + 首级目录级条目）
  for (const f of inTree('lib/')) {
    const parts = f.split('/');
    entries.push(parts.length === 2 ? 'omd:lib/' + parts[1] : 'omd:lib/' + parts[1] + '/');
  }
  // mcp-server/tools/*.mjs（逐文件；mcp-server/ 其余路径由根域白名单承载，不进声明面）
  for (const f of inTree('mcp-server/tools/').filter(f => f.endsWith('.mjs') && f.split('/').length === 3)) entries.push('omd:mcp-server/tools/' + f.split('/')[2]);
  // tests/ 顶层（文件逐条 + 首级目录级条目）
  for (const f of inTree('tests/')) {
    const parts = f.split('/');
    entries.push(parts.length === 2 ? 'omd:tests/' + parts[1] : 'omd:tests/' + parts[1] + '/');
  }
  // docs/（逐文件；首级子目录出现即目录级条目→无规则→orphan，预期摩擦）
  for (const f of inTree('docs/')) {
    const parts = f.split('/');
    entries.push(parts.length === 2 ? 'omd:docs/' + parts[1] : 'omd:docs/' + parts[1] + '/');
  }
  // scripts/ + bin/（逐文件）
  for (const f of inTree('scripts/')) entries.push('omd:scripts/' + f.split('/').slice(1).join('/'));
  for (const f of inTree('bin/')) entries.push('omd:bin/' + f.split('/').slice(1).join('/'));

  const unique = [...new Set(entries)].sort();
  const orphans = unique.filter(e => matchDims(e).length === 0);
  return { entries: unique, orphans };
}

// ── reference 面枚举（按名取两仓顶层目录清单 + reference/ 顶层漂移哨兵）──
function enumerateRef() {
  const refTop = listTopDirs(REF);
  if (refTop === null) {
    warn('reference/ 缺席（gitignored 本机快照），referenceTopLevel=null，两仓面跳过');
  } else {
    for (const d of refTop) {
      if (!REF_TOP_DECLARED.includes(d)) warn('reference/ 顶层出现声明外目录: ' + d + '（漂移哨兵，告警不红）');
    }
  }
  const refEntries = {};
  const refOrphans = [];
  for (const repo of REF_REPOS) {
    const dirs = listTopDirs(path.join(REF, repo));
    if (dirs === null) {
      warn('reference/' + repo + ' 缺席（gitignored 本机快照），该仓闭包枚举跳过（ref=null）');
      refEntries[repo] = null;
      continue;
    }
    // 只顶层：.git 等元目录不参与映射闭包（非用户/agent 可见能力面）
    const visibleDirs = dirs.filter(d => d !== '.git');
    refEntries[repo] = visibleDirs.map(d => 'ref:' + repo + '/' + d);
    for (const e of refEntries[repo]) if (matchDims(e).length === 0) refOrphans.push(e);
  }
  return { referenceTopLevel: refTop, refEntries, refOrphans };
}

const omd = enumerateOmd();
const ref = enumerateRef();

const report = {
  generatedAt: new Date().toISOString(),
  root: ROOT,
  entries: { omd: omd.entries, ref: ref.refEntries },
  orphans: { omd: omd.orphans, ref: ref.refOrphans },
  referenceTopLevel: ref.referenceTopLevel,
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.exit(0);
