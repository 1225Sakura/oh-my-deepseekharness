// lib/hud.js
// c4 HUD 最小状态摘要卡（M3，spec di-m3-advance-001：R18 表 c4 行 / R11 最小摘要卡档位 / 验收表 c4 实现行）
// - 五要素内容契约：mode/round/story/agents/todo（模式/轮次/当前 story/活跃 agent/todo）
// - 数据源=state_get_status+notepad_stats 两个现成读面（零新宿主槽位、零宿主改造）
// - 镜像断言验收面=diffSummary(摘要卡, 状态源派生) 逐字段 diff；通过=diff 为空（N=1 轮询周期内）
// - 刷新机制=父侧轮询（A 方案）；升级 A→B 只换刷新机制（fetchSummary 注入），内容契约不变
// - 不含实时面板（out-of-scope 点名，spec 约束 5）；hsum 断言不持状态写、绝不触碰 .omd（G6 同款纪律）

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
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null }
  }
  return { pollOnce, start, stop, get snapshot() { return snap } }
}
