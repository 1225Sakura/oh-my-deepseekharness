// lib/events.js
// U8 S1（c5 HUD 工具调用可观测性一期 MVP，ralplan-u8-hud-tool-observability.md ADR O-A）：
// 派发事件总线——append-only JSONL 审计面（<cwd>/<stateDir>/state/events.jsonl）。
// - 写面：recordRouteEvent 每次派发恰一条 kind='route'；fallback 派发同点追加 kind='fallback'
//   （route/fallback 天然 1:1：delegate.js resolveDispatch 后同一 try/catch 内同点落盘，
//    其后 model 校验/spawn 失败两事件同在同失）。锁复用 lib/runstate.js withFileLock（:64-69），
//    零新造锁；append 模式照 team.js sendMail :267-283 先例（mkdir recursive + appendFile）。
// - 读面：readEvents 尾部窗口（默认 64 KiB，窗口语义=近期信号，见 ADR Consequences）+
//   坏行容错（_corrupt 同款口径，team.js readMailFile :248-258 先例）——读路径永不因坏行抛错。
// - 聚合：aggregateEvents 纯函数（total=route 行数；fallbackCount=fallback 行数；
//   byTier.explicit 桶=explicit:true 行数；low/medium/high 桶仅计 explicit=false 且 tier 非 null）。
// - 边界：withFileLock 单进程锁——唯一写点=插件进程内 delegate 工具（ADR 风险承接）；
//   一期不做轮转/清理（读侧尾部窗口兜底）。
import { resolve, dirname } from 'node:path'
import { mkdir, appendFile, readFile, stat, open } from 'node:fs/promises'
import { withFileLock } from './runstate.js'

/** 合法事件 kind：route=派发路由判定；fallback=表外角色 fallback 审计（与 route 1:1 同点落盘）。 */
export const EVENT_KINDS = ['route', 'fallback']

/** 读面默认尾部窗口（字节）：5s 轮询读面有界（ADR Consequences——窗口语义=「近期信号」）。 */
export const DEFAULT_EVENTS_WINDOW_BYTES = 65536

/**
 * 事件总线权威路径（<cwd>/<stateDir>/state/events.jsonl）。
 * resolve 而非 join：stateDir 为绝对路径（测试/自定义）时 join 会拼出幻影树（routing.js:106-107 教训）。
 * 信任面（2026-10-29 p2-fixes）：绝对 stateDir 仅审计面（events/run-state 审计写）支持；
 * mode-state/keyword 面沿用 MCP omdPaths 严格校验（hook.js 注册期预检一次性告警）。
 */
export function eventsPath(cwd, stateDir = '.omd') {
  return resolve(cwd, stateDir, 'state', 'events.jsonl')
}

/**
 * 派发事件落盘（append-only，锁内 mkdir+append，team.js:267-283 同款）。
 * 事件形状（AC-1）：{ts, kind, dispatchId, role, tableTier, suggestedTier, tier, clamped,
 *   fallback, explicit, modelId?}——键名对齐 resolveDispatch 源字段（decision.modelId，
 *   lib/delegate.js resolveDispatch 的 decision 构造点，无命名漂移）；modelId 缺席不挂键。
 * 语义：事件记录的是路由判定（挂钩点在 model 校验/spawn 闸门之前，含后续失败车次）。
 * @returns 落盘的事件对象（含 ts）。
 */
export async function recordRouteEvent({ cwd, stateDir = '.omd', decision, kind, at = new Date().toISOString() }) {
  if (!EVENT_KINDS.includes(kind))
    throw new Error(`events: 非法 kind: ${String(kind)}（合法: ${EVENT_KINDS.join('/')}）`)
  if (!decision?.dispatchId)
    throw new Error('events: decision.dispatchId 必填（routing.js:6-7 键控 id 口径）')
  if (!cwd) throw new Error('events: recordRouteEvent 需要 cwd（权威路径 = cwd/stateDir/state/events.jsonl）')
  const file = eventsPath(cwd, stateDir)
  return withFileLock(file, async () => {
    const event = {
      ts: at,
      kind,
      dispatchId: decision.dispatchId,
      role: decision.role ?? null,
      tableTier: decision.tableTier ?? null,
      suggestedTier: decision.suggestedTier ?? null,
      tier: decision.tier ?? null,
      clamped: decision.clamped === true,
      fallback: decision.fallback === true,
      explicit: decision.explicit === true,
      ...(decision.modelId !== undefined ? { modelId: decision.modelId } : {}),
    }
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, JSON.stringify(event) + '\n', 'utf8')
    return event
  })
}

/**
 * 读事件（尾部窗口 + 坏行容错，team.js:248-258 同款口径）：
 * - 文件缺席 → []；文件 > maxBytes → 只读尾部 maxBytes 窗口，窗口首行（可能撕裂）整行丢弃；
 * - 坏行不抛错，以 {_corrupt:true, line} 标记行占位（行号供审计），好行原样返回。
 */
export async function readEvents({ cwd, stateDir = '.omd', maxBytes = DEFAULT_EVENTS_WINDOW_BYTES } = {}) {
  const file = eventsPath(cwd, stateDir)
  let text
  try {
    const st = await stat(file)
    if (st.size > maxBytes) {
      const fh = await open(file, 'r')
      try {
        const buf = Buffer.alloc(maxBytes)
        await fh.read(buf, 0, maxBytes, st.size - maxBytes)
        text = buf.toString('utf8')
        // 窗口首行可能撕裂 → 整行丢弃（append-only 尾部窗口语义）
        const nl = text.indexOf('\n')
        text = nl < 0 ? '' : text.slice(nl + 1)
      } finally {
        await fh.close()
      }
    } else {
      text = await readFile(file, 'utf8')
    }
  } catch {
    return []
  }
  const events = []
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    try { events.push(JSON.parse(line)) }
    catch { events.push({ _corrupt: true, line: i + 1 }) }
  }
  return events
}

/**
 * 聚合（纯函数，AC-8 归类规则）：
 * total=kind='route' 行数；fallbackCount=kind='fallback' 行数；
 * byTier.explicit 桶=explicit=true 的 route 行数；low/medium/high 桶仅计 explicit=false
 * 且 tier 非 null 的 route 行（explicit-model 派发 tier=null 且 explicit=true，只进 explicit 桶）；
 * _corrupt 坏行跳过。返回 {total, byTier:{low,medium,high,explicit}, fallbackCount}。
 */
export function aggregateEvents(events) {
  const byTier = { low: 0, medium: 0, high: 0, explicit: 0 }
  let total = 0
  let fallbackCount = 0
  for (const e of events ?? []) {
    if (!e || e._corrupt) continue
    if (e.kind === 'fallback') { fallbackCount++; continue }
    if (e.kind !== 'route') continue
    total++
    if (e.explicit === true) byTier.explicit++
    else if (e.tier === 'low' || e.tier === 'medium' || e.tier === 'high') byTier[e.tier]++
  }
  return { total, byTier, fallbackCount }
}
