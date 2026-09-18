# oh-my-dsh (omd) 设计规格

日期：2026-09-15（v2，经 4 路子代理源码级审查修订）
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
| 资产内容 | 全量移植 OMC 的 19 角色 + **39** skill（源码实测数量）；**双语**（中文/英文可选） |
| 实施节奏 | **先 MVP 再迭代** |
| 依赖边界 | ❌ 不依赖任何第三方 dsh 插件；✅ dsh 宿主原生包；✅ MCP（含 omd 自带 MCP server）；✅ 插件内自研工具 |

### 依赖边界细则

1. 运行时零第三方插件依赖——只 `inject` 宿主服务（`tools`/`skills`/`systemPrompt`/`commands`/`storage`）。
2. peerDependencies 只锁 `@deepseek-ai/dsh-*` 宿主包版本范围。
3. OMC 中由 MCP server / 外部 CLI 承担的功能，omd 里改为插件内原生实现或自带 MCP server。
4. 升级维护：用户只升级 omd 一个包；宿主 API 变化时由 omd 单方面适配（能力探测 + 降级，不版本硬锁死）。
5. 工具放置策略：需要访问 `ctx` 的放插件内工具；纯文件/进程操作放自带 MCP server（与 OMC/OMX 代码可复用、可跟随上游升级；其他宿主也能经 MCP 复用）。

---

## 1. 架构总览与能力映射

omd 的本质是 **编排协议（系统提示词）+ 资产目录（双语 skills/角色卡）+ 增强工具（自带 MCP server + 插件内工具）**。dsh 原生已具备 OMC 需要 hook 才能实现的能力（goal 续跑 ≈ Stop hook、ralph 工具、subagent），所以 omd 运行时逻辑很薄。

```
用户自然语言 ("autopilot 做一个 xxx")
        ↓
[omd 协议层] 静态 section（关键词路由表/委派规则/模型路由表/能力矩阵/状态契约）
           + 动态 context()（active-mode 快照、降级公告）——对应 OMX:RUNTIME overlay
        ↓
[omd 资产层] skill（双语）/ 角色卡（基础卡+档位 overlay）/ 模板 —— ctx.skills.register
        ↓
[dsh 原生执行层] goal / ralph / subagent / subagent_fork / workflow / todo_write
        ↓
[omd 状态层] .omd/ 项目目录（per-mode per-session state）+ ctx.storage（profile 级记忆）
```

### 能力映射矩阵（OMX 式分级）

| OMC 能力 | dsh 对应 | 分级 | omd 实现方式 |
|---|---|---|---|
| ralph 持久循环 | `ralph` 工具（宿主原生） | native | skill 资产 + 参数契约 |
| autopilot 自治流水线 | `create_goal`/`update_goal` 续跑（宿主原生） | native | skill 资产定义阶段协议 |
| team 编排 | `subagent`/`subagent_fork`/`workflow`/`send_message`/`list_agents`/`interrupt_agent`（宿主原生） | native | 协议段落 + 角色卡注入；五阶段流水线见 §3.3 |
| magic keyword 触发 | 无原生 hook；宿主原生 `dsh-hooks-claude-code` 桥支持 UserPromptSubmit + `additionalContext` 注入 | prompt 层（MVP）→ hooks 桥（二期） | MVP：systemPrompt section 关键词路由表 + 文本守卫；二期：经 hooks 桥做确定性检测 + 状态写入 |
| 19 角色 | `subagent` 工具 + prompt 注入 | native-partial | omd 内置角色卡库（注册为技能） |
| 模型路由三档 | workflow `agent()` 的 provider/model 参数 | native-partial | 插件 Config 映射；subagent 路径 MVP 期软路由（dsh subagent 无 model 参数 = 天生 forceInherit） |
| .omc/ 状态目录 | `.omd/` + omd 自带 MCP server 工具 | native-partial | 见 §5 |
| OMC 的 47+ MCP 工具 | — | 自带 MCP server + 自研 | MVP 移植 state(5)/notepad(6)/project_memory(4 语义移至插件内)；**自研** prd_*/handoff_*；lsp(12)/ast_grep/wiki/trace 等二期再议 |
| setup/doctor CLI | 不需要——插件安装即就绪 | 改进 | `/omd-doctor` 斜杠命令（诊断逻辑放 skill 资产，命令做薄转发壳，单一事实源——OMC commands/ 同款模式） |
| HUD 状态栏 | `dsh.client` 客户端槽位（宿主原生机制） | native | 二期 |
| Stop hook 续跑 | goal 原生续跑 | 不需要 | 省略（注：dsh Stop 事件支持阻断续跑，可作备选记录） |
| PreCompact 状态捕获 | dsh 无 PreCompact hook（桥实测只支持 7 事件，无 PreCompact/PostCompact/SessionEnd） | **文件恢复** | checkpoint 文件 + 协议层"恢复时读文件"（当前唯一可行路径） |

