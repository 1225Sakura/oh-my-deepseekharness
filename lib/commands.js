// lib/commands.js
// H1：@deepseek-ai/dsh-llm 懒加载——顶层静态 import 在包缺席时会让插件在 import 阶段就崩，
// probe/降级机制没机会跑。经 registerCommands 的参数注入（测试）或动态 import（实装）。
import { KEYWORD_REGISTRY } from './keywords.js'
import { mkdir, writeFile, rm, readdir, readFile, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DOCTOR_PROMPT =
  '请立即加载 omd-doctor skill 并完整执行诊断流程，把检查结果以表格形式报告给我。'
const CANCEL_PROMPT =
  '请立即执行 omd 取消协议：1) state_list_active 查当前活跃模式；2) 若是 goal 驱动的模式则先 get_goal 取 goal_id/revision 再 update_goal(pause)；3) 若是 team 则按关闭协议通知全部队员 shutdown 并等待确认；4) state_clear 清理状态；5) 保留 plans/prd/handoffs/checkpoints 供恢复；6) 向我报告取消了什么。'

/** 帮助文本骨架：技能区之外的所有固定节（模式关键词/斜杠命令/可见性）。技能区由调用方注入。 */
function helpShell(skillLines) {
  const rows = KEYWORD_REGISTRY.map(e =>
    `  ${e.target}：${e.triggers.join(' / ')}${e.intent === 'explicit' ? '（须显式调用，如 "${e.target}: <任务>"）' : ''}`)
  return [
    'oh-my-dsh 速查',
    '',
    '模式关键词（在会话输入中触发）：',
    ...rows,
    '  team：无触发词（仅限显式调用，如「用 team 做…」）', // 注册表外条目：team 故意无关键词武装
    '',
    '斜杠命令：',
    '  /omd — 本帮助',
    '  /omd-doctor — 验装诊断（注册计数/Config/MCP 冒烟/.omd 可写性）',
    '  /omd-cancel — 取消当前活跃的 omd 模式',
    '',
    ...skillLines,
    '',
    '可见性：',
    '  · 右侧栏 guide 页「omd HUD」胶囊 → 编排状态面板（模式/轮次/告警/工具调用）',
    '  · 记忆工具：omd_memory_list 先枚举已有 key，再 omd_memory_get 读取',
  ].join('\n')
}

/**
 * /omd 帮助文本（2026-10-26 审查 S8：人性化入口——确定性直接返回，零 LLM 往返）。
 * 关键词表单源 = lib/keywords.js KEYWORD_REGISTRY（与系统提示词路由表同源），
 * 新增/退役关键词只需改注册表，帮助文本自动跟随。
 * 本函数为同步回落面（枚举失败时由 renderOmdHelpRoster 回落到此）。
 */
export function renderOmdHelp() {
  return helpShell([
    '技能（49 个技能中关键词之外的 ~44 个能力面，说出技能名即可调用）：',
    '  质量：review / verify / analyze / ai-slop-cleaner（deslop）/ deepinit',
    '  研究：research / best-practice-research / ask / ask-navigator / external-context',
    '  工程：execute / plan / debug / graph / release / performance-goal / project-session-manager',
    '  记忆与元：wiki / remember / hud / trace / skill / skillify / drydock / harbor / launch / loft 等',
    '  ——完整名册见会话技能目录（或仓库 assets/skills/ 下的 SKILL.md）',
  ])
}

/** assets/skills 默认锚（与 lib/index.js 挂载 mcp-server 同款相对推导；测试可注入覆盖）。 */
function defaultAssetsSkillsDir() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'skills')
}

