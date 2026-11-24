# Motion as a function of time

A drawing can arrive, leave, or be anywhere in between, as a function of time: no clock, no DOM and no randomness that
isn't seeded, so frame 412 is the same in any order, in any process, on any machine. It is what a video renderer needs
(Remotion asks for frames out of order, in parallel, headless), and what the page's own assemble plays.

```js
import { systems, objects } from '@johnoscott/isometric-engine/systems';   // or { assemble, bindMotion, motion, … } from '…/motion'

const c = systems.compile(yaml, theme, { mode: 'dark', resolveVars: true, strict: 'throw' });
const plan = objects.assemble(c.scenes[0], { style: 'drop', order: 'by-region', duration: 1800, seed: 7 });
plan.duration;                       // ms
plan.frame(600);                     // the scene's SVG at 600 ms, as text
const state = plan.at(600);          // the same moment as plain JSON
objects.svgAt(c.scenes[0], state);   // === plan.frame(600)
objects.paint(svgElement, state);    // the same on a live drawing, in place
```

## Plans

`assemble(scene, options)` and `disassemble(scene, options)`. An assemble's `frame(0)` is empty and its
`frame(duration)` is the still render, **byte for byte**; a disassemble's are the other way round. Times past an end are
that end.

| Option | |
|---|---|
| `style` (assemble) | `edge` (the default: from the nearest edge of the canvas), `drop`, `rise` (up through the floor), `fly` (from `from`), `pop`, `scatter`, `build` (layer by layer), `fade` |
| `style` (disassemble) | `fly-out` (the default), `explode` (from `point`), `lift-off`, `sink`, `scatter`, `collapse` (into `point`, or the region that holds each piece), `fade`, `reverse` (the assemble style `of`, backwards) |
| `order` | `by-depth`, `by-layer`, `by-region`, `by-flow` (along the connectors, from `source`), `as-listed`, `random` |
| `connectors` | `draw` (stroked in), `grow` (from the source), `fade`; the arrowhead shows once a connector is all there. `pulses: true`: a token runs along each, once |
| `labels` | `fade`, `type`, `with-piece` |
| `duration`, `stagger`, `piece`, `overlap` | the whole plan's length (everything is scaled to it), ms between starts, ms a piece takes, and how much (0 to 1) each part runs over the end of the one before |
| `easing` | `linear`, `ease`, `ease-in`, `ease-out`, `settle`, `spring`, `bounce` |
| `from`, `point`, `seed` | `left`, `right`, `top`, `bottom`; `[x, y]` in the drawing's units, or a piece's id; a number |

In the file, a node or a region may say its own (a region's is for what it holds too, the nearer winning):

```yaml
- { id: db, asset: server, motion: { style: pop, out: sink, easing: spring, delay: 200, duration: 900 } }
```

## States

`at(ms)` gives a `SceneState`: plain JSON, through `JSON.stringify` and back unchanged. What it doesn't name is as in the
still; `{}` is the still. A host may make its own:

| Key | |
|---|---|
| `items` | by id: `opacity`, `dx`, `dy`, `scale` (about `about`), `clip` (a polygon): a thing's block, walls, gate and name |
| `labels` | by the id of a thing, a connector or a note: `opacity`, or `typed` (0 to 1) |
| `routes` | by id: `opacity`, `drawn` (0 to 1) and `by` (`stroke` or `grow`), `ants` (`dash` and `offset`) |
| `tokens`, `pulses` | `{ route, at, color }` (a fraction along it); `{ x, y, rx, ry, opacity, color }` |
| `outlines`, `variants` | rings: `{ id, points, opacity }`; the looks of things and how much of each (0 to 1) |
| `marks`, `camera` | the step marks' and badges' `opacity`; the view, `[x, y, w, h]` |
| `morph` | a host's own (how far toward the 2D view): `svgAt` and `paint` draw the 3D view |

## A motion document

A document says what happens, in plain data (`isomotion: 1`): **beats** one after another, each with what it shows, what it lights, its
commentary, and what moves in it. It lives in the diagram's file (a scene's `motion:`) or on its own. Times are ms, or `"1.2s"`, or
`"30f"` with an `fps` at the top.

```yaml
# file: story.yaml
isodiag: 1
title: A request
scenes:
  - id: s
    title: A request
    ants: [q]
    nodes:
      - { id: web, asset: server, label: Web }
      - { id: api, asset: server, label: API }
      - { id: db, asset: volume, label: Data, variants: { asleep: { role: grey, sub: asleep } } }
    routes:
      - { id: r, from: web, to: api, kind: send }
      - { id: q, from: api, to: db, kind: send }
    motion:
      series:
        - sequence: { name: ask, say: { title: The question, text: "The page asks the API." }, hide: [db], highlight: [api], duration: 3s, children: [ { travel: [r], each: 900, loop: true } ] }
        - sequence: { name: data, say: { title: The data, text: "It reads from the store." }, show: [db], focus: { lit: [api, db] }, enter: { fade: 400 }, duration: { read: true } }
        - sequence: { name: rest, say: { title: At rest }, variants: { db: asleep }, levels: { db: 0.4 }, enter: { fade: 600 }, duration: 2s, ants: false }
```

