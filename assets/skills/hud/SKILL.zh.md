---
name: hud
description: omd 会话的状态可见性——HUD 五要素（模式、轮次、story、agent、todo）与三个已落地承载面：MCP hud_render/hud_summary、web GUI 右侧边栏 HUD 面板（client half）、/oh-my-dsh/hud.json 数据路由
when-to-use: 用户问起 HUD/状态栏设置、想要持续的会话状态可见性、或问"我的 HUD 在哪"。v0.4 起三个承载面均已落地；CLI 会话无面板时经 MCP 工具拿同款摘要。
---

# hud（状态可见性）

> **v0.4 现状（诚实）**：OMC 的 HUD 是 Claude Code 的 `statusLine` 脚本，dsh 没有状态栏面——但 omd 的 HUD 已经以 dsh 原生形态落地三层：
>
> 1. **Client half 面板**（`lib/client.js`）：dsh web GUI 右侧边栏注册 tab 类型 `omd-hud`（guide 页「omd HUD」胶囊打开），自适应轮询 `/oh-my-dsh/hud.json`（活跃 5s，内容不变退避至 ≤30s） 渲染语义化面板：preset 三档（minimal/focused/full，缺省 focused）、idle 空态引导（渲染下发 modeCatalog：模式名+中文名同现）、活跃态主模式卡（中文标签：模式/阶段/轮次/任务/记忆；stale 时附「未更新」提示行）与 tier 三档色档（正常/警告/危险，颜色仅 CSS 变量视觉档、必带文字标记）。面板可见性前提：dsh web 宿主加载 omd 插件并已重启以装载 client bundle（HMR 不覆盖新插件激活）。
> 2. **数据路由**（`lib/hud-route.js`）：web 宿主 exact GET `/oh-my-dsh/hud.json?cwd=`，面板的取数面（loopback 只读、no-store；?cwd= 可覆盖默认宿主进程锚点）。响应在五要素 summary/card 之外下发 `detail`/`modeCatalog`/`preset` 面板私有键（不进 MCP wire）。CLI 会话无 webServer → `hudRoute` probe 记 skipped，不是降级。
> 3. **MCP server 面**：`mcp__omd-state__hud_render`（五要素 summary JSON + 至多 8 行中文状态卡文本）/ `hud_summary`（纯 JSON）——任何会话（含 CLI）立即可用，数据源严格只有 `state_get_status` + `notepad_stats` 两个现成读面（lib/hud.js 设计约束——该约束仍适用于 MCP wire 面；/oh-my-dsh/hud.json loopback 私有面已经 P2 一次性修订扩展，修订来源=.omd/plans/ralplan-omd-upgrade-hud-observability.md ADR）。
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

> **agents 计数语义（U6 过渡澄清）**：该计数读取模式状态里**领队显式写入**的 `active_agents` 字段——team 运行时本身不自动写它，未写时显示 0 属正常而非故障。team 队员的生命周期明细（workerId/role/status/心跳时长）以 `team_registry` MCP 工具与 `.omd/team/<runId>/registry.json` 为权威数据面。多行 agent 树（U6）的数据面方案由其立项 ralplan 裁决。

渲染契约（至多 8 行有界）：`renderCard` 标题「[omd] 编排状态」；活跃态=模式/阶段/轮次/代理/记忆五行（中文标签）+ 可选「故事」行（主模式有 current_story 时，优先于小注）+ 次要模式小注（「另有 N 个…」，行数预算够才补）；stale 时附「状态超过阈值未更新（stale；上次更新：<updatedAt>）」（阈值随模式配置而定，不写死）；空态=「当前没有运行中的 omd 模式。」+ 五模式引导行（模式名+中文名+一句话启动示例）+ 记忆行。活跃样例：

```
[omd] 编排状态
模式: ralph（Ralph 循环）
阶段: exec
轮次: 3
代理: 2 个活跃代理
记忆: 永久 1 · 工作 2 · 手动 0
故事: US-2
状态超过阈值未更新（stale；上次更新：2026-02-06T10:00:00.000Z）
```

面板私有数据面（仅 `/oh-my-dsh/hud.json` 下发，不进 MCP wire）：`detail`（{primary, modes[]}，fresh-first，透传 label/current_phase/stale 等状态字段）、`modeCatalog`（五模式「模式名+中文名」常量目录，单源自 lib，client 只渲染不内置）、`preset`（minimal/focused/full，缺省 focused，来源 dsh Config 键 hud.preset）。

