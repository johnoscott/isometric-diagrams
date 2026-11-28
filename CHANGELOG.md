# Changelog

The engine's releases, as published to npm as `@johnoscott/isometric-engine` (0.9.0 on) or kept locally before.

## 0.31.0 — the owner's drag keys; a move handle

- **⌥ at the start of a drag drags a copy** (the owner's answer to group drag's question 1): the original stays where it stands; the
  copy, its name the next free one, is pinned where it is dropped, one undo step (no name asked).
- **⇧ keeps a drag in a straight line** from where it started: along the grid's axes and at 45°, the line shown dotted.
- **Ctrl while dragging gives half cells** (⌥ did, before 0.31.0; ⌥ now starts a copy). A resize takes Ctrl the same way.
- **A move handle**: the selected thing shows a diamond at its left, beside the connect circle. A drag from it takes the thing
  anywhere, past any group's edges; what is under the drop takes it, innermost first, as a palette drop does, or nothing (in the space
  editor: an agent into the sandbox it is dropped on, or onto the Mac). One undo step, the layout making room; Esc cancels. A host
  gives it with `adapter.moveInto(thing, value, target, data)`; without it there is no handle.
- **A drop is checked against what the drawing shows**: a palette add, a copy or a move is "taken" only where something stands in
  the trial drawing (what made way for it, where it went), not where things stood before it came. Seen with the move handle, at the
  layout's own place in another group; in the files tried, a palette add was never caught by it.
- **The hint and the dashed floor agree on a slow machine**: when a trial drawing lands late and moves the group under the drag,
  both are drawn again ("which grows with it" said while the old floor wasn't dashed). This is our reading of v0.30.0's tag CI run,
  where the 0.28.0 grow test failed twice (once on this, once on the floor and c standing a few pixels off after the drop) while
  main's passed on the same code. Neither failure was reproduced here (Chrome slowed 2 to 12 times, or with every trial held back:
  a new test, `canvas.trialDelay`); the test now says what it saw when it fails, for the next run to tell us.
