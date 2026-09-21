// CLI 纯逻辑层：参数解析、计数编排、wc 风格表格输出。I/O 全部经参数注入，便于测试。
import countText from './count.js';

export const VERSION = '0.1.0';

export const HELP = `wczh — wc 兼容字数统计，附中文感知模式

用法: wczh [选项] [文件...]
  -l          统计行数（'\\n' 数）
  -w          统计词数（空白分隔）
  -c          统计字节数（UTF-8）
  -m          统计字符数（Unicode 码点）
  --zh        追加 cjk_chars 与 cjk_words 两列（每个 CJK 字计 1 词）
  --json      以单行 JSON 输出计数（多文件时为数组，每项含 file 字段）
  --csv       以 CSV 输出计数（header 行 + 数据行，多文件含 total 行）
  --help      显示本帮助
  --version   显示版本号
无文件参数或文件为 "-" 时读标准输入；无计数选项时默认 -l -w -c。
`;

// 列顺序对齐 wc 惯例：newline, word, character, byte；--zh 追加两列。
const FLAG_TO_COLUMN = { l: 'lines', w: 'words', m: 'chars', c: 'bytes' };

export function parseArgs(argv) {
  const flags = { l: false, w: false, c: false, m: false, zh: false };
  const files = [];
  let help = false;
  let version = false;
  let json = false;
  let csv = false;
  for (const arg of argv) {
    if (arg === '--help') { help = true; continue; }
    if (arg === '--version') { version = true; continue; }
    if (arg === '--zh') { flags.zh = true; continue; }
    if (arg === '--json') { json = true; continue; }
    if (arg === '--csv') { csv = true; continue; }
    if (arg === '-' || !arg.startsWith('-')) { files.push(arg); continue; }
    if (arg.startsWith('--')) return { error: `wczh: unrecognized option '${arg}'` };
    for (const ch of arg.slice(1)) {
      if (!(ch in FLAG_TO_COLUMN)) return { error: `wczh: invalid option -- '${ch}'` };
      flags[ch] = true;
    }
  }
  return { flags, files, help, version, json, csv };
}

export function selectedColumns(flags) {
  const cols = [];
  for (const ch of ['l', 'w', 'm', 'c']) if (flags[ch]) cols.push(FLAG_TO_COLUMN[ch]);
  if (flags.zh) cols.push('cjkChars', 'cjkWords');
  return cols;
}

export function formatTable(rows, cols) {
  const widths = cols.map((col) =>
    Math.max(0, ...rows.map((row) => String(row.counts[col]).length)));
  const lines = rows.map((row) => {
    const nums = cols.map((col, i) => String(row.counts[col]).padStart(widths[i])).join(' ');
    return row.name === null ? nums : `${nums} ${row.name}`;
  });
  return lines.length === 0 ? '' : lines.join('\n') + '\n';
}

// CSV 输出：列与 countKeys 全字段集一致（file 打头），与 --json 同样不受列选择 flag 影响。
export function formatCsv(rows, countKeys) {
  const header = ['file', ...countKeys].join(',');
  const lines = rows.map((row) =>
    [row.name ?? '', ...countKeys.map((key) => row.counts[key])].join(','));
  return [header, ...lines].join('\n') + '\n';
}

// wc 风格的错误文案：按 errno 映射，不把所有读取失败都叫 "No such file or directory"。
export function readErrorReason(err) {
  switch (err?.code) {
    case 'ENOENT': return 'No such file or directory';
    case 'EISDIR': return 'Is a directory';
    case 'EACCES':
    case 'EPERM': return 'Permission denied';
    default: return err?.message ?? 'read error';
  }
}

/**
 * @param argv 去掉 node/脚本名后的参数
 * @param io { readStdin, readFile, stdout, stderr } — readFile 失败须 reject
 * @returns 退出码（任何文件读取失败为 1，其余路径 0）
 */
export async function run(argv, io) {
  const parsed = parseArgs(argv);
  if (parsed.error !== undefined) {
    io.stderr(parsed.error + '\n');
    return 1;
  }
  if (parsed.help) {
    io.stdout(HELP);
    return 0;
  }
  if (parsed.version) {
    io.stdout(VERSION + '\n');
    return 0;
  }
  const flags = parsed.flags;
  if (!flags.l && !flags.w && !flags.c && !flags.m) {
    flags.l = true;
    flags.w = true;
    flags.c = true;
  }
  const cols = selectedColumns(flags);
  const sources = parsed.files.length > 0 ? parsed.files : ['-'];

  const rows = [];
  // 按 countText 实际返回的字段集初始化 total：zh 开含两 cjk 列，关则不含，
  // 保证 total 与文件项字段 schema 一致，且全字段（含未选中列）都被累计。
  const countKeys = flags.zh
    ? ['lines', 'words', 'chars', 'bytes', 'cjkChars', 'cjkWords']
    : ['lines', 'words', 'chars', 'bytes'];
  const total = Object.fromEntries(countKeys.map((key) => [key, 0]));
  let failed = false;
  for (const source of sources) {
    let text;
    try {
      text = source === '-' ? await io.readStdin() : await io.readFile(source);
    } catch (err) {
      io.stderr(`wczh: ${source}: ${readErrorReason(err)}\n`);
      failed = true;
      continue;
    }
    const counts = countText(text, { zh: flags.zh });
    rows.push({ counts, name: source === '-' ? null : source });
    for (const key of countKeys) total[key] += counts[key];
  }
  if (sources.length > 1) rows.push({ counts: total, name: 'total' });
  if (parsed.json) {
    // 单文件输出单个对象；多文件输出数组，每项含 file 字段（total 行 name 即 'total'）。
    if (rows.length > 0) {
      const payload = sources.length === 1
        ? { ...rows[0].counts }
        : rows.map((row) => ({ file: row.name, ...row.counts }));
      io.stdout(JSON.stringify(payload) + '\n');
    }
  } else if (parsed.csv) {
    // header + 每行一条记录；total 行复用 countKeys 全字段累计结果（同 --json 模式）。
    if (rows.length > 0) {
      io.stdout(formatCsv(rows, countKeys));
    }
  } else if (rows.length > 0) {
    io.stdout(formatTable(rows, cols));
  }
  return failed ? 1 : 0;
}
