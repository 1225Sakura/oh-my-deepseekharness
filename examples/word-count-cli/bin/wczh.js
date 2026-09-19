#!/usr/bin/env node
// wczh 薄壳：接线 process 流后委托 src/cli.js 的 run()。
import { readFile } from 'node:fs/promises';
import { run } from '../src/cli.js';

// stdin 只读一次：缓存 Promise，重复传 "-" 时复用结果而不是挂起等新 'end'。
let stdinPromise;
function readStdin() {
  stdinPromise ??= new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
  return stdinPromise;
}

process.exitCode = await run(process.argv.slice(2), {
  readStdin,
  readFile: (path) => readFile(path, 'utf8'),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
});
