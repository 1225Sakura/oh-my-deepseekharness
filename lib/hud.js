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
//   渲染成至多 8 行中文摘要卡——这是「HUD」语义的最小实现。
// - client 端（0.4.x 已落地）：lib/client.js 注册右侧边栏 tab 类型 'omd-hud'，
//   数据面 /oh-my-dsh/hud.json 经 webServer exact 路由（lib/hud-route.js），
//   5s 轮询本模块五要素卡；CLI 会话 hudRoute 记 skipped，MCP hud_render 同款可用。

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

/**
 * 五模式枚举与中文 label 定稿（唯一权威清单）：autopilot=自动驾驶、ralph=Ralph 循环、
 * team=团队、ralplan=共识规划、deep-interview=深度访谈。mcp-server 侧 mode 为自由字符串，
 * 不在本清单内的模式 label 回退模式名本身。空态引导与 modeCatalog 皆以此为准（AC2/AC4）。
 */
export const MODE_LABELS = {
  autopilot: '自动驾驶',
  ralph: 'Ralph 循环',
  team: '团队',
  ralplan: '共识规划',
  'deep-interview': '深度访谈',
}

/** 面板预设枚举与默认值（AC11）：preset 经 hud.json 下发，client 只渲染不自行读配置。 */
export const PRESETS = ['minimal', 'focused', 'full']
export const HUD_DEFAULT_PRESET = 'focused'

/**
 * 色档语义常量（AC10）：ok=正常（活跃且非 stale）；warn=警告（主模式 stale，或活跃模式
 * current_phase='fix' 且 fixLoops>=2）；danger=危险（任意活跃模式 state='failed'）。
 * 判定输入=status/detail 派生的 modes；颜色仅视觉档，须伴随文字标记。
 */
export const TIER = { OK: 'ok', WARN: 'warn', DANGER: 'danger' }

/** tier 派生（纯函数，AC10 三条件；danger > warn > ok）。 */
function deriveTier(modes) {
  if (modes.some(m => m?.state === 'failed')) return TIER.DANGER
  if (modes[0]?.stale === true ||
      modes.some(m => m?.current_phase === 'fix' && (m?.fixLoops ?? 0) >= 2)) return TIER.WARN
  return TIER.OK
}

/**
 * 富视图派生（纯函数）：detail/modeCatalog/tier 只进 hud.json（loopback-only 面板私有数据面），
 * 不进 MCP wire——hud_render 恒 {summary, card} 二键，契约零破坏（O4）。
 * @returns {{
 *   summary: 五要素（summarize 同源）,
 *   detail: { primary, modes[] },  // modes=getStatus 字段透传+label，updatedAt 新者优先
 *   modeCatalog: {mode,label}[],   // 恒输出全 5 项（idle 也下发，client 只渲染不内置目录）
 *   tier: 'ok'|'warn'|'danger',    // AC10 三条件派生
 * }}
 */
export function buildHudView({ status, stats } = {}) {
  const modes = [...(status?.modes ?? [])]
    .sort(byFreshFirst)
    .map(m => ({ ...m, label: MODE_LABELS[m?.mode] ?? m?.mode ?? '' }))
  return {
    summary: summarize({ status, stats }),
    detail: { primary: modes[0]?.mode ?? null, modes },
    modeCatalog: Object.entries(MODE_LABELS).map(([mode, label]) => ({ mode, label })),
    tier: deriveTier(modes),
    // HUD 重设计（2026-10-26 审查 R1）：idle 空态的「上次活动」数据源（state getStatus 派生，加性透传）
    lastActivity: status?.lastActivity ?? null,
  }
}

/** JSON 值规范化比较（键序无关），支撑 todo 等对象字段的逐字段 diff。 */
// 刻板审查修复（报告一 #87）：renderCard 的「任务」行实为活跃代理计数——改名「代理」名实相符；
// 五要素 story 不再缺席：主模式有 current_story 时渲染「故事」行（行数预算内优先于多模式小注）。
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

