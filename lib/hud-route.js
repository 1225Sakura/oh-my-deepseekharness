// lib/hud-route.js
// v0.4 P2-D HUD client half 的 node 数据面：在 dsh web 宿主（dsh-host-webserver）上注册
// exact GET 路由 `/oh-my-dsh/hud.json`，向浏览器面板暴露 lib/hud.js 五要素摘要。
// - cwd 解析：?cwd= 显式指定 > process.cwd()（宿主进程锚点，与 heartbeat 定时器同款文档化限制）
// - 服务发现：ctx.get('webServer') 运行时取面（delegate.js 同款，不增 inject——webServer 只在
//   web 宿主组合存在；CLI 会话缺席 → enabled:false 降级，不阻断插件）
// - 安全 posture：webserver 是 loopback-only（127.0.0.1），本路由只读、no-store、
//   暴露的是模式/轮次/todo 计数级低敏摘要（与 state_get_status 同源）；/api 桥的 cookie
//   鉴权不覆盖自定义路由——如实记录此边界。
import { stat } from 'node:fs/promises'
import { summarize, renderCard } from './hud.js'
import { makeStateTools } from '../mcp-server/tools/state.mjs'
import { makeNotepadTools } from '../mcp-server/tools/notepad.mjs'

export const HUD_ROUTE_PATH = '/oh-my-dsh/hud.json'

/** 摘要取数（hud_render MCP 工具的 node 直算版——同一 summarize 契约，不经 MCP 进程）。 */
export async function hudSnapshot({ cwd, stateDir = '.omd' }) {
  const env = { stateDir }
  const summary = summarize({
    status: await makeStateTools(env).getStatus({ cwd }),
    stats: await makeNotepadTools(env).stats({ cwd }),
  })
  return { ok: true, cwd, summary, card: renderCard(summary), at: new Date().toISOString() }
}

/** node:http handler（WebRoute.handler 形状）。 */
export function makeHudHandler({ stateDir = '.omd', snapshot } = {}) {
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
      send(200, await snap({ cwd, stateDir }))
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
  const h = handler ?? makeHudHandler({ stateDir: config?.stateDir ?? '.omd' })
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
