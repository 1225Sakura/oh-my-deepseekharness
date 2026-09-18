// lib/commands.js
import { createUserMessage } from '@deepseek-ai/dsh-llm'

function userText(text) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

export function registerCommands(ctx) {
  ctx.commands.register({
    name: 'omd-doctor',
    description: 'oh-my-dsh 验装诊断（注册计数/Config/MCP 冒烟/.omd 可写性）',
    input: { hint: '' },
    handler(invocation) {
      invocation.agent.followup(userText(
        '请立即加载 omd-doctor skill 并完整执行诊断流程，把检查结果以表格形式报告给我。'))
      return { kind: 'success', text: 'omd doctor 已启动——诊断结果将由助手报告。' }
    },
  })
  ctx.commands.register({
    name: 'omd-cancel',
    description: '取消当前活跃的 omd 模式（autopilot/ralph/team）',
    input: { hint: '' },
    handler(invocation) {
      invocation.agent.followup(userText(
        '请立即执行 omd 取消协议：1) state_list_active 查当前活跃模式；2) 若是 goal 驱动的模式则 update_goal(pause)；3) 若是 team 则按关闭协议通知全部队员 shutdown 并等待确认；4) state_clear 清理状态；5) 保留 plans/prd/handoffs/checkpoints 供恢复；6) 向我报告取消了什么。'))
      return { kind: 'success', text: 'omd 取消协议已触发。' }
    },
  })
}
