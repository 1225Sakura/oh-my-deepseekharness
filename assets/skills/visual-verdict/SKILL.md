---
name: visual-verdict
description: Structured visual QA verdict — compare a generated UI screenshot against reference images and return a strict JSON verdict (score, pass/revise/fail, differences, suggestions) that drives the next edit iteration
when-to-use: The task has visual fidelity requirements (layout, spacing, typography, component styling), you have a generated screenshot plus at least one reference image, and you need deterministic pass/fail guidance before continuing edits. Run it every iteration of a visual task, before the next edit.
---

# visual-verdict — structured visual QA

Compare generated UI screenshots against reference images and return a strict JSON verdict that drives the next edit iteration.

**Tool mapping (dsh reality).** Screenshots come from the **browser-skill plugin** (`browser_*` tools — navigate the managed Agent Window to the page and capture a screenshot) or any user-supplied file. Both reference and generated images are inspected with the **`read_image` tool** (PNG/JPEG/WebP/GIF). OMC's invocation form (`/oh-my-claudecode:visual-verdict`, pixelmatch overlay tooling) maps to: this skill's loop + optional pixel-diff helpers via `pwsh` when the user has image tooling installed (secondary debug aid only — phase-2 for a bundled diff tool).

## Inputs

- `reference_images[]` — one or more image paths
- `generated_screenshot` — current output image
- Optional `category_hint` (e.g. `dashboard`, `sns-feed`, `landing`)

## Output contract

Return **JSON only** with this exact shape:

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

- `score`: integer 0–100
- `verdict`: `pass` | `revise` | `fail`
- `category_match`: `true` when the screenshot matches the intended UI category/style
- `differences[]`: concrete visual mismatches (layout, spacing, typography, colors, hierarchy)
- `suggestions[]`: actionable next edits tied to the differences
- `reasoning`: 1–2 sentence summary

## Threshold and loop

- Pass threshold is **90+**.
- If `score < 90`: continue editing, capture a fresh screenshot (browser-skill), and rerun visual-verdict before any further visual review pass.
- Do **not** treat the visual task as complete until the next screenshot clears the threshold.
- Persist each verdict JSON under `.omd/visual-verdict/<ISO-timestamp>.json` so the iteration trail survives compaction; when running inside a ralph/autopilot flow, cite the latest verdict file as evidence.

## Debug visualization

When mismatch diagnosis is hard:

1. The visual-verdict verdict remains the authoritative decision.
2. Use pixel-level diff tooling (pixelmatch overlay, ImageMagick `compare`, …) via `pwsh` as a **secondary** debug aid to localize hotspots — only if the user has such tooling installed.
3. Convert pixel-diff hotspots into concrete `differences[]` / `suggestions[]` updates.

## Example

```json
{
  "score": 87,
  "verdict": "revise",
  "category_match": true,
  "differences": [
    "Top nav spacing is tighter than reference",
    "Primary button uses smaller font weight"
  ],
  "suggestions": [
    "Increase nav item horizontal padding by 4px",
    "Set primary button font-weight to 600"
  ],
  "reasoning": "Core layout matches, but style details still diverge."
}
```

## State Contract (状态契约)

visual-verdict **holds no omd mode state**: no `state_write`/`state_clear`. Its only persistent artifacts are the verdict JSON files under `.omd/visual-verdict/`. It never edits UI code itself — it judges; the editing loop belongs to the caller (autopilot/ralph/direct work).
