// lib/hud-route.js
// v0.4 P2-D HUD client half 的 node 数据面：在 dsh web 宿主（dsh-host-webserver）上注册
// exact GET 路由 `/oh-my-dsh/hud.json`，向浏览器面板暴露 lib/hud.js 五要素摘要。
// - cwd 解析：?cwd= 显式指定 > process.cwd()（宿主进程锚点，与 heartbeat 定时器同款文档化限制）
// - 服务发现：ctx.get('webServer') 运行时取面（delegate.js 同款，不增 inject——webServer 只在
//   web 宿主组合存在；CLI 会话缺席 → enabled:false 降级，不阻断插件）
// - 安全 posture：webserver 是 loopback-only（127.0.0.1），本路由只读、no-store、
//   暴露的是模式/轮次/todo 计数级低敏摘要（与 state_get_status 同源）；/api 桥的 cookie
//   鉴权不覆盖自定义路由——如实记录此边界。
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { buildHudView, renderCard, PRESETS, HUD_DEFAULT_PRESET } from './hud.js'
import { readEvents, aggregateEvents } from './events.js'
import { makeStateTools } from './state/tools/state.mjs'
import { makeNotepadTools } from './state/tools/notepad.mjs'
import { readJson } from './state/lib/atomic.mjs'
import { runStatePath } from './worktree.js'
import { applyMirrorFallback } from './state/tools/hud.mjs'

export const HUD_ROUTE_PATH = '/oh-my-dsh/hud.json'

/**
 * 面板预设解析（AC11/S8）：读 config.hudPreset，缺省/非法值回退 focused。
 * preset 只进 hud.json，不进 MCP wire（hud_render 形状零变化）。
 */
function resolvePreset(config) {
  return PRESETS.includes(config?.hudPreset) ? config.hudPreset : HUD_DEFAULT_PRESET
}

/**
 * 摘要取数（hud_render MCP 工具的 node 直算版——同一 summarize 契约，不经 MCP 进程）。
 * 响应顶层键集白名单（AC5，U8 S2 扩为 10 键；2026-10-26 审查 S5 扩 {alerts}、HUD 重设计扩 {lastActivity}；
 * 二期③ team 运行时退役 → {workers}/{alerts} 键退役）：
 *   {ok, cwd, summary, card, at} ∪ {detail, modeCatalog, preset} ∪ {toolCalls, lastActivity}
 */
/** cwd 安全校验（2026-10-29 code-review 立项，与 mcp-server/lib/paths.mjs assertSafeCwd 同规则）：
 *  非法 ?cwd= 不 500——回落宿主进程 cwd（面板健壮性优先；与 process.cwd 缺省语义同向）。 */
export function isSafeWorkspaceCwd(cwd) {
  return typeof cwd === 'string' && cwd.length > 0 && cwd.length <= 4096
    && (/^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith('\\\\') || cwd.startsWith('/'))
    && !cwd.split(/[\\/]/).includes('..')
}