- **Every test file runs**: 0.30.0 shipped three Node tests that `npm test` didn't name, so neither CI nor a release's verification
  ran them (settle-pins, which holds what is kept in place exactly; and 0.31.0's drag-keys and move-into). They are in it now, and a
  test (test-list) fails when a test file is neither in `npm test` nor left out with its reason.
- **Two size records moved, on review**: space-editor.js and space-canvas.js re-recorded at 0.31.0 for these features (+3.7% and
  +3.5% gzipped over their records; test/baseline/sizes.json says what for).

## 0.30.0 — groups grow left and back; nothing else jumps

- **Groups grow to the left and back too** (the owner's answer to group drag's question 2): a thing dragged past a group's left or
  back edge grows the group that way, and everything else in it stays where it is on screen (its pins move with the edge; the group
  needs a pin of its own, else those sides hold, as before). A selected group shows all eight resize handles: its corners and sides.
- **Adding from the palette lets the layout make room**, as before (the owner's answer): "nothing else jumps" is for drags and
  resizes; a drop writes only the pins the drawing needs (each kept pin tried without it).
- **The variant not chosen is removed**: growing left or back with the whole group moving with the edge ('shift'), built and
  tested in 0.29.0 beside 'pins', is gone (0.29.0 has it); GROW_SIDES keeps its left and back switches.
- **Nothing else jumps** (question 4): a drop that grows a group no longer lets the layout move what stands beside the group (or
  anything else in the drawing): whatever the drop would have moved is pinned where it stood, in the same step ("kept in place").
- **A group grows only once a thing is past its margin**, not when the layout put the thing on the margin itself (a palette drop
  near a group's back edge grew it a cell in 0.29.0's left/back variant).
- **A group grows only the way it is dragged**: a thing the layout put inside the margin (snapping to past it) dragged left grew its
  group back too, moving what flows after it; it now grows a side only when the drag itself goes that way by half a cell.
- **What is kept in place stands exactly where it stood**, also where a layout rounds boxes to the grid or shifts what a container
  holds: the pins a drop writes are measured against the layout's own places (before rounding) and corrected until each thing
  stands where it is meant to (in the space editor, a sandbox growing left no longer moved down with everything in it).
- **restoreLog(model, log, { clean: false, cleanAt })** (for hosts that keep drafts): a restored history can open unsaved, clean
  again where undo reaches the saved text (cleanAt, its textHash), or nowhere until a save.

## 0.29.1 — the morph keeps its hatching in black and white

- **The 3D | 2D switch's morph keeps its black-and-white hatching** (M6.B4, known since 0.23.0). Its layer painted its clones with
  references to the patterns in the views' own definitions, which a layer of its own couldn't reach; it now copies what its clones
  paint with (patterns, a gradient) into the layer, under ids of its own, and the face that moves between the 3D top and the 2D card
  carries its pattern too.

## 0.29.0 — growing left and back, both ways, built and off

- **Growing a group on its left and back sides, both ways, built and off** until a decision (`GROW_SIDES.left`, `.back`, and
  `.leftBack`: `'pins'`, the others' pins move so nothing else moves on screen, or `'shift'`, the whole group moves with the edge).
  With them on, a drag past the left or back edge pins the group where it stood less the shift, and the thing at the margin; a
  selected group also has left, back and the other three corner handles, which keep the far edge and its contents still. Nothing
  changes while they are off: the right and front work as in 0.28.0.
- `growLeftBack`, `resizeSides` and `minSizeFrom` are exported with the geometry, from a module of their own (`resize.ts`, where
  `resizeTo` and `minSizeFor` now live too, exported as before), so a page that neither drags nor resizes carries none of it;
  `snapMove`'s `parent.grow` takes `left`, `back` and `reachLo`.

## 0.28.0 — a drag grows its group; resize handles

- **A drag grows the group it is in:** a thing dragged past the right or front edge of a group that fits what it holds isn't held
  there; the group grows under it, its floor as it was drawn dashed, within 2 cells of the furthest the pointer has been. One undo
  step, the pin as before; no size is written. A group with a size of its own holds it at its edges, as before, and says so.
- **Resize handles:** given the adapter's `sizeAt(group)` (where a group's size is written), the selected group has handles: its
  front-right corner, and the middles of its right and front sides. They snap to whole cells (⌥: half), stop at what the group
  holds, and write the size as one step; a double click on one, or **Fit to contents** in the group's menu, takes it away.
- Growing and resizing on the left and back sides wait for a decision (`GROW_SIDES`, in the canvas).
- `snapMove` takes `parent.grow` (the sides that grow, and how far the thing has been); `minSizeFor`, `resizeTo` and `GROW_REACH`
  are exported with it.

## 0.27.1 — the history's log taken mid-word

- `revisionLog(model)` no longer closes the typing group being added to: a host may take the log after every keystroke and the
  typing still joins into one undo step (in 0.27.0 each keystroke became a step of its own if the log was taken between them).

## 0.27.0 — the editor's history kept beside its text

- **The editor's history can be kept beside its text and given back after a reload:** `revisionLog(model)` is the undo and redo
  history as data (JSON), with a hash of the text it belongs to; `restoreLog(model, log)` gives it back to that text only, and only
  when every step, tried on a copy, undoes and redoes to it exactly. Else it says why (`{ ok: false, why }`) and nothing changes.
  The restored text is clean; steps beyond the model's depth (500) are left out, oldest first; new steps' ids follow the log's.
  The text pane's own selection is not kept. Where and when a host keeps the log is its own choice.
- `revisionLog`, `restoreLog`, `textHash` and the types `RevisionLog` and `LoggedStep` are exported with the editor's model, from a
  module of their own (`history-log.ts`), so an editor that keeps no history bundles none of it.

## 0.26.0 — a compact-layout toggle in the canvas's menu

- The editor canvas's kit takes an optional `compact: { on(data) }`. Given it, the canvas's menu (on the background) offers "Turn
  compact layout on" or "off", one undo step each way: on sets `compact: true` under the pins' key; off removes it, and the key
  too when that was all it held. A kit without it shows no toggle, as before.

## 0.25.0 — no change here

- Nothing in this repository changes: the release is for parts of the engine that are kept elsewhere.

## 0.24.0 — a grid keeps off what is pinned

- A grid (and so `layout: compact`) no longer lays things on top of a pinned child (`at:`): a thing that would come within its gap of
  a pinned one steps past it. In 0.23.0 it could, for example after an editor's drag pinned one thing.
- Without pins, every grid is exactly as 0.23.0 laid it out.

## 0.23.0 — a compact layout, and the 3D to 2D move as a drawing

- **`layout: compact`** (a scene) **and `flow: grid`** (a container): things without a place of their own go in rows, as many to a row as
  makes the drawing smallest in the isometric view, so a long drawing comes out about square and reads larger when fitted. Placed
  things keep their places; a drawing that asks for neither is as before.
- **`flatStill`:** a drawing's 2D view as one self-contained SVG, in light, dark, or black and white (where a card whose colour has a
  pattern carries a strip of it).
- **`morphDrawing`:** the move from a drawing's 3D view to its 2D view, or back, as a frame for any point of the way (`svgAt(t)`, or
  `at(t)` as data), with no page needed: for a video, or a frame of your own. It follows the 3D | 2D switch's morph, measured against it
  in Chrome.