### 吸收的 OMX 移植经验

1. 能力探测 + 分级降级矩阵，且**探测结果驱动注册形态**（hooks 桥可用 → 二期注册确定性关键词 hook；不可用 → prompt 层兜底）。
2. `/omd-doctor` 验装命令（清单见 §6.3）。
3. 不污染用户文件（omd 是插件形态，天然满足）。
4. 协议层静态/动态分层（静态模板 + 运行时 overlay）。

### 与 OMC/OMX 的刻意分歧（如实记录）

| 分歧点 | OMC/OMX 做法 | omd 决策 | 理由 |
|---|---|---|---|
| 组合模式 | OMC 支持 `linked_ralph`/`linked_team` 双向状态链接；OMX 批准 team+ralph 共存 | **MVP 一律互斥** | 简单安全；组合模式列入三期 |
| ralph 语义 | Stop hook 同上下文续跑 | dsh fresh-agent 循环 | 宿主原生语义更干净，不模拟兼容 |
| `--workflow` 命名阶段配置 | autopilot 支持（4 种合法序列 + SHA-256 哈希） | **有意省略** | OMC 实现依赖 Linux flock，Windows 宿主不适用 |
| handoff_*/prd_* 工具 | 无对应物（纯文件约定 + Stop hook 强制） | **自研新增** | dsh 无 Stop hook 强制面，工具化保证格式稳定 |
| project_memory 归属 | `.omc/project-memory.json` 项目工作区文件 | **profile 层 ctx.storage**（key=项目路径哈希） | 换目录/机器不丢；代价是脱离项目 git 共享——如社区反馈需要可二期加回文件后端 |
| review skill 注册名 | `omc-review`（目录名≠注册名） | 改名为 `review` | omd 内统一命名 |
| state_write 字符串传输 | MCP 工具所有值按字符串传输，消费者自行 coerce | **有意修正为类型化参数** | 已知上游怪癖，不自找麻烦 |
| `<remember>` 标签捕获 | PostToolUse hook 解析模型输出文本 | **改为显式工具调用**指令 | dsh 无等价 hook 面；语义从"顺手打标签"变为"显式调用"，如实注明 |
| 自适应模型路由 | OMC v5.4 全员信号驱动自适应（lexical/structural/context 信号 + 升降档关键词） | **MVP 静态映射，自适应列二期** | 主动简化，非遗漏 |
| fable 档 / level 字段 / team.roleRouting | 第四档（Opus 上）/ 自主度 1-4 / 外部 CLI worker 路由 | **主动舍弃** | Claude 专属或外部 CLI 专属，dsh 不适用 |

### MVP 范围（第一期）

插件骨架 + 协议层 + 执行模式 3 件套 + 核心角色 **7** 个 + 核心 skill **10** 个 + 模型路由 Config + `/omd-doctor` + `/omd-cancel` + 自带 MCP server + `omd_memory_*`。

**MVP 7 角色**（源码 frontmatter 已核对）：`explore`(low)、`planner`(high)、`analyst`(high)、`executor`(medium)、`verifier`(medium)、`code-reviewer`(high)、`designer`(medium)。

**MVP 10 skill**（OMC v5.4.0 源码逐一核实存在）：`autopilot`、`ralph`、`team`、`deep-interview`、`ralplan`、`plan`、`execute`、`verify`、`review`（源码注册名 omc-review，改名）、`cancel`。

二期：HUD 面板、其余 29 skill / 12 角色全量移植、`omd_delegate` 硬路由工具、hooks 桥确定性关键词检测、自适应路由、sunset 技能继任机制、triage 建议路由、team worktree 隔离、skillify 经验提炼（参照 OMC mnemosyne 注入器）。

---

## 2. 插件工程结构