export async function hudSnapshot({ cwd, stateDir = '.omd', config, stateTable } = {}) {
  if (!isSafeWorkspaceCwd(cwd)) cwd = process.cwd()
  const env = { stateDir, table: stateTable }
  // 二期②：status 面走 storageDomain 域表（stateTable 经 index.js 透传）；表缺席时
  // makeStateTools 会抛——兜底空聚合（面板显示空态而非 500），notepad 仍走文件态不受影响。
  const status = stateTable
    ? await makeStateTools(env).getStatus({ cwd })
    : { activeCount: 0, lastActivity: null, modes: [] }
  const view = buildHudView({
    status,
    stats: await makeNotepadTools(env).stats({ cwd }),
  })
  // U8 S2 聚合（toolCalls=events.jsonl 读聚，文件缺席/坏行 → 空聚合，不 500）。
  // 二期③：team registry 运行时退役——workers/workers 聚合与 heartbeat 告警面随之消失。
  const [eventsRaw, mirror] = await Promise.all([
    readEvents({ cwd, stateDir }),
    readJson(runStatePath(cwd, stateDir), null).catch(() => null), // P1-W4-1：run-state 镜像回退读
  ])
  const toolCalls = aggregateEvents(eventsRaw)
  // 2026-10-26 审查 R3 修复：PRD 进度 join——主模式 state 里的 prd_path（ralph/ultragoal 契约字段）
  // 指向 .omd/prd/<topic>.json，读出 story 完成度「done/total + 当前 story」并进 detail.prd，
  // HUD 从此回答「我的活儿干到哪了」。prd_path 缺席/文件不可读 → detail.prd 缺席（不炸）。
  const primaryMode = view.detail.modes?.[0]
  let prd = null
  if (typeof primaryMode?.prd_path === 'string' && primaryMode.prd_path) {
    try {
      // R5 评审（次要）：prd_path 前缀约束——resolve 后必须落在 <cwd>/.omd 内，否则置 null
      //（泄露面=任意路径 JSON 的 stories 计数上 loopback 面板；state 由本机模型写，低危）
      const resolvedPrd = resolve(cwd, primaryMode.prd_path)
      const prdRoot = resolve(cwd, '.omd')
      const insidePrdRoot = resolvedPrd === prdRoot || (resolvedPrd.startsWith(prdRoot) && (resolvedPrd[prdRoot.length] === '\\' || resolvedPrd[prdRoot.length] === '/'))
      const prdDoc = insidePrdRoot ? await readJson(resolvedPrd, null) : null
      const stories = Array.isArray(prdDoc?.stories) ? prdDoc.stories : []
      if (stories.length) {
        const done = stories.filter(s => s?.passes === true).length
        const current = stories.find(s => s?.passes !== true)
        prd = { path: primaryMode.prd_path, done, total: stories.length, current: current?.id ?? null }
      }
    } catch { /* PRD 不可读 → 进度行缺席，不阻断快照 */ }
  }
  // 二期③：team registry 运行时退役——alerts 源（heartbeat 扫描）随之消失，告警键退役
  // P1-W4-1（team eco-completion w-P1-3）：state 派生的轮次/故事/代理缺席时，以 run-state
  // 七字段镜像回退补值（summary 上标 roundSource/storySource/agentsSource='mirror'）——
  // HUD 字段不再纯依赖模型自觉 state_write（共识计划 W4-1）。mode 永不被 mirror 覆盖。
  const summary = applyMirrorFallback(view.summary, mirror)
  // AC10：fallback>0 且 deriveTier 原判定 ok → detail.tier 提升 warn；danger 不降级。
  // 窗口语义：fallbackCount 是 64 KiB 尾部窗口内计数，旧 fallback 滑出后 warn 自动消退
  // （有意的「近期信号」语义而非 bug，见 ADR Consequences）。
  const tier = toolCalls.fallbackCount > 0 && view.tier === 'ok' ? 'warn' : view.tier
  const detail = Object.assign({}, view.detail, { tier, lastActivity: view.lastActivity })  // U3/O2：tier 并入 detail 下发（真单源；顶层键集白名单不变）；lastActivity 供 renderCard 空态行
  if (prd) detail.prd = prd
  // P1-W4-2：idle 页价值化——非 omd 模式会话的 detail 增「最近动态」（events 尾部 ≤5，
  // 时间+kind 摘要，坏行剔除）。无 events → 不注入（维持纯 idle 文案）。仅私有 detail 面，
  // MCP wire（hud_render 恰二键）形状零变化。
  if (summary.mode === 'idle') {
    const recent = (Array.isArray(eventsRaw) ? eventsRaw : [])
      .filter(e => e && !e._corrupt)
      .slice(-5)
      .map(e => ({ at: e?.ts ?? e?.at ?? null, kind: e?.kind ?? null }))
    if (recent.length) detail.recent = recent
  }
  const card = renderCard(summary, detail)
  return {
    ok: true,
    cwd,
    summary,
    card,
    at: new Date().toISOString(),
    detail,
    modeCatalog: view.modeCatalog,
    preset: resolvePreset(config),
    lastActivity: view.lastActivity,
    toolCalls,
  }
}

