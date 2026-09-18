// lib/commands.js
// H1：@deepseek-ai/dsh-llm 懒加载——顶层静态 import 在包缺席时会让插件在 import 阶段就崩，
// probe/降级机制没机会跑。经 registerCommands 的参数注入（测试）或动态 import（实装）。

const DOCTOR_PROMPT =
  '请立即加载 omd-doctor skill 并完整执行诊断流程，把检查结果以表格形式报告给我。'
const CANCEL_PROMPT =
  '请立即执行 omd 取消协议：1) state_list_active 查当前活跃模式；2) 若是 goal 驱动的模式则先 get_goal 取 goal_id/revision 再 update_goal(pause)；3) 若是 team 则按关闭协议通知全部队员 shutdown 并等待确认；4) state_clear 清理状态；5) 保留 plans/prd/handoffs/checkpoints 供恢复；6) 向我报告取消了什么。'

/**
 * @param ctx cordis 上下文
 * @param createUserMessage 测试注入；默认动态 import('@deepseek-ai/dsh-llm')
 */
export async function registerCommands(ctx, createUserMessage) {
  const cm = createUserMessage ?? (await import('@deepseek-ai/dsh-llm')).createUserMessage
  const userText = (text) => cm({ content: [{ type: 'text', text }], source: { kind: 'user' } })

  ctx.commands.register({
    name: 'omd-doctor',
    description: 'oh-my-dsh 验装诊断（注册计数/Config/MCP 冒烟/.omd 可写性）',
    input: { hint: '' },
    handler(invocation) {
      invocation.agent.followup(userText(DOCTOR_PROMPT))
      return { kind: 'success', text: 'omd doctor 已启动——诊断结果将由助手报告。' }
    },
  })
  ctx.commands.register({
    name: 'omd-cancel',
    description: '取消当前活跃的 omd 模式（autopilot/ralph/team）',
    input: { hint: '' },
    handler(invocation) {
      invocation.agent.followup(userText(CANCEL_PROMPT))
      return { kind: 'success', text: 'omd 取消协议已触发。' }
    },
  })
}
