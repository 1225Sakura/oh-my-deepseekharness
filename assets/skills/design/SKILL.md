---
name: design
description: Canonical repo-local DESIGN.md workflow for product, UI/UX, and frontend decision source of truth
when-to-use: Product, UX, frontend, or design-system decisions need a repo-local source of truth; a feature needs a design brief before a designer lane or implementation; existing UI, assets, screenshots, or constraints need an actionable design summary. Not for pixel-matching against a visual reference or backend/infrastructure work without user-facing design impact.
---

# Design Skill

Use this skill to discover product and UI evidence, close only design-critical context gaps, and create or refresh the repository's durable `DESIGN.md` contract. It is a maintained design brief, not a pixel-matching loop or one-off critique. It complements the `omd-agent-designer` role card: this skill owns the durable design contract, the designer role owns execution-grade UI craft within it.

## Use when

- Product, UX, frontend, or design-system decisions need a repo-local source of truth.
- A feature needs a design brief before a designer lane or implementation.
- Existing UI, assets, screenshots, or constraints need an actionable design summary.

Do not use it for visual-reference implementation matching (see "Relationship to visual QA" below), screenshot comparison alone, or backend/infrastructure work without user-facing design impact.

## Relationship to visual QA

This skill owns product goals, users, information architecture, visual language, components, accessibility, constraints, and open questions in `DESIGN.md`. Implementation matching against an approved visual reference — measured verdicts and pixel-diff evidence — is a separate lane: **OMX's `$visual-ralph` has no direct dsh equivalent**; the closest surfaces are the dsh vision tools (`vision_html_screenshot`, `vision_pixel_diff`, `vision_ground`) and the `visual-verdict` skill for a structured score/verdict loop. Run this skill first when both are needed; `DESIGN.md` supports but does not replace the visual verdict target.

## Workflow

### 1. Discover local evidence

Inspect and cite existing `DESIGN.md`, design/UX/frontend docs, README/specs/issues, routes/pages/layouts/components/stories, theme and token files, assets, screenshots/mockups, Storybook or Playwright baselines, and accessibility/responsive/i18n/platform constraints — located with `glob` / `grep` / `read`. Separate observations from inferences; note absent evidence.

### 2. Interview only missing context

Ask concise questions only for gaps the repository cannot resolve: users/jobs, goals/non-goals, brand personality and forbidden aesthetics, primary flows, accessibility/device/browser targets, or unavailable assets/references. If answers are unavailable, record explicit assumptions and open questions rather than blocking.

### 3. Create or refresh `DESIGN.md`

Preserve useful content, remove contradictions, mark unknowns, and keep decisions actionable. The root file must contain these sections:

```
# Design
## Source of truth
Status (Draft | Active | Needs refresh), date, product surfaces, evidence reviewed.
## Brand
Personality, trust signals, avoid.
## Product goals
Goals, non-goals, success signals.
## Personas and jobs
Primary personas, user jobs, contexts of use.
## Information architecture
Navigation, routes/screens, content hierarchy.
## Design principles
Principles and tradeoffs.
## Visual language
Color, typography, spacing, shape/elevation, motion, imagery/iconography.
## Components
Existing/new components, variants/states, token ownership.
## Accessibility
Target standard, keyboard/focus, contrast, semantics, reduced motion/sensory concerns.
## Responsive behavior
Breakpoints/devices, layout adaptations, touch/hover differences.
## Interaction states
Loading, empty, error, success, disabled, offline/slow network where applicable.
## Content voice
Tone, terminology, microcopy rules.
## Implementation constraints
Framework/styling, tokens, performance, compatibility, test/screenshot expectations.
## Open questions
`[ ]` question, owner, and impact.
```

### 4. Apply the contract

Before UI decisions, cite relevant `DESIGN.md` sections, reuse documented components/tokens, and update the file or add an open question when implementation exposes a contradiction. Do not invent a parallel design-system layer. When implementation is delegated, hand the relevant `DESIGN.md` sections to the `omd-agent-designer` role card as binding context.

### 5. Handoff

For normal frontend work, provide the relevant sections, repo evidence, and acceptance criteria. For visual-reference, image, or live-URL matching, hand off to the visual QA lane (`visual-verdict` skill + dsh vision tools) with the approved baseline, and identify `DESIGN.md` as supporting context only.

## Evidence and completion

Complete only when design docs/assets/components/screenshots were inspected or noted absent; missing context is answered, assumed, or listed; root `DESIGN.md` contains every required section; recommendations cite it; and any visual QA handoff is clearly separated from design governance.

## State Contract (状态契约)

This skill **holds no mode state**: `DESIGN.md` itself is the durable artifact, living in the repo root rather than under `.omd/`. Cross-session design decisions worth keeping outside the repo go to `mcp__omd-state__notepad_write_priority` / `notepad_write_working`.
