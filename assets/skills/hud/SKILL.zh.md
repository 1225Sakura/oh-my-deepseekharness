---
name: hud
description: omd 会话的状态可见性——HUD 五要素（模式、轮次、story、agent、todo）与三个已落地承载面：MCP hud_render/hud_summary、web GUI 右侧边栏 HUD 面板（client half）、/oh-my-dsh/hud.json 数据路由
when-to-use: 用户问起 HUD/状态栏设置、想要持续的会话状态可见性、或问"我的 HUD 在哪"。v0.4 起三个承载面均已落地；CLI 会话无面板时经 MCP 工具拿同款摘要。
---

# hud（状态可见性）

> **v0.4 现状（诚实）**：OMC 的 HUD 是 Claude Code 的 `statusLine` 脚本，dsh 没有状态栏面——但 omd 的 HUD 已经以 dsh 原生形态落地三层：
>
> 1. **Client half 面板**（`lib/client.js`）：dsh web GUI 右侧边栏注册 tab 类型 `omd-hud`（guide 页「omd HUD」胶囊打开），5s 轮询渲染五要素 6 行卡 + cwd/取数时间细节。面板可见性前提：dsh web 宿主加载 omd 插件并已重启以装载 client bundle（HMR 不覆盖新插件激活）。
> 2. **数据路由**（`lib/hud-route.js`）：web 宿主 exact GET `/oh-my-dsh/hud.json?cwd=`，面板的取数面（loopback 只读、no-store；?cwd= 可覆盖默认宿主进程锚点）。CLI 会话无 webServer → `hudRoute` probe 记 skipped，不是降级。
> 3. **MCP server 面**：`mcp__omd-state__hud_render`（五要素 summary JSON + 6 行卡文本）/ `hud_summary`（纯 JSON）——任何会话（含 CLI）立即可用，数据源严格只有 `state_get_status` + `notepad_stats` 两个现成读面（lib/hud.js 设计约束）。
>
> statusline 持续渲染在 dsh 的等价物就是这块右栏面板（webServer/client bundle 形态），不是终端状态栏——语义差异如实记录。

## HUD 该显示什么（内容契约 v1）

五要素（`lib/hud.js#HUD_FIELDS`，逐字段 diff 的遍历序）：

| 要素 | 语义 | 数据源 |
|---|---|---|
| mode | 全部活跃模式名（无活跃 → `idle`） | `state_get_status` |
| round | 最新活跃模式的 iteration | `state_get_status` |
| story | 最新活跃模式的 current_story | `state_get_status` |
| agents | 最新活跃模式的 active_agents 计数 | `state_get_status` |
| todo | notepad 三区计数（working/priority/manual） | `notepad_stats` |

渲染契约：`renderCard` 6 行有界文本（`[omd] HUD 摘要卡` + 五要素逐行）；空态可渲染（idle/0）。OMC 的颜色纪律（绿/黄/红）与 focused/full 预设留作面板后续迭代输入——当前面板是 minimal 形态。

## 各会话形态怎么拿 HUD

- **dsh web GUI**：右侧边栏 guide 页 →「omd HUD」胶囊（或已固定的 omd-hud tab）。面板不出现 → 先 `/omd-doctor` 看 `hudRoute` 探测行与 client bundle 装载（宿主需重启装载新 client 插件）。
- **任意会话（含 CLI）**：`mcp__omd-state__hud_render` 一句话拿卡；或自行 `state_get_status` + `notepad_stats` 两调用派生（契约同上表）。
- **队员/审查场景**：`hud_summary` 拿纯 JSON 供机器消费。

## 诚实回答 HUD 问题

- **不要**往 `~/.claude/` 写脚本、不要编辑 `settings.json`——这些面在 dsh 下不存在。
- 面板不自动出现 = 大概率宿主未重启装载 client bundle，或 CLI 会话（本就该用 MCP 面）；如实诊断，不要承诺"刷新就有"。
- 数据路由只读且仅 loopback；/api 桥的 cookie 鉴权不覆盖它——暴露面是模式/计数级低敏摘要，此边界已记录在 lib/hud-route.js 头注。

## 状态契约

hud **不持模式状态**、不写任何东西——它是可见性技能。读面：`hud_render` / `hud_summary` / `state_get_status` / `state_list_active`；绝不调 `state_write`/`state_clear`，绝不碰文件。
