# The 2D view and the morph (0.6.0)

A drawing has two views: the engine's 3D scene, and a 2D view with its own layout. Switching between them animates (a
morph, about 600 ms), both ways. It is general diagramming: L1 lays the 2D view out, L2 draws it and runs the morph,
and nothing in either knows what the things drawn are.

## The API

The scene description is a **board**: cards on a grid of cells, panels over ranges of cells (nesting by containment),
links between cards or panels.

```ts
interface Board {
  cards:  { id, label, sub?, role?, ghost?, cell: [col, row] }[];
  panels?: { id, label?, sub?, role?, cells: [c0, r0, c1, r1] }[];
  links?: { id?, a, b, kind?, label?, aOn?, bOn? }[];   // a, b: a card or a panel; aOn/bOn: draw that end to a panel
}
```

- L1 (`src/iso-objects/flat.ts`): `layoutFlat(board, measure, opts?)` gives the card, panel and title rects, each
  link's route and its label's spot. It is pure: `measure(text, font)` is given (a page measures its rendered text with
  `measureIn`; Node uses L0's font metrics, `metricsMeasure`), so a layout is the same every time. `boardErrors(board)`
  says what is wrong with a board (duplicate ids, cards and panels sharing one set; ends that don't exist; overlapping
  panels); `layoutFlat` refuses a board with any. The sizes and the cost model are `FLAT_DEFAULTS`.
- L1 (`src/iso-objects/board.ts`): `boardOf(scene)` reads the board of any laid-out engine drawing; `boardDiagram(board)`
  draws a board in 3D through the engine (`boardCatalog(board)`: a card kind showing the board's text, and a panel kind).
- L2 (`src/iso-viewer/flat-view.ts`): `flatSvg(layout, { id, title, styles })` and `flatCss(styles)`. A link kind's
  style is its ends (`arrow`, `open`, `diamond`, `none`), dash and colour (a theme token by name, or CSS).
- L2 (`src/iso-viewer/dual-view.ts`): `dualView(host, scene, { mode, board?, styles, onSelect })` shows the scene in its
  first view; `view.morph('2d' | '3d')` switches, animated; `view.select(id)`; `viewToggle(host, views)` is the 3D | 2D
  switch (two buttons, `aria-pressed`, remembered in localStorage `iso-view`).

Both views carry the same `data-id` on cards and panels and the same `data-a` / `data-b` on connectors, so a selection
and its highlighted connectors hold in either view and through the switch, and so does the keyboard focus.

## The 2D layout

It is a layout of its own, not a projection of the 3D one. A card is one rounded rect (178 × 58, rx 9); a panel a
rounded area (rx 14) with 22 px padding on every side and a 30 px title strip at its bottom left. Cards in a panel are
44 px apart; between two different containers there is a free 96 px channel; the extra at a column or row boundary is
the largest any row or column needs there. A card is placed by its innermost panel, evenly between that panel's first
and last column (and row). Links are orthogonal, card edge to card edge, never through a card or a title, the cheapest
of the straight, L, Z and four-bend candidates (length, +70 a bend, +400 an overlap with a drawn line, +300 a panel
crossed that holds neither end, +120 a border crossed, +200 running near a panel edge). A link from something to the
panel holding it ends on that panel's inner border. Each label goes beside its link's longest segment, clear of cards,
titles, other labels, lines and borders; when no spot is clear, the least bad. With one level of panels this is exactly
the layout of the reference kit it came from (`test/flat.test.ts` checks every rect, route and label against it).

Nesting goes further than the kit did: at a boundary the extra is the channel, plus the padding (and, below a panel,
its title strip) of every panel exited or entered there; each panel holds its children with its padding round them.
A panel's rows and columns are its own: the rows and columns its cards and inner panels use, each a gap past the one
before (44 px, or more where something inside it ends or starts), so a tall or wide neighbour opens no gaps inside it;
then each panel's contents slide left as far as they may (a card 44 px from a card, a channel between a container and
what stands beside it), innermost first. A top-level panel of cards only keeps the kit's even spread between its first
and last column (decision 4). With one level of panels, both give the kit's positions.

No route runs along a panel's edge (parallel, within 16 px of it); crossing an edge is fine.

`wrap: { aspect }` (off by default) wraps a wide drawing for a frame of that aspect: in a container (the drawing, or a
panel holding panels) whose children stand side by side, the last of them go onto a shelf below, in their order, a step
at a time while one lets the drawing be drawn larger in the frame. A panel of cards only is never rearranged.

## What the 2D view leaves out

The 2D view is derived from the drawing's 3D placement and drops what has no meaning flat: every card is the same size
(a node's `size` and its height `z` are ignored); a route's sides and via points are ignored (links go edge to edge);
a region's label style is ignored (a panel's title is always in its strip at the bottom left); and in a drawing with
steps the 2D view shows the current step's visible set. A region (or a node holding nodes) is a panel over the cells of
what it holds, and a region that holds nothing has no cell and is not shown. A card's row is one below every card above
it, and its column one right of every card left of it, asked of the two things that part them, so each region's rows
and columns are its own and near-aligned boxes share them; a card in no region keeps its place across. Two boxes in one
cell get a column each. In the editor (its 2D canvas is the next step), select, connect, rename, delete, add
from the palette, edit properties and undo work in 2D; move and resize are 3D only.

## In the editor

A domain view that gives `flat` (`DomainView.flat`: `load`, a title, the link kinds' styles, layout options) gets a
3D | 2D switch in the canvas's toolbar (remembered in the host's store as `canvas-view`). `load` hands the canvas its 2D
implementation, `editor.flatCanvas` (`src/iso-editor/ui/flat-canvas.ts`), e.g. `load: () => import('…').then(m =>
m.flatCanvas)`: the canvas only has the hook and the types and never imports a 2D module, so a host that gives no `flat`
(the space editor) bundles none of the 2D code (`test/flat-reach.test.ts` checks every entry's inputs). The host adds the
2D stylesheet (`flatCss`) to its canvas CSS, scoped as the drawing's is. In 2D the canvas draws the drawing's board,
laid out with the stage's own text, and keeps everything that names things by path: a click or a marquee selects (the
tree and the properties follow), the menu, rename (F2), duplicate, delete, connecting through the properties, adding
from the palette (dropped on a panel of the kind the domain drops into, it goes in it; elsewhere the layout places it)
and undo. Moving is 3D only: a pin is a position in the 3D layout, so a drag in 2D moves nothing and the status bar
says to switch to 3D. The switch morphs in the editor too (0.7.5), as `dualView`'s does: `flat.motion` (`'auto'`, the default, honours reduced motion; `'always'`; `'never'`) and `flat.duration` (600 ms). The
morph (`src/iso-viewer/morph.ts`) comes with the host's 2D implementation (`flatCanvas.morph`), so the canvas still
imports none of it; the selection holds through it, and a switch or an edit during one ends it at once.

## The morph

The connectors fade out (the first 20 %); each card and panel (matched by `data-id`) moves and resizes from one view to
the other, its 3D top face turning into the 2D card (or back) while the rest cross-fades (the middle 60 %, eased); the
new view's connectors draw in (the last 20 %). It runs on a layer of its own; when it ends, or another switch
interrupts it, the layer goes and the final view is exact. `dualView`'s `motion` option says whether a switch
animates: `'auto'` (the default) honours `prefers-reduced-motion: reduce` and swaps at once there; `'always'` morphs
regardless; `'never'` always swaps at once. `'always'` is the host's deliberate choice, for a switch the user asked
for (the morph is what the switch shows), not a default to set everywhere.

## The demo and the evidence

`npm run dual-demo` builds `examples/boards/demo-page.ts` (a data model given as a board, and a network in the engine's
own format, `examples/boards/network.yaml`) into `dist-demo/`. `npm run dual-shots` makes `docs/shots/2d/`: both
drawings in both views, dark and light, and the morph each way as a strip of frames and a WebM.
