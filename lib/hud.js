// lib/hud.js
// c4 HUD 摘要卡库能力（v0.3.0 commit 9 还原）
//
// **本模块是纯函数库 + 客户端轮询工厂，不直接挂载到 dsh systemPrompt。**
// v0.3.0 之前曾被删除（误判 systemPrompt.context 不支持轮询而误删）；
// 现还原以提供 OMC 风格「HUD 该显示什么」的五要素契约，供未来 client half 借用。
//
// 设计意图（OMC § c4 回顾）：
// - 五要素内容契约：mode/round/story/agents/todo
// - 数据源 = state_get_status + notepad_stats 两个现成读面
//   （零新宿主槽位、零宿主改造——与所有 omd MCP 工具解耦）
// - 摘要卡渲染 = 纯视图（最小档位、有界输出、空态可渲染）
// - 轮询刷新 = 父侧轮询工厂（client half 1.x 才会用；server 不轮询）
//
// 接线面：
// - server 端：MCP server `omd-state` 已暴露 `state_get_status` + `notepad_stats`
//   工具（mcp-server/tools/state.mjs + notepad.mjs）。模型可在助手消息里
//   调 `summarize({status, stats})` 派生五要素，然后 `renderCard(summary)`
//   渲染成 6 行有界文本——这是「HUD」语义的最小实现。
// - client 端（1.x 路线）：仿 dsh-better-sidebar 的 `ctx.betterSidebar` 形态
//   创建 omd 的 client half，注册原生 tab 类型，提供持续可视面板。
//   当前 0.3.0 范围外。

/** 五要素字段序（内容契约 v1；逐字段 diff 的遍历序）。 */
export const HUD_FIELDS = ['mode', 'round', 'story', 'agents', 'todo']

/** 内容契约版本：A→B 刷新机制升级时此值不变；仅五要素语义变化时才 +1。 */
export const HUD_CONTRACT_VERSION = 1

/** 活跃模式排序：updatedAt 新者优先（ISO 串字典序=时间序），同刻按 mode 名稳定序。 */
const byFreshFirst = (a, b) =>
  String(b?.updatedAt ?? '').localeCompare(String(a?.updatedAt ?? '')) ||
  String(a?.mode ?? '').localeCompare(String(b?.mode ?? ''))

/**
 * 五要素镜像（纯函数）：从两个现成读面输出派生摘要卡内容。
 * @param status state_get_status 输出 { activeCount, modes: [...] }
 * @param stats  notepad_stats 输出 { priority, working, manual }
 * @returns {{mode, round, story, agents, todo}} 五要素（逐字段 diff 的对象形态）
 *   mode=全部活跃模式名排序联结（无活跃 → 'idle'）；round/story/agents 取最新活跃模式
 *   （iteration/current_story/active_agents 计数）；todo=notepad 三区计数。
 */
export function summarize({ status, stats } = {}) {
  const modes = [...(status?.modes ?? [])].sort(byFreshFirst)
  const primary = modes[0]
  return {
    mode: modes.length ? modes.map(m => m.mode).sort().join('+') : 'idle',
    round: primary ? (primary.iteration ?? null) : null,
    story: primary?.current_story ?? null,
    agents: Array.isArray(primary?.active_agents) ? primary.active_agents.length : 0,
    todo: {
      working: stats?.working ?? 0,
      priority: stats?.priority ?? 0,
      manual: stats?.manual ?? 0,
    },
  }
}

/** JSON 值规范化比较（键序无关），支撑 todo 等对象字段的逐字段 diff。 */
const canon = v => JSON.stringify(v, (_k, x) =>
  x instanceof Object && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
    : x)

/**
 * 逐字段 diff（镜像断言验收面）：返回不一致的字段名数组；空数组=镜像一致（断言通过）。
 * 只对 HUD_FIELDS 五要素判定，多余字段不进 diff（内容契约封闭）。
 */
export function diffSummary(a, b) {
  return HUD_FIELDS.filter(f => canon(a?.[f]) !== canon(b?.[f]))
}

/** 摘要卡渲染（有界、最小档位）：纯视图——契约对象逐字段透传，不改写不重归约；空态可渲染。 */
export function renderCard(summary) {
  const s = summary ?? {}
  const todo = s.todo ?? {}
  return [
    '[omd] HUD 摘要卡',
    `mode:   ${s.mode ?? 'idle'}`,
    `round:  ${s.round ?? '-'}`,
    `story:  ${s.story ?? '-'}`,
    `agents: ${s.agents ?? 0}`,
    `todo:   working=${todo.working ?? 0} priority=${todo.priority ?? 0} manual=${todo.manual ?? 0}`,
  ].join('\n')
}

/**
 * 取数函数工厂：父侧轮询的 fetchSummary 默认实现（工厂时绑定 cwd，返回零参取数函数）。
 * 显式只消费 state_get_status + notepad_stats 两个现成读面（零新宿主槽位的代码化表达）。
 * @param stateTools makeStateTools(env) 产物（getStatus 即 state_get_status 的工具函数）
 * @param notepadTools makeNotepadTools(env) 产物（stats 即 notepad_stats 的工具函数）
 * @param cwd 工作区根（.omd 所在目录）
 */
export function createSummaryReader({ stateTools, notepadTools, cwd }) {
  if (!stateTools?.getStatus || !notepadTools?.stats)
    throw new Error('hud: createSummaryReader 需要 stateTools.getStatus 与 notepadTools.stats（数据源只有这两个现成读面）')
  if (!cwd) throw new Error('hud: cwd 必填（工厂时绑定取数工作区）')
  return async () => summarize({
    status: await stateTools.getStatus({ cwd }),
    stats: await notepadTools.stats({ cwd }),
  })
}

/**
 * 父侧轮询 HUD（A 方案刷新机制）。内容契约（summarize/diffSummary/renderCard）与刷新机制
 * 由此模块边界隔离：升级 A→B（如事件推送）只换本适配器，fetchSummary 与契约不动。
 *
 * **0.3.0 范围**：server 不轮询；本函数保留作 client half 1.x 的 factory。
 * @returns pollOnce（单周期轮询，镜像断言的 N=1 计量单位）/ start / stop / snapshot
 */
export function createPollingHud({ fetchSummary, intervalMs = 1000, onUpdate } = {}) {
  if (typeof fetchSummary !== 'function')
    throw new Error('hud: fetchSummary 必填（父侧轮询取数函数，见 createSummaryReader）')
  let timer = null
  let snap = null
  async function pollOnce() {
    const summary = await fetchSummary()
    // 首拍=契约全字段落卡（物化）；此后每拍记录与上拍的逐字段 diff（可见性面，非验收面）
    const diff = snap ? diffSummary(snap.summary, summary) : HUD_FIELDS.slice()
    snap = { summary, diff, at: new Date().toISOString() }
    try { onUpdate?.(snap) } catch { /* 观察者异常不阻断轮询 */ }
    return snap
  }
  function start() {
    if (timer) return
    timer = setInterval(() => { void pollOnce().catch(() => {}) }, intervalMs)
    timer.unref?.() // 探针轮询不挂住宿主退出（F3 评审 nit）
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null }
  }
  return { pollOnce, start, stop, get snapshot() { return snap } }
}
