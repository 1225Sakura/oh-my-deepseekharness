# dsh 0.1.5 → 0.1.7-rc.1 适配审计报告

> 生成：2026-09-24 ｜ 执行者：autopilot（goal-4b32f166）｜ 依据：.omd/plans/ralplan-dsh-017-adapt-cleanup.md 步骤 1
> 方法锚点：dsh 自带迁移模块文档（v0→v1→v2→v3→v4 全链，均随宿主 0.1.7-rc.1 捆绑）+ 本会话实证 + profile 文件系统证据
> 状态：**审计收敛**（五面锚点齐全，触发计划 1.2 退出条件）

## 1. Profile 全量枚举（AC8）

| Profile | omd 依赖钉法 | omd 实装 | 结论 |
|---|---|---|---|
| `~/.dsh/profiles/web` | `^0.2.3`（npm；0.x caret 永远拉不到 0.4.0） | **0.2.3**（落后 repo 0.4.0 两个 minor） | 需切 ^0.4.1；含 omd 残留 1 件 |
| `~/.dsh/profiles/headless` | 无（0 依赖） | 无 | **新增安装**而非切换；是否纳入部署面由用户在步骤 5.3 裁定 |
| `profiles/node_modules`（游离） | — | — | 187 项（121 可达 / **66 断链**），非 profile，仅入册 |

### .bak 残留全量盘点（13 件 = omd 1 + 第三方 12，6 家族）

| 归属 | 文件 | 性质 |
|---|---|---|
| **omd** | `@sakura12/oh-my-deepseekharness/lib/hook.js.bak-source-string-2026-09-24` | **修复证据**（见 §3），回流确认前不得删除 |
| dsh-vision-router | 7 件（4×bak-v4-plugin-kind + 2×bak-settings-register + 1×bak-settings-scope） | 第三方热补丁，只入册不动 |
| dsh-plugin-claude-bridge | 2 件（bak-async-text + bak-encode-path） | 同上 |
| dsh-file-mount | 1 件（bak-v4-plugin-kind） | 同上 |
| dsh-sidebar-qa | 1 件（bak-v4-plugin-kind） | 同上 |
| dsh-plugin-git-workflow | 1 件（bak-exitcode-null） | 同上 |
| @zhangfengshun/dsh-remote-ssh | 1 件（bak-settings-register） | 同上 |

## 2. 五面变更比对（AC1）

| 面 | 0.1.5→0.1.7-rc.1 变更 | 对 omd 影响 | 证据 |
|---|---|---|---|
| **Session format** | **v4 引入（0.1.7 线）**：native admission 拒绝四种 source 形态——①source 非对象 ②无 kind ③kind 空 ④kind==='plugin'（同一报错文本）；retired plugin wrapper 仅在 v3→v4 迁移时转换；消息持久化走 zstd v4（`session.v4.jsonl.zstd`） | **致命**——omd hook 注入裸字符串 source，携带该消息的会话在 dispose/持久化阶段抛 SessionFormatError | `dsh-session-format-v3-to-v4/lib/index.js:126`、`dsh-session-format` 全家 0.1.7-rc.1、本会话 subagent 崩溃实录 |
| **插件 API（cordis 4.0.4）** | omd peer ranges `>=0.1.6-alpha.1 <0.2.0` 已覆盖 0.1.7-rc.1；apply 返回契约未变（仅 dispose/null） | 无 | omd package.json peerDependencies 实测比对 |
| **Hook 事件（agent/pre-step）** | 拦截点工作正常 | 无（live 验证：本会话关键词预写状态 + 注入均生效） | 本会话 /deep-interview 触发链 |
| **Skills 加载** | 44 技能目录条目全部可见可加载 | 无 | 本会话 available_skills 目录 |
| **Delegate/subagent 通道** | 通道本身可用；失败根因在 session format 面（见 §3） | 间接——修复后 5/5 派发成功 | 本会话 Planner/Architect/Critic 全部成功 |

## 3. 根因结论（法医路径，AC1 核心）

**真缺陷：repo `lib/hook.js:189` 的裸字符串 source。**

```
// repo HEAD（坏形态）——
const context = createUserMessage({ content: [...], source: HOOK_SOURCE })
// installed 热补丁（好形态，2026-09-24T06:44Z 施加）——
const context = createUserMessage({ content: [...], source: { kind: HOOK_SOURCE } })
```

证据链：
1. v4 admission（v3-to-v4 index.js:126）对「source 非对象」抛出与 plugin-kind 同文本的 SessionFormatError——**spec"仅 plugin-kind 被拒"系误读，此处勘误**。
2. grep 实证：omd repo HEAD 与 installed 0.2.3 **零 plugin-kind producer**；唯一会话消息注入点 = hook.js:189（skills.js:53/73、hook.js:81 的裸字符串均为元数据，不进会话消息流）。
3. 时间线：`.bak` mtime 09-23T08:34（原形态备份）→ 热补丁 09-24T06:44 → 本会话早期 subagent 两次失败（补丁前）→ Planner/Architect/Critic 五次派发全成功（补丁后）。R4"间歇性"由此完全解释。
4. 热补丁从未回流 repo——**真源当前不是真相**（计划 P4 宗旨违反，回流即步骤 2）。
5. plugin-kind 形态在生态中真实存在但与 omd 无关；其 v4 合法范式已由 file-mount diff 提取：`kind: "plugin"` + `plugin: "file-mount"` → `kind: "plugin:file-mount"`（producer 命名空间化）。omd 读侧（hook.js:132）为宽容过滤、不产出消息，无需防御性改动——判定线"是否进入会话消息流"。

**Legacy session 结论**：会话文件为 zstd 压缩 v4（文本 grep 不可见，需解压）；当前主会话在 0.1.7 上正常运行即活体证明；旧格式会话经捆绑迁移链（v0→v1→v2→v3→v4）打开；裸字符串消息在**写入侧**被拒（热补丁后不再产生新污染），历史已持久化内容经迁移链保留。

## 4. 向后兼容裁决（spec 推迟项，在此定案）

**决定：不做 0.1.5/0.1.6 向后兼容。0.4.1 起要求 dsh >= 0.1.7-rc.1。**

理由：v4 admission 在宿主侧不可绕行（plugin 消费方无豁免通道）；支持旧宿主需双形态探测且无可测旧环境；0.1.7-rc.1 已是用户现役宿主。配套动作（步骤 2 内执行）：README 要求行改为 dsh 0.1.7-rc.1+；peerDependencies 六个 dsh 包从 `>=0.1.6-alpha.1 <0.2.0` 收紧为 `>=0.1.7-rc.1 <0.2.0`（六包同口径）。

## 5. 交接步骤 2

- 修复落点：`lib/hook.js:189` 一行回流 `source: { kind: HOOK_SOURCE }`（与 installed 热补丁逐字一致）
- 回归测试：模拟 v4 admission 四拒绝分支，断言 hook 产出 `{ kind }` 对象形态
- 防御性 plugin-kind 转换：**取消**（读侧无产出点，grep 已定点，无落点即无改动——最小 diff 纪律）
- peer/README 收紧：随 0.4.1 一并落地