```
oh-my-dsh/                        # npm 包名 oh-my-dsh
├── package.json                  # dsh.bundle.patch → cordis.patch.yml；
│                                 # peerDependencies 锁 @deepseek-ai/dsh-* 版本范围
├── cordis.patch.yml              # 挂载 omd 主插件实例（MCP 挂载方式见 §7 待验证）
├── lib/
│   ├── index.js                  # apply(ctx, config)：注册协议段/动态context/skills/命令/工具
│   ├── protocol.js               # 静态 section：关键词路由表（注册表式）、委派规则、
│   │                             #   模型路由表、能力矩阵、状态契约（同步 text 函数）
│   ├── runtime.js                # ctx.systemPrompt.context()：active-mode 快照 + 降级公告
│   ├── keywords.js               # 关键词注册表数据（关键词/别名/目标/优先级/意图要求）
│   ├── skills.js                 # 遍历 assets/skills + assets/agents，ctx.skills.register（双语）
│   ├── commands.js               # /omd-doctor（薄壳→doctor skill）、/omd-cancel
│   ├── probe.js                  # 能力探测（健壮性契约见下）
│   └── tools/                    # 插件内自研工具：omd_memory_*
├── mcp-server/                   # 自带 stdio MCP server
│   ├── index.mjs                 # 入口（command 用 process.execPath，避开 Windows PATH 问题）
│   └── tools/                    # state_*, notepad_*, prd_*（自研）, handoff_*（自研）
├── assets/
│   ├── skills/                   # 每 skill 一个目录：SKILL.md + SKILL.zh.md
│   ├── agents/                   # 角色卡：<role>.md + <role>.zh.md
│   ├── overlays/                 # 档位 overlay 片段（low/medium/high × 双语，全局 3 档复用）
│   └── templates/                # .omd/ 骨架、prd.json 模板、handoff 模板等
├── client/                       # 二期：GUI 面板（届时补 package.json 的 dsh.client 字段）
└── docs/
```

### probe.js 健壮性契约（吸收 OMX codex-feature-probe 设计）

- 每次探测**有超时**（默认 3s）+ **有界输出**（≤4KB / ≤8 行）+ **模块级缓存**（同进程不重复探测）。
- 结果四态分类：`ok / unavailable / failure / timeout`，降级矩阵按态分支。
- 探测项：goal/ralph/subagent/workflow/ask_user_question 工具可用性、`ctx.storage` 后端、宿主版本 vs peerDep、`dsh-mcp-client` 服务、`dsh-hooks-claude-code` 桥可用性（为二期关键词 hook 探路）。
- 双输出：渲染进协议 section（模型可见）+ `/omd-doctor`（人可见）。不做成模型工具。

### 开发规范（来自本机踩坑记录，硬性要求）

1. 每个运行时 skill 注册必须带 `source: 'oh-my-dsh'` 和字符串 `content`（dsh-superpowers-zh 中途崩溃教训）。
2. systemPrompt `section()`/`context()` 的 text 若是函数必须**同步返回**（claude-bridge 教训）。
3. 工具 output schema 声明的字段不许返回 `null`；用 `undefined`/省略（git-workflow 教训）。
4. 工具错误返回模型可读文本，不抛裸异常。
5. 双语实现：按 Config `language: 'zh'|'en'|'both'` 在注册时选择内容；`both` = 中文正文 + 关键术语保留英文（实现时给出每种模式的示例）。
6. 构建：lib/ 和 mcp-server/ 用 esbuild 打成单文件；assets/ 原样发布。

---

## 3. 执行模式协议

### 3.0 硬约束（源码审查新增）

1. **模式启动权**：`create_goal` 拒绝 subagent 权限、`ralph` 要求 direct human——**autopilot/ralph 只能在主会话直接启动，禁止委派给队员**。team 以队员为主体，无此约束。
2. **ralph 前台阻塞**：调用期间主会话不能交互做别的；冲突场景 = "goal 续跑中收到 ralph 请求"，状态契约照此防嵌套。
3. **leaf-guard（OMC Worker Preamble / OMX NATIVE_SUBAGENT_LEAF_GUARD 的移植）**：dsh subagent 默认继承全部工具（可再 spawn），协议层和所有叶子角色卡必须写明"队员禁止再 spawn 孙代理、禁止编排命令"。
4. **team 无关键词触发**（OMC v5 源码刻意移除，防 worker 提示词里的 "team" 字样引发无限繁殖）：team 只做显式调用；**队员会话内整个关键词路由失效**（subagent prompt 是委派任务文本，不做模式触发）。
5. **关键词文本守卫**（吸收 OMC detector 防误触发机制，prompt 层能实现的部分）：仅当关键词是明确执行指令才激活；"什么是/怎么用/how to use" 等解释性提及不激活；引号内、代码块内、URL/文件路径内的关键词不激活；**粘贴的模式回显块（如 `[RALPH LOOP - ITERATION N]`）不激活**（防自激循环）。
6. **cancel 特殊地位**：只匹配 `cancelomd|stopomd`（故意不匹配裸 cancel/stop，防日常用语误触发）；不可被用户禁用；任何模式下可独占触发。

### 3.1 关键词路由表（注册表式，吸收 OMX keyword-registry 写法）

协议 section 内嵌此表（关键词/别名/目标/优先级/意图要求）：

