// mcp-server/lib/paths.mjs
import { isAbsolute, join } from 'node:path'

const SAFE_ID = /^[A-Za-z0-9_-]+$/

/** stateDir 安全校验（刻板审查修复：此前不进 SAFE_ID 体系，'../x' 可逃逸工作区）。 */
function assertSafeStateDir(stateDir) {
  if (typeof stateDir !== 'string' || stateDir.length === 0 || isAbsolute(stateDir) || stateDir.split(/[\\/]/).includes('..'))
    throw new Error(`unsafe stateDir: ${String(stateDir)}（须为工作区内的相对目录名，禁绝对路径与 .. 段）`)
  return stateDir
}

/** 统一输出 POSIX 分隔符（Windows 上 join 产生 \；Node 文件 API 均接受 /，跨平台记录更可移植）。 */
const pjoin = (...segs) => join(...segs).replaceAll('\\', '/')

/** cwd 安全校验（2026-10-29 code-review 立项：此前 cwd 不设防，?cwd= 可指向仓外只读面）。
 *  契约：绝对路径（Win 盘符/UNC/POSIX）、无 .. 段、长度有界；不做存在性检查（首跑/清理场景合法）。 */
export function assertSafeCwd(cwd) {
  const s = typeof cwd === 'string' ? cwd : ''
  const isWin = /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('\\\\')
  const isPosix = s.startsWith('/')
  if (!s || s.length > 4096 || (!isWin && !isPosix) || s.split(/[\\/]/).includes('..'))
    throw new Error(`unsafe cwd: ${String(cwd).slice(0, 64)}（须为绝对工作区路径，禁 .. 段与相对路径）`)
  return cwd
}

/**
 * .omd/ 路径解析（规格 §5.1：per-mode + per-session 隔离）。
 * @returns 各标准路径；stateFile(mode) 生成 <root>/state/sessions/<sid>/<mode>-state.json
 */
export function omdPaths({ cwd, stateDir = '.omd', sessionId }) {
  assertSafeCwd(cwd)
  if (!SAFE_ID.test(sessionId)) throw new Error(`unsafe sessionId: ${sessionId}`)
  assertSafeStateDir(stateDir)
  const root = pjoin(cwd, stateDir)
  const sessionDir = pjoin(root, 'state', 'sessions', sessionId)
  return {
    root, sessionDir,
    stateFile: (mode) => {
      if (!SAFE_ID.test(mode)) throw new Error(`unsafe mode: ${mode}`)
      return pjoin(sessionDir, `${mode}-state.json`)
    },
    boulder: pjoin(root, 'state', 'boulder.json'),
    plans: pjoin(root, 'plans'),
    specs: pjoin(root, 'specs'),
    prdDir: pjoin(root, 'prd'),
    handoffs: pjoin(root, 'handoffs'),
    traces: pjoin(root, 'trace'),
    checkpoints: pjoin(root, 'checkpoints'),
    notepad: pjoin(root, 'notepad.md'),
    logs: pjoin(root, 'logs'),
  }
}
