---
name: visual-verdict
description: 结构化视觉 QA 裁决——把生成的 UI 截图与参考图对比，返回严格 JSON 裁决（分数、pass/revise/fail、差异、建议），驱动下一轮编辑迭代
when-to-use: 任务带视觉保真要求（布局、间距、字体排印、组件样式），手头有生成截图加至少一张参考图，且需要确定性的过/不过指引再继续改。视觉任务的每一轮迭代、下一次编辑之前都要跑它。
---

# visual-verdict —— 结构化视觉 QA

把生成的 UI 截图与参考图对比，返回驱动下一轮编辑迭代的严格 JSON 裁决。

**工具映射（dsh 现实面）。** 截图来自 **browser-skill 插件**（`browser_*` 工具——用托管 Agent Window 打开页面并截图）或用户提供的文件。参考图与生成图都用 **`read_image` 工具**查看（PNG/JPEG/WebP/GIF）。OMC 的调用形态（`/oh-my-claudecode:visual-verdict`、pixelmatch 叠加工具）映射为：本技能的循环 + 用户装有图像工具时经 `pwsh` 的可选像素 diff（仅次要调试手段——内置 diff 工具属二期）。

## 输入

- `reference_images[]` —— 一张或多张参考图路径
- `generated_screenshot` —— 当前产出图
- 可选 `category_hint`（如 `dashboard`、`sns-feed`、`landing`）

## 输出契约

**只返回 JSON**，形状严格如下：

```json
{
  "score": 0,
  "verdict": "revise",
  "category_match": false,
  "differences": ["..."],
  "suggestions": ["..."],
  "reasoning": "short explanation"
}
```

- `score`：整数 0–100
- `verdict`：`pass` | `revise` | `fail`
- `category_match`：截图匹配目标 UI 类别/风格时为 `true`
- `differences[]`：具体视觉差异（布局、间距、字体排印、颜色、层级）
- `suggestions[]`：与差异一一对应的可执行下一步修改
- `reasoning`：1–2 句总结

## 阈值与循环

- 通过阈值 **90+**。
- `score < 90`：继续改、重新截图（browser-skill）、再跑 visual-verdict，之后才能做任何进一步的视觉评审。
- 下一张截图没过线之前，**不得**宣称视觉任务完成。
- 每份裁决 JSON 存到 `.omd/visual-verdict/<ISO-时间戳>.json`，让迭代轨迹扛得住压缩；在 ralph/autopilot 流程内运行时，把最新裁决文件作为证据引用。

## 调试可视化

差异难以定位时：

1. visual-verdict 的裁决仍是权威判定。
2. 经 `pwsh` 用像素级 diff 工具（pixelmatch 叠加、ImageMagick `compare`……）做**次要**辅助定位热点——前提是用户已装此类工具。
3. 把像素 diff 热点翻译成具体的 `differences[]` / `suggestions[]` 更新。

## 示例

```json
{
  "score": 87,
  "verdict": "revise",
  "category_match": true,
  "differences": [
    "顶部导航间距比参考图更紧",
    "主按钮字重偏小"
  ],
  "suggestions": [
    "导航项水平 padding 加 4px",
    "主按钮 font-weight 设为 600"
  ],
  "reasoning": "核心布局已对齐，样式细节仍有偏差。"
}
```

## 状态契约

visual-verdict **不持 omd 模式状态**：无 `state_write`/`state_clear`。唯一的持久产物是 `.omd/visual-verdict/` 下的裁决 JSON 文件。它自己绝不改 UI 代码——它只裁决；编辑循环属于调用方（autopilot/ralph/直接干活）。
