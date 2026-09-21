// CLI 集成测试：经 child_process 实测 bin/wczh.js 的真实进程行为。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'wczh.js');
const execFileAsync = promisify(execFile);

async function wczh(args = [], input = undefined) {
  const child = execFile(process.execPath, [BIN, ...args]);
  if (input !== undefined) {
    child.stdin.write(input);
  }
  child.stdin.end();
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('stdin 默认三计数（-l -w -c）', async () => {
  const r = await wczh([], 'hello world\n');
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '1 2 12\n');
});

test('单标志 -l 只输出行数', async () => {
  const r = await wczh(['-l'], 'a\nb\nc\n');
  assert.equal(r.stdout, '3\n');
});

test('组合短标志 -wm 输出词数与码点字符数', async () => {
  const r = await wczh(['-wm'], 'a🙂b');
  assert.equal(r.stdout, '1 3\n');
});

test('--zh 追加 cjk_chars 与 cjk_words', async () => {
  const r = await wczh(['--zh'], '你好 world\n');
  assert.equal(r.code, 0);
  // lines=1 words=2（"你好" 整段 1 词）bytes=13 cjkChars=2 cjkWords=3（1 非中文词 + 2 汉字）
  assert.equal(r.stdout, '1 2 13 2 3\n');
});

test('文件输入带文件名列', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wczh-'));
  try {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'one two three\n');
    const r = await wczh([file]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, `1 3 14 ${file}\n`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('多文件输出逐行 + total 行', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wczh-'));
  try {
    const a = join(dir, 'a.txt');
    const b = join(dir, 'b.txt');
    await writeFile(a, 'x y\n');
    await writeFile(b, 'z\n');
    const r = await wczh(['-l', a, b]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, `1 ${a}\n1 ${b}\n2 total\n`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('缺失文件：stderr 报错、exit 1、其余文件继续统计', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wczh-'));
  try {
    const ok = join(dir, 'ok.txt');
    const missing = join(dir, 'nope.txt');
    await writeFile(ok, 'a b\n');
    const r = await wczh(['-l', missing, ok]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /wczh: .+nope\.txt: No such file or directory/);
    // total 行只累计成功读取的文件
    assert.equal(r.stdout, `1 ${ok}\n1 total\n`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('--help 打印用法且 exit 0', async () => {
  const r = await wczh(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /用法: wczh/);
});

test('--version 打印版本号且 exit 0', async () => {
  const r = await wczh(['--version']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^0\.1\.0\n$/);
});

test('未知长标志 exit 1', async () => {
  const r = await wczh(['--nope'], '');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unrecognized option/);
});

test('显式 "-" 读 stdin 且不带文件名', async () => {
  const r = await wczh(['-w', '-'], 'a b c\n');
  assert.equal(r.stdout, '3\n');
});

test('双 "-"：stdin 只读一次，复用结果不挂起，total 累计两行', async () => {
  const r = await wczh(['-l', '-', '-'], 'a\nb\n');
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '2\n2\n4 total\n');
});

test('目录参数：EISDIR 映射为 "Is a directory"，exit 1', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wczh-'));
  try {
    const r = await wczh(['-l', dir]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Is a directory/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('未知短标志 -x exit 1', async () => {
  const r = await wczh(['-x'], '');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /invalid option/);
});

test('--zh 多文件：两 cjk 列逐行 + total 累计', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wczh-'));
  try {
    const a = join(dir, 'a.txt');
    const b = join(dir, 'b.txt');
    await writeFile(a, '你好 world\n');
    await writeFile(b, '再见\n');
    const r = await wczh(['-w', '--zh', a, b]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, `2 2 3 ${a}\n1 2 2 ${b}\n3 4 5 total\n`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('单文件 --json：JSON.parse 可解析且四字段为数值', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wczh-'));
  try {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'one two three\n');
    const r = await wczh(['--json', file]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    for (const field of ['lines', 'words', 'chars', 'bytes']) {
      assert.equal(typeof parsed[field], 'number');
    }
    assert.deepEqual(
      { lines: parsed.lines, words: parsed.words, chars: parsed.chars, bytes: parsed.bytes },
      { lines: 1, words: 3, chars: 14, bytes: 14 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('多文件 --json：输出数组且每项含 file 字段', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wczh-'));
  try {
    const a = join(dir, 'a.txt');
    const b = join(dir, 'b.txt');
    await writeFile(a, 'x y\n');
    await writeFile(b, 'z\n');
    const r = await wczh(['--json', a, b]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed.length, 3); // 两文件 + total
    for (const item of parsed) {
      assert.equal(typeof item.file, 'string');
      assert.equal(typeof item.lines, 'number');
    }
    assert.deepEqual(parsed.map((item) => item.file), [a, b, 'total']);
    assert.equal(parsed[2].lines, 2);
    // total 全字段累计（含默认未选中的 chars），且与文件项字段 schema 一致
    assert.deepEqual(
      { lines: parsed[2].lines, words: parsed[2].words, chars: parsed[2].chars, bytes: parsed[2].bytes },
      { lines: 2, words: 3, chars: 6, bytes: 6 });
    for (const item of parsed) {
      assert.deepEqual(Object.keys(item).sort(),
        ['bytes', 'chars', 'file', 'lines', 'words']);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('列选择 flag 与 --json 组合：仍输出全字段计数', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wczh-'));
  try {
    const a = join(dir, 'a.txt');
    const b = join(dir, 'b.txt');
    await writeFile(a, 'x y\n');
    await writeFile(b, 'z\n');
    const r = await wczh(['-l', '--json', a, b]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    assert.ok(Array.isArray(parsed));
    for (const item of parsed) {
      for (const field of ['lines', 'words', 'chars', 'bytes']) {
        assert.equal(typeof item[field], 'number');
      }
    }
    assert.deepEqual(
      { lines: parsed[2].lines, words: parsed[2].words, chars: parsed[2].chars, bytes: parsed[2].bytes },
      { lines: 2, words: 3, chars: 6, bytes: 6 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('默认输出回归：同文件加不加 --json 之外行为逐字节不变', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wczh-'));
  try {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'one two three\n');
    const r = await wczh([file]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, `1 3 14 ${file}\n`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('单文件 --csv：header 行 + 数据行，数值正确', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wczh-'));
  try {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'one two three\n');
    const r = await wczh(['--csv', file]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout,
      `file,lines,words,chars,bytes\n${file},1,3,14,14\n`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('多文件 --csv：逐文件行 + total 全字段累计正确', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wczh-'));
  try {
    const a = join(dir, 'a.txt');
    const b = join(dir, 'b.txt');
    await writeFile(a, 'x y\n');
    await writeFile(b, 'z\n');
    const r = await wczh(['--csv', a, b]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout,
      'file,lines,words,chars,bytes\n' +
      `${a},1,2,4,4\n` +
      `${b},1,1,2,2\n` +
      'total,2,3,6,6\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('默认输出回归（--csv 加入后）：无 --csv 时文本输出逐字节不变', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wczh-'));
  try {
    const a = join(dir, 'a.txt');
    const b = join(dir, 'b.txt');
    await writeFile(a, 'x y\n');
    await writeFile(b, 'z\n');
    const r = await wczh(['-l', a, b]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, `1 ${a}\n1 ${b}\n2 total\n`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