/** description 取首句并截断 ≤40 字符（frontmatter 单行 description 值）。 */
function firstSentence(value, max = 40) {
  let s = String(value ?? '').trim().replace(/^["']|["']$/g, '')
  const m = s.match(/^.*?[。．.!?！？](?:\s|$)/)
  if (m) s = m[0].trim().replace(/[。．.!?！？]+$/, '')
  return s.length > max ? s.slice(0, max) + '…' : s
}

/**
 * 逐技能名册行（P1-W3-3：/omd 帮助面从分组目录升级为全名册）。
 * 每行 =「名：一句话说明（触发方式）」；触发方式 = KEYWORD_REGISTRY 命中标「关键词 x」，否则「说出技能名调用」。
 * 单技能 SKILL.md 读失败不炸整表——该行说明降级为「—」。
 * @param deps.assetsSkillsDir/readdir/readFile 测试注入；默认真实 assets/skills
 */
export async function buildSkillRosterLines(deps = {}) {
  const dir = deps.assetsSkillsDir ?? defaultAssetsSkillsDir()
  const rd = deps.readdir ?? readdir
  const rf = deps.readFile ?? readFile
  const entries = (await rd(dir, { withFileTypes: true }))
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort()
  const triggerByTarget = new Map(KEYWORD_REGISTRY.map(e => [e.target, e.triggers[0]]))
  const lines = []
  for (const name of entries) {
    let desc = ''
    // 2026-10-29 补全（team eco-completion，缝合双流）：zh 优先 + 折叠/字面块标量（>- /> / |）
    // ——此前只读 SKILL.md 单行 description，9 个折叠标量技能提不出（名册 35/44 的根因）。
    for (const f of ['SKILL.zh.md', 'SKILL.md']) {
      try {
        const raw = await rf(join(dir, name, f), 'utf8')
        const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
        const fl = fm?.[1]?.split(/\r?\n/) ?? []
        const di = fl.findIndex(l => /^description:/.test(l))
        if (di < 0) continue
        const inline = fl[di].slice('description:'.length).trim()
        if (inline && !['|', '>', '>-'].includes(inline)) { desc = inline; break }
        const buf = []
        for (let j = di + 1; j < fl.length; j++) {
          if (/^[A-Za-z_-]+:/.test(fl[j]) || fl[j].trim() === '---') break
          buf.push(fl[j].replace(/^\s*>?-?\s*/, '').trim())
        }
        desc = buf.filter(Boolean).join(' ')
        if (desc) break
      } catch { /* 尝试下一个语言变体 */ }
    }
    const trigger = triggerByTarget.get(name)
    lines.push(`  ${name}：${desc ? firstSentence(desc) : '—'}（${trigger ? '关键词 ' + trigger : '说出技能名调用'}）`)
  }
  return lines
}

/**
 * /omd 帮助（名册版）：运行时枚举 assets/skills 生成逐技能全名册；
 * 枚举任何异常回落同步 renderOmdHelp() 分组文案，绝不崩（零 LLM 往返不变）。
 * @param deps 透传 buildSkillRosterLines 注入面
 */
export async function renderOmdHelpRoster(deps = {}) {
  try {
    const roster = await buildSkillRosterLines(deps)
    if (!roster.length) return renderOmdHelp()
    return helpShell([
      '技能（逐技能全名册——说出技能名即可调用；标「关键词」的可自动触发）：',
      ...roster,
    ])
  } catch {
    return renderOmdHelp()
  }
}

/**
 * /omd-doctor 确定性诊断（2026-10-26 第二轮 S2：告别 prompt 空壳）。
 * handler 可以是 async（dsh-commands 对 handler 返回值 Promise.resolve+await）；
 * invocation.agent.session.header.cwd 提供会话锚（keyword hook 同款先例）。
 * 直出真实诊断文本；仅当存在 failure 项或 .omd 不可写时才 followup 请助手介入。
 */
async function runDoctor(invocation, probeReport) {
  const lines = ['# omd doctor（确定性诊断）', '']
  const cwd = invocation?.agent?.session?.header?.cwd
  lines.push(`会话工作区：${typeof cwd === 'string' && cwd ? cwd : '未知（会话锚缺失——以下 .omd 检查跳过）'}`)
  lines.push('', '## 能力矩阵（probe + 注册结果）')
  const entries = Object.entries(probeReport ?? {})
  if (!entries.length) lines.push('- （无 probeReport——插件版本过旧）')
  let failures = 0
  for (const [k, v] of entries) {
    if (v && (v.status === 'failure')) failures++
    lines.push(`- ${k}: ${v?.status ?? '?'}${v?.detail ? ' — ' + String(v.detail).slice(0, 160) : ''}`)
  }
  let omdWritable = null
  if (typeof cwd === 'string' && cwd) {
    lines.push('', '## .omd 状态面')
    const probeFile = join(cwd, '.omd', 'state', '.doctor-probe')
    try {
      await mkdir(join(cwd, '.omd', 'state'), { recursive: true })
      await writeFile(probeFile, 'ok', 'utf8')
      await rm(probeFile)
      lines.push('- 可写性：ok（写删探针文件通过）')
      omdWritable = true
    } catch (e) {
      lines.push(`- 可写性：失败——${e?.code ?? e?.message ?? e}`)
      omdWritable = false
      failures++
    }
    try {
      const sessions = await readdir(join(cwd, '.omd', 'state', 'sessions')).catch(() => [])
      lines.push(`- 状态会话目录：${sessions.length} 个`)
    } catch { /* 已计数 */ }
    const np = await stat(join(cwd, '.omd', 'notepad.md')).catch(() => null)
    lines.push(`- notepad：${np ? '存在（' + np.size + 'B）' : '不存在'}`)
  }
  lines.push('', failures === 0 && omdWritable !== false
    ? '结论：全部正常。'
    : `结论：发现 ${failures} 处异常，已请助手介入。`)
  return { lines, failures, omdWritable }
}

/**
 * @param ctx cordis 上下文
 * @param createUserMessage 测试注入；默认动态 import('@deepseek-ai/dsh-llm')
 * @param deps.probeReport 能力矩阵数据源（index.js setup 传入）
 * @param deps.helpDeps 透传 renderOmdHelpRoster 注入面（测试）
 */
export async function registerCommands(ctx, createUserMessage, deps = {}) {
  const cm = createUserMessage ?? (await import('@deepseek-ai/dsh-llm')).createUserMessage
  const userText = (text) => cm({ content: [{ type: 'text', text }], source: { kind: 'user' } })

  // 无参命令按宿主惯例省略 input（dsh-commands 校验：hint 若给必须非空，空串直接 TypeError）
  ctx.commands.register({
    name: 'omd-doctor',
    description: 'oh-my-dsh 验装诊断（probe 矩阵/.omd 可写性——确定性直出；异常时助手介入）',
    async handler(invocation) {
      const { lines, failures, omdWritable } = await runDoctor(invocation, deps.probeReport)
      // 仅异常时 followup 请助手修复（正常零 LLM 往返——人性化审查「prompt 空壳」修复）
      if (failures > 0 || omdWritable === false)
        invocation.agent.followup(userText(DOCTOR_PROMPT))
      return { kind: 'success', text: lines.join('\n') }
    },
  })
  // S8：/omd 帮助——handler 直接返回确定性文本（非 prompt 空壳；零 LLM 往返即答）
  // P1-W3-3：技能区升级为运行时枚举的逐技能全名册（失败回落分组文案）
  ctx.commands.register({
    name: 'omd',
    description: 'oh-my-dsh 速查：模式关键词 / 斜杠命令 / 技能全名册 / HUD 与记忆入口',
    async handler() {
      return { kind: 'success', text: await renderOmdHelpRoster(deps.helpDeps) }
    },
  })
  ctx.commands.register({
    name: 'omd-cancel',
    description: '取消当前活跃的 omd 模式（autopilot/ralph/team）',
    handler(invocation) {
      invocation.agent.followup(userText(CANCEL_PROMPT))
      return { kind: 'success', text: 'omd 取消协议已触发——具体取消了什么将由助手报告。' }
    },
  })
}
