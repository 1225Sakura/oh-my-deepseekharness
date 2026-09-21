---
name: omd-doctor
description: 诊断 oh-my-dsh 安装——宿主版本、注册计数、Config 模型可解析性、MCP 冒烟、.omd/ 可写性、probe 四态矩阵——以检查表输出并附修复建议
when-to-use: 由 `/omd-doctor` 命令触发（命令是薄壳，加载本技能），或用户要求验证/诊断 omd 安装（"doctor"、"检查 omd"、"omd 不工作了"）。不能替代 E2E 发布门禁。
---

# omd-doctor（诊断）

omd 原创技能——`/omd-doctor` 命令背后的诊断大脑（命令只是薄转发壳，本技能是单一事实源，规格 §6.3）。跑固定检查清单，输出一张结果表，每个不通过项附修复建议。

## 怎么跑检查

按顺序逐项检查。每项在最终表格中落定一个状态：✅ 通过 / ⚠️ 警告 / ❌ 失败。❌ 或 ⚠️ 行**必须**带具体修复建议。

### 1. 宿主版本 vs peerDependencies

- 确定运行中的 dsh 宿主版本（会话运行时上下文，或已安装 `@deepseek-ai/dsh-*` 包版本）。
- 对照插件 peerDep 范围：`@deepseek-ai/dsh-*` 锁定 **0.1.5-rc.1**（见 omd `package.json`）。
- 低于范围 → ❌（修复：升级 dsh；或接受尽力而为的降级运行——omd 警告但不拒绝加载，规格 §6.1）。高于已测范围 → ⚠️ "比已测版本新"。

### 2. 注册计数核对

数本会话实际可见的注册项，与预期对比：

| 项 | 预期 | 怎么数 |
|---|---|---|
| skill | **40**（完整名册见 `tests/assets/skills.test.js` 的 EXPECTED） | 会话技能目录 |
| 角色卡 | **19** 个 `omd-agent-*`（名册见 `tests/assets/agents.test.js` 的 TIERS） | 技能目录中 `omd-agent-` 前缀条目 |
| 命令 | **2**（`/omd-doctor`、`/omd-cancel`） | 命令列表 |
| 插件内工具 | **3**（`omd_memory_set`、`omd_memory_get`、`omd_memory_delete`） | 工具列表 |
| MCP 工具 | **18** 个 `mcp__omd-state__*`（state×5、notepad×6、prd×4、handoff×3） | 工具列表前缀计数 |

任何缺口 → ❌ 并列出缺失名字（修复：检查 `assets/skills` / `assets/agents` 是否完整随包发布、加载器注册是否带 `source: 'oh-my-dsh'`；检查 cordis.patch.yml 挂载）。**记忆工具（omd_memory_*）缺失时**：检查 omd 的 `inject` 声明是否含 `storage`、当前 profile 是否 base-backed（dsh-base 挂载了 dsh-storage 三件套——非 base profile 缺 storage 属预期降级）——这是 omd 声明/profile 层问题，不是宿主缺陷。

### 3. Config 各档模型标识符可解析性

- 读生效的 omd Config：`tiers.low/medium/high` 与 `roleOverrides`——生效值从系统提示词 omd 协议段的模型路由表读取（模型无法直接读插件 Config）。
- 逐个校验：`inherit` 永远合法；其他值必须能被宿主 LLM 服务解析为模型标识符。
- 不可解析 → ❌（修复：改正插件配置中的标识符，或设为 `inherit` 跟随主会话模型）。附 MVP 注意：模型路由只在 `workflow` 路径硬生效；`subagent` 继承主会话（软路由），所以标识符错误在该路径是降级而非崩溃。

### 4. MCP server 冒烟

- 调一次 `mcp__omd-state__state_get_status`。拿到结构化响应（哪怕是"无活跃模式"）→ ✅。
- 工具缺失或调用失败 → ❌（修复：检查 cordis.patch.yml 的 MCP 挂载 / `apply()` 里的动态挂载；`failOnStartupError: false` 意味着死 server 静默失败——看协议层有没有降级公告；重连是宿主 mcp-client 的职责）。

### 5. `.omd/` 可写性 + .gitignore 状态

- 在 `.omd/` 下写入再删除一个探针文件（如 `.omd/.doctor-probe`）证明可写。不可写 → ❌（修复：目录权限；只读工作区预期整体降级为纯会话操作）。
- 检查 `.gitignore` 是否覆盖 `.omd/`。未覆盖 → ⚠️（修复：把 `.omd/` 加进 `.gitignore`——omd 只提示，绝不擅自改用户文件，规格 §5.5）。

### 6. probe 四态一览

把能力探测结果（协议层 probe.js + apply 追加项）渲染成表——每项一行、标四态：

| 探测项 | ok / unavailable / failure / timeout |
|---|---|
| core（inject 四服务） | … |
| `ctx.storage` 后端（domain API 形态校验） | … |
| hooksBridge（二期前置，M3 关键词 hook——unavailable 不算降级） | … |
| mcpServer（apply 动态挂载结果：mounted/failure） | … |
| memoryTools / commands（注册结果） | … |

说明：goal/ralph/subagent/workflow/ask_user_question 等宿主工具**不做静态探测**（规格 §7-6），以实际调用结果为准；如需验证请直接试调。核心服务（`tools`/`skills`/`systemPrompt`/`commands`）缺失本应在启动就报错——若在 doctor 才发现，标 ❌"这本该是启动错误"。任何触发降级的非 `ok` → ⚠️ 并注明降级路径（规格 §6.1 矩阵）。

### 7. profile patch 分层正确性（尽力而为）

- 能跑 `dsh --profile <name> --dump-config` 就验证 omd bundle patch 展开正确（插件实例存在、config 值落地；MCP server 是 apply() 运行时动态挂载，patch 里看不到属正常——以检查项 4 的冒烟为准）。注意：裸 `dsh --dump-config` 不带 profile 会报错（退出码 1，实测）。
- 会话内跑不了 → 标"未检查（手动步骤）"，不猜。

## 输出格式

一张汇总表加细节：

```
omd doctor — <日期>

| # | 检查项 | 状态 | 细节 |
|---|-------|------|------|
| 1 | 宿主版本 vs peerDep（0.1.5-rc.1） | ✅/⚠️/❌ | host=<v> |
| 2 | 注册计数（40/19/2/3/18） | … | 缺失：… |
| 3 | Config 模型标识符 | … | … |
| 4 | MCP 冒烟（state_get_status） | … | … |
| 5 | .omd/ 可写 + .gitignore | … | … |
| 6 | probe 四态矩阵 | … | N 项非 ok |
| 7 | patch 分层（--dump-config） | … | … |

修复建议：
- ❌ <检查项>：<具体修法>
- ⚠️ <检查项>：<具体建议>
```

## 结尾声明（必须打印）

> doctor 只检查安装与接线健康。**它不证明端到端可用**——E2E 门禁（autopilot / ralph / team 各真实跑通一次）是独立的人工发布门禁（规格 §6.4）。

## 状态契约

omd-doctor 是只读诊断，**不持模式状态**：无 `state_write`/`state_clear`，唯一的文件系统触碰是 `.omd/.doctor-probe` 的创建即删可写性探针。它绝不修改 Config、patch 或插件文件。
