// mcp-server/lib/paths.mjs
import { join } from 'node:path'

const SAFE_ID = /^[A-Za-z0-9_-]+$/

/** 统一输出 POSIX 分隔符（Windows 上 join 产生 \；Node 文件 API 均接受 /，跨平台记录更可移植）。 */
const pjoin = (...segs) => join(...segs).replaceAll('\\', '/')

/**
 * .omd/ 路径解析（规格 §5.1：per-mode + per-session 隔离）。
 * @returns 各标准路径；stateFile(mode) 生成 <root>/state/sessions/<sid>/<mode>-state.json
 */
export function omdPaths({ cwd, stateDir = '.omd', sessionId }) {
  if (!SAFE_ID.test(sessionId)) throw new Error(`unsafe sessionId: ${sessionId}`)
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