/**
 * 摘要卡渲染（中文、有界、至多 8 行）：纯视图。
 * 2026-10-26 审查重设计（R1/R2/R3）：从「模式自报状态镜」改为「工作进度信号板」——
 *   活跃=任务句首行（prompt_echo，一眼回答「在干嘛」）+ 模式·阶段合并行 + PRD 进度行
 *   （detail.prd 由 hud-route join，回答「到哪了」）+ 轮次（未上报直说）+ 记忆 + stale 保底；
 *   「代理」计数行移除（恒 0 的自觉填报字段，实测为负价值）；
 *   空态=「没有运行」+ 上次活动行（detail.lastActivity）+ 一行启动提示，不再列 5 模式广告。
 * detail 缺席时回退为仅由 summary 派生（无 label/小注/stale 行）——回退安全。
 * 锁定子串口径：stale 行含「未更新」（全计划唯一口径，AC3）；空态含「没有运行」（AC2）。
 */
export function renderCard(summary, detail) {
  const s = summary ?? {}
  const todo = s.todo ?? {}
  const memory = `记忆: 永久 ${todo.priority ?? 0} · 工作 ${todo.working ?? 0} · 手动 ${todo.manual ?? 0}`
  if (!s.mode || s.mode === 'idle') {
    const lines = ['[omd] 编排状态', '当前没有运行中的 omd 模式。']
    const la = detail?.lastActivity
    if (la?.updatedAt) lines.push(`上次活动: ${la.mode ?? '?'} · ${la.updatedAt}`)
    lines.push('启动：在会话中说 autopilot / ralph / team 等关键词并给出目标')
    lines.push(memory)
    return lines.join('\n')
  }
  const modes = detail?.modes ?? []
  const primary = modes.find(m => m?.mode === (detail?.primary ?? s.mode)) ?? { mode: s.mode }
  const pLabel = primary.label && primary.label !== primary.mode
    ? `（${primary.label}）`
    : ''
  const task = typeof primary.prompt_echo === 'string' && primary.prompt_echo.trim()
    ? (primary.prompt_echo.trim().length > 36 ? primary.prompt_echo.trim().slice(0, 36) + '…' : primary.prompt_echo.trim())
    : null
  const lines = [
    task ? `[omd] ${task}` : '[omd] 编排状态',
    `模式: ${primary.mode}${pLabel} · 阶段: ${primary.current_phase ?? '未设置'}`,
  ]
  // 进度行优先（PRD join 数据，回答「干到哪了」）；无 PRD 时回退 current_story 行
  const prd = detail?.prd
  if (prd && Number.isFinite(prd.total)) {
    lines.push(`进度: story ${prd.done ?? 0}/${prd.total} 通过${prd.current ? `（当前: ${prd.current}）` : ''}`)
  } else {
    const story = primary.current_story ?? s.story
    if (story) lines.push(`故事: ${story}`)
  }
  lines.push(`轮次: ${s.round ?? '未上报'}`)
  lines.push(memory)
  // 行数预算 ≤8：多模式小注仅在预算够时补；stale 行保底（含锁定子串「未更新」）
  const staleLine = primary.stale === true
    ? `状态超过阈值未更新（stale；上次更新：${primary.updatedAt ?? '未知'}）` : null
  const others = modes.length > 1 ? modes.length - 1 : 0
  if (others > 0 && lines.length + (staleLine ? 1 : 0) < 8)
    lines.push(`另有 ${others} 个活跃模式（取最新者展示）`)
  if (staleLine) lines.push(staleLine)
  return lines.join('\n')
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
  let inflight = false // 重入防护（heartbeat.js:38 同款）：取数慢于间隔时跳过重叠 tick，防 snap 竞态
  function start() {
    if (timer) return
    timer = setInterval(() => {
      if (inflight) return
      inflight = true
      void pollOnce().catch(() => {}).finally(() => { inflight = false })
    }, intervalMs)
    timer.unref?.() // 探针轮询不挂住宿主退出（F3 评审 nit）
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null }
  }
  return { pollOnce, start, stop, get snapshot() { return snap } }
}
