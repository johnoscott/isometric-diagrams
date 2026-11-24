# The isodiag YAML format

A file is one page: a header and one or more **scenes**. Each scene is an isometric drawing of **regions** (hosts,
zones, groups) holding **nodes** (services, workers, files), joined by **routes**, with **steps** that animate
messages along the routes. The JSON Schema is `src/iso-systems/schema.json`; editors that know YAML language server can use
it with a first line `# yaml-language-server: $schema=../src/iso-systems/schema.json`.

`isodiag check FILE.yaml` reports every problem in one go, with the line, a caret, and a suggestion:

```
demo.yaml:12:36  error: unknown key "lable" in a node (did you mean "label"?)
  12 |       - { id: ann, asset: person, lable: Ann, right-of: chat }
     |                                    ^
```

Contents: [a small example](#a-small-example) · [the page](#the-page) · [scenes](#scenes) · [the grid](#the-grid) ·
[regions](#regions) · [nodes](#nodes) · [placement](#placement) · [routes](#routes) · [notes](#notes) ·
[steps](#steps) · [grid](#grid) · [assemble](#assemble) · [kinds and the legend](#kinds-and-the-legend) · [themes](#themes) ·
[YAML traps](#yaml-traps)

## A small example

```yaml
isodiag: 1
title: A worker and its scheduler
scenes:
  - id: s
    title: One message
    regions:
      - id: mac
        kind: slab
        label: "APP HOST"
        nodes:
          - { id: sched, asset: session, role: lead, label: scheduler }
          - { id: chat, asset: chat, right-of: sched, gap: 4, label: chat server }
    routes:
      - { id: a-c, from: sched, to: chat, kind: send, label: hello }
      - { id: c-a, from: chat, to: sched, kind: reply }
    steps:
      - heading: The scheduler says hello
        kind: send
        animate: [a-c]
        pulse: [chat]
      - heading: The server answers
        kind: reply
        animate: [c-a]
```

`examples/demo.yaml` is a fuller one; `corpus/` and `examples/scenarios/` hold full pages.

## The page

| Key | | |
|---|---|---|
| `isodiag` | required | Always `1`. |
| `title` | | The page title (default: the first scene's). |
| `lede` | | A paragraph under the title. Markdown subset (below). |
| `pills` | | Short facts shown as pills by the title: `["Tested 19 Nov", "v0.51"]`. |
| `grid` | | `{ snap, show, step }` for every scene. See [grid](#grid). |
| `assemble` | | `true` builds every scene piece by piece when it comes into view. See [assemble](#assemble). |
| `theme` | | `default`, or a path to a theme file relative to this file. |
| `roles` | | Extra colour roles: `name: { h, s, top?, tint? }`. See [ASSETS.md](ASSETS.md#colour-roles). |
| `kinds` | | Extra flow kinds, or new legend text for the standard ones. See [kinds](#kinds-and-the-legend). |
| `scenes` | required | One or more scenes. |
| `after`, `footer` | | Markdown after the scenes, and a footer. |

Text fields take a Markdown subset: `` `code` ``, `**bold**`, `*em*`, `[text](https://…)`, and blank lines between
paragraphs.

## Scenes

| Key | | |
|---|---|---|
| `id` | required | Letters, digits, `-`, `_`; starts with a letter. Also the page anchor `#scene-ID`. |
| `title` | required | The scene heading. |
| `caption` | | Text under the heading. |
| `aria` | | The scene's accessible description (default: the title). Say what the picture shows. |
| `regions`, `nodes`, `routes`, `notes`, `steps` | | The contents, below. |
| `gap` | | Default distance between items placed next to each other, in grid units. Default 2. |
| `flow` | | `row` (default) or `column`: where an item with no placement goes. |
| `legend` | | `auto` (default: the kinds used), `false`, or a list of kinds, plus `fence`, `vm`, `tunnel`. |
| `loop` | | The player wraps from the last step to the first. Default `true`. |
| `dim` | | What a step dims: `flows` (default: routes, their labels and marks) or `all` (nodes, regions and badges too). |
| `badges` | | `true` puts a numbered badge for each step on the diagram. |
| `grid`, `assemble` | | As at the top of the file, for this scene only. |
| `motion` | | The scene's motion document: a timeline of beats. See [MOTION.md](MOTION.md#a-motion-document). |
| `ants` | | Its connectors march, showing which way they flow: `true`, a list of route ids, or `{ ids, speed, dash }`. In `renderSvg`'s stills and in a timeline's frames. |
| `after` | | Markdown under the scene's figure. |

Ids are one namespace per scene: a region, node and route may not share an id.

## The grid

Units are grid units (34 px). **x** runs down to the right on screen, **y** runs down to the left (toward the
viewer), **z** is up. Sizes are `[w, d, h]`: w along x, d along y, h up. Sides of a box are named for the grid:

| Side | Face | Where on screen |
|---|---|---|
| `n` | the −y face | back right |
| `e` | the +x face | front right |
| `s` | the +y face | front left |
| `w` | the −x face | back left |
| `top` | the top | |

You rarely write coordinates: place things next to each other and let regions fit around them.

## Regions

```yaml
regions:
  - id: mac
    kind: slab
    label: "BUILD HOST · ci-1"
    nodes: [ … ]
    regions:
      - id: fence
        kind: fence
        label: FENCE
        right-of: chat
        gate: { side: w, at: 0.4, width: 3, node: proxy }
        nodes: [ … ]
```

| Key | | |
|---|---|---|
| `id`, `kind` | required | Kinds: `slab`, `pad`, `vm`, `platform`, `fence`, `cloud`, `zone`, `tunnel` (pictures in [ASSETS.md](ASSETS.md#region-kinds)). |
| `label` | | Its name, drawn as the kind does (front face, floor, side). |
| `label-style` | | `face`, `face-right`, `floor` or `none`, to override. |
| `role` | | Colour role (each kind has one). |
| `size` | | `[w, d]` or `[w, d, h]`. Without it, the region fits its contents plus `padding`. |
| `ghost` | | Draw it as a dashed outline: not there yet, out of reach, or stopped. |
| `padding` | | Room around the contents when fitting. Defaults: slab 1.2, fence 0.7, vm and platform 0.6, pad 0.6, cloud 0.8. |
| `height` | | Thickness or wall height. Defaults: slab top at 0.35, pad 0.2, vm 0.45, platform 0.7, fence walls 0.8. |
| `z` | | Lift above the floor it stands on (tunnels float at 0.2). |
| `flow` | | `row` or `column` for its contents. |
| `gate` | fence only | `side` (required: n, e, s, w), `at` (0–1 along the wall, default 0.5), `width` (default 2), `height`, `node` (a node id: the fence puts that node in the gap). |
| `motion` | | How it, and what it holds, arrives and leaves. See [MOTION.md](MOTION.md). |
| `variants` | | Other looks of it, by name, for a motion to switch to: `{ asleep: { role, ghost, label, sub } }`. See [MOTION.md](MOTION.md#looks). |
| `around` | tunnel only | Route ids: the tunnel lights with those routes. |
| `nodes`, `regions` | | Contents. Their `at` is relative to this region's corner. |
| placement keys | | As for nodes, [below](#placement). |
| `appears`, `disappears` | | A step id or number. |

Nodes stand on a region's top: on a slab at 0.35, on a vm at its top, and so on. A fence has no floor; its
contents stand on what the fence stands on.

## Nodes

```yaml
nodes:
  - id: worker
    asset: session
    role: work
    label: NAME · worker
    sub: a shell, interactive
    size: [2.6, 2.6, 1.8]
    deco: [terminal: 4]
    appears: start
```

| Key | | |
|---|---|---|
| `id` | required | |
| `asset` | | From the library (default `block`). See [ASSETS.md](ASSETS.md). |
| `role` | | Colour role (default: the asset's). |
| `label`, `sub` | | The bold name and the mono line under it. Placed automatically above the node, clear of other nodes, labels and routes. |
| `label-at` | | `{ side: above \| right \| left \| below, dx, dy }` to put the label yourself (dx, dy in pixels). |
| `size` | | `[w, d]` or `[w, d, h]`. |
| `z` | | Lift above the floor. |
| `deco` | | Decorations, see [ASSETS.md](ASSETS.md#decorations). |
| `ghost` | | Dashed outline only. |
| `face`, `facing` | screen, monitor | What the screen shows (`terminal`, `chat`, `desktop`, `tiles`, or a face the host registers: one nothing registered draws a placeholder, with a warning); turn in degrees. |
| `nodes` | | Nodes standing on top of this one (files on a folder). |
| `motion` | | How it arrives and leaves: `{ style, out, easing, from, delay, duration }`. See [MOTION.md](MOTION.md). |
| `variants` | | Other looks of it, by name, for a motion to switch to: `{ asleep: { role, ghost, label, sub, face, deco } }`. See [MOTION.md](MOTION.md#looks). |
| placement keys | | [Below](#placement). |
| `appears`, `disappears` | | A step id or number: hidden before / from that step. Routes to a hidden node hide with it. |

## Placement

Each item is placed in its container's frame (the scene, a region, or a node with `nodes:`):

| Key | Meaning |
|---|---|
| `at: [x, y]` | The item's corner (smallest x and y), relative to the container's corner; in the scene, absolute. |
| `right-of: ID` | Next to a sibling on its +x side, `gap` away. |
| `left-of: ID` | On its −x side. |
| `below: ID` | On its +y side (toward the viewer). |
| `behind: ID` | On its −y side. |
| `gap` | Distance for this item (default: the scene's `gap`, 2). |
| `align` | `center` (default), `start` or `end`, on the other axis. |
| `shift: [dx, dy]` | A nudge after placement. |
| `in: REGION` | For a scene-level item: put it inside a region instead of writing it there. |
| *(none)* | After the item written before it, in the container's `flow` (a row by default); the first goes at the padding. |

Relative placement works between items in the same container; a reference to an item elsewhere is an error that
says where each one is. Overlapping nodes, and nodes sticking out of a sized region, are warnings.

## Routes

```yaml
routes:
  - { id: w-g, from: worker.w, to: proxy, kind: send }
  - id: a-run
    from: sched.s
    to: worker.e
    kind: control
    via: [[2.7, 6.4], [23.4, 6.4]]
    cross: true
    label: "job run …"
```

| Key | | |
|---|---|---|
| `id`, `from`, `to` | required | Ends are `node` or `node.side`. Without a side, the side facing the other end is used. |
| `kind` | | The flow kind (default `send`), which sets colour, dash and legend. |
| `via` | | Waypoints: grid points `[x, y]` or `node.side` refs. |
| `points` | | An exact polyline `[[x, y], …]` or `[[x, y, z], …]`; skips the router. |
| `cross` | | The route may pass through fence walls. Otherwise it leaves a fence only through its gate. |
| `arrow` | | `false` for no arrowhead. |
| `label` | | Text on the floor beside it: a string, or `{ text, along, side, at, dir, anchor }`. |
| `appears`, `disappears` | | As for nodes. |

The router draws orthogonal paths on the floor around other nodes. Routes sharing a side of a node get parallel
lanes 0.6 apart. Where a path crosses onto a slab or platform it steps up at the edge. A label goes beside the longest
level segment, on the side where nothing drawn over the floor would hide it. If nowhere fits, the label is shortened
with "…", or dropped, and you get a warning at its line. Pin it with `along: N` (the Nth segment), `side: left |
right`, or `at: [x, y, z]`.

## Notes

Free text that isn't a node's label:

```yaml
notes:
  - { floor: "FENCE · OR SANDBOX", at: [28.3, -5.75, 0.6], kind: planned, anchor: middle }
  - { face: "ISOLATED · MICRO VM", on: vm }
  - { label: example.org, sub: web console, at: [29, 0, 1.6] }
  - { floor: shared as /workspace, on: dir-vm }          # on a route: dims and lights with it
```

`floor:` lies on the floor (`dir: x | y`), `face:` stands on a front face, `label:`/`sub:` stand upright. Place
with `at` or `on` (a node, region or route), and `dx`, `dy`, `anchor`.

## Steps

```yaml
steps:
  - id: speaks
    kind: send
    heading: The worker speaks up
    caption: "`dozchat send` posts with “Bearer placeholder”. The proxy swaps in the real token …"
    command: 'dozchat send NAME "ready: /workspace"'
    animate: [w-g, [g-c: token], [c-a, c-j: user]]
    pulse: [proxy]
    say: [{ at: worker, text: "ready: /workspace" }]
```

| Key | | |
|---|---|---|
| `heading` | required | The step's title in the caption bar and the text list. |
| `id` | | For `appears:`, `show:` and badges to refer to. |
| `number` | | The number shown (default: its position). Two steps may share one. |
| `kind` | | Colours the number, progress bar and pulses (default `control`). |
| `caption`, `command` | | Text under the heading, and a command line shown as code. |
| `animate` | | **Phases, run in turn.** A phase is a route id, or a list of route ids that run together. `route: kind` sends that route's token in another kind's colour, as a token that changes colour at a proxy. A `blocked` token stalls and falls back. |
| `pulse` | | Nodes or regions that pulse. |
| `highlight` | | Other ids to keep lit. |
| `focus` | | Nodes or regions to zoom to: the view eases in to frame them (keeping the drawing's proportions), and back out on the next step without `focus`. `#still` jumps there. |
| `show`, `hide` | | Ids that appear or disappear from this step on. |
| `say` | | Callout pills for this step: `{ at: node or [x, y, z], text, kind, dx, dy, anchor }`. Placed where asked if that is clear, else moved clear of labels and nodes. |
| `mark` | | Red ✕ marks: `{ on: route }` (at its end) or `{ at: [x, y, z] }`. |
| `badge` | with `badges: true` | `false`, a route or node id, or a point `[x, y, z]` (default: the middle of the first animated route). |
| `duration` | | Milliseconds, or `auto` (from the caption's length: 5.6 to 12.5 s). |

A step lights what it animates (and their ends), what it pulses, what it highlights, the regions around them, and
tunnels around its routes; the rest dims. With `dim: all`, nodes and regions dim too.

## Grid

```yaml
grid: { snap: 0.5 }          # at the top of the file, or in a scene
```

| Key | |
|---|---|
| `snap` | Round every placed edge, and every `via` point, to this step (grid units). Off by default. |
| `show` | Draw the floor grid when the page opens. Off by default. The **Grid** button turns it on and off. |
| `step` | Spacing of the drawn lines (default: `snap`, or 1). |

Snapping happens after relative placement, edge by edge. Rounding keeps order, so a node inside a region stays inside
and two nodes that didn't overlap still don't. A box is never smaller than one step, and two neighbours that end up
touching get the usual overlap warning. Heights are not snapped. With `snap` on, `check` warns at any `at:` or `via:`
value that isn't on the grid, and says where it is drawn instead.

The grid is drawn on each region's top (slabs, pads, sandboxes, platforms), faintly, under everything on it. The
address flag `#grid` turns it on.

## Assemble

```yaml
assemble: true               # at the top of the file, or in a scene
```

When the scene comes into view, it builds itself, then the step player starts:

1. Regions fly in, outer ones first (slabs, then the regions inside them).
2. Nodes follow, back to front, with a short stagger.
3. Routes draw in and labels fade in.

Each part starts just outside the drawing, at the edge nearest where it ends up, and settles into place with easing.
The whole intro takes about 1.5 to 2.5 seconds. Parts that appear at a later step stay hidden. The **Assemble** button
plays it again in any scene, with or without `assemble: true`. Pressing Play, ‹ › or a step dot during the intro
finishes it at once.

Reduced motion and `#still` skip the intro and draw everything in place. For pictures, `#assemble&at=MS` freezes the
intro at a moment in milliseconds. `examples/grid-assemble.yaml` uses both features.

## Kinds and the legend

| Kind | Colour token | Line | Default legend |
|---|---|---|---|
| `send` | `--send` (blue) | solid | Message sent |
| `reply` | `--reply` (green) | solid | Reply or answer |
| `user` | `--user` (purple) | solid | The human |
| `token` | `--token` (amber) | dashed | Token, placeholder or swap |
| `blocked` | `--blocked` (red) | dotted | Blocked or refused |
| `control` | `--control` (grey) | solid | Setup or control |
| `event` | `--event` (pink) | solid | Wake or event |
| `planned` | `--token` (amber) | dashed | Not built |

Change a legend, or add a kind:

```yaml
kinds:
  user: { legend: The operator · web console }
  audit: { like: control, color: "#0aa", dash: dashed, legend: Audit log }
```

## Themes

A theme is a YAML file of tokens (`themes/default.yaml`): page colours, the lightness of each block face, slab and pad
colours, flow-kind colours (`light:` and `dark:` sections), the flow kinds, and the colour roles. Pages follow the
system's light or dark setting, and the Theme button (or `#theme=light|dark` in the address) picks one. To make your
own, copy `themes/default.yaml`, change values, and set `theme: my-theme.yaml`.

## The player and the page

Each scene with steps gets a player: ‹ ▶ ›, step dots, the caption, the command and a progress bar. Every scene gets
**Grid** and **Assemble** buttons. Arrow keys step when the figure has focus. Only the scene most in view animates.
With reduced motion, the whole diagram is lit and the text list of steps is open. The address can carry:

| Flag | |
|---|---|
| `#scene=ID&step=N` | Open a scene at a step. |
| `#still` | No motion: tokens frozen mid-route, controls hidden (for screenshots); `&t=0.6` says where. |
| `#theme=light`, `#theme=dark` | Pick a theme. |
| `#grid` | Show the floor grid. |
| `#assemble`, `#assemble&at=MS` | Play the intro, or freeze it at a moment. |
| `#motion` | Ignore the reduced-motion setting. |

## YAML traps

isodiag points these out, but they are worth knowing:

- Text containing `: ` (colon, space) must be quoted: `command: 'dozchat send NAME "ready: /workspace"'`.
- Inside `{ … }`, a comma starts a new key: `label: "read once, at launch"` needs quotes.
- Text starting with `@`, `` ` ``, `*`, `&`, `!`, `%`, `{`, `[` or `#` must be quoted.
- Long text reads best as a folded block: `caption: >-` and the text indented on the next lines.
