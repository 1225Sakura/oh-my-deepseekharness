---
name: design
description: 仓库本地 DESIGN.md 工作流——产品、UI/UX 与前端决策的权威来源
when-to-use: 产品、UX、前端或 design-system 决策需要仓库本地的权威来源；feature 在进入 designer 通道或实现之前需要设计简报；已有 UI、资产、截图或约束需要可执行的设计摘要。不用于对视觉参考做像素级还原，或无用户可见设计影响的后端/基础设施工作。
---

# design（设计）

用本技能发现产品与 UI 证据、只补齐设计关键的信息缺口，并创建或刷新仓库的持久 `DESIGN.md` 契约。它是持续维护的设计简报，不是像素还原循环或一次性点评。它与 `omd-agent-designer` 角色卡互补：本技能持有持久设计契约，designer 角色在契约内做执行级的 UI 工艺。

## 何时使用

- 产品、UX、前端或 design-system 决策需要仓库本地的权威来源。
- feature 在进入 designer 通道或实现之前需要设计简报。
- 已有 UI、资产、截图或约束需要可执行的设计摘要。

不用于：视觉参考实现比对（见下文"与视觉 QA 的关系"）、单纯截图对比、无用户可见设计影响的后端/基础设施工作。

## 与视觉 QA 的关系

本技能在 `DESIGN.md` 中持有产品目标、用户、信息架构、视觉语言、组件、可访问性、约束与 open questions。对已批准视觉参考做实现比对——带量化的裁决与 pixel-diff 证据——是另一条通道：**OMX 的 `$visual-ralph` 在 dsh 下无直接对应面**；最接近的是 dsh 视觉工具（`vision_html_screenshot`、`vision_pixel_diff`、`vision_ground`）加 `visual-verdict` skill 的结构化打分/裁决循环。两者都需要时先跑本技能；`DESIGN.md` 支撑但不取代视觉裁决目标。

## 流程

### 1. 发现本地证据

检查并引用：已有 `DESIGN.md`、design/UX/frontend 文档、README/specs/issues、routes/pages/layouts/components/stories、theme 与 token 文件、资产、截图/稿图、Storybook 或 Playwright 基线、可访问性/响应式/i18n/平台约束——用 `glob` / `grep` / `read` 定位。区分观察与推断；注明缺失的证据。

### 2. 只访谈缺失的上下文

只对仓库无法回答的缺口提简洁问题：用户/任务、目标/非目标、品牌个性与禁忌美学、主流程、可访问性/设备/浏览器目标、不可得的资产/参考。若答案不可得，记录显式假设与 open questions，不阻塞。

### 3. 创建或刷新 `DESIGN.md`

保留有用内容、消除矛盾、标记未知项、保持决策可执行。根目录文件必须包含以下小节：

```
# Design
## Source of truth
状态（Draft | Active | Needs refresh）、日期、产品面、已审阅证据。
## Brand
个性、信任信号、禁忌。
## Product goals
目标、非目标、成功信号。
## Personas and jobs
主要 persona、用户任务、使用场景。
## Information architecture
导航、路由/页面、内容层级。
## Design principles
原则与权衡。
## Visual language
色彩、排版、间距、形状/层级、动效、图像/图标。
## Components
已有/新增组件、变体/状态、token 归属。
## Accessibility
目标标准、键盘/焦点、对比度、语义、reduced motion/感官考量。
## Responsive behavior
断点/设备、布局适配、触屏/悬停差异。
## Interaction states
Loading、empty、error、success、disabled，适用时含 offline/弱网。
## Content voice
语气、术语、microcopy 规则。
## Implementation constraints
框架/样式方案、token、性能、兼容性、测试/截图预期。
## Open questions
`[ ]` 问题、owner、影响。
```

### 4. 应用契约

做 UI 决策前引用相关 `DESIGN.md` 小节，复用已记录的组件/token；实现暴露矛盾时更新文件或追加 open question。不要另起一套并行的 design-system 层。实现被委派时，把相关 `DESIGN.md` 小节作为约束性上下文交给 `omd-agent-designer` 角色卡。

### 5. 交接

常规前端工作：提供相关小节、仓库证据与验收标准。视觉参考、图片或 live-URL 比对：带着已批准的基线交接给视觉 QA 通道（`visual-verdict` skill + dsh 视觉工具），并注明 `DESIGN.md` 仅作支撑上下文。

## 证据与完成

仅当以下条件全部满足才算完成：设计文档/资产/组件/截图已检查或已注明缺失；缺失上下文已回答、已假设或已列出；根目录 `DESIGN.md` 包含全部必需小节；建议引用了它；任何视觉 QA 交接与设计治理清晰分开。

## 状态契约

本技能**不持模式状态**：`DESIGN.md` 本身就是持久产物，放在仓库根目录而非 `.omd/` 下。值得保留在仓库之外的跨会话设计决策写 `mcp__omd-state__notepad_write_priority` / `notepad_write_working`。
