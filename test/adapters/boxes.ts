// boxes/1 (R1 S8, docs/editor/LAYERS.md §6.3): a neutral format, opened in the editor through L0–L3's public API
// alone. It is the proof that the editor needs nothing of the space editor's to run: it imports only the layers'
// public modules (what their index.ts re-exports; not P, not L4), draws with a catalogue of its own (three kinds),
// and has its own Live marks.
//
//   format: boxes/1
//   title: Two trays
//   boxes:
//     shelf: { kind: tray, size: [10, 6] }      # a tray or a zone holds boxes; a box is drawn as a block
//     a: { in: shelf, label: A }
//     c: { size: [2, 2, 1] }
//   links:
//     - { from: a, to: c }
//   x-editor:
//     layout: { c: { at: [12, 0] } }            # the canvas's pins

import { parse } from '../../src/iso-core/parse.ts';
import type { Diag } from '../../src/iso-core/errors.ts';
import { iso } from '../../src/iso-core/kernel.ts';
import { parseSvg } from '../../src/iso-core/svg-dom.ts';
import { vdoc, serialize, type VNode } from '../../src/iso-core/vdom.ts';
import { compileRaw, type CompiledScene } from '../../src/iso-objects/compile.ts';
import { boxAsset } from '../../src/iso-objects/assets.ts';
import type { KindCatalog } from '../../src/iso-objects/kinds.ts';
import type { RawDiagram, RawRegion, RawNode } from '../../src/iso-objects/types.ts';
import { overlayPaint, type Mark } from '../../src/iso-viewer/overlay.ts';
import { rewrite } from '../../src/iso-viewer/still.ts';
import { toPointer } from '../../src/iso-editor/path.ts';
import type { DomainAdapter, Ref, RefSlot } from '../../src/iso-editor/adapter.ts';
import type { DomainView } from '../../src/iso-editor/ui/setup.ts';
import type { CanvasDrawing } from '../../src/iso-editor/ui/canvas.ts';
import type { CanvasCtx, CanvasLayer } from '../../src/iso-editor/ui/canvas-layer.ts';

type Raw = Record<string, unknown>;
const isMap = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);

/** the catalogue: a tray (a block that holds boxes), a zone (a tint on the floor that holds boxes), a box */
export const BOXES_CATALOG: KindCatalog = {
  regions: {
    tray: { shape: 'block', pad: 0.6, z: [0, 0.3], floor: true, role: 'server', labelStyle: 'floor' },
    zone: { shape: 'zone', pad: 0.5, z: [0, 0.005], floor: false, role: 'grey', labelStyle: 'floor' },
  },
  nodes: { box: boxAsset('box', 'A box', [2, 2, 1], 'lead') },
  defaultNode: 'box',
};
const HOLDERS = ['tray', 'zone'];

export interface Box { name: string; kind: string; in?: string; size?: number[]; label?: string; path: string }
export interface BoxesRead { data: Raw; boxes: Box[]; links: { from: string; to: string; path: string }[] }

const SLOTS: RefSlot[] = [
  { at: ['boxes', '*', 'in'], targets: ['boxes'], what: 'the tray or zone it is in' },
  { at: ['links', '#', 'from'], targets: ['boxes'], what: "a link's start" },
  { at: ['links', '#', 'to'], targets: ['boxes'], what: "a link's end" },
];
const slotAt = (ptr: string) => {
  const parts = ptr.split('/').slice(1);
  return SLOTS.find(s => s.at.length === parts.length && s.at.every((seg, i) => (seg === '*' ? !parts[i].startsWith('x-') : seg === '#' ? /^\d+$/.test(parts[i]) : seg === parts[i])));
};
function refs(data: unknown): Ref[] {
  const out: Ref[] = [];
  const d = isMap(data) ? data : {};
  for (const [name, v] of Object.entries(isMap(d.boxes) ? d.boxes : {})) if (isMap(v) && typeof v.in === 'string') out.push({ path: toPointer(['boxes', name, 'in']), slot: SLOTS[0], value: v.in, name: v.in });
  (Array.isArray(d.links) ? d.links : []).forEach((l, i) => { for (const [j, k] of [[1, 'from'], [2, 'to']] as const) if (isMap(l) && typeof l[k] === 'string') out.push({ path: toPointer(['links', i, k]), slot: SLOTS[j], value: l[k] as string, name: l[k] as string }); });
  return out;
}

