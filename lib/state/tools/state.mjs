// lib/state/tools/state.mjs
// 二期 dsh-native：mode-state 存储迁移——.omd JSON 文件 → 宿主 storageDomain 域
// （lib/state-domain.js：oh_my_dsh_state 域，键 cwdHash:mode:sessionId）。
// 域句柄经 env.table 注入（收集器机制：state-tools.js open 后传入，MCP 绑定层零改动）。
// 并发语义变化：域写链串行单个 put/delete；「扫描-supersede-CAS-写」read-modify-write
// 序列由 serialized() 应用级排队（旧跨进程文件锁的存在理由已随 stdio 子进程消失）。
// 所有权/supersede/provisional 语义逐字段保留（原文件版评审结论全部继承）。
import { z } from 'zod'
import { monotonicIsoNow } from '../../worktree.js'
import { assertSafeCwd } from '../lib/paths.mjs'
import { stateKey, stateModePrefix, stateCwdPrefix, serialized, assertSafeKeyId } from '../../state-domain.js'

const ECHO_MAX = 1200

/** G6 域安全：sessionId/mode 进键空间，拼键前置白名单校验（文案同旧 SAFE_ID）。 */
function assertKeyParams({ sessionId, mode }) {
  assertSafeKeyId('sessionId', sessionId)
  assertSafeKeyId('mode', mode)
}

export function makeStateTools(env) {
  const table = env.table
  if (!table || typeof table.get !== 'function' || typeof table.put !== 'function')
    throw new Error('makeStateTools: env.table 缺席——storageDomain 域未接入（lib/state-domain.js openStateDomain）')

  async function read({ cwd, sessionId, mode }) {
    assertSafeCwd(cwd)
    assertKeyParams({ sessionId, mode })
    return table.get(stateKey(cwd, mode, sessionId)) ?? null
  }

  async function write({ cwd, sessionId, mode, state, expectUpdatedAt }) {
    assertSafeCwd(cwd)
    assertKeyParams({ sessionId, mode })
    // R2/R3 原防线继承：所有权扫描+supersede+CAS+写 整序列按「cwdHash:mode」排队，
    // 模式互斥在并发下仍成立（serialized 应用级互斥接替旧 per-stateDir 文件锁）。
    return serialized(stateModePrefix(cwd, mode), () => writeLocked({ cwd, sessionId, mode, state, expectUpdatedAt }))
  }

  async function writeLocked({ cwd, sessionId, mode, state, expectUpdatedAt }) {
    const k = stateKey(cwd, mode, sessionId)
    const prefix = stateModePrefix(cwd, mode)
    // 会话所有权强制（规格 §5.1）：扫描其他会话的同 cwd 同 mode 状态（键前缀直命中，不再 readdir）
    for (const kk of [...table.keys()]) {
      if (!kk.startsWith(prefix) || kk === k) continue
      const other = table.get(kk)
      if (!other) continue
      // 所有权绑定谓词（IC-20/IC-21）：存活状态绑定所有权；① inactive/已交接、
      // ② keyword-hook 未确认预写（provisional 合取签名）两种非绑定形态由本写 supersede。
      const provisional = other.current_phase === 'keyword-detected' && other.keyword_route?.source === 'keyword-hook'
      if (other.active === true && !provisional)
        throw new Error(`state is owned by session '${other._meta?.sessionId ?? '<unknown>'}' and cannot be modified by session '${sessionId}'`)
      // supersede 取代留痕（ABA 防线 + IC-23 同毫秒单调 token 语义不变）
      const now = monotonicIsoNow(other._meta?.updatedAt)
      await table.put(kk, {
        ...other, active: false, supersededBy: sessionId, supersededAt: now,
        _meta: { ...other._meta, updatedAt: now },
      })
    }
    const cur = table.get(k)
    if (cur && cur._meta.sessionId !== sessionId)
      throw new Error(`conflict: 模式 '${mode}' 的状态归会话 '${cur._meta.sessionId}' 所有，会话 '${sessionId}' 不可修改——若该会话已死，先 state_clear 清理（需持有方会话）或人工删除对应状态记录后重试`)
    if (expectUpdatedAt !== undefined && cur?._meta.updatedAt !== expectUpdatedAt)
      throw new Error(`conflict: CAS 冲突：当前 updatedAt='${cur?._meta.updatedAt}'，你携带的是 '${expectUpdatedAt}'——先 state_read 重读，携最新 _meta.updatedAt 重试`)
    if (typeof state.prompt_echo === 'string' && state.prompt_echo.length > ECHO_MAX)
      state = { ...state, prompt_echo: state.prompt_echo.slice(0, ECHO_MAX) }
    await table.put(k, {
      ...state,
      // IC-23 同族：常规写路径同毫秒碰撞防线（token 单调严格递增）
      _meta: { mode, sessionId, updatedAt: monotonicIsoNow(cur?._meta?.updatedAt), updatedBy: sessionId },
    })
    return { ok: true }
  }

  async function clear({ cwd, sessionId, mode }) {
    assertSafeCwd(cwd)
    assertKeyParams({ sessionId, mode })
    await table.delete(stateKey(cwd, mode, sessionId))
    return { ok: true }
  }

  async function listActive({ cwd }) {
    return (await scanAll({ cwd })).filter(s => s?.active === true)
  }

  /** 全量扫描（active 与否都收），HUD「上次活动」等派生面的数据源；内存键扫有界化同旧口径。 */
  async function scanAll({ cwd }) {
    assertSafeCwd(cwd)
    const prefix = stateCwdPrefix(cwd)
    const out = []
    for (const kk of table.keys()) {
      if (!kk.startsWith(prefix)) continue
      const v = table.get(kk)
      if (v) out.push(v)
    }
    return out.slice(0, 10000) // 有界化（旧 200 会话×50 文件同量级上限）
  }

  async function getStatus({ cwd }) {
    const all = await scanAll({ cwd })
    const active = all.filter(s => s?.active === true)
    // HUD：lastActivity=全部状态记录里最新的一次写（含已收尾模式）
    let lastActivity = null
    for (const s of all) {
      const at = s?._meta?.updatedAt
      if (!at) continue
      if (!lastActivity || at > lastActivity.updatedAt)
        lastActivity = { mode: s._meta.mode, updatedAt: at }
    }
    return {
      activeCount: active.length,
      lastActivity,
      modes: active.map(s => {
        // stale 双语义：team 模式用 team.staleAfterMs，其余规格 §5.4 的 2h
        const staleAfterMs = s._meta.mode === 'team' ? (env.teamStaleAfterMs ?? 300_000) : 2 * 3600_000
        return {
          mode: s._meta.mode, sessionId: s._meta.sessionId,
          current_phase: s.current_phase, iteration: s.iteration,
          current_story: s.current_story, active_agents: s.active_agents,
          prompt_echo: typeof s.prompt_echo === 'string' ? s.prompt_echo.slice(0, 120) : undefined,
          prd_path: typeof s.prd_path === 'string' ? s.prd_path : undefined,
          updatedAt: s._meta.updatedAt,
          stale: Date.now() - Date.parse(s._meta.updatedAt) > staleAfterMs,
          staleAfterMs,
          state: s.state, fixLoops: s.fixLoops ?? s.fix_loop_count,
        }
      }),
    }
  }
  return { read, write, clear, listActive, scanAll, getStatus }
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
