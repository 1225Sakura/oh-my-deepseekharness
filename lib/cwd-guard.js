// lib/cwd-guard.js
// cwd 安全校验单源（2026-10-29 cwd 白名单收口，R2/R4 评审后三消费方合一）：
// - mcp-server/lib/paths.mjs（omdPaths 中心断言，re-export assertSafeCwd）
// - lib/worktree.js runStatePath（直读面守卫：team readMirror / hud readMirrorRunState / hud-route）
// - lib/hud-route.js 路由守卫（isSafeWorkspaceCwd 布尔形态）
// - lib/team.js teamRunDir（phase/registry/mailbox/merge 全家）
// 规则：绝对路径（Win 盘符/UNC/POSIX）、无 .. 段、长度有界；不做存在性检查（首跑/清理场景合法）。
export function assertSafeWorkspaceCwd(cwd) {
  const s = typeof cwd === 'string' ? cwd : ''
  const isWin = /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('\\\\')
  const isPosix = s.startsWith('/')
  if (!s || s.length > 4096 || (!isWin && !isPosix) || s.split(/[\\/]/).includes('..'))
    throw new Error(`unsafe cwd: ${String(s).slice(0, 64)}（须为绝对工作区路径，禁 .. 段与相对路径）`)
  return cwd
}

export function isSafeWorkspaceCwd(cwd) {
  try { assertSafeWorkspaceCwd(cwd); return true } catch { return false }
}