> **P2 修订记录（U8）**：hud.json 私有面数据源由 `state_get_status` + `notepad_stats` 扩展为再加 `.omd/team/*/registry.json` 聚合（`workers` 键）与 `.omd/state/events.jsonl` 聚合（`toolCalls` 键）；该扩展仅 hud.json 私有面生效（loopback 只读路由 `/oh-my-dsh/hud.json`）；MCP wire 面（`hud_render`/`hud_summary`/`state_get_status` 形状）零变化。修订来源=.omd/plans/ralplan-omd-upgrade-hud-observability.md ADR。

**workers / toolCalls 新数据面（仅 hud.json，U8 一期）**：

- `workers={list, truncated}`（对象包非裸数组）：list 元素恰六键 `{runId, workerId, role, status, spawnedAt, lastHeartbeatAt}`（不透传 registry.stale）；run 目录按 mtime 新者优先扫描，收满 50 名提前退出并标 `truncated:true`；list 内按 spawnedAt 新者优先。
- `toolCalls={total, byTier:{low,medium,high,explicit}, fallbackCount}`：聚合自 `.omd/state/events.jsonl`（append-only 派发事件总线，route/fallback 两类事件）；byTier.explicit 桶计 explicit=true 事件，low/medium/high 桶仅计 explicit=false 且 tier 非 null 事件。
- **events.jsonl 尾部窗口语义**：读面只取尾部 64 KiB（DEFAULT_EVENTS_WINDOW_BYTES）——`total`/`fallbackCount` 均为窗口内计数；旧 fallback 滑出窗口后 fallback>0 的 warn 色档自动消退，这是有意的「近期信号」语义，不是 bug。
- **toolCalls.total 计数口径=路由判定**：落盘挂钩点在 model 校验/spawn 闸门之前，故含后续校验失败/spawn 失败车次（与 [routing] logLine 的 1:1 口径仅对成功派发成立）。
- **full preset 两区**：「队员」区（U6 起为**自适应 run 分组两级树**——workers.list 含 ≥2 个 distinct runId 时渲染组头行「run …<runId 末 8 字符> · N 名」（N=组内已渲染队员行数；截断腰斩 run 时由截断提示行兜底联读消歧）+ 队员行缩进（paddingLeft 12）；队员行内容仍为 workerId/role/status/心跳时长，truncated 时附截断提示行，一期纯时长显示、无 stale 阈值推导。单 run（list 全同 runId）保持 U8 平铺原状零组头；树上限=run 根→队员行两级，不虚构更深层级）与「工具调用」区（路由判定计数/tier 分布/fallback 行，fallback>0 时数值带 warn 色）——focused/minimal preset 不含两区，payload 缺键时跳过不炸。
- **版本交叉免疫（U6）**：旧 client 收到含 runId 的新 payload → 忽略新键照 U8 平铺渲染，不炸；新 client + 旧 server（payload 缺 workers/toolCalls 键）→ 两区整体跳过不炸；runId 字段缺席时组头兜底「-」（server 侧 `registry.runId ?? run.name` 恒非空，lib/hud-route.js:52）。

tier 色档（仅 client 面板；MCP 卡恒纯文本、禁 ANSI）：ok=状态正常（活跃且非 stale）；warn=警告（主模式 stale，或活跃模式 current_phase 为 fix 且 fixLoops≥2）；danger=危险（任意活跃模式 state 为 failed）。hud-route 私有侧另在 toolCalls.fallbackCount>0 且原档为 ok 时把下发的 detail.tier 提升为 warn（danger 不降级，lib/hud.js deriveTier 零改动）。色档经 data-tier 属性落 DOM，且必带文字标记（状态正常/警告/危险）——颜色不是唯一信息载体。

名实分离注明：五要素数据契约（mode/round/story/agents/todo）与工具名 `hud_render`/`hud_summary` 保持不变；卡与面板的呈现已更名「编排状态」并改用中文标签——上卡的「阶段」（current_phase）替代「故事线」（current_story）属呈现层选择，数据面照旧透传 story；旧称「HUD 摘要卡」仅存于历史版本。

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
