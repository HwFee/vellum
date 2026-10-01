---
name: vellum-widget-md
description: >-
  Use when writing or editing Markdown that Vellum will render and a figure, a demo, or embedded HTML
  (a self-contained HTML document in a `vellum-widget` fence) would explain it better than prose:
  tutorials, lecture notes, diagrammed explanations, demos with adjustable parameters. Works on any
  .md file; no mdlog connection needed. Not for repo docs (README, docs/) or plain notes.
---

# vellum-widget-md

Write Markdown for Vellum, with figures and interactive demos as `vellum-widget` fences. Three ideas drive everything:

- **Lowest form that works**: native Markdown first; a widget only when it explains better.
- **Self-contained**: a widget is one HTML5 document; style, script, and state live inside the fence.
- **Ink on paper**: kami palette (warm paper, near-black ink, one indigo), serif stack, weight ≤ 500.

## Branches

The default needs no connection: write the file, check it, hand it over.

| Branch | Trigger | Read |
|---|---|---|
| **Write a document** (default) | the user wants a `.md` readable in Vellum | steps 1–5 below |
| **Add to an existing document** | the user points at a spot: "put a figure here" | steps 1–5; edit that spot only (blocks are written back by absolute offset) |
| **mdlog live log** | the tool list has `vellum_figure` | steps 1–5, then `references/mdlog-live.md` |

No `vellum_figure` means no connection: take the first two branches and keep going.

## 1. Pick the form

Climb only as far as the content demands. Done when the form is named and the lower rungs are ruled out.

| Rung | Write | Covers |
|---|---|---|
| Native Markdown | GFM tables, task lists, footnotes, `> [!tip]` callouts, `$math$` (KaTeX), `[[wikilink]]`, highlighted code (20 languages), local images | most explanation |
| Inline HTML | `<details>`, `<div class>`, `<kbd>`, `<table>` | folding, light layout |
| **Static widget** (default for figures) | `vellum-widget` fence + SVG | structure, flow, sequence, comparison, distribution, share |
| **Interactive widget** | same + inline script | parameter exploration, stepped evolution, dragging, state machines |

Vellum sanitizes inline HTML (checked 2026-10): `style` attributes, `<svg>`, `<button>`, `<select>`, `<label>`, `<progress>`, `<script>`, `<iframe>`, and the `open` on `<details>` are all stripped (an `<svg>` leaves an empty paragraph). Figures and controls belong in a widget.

Distribution, share, weight, and ranking are figures too: draw horizontal bars in SVG. Text diagrams (boxes, arrows, `[=== 40% ===]` bars) render as grey monospace blocks; a code fence earns its place only when it holds real code.

Budget per document: static figures as the content needs (2–3 per reply is the comfortable range), **interactive at most 1** (each live iframe is scarce; the host keeps 10 alive and sleeps the rest). Split an overloaded figure into several, one focus each, the focus named in the caption.

## 2. Draft

Start from a template. Done when the draft file exists and opens with `<!DOCTYPE html>`.

- Static figure: `assets/static-figure-template.html`.
- Interactive: `assets/widget-template.html`, plus the recipes in `references/interaction-patterns.md`.
- Keep the communication IIFE verbatim, and write a meaningful `<title>`: it becomes the widget's title bar.
- Draft into a temp file (such as `/tmp/vellum-widget-draft.html`); several figures may share one draft.

Contract details (fence, offline, memory-only state, palette, frame budget, height reporting, SVG geometry, host lifecycle) live in `references/widget-contracts.md`.

## 3. Self-review

Meaning first, then geometry. Done when each item below is answered.

- Arrow direction matches data flow; every label is unambiguous; the point of the figure stands out.
- No text overflows its box, no two texts overlap, no label sits on a line, no connector crosses text.
- Prose around the figure holds only: a lead-in, the caption, and what the figure cannot say (definitions, derivations, real code, a one-line conclusion).

## 4. Check

```bash
node pi/skills/vellum-widget-md/tools/check-widgets.mjs <draft.html | article.md>
```

It covers the fence tag, communication IIFE, offline and storage rules, reduced-motion, size, weight, emoji, canvas redraw, the 512KB cap, live-count, and, when an `<svg>` is present, SVG geometry (`tools/svg-lint.mjs`, also runnable alone). Done when exit code is 0 and every warning is either fixed or a deliberate choice (a 12.5px caption is fine). A fix that changes meaning sends you back to step 3.

## 5. Deliver

Done when the figure is in the document and the check passes on the whole file.

- **Document file**: paste the HTML into a `vellum-widget` fence (lengthen the outer fence when the HTML contains backtick runs), then run the check on the whole `.md`.
- **mdlog live log**: deliver through `vellum_figure` (see `references/mdlog-live.md`).
- Delete the temp draft.
- Tell the user, in one sentence: outside an mdlog log, **each widget first shows "交互内容 · 点击加载"** and runs after one click (remembered across restarts; different blocks in one document are clicked separately).

## Reference

| File | Holds |
|---|---|
| `references/widget-contracts.md` | contracts 1–7: fence, offline, memory-only state, ink-on-paper and frame budget, height reporting, SVG geometry, host lifecycle |
| `references/interaction-patterns.md` | design rules and recipes for interactive widgets: stepper, slider, tabs, hover highlight, compare toggle |
| `references/mdlog-live.md` | live-log rules: silent process, no blockquotes, image references, `vellum_figure` delivery |
| `references/troubleshooting.md` | symptom → cause → fix |
| `assets/*.html` | starting templates |
| `tools/*.mjs` | `check-widgets` and `svg-lint` |
