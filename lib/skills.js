import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/

function parseFrontmatter(raw, filePath) {
  const m = FM.exec(raw)
  if (!m) throw new Error(`oh-my-dsh: ${filePath} has no frontmatter`)
  const meta = Object.fromEntries(m[1].split(/\r?\n/).flatMap(line => {
    const item = /^([A-Za-z-]+):\s*["']?(.*?)["']?\s*$/.exec(line)
    return item ? [[item[1], item[2]]] : []
  }))
  if (!meta.name || !meta.description)
    throw new Error(`oh-my-dsh: ${filePath} requires name and description in frontmatter`)
  return { meta, body: m[2] }
}

const suffix = (language) => language === 'en' ? '' : '.zh'   // zh/both 用中文文件；en 用英文

/** zh/both：优先读中文文件，文件不存在（读取失败）时 fallback 到英文文件；解析错误不吞。 */
async function readLocalized(dir, base, sfx) {
  if (sfx === '') return await readFile(join(dir, `${base}.md`), 'utf8')
  try { return await readFile(join(dir, `${base}${sfx}.md`), 'utf8') }
  catch { return await readFile(join(dir, `${base}.md`), 'utf8') }
}

/** agents 目录筛选：en 只取无后缀 .md；zh/both 只取 .zh.md，缺 .zh.md 的 fallback 到无后缀 .md。 */
function selectAgentFiles(files, sfx) {
  const md = files.filter(f => f.endsWith('.md'))
  if (sfx === '') return md.filter(f => !f.endsWith('.zh.md'))
  const zhSet = new Set(md.filter(f => f.endsWith('.zh.md')))
  const zhBases = new Set([...zhSet].map(f => f.slice(0, -'.zh.md'.length)))
  const fallback = md.filter(f => !f.endsWith('.zh.md') && !zhBases.has(f.slice(0, -'.md'.length)))
  return [...zhSet, ...fallback].sort()
}

/**
 * 加载 assets/ 下全部 skill 与角色卡。
 * @returns { skills: [...], roles: [{name, tier, description, content, source, invocation}] }
 */
export async function loadAssets({ assetsRoot, language }) {
  const sfx = suffix(language)
  const out = { skills: [], roles: [] }

  let skillDirs = []
  try { skillDirs = await readdir(join(assetsRoot, 'skills')) } catch {}
  for (const dir of skillDirs) {
    const skillDir = join(assetsRoot, 'skills', dir)
    const file = join(skillDir, `SKILL${sfx}.md`)
    const { meta, body } = parseFrontmatter(await readLocalized(skillDir, 'SKILL', sfx), file)
    out.skills.push({
      name: meta.name, description: meta.description, content: body,
      source: 'oh-my-dsh',
      invocation: { modelInvocable: true, userInvocable: true },
      resourceBase: { kind: 'directory', path: skillDir },
      whenToUse: meta['when-to-use'],
    })
  }

  let agentFiles = []
  try { agentFiles = selectAgentFiles(await readdir(join(assetsRoot, 'agents')), sfx) } catch {}
  for (const f of agentFiles) {
    const file = join(assetsRoot, 'agents', f)
    const { meta, body } = parseFrontmatter(await readFile(file, 'utf8'), file)
    let content = body
    if (meta.tier) {
      try {
        content += '\n\n' + await readLocalized(join(assetsRoot, 'overlays'), meta.tier, sfx)
      } catch { /* overlay 缺失时静默跳过，doctor 会发现 */ }
    }
    out.roles.push({
      name: meta.name, description: meta.description, tier: meta.tier, content,
      source: 'oh-my-dsh',
      invocation: { modelInvocable: true, userInvocable: false },
      whenToUse: meta['when-to-use'],
    })
  }
  return out
}

/** 注册到宿主：skill 与角色卡统一进技能目录（角色卡 userInvocable=false）。 */
export function registerAssets(ctx, assets) {
  let count = 0
  for (const s of [...assets.skills, ...assets.roles]) {
    const entry = { name: s.name, description: s.description, content: s.content, source: s.source, invocation: s.invocation }
    if (s.whenToUse) entry.whenToUse = s.whenToUse
    if (s.resourceBase) entry.resourceBase = s.resourceBase
    ctx.skills.register(entry)
    count++
  }
  return count
}