/** read a boxes/1 text: the boxes and the links, and what is wrong (by JSON path) */
export function readBoxes(text: string): { diags: Diag[]; read?: BoxesRead } {
  const p = parse(text);
  const diags: Diag[] = [...p.diags];
  const bad = (path: string, message: string) => diags.push({ severity: 'error', message, line: 0, col: 0, path });
  if (!isMap(p.data)) { if (!diags.length) bad('', 'a boxes/1 file is a map'); return { diags }; }
  const data = p.data;
  if (data.format !== 'boxes/1') bad('/format', 'format: must be boxes/1');
  const boxes: Box[] = [];
  for (const [name, v] of Object.entries(isMap(data.boxes) ? data.boxes : {})) {
    if (name.startsWith('x-')) continue;
    const path = toPointer(['boxes', name]);
    if (!/^[a-z][a-z0-9-]*$/.test(name)) bad(path, `"${name}" can't be a name: a lower-case letter, then lower-case letters, digits and -`);
    const b = isMap(v) ? v : {};
    const kind = typeof b.kind === 'string' ? b.kind : 'box';
    if (kind !== 'box' && !HOLDERS.includes(kind)) bad(`${path}/kind`, `unknown kind "${kind}": box, tray or zone`);
    boxes.push({ name, kind, in: typeof b.in === 'string' ? b.in : undefined, size: Array.isArray(b.size) ? (b.size as number[]) : undefined, label: typeof b.label === 'string' ? b.label : undefined, path });
  }
  const byName = new Map(boxes.map(b => [b.name, b]));
  for (const b of boxes) if (b.in !== undefined && !HOLDERS.includes(byName.get(b.in)?.kind ?? '')) bad(`${b.path}/in`, `no tray or zone "${b.in}"`);
  const links: BoxesRead['links'] = [];
  (Array.isArray(data.links) ? data.links : []).forEach((l, i) => {
    const path = toPointer(['links', i]);
    const x = isMap(l) ? l : {};
    for (const k of ['from', 'to']) if (!byName.has(String(x[k]))) bad(`${path}/${k}`, `no box "${String(x[k] ?? '')}"`);
    links.push({ from: String(x.from), to: String(x.to), path });
  });
  return { diags, read: { data, boxes, links } };
}

/** the canvas's drawing: the boxes as a scene (trays and zones as regions, boxes as nodes, links as routes), with the pins */
export function drawBoxes(r: BoxesRead, data: unknown, theme: string): CanvasDrawing & { compiled: ReturnType<typeof compileRaw> } {
  const layout = isMap(data) && isMap(data['x-editor']) && isMap(data['x-editor'].layout) ? data['x-editor'].layout : {};
  const at = (name: string): { at?: [number, number] } => { const v = layout[name]; return isMap(v) && Array.isArray(v.at) ? { at: v.at as [number, number] } : {}; };
  const region = (b: Box): RawRegion => ({ id: b.name, kind: b.kind, label: b.label ?? b.name, ...(b.size ? { size: b.size } : {}), ...at(b.name), regions: kids(b.name).filter(c => c.kind !== 'box').map(region), nodes: kids(b.name).filter(c => c.kind === 'box').map(node) });
  const node = (b: Box): RawNode => ({ id: b.name, asset: 'box', label: b.label ?? b.name, ...(b.size ? { size: b.size } : {}), ...at(b.name) });
  const kids = (name?: string) => r.boxes.filter(b => b.in === name);
  const doc: RawDiagram = {
    isodiag: 1, title: String(r.data.title ?? 'boxes'),
    scenes: [{ id: 'boxes', title: String(r.data.title ?? 'boxes'), regions: kids(undefined).filter(b => b.kind !== 'box').map(region), nodes: kids(undefined).filter(b => b.kind === 'box').map(node),
      routes: r.links.map((l, i) => ({ id: `link-${i}`, from: l.from, to: l.to, kind: 'send' })) }],
  };
  const compiled = compileRaw(doc, theme, BOXES_CATALOG);
  const scene: CompiledScene = compiled.scenes[0];
  const pathOf = new Map<string, string>([...r.boxes.map(b => [b.name, b.path] as [string, string]), ...r.links.map((l, i) => [`link-${i}`, l.path] as [string, string])]);
  const pinId = new Map(r.boxes.map(b => [b.name, b.name]));
  return { compiled, scene, svg: scene.rendered.svg, pathOf, pinId, pinNotes: [], diags: compiled.diags.filter(d => d.severity === 'error').map(d => d.message) };
}

