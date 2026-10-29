---
name: diagram
description: "Use the smallest visual when prose must carry structure — control flow, call depth, module ownership, or change shape: pseudocode, call tree, component/file tree, Mermaid, or diff. Skip it when prose already answers the question."
when-to-use: 回复/报告里需要承载结构（控制流、调用深度、模块归属、变更形态）时，选最小视觉；散文已能回答就不画。
---

**Diagrams are load-bearing, not decoration.** Reach for one only when prose forces the reader to hold a whole shape in their head at once — then pick the smallest view that lets them see the shape instead of reconstructing it from sentences. Everything renders in the conversation as text blocks or Mermaid; at most one artifact file is ever written.

## The vocabulary — pick one view, two at most

- **Pseudocode** — logic without language noise; reduces a decision to its branching shape.
- **Call tree** — runtime control flow; depth shows who owns the flow; annotate the interesting edge.
- **Component tree** — UI/module structure with the boundaries that matter, annotated inline.
- **File tree** — where responsibility lives; shallow, one annotation per directory.
- **Mermaid** — interaction between parties, dataflow, or state transitions.
- **Diff** — the shape of a change when surrounding structure already exists (component / layout / call-tree / state-machine shaped).
- **The whole block** — when elision would hide ownership or ordering, show the complete unit once, copyable.

## Selection rule

Match the visual to the question the reader must answer: who owns the flow → call tree; who talks to whom → Mermaid; what changed → diff shaped like the change; where things live → file tree. When two views tie, take the smaller. Never stack all forms — one visual usually suffices.

## When text runs out

A UI layout, a before/after comparison, or a concept too dense for Mermaid: write one focused HTML file and render it (omd's vision toolchain can screenshot it for verification; visual-verdict judges UI changes against references). Then stop — one artifact, working labels, real data.

## Anti-patterns

- Decoration diagrams that repeat the adjacent prose.
- A Mermaid where a three-line call tree answers faster.
- Diffs so wide the change hides — shape the diff around the change, not the file.
- Inventing structure the code does not have: the visual is evidence, same as file:line.
