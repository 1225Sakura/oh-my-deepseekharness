# HUD effort 数据缝核实（W2-#10 defer 核实任务 · team eco-completion · 2026-10-29）

## 结论
在 dsh 宿主可检范围（插件 API/事件/会话投影面）未发现任何 effort 数据缝——dsh 无 Claude Code 式 effort 投影。维持 defer，标「依赖宿主」；台账行已登记。

## 检索口径
范围=@deepseek-ai/dsh 宿主包（lib/ptc-runtime/client 面，深度 3、排除 node_modules/.git）；判据=effort 符号且与 plugin/ctx/session/header/hud/agent 同现。上游对照：OMC v5.7.0 CHANGELOG #4249 feat(hud) show Claude Code effort level。