/** node:http handler（WebRoute.handler 形状）。 */
export function makeHudHandler({ stateDir = '.omd', snapshot, config, stateTable } = {}) {
  const snap = snapshot ?? hudSnapshot
  return async function hudHandler(req, res) {
    const send = (code, body) => {
      res.writeHead(code, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        // loopback-only 宿主；面板同源 fetch 无需 CORS 头（不给 = 跨源拒绝，符合最小暴露）
      })
      res.end(JSON.stringify(body))
    }
    try {
      if (req.method !== 'GET') return send(405, { ok: false, error: 'method not allowed（只读路由，仅 GET）' })
      const url = new URL(req.url, 'http://127.0.0.1')
      const cwd = url.searchParams.get('cwd') ?? process.cwd()
      // 评审修复#6：?cwd= 必须真实存在（404 而非静默读任意路径）——收窄路径存在性 oracle；
      // 残余边界（loopback 可读任意已存在目录的 .omd 摘要、0.0.0.0 绑定场景无鉴权）见文件头注
      // R5 评审（次要）：非法 cwd → 404 显式提示（与 snapshot 回落语义的取舍=路由层显式）；
      // 文件（非目录）→ 404（不再 200 宿主回退面板）。
      if (!isSafeWorkspaceCwd(cwd)) return send(404, { ok: false, error: `cwd 非法（须为绝对工作区路径）: ${String(cwd).slice(0, 64)}` })
      try { const st = await stat(cwd); if (!st.isDirectory()) return send(404, { ok: false, error: `cwd 不是目录: ${cwd}` }) } catch { return send(404, { ok: false, error: `cwd 不存在: ${cwd}` }) }
      send(200, await snap({ cwd, stateDir, config, stateTable }))
    } catch (e) {
      send(500, { ok: false, error: String(e?.message ?? e) })
    }
  }
}

import { tryGet } from './tryget.js' // 单源（原三份拷贝之一，刻板审查修复）

/**
 * 注册 HUD 路由。webServer 缺席（CLI 会话/非 web 组合）→ enabled:false 降级。
 * 注册经 ctx.effect 托管（插件重放/卸载自动摘路由）。
 * @returns { enabled, detail }
 */
export function registerHudRoute(ctx, { config, handler, stateTable } = {}) {
  // 刻板审查修复（报告二 安全 P1）：Config 关闭阀——无鉴权路由可整体关停
  if (config?.hudRoute === false)
    return { enabled: false, detail: 'Config hudRoute=false（数据路由未注册；omd_hud_render 仍可用）' }
  const webServer = tryGet(ctx, 'webServer')
  if (!webServer || typeof webServer.register !== 'function')
    return { enabled: false, detail: 'webServer 服务缺席（非 web 宿主组合），HUD 面板无数据路由（omd_hud_render 仍可用）' }
  const h = handler ?? makeHudHandler({ stateDir: config?.stateDir ?? '.omd', config, stateTable })
  if (typeof ctx?.effect !== 'function') {
    webServer.register({ kind: 'exact', path: HUD_ROUTE_PATH, handler: h })
    return { enabled: true, detail: `${HUD_ROUTE_PATH}（无 ctx.effect，路由随宿主生命周期）` }
  }
  ctx.effect(() => {
    const dispose = webServer.register({ kind: 'exact', path: HUD_ROUTE_PATH, handler: h })
    return () => dispose()
  })
  return { enabled: true, detail: `${HUD_ROUTE_PATH}（exact GET，?cwd= 可覆盖）` }
}
