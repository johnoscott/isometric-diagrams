# Write your own editor on @johnoscott/isometric-engine

This guide is for someone who has only the published package. You describe your file format to the engine (an
**adapter**) and how a file is drawn (a **view**). The editor around them comes from the package: the tree, the
properties panel, the canvas in 3D and 2D, the palette, menus, keys, problems, undo and save.

The running example is **boxes/1**, a small format of boxes, trays and links. A larger case on the same contract is a
cloud architecture editor: two kinds (groups and resources), 31 resource types, nested groups, and connections with
labels. Everything below scales to it unchanged.

```yaml
format: boxes/1
title: Two trays
boxes:
  shelf: { kind: tray, label: Shelf }    # a tray or a zone holds boxes
  a: { in: shelf, label: A }
  b: { in: shelf, label: B }
  floor: { kind: zone, label: Floor }
  c: { in: floor, label: C }
links:
  - { from: a, to: b }
  - { from: b, to: c }
```

## 1. What the editor gives you

All of this comes from `@johnoscott/isometric-engine/editor`, namespace `editor`:

- **The document model and undo.** The text is the truth. Every edit, from the tree, the canvas, the properties or
  a command, is a splice of the text, so comments and formatting survive and undo is one step per action.
- **Commands** (`editor.commandsFor(adapter)`): set, insert, rename (every reference follows), delete (optionally with
  every reference), duplicate, paste, and pins.
- **The canvas**: your drawing in 3D, with selection, a marquee, pan and zoom, and pins (a dragged object is pinned in
  the file). It also has a **2D view** that you opt into: the same drawing laid out flat, with a 3D | 2D switch.
- **The outline (tree)**, **properties** (from your JSON Schema), **problems**, **palette**, **menus** and **keys**.
- **Optional, when you say how** (0.10.0): palette **presets** (a box, a tray, a database… each starting as itself),
  **connecting** two objects by dragging from one to the other, and **grouping** the selection into a new container.
  Each writes the file as your adapter says, as one undo step.
- **`editor.mountEditor(element, options, setup)`**, which puts it all on a page, where `setup = editor.setupFor(adapter,
  view)`.

The other namespaces in the same import are the layers underneath: `core` (parsing, themes, the SVG kernel),
`objects` (object kinds, layout, routing and `compileRaw`, which turns a drawing into SVG) and `viewer` (pan and zoom,
overlays, CSS scoping, the 2D view and the morph).

## 2. The adapter and the view

The adapter is plain data and functions, with no DOM. Field by field:

- `id`: the format's name. `role(text)` says whether a text is a `'main'` file (or a `'base'` that others extend).
- `schema(role)`: a JSON Schema. The properties panel and completion are built from it, and `enum`s become choices.
- `read(text)`: your reader. It returns `diags`, each with a JSON-pointer `path` (the editor places it from the text),
  and `read`, your own reading, which your view draws.
- `kinds`: the things a file holds, each in a map of its own (`section`), with a `template()` for a new one. Names are
  unique across all kinds.
- `objectOf(pointer)` and `describe(path)`: which object a pointer is inside, and a path in words ("box a").
- `refs(data)` and `slotAt(pointer)`: every place whose value names another object (`in:`, `from:`, `to:`), with the
  slot it is in. Renaming and deleting are built on them.
- `renameRef(ref, to)`: a reference's new text when its target is renamed.
- `refDeletePath(path)`: what deleting a reference removes along with its target. That's the reference itself, or
  the entry that holds it (a link without its `to` is no link: remove `/links/3`, not `/links/3/to`).
- `topOrder`, `outline`, `pins`, `snippets`, `copyValue`, `entryGroups`, `keyMessage`, `noun`: the details, shown in
  the example.

The view (`editor.DomainView`) says how a reading is drawn:

- `draw(read, data, theme)`: build the engine's drawing (`objects.compileRaw` with your catalogue) and return its
  `scene` and `svg`. Also return `pathOf`, a map from each drawn element's `data-id` to the JSON pointer it shows (a
  click on the canvas selects that path), and `pinId`, the element a pin moves.