```js
const c = systems.compile(yaml, theme), tl = objects.bindMotion(c.scenes[0], c.scenes[0].motion, { kinds: c.theme.kinds });
tl.ok; tl.diags;                // what is wrong, by path (a name that isn't there: with a near one)
tl.duration; tl.beats; tl.markers;
tl.at(1500);                    // the SceneState at 1500 ms: for svgAt and paint
tl.cues(1500);                  // the beat's commentary: { beat, chapter, index, of, progress, say }
systems.renderSvg(yaml, { theme, mode: 'dark', t: 1500 });   // the frame, as one SVG that needs nothing else
systems.renderSvg(yaml, { theme });                          // the still
```

| In a beat (a `sequence` of the top series) | |
|---|---|
| `name`, `say`, `duration` | its name; `{ chapter, title, text, code, facts, color }`; a time, or `{ read: true }`: as long as its words take |
| `show`, `hide` | ids: cumulative, so a beat opened first is as if reached. A thing's connectors hide with it |
| `focus` | `{ lit, scope: all or links, level, always }`: everything else dims |
| `highlight` | things ringed while it lasts |
| `levels` | how much of a thing or a connector is there (0 to 1); `"*"`: every one not named |
| `variants` | which of its [looks](#looks) a thing has from here on; `""`: its own |
| `enter` | `{ fade, easing }`: the ramp from the beat before |
| `ants` | `true`, ids, or `false`: marching dashes; not said: the file's |
| `children` | what moves: below |

| What moves | |
|---|---|
| `assemble`, `disassemble` | a plan, as above |
| `travel` | tokens along connectors, one after another; a nested list at once; `"id:kind"` colours one. `each`, `hold`, `loop` |
| `pulse`, `ants`, `draw`, `type` | a ring (`loop`); marching dashes (`speed`, `dash`); connectors drawn (`by`, `stagger`); labels typed |
| `move`, `lift` | a thing's `x`, `y`, `scale`, `opacity` as curves; things raised `by` so much, staggered, `to: up` or `down` |
| `focus`, `highlight`, `camera` | for part of a beat; `camera: { focus, zoom, margin }` or `fit` |
| `sequence`, `series`, `layers` | nesting, each with a clock of its own; a `series` may hold `transition`s |

Each takes `from`, `duration` and `easing` (a name, `{ bezier }` or `{ spring }`, which is Remotion's spring). `layers` at the top go over the
whole document, and `markers` name moments (`"data+1200"`).

**Two clocks.** `at(ms)` is the timeline's. What loops (ants, and a `travel` or `pulse` with `loop`) runs on an ambient one, so a player may pause the
story and leave them going: `at(ms, { ambient })`, the same as `ms` unless given. Held at a time, they stand where they were then; `'off'` (or
`ambient: off` in the document): they never ran, and each stands at its start. Nothing is hidden.

**In code**, the same document: `objects.motion()`.

```js
const doc = objects.motion()
  .beat('ask', { title: 'The question' }, { hide: ['db'], duration: '3s' }, b => b.travel(['r'], { each: 900, loop: true }))
  .beat('data', { title: 'The data' }, { show: ['db'], read: true, enter: { fade: 400 } }, b => b.camera.focus('db', { over: 600 }))
  .mark('answer', 'data+800')
  .toJSON();
```

## Looks

`variants:` on a node or a region names other looks of it: its own keys (`role`, `ghost`, `label`, `sub`, `face`, `deco`), over what it is. A beat's
`variants` switches to one, and `enter`'s fade crossfades. The box stays as it is, so nothing is laid out again. In a state it is
`variants: { id: { look: 0 to 1 } }`.

## Animating the SVG yourself

Every part of a thing is in a wrapper of its own, with no transform and no class: `<g data-item=ID data-part=…>`
(`block`, `wall-1`…, `gate`, `name`, `label`, `note`), and a connector's `<g data-route=ID data-part=…>` (`line`, with its
arrowhead's marker; `label`). `data-item` and `data-part` together are one wrapper's. Move and fade wrappers: the texts
inside have transforms, and some classes opacities, of their own. There is a wrapper a part and not one a thing, because
a thing's parts are painted in different layers (its label over every block). `data-id` is on every part of a thing.

## Self-contained drawings

`systems.compile(yaml, theme, { mode: 'light' | 'dark', resolveVars: true })`: each scene's SVG carries its colours and text
styles on its elements, with no stylesheet, custom properties, `hsl()` or `color-mix()`; frames of it too. `strict: true`
leaves `scenes` empty when the file has an error, `strict: 'throw'` throws a `CompileError` with its `diags`. `stepMs` gives
every step the same length. Fonts are the host's: the SVG names a stack and embeds none.
