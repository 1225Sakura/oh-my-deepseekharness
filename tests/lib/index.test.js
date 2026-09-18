// tests/lib/index.test.js
import { test, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, name, inject, Config } from '../../lib/index.js'

function mockCtx() {
  const reg = { sections: [], contexts: [], skills: [], commands: [], tools: [], effects: [] }
  return {
    reg,
    ctx: {
      systemPrompt: { section: (s) => reg.sections.push(s), context: (c) => reg.contexts.push(c) },
      skills: { register: (s) => reg.skills.push(s) },
      commands: { register: (c) => reg.commands.push(c) },
      tools: { register: (t) => reg.tools.push(t) },
      // 宿主真实 API 形状（§7-7 核验）：domain.open → Domain，table 同步 get / 异步 put+delete
      storage: {
        domain: {
          open: async () => ({
            table: () => ({ get() {}, async put() {}, async delete() {} }),
            async close() {},
          }),
        },
      },
      effect: (fn) => reg.effects.push(fn),
      on: () => {},
    },
  }
}

test('插件导出符合 cordis 约定', () => {
  expect(name).toBe('oh-my-dsh')
  expect(inject).toContain('systemPrompt')
  expect(inject).toContain('skills')
  expect(inject).toContain('commands')
  expect(inject).toContain('tools')
  expect(typeof Config.parse).toBe('function')
})

test('apply 全量注册：1 section + 1 context + 10 skill + 7 角色 + 2 命令 + 3 记忆工具', async () => {
  const { ctx, reg } = mockCtx()
  const assetsRoot = await mkdtemp(join(tmpdir(), 'omd-'))
  await mkdir(join(assetsRoot, 'skills', 'x'), { recursive: true })
  await writeFile(join(assetsRoot, 'skills', 'x', 'SKILL.zh.md'), '---\nname: x\ndescription: d\n---\nbody\n')
  await mkdir(join(assetsRoot, 'agents'), { recursive: true })
  await writeFile(join(assetsRoot, 'agents', 'r.zh.md'), '---\nname: omd-agent-r\ndescription: d\ntier: low\n---\nrole\n')
  // defineTool 经 opts 注入（计划任务 14 步骤 4 授权）：测试传 identity，实装默认 import @deepseek-ai/dsh-tools
  await apply(ctx, Config.parse({}), { assetsRoot, defineTool: (x) => x })
  expect(reg.sections).toHaveLength(1)
  expect(reg.contexts).toHaveLength(1)
  expect(reg.skills).toHaveLength(2)   // 1 skill + 1 role（fixture 规模；真实 assets 是 17）
  expect(reg.commands).toHaveLength(2)
  expect(reg.tools).toHaveLength(3)
  // §7-2 核验：dsh-system-prompt 的 section/context 均强制有限 order；text 必须同步求值
  expect(Number.isFinite(reg.sections[0].order)).toBe(true)
  expect(Number.isFinite(reg.contexts[0].order)).toBe(true)
  expect(typeof reg.sections[0].text()).toBe('string')
  expect(typeof reg.contexts[0].text()).toBe('string')
  // domain close 已经 ctx.effect 注册（cordis 配置变更重放插件时 dispose）
  expect(reg.effects.length).toBeGreaterThan(0)
})

test('核心服务缺失时 apply 启动即报错（规格 §6.1 例外条款）', async () => {
  const { ctx } = mockCtx()
  delete ctx.systemPrompt
  await expect(apply(ctx, Config.parse({}), { assetsRoot: '/nonexistent' })).rejects.toThrow()
})