const singular = 'box';
export const boxesAdapter: DomainAdapter = {
  id: 'boxes/1',
  role: () => 'main',
  schema: () => ({
    type: 'object', properties: {
      format: { const: 'boxes/1', description: 'The format: `boxes/1`.' }, title: { type: 'string', description: 'The drawing\'s title.' },
      boxes: { type: 'object', description: 'The boxes, by name.', additionalProperties: { type: 'object', properties: {
        kind: { enum: ['box', 'tray', 'zone'], description: 'A box, or a tray or zone that holds boxes.' },
        in: { type: 'string', description: 'The tray or zone it is in.' }, label: { type: 'string', description: 'Its label.' },
        size: { type: 'array', items: { type: 'number' }, description: 'Its size in grid cells: [w, d] or [w, d, h].' } } } },
      links: { type: 'array', description: 'Links between boxes.', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } } },
      'x-editor': { type: 'object', description: 'The editor\'s pins.' },
    },
  }),
  read(text) { const r = readBoxes(text); return { diags: r.diags, read: r.read }; },
  keyMessage: /^unknown kind|can't be a name/,
  kinds: [{ kind: 'boxes', section: ['boxes'], singular, group: 'Boxes', template: () => ({ size: [2, 2, 1] }) }],
  noun: 'box',
  objectOf(ptr) { const m = /^\/boxes\/([^/]+)/.exec(ptr); return m && !m[1].startsWith('x-') ? { kind: 'boxes', name: m[1], path: `/boxes/${m[1]}` } : undefined; },
  describe(p) { return p.length === 2 && p[0] === 'boxes' ? `box ${p[1]}` : p.join('.') || 'the file'; },
  entryGroups: [],
  refs, slotAt,
  renameRef: (_r, to) => to,
  refDeletePath: p => (p[0] === 'links' ? p.slice(0, 2) : p),
  copyValue: (_k, v) => v,
  topOrder: ['format', 'title', 'boxes', 'links', 'x-editor'],
  pins: { key: 'x-editor', legacyOnly: () => false },
  snippets: {},
  outline: { kinds: ['boxes'], first: ['format', 'title'], groups: [{ key: 'links', label: 'Links' }], rootLabel: d => String(d.title ?? 'boxes') },
};

/** a fake state: each box on or off, as a host's observer would say */
export type BoxStates = Record<string, 'on' | 'off'>;
const marksOf = (s: BoxStates): Mark[] => Object.entries(s).map(([name, v]) => ({ at: `/boxes/${name}`, title: `${name} is ${v}`, outline: `box-${v}`, badge: { g: v === 'on' ? '●' : '○', cls: `box-${v}` } }));

/** Live over the canvas: the marks of the last state a fake source gave (setState) */
export function boxesLayer(ctx: CanvasCtx<CanvasDrawing>): CanvasLayer<{ setState(s: BoxStates): void; readonly marks: number }> {
  let g: SVGGElement | undefined, state: BoxStates = {};
  const paint = overlayPaint({
    k: () => ctx.scale(),
    boxOf: at => ctx.union(ctx.elementsFor(at).map(e => ctx.boxOf(e))),
    outlinesFor: at => ctx.outlinesFor(at), iconHref: n => `#${n}`,
  }, 'box-card');
  return {
    groups() { g = document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement; g.setAttribute('class', 'overlay boxes-live'); return [g]; },
    paint(d) { if (!g) return; g.replaceChildren(); paint.paintMarks(d, n => g!.append(n), marksOf(state)); },
    showing: () => !!g?.children.length,
    api: { setState(s) { state = s; ctx.paint(); }, get marks() { return g?.querySelectorAll('.live-badge').length ?? 0; } },
  };
}

/** a still: the drawing with a state's marks, as one SVG (no browser: the layout's boxes, projected) */
export function boxesStill(text: string, theme: string, s: BoxStates = {}): string {
  const r = readBoxes(text);
  if (!r.read) throw new Error(r.diags[0]?.message ?? 'unreadable');
  const d = drawBoxes(r.read, r.read.data, theme);
  // (parseSvg gives the markup's root, the <svg> its one child)
  const tree = rewrite(parseSvg(d.svg).children[0] as never, 'st-') as VNode;
  const boxOf = (at: string) => {
    const b = d.scene.layout.byId.get(at.split('/')[2])?.box;
    if (!b) return undefined;
    const ps = [[b.x0, b.y0, b.z0], [b.x1, b.y0, b.z0], [b.x0, b.y1, b.z0], [b.x1, b.y1, b.z0], [b.x0, b.y0, b.z1], [b.x1, b.y0, b.z1], [b.x0, b.y1, b.z1], [b.x1, b.y1, b.z1]].map(([x, y, z]) => iso(x, y, z));
    const xs = ps.map(p => p[0]), ys = ps.map(p => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const marks: VNode[] = [];
  overlayPaint({ k: () => 1, boxOf, outlinesFor: () => [], iconHref: n => `#${n}` }, 'box-card').paintMarks(vdoc as unknown as Document, n => marks.push(n as unknown as VNode), marksOf(s));
  tree.children.push({ name: 'g', attrs: [['class', 'overlay boxes-live']], children: marks });
  return serialize(tree);
}

/** what the editor is given besides the adapter */
export const boxesView = (theme: string): DomainView<BoxesRead, CanvasDrawing> => ({
  draw: drawBoxes, catalog: BOXES_CATALOG, theme, fileName: 'boxes.yaml',
  words: { brand: 'boxes' }, layer: boxesLayer as unknown as DomainView<BoxesRead, CanvasDrawing>['layer'],
  // the 2D view (0.6.0): links drawn as the theme's send kind
  flat: { title: 'boxes, flat', styles: { send: { color: 'send' } }, load: () => import('../../src/iso-editor/ui/flat-canvas.ts').then(m => m.flatCanvas) },
});
