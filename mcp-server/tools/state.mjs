// mcp-server/tools/state.mjs
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteJson, readJson } from '../lib/atomic.mjs'
import { omdPaths } from '../lib/paths.mjs'

const ECHO_MAX = 1200

export function makeStateTools(env) {
  async function read({ cwd, sessionId, mode }) {
    return await readJson(omdPaths({ cwd, stateDir: env.stateDir, sessionId }).stateFile(mode))
  }
  async function write({ cwd, sessionId, mode, state, expectUpdatedAt }) {
    const file = omdPaths({ cwd, stateDir: env.stateDir, sessionId }).stateFile(mode)
    // 会话所有权强制（规格 §5.1）：per-session 文件布局下，须扫描其他会话的同名 mode 状态文件。
    // 注：计划原代码只检查本文件 cur._meta.sessionId，在 per-session 布局下永远不会冲突，无法满足测试断言，此处修正。
    const sessionsRoot = join(cwd, env.stateDir, 'state', 'sessions')
    let sids = []
    try { sids = await readdir(sessionsRoot) } catch { /* 尚无会话目录 */ }
    for (const sid of sids) {
      if (sid === sessionId) continue
      const otherPath = join(sessionsRoot, sid, `${mode}-state.json`)
      const other = await readJson(otherPath)
      if (other && other._meta?.sessionId !== sessionId)
        // 孤儿文件（缺 _meta）时显示 <unknown> + 文件路径，不出现 'undefined'（终审 L3）
        throw new Error(`state is owned by session '${other._meta?.sessionId ?? '<unknown>'}' (file: ${otherPath}) and cannot be modified by session '${sessionId}'`)
    }
    const cur = await readJson(file)
    if (cur && cur._meta.sessionId !== sessionId)
      throw new Error(`state is owned by session '${cur._meta.sessionId}' and cannot be modified by session '${sessionId}'`)
    if (expectUpdatedAt !== undefined && cur?._meta.updatedAt !== expectUpdatedAt)
      throw new Error(`conflict: current updatedAt is '${cur?._meta.updatedAt}', expected '${expectUpdatedAt}'`)
    if (typeof state.prompt_echo === 'string' && state.prompt_echo.length > ECHO_MAX)
      state = { ...state, prompt_echo: state.prompt_echo.slice(0, ECHO_MAX) }
    await atomicWriteJson(file, {
      ...state,
      _meta: { mode, sessionId, updatedAt: new Date().toISOString(), updatedBy: sessionId },
    })
    return { ok: true }
  }
  async function clear({ cwd, sessionId, mode }) {
    await rm(omdPaths({ cwd, stateDir: env.stateDir, sessionId }).stateFile(mode), { force: true })
    return { ok: true }
  }
  async function listActive({ cwd }) {
    const root = join(cwd, env.stateDir, 'state', 'sessions')
    const out = []
    let sids = []
    try { sids = await readdir(root) } catch { return out }
    for (const sid of sids) {
      let files = []
      try { files = await readdir(join(root, sid)) } catch { continue }
      for (const f of files) {
        if (!f.endsWith('-state.json')) continue
        const s = await readJson(join(root, sid, f))
        if (s?.active === true) out.push(s)
      }
    }
    return out
  }
  async function getStatus({ cwd }) {
    const active = await listActive({ cwd })
    return {
      activeCount: active.length,
      modes: active.map(s => ({
        mode: s._meta.mode, sessionId: s._meta.sessionId,
        current_phase: s.current_phase, iteration: s.iteration,
        // c4 HUD 五要素之二：加性透传（现成读面零新宿主槽位；缺席=undefined，消费方自兜底）
        current_story: s.current_story, active_agents: s.active_agents,
        updatedAt: s._meta.updatedAt,
        stale: Date.now() - Date.parse(s._meta.updatedAt) > 2 * 3600_000,  // 规格 §5.4 stale 2h
      })),
    }
  }
  return { read, write, clear, listActive, getStatus }
}

/** MCP 绑定层：参数类型化（有意修正 OMC 字符串传输怪癖，规格 §1 分歧表）。 */
export function registerStateTools(server, env) {
  const t = makeStateTools(env)
  const base = { cwd: z.string(), sessionId: z.string() }
  const mode = { mode: z.string() }
  server.registerTool('state_read', { description: '读取 .omd 模式状态（per-session）', inputSchema: { ...base, ...mode } },
    async (a) => jsonOut(await t.read(a) ?? { exists: false }))
  server.registerTool('state_write', { description: '写入模式状态（所有权强制 + 可选写前读检查 expectUpdatedAt）',
    inputSchema: { ...base, ...mode, state: z.record(z.any()), expectUpdatedAt: z.string().optional() } },
    async (a) => jsonOut(await t.write(a)))
  server.registerTool('state_clear', { description: '清除模式状态（幂等）', inputSchema: { ...base, ...mode } },
    async (a) => jsonOut(await t.clear(a)))
  server.registerTool('state_list_active', { description: '列出全部活跃模式（跨会话只读）', inputSchema: { cwd: z.string() } },
    async (a) => jsonOut(await t.listActive(a)))
  server.registerTool('state_get_status', { description: '聚合状态 + stale 检测', inputSchema: { cwd: z.string() } },
    async (a) => jsonOut(await t.getStatus(a)))
}

function jsonOut(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value ?? null) }] }
}
