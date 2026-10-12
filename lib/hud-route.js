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
import { makeStateTools } from '../mcp-server/tools/state.mjs'
import { makeNotepadTools } from '../mcp-server/tools/notepad.mjs'

export const HUD_ROUTE_PATH = '/oh-my-dsh/hud.json'

/** workers 聚合上限（ADR Consequences：5s 轮询读面有界，收满即提前退出并标 truncated:true）。 */
export const WORKER_AGGREGATE_LIMIT = 50

/**
 * team registry 聚合（U8 S2，hud.json 私有面；扫描口径照 heartbeat.js:24-36 先例）：
 * readdir <cwd>/<stateDir>/team/ 按 run 目录 mtime 新者优先逐 run 读 registry.json——
 * team 目录缺席 → 空包；单 run registry.json 坏 JSON → 跳过该 run 继续聚合，绝不 500（AC-6）。
 * registry.workers 是对象映射（team.js:159/177）→ 扁平化为 list；元素恰含
 * {runId, workerId, role, status, spawnedAt, lastHeartbeatAt}——不透传 vestigial stale
 * （team.js:172 registerWorker 恒写 false）。输出形状锁定 {list, truncated}（对象包非裸数组）。
 * 双序分离（OQ-3）：扫描序（run mtime 新者优先）决定截断边界——收满 50 名即提前退出；
 * 呈现序=list 内 spawnedAt 新者优先。
 */
export async function aggregateWorkers({ cwd, stateDir = '.omd' } = {}) {
  const root = resolve(cwd, stateDir, 'team') // resolve 非 join：绝对 stateDir 防幻影树（events.js 同款纪律）
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch { return { list: [], truncated: false } }
  const runs = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    try { runs.push({ name: e.name, mtimeMs: (await stat(join(root, e.name))).mtimeMs }) }
    catch { /* run 目录竞态删除 → 跳过（坏目录不炸原则同款） */ }
  }
  runs.sort((a, b) => b.mtimeMs - a.mtimeMs) // run 目录 mtime 新者优先（截断边界的权威序）
  const list = []
  let truncated = false
  outer: for (const run of runs) {
    let registry
    try { registry = JSON.parse(await readFile(join(root, run.name, 'registry.json'), 'utf8')) }
    catch { continue } // 单 run 坏 registry.json → 跳过该 run 继续聚合（AC-6）
    for (const [workerId, w] of Object.entries(registry?.workers ?? {})) {
      if (list.length >= WORKER_AGGREGATE_LIMIT) { truncated = true; break outer } // 收满即提前退出
      list.push({
        runId: registry.runId ?? run.name,
        workerId,
        role: w?.role ?? null,
        status: w?.status ?? null,
        spawnedAt: w?.spawnedAt ?? null,
        lastHeartbeatAt: w?.lastHeartbeatAt ?? null,
      })
    }
  }
  // 呈现序：spawnedAt 新者优先（ISO 戳字典序即时间序；与扫描序分离，OQ-3 已钉边界测试）
  list.sort((a, b) => String(b.spawnedAt ?? '').localeCompare(String(a.spawnedAt ?? '')))
  return { list, truncated }
}

/**
 * 面板预设解析（AC11/S8）：读 config.hudPreset，缺省/非法值回退 focused。
 * preset 只进 hud.json，不进 MCP wire（hud_render 形状零变化）。
 */
function resolvePreset(config) {
  return PRESETS.includes(config?.hudPreset) ? config.hudPreset : HUD_DEFAULT_PRESET
}

/**
 * 摘要取数（hud_render MCP 工具的 node 直算版——同一 summarize 契约，不经 MCP 进程）。
 * 响应顶层键集白名单（AC5，U8 S2 扩为 10 键）：{ok, cwd, summary, card, at}
 *   ∪ {detail, modeCatalog, preset} ∪ {workers, toolCalls}——富数据面（detail/modeCatalog/
 *   preset/workers/toolCalls）loopback-only 自家面板私有，不经 MCP wire（workers 内部结构
 *   {list, truncated} 不进白名单，workers/toolCalls 各计 1 个顶层键）。
 */
export async function hudSnapshot({ cwd, stateDir = '.omd', config } = {}) {
  const env = { stateDir }
  const view = buildHudView({
    status: await makeStateTools(env).getStatus({ cwd }),
    stats: await makeNotepadTools(env).stats({ cwd }),
  })
  // U8 S2 聚合（P2 红线：两键只进 hud.json 私有面，MCP wire 面零变化）：
  // workers=team registry 聚合；toolCalls=events.jsonl 读聚（文件缺席/坏行 → 空聚合，不 500）
  const workers = await aggregateWorkers({ cwd, stateDir })
  const toolCalls = aggregateEvents(await readEvents({ cwd, stateDir }))
  // AC10：fallback>0 且 deriveTier 原判定 ok → detail.tier 提升 warn；danger 不降级。
  // 提升逻辑只在本私有侧——lib/hud.js deriveTier 纯函数契约零 diff（AC10）。
  // 窗口语义：fallbackCount 是 64 KiB 尾部窗口内计数，旧 fallback 滑出后 warn 自动消退
  // （有意的「近期信号」语义而非 bug，见 ADR Consequences）。
  const tier = toolCalls.fallbackCount > 0 && view.tier === 'ok' ? 'warn' : view.tier
  return {
    ok: true,
    cwd,
    summary: view.summary,
    card: renderCard(view.summary, view.detail),
    at: new Date().toISOString(),
    detail: Object.assign({}, view.detail, { tier }),  // U3/O2：tier 并入 detail 下发（真单源；顶层键集白名单不变）
    modeCatalog: view.modeCatalog,
    preset: resolvePreset(config),
    workers,
    toolCalls,
  }
}

/** node:http handler（WebRoute.handler 形状）。 */
export function makeHudHandler({ stateDir = '.omd', snapshot, config } = {}) {
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
      try { await stat(cwd) } catch { return send(404, { ok: false, error: `cwd 不存在: ${cwd}` }) }
      send(200, await snap({ cwd, stateDir, config }))
    } catch (e) {
      send(500, { ok: false, error: String(e?.message ?? e) })
    }
  }
}

function tryGet(ctx, name) {
  if (typeof ctx?.get === 'function') {
    try { return ctx.get(name) } catch { /* 落到属性访问兜底 */ }
  }
  try { return ctx[name] } catch { return undefined }
}

/**
 * 注册 HUD 路由。webServer 缺席（CLI 会话/非 web 组合）→ enabled:false 降级。
 * 注册经 ctx.effect 托管（插件重放/卸载自动摘路由）。
 * @returns { enabled, detail }
 */
export function registerHudRoute(ctx, { config, handler } = {}) {
  const webServer = tryGet(ctx, 'webServer')
  if (!webServer || typeof webServer.register !== 'function')
    return { enabled: false, detail: 'webServer 服务缺席（非 web 宿主组合），HUD 面板无数据路由（MCP hud_render 仍可用）' }
  const h = handler ?? makeHudHandler({ stateDir: config?.stateDir ?? '.omd', config })
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
