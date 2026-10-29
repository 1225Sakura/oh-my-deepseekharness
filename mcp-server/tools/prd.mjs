// mcp-server/tools/prd.mjs
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteJson, readJson } from '../lib/atomic.mjs'
import { omdPaths } from '../lib/paths.mjs'
import { withCrossProcessFileLock } from '../../lib/worktree.js'

const SAFE_TOPIC = /^[A-Za-z0-9_-]+$/

export function makePrdTools(env) {
  function prdFile(cwd, topic) {
    if (!SAFE_TOPIC.test(topic)) throw new Error(`unsafe topic: ${topic}`)
    return join(omdPaths({ cwd, stateDir: env.stateDir, sessionId: '_' }).prdDir, `${topic}.json`)
  }
  async function load(cwd, topic) {
    const prd = await readJson(prdFile(cwd, topic))
    if (!prd) throw new Error(`PRD not found: ${topic}`)
    return prd
  }
  function findStory(prd, storyId) {
    const s = prd.stories.find(x => x.id === storyId)
    if (!s) throw new Error(`story not found: ${storyId}`)
    return s
  }
  async function audit(cwd, entry) {
    const dir = omdPaths({ cwd, stateDir: env.stateDir, sessionId: '_' }).prdDir
    await appendFile(join(dir, 'reconciliation.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8')
  }
  return {
    async check({ cwd, topic, storyId, evidence }) {
      if (!evidence || !evidence.trim()) throw new Error('evidence required: 必须附验证命令的原始输出摘要（规格 §3.3 证据契约）')
      // R2 评审（重要）：check/uncheck/amend RMW 收进跨进程锁——team-exec 并行 worker
      // 同时 prd_check 曾整文件覆盖丢勾选（state.mjs R3-⑨ 同族）
      return withCrossProcessFileLock(prdFile(cwd, topic) + '.lock', async () => {
        const prd = await load(cwd, topic)
        const s = findStory(prd, storyId)
        s.passes = true
        s.passedAt = new Date().toISOString()
        s.evidence = evidence
        await atomicWriteJson(prdFile(cwd, topic), prd)
        await audit(cwd, { action: 'check', topic, storyId })
        return { ok: true }
      })
    },
    async uncheck({ cwd, topic, storyId, reason }) {
      return withCrossProcessFileLock(prdFile(cwd, topic) + '.lock', async () => {
        const prd = await load(cwd, topic)
        const s = findStory(prd, storyId)
        s.passes = false
        delete s.passedAt
        delete s.evidence // 刻板审查修复（R3-⑫）：回退后不再留「未通过但有证据」矛盾态
        await atomicWriteJson(prdFile(cwd, topic), prd)
        await audit(cwd, { action: 'uncheck', topic, storyId, reason })
        return { ok: true }
      })
    },
    async amend({ cwd, topic, storyId, criterionId, kind, newText, reason, evidence, authority }) {
      if (!['replaced', 'superseded'].includes(kind)) throw new Error(`unknown amendment kind: ${kind}`)
      return withCrossProcessFileLock(prdFile(cwd, topic) + '.lock', async () => {
        const prd = await load(cwd, topic)
        const s = findStory(prd, storyId)
        const c = s.acceptanceCriteria.find(x => x.id === criterionId)
        if (!c) throw new Error(`fail-closed: criterion ${criterionId} not found in story ${storyId}`)
        s.criterionAmendments ??= [] // 刻板审查修复（R3-⑪）：手写 PRD 缺该字段不再 TypeError
        s.criterionAmendments.push({
          kind, criterionId, originalText: c.text, newText, reason, evidence,
          authority: authority ?? 'user',   // 终审修复：ralph skill 契约要求台账含 authority
          at: new Date().toISOString(),
        })
        c.text = newText
        c.revision = (c.revision ?? 1) + 1
        prd.revision = (prd.revision ?? 1) + 1
        await atomicWriteJson(prdFile(cwd, topic), prd)
        await audit(cwd, { action: 'amend', topic, storyId, criterionId, kind })
        return { ok: true, newRevision: c.revision }
      })
    },
    async status({ cwd, topic }) {
      const prd = await load(cwd, topic)
      const lines = [`# PRD: ${prd.topic}（revision ${prd.revision}）`, '']
      const warnings = []
      for (const s of prd.stories) {
        lines.push(`- [${s.passes ? 'x' : ' '}] ${s.id} ${s.title}${s.architectVerified ? ' ✅已评审' : ''}`)
        for (const c of s.acceptanceCriteria) lines.push(`  - (${c.id}@r${c.revision ?? 1}) ${c.text}`)
        // 终审修复：台账 fail-closed 校验（warning 级，不硬失败保持兼容）——
        // amendment 引用的 criterionId 在 acceptanceCriteria 中已不存在即为孤儿条目
        const seenAmendOriginals = new Set()
        for (const a of s.criterionAmendments ?? []) {
          const target = s.acceptanceCriteria.find(c => c.id === a.criterionId)
          if (!target)
            warnings.push(`story ${s.id}: amendment 引用的 criterion ${a.criterionId} 已不存在（孤儿台账条目，台账矛盾应 fail-closed 处理）`)
          // 刻板审查修复（R3-⑬）：补两条契约检测——原文仍 active（修订未生效）与同文重复修订
          else if (target.text === a.originalText)
            warnings.push(`story ${s.id}: criterion ${a.criterionId} 的原文在修订后仍 active（台账矛盾）`)
          const dupKey = a.criterionId + '\0' + a.originalText
          if (seenAmendOriginals.has(dupKey))
            warnings.push(`story ${s.id}: criterion ${a.criterionId} 同一原文被修订两次（台账矛盾）`)
          seenAmendOriginals.add(dupKey)
        }
      }
      return { markdown: lines.join('\n'), raw: prd, stories: prd.stories, warnings }
    },
  }
}

export function registerPrdTools(server, env) {
  const t = makePrdTools(env)
  const base = { cwd: z.string(), topic: z.string() }
  const story = { ...base, storyId: z.string() }
  const jsonOut = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] })
  server.registerTool('prd_check', { description: '勾选 story 完成（必须附 evidence）', inputSchema: { ...story, evidence: z.string() } }, async a => jsonOut(await t.check(a)))
  server.registerTool('prd_uncheck', { description: '回退 story 完成状态', inputSchema: { ...story, reason: z.string() } }, async a => jsonOut(await t.uncheck(a)))
  server.registerTool('prd_status', { description: 'PRD 状态 + markdown 人读视图', inputSchema: base }, async a => jsonOut(await t.status(a)))
  server.registerTool('prd_amend', { description: '修订验收标准（证据保全式台账；authority 缺省 user）', inputSchema: { ...story, criterionId: z.string(), kind: z.enum(['replaced', 'superseded']), newText: z.string(), reason: z.string(), evidence: z.string(), authority: z.string().optional() } }, async a => jsonOut(await t.amend(a)))
}