- Known: the 3D | 2D switch's own morph draws black and white without its hatching. Tried in Chrome only: Safari and Firefox are untried.

## 0.22.1 — what each step touched

- For a host of the editor's model: each history entry says what its command touched (`touched`).
- The space editor's space/3.2 draft is **experimental**: its key names will change; don't write 3.2 files for production.

## 0.22.0 — the editor's handle for a host

Changes you'll notice:

- **In the editors, a host's change of the view or of 3D and 2D isn't kept as the person's choice** (before, a change of 3D and 2D was).

New, **experimental** (it may change in a minor release until it is marked stable):

- **A handle for a host of `mountEditor`:** the model, whether it is read-only, what the person is in the middle of (`busy`, `onBusy`), the view,
  save, check, a note; and the canvas: its mode, zoom, `drawn()`, the drawing, a thing's elements and box by its path, fit and focus.

Fixed:

- After a text that couldn't be drawn, undoing to the same text left the "can't draw" notice over the drawing.

## 0.21.0 — two drawings compared

Changes you'll notice:

- **The script `isometric-diagram.js` is larger:** 477,755 bytes, 132,761 gzipped (0.20.0: 452,487 and 123,267), also for a page that compares nothing. It is still one script that fetches nothing.
- **In the editors, an edit that leaves the text as it was is no undo step.**
- **In the editors, the first entry of an empty `{}` or `[]` is written as a block**, unless it is short enough for a line.

New:

- **`<isometric-diagram compare>`:** put two drawings in it, before and after. It has Before | After, a slider between, what each mark means and what changed as text; what moved glides.
  `compareScenes` gives the frames as SVG, `mountCompare` is it in a page of your own, and `isodiag build` writes its still. Halfway, a region that changes size shows both its edges.
  Tried in Chrome only: Safari and Firefox are untried.
- **For a host of an editor's model:** `undoEntries` and `redoEntries` (ids, labels, your own `meta`), changes that say their step, `replace` and `setText(text, { undoable: true })` as one
  undoable step, and `readPins`.
- Fixed: the space editor's types had `setText(text)` alone; `{ fit: true }`, there since 0.12.5, and the new options can be typed now. An object of your own that stands in for a `SpaceEditor`
  gives `true` from `setText`, to type-check.

## 0.20.0 — what changed between two drawings, and a legend's word

- **`drawDiff`:** the second of two drawings with what changed since the first marked in it: added with a solid outline, changed dashed, moved dotted from a fainter outline, removed as a ghost;
  connectors in the same language. Light, dark and black and white. `diffScenes` gives the changes as data. The legend is data, for you to draw.
