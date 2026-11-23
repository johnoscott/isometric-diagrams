# Changelog

The engine's releases, as published to npm as `@johnoscott/isometric-engine` (0.9.0 on) or kept locally before.

## 0.12.3 — the canvas's toolbar on a narrow canvas

- The toolbar wraps inside a canvas too narrow for it (with the palette docked, or text beside it); it was cut off.

## 0.12.2 — types for every subpath, and fixes

- Every `modules/...` subpath's types are declarations; its TypeScript source is under the `source` condition only, so a
  strict TypeScript project type-checks with nothing else installed.
- `viewer.buildLayer`, `viewer.ease` and `viewer.clamp`: the 3D–2D morph, seekable (`at(t)`).
- Completion inside lists of maps; a 2D view for drawings made of regions alone; a thin slab's name stays on its face.

## 0.12.1 — the docked palette's view fixed

- With the palette docked, the canvas's view is the stage's: the drawing fills it at its own aspect and a drop lands
  under the pointer (0.12.0 measured the whole canvas area, pane included).

## 0.12.0 — the palette docked and searchable

- **Docked palette**: `paletteLayout: 'docked'` on the view puts the palette in a pane of its own at the canvas's left,
  with a search box (by label and section), its sections as collapsible groups, a grip to resize it and a control to
  collapse it (both remembered in the host's storage). Drag and Enter add as before. Floating stays the default.

## 0.11.0 — palette sections

- **Sections** in the palette: give presets a `section` and they are listed under collapsible headers, in order, all
  collapsed but the one last added from (remembered in the host's storage). Presets without one are listed as before.

## 0.10.1 — drops land inside containers

- **Drop into** on the adapter (`dropInto(target, value, kind, data)`): a palette item dropped onto a container (a
  subnet, a VPC) is added inside it, the innermost that holds it; elsewhere it is pinned where it lands. One undo step.
- A long palette scrolls; after a palette add, the focus stays on the canvas, so ⌘Z works at once.

## 0.10.0 — palette presets, connecting, grouping

- **Palette presets** on the view (`palette: [{ kind, label, icon?, value?, name? }]`): each entry adds an object
  starting as its preset. Without it, one entry per kind, as before.
- **Connect** on the adapter (`connect(from, to, data)`): drag the handle on a selected object to another, or use
  **Connect to…** and click it; Esc cancels. The adapter says what a connection writes, or that two don't connect.
- **Group** on the adapter (`group(members, data)`): **Group** or ⌘G puts the selection into a new container.
- Each is one undo step. `package.json` names the repository and this site.

## 0.9.0 — MIT, npm, and only the engine's own marks

The first public release.
- MIT. The code the package bundles keeps its own licences (`LICENSES/`: yaml and Lucide, ISC; ajv's generated code, MIT).
- Published to npmjs (`npm i @johnoscott/isometric-engine`).
- Icons and screen faces beyond the engine's own (terminal, chat, desktop, tiles) are a host's: register them with
  `objects.registerMarks({ icons, faces, css })`; `drawingCss()` includes their CSS from then on. A name nothing has
  registered draws a neutral placeholder, and the compile warns at its line.
- Every layer's sources and public modules ship as subpaths (`@johnoscott/isometric-engine/modules/…`), beside the
  three bundles.

## 0.8.2 — the 2D view's text in dark, focus after a rename, wrapping nested panels

- `viewer.flatCss`: a card's name and sub are drawn in the theme's ink, readable on the dark scheme.
- The tree keeps the focus on its row through a repaint (⌘Z right after an inline rename works).
- `layoutFlat`'s `wrap`: two panels covering the same cells no longer loop; the later one is the inner one.

## 0.7.5 — the editor's 3D | 2D switch morphs

The canvas's switch runs the morph (`view.flat.motion`: `'auto'`, honouring reduced motion; `'always'`; `'never'`;
`view.flat.duration`). The morph is `viewer.morphSvgs` and `viewer.markConnectors`. The selection holds through a switch.

## 0.7.4 — the canvas's marks in every host

The overlay inherits no fill and takes no pointer; the marks' stylesheet ships in `assets/app.css` and alone as
`assets/marks.css`, on the skin's `--accent`, `--bad` and `--warn`.

## 0.7.3 — the morph's motion option

`dualView(host, scene, { motion: 'auto' | 'always' | 'never' })`.

## 0.7.2 — the editor guide

`EDITOR-GUIDE.md`: writing your own editor on the engine, worked from a small format, shipped in the package; its code
is tested against the packed package.

## 0.7.1 — inline-safe bundles, no peers

No bundle holds `<!--`, `<script` or `</script`, so a page may inline one. The package declares no dependencies.
`deleteCmd(…, { withRefs })` and `scope(css, root, stateRoot)` fixes.

## 0.7.0 — isodiag/1 in the package

`@johnoscott/isometric-engine/systems`: the drawing format's reader, compile, catalogue and stylesheets, with its schema
precompiled, so it runs under a strict CSP.

## 0.6.4 — the editor's 2D canvas

`DomainView.flat`: the canvas's 3D | 2D switch; selecting, the menu, rename, duplicate, delete, the properties and undo
work in 2D. The 2D code is handed over by the host (`editor.flatCanvas`), so a host without it bundles none.

## 0.6.0 – 0.6.3 — the 2D view and the morph

A drawing has a 2D view with its own layout (`objects.layoutFlat`, `boardOf`), drawn by `viewer` with an animated morph
between the views (`dualView`, `viewToggle`). Columns and rows per panel, `wrap: { aspect }`, no route along a panel's
edge. The package took its name, `@johnoscott/isometric-engine`.

## 0.5.0 – 0.5.2 — the layers

The engine split into layers, each importing only those below it through their public modules: L0 core, L1 objects,
L2 viewer, L3 editor, and the drawing format's kind pack. Built as a package with its declarations; L3's own icons.