- `catalog`: your object kinds (`objects.KindCatalog`): region kinds by shape, and node kinds that draw themselves.
- `icons`: your kinds' icons, as 24 × 24 SVG bodies by name. `icon(kind)` chooses one for each kind.
- `flat`: the 2D view. Give `load` (it returns `editor.flatCanvas`) and each link kind's style. Leave it out and the
  canvas is 3D only. The switch morphs between the views; `motion: 'always'` morphs even under reduced motion,
  `'never'` swaps at once (the default, `'auto'`, honours the reader's setting).

```ts
// file: boxes.ts
import { core, objects, editor } from '@johnoscott/isometric-engine/editor';

type Raw = Record<string, unknown>;
const isMap = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);

/** a tray (a block that holds boxes), a zone (a tint on the floor that holds boxes), a box */
export const CATALOG: objects.KindCatalog = {
  regions: {
    tray: { shape: 'block', pad: 0.6, z: [0, 0.3], floor: true, role: 'server', labelStyle: 'floor' },
    zone: { shape: 'zone', pad: 0.5, z: [0, 0.005], floor: false, role: 'grey', labelStyle: 'floor' },
  },
  nodes: { box: objects.boxAsset('box', 'A box', [2, 2, 1], 'lead') },
  defaultNode: 'box',
};
const HOLDERS = ['tray', 'zone'];

export interface Box { name: string; kind: string; in?: string; label?: string; path: string }
export interface Boxes { data: Raw; boxes: Box[]; links: { from: string; to: string; path: string }[] }

/** read a text: the boxes, the links, and what is wrong (each at its JSON pointer) */
export function readBoxes(text: string): { diags: core.Diag[]; read?: Boxes } {
  const p = core.parse(text);
  const diags: core.Diag[] = [...p.diags];
  const bad = (path: string, message: string) => diags.push({ severity: 'error', message, line: 0, col: 0, path });
  if (!isMap(p.data)) return { diags };
  const data = p.data, boxes: Box[] = [];
  if (data.format !== 'boxes/1') bad('/format', 'format: must be boxes/1');
  for (const [name, v] of Object.entries(isMap(data.boxes) ? data.boxes : {})) {
    const b = isMap(v) ? v : {}, path = editor.toPointer(['boxes', name]);
    const kind = typeof b.kind === 'string' ? b.kind : 'box';
    if (kind !== 'box' && !HOLDERS.includes(kind)) bad(`${path}/kind`, `unknown kind "${kind}": box, tray or zone`);
    boxes.push({ name, kind, in: typeof b.in === 'string' ? b.in : undefined, label: typeof b.label === 'string' ? b.label : undefined, path });
  }
  const byName = new Map(boxes.map(b => [b.name, b]));
  for (const b of boxes) if (b.in !== undefined && !HOLDERS.includes(byName.get(b.in)?.kind ?? '')) bad(`${b.path}/in`, `no tray or zone "${b.in}"`);
  const links: Boxes['links'] = [];
  (Array.isArray(data.links) ? data.links : []).forEach((l, i) => {
    const x = isMap(l) ? l : {}, path = editor.toPointer(['links', i]);
    for (const k of ['from', 'to']) if (!byName.has(String(x[k]))) bad(`${path}/${k}`, `no box "${String(x[k] ?? '')}"`);
    links.push({ from: String(x.from), to: String(x.to), path });
  });
  return { diags, read: { data, boxes, links } };
}

// ---- references: every value that names another box ----
const SLOTS: editor.RefSlot[] = [
  { at: ['boxes', '*', 'in'], targets: ['boxes'], what: 'the tray or zone it is in' },
  { at: ['links', '#', 'from'], targets: ['boxes'], what: "a link's start" },
  { at: ['links', '#', 'to'], targets: ['boxes'], what: "a link's end" },
];
function refs(data: unknown): editor.Ref[] {
  const out: editor.Ref[] = [], d = isMap(data) ? data : {};
  for (const [name, v] of Object.entries(isMap(d.boxes) ? d.boxes : {}))
    if (isMap(v) && typeof v.in === 'string') out.push({ path: editor.toPointer(['boxes', name, 'in']), slot: SLOTS[0], value: v.in, name: v.in });
  (Array.isArray(d.links) ? d.links : []).forEach((l, i) => {
    for (const [j, k] of [[1, 'from'], [2, 'to']] as const)
      if (isMap(l) && typeof l[k] === 'string') out.push({ path: editor.toPointer(['links', i, k]), slot: SLOTS[j], value: l[k] as string, name: l[k] as string });
  });
  return out;
}
const slotAt = (ptr: string) => {
  const parts = ptr.split('/').slice(1);
  return SLOTS.find(s => s.at.length === parts.length && s.at.every((seg, i) => seg === '*' || (seg === '#' ? /^\d+$/.test(parts[i]) : seg === parts[i])));
};

export const boxesAdapter: editor.DomainAdapter = {
  id: 'boxes/1',
  role: () => 'main',
  schema: () => ({
    type: 'object', properties: {
      format: { const: 'boxes/1' }, title: { type: 'string', description: "The drawing's title." },
      boxes: { type: 'object', additionalProperties: { type: 'object', properties: {
        kind: { enum: ['box', 'tray', 'zone'], description: 'A box, or a tray or zone that holds boxes.' },
        in: { type: 'string', description: 'The tray or zone it is in.' }, label: { type: 'string' } } } },
      links: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } } },
    },
  }),
  read(text) { const r = readBoxes(text); return { diags: r.diags, read: r.read }; },
  keyMessage: /^unknown kind/,
  kinds: [{ kind: 'boxes', section: ['boxes'], singular: 'box', group: 'Boxes', template: () => ({ label: 'New box' }) }],
  noun: 'box',
  objectOf(ptr) { const m = /^\/boxes\/([^/]+)/.exec(ptr); return m ? { kind: 'boxes', name: m[1], path: `/boxes/${m[1]}` } : undefined; },
  describe(p) { return p.length === 2 && p[0] === 'boxes' ? `box ${p[1]}` : p.join('.') || 'the file'; },
  entryGroups: [],
  refs, slotAt,
  renameRef: (_ref, to) => to,
  // a link loses its from or to: the link goes, not just the key
  refDeletePath: p => (p[0] === 'links' ? p.slice(0, 2) : p),
  copyValue: (_kind, v) => v,
  topOrder: ['format', 'title', 'boxes', 'links', 'x-editor'],
  pins: { key: 'x-editor', legacyOnly: () => false },
  snippets: {},
  outline: { kinds: ['boxes'], first: ['format', 'title'], groups: [{ key: 'links', label: 'Links' }], rootLabel: d => String(d.title ?? 'boxes') },
};

/** the drawing: trays and zones as regions, boxes as nodes, links as routes; pins from x-editor.layout */
export function drawBoxes(r: Boxes, data: unknown, theme: string): editor.CanvasDrawing {
  const pins = isMap(data) && isMap(data['x-editor']) && isMap(data['x-editor'].layout) ? data['x-editor'].layout : {};
  const at = (name: string) => { const v = pins[name]; return isMap(v) && Array.isArray(v.at) ? { at: v.at as [number, number] } : {}; };
  const kids = (name?: string) => r.boxes.filter(b => b.in === name);
  const region = (b: Box): objects.RawRegion => ({ id: b.name, kind: b.kind, label: b.label ?? b.name, ...at(b.name),
    regions: kids(b.name).filter(c => c.kind !== 'box').map(region), nodes: kids(b.name).filter(c => c.kind === 'box').map(node) });
  const node = (b: Box): objects.RawNode => ({ id: b.name, asset: 'box', label: b.label ?? b.name, ...at(b.name) });
  const title = String(r.data.title ?? 'boxes');
  const doc: objects.RawDiagram = { isodiag: 1, title, scenes: [{ id: 'boxes', title,
    regions: kids(undefined).filter(b => b.kind !== 'box').map(region), nodes: kids(undefined).filter(b => b.kind === 'box').map(node),
    routes: r.links.map((l, i) => ({ id: `link-${i}`, from: l.from, to: l.to, kind: 'send' })) }] };
  const compiled = objects.compileRaw(doc, theme, CATALOG), scene = compiled.scenes[0];
  return {
    scene, svg: scene.rendered.svg,
    // every drawn element's data-id → the JSON pointer it shows: a click on the canvas selects that
    pathOf: new Map([...r.boxes.map(b => [b.name, b.path] as [string, string]), ...r.links.map((l, i) => [`link-${i}`, l.path] as [string, string])]),
    pinId: new Map(r.boxes.map(b => [b.name, b.name])), pinNotes: [],
    diags: compiled.diags.filter(d => d.severity === 'error').map(d => d.message),
  };
}

/** the view: the drawing, the catalogue, the theme, and the 2D view */
export const boxesView = (theme: string): editor.DomainView<Boxes, editor.CanvasDrawing> => ({
  draw: drawBoxes, catalog: CATALOG, theme, fileName: 'boxes.yaml', words: { brand: 'boxes' },
  flat: { load: async () => editor.flatCanvas, title: 'boxes, flat', styles: { send: { color: 'send' } } },
});
```

### Presets, connecting and grouping (0.10.0)

Three optional pieces. Give one and the editor offers it; leave it out and nothing changes.

- **Palette presets**, on the view: `palette: [{ kind, label, icon?, value?, name? }]`. Each entry adds an object of
  `kind` starting as a copy of `value` (default: the kind's `template()`), named from `name` (default: the kind's
  singular). Without it, the palette has one entry per kind. **Sections** (0.11.0): give entries a `section` and the
  palette lists them under a header per section, in the order the sections first appear; each header opens and closes
  its entries (a button, `aria-expanded`). At the start every section is closed but the one last added from (kept in
  the host's `storage` as `canvas-palette`; the first section before any). Entries without one are listed as before. **Docked**
  (0.12.0): `paletteLayout: 'docked'` on the view puts the palette in a pane of its own at the canvas's left, instead of
  floating over it: a search box at its top filters the entries by label and section (Enter adds the first match, ↓
  goes into the list, Esc clears it), the sections are its collapsible groups, a grip resizes it and a control
  collapses it to a strip (both kept in the host's `storage` as `canvas-palette-dock`). Drag and Enter add as before.
  `'floating'` is the default. **Looks** (0.14.0): `paletteLook: 'object'` shows each entry as the thing it makes, drawn small
  in the drawing's own style (an entry that can't be drawn alone, in a file with only your plain values, keeps its icon).
- **Connect**, on the adapter: `connect(from, to, data)` returns where a connection goes and what it is, `{ at, value }`
  to add to a list (or with `name`, to a map under a fresh name), or `undefined` when those two don't connect. The
  canvas then shows a handle on the one selected object: drag it to another (Esc cancels), or use **Connect to…** in
  its menu and click the other.
- **Drop into** (0.10.1), on the adapter: `dropInto(target, value, kind, data)` returns the new thing's value inside
  `target` (and words for it), or `undefined` when `target` doesn't hold it. A palette drop asks what is under it,
  innermost first, and the first that holds it takes it; with none, the drop is pinned where it lands. In 3D the palette
  drags the thing itself (0.14.0), in a trial drawing of the file with it, so the grid, the target and what it lands in are
  seen before the drop; in a container it is pinned where it is dropped, unless that is the layout's own place for it.
- **Growing a group** (0.28.0): a thing dragged past the right or front edge of a group that fits what it holds (no `size`) isn't
  held there: the group grows under it, cell by cell, its floor as it was drawn dashed, within 2 cells of the furthest the pointer
  has been (`GROW_REACH`). The drop is the pin, one undo step; no `size` is written, so the group keeps fitting. A group with a size
  holds it at its edges, as before ("fixed size: resize it to fit more"). Left and back wait for a decision: `GROW_SIDES` in
  `src/iso-editor/ui/canvas.ts` says which sides grow, and which handles a resize has.
- **Resize handles** (0.28.0), on the adapter: `sizeAt(group)` returns the path a group's `size` ([w, d]) is written at, or
  `undefined` (that one isn't resized). Given it, the one selected group shows handles on its floor: the front-right corner (width
  and depth), and the middles of its right side (width) and front side (depth); 44 px targets on a touch screen. A drag snaps to
  whole cells (⌥: half), never below what the group holds needs (it stops there: "no smaller"), and writes the size as one step
  ("Resize <group>"). A double click on a handle, or **Fit to contents** in the group's menu, takes the size away (it fits again).
  Esc cancels a resize.
- **Making way** (0.14.0): a drag held still over a taken cell makes what is there step aside (after 700 ms; `dragMotion:
  'respect'` on the view leaves out the jiggle and the glide under Reduce Motion). What moved is pinned, in the same undo step.
- **Group**, on the adapter: `group(members, data)` returns the new container (`at`, the base of its `name`, its
  `value`) and `members(name)`, what changes in each member once it has a name. **Group** in the menu, or ⌘G, writes
  it all as one step; members' pins are dropped, so the layout places them in their new container.

```ts
// boxes/1's: a link between two boxes (not twice), and the selection into a new zone in what they were all in
type Data = { boxes: Record<string, { in?: string }>; links?: { from: string; to: string }[] };
connect: (from, to, data) =>
  (data as Data).links?.some(l => l.from === from.name && l.to === to.name) ? undefined
    : { at: ['links'], value: { from: from.name, to: to.name } },
group: (members, data) => {
  const ins = new Set(members.map(m => (data as Data).boxes[m.name]?.in));
  return {
    at: ['boxes'], name: 'group', value: { kind: 'zone', label: 'Group', ...(ins.size === 1 && [...ins][0] ? { in: [...ins][0] } : {}) },
    members: name => members.map(m => ({ path: ['boxes', m.name, 'in'], value: name })),
  };
},
// and on the view
palette: [
  { kind: 'boxes', label: 'Box', name: 'box', value: { size: [2, 2, 1] } },
  { kind: 'boxes', label: 'Tray', icon: 'layers', name: 'tray', value: { kind: 'tray', label: 'Tray' } },
],
```

## 3. A page

```
npm i @johnoscott/isometric-engine
npm i -D esbuild
```

The page mounts the editor with the plain skin. Its CSS and the theme are files in the package, which a bundler loads
as text:

```ts
// file: page.ts
import { core, objects, viewer, editor } from '@johnoscott/isometric-engine/editor';
import { boxesAdapter, boxesView, CATALOG } from './boxes.ts';
// @ts-ignore text (esbuild: loader { '.css': 'text', '.yaml': 'text' })
import SKIN from '@johnoscott/isometric-engine/assets/skin.css';
// @ts-ignore text
import APP from '@johnoscott/isometric-engine/assets/app.css';
// @ts-ignore text
import THEME from '@johnoscott/isometric-engine/assets/default-theme.yaml';

const theme = String(THEME), root = editor.PLAIN_WORDS.rootClass, canvas = '.iso-canvas';
const style = document.createElement('style');
style.textContent = [
  '@layer tokens, base, components, views;',
  editor.scopeCss(String(SKIN) + String(APP), root),                                     // the shell
  viewer.scope(viewer.isoVars(core.themeCss(core.loadTheme(theme))), canvas, root),      // the theme's tokens
  viewer.scope(viewer.isoVars(objects.drawingCss(CATALOG) + objects.MARKS_CSS), canvas, root), // the drawing
  viewer.scope(viewer.isoVars(viewer.flatCss({ send: { color: 'send' } })), canvas, root),     // its 2D view
].join('\n');
document.head.append(style);

const text = 'format: boxes/1\ntitle: Two trays\nboxes:\n  shelf: { kind: tray }\n  a: { in: shelf }\n  b: { in: shelf }\nlinks:\n  - { from: a, to: b }\n';
const el = document.getElementById('app')!;
const ed = editor.mountEditor(el, { text, onSave: async t => { localStorage.setItem('boxes', t); return { ok: true }; } },
  editor.setupFor(boxesAdapter, boxesView(theme)));
(window as unknown as { editorHandle: unknown }).editorHandle = ed;
document.title = 'ready';
```

`assets/app.css` carries the canvas's marks too (selection, hover, the marquee, the drag's grid, problem badges), in
the skin's accent; a host that writes its own shell CSS takes `assets/marks.css` instead, and may set `--iso-sel` on
`.iso-canvas` for another colour. Without either, the marks still draw no fill and never take the pointer.

```
npx esbuild page.ts --bundle --format=esm --outfile=dist/page.js --loader:.css=text --loader:.yaml=text
```

Its `index.html` gives the editor a sized element: `<div id="app" style="height:100vh"></div>`, then
`<script type="module" src="page.js"></script>`.

- **CSP.** The editor runs under `script-src 'self'` (no `unsafe-eval`). Styles go in through a `<style>` element, so
  allow `style-src 'self' 'unsafe-inline'`.
- **Inline-safe.** No bundle holds `<!--`, `<script` or `</script`. Your page may inline its bundle in
  `<script type="module">…</script>` (a page opened from disk), and a bundler printing the package again keeps it so.
- **Theme.** `assets/default-theme.yaml` is a theme. Your own adds roles (colours by name) and link kinds. The page
  follows `prefers-color-scheme`, or `data-theme="light" | "dark"` on the root.

## 4. What needs what

| You want | You need |
|---|---|
| to draw or render only (`/render`, `/systems`) | the package alone: it has no dependencies |
| the editor (`/editor`) | the package; its code needs nothing else |
| to type-check against `/editor` | `yaml` and `monaco-editor` installed, for their types (or `skipLibCheck`) |
| a text pane beside the tree and canvas | your own pane on the `TextPane` interface (`editor.PaneOpts`), given as `setupFor`'s third argument, and Monaco in your bundle. The package ships none (Monaco is large); without one, the tree, canvas and properties make a complete editor |
| the 2D view | `view.flat` with `load: async () => editor.flatCanvas`, and `viewer.flatCss(styles)` in your canvas CSS |
| isodiag/1 YAML drawings | `/systems`: `systems.compile(yaml, theme)` (see the README) |
| palette presets (0.10.0) | `view.palette` |
| connecting by drag, Connect to… (0.10.0) | `adapter.connect` |
| Group, ⌘G (0.10.0) | `adapter.group` |
| a palette drop that lands inside a container (0.10.1) | `adapter.dropInto` |
| a selected group's resize handles, Fit to contents (0.28.0) | `adapter.sizeAt` |
| palette sections under collapsible headers (0.11.0) | `view.palette[].section` |
| the palette docked at the canvas's left, searchable (0.12.0) | `view.paletteLayout: 'docked'` |
| the palette's entries as what they make (0.14.0) | `view.paletteLook: 'object'` |
| a drag's jiggle and glide, under Reduce Motion (0.14.0) | `view.dragMotion: 'respect'` (default: `'always'`) |
| a double click on an object renames it, in place (0.12.5) | `view.doubleClick: 'rename'` (default: shows it in the text) |

## 5. Testing your adapter

What we test on every adapter. Each is a few lines with the commands and the splice they make:

```ts
// file: boxes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editor } from '@johnoscott/isometric-engine/editor';
import { boxesAdapter, readBoxes } from './boxes.ts';

const TEXT = 'format: boxes/1\nboxes:\n  shelf: { kind: tray }\n  a: { in: shelf }\n  b: { in: shelf }\nlinks:\n  - { from: a, to: b }\n  - { from: b, to: a }\n';
const C = editor.commandsFor(boxesAdapter);
const run = (text: string, cmd: { build(t: string): { steps: Parameters<typeof editor.applyStep>[1][] } }) =>
  cmd.build(text).steps.reduce((t, s) => editor.applyStep(t, s), text);

test('every reference is found', () => {
  const r = readBoxes(TEXT).read!;
  assert.deepEqual(boxesAdapter.refs(r.data).map(x => x.path), ['/boxes/a/in', '/boxes/b/in', '/links/0/from', '/links/0/to', '/links/1/from', '/links/1/to']);
});

test('a rename follows every reference, and the result reads cleanly', () => {
  const out = run(TEXT, C.renameCmd(['boxes', 'shelf'], 'rack'));
  assert.match(out, /a: \{ in: rack \}/);
  assert.deepEqual(readBoxes(out).diags, []);
});

test('a delete with its references leaves none dangling', () => {
  const out = run(TEXT, C.deleteCmd(['boxes', 'a'], { withRefs: true }));
  assert.doesNotMatch(out, /\ba:|from: a|to: a/);
  assert.deepEqual(readBoxes(out).diags, []);
});
```

In a browser, a smoke test mounts the page and checks the following:
- the drawing has every object (`[data-id="a"]` in the canvas's SVG);
- a click on one selects it in the tree (`.trow[aria-selected="true"]`);
- F2 renames it with its references, and ⌘Z undoes that in one step;
- every icon resolves (each `<use href>` finds its `<symbol>`);
- there are no console errors and no CSP violations (listen for `securitypolicyviolation`).

Drive Chrome headless over the DevTools protocol. Use `--headless=new` with a throwaway `--user-data-dir`, and serve
the page from a free port or through `Fetch.fulfillRequest`, so test runs never collide.