- **The legend of the `vm` region kind says "Sandbox"** (it was "Sandbox VM"), in every drawing with a legend. The kind's name in a file is still `vm`.
- **The 2D view** of a drawing where two pairs of cards fell in one cell: it had none, and has one now. Every 2D view there was is unchanged.
- `viewport()` takes `minZoom` and `maxZoom`.
- In the space editor: what has no name of its own can be moved, what can't says why, exports (`exportSvg`, `exportPng`, `exportDrawing`), and a draft of space/3.2's execution realms.

## 0.19.0 — zoom and pan, and a file's own ants

- **Every `<isometric-diagram>` can now be zoomed and moved by its reader**, up to 8 times: ⌘ or Ctrl with the wheel (the wheel alone still scrolls your page), a pinch, a drag once it is closer,
  a double click to fit, `+` `−` `0` and Shift with the arrows, and three buttons. Enlarged, the wheel alone zooms. **`zoom="off"` leaves it out.** A host of `mountPlayer` asks for it: `zoom: true`.
- A drawing's player takes the keyboard's focus without `controls` too, now that it has keys; not with `zoom="off"`.
- **A drawing with no motion marches its file's own `ants:`**, where it stood still; `ambient="off"` stops it.
- Fixed: `autoplay="visible"` without `loop`, once it had ended, began again at any scroll. It plays once.
- `iso-core` has a camera as a value: fit, zoom about a point, pan, turn.
- Tried in Chrome on a desktop, and with emulated touch. A real phone, Safari and Firefox are untried.

## 0.18.2 — a switch of view fits

- In the editor, after a zoom or a pan, switching between 3D and 2D left the new view unfitted, with the old view's zoom on the readout, and the next edit made it jump. It is fitted now.

## 0.18.1 — tests

- Two tests of the enlarged view failed where a page's scrollbar takes room. They are run with both kinds. The package is 0.18.0's but for its version.

## 0.18.0 — your marks in the element, and the enlarged view

- **Every `<isometric-diagram>` now has an Enlarge button** in its corner, shown when it is pointed at or reached by keyboard (always on a touch screen). It opens the same drawing, playing on,
  in nearly the whole window; Esc or ✕ closes it. **`expand="off"` leaves it out.** From a page: `expand()`, `collapse()`, `expanded`, and the events `expand` and `collapse`.
- `registerMarks` from `isometric-diagram.js`: your own icons and screen faces in the element's drawings, also in those already on the page.
- Tried in Chrome; Safari and Firefox are untried.

## 0.17.2 — Motion off, whoever asks

- While **Motion off** is on, a host's `transport.play()` does nothing: the drawing, the time and the Play button stay as they are.
- On again, it plays from the first step, whether or not it began by itself; a reader's own pause is kept.

## 0.17.1 — fixes from the first video

- `assemble` and `disassemble` in a beat that says its own length threw; they play, wherever a beat may have them.
- **Motion off** on `<isometric-diagram>` (and `mountPlayer`): motion plays for a reader who asked their machine for less, as before, and they now have a button that stops
  everything and lights the whole drawing; with or without `controls`.
- `DrawingProps` is a type that Remotion's `<Composition>` takes, with its command line installed too.
- The package's README says what is in the repository alone, and where: the docs, the sample, the `isodiag` command.

## 0.17.0 — drawings in Remotion videos

- **`@johnoscott/isometric-engine/remotion`**: `<IsometricScene>`, `useIsometricCues`, `<IsometricSequences>`, `isometricMetadata`, and `isometricTiming` and `isometricPresentation` for a
  `TransitionSeries`. A frame is drawn from its number alone. `react` and `remotion` are optional peers: without `/remotion`, installing the engine installs neither.
  **Remotion isn't open source: using it needs Remotion's own licence.**
