# oh-my-dsh (omd) 设计规格

日期：2026-09-15
状态：待用户审查
参考项目：[oh-my-claudecode (OMC)](https://github.com/Yeachan-Heo/oh-my-claudecode)（已克隆至 `reference/oh-my-claudecode`，v5.4.0）、[oh-my-codex (OMX)](https://github.com/Yeachan-Heo/oh-my-codex)（已克隆至 `reference/oh-my-codex`，v0.21.5）
宿主：DeepSeek Harness (dsh)，本机安装 v0.1.5-rc.1

---

## 0. 决策记录（用户已确认）

| 决策点 | 结论 |
|---|---|
| 核心价值 | 完整移植 OMC 四类能力：执行模式全家桶、多代理编排与角色目录、技能与命令目录、状态持久化与会话交接 |
| 分发形态 | **单个 dsh bundle 插件**，发布到插件市场（dshmarket），一键安装 |
| 模型路由 | 用户配置映射：角色→档位→模型，默认值 DeepSeek 系列，可改任意 provider/model |
| 资产内容 | 全量移植 OMC 的 19 角色 + 40 skill；**双语**（中文/英文可选） |
| 实施节奏 | **先 MVP 再迭代**：第一期骨架 + 3 模式 + 6 角色 + 8-10 skill，跑通后补全 |
| 依赖边界 | ❌ 不依赖任何第三方 dsh 插件；✅ dsh 宿主原生包；✅ MCP（含 omd 自带 MCP server）；✅ 插件内自研工具 |

### 依赖边界细则

1. 运行时零第三方插件依赖——只 `inject` 宿主服务（`tools`/`skills`/`systemPrompt`/`commands`/`storage`）。
2. peerDependencies 只锁 `@deepseek-ai/dsh-*` 宿主包版本范围。
3. OMC 中由 MCP server / 外部 CLI 承担的功能，omd 里一律改为插件内原生实现或自带 MCP server。
4. 升级维护：用户只升级 omd 一个包；宿主升级导致 API 变化时由 omd 单方面适配（能力探测 + 降级，不版本硬锁死）。
5. 工具放置策略：需要访问 `ctx` 的放插件内工具；纯文件/进程操作放自带 MCP server（好处：与 OMC/OMX 代码可复用、可跟随上游升级；其他宿主也能经 MCP 复用）。

---

## 1. 架构总览与能力映射

omd 的本质是 **编排协议（系统提示词）+ 资产目录（双语 skills/角色）+ 少量增强工具**。dsh 原生已具备 OMC 需要 hook 才能实现的能力（goal 续跑 ≈ Stop hook、ralph 工具、subagent），所以 omd 运行时逻辑很薄。

```
用户自然语言 ("autopilot 做一个 xxx")
        ↓
[omd 协议层] systemPrompt section：关键词路由表 + 委派规则 + 模型路由表 + 能力矩阵 + 状态契约
        ↓
[omd 资产层] skill（双语）/ 角色卡 / 模板 —— ctx.skills.register
        ↓
[dsh 原生执行层] goal / ralph / subagent / subagent_fork / workflow / todo_write
        ↓
[omd 状态层] .omd/ 项目目录 + ctx.storage（profile 级记忆）
```

### 能力映射矩阵（OMX 式分级）

| OMC 能力 | dsh 对应 | 分级 | omd 实现方式 |
|---|---|---|---|
| ralph 持久循环 | `ralph` 工具（宿主原生） | native | skill 资产 + 参数契约 |
| autopilot 自治流水线 | `create_goal`/`update_goal` 续跑（宿主原生） | native | skill 资产定义阶段协议 |
| team 编排 | `subagent`/`subagent_fork`/`workflow`/`send_message`/`list_agents`/`interrupt_agent`（宿主原生） | native | 协议段落 + 角色卡注入 |
| magic keyword 触发 | 无原生 hook | prompt 层 | systemPrompt section 关键词→模式路由表 |
| 19 角色 | `subagent` 工具 + prompt 注入 | native-partial | omd 内置角色卡库（注册为技能） |
| 模型路由三档 | workflow `agent()` 的 provider/model 参数 | native-partial | 插件 Config 映射；subagent 路径 MVP 期软路由 |
| .omc/ 状态目录 | `.omd/` + omd 自带 MCP server 工具 | native-partial | 见第 5 节 |
| OMC 的 33 个 MCP 工具 | — | 自带 MCP server | state_*/notepad_*/handoff_*/prd_*；lsp/ast-grep/python_repl 二期再议 |
| setup/doctor CLI | 不需要——插件安装即就绪 | 改进 | `/omd-doctor` 斜杠命令 |
| HUD 状态栏 | `dsh.client` 客户端槽位（宿主原生机制） | native | 二期 |
| Stop hook 续跑 | goal 原生续跑 | 不需要 | 省略 |

### 吸收的 OMX 移植经验

1. 能力探测 + 分级降级矩阵（缺什么降级到什么，见第 6 节）。
2. `/omd-doctor` 验装命令。
3. 配置区块只管理自己的部分，不污染用户文件。

### MVP 范围（第一期）

插件骨架 + 协议层 + 执行模式 3 件套（autopilot/ralph/team）+ 核心角色 6 个 + 核心 skill 10 个 + 模型路由 Config + `/omd-doctor` + `/omd-cancel`。

**MVP 10 个核心 skill（明确清单）**：`autopilot`、`ralph`、`team`、`deep-interview`（需求澄清）、`ralplan`（共识规划）、`execute`（计划执行）、`verify`（验证）、`review`（代码评审）、`cancel`（模式取消协议）、`handoff`（会话交接）。

二期：HUD 面板、其余 30 个 skill / 13 个角色全量移植、`omd_delegate` 硬路由工具、lsp/ast-grep 类工具。

---

## 2. 插件工程结构

```
oh-my-dsh/                        # npm 包名 oh-my-dsh
├── package.json                  # dsh.bundle.patch → cordis.patch.yml；
│                                 # peerDependencies 锁 @deepseek-ai/dsh-* 版本范围
├── cordis.patch.yml              # 挂载 omd 主插件实例（MCP 挂载方式见"待验证"）
├── lib/
│   ├── index.js                  # apply(ctx, config)：注册协议段/skills/命令/工具
│   ├── protocol.js               # 系统提示词 section：关键词路由、委派规则、模型路由表、
│   │                             #   能力矩阵、状态契约（同步 text 函数渲染）
│   ├── skills.js                 # 遍历 assets/skills，ctx.skills.register（双语）
│   ├── commands.js               # /omd-doctor、/omd-cancel
│   ├── probe.js                  # 能力探测：goal/ralph/subagent/workflow/ask_user_question 工具、
│   │                             #   ctx.storage 后端、宿主版本、MCP client 服务
│   └── tools/                    # 插件内自研工具（需 ctx）：omd_memory_*
├── mcp-server/                   # 自带 stdio MCP server（OMC 工具移植面）
│   ├── index.mjs                 # 入口（command 用 process.execPath 启动，避开 PATH 问题）
│   └── tools/                    # state_*, notepad_*, handoff_*, prd_*
├── assets/
│   ├── skills/                   # skill 目录，每个含 SKILL.md + SKILL.zh.md
│   ├── agents/                   # 角色卡：<role>.md + <role>.zh.md
│   └── templates/                # .omd/ 骨架、PRD 模板等
├── client/                       # 二期：GUI 面板（届时补 package.json 的 dsh.client 字段）
└── docs/
```

### 开发规范（来自本机踩坑记录，硬性要求）

1. 每个运行时 skill 注册必须带 `source: 'oh-my-dsh'` 和字符串 `content`（dsh-superpowers-zh 中途崩溃教训）。
2. systemPrompt `section()` 的 text 若是函数必须**同步返回**，不能 async（claude-bridge 教训）。
3. 工具 output schema 声明的字段不许返回 `null`；用 `undefined`/省略（git-workflow 教训；宿主校验器跳过 undefined 但拒绝 null）。
4. 工具错误返回模型可读文本，不抛裸异常。
5. 双语实现：按 Config `language: 'zh'|'en'|'both'` 在注册时选择内容；`both` = 中文正文 + 关键术语保留英文（每种模式在设计/实现时给出具体示例）。
6. 构建：lib/ 和 mcp-server/ 用 esbuild 打成单文件；assets/ 原样发布。

---

## 3. 执行模式协议

### 3.0 模式启动权硬约束

- `create_goal` 拒绝非人类/subagent 权限；`ralph` 要求 direct human 明确要求。
- **autopilot/ralph 只能在主会话直接启动，协议禁止队长把模式启动委派给队员。**
- team 模式以队员为主体，无此约束。
- `ralph` 是前台阻塞调用：运行期间主会话不能交互做别的；真实冲突场景是"goal 续跑中的会话又收到 ralph 请求"，`.omd/state/` 契约照此防嵌套。

### 3.1 autopilot（→ dsh goal 机制）

触发：协议层关键词表（"autopilot …"）→ 模型加载 autopilot skill。

协议：
1. **Expansion**：`ask_user_question` 澄清需求，规格写入 `.omd/plans/<topic>.md`。
2. **启动阈值**：单轮能完成的任务直接做，不开 goal。
3. **启动**：`create_goal(objective=规格摘要)`，进入宿主原生续跑循环。
4. **循环体**（每轮）：`todo_write` 拆任务 → `subagent`（executor 角色卡）背景并行实现 → 运行验证命令 → 全部通过则 `update_goal(complete)`。
5. **阻塞上报**：同一失败连续 3 轮 → `update_goal(blocked, blocked_reason=具体条件+三轮证据)`；不是"困难就报阻塞"。
6. **取消**：`/omd-cancel` → 提示模型 `update_goal(pause)` + `state_clear`。

降级：goal 工具缺失 → `.omd/state/autopilot.json` 记进度，每轮结束提示用户输入 continue。

### 3.2 ralph（→ dsh ralph 工具）

触发："ralph …"（用户显式要求，满足工具的 direct-human 契约）。

协议：
1. 产出 PRD：`.omd/prd/<topic>.md`，每个 user story 带**可执行验证命令** + markdown 勾选项。
2. `ralph(objective=PRD 路径 + 完成判据, maxRounds)`——宿主 fresh-agent 循环：每轮全新上下文、工作区即记忆、有界报告跨轮传递。
3. **可信度约束**（dsh ralph 完成判据是 worker 自报，无独立评估）：objective 强制"每轮必须运行验证命令并把原始输出写入交接报告，未运行不得勾选"——用证据约束代替 OMC 的 reviewer 签字。
4. 每轮第一件事：读 `.omd/prd/<topic>.md` 和 `.omd/state/`。

**语义差异（已确认接受）**：OMC 靠 Stop hook 同上下文续跑；dsh ralph 是每轮 fresh agent + 工作区记忆。omd 直接采用宿主语义，不做兼容模拟。

降级：ralph 缺失 → goal 驱动同会话循环（Expansion → create_goal → 每轮推进一条 story）；goal 也缺失 → 纯 PRD + 人工推进。

### 3.3 team（多代理编排）

触发："team …"。MVP 只用宿主原生 `subagent`/`subagent_fork` + `send_message`/`list_agents`/`interrupt_agent`：

- 队长-队员模型：主会话是队长，按角色卡 spawn 队员（默认背景并行），`send_message` 协调，`list_agents` 盘点。
- 角色卡拼接：subagent prompt = 角色卡正文 + 任务描述 + 输出契约。
- 同质任务扇出 ~5 个以上 → 协议指引改用 `workflow` 工具（`agent()`/`pipeline()`/`parallel()`；此时模型路由硬生效）。
- 状态可见性：队员完成通知异步到达；协议要求队长等待时 **yield 而非轮询**。

降级：subagent 缺失 → 主会话顺序执行，协议如实标注"单代理模式"。

### 3.4 模式间协作契约

- 三个模式共用 `.omd/state/active-mode.json` 记录当前活跃模式（含 goalId/轮次）。
- 模式启动前必读 state：goal 续跑中不得再启动 ralph/team；team 运行中不得启动 autopilot。
- 模式完成/取消时 `state_clear`；plans/prd/handoffs 保留供追溯。

---

## 4. 角色目录 + 模型路由

### 4.1 角色卡机制

角色注册为 **modelInvocable 技能**：模型委派前用 `skill` 工具加载角色卡（懒加载），再按卡组装 subagent prompt。复用技能目录的加载/优先级机制，零额外基建。

角色卡格式（`assets/agents/executor.md` + `executor.zh.md`）：

```markdown
---
name: omd-agent-executor
description: 实现型队员——接到明确任务后写代码、跑验证、报告结果
tier: medium
whenToUse: 委派实现/修复类任务前加载本卡
---
# 角色：Executor
（职责、边界、输出契约：changedPaths / 验证命令及原始输出 / 未完成项如实报告）
```

**MVP 6 角色**：explorer(low)、planner(high)、executor(medium)、verifier(medium)、code-reviewer(high)、designer(medium)。二期补齐 OMC 全部 19 个（Build/Review/Domain/Coordination 4 条 lane 原样移植）。

**上下文成本权衡**：每个注册技能以"名称+摘要"常驻每轮技能目录。MVP 6 角色 ≈ 6 行可接受；全量 19+40=59 行成本显著——缓解措施：① 角色卡 description 限一行；② 备选方案留档：成本不可接受时改为 `omd_role(name)` 工具按需取模板（不进目录）。

### 4.2 模型路由分层

| 委派路径 | 路由能力 | 策略 |
|---|---|---|
| `workflow` 的 `agent()` | ✅ 硬路由（provider/model 参数） | 协议层给出当前生效"角色→模型"解析表，照表填参 |
| `subagent`/`subagent_fork` | ❌ 无 model 参数，继承主会话 | MVP 软路由：角色卡写明建议档位，协议如实告知不生效 |
| 二期 `omd_delegate` 自研工具 | ✅ 硬路由 | `inject: ['subagents']`，用宿主 dsh-subagent 服务 spawn 并指定 model（agent_teams 插件已实证此路径，收编为自研） |

### 4.3 Config schema（schemastery）

```js
Config = Schema.object({
  language: Schema.union(['zh', 'en', 'both']).default('zh'),
  tiers: Schema.object({
    low:    Schema.string().default('deepseek-chat'),
    medium: Schema.string().default('deepseek-chat'),
    high:   Schema.string().default('deepseek-reasoner'),
  }).description('档位→模型映射'),
  roleOverrides: Schema.dict(Schema.string()).default({})
    .description('角色级覆盖，如 { "omd-agent-code-reviewer": "…" }'),
  stateDir: Schema.string().default('.omd'),
})
```

解析顺序：`roleOverrides[role]` > `tiers[role.tier]`。解析结果在 `apply()` 时渲染进协议 section（当前生效路由表）。用户改配置 → cordis 重放插件 → section 更新（重放语义待验证，见第 7 节）。

### 4.4 委派规则段（协议层组成部分）

精简版 OMC delegation_rules：何时委派、加载哪个角色卡、照路由表填 model、默认背景并行、不重复委派同一工作、等待时 yield。

---

## 5. 状态持久化

### 5.1 两层数据归属

| 层 | 位置 | 内容 | 读写方式 |
|---|---|---|---|
| 项目层 | 会话 cwd 下 `.omd/` | 模式状态、plans、prd、handoffs、notepad、logs | omd 自带 MCP server 工具；文件人类可读，模型也可用普通文件工具直接操作 |
| profile 层 | `ctx.storage`（`~/.dsh/storages/oh-my-dsh.json`） | 跨会话项目记忆（key=哈希后的项目路径）、用户偏好、角色自定义 | 插件内工具 `omd_memory_set/get/delete` |

`.omd/` 布局：

```
.omd/
├── state/           # active-mode.json（当前模式+goalId/轮次，防嵌套契约）
├── plans/           # autopilot 规格、实现计划
├── prd/             # ralph PRD（markdown 勾选项）
├── handoffs/        # 会话压缩/交接摘要（resume 后恢复上下文）
├── notepad.md       # 随手记（7 天过期清理由工具负责）
└── logs/            # 模式执行日志
```

二期：`project-memory/`、`.omd-workspace` 多 repo 共享标记、`$OMD_STATE_DIR` 集中化。

### 5.2 工具清单

MCP server（纯文件操作，无 ctx 依赖）：
- `state_read`/`state_write`/`state_clear`
- `handoff_write`/`handoff_read`/`handoff_list`
- `notepad_add`/`notepad_read`/`notepad_clear`
- `prd_check`/`prd_uncheck`/`prd_status`（结构化操作 PRD 勾选项，防 markdown 格式漂移）

插件内工具（需 ctx）：`omd_memory_set`/`omd_memory_get`/`omd_memory_delete`。

探测结果不做成工具——双输出：渲染进协议 section（模型可见）+ `/omd-doctor`（人可见）。

明确不做（YAGNI）：OMC 的 lsp_*（12 个）、ast_grep、python_repl、better-sqlite3 job 库——MVP 验证靠宿主 shell/测试命令。

### 5.3 与原生机制衔接

- ralph：objective 规定每轮先读 PRD + state。
- goal 续跑：协议要求每轮结束更新 active-mode.json；会话恢复后读 state 定位。
- 压缩恢复：协议层 section 常驻系统提示词，配合 handoff 文件恢复现场——用"读文件"代替 OMC 的 PreCompact hook 捕获。

### 5.4 并发与安全

- 文件写一律 tmp+rename 原子写。
- MVP：`state_write` 写前读检查（state 基本由队长写）；二期升级为 compare-and-swap。
- `.omd/` 首次写入时检测并提示加 .gitignore，不擅自改用户文件。
- MCP server 生命周期由宿主 dsh-mcp-client 回收，omd 不管。

---

## 6. 错误处理、降级矩阵与测试

### 6.1 降级矩阵

probe.js 在 `apply()` 时探测，结果渲染进协议 section（模型每轮可见能力边界）：

| 探测项 | 缺失时降级 |
|---|---|
| `create_goal`/`update_goal` | autopilot → 手动循环：`.omd/state/autopilot.json` + 提示用户输入 continue |
| `ralph` | → goal 驱动循环 → 纯 PRD + 人工推进 |
| `subagent`/`workflow` | team → 主会话顺序执行；模型路由整体失效，协议标注"单代理模式" |
| `ask_user_question` | 澄清提问 → 纯文本提问 |
| `ctx.storage` 后端异常 | 项目记忆 → `.omd/memory.json`（丢失 profile 级共享，协议注明） |
| MCP server 启动失败 | state/handoff/notepad 缺失 → 协议教模型用普通文件工具直接操作 `.omd/` |
| 宿主版本低于 peerDep 下限 | warning 日志 + doctor 标红，不拒绝加载（尽力而为） |
| **核心 inject 服务缺失**（tools/systemPrompt） | **例外：启动即报错**——插件根本无法工作时不静默降级 |

### 6.2 错误处理原则

1. 静默失败是头号敌人：任何降级必须可见（协议 section 标注 + 首次触发时模型主动告知用户）。
2. 工具错误返回模型可读文本；output schema 字段不返回 null。
3. MCP server：`failOnStartupError: false` + reconnect 交宿主 mcp-client 原生机制。
4. active-mode.json 是唯一恢复入口，任何模式启动前先读它。

### 6.3 测试策略

| 层 | 内容 | 工具 |
|---|---|---|
| 单元 | state 原子写、PRD 勾选解析、路由解析、双语选择、配置 schema | vitest，CI 跑 |
| 集成（离线） | mock ctx 上 apply：注册数量/内容、section 渲染、探测降级路径 | vitest + 手写 mock ctx |
| 集成（真实宿主） | `dsh --dump-config` 验证 patch 展开；本机 web profile 实装冒烟 | 脚本/手动 |
| E2E（真实会话） | autopilot 写个小脚本、ralph 过 2 条 story、team 扇出 3 个探查 | **发布前人工门禁**（耗 token、依赖用户模型配置，不进 CI） |
| 回归防线 | probe 各探测项逐个置缺失，验证降级不崩 | vitest |

发布门禁：单测全绿 + `--dump-config` 正确 + 本机 profile 实装 doctor 全绿 + 三模式 E2E 各过一次。

已知局限（如实声明）：mock ctx 按调研的 API 形状手写，宿主 API 变化时 mock 不会自动发现——真实防线是 peerDep 范围 + 真实宿主冒烟。

---

## 7. 实现期验证清单（设计阶段无法证实，实现时必须验证）

1. cordis.patch.yml 静态 YAML 中能否引用 omd 包内路径挂 MCP server（类 `${CLAUDE_PLUGIN_ROOT}` 变量替换）；不行则改 `apply()` 运行时经 cordis API 动态挂载（`__dirname` 消解路径问题）。
2. 用户改插件 Config 是否触发 cordis 重放插件；否则需注册配置监听手动更新 section。
3. dsh LLM 服务的模型标识符完整格式（provider 前缀？workflow provider/model 参数期待的格式）。
4. schemastery `Schema.dict` 确切写法。
5. 二期 `dsh-subagent` 服务 spawn API 签名（model 参数）。
6. `ctx.tools` 是否有注册表可查（probe.js 探测工具可用性的具体实现）。
7. `ctx.storage` 后端可用性的探测方式与异常形态。
8. 运行时注册 skill 与文件系统 skill 同名冲突时的优先级行为（omd 的模式 skill 用非前缀名 `autopilot`/`ralph`/`team` 以保证自然调用，需确认不会与其他插件/用户技能冲突或明确覆盖规则）。

## 8. 里程碑

- **M1（MVP）**：工程骨架 + 协议层 + 3 模式 + 6 角色 + 8-10 核心 skill + Config + /omd-doctor + /omd-cancel + 自带 MCP server（state/notepad/handoff/prd）+ omd_memory_* + 测试体系 + 本机实装冒烟。
- **M2**：全量 19 角色 + 40 skill 移植（双语）。
- **M3**：`omd_delegate` 硬路由工具、HUD 客户端面板、lsp/ast-grep 类工具评估、CAS 状态写、`.omd-workspace`/`$OMD_STATE_DIR`。