| 优先级 | 目标 | 触发词 | 意图要求 |
|---|---|---|---|
| 1 | cancel | `cancelomd`、`stopomd` | 无（独占，永远优先） |
| 2 | ralph | `ralph` | **显式调用**：`ralph: <任务>`、"用 ralph 做…"、"run ralph" 等；裸词不匹配 |
| 3 | autopilot | `autopilot`、`full auto`、`全自动`、"帮我做一个 \<app\>" | 自然语言即可 |
| 4 | ralplan | `ralplan` | 显式调用 |
| 5 | deep-interview | `deep interview`、`深度访谈` | 自然语言即可 |
| 6 | review | `code review`、`代码评审` | 注入行内指引块（非完整 skill） |
| — | （退役词） | `ultrawork`、`ulw`、`uw`、`ccg` | 吞掉不触发，提示继任者（sunset 机制雏形） |

多关键词命中：按优先级排序全部执行，注入格式仿 OMC `[MAGIC KEYWORD: X]` 块（含目标 skill、回显压缩 ≤1200 字符、"立即开始"指令）。**命中即由模型立即写对应 state 文件**（prompt 层无法确定性写文件，协议要求模型第一步执行 state_write——二期 hooks 桥解决确定性）。

### 3.2 autopilot（→ dsh goal 机制）

阶段协议（对齐 OMC 源码数值契约）：
1. **Phase 0 Expansion**：`ask_user_question` 澄清；规格写 `.omd/plans/<topic>.md`。**衔接条款**：检测到 `.omd/plans/ralplan-*.md` 共识计划 → 跳过 Phase 0+1 直接执行；检测到 deep-interview 产出 → 跳过扩写；输入模糊 → 主动重定向 deep-interview。
2. **启动阈值**：单轮能完成的直接做，不开 goal。
3. **启动**：`create_goal(objective=规格摘要, max_goal_rounds=<上限>)`——dsh goal 原生支持轮次上限，协议要求**必须设置**（默认 10，对齐 OMC maxIterations）。
4. **循环体**：`todo_write` 拆任务 → `subagent`（executor 角色卡）背景并行 → 运行验证命令。
5. **Phase 4 三评审门**（OMC 源码：architect + security-reviewer + code-reviewer 全部必须批准；MVP 简化为 **verifier + code-reviewer 双评审**，安全相关变更协议要求升级深度）：全部通过 → `update_goal(complete)`。
6. **数值界限**：QA 循环 **≤5**；同一错误重复 **3** 次提前停；验证被拒后 re-validation **≤3** 轮；超限 → `update_goal(blocked, blocked_reason=具体条件+证据)`。
7. **取消/恢复**：`/omd-cancel` → `update_goal(pause)` + `state_clear`；plans/specs **保留**，再次运行 autopilot 即从中断处恢复（OMC resume 语义）。

配置面（进 Config）：`autopilot: { maxIterations: 10, maxQaCycles: 5, maxValidationRounds: 3 }`。

降级：goal 缺失 → `.omd/state/` 记进度 + 每轮结束提示用户输入 continue。

### 3.3 ralph（→ dsh ralph 工具）

1. **PRD 为结构化 `.omd/prd/<topic>.json`**（源码级修正：不是 markdown 勾选）：每条 story 含 `passes: boolean`、`acceptanceCriteria: string[]`（禁止泛化条目）、`architectVerified`（评审签字独立字段，模型不得自设）、`criteriaRevision`（完成声明绑定验收标准版本，防"改完标准再宣称完成"）、`criterionAmendments[]`（修订台账：原文保留 + reason + evidence，矛盾台账使 PRD 读时 fail-closed）。markdown 人读视图由 `prd_status` 工具渲染。
2. **调用**：`ralph(objective=PRD 路径 + 完成判据 + 证据契约, maxRounds)`。
3. **证据契约**：每轮必须运行验证命令并把原始输出写入交接报告，未运行不得置 `passes:true`。
4. **独立评审层**（源码审查修正——"证据约束代替 reviewer"不成立，OMC 两者都有）：全部 story passes 后，主会话 spawn **verifier 角色 subagent** 做独立评审（天然不同上下文），通过才置 `architectVerified` 并宣告完成。MVP 简化：单一 verifier pass；二期补分层（>20 文件/安全变更升级深度）和强制 deslop 步骤。
5. **stale 检测与和解**（对齐 OMC reconciliation）：`staleAfterMs: 7200000`（2h）；非正常退出后重启时输出 `[STALE PRD WARNING]`（未完成数、last-touched 年龄）；`observableChecks`（fileExists/fileContains）全部通过才允许自动 `passes:true`（保留 architectVerified:false）；每次和解追加 `.omd/prd/reconciliation.jsonl` 审计日志。
6. **progress.txt**：跨迭代学习/变更文件/代码模式记录，每轮追加（对齐 OMC Step 5b-5c）。
7. **熔断**：maxRounds 硬上限（达到即停）；stale state 超 2h 不自动续。

降级：ralph 缺失 → goal 驱动循环（create_goal + 每轮推进一条 story）；goal 也缺失 → 纯 PRD + 人工推进。