- **`font: 'arimo'`** (`compile`'s `font: ARIMO`, from `modules/iso-core/arimo`): a self-contained drawing laid out with Arimo's widths. Never the default; the package has no font file.
  `isometricFonts()` is what a font loader takes, for your own file.
- `samples/remotion`: a small project, with Arimo (OFL 1.1) in it.
- **Known**: no monospaced font is chosen: that text is the system's. Rendered video files aren't tested here. Remotion's older versions (before 4.0.546) aren't supported.

## 0.16.0 — the player, and black and white

- **`<isometric-diagram>`** (`isometric-diagram.js`, and `@johnoscott/isometric-engine/player`): a drawing's text in a page, drawn and played, with its controls,
  commentary, keys and a text list of its steps. One script (118 KB gzipped); nothing is fetched or stored; a CSP of `script-src 'self'` is enough.
- **`@johnoscott/isometric-engine/transport`**: the clock for a Timeline, headless: play, seek, rate, loop, beats, the ambient switch, `rebind`.
- **Black and white**: `treatment: 'mono'`, light and dark, for self-contained drawings (`compile`, `renderSvg`, the element, or `treatment: mono` in a file):
  the same drawing, told apart by greys, patterns and line rhythms.
- The page `isodiag build` writes plays a scene's own `motion`, and plays for a reader who asked their machine for less motion, with a **Motion off** button.
  `isodiag build PAGE.html` writes a still inside each `<isometric-diagram>`, for readers without its script.
- Fixed: `paint` on a self-contained drawing has the drawing's own colours for rings and tokens, given the scene's `rendered` (0.15.0's Known); a thing dropped on a
  taken spot, which the layout places out of view, is brought into view.
- **Known**: the page `isodiag build FILE.yaml` writes is in colour, whatever its file says. The element's strict CSP was tried in Chrome only.

## 0.15.0 — motion

- **Motion documents**: beats with commentary, show and hide, focus, highlight, levels, looks, tokens, ants, lift, camera, in a scene's
  `motion:` or in code (`motion()`); `bindMotion(scene, doc)` is a Timeline: `at(ms)` in any order, `cues(ms)`, two clocks. `variants` on
  nodes and regions; `ants` on a scene. `systems.renderSvg(yaml, { theme, t })`: one frame, or a still, as one SVG.
- **Motion as a function of time** (`@johnoscott/isometric-engine/motion`): `assemble` and `disassemble` plans you can seek,
  `at(ms)` as plain JSON, `svgAt` and `frame(ms)` as SVG text, `paint` on a live drawing. No clock, no DOM: for video
  renderers, and the page's own intro. `motion:` in the file.
- A wrapper per part of a thing in the SVG (`data-item` or `data-route`, with `data-part`), for a host that animates it.
- `compile(…, { mode, resolveVars, strict, stepMs })`: self-contained drawings, dark or light; strict reading.
- **Known**: `paint` on a self-contained drawing (`resolveVars`) draws the rings and tokens a state adds in the page's colours; `svgAt`
  and `renderSvg` draw them right. Fixed in 0.16.0.

## 0.14.1 — a double click to rename

- With `doubleClick: 'rename'`, a double click on a connection does nothing, and beside one on a group's floor it renames the group.


## 0.14.0 — the editor's feel

- Dragging over a taken cell and holding still: what is there jiggles, then makes way (at 700 ms), and goes back if you leave. A
  drop without the wait pushes nothing. One undo step. `dragMotion: 'respect'` on the view follows Reduce Motion.
- A palette drag drags the thing itself, in 3D, with the grid and the drop target, into containers too.
- `paletteLook: 'object'` on the view: the palette's entries show what they make.

## 0.12.6 — Fit counts the connectors

- A connector that goes past everything else drawn is on the canvas when fitted (3D and 2D); otherwise the fit is as it was.

## 0.12.5 — the name is asked in place

- A dropped thing's name is asked in an inline field above it, not a dialog: Enter or a press elsewhere names it, Esc
  keeps the generated name; the drop and the name are one undo step. F2, the menu and the properties' pencil use it too.
- `doubleClick: 'rename'` on the view; by default a double click shows the thing in the text (fixed: it found nothing).
- `setText(text, { fit: true })` fits the new drawing.
- A rename keeps the thing's pin.

## 0.12.4 — connections are easy to select

- A connection is selected within 6 px of it, 3D and 2D (a node under the pointer comes first); Tab reaches connections.

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
