// mcp-server/lib/atomic.mjs
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

/** tmp+rename 原子写（规格 §5.5）。自动创建父目录。 */
export async function atomicWriteJson(file, value) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  // 刻板审查修复（报告二）：rename 失败（杀软锁/ACL）清理孤儿 tmp，不再污染状态目录
  try { await rename(tmp, file) }
  catch (e) { await rm(tmp, { force: true }).catch(() => {}); throw e }
}

/** 读 JSON；文件不存在或解析失败返回 fallback（默认 undefined）。 */
export async function readJson(file, fallback = undefined) {
  try { return JSON.parse(await readFile(file, 'utf8')) }
  catch { return fallback }
}

export async function atomicWriteText(file, text) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${randomUUID()}.tmp`
  await writeFile(tmp, text, 'utf8')
  try { await rename(tmp, file) }
  catch (e) { await rm(tmp, { force: true }).catch(() => {}); throw e }
}