### 3.4 team（五阶段流水线，源码级重写）

**显式调用**（无关键词触发，见 §3.0-4）。canonical 流水线（对齐 OMC team SKILL）：

```
team-plan → team-prd → team-exec → team-verify → team-fix(有界) → complete/failed/cancelled
```

- **阶段角色路由**：team-plan = explore(low) + planner(high)；team-prd = analyst(high)；team-exec = executor(medium) 并行；team-verify = verifier(medium) 必跑，>20 文件/安全变更加 code-reviewer(high)。
- **team-fix 界限**：`max_fix_loops = 3`，超限 → terminal failed。
- **阶段交接 handoff 强制约定**：每阶段完成必须写 `.omd/handoffs/<stage>.md`（格式：Decided/Rejected/Risks/Files/Remaining，10-20 行上限），下一阶段 spawn 前必读并注入队员 prompt。
- **Worker 协议**：claim→work→complete→report→next→shutdown 六步 + leaf-guard 禁令 + 阻塞任务跳过规则。
- **Watchdog**（dsh 无定时器面，协议层实现）：队员长时间无消息 → 队长下次活跃时 `list_agents` 核查 + `send_message` 询问；判定死亡 → 重新分配；队员连续失败 2+ 任务 → 停止分配。（OMC 的 5min/10min 阈值在 dsh 消息驱动模型下改为事件驱动语义，如实注明差异。）
- **关闭协议**：队长发 shutdown 指令 → 等队员确认 → 全部确认后 `state_clear`。
- **协调**：默认背景 spawn、`send_message` 转向、`list_agents` 盘点、等待时 yield 不轮询；同质任务扇出 ~5+ → 改用 `workflow`（模型路由硬生效）。

降级：subagent 缺失 → 主会话顺序执行，协议标注"单代理模式"。

### 3.5 模式间协作契约

- **MVP 一律互斥**（与 OMC linked_ralph 的刻意分歧）：任一模式 active 时不得启动另一模式；team 运行中不得启动 autopilot/ralph。
- 状态文件是唯一事实源：模式启动前必读 state（见 §5.1）；完成/取消时 `state_clear`；plans/prd/handoffs/checkpoints 保留供追溯与恢复。

---

## 4. 角色目录 + 模型路由

### 4.1 角色卡机制与格式（源码级修正）

角色注册为 modelInvocable 技能（`omd-agent-<name>`），委派前 `skill` 工具懒加载。**dsh subagent 的最后一条 assistant 消息即交付物**——与 OMC `<Final_Response_Contract>` 语义精确对应，角色卡必须含此段。

角色卡 = **基础卡（双语）+ 档位 overlay（双语，3 份全局复用）** 拼接渲染（吸收 OMX POSTURE_OVERLAYS 机制：双语 × 档位不必维护多份文件）。

基础卡结构（对齐 OMC agents/*.md 的 11 段格式）：

```markdown
---
name: omd-agent-executor
description: 实现型队员——接到明确任务后写代码、跑验证、报告结果
tier: medium
tools: execution          # read-only|analysis|execution|data（OMX 式；dsh 无法强制，仅 prompt 渲染依据）
whenToUse: 委派实现/修复类任务前加载本卡
---
<Role> / <Why_This_Matters> / <Success_Criteria> / <Constraints>（含只读角色的 prompt 级工具约束 + leaf-guard）
<Investigation_Protocol> / <Tool_Usage> / <Execution_Policy>（含按档位的行为强度指引——workflow 拒绝 effort 参数，effort 只能 prompt 级）
<Output_Format> / <Failure_Modes_To_Avoid> / <Examples>
<Final_Response_Contract>：最后一条消息即交付物，禁止 "done" 式空洞收尾
<Final_Checklist>
```

**能力落差如实注明**：OMC 9 个只读角色靠宿主 `disallowedTools` 强制只读；dsh subagent 无工具限制参数，omd 只能 prompt 级约束（二期 `omd_delegate` 自研工具可评估强制面）。OMC frontmatter `level: 1-4`（自主度）主动舍弃。

**上下文成本权衡**：每个注册技能以"名称+摘要"常驻每轮技能目录。MVP 7 角色 + 10 skill ≈ 17 行可接受；全量 19+39=58 行成本显著——缓解：① description 限一行；② 备选：改为 `omd_role(name)` 工具按需取模板（不进目录）。

### 4.2 模型路由分层

| 委派路径 | 路由能力 | 策略 |
|---|---|---|
| `workflow` 的 `agent()` | ✅ 硬路由（provider/model 参数） | 协议层给出当前生效"角色→模型"解析表，照表填参 |
| `subagent`/`subagent_fork` | ❌ 无 model 参数，继承主会话（= OMC `forceInherit` 的天生对应物） | MVP 软路由：角色卡写建议档位，协议如实告知不生效 |
| 二期 `omd_delegate` 自研工具 | ✅ 硬路由 | `inject: ['subagents']`，用宿主 dsh-subagent 服务 spawn 指定 model（agent_teams 插件实证此路径） |

### 4.3 Config schema（schemastery）

```js
Config = Schema.object({
  language: Schema.union(['zh', 'en', 'both']).default('zh'),
  tiers: Schema.object({
    low:    Schema.string().default('deepseek-chat'),
    medium: Schema.string().default('deepseek-chat'),
    high:   Schema.string().default('deepseek-reasoner'),
  }).description('档位→模型映射；值可为模型标识或 "inherit"（继承主会话——吸收 OMC modelAliases 思想）'),
  roleOverrides: Schema.dict(Schema.string()).default({}),
  stateDir: Schema.string().default('.omd'),
  autopilot: Schema.object({
    maxIterations: Schema.number().default(10),
    maxQaCycles: Schema.number().default(5),
    maxValidationRounds: Schema.number().default(3),
  }),
})
```

解析顺序：`roleOverrides[role]` > `tiers[role.tier]`；值 `'inherit'` → 委派时不填 model。解析结果渲染进协议 section（当前生效路由表），改配置 → cordis 重放 → section 更新（重放语义见 §7 待验证）。

如实注明：OMC 的 env 覆盖层（OMC_MODEL_* 等）在 dsh 场景不常用，**主动舍弃**；OMC v5.4 的信号驱动自适应路由列二期。

### 4.4 委派规则段（协议层组成部分）

何时委派、加载哪个角色卡、照路由表填 model、默认背景并行、不重复委派同一工作、等待时 yield、leaf-guard、队员会话禁关键词触发。

---

## 5. 状态持久化（源码级重写）

### 5.1 两层数据归属 + per-session 隔离

| 层 | 位置 | 内容 | 读写方式 |
|---|---|---|---|
| 项目层 | 会话 cwd 下 `.omd/` | 模式状态、plans、prd、handoffs、checkpoints、notepad、logs | omd 自带 MCP server 工具；文件人类可读，模型也可用普通文件工具直接操作 |
| profile 层 | `ctx.storage` | 跨会话项目记忆（key=项目路径哈希）、用户偏好 | 插件内工具 `omd_memory_set/get/delete` |

**关键修正（dsh web 多会话共享 cwd 是常态，单文件必互相踩踏）**：模式状态按 OMC 源码结构 **per-mode + per-session** 隔离：

```
.omd/
├── state/
│   ├── sessions/{sessionId}/
│   │   ├── autopilot-state.json     # per-mode 文件，含 _meta:{mode,sessionId,updatedAt,updatedBy}
│   │   ├── ralph-state.json         #   字段契约：active, started_at, current_phase, session_id,
│   │   │                            #   iteration/max_iterations, awaiting_confirmation, 原始prompt(压缩)
│   │   ├── team-state.json
│   │   └── prd.json                 # ralph 活跃 transient PRD（会话作用域）
│   └── boulder.json                 # 当前活跃计划 + checkbox 进度（独立于模式状态的第二维度）
├── plans/          # autopilot 规格、ralplan 共识计划（ralplan-*.md）
├── specs/          # deep-interview 产出（deep-interview-*.md）
├── prd/            # <topic>.json + reconciliation.jsonl + progress.txt
├── handoffs/       # 【team 阶段交接】<stage>.md（Decided/Rejected/Risks/Files/Remaining）
├── checkpoints/    # 【压缩恢复】模式 state 关键字段快照 + todos——与 handoffs 是两个概念
├── notepad.md      # 三区结构（见 §5.3）
└── logs/
```

**会话所有权强制**（对齐 OMC state-tools）：state 带 `_meta.sessionId`，工具拒绝跨会话写（"owned by session X"）；`state_list_active`/`state_get_status` 提供跨会话只读视图（协议层判嵌套用）。

### 5.2 工具清单

**MCP server**（纯文件操作，参数类型化——有意修正 OMC 的字符串传输怪癖）：
- `state_read`/`state_write`/`state_clear`/`state_list_active`/`state_get_status`
- `notepad_read`/`notepad_write_priority`/`notepad_write_working`/`notepad_write_manual`/`notepad_prune`/`notepad_stats`
- **自研** `prd_check`/`prd_uncheck`/`prd_status`/`prd_amend`（结构化操作 prd.json：勾选、修订台账追加、markdown 视图渲染）
- **自研** `handoff_write`/`handoff_read`/`handoff_list`（team 阶段交接格式稳定性）

**插件内工具**（需 ctx）：`omd_memory_set`/`omd_memory_get`/`omd_memory_delete`。

**明确不做**（YAGNI/二期）：lsp_*(12)、ast_grep、python_repl、wiki(7)、trace、shared_memory、merge_readiness、skills 管理工具、session_search、state_migrate_non_git、better-sqlite3。

### 5.3 notepad 三区结构（源码修正）

```
## Priority Context   —— 永久（<remember priority> 等价物）
## Working Memory     —— 7 天自动过期（notepad_prune / 写入时惰性清理）
## MANUAL             —— 用户内容，永不清理
```

OMC 的 `<remember>` 标签靠 PostToolUse hook 解析模型输出；dsh 无此 hook 面，**omd 改为协议层指令**："要记忆时显式调用 notepad_write_working / notepad_write_priority"。

### 5.4 与原生机制衔接

- **goal 续跑**：每轮结束更新 `{mode}-state.json`；会话恢复后读 state 定位；**必须设 max_goal_rounds**（防无上限轮次）。
- **压缩恢复**（dsh 无 PreCompact hook，文件恢复是唯一路径）：协议要求模式关键节点写 `checkpoints/` 快照；恢复后模型读 checkpoint + state 重建现场。
- **取消语义**：`state_clear` 清 state（dsh 场景简化：goal pause + 删 state 即可；OMC 的 cancel-signal 30s TTL + SHA-256 寻址是 Stop-hook 架构特产，不移植）；plans/prd/handoffs/checkpoints **保留**（resume 依赖）。
- **stale 检测**：state 超 2h 未更新视为腐烂，恢复时提示而非自动续跑。

### 5.5 并发与安全

- 文件写一律 tmp+rename 原子写。
- MVP：`state_write` 写前读检查 + 会话所有权强制（多数场景队长单写）；二期 compare-and-swap。
- `.omd/` 首次写入时检测并提示加 .gitignore，不擅自改用户文件。
- MCP server 生命周期由宿主 dsh-mcp-client 回收。

---

## 6. 错误处理、降级矩阵与测试

### 6.1 降级矩阵

probe.js 探测结果渲染进协议 section（模型每轮可见能力边界），按四态（ok/unavailable/failure/timeout）分支：

| 探测项 | 缺失时降级 |
|---|---|
| `create_goal`/`update_goal` | autopilot → 手动循环：state 文件记进度 + 提示用户输入 continue |
| `ralph` | → goal 驱动循环 → 纯 PRD + 人工推进 |
| `subagent`/`workflow` | team → 主会话顺序执行；模型路由整体失效，协议标注"单代理模式" |
| `ask_user_question` | 澄清提问 → 纯文本提问 |
| `ctx.storage` 后端异常 | 项目记忆 → `.omd/memory.json`（丢失 profile 级共享，协议注明） |
| MCP server 启动失败 | state/notepad/prd/handoff 缺失 → 协议教模型用普通文件工具直接操作 `.omd/` |
| `dsh-hooks-claude-code` 桥不可用 | 仅影响二期关键词 hook；MVP 无感 |
| 宿主版本低于 peerDep 下限 | warning 日志 + doctor 标红，不拒绝加载（尽力而为） |
| **核心 inject 服务缺失**（tools/systemPrompt） | **例外：启动即报错**——根本无法工作时不静默降级 |

### 6.2 错误处理原则

1. 静默失败是头号敌人：任何降级必须可见（协议 section + 动态 context() 公告 + 首次触发时模型主动告知）。
2. 工具错误返回模型可读文本；output schema 字段不返回 null。
3. MCP server：`failOnStartupError: false` + reconnect 交宿主 mcp-client。
4. state 文件是唯一恢复入口，任何模式启动前先读它；stale（>2h）不自动续。

### 6.3 `/omd-doctor` 检查清单（吸收 OMX doctor ~30 项的适用子集）

- 宿主版本 vs peerDep 范围
- inject 服务可用性（核心服务缺失 = 启动已报错，doctor 复核）
- **注册计数核对**：skill/命令/工具实际注册数 vs 预期数（7 角色 + 10 skill + 2 命令 + 3 omd_memory + MCP 工具数）
- **Config 解析验证**：tiers/roleOverrides 的模型标识符能否在宿主 LLM 服务解析
- **MCP server spawn 冒烟**（真实握手一次；doctor 不证明端到端可用——E2E 是独立发布门禁）
- `.omd/` 可写性 + .gitignore 状态
- profile patch 分层正确性（`dsh --dump-config` 展开验证）
- probe 各探测项四态结果一览

### 6.4 测试策略

| 层 | 内容 | 工具 |
|---|---|---|
| 单元 | state 原子写/会话所有权、prd.json 解析与台账、notepad 三区与过期、路由解析（含 inherit）、双语选择、配置 schema、关键词注册表数据完整性 | vitest，CI 跑 |
| 集成（离线） | mock ctx 上 apply：注册计数、section/context 渲染、探测降级路径四态分支 | vitest + 手写 mock ctx |
| 集成（真实宿主） | `dsh --dump-config` 验证 patch 展开；本机 web profile 实装冒烟 | 脚本/手动 |
| E2E（真实会话） | autopilot 写个小脚本（含双评审门）、ralph 过 2 条 story（含 verifier 独立评审）、team 走完五阶段流水线 | **发布前人工门禁**（耗 token、依赖用户模型配置，不进 CI） |
| 回归防线 | probe 各探测项逐个置缺失，验证降级不崩 | vitest |

发布门禁：单测全绿 + `--dump-config` 正确 + 本机 profile 实装 doctor 全绿 + 三模式 E2E 各过一次。

已知局限（如实声明）：mock ctx 按调研 API 形状手写，宿主 API 变化时 mock 不会自动发现——真实防线是 peerDep 范围 + 真实宿主冒烟。

---

## 7. 实现期验证清单（M1 实测结论已回写，2026-09-15）

1. ✅❌ **MCP 挂载**：静态 patch.yml 无法可靠引用包内绝对路径 → **采用运行时动态挂载**：`ctx.plugin({name,inject,Config,apply}, config)`（cordis 源码实证，fiber 生命周期随 omd 回收）。mcp-client 插件名 `mcp-client`，Config 逐字段核验（serverName 正则 `^[A-Za-z0-9_-]{1,32}$`）；工具命名 `mcp__omd-state__<raw>` 实证。
2. ✅ **Config 变更重放**：cordis `Fiber.update() → restart()` = 完整 dispose + 重跑 apply（源码实证），协议段随配置自动更新；dispose 链支持 async（domain close 安全）。
3. ⏳ **模型标识符格式**：待 E2E 实测（workflow provider/model 参数期待的格式）。
4. ✅ **schemastery**（v3.18.2 源码核验）：`z.const/z.natural/z.dict/z.object/z.union/.default/.description` 全部存在；**schema 本身可调用，无 `.parse`**（已加别名）；校验失败抛 `Schema.ValidationError`。
5. ⏳ `dsh-subagent` 服务 spawn API（二期 `omd_delegate` 前置，M1 未触及）。
6. ✅（决策变更）**工具枚举**：不做宿主工具注册表探测——inject 保证的服务直接 ok，可选能力用存在性检查 + Config 覆盖兜底。
7. ✅ **ctx.storage 真实 API**（三包源码核验）：`ctx.storage.domain.open(defineDomain({name, version, tables}))` → `domain.table(name)` → KvTable（`get` 同步、`put/delete` 异步）；**域名/表名正则 `^[a-z][a-z0-9_]*$`（连字符非法）**——omd 用 `oh_my_dsh` 域名 + `memory` 表；Domain 句柄经 `ctx.effect` 注册 close。
8. ⏳ skill 同名冲突优先级（E2E 观察项）。
9. ✅ **systemPrompt**：`section({name, order, text})` 与 `context({name, order, text})` 均存在，**order 强制有限数**（omd 用 100/130）；text 函数**同步求值不 await**（实证）；`{{var}}` 严格插值（protocol 输出须避免 `{{` 序列）。
10. ✅（存在性）`dsh-hooks-claude-code` 是宿主原生包，支持 UserPromptSubmit 等 7 事件 + `additionalContext` 注入；默认未挂载于 profile。二期关键词 hook 走此桥。
11. ⏳ 压缩后 section/context 保留行为（E2E 观察项）。

**实装中暴露并修复的 bug**：apply() 曾用存在性（`if (ctx.storage)`）而非 probe 结论门控记忆工具注册，storage failure 形态下 `domain.open` 抛错导致插件崩溃——已修复为 `probeReport.storage.status === 'ok'` 门控（附回归测试）。

## 8. 里程碑

- **M1（MVP）**：工程骨架 + 协议层（静态 section + 动态 context + 关键词注册表）+ 3 模式（含 team 五阶段流水线、ralph 结构化 PRD + verifier 独立评审、autopilot 数值界限与双评审门）+ 7 角色（11 段格式 + 档位 overlay）+ 10 skill + Config + /omd-doctor + /omd-cancel + 自带 MCP server（state 5 + notepad 6 + prd 4 + handoff 3）+ omd_memory_* + 测试体系 + 本机实装冒烟。
- **M2**：其余 29 skill / 12 角色全量移植（双语）；sunset 技能继任机制；triage 建议路由。
- **M3**：`omd_delegate` 硬路由工具；hooks 桥确定性关键词检测 + 状态写入；自适应路由；HUD 面板；team worktree 隔离与确定性任务状态文件；CAS 状态写；组合模式（linked_ralph 类）；`.omd-workspace`/`$OMD_STATE_DIR`；skillify 经验提炼。
