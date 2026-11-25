// What changed between two drawings, drawn: the second one, with the first one's removed things as ghosts and an outline on what was
// added, changed or moved. Both are self-contained drawings (compiled with resolveVars), painted alike. Pure: text in, text out; no
// clock, no randomness, no style element and no style attribute, so it needs nothing of a page or its CSP.
//
// The marks and the ghosts are wrappers like any thing's (scene.ts), at the same depth, so a state fades and moves them as it does a
// thing: svgAt and paint know nothing of a diff. Their ids can't be a drawing's (those hold no ':'):
//   was:ID    a removed thing, connector or note, as it was        from:ID   where a moved thing was
//   mark:ID   a thing's or a note's outline                        band:ID   a connector's; path:ID where a re-routed one went
// A ghost connector fades; it isn't `drawn` (its path isn't one of the drawing's).
//
// Ids in the SVG's defs (arrowheads, patterns) are by scene id and are the same in two drawings of one scene, whose markers and patterns
// may differ. So every id here is written anew, with what refers to it: the second drawing's ID becomes `NAME-ID`, the first's
// `NAME-was-ID`, NAME being the diff's own: `o.id`, else the second's id and a hash of both drawings. So a page may hold the two drawings,
// their diff, and other diffs of them; two with one name are the same drawing.

import { greyOf } from '../iso-core/mono.ts';
import { Kernel, esc, n1, tag, type Box, type P2 } from '../iso-core/kernel.ts';
import type { CompiledScene } from './compile.ts';
import { diffScenes, type DiffOptions, type SceneDiff, type ThingChange } from './diff.ts';
import { silhouette } from './labels.ts';
import { drawNote, type RenderedScene } from './scene.ts';
import type { Placed, RawRegion } from './types.ts';

export type DiffKind = 'added' | 'changed' | 'moved' | 'removed';
export interface DiffLookOptions extends DiffOptions { /** the removed things as ghosts (default: yes) */ ghosts?: boolean; /** what its ids begin with (see the head): a letter, then letters, digits, - and _; it throws for another */ id?: string }
export interface DiffLegend { kind: DiffKind; words: string; color: string; dash?: string; opacity?: number }
export interface DiffDrawing {
  id: string; diff: SceneDiff; rendered: RenderedScene;
  /** what each mark in it means, for a host to draw: a row for each kind there is */
  legend: DiffLegend[];
}

const COLORS = {
  light: { added: '#1d7a37', changed: '#b87700', moved: '#2453c9', removed: '#c1272d' },
  dark: { added: '#4fc770', changed: '#e6b54a', moved: '#86a1ff', removed: '#ff7b72' },
} as const;
const DASH: Record<DiffKind, string | undefined> = { added: undefined, changed: '9 5', moved: '2 5', removed: '1 4' };
const WORDS: Record<DiffKind, string> = { added: 'Added', changed: 'Changed', moved: 'Moved (from the fainter outline)', removed: 'Removed (a ghost)' };
const KINDS: DiffKind[] = ['added', 'changed', 'moved', 'removed'];
const GHOST = 0.4, FROM = 0.45, REMOVED = 0.7, RING = 3;
/** a connector's band, and the paper in it that its line is on */
const BAND = 11, CORE = 6;

type Rendered = RenderedScene & { inks: NonNullable<RenderedScene['inks']> };
const resolved = (s: CompiledScene, which: string): Rendered => {
  if (!s.rendered.inks) throw new Error(`drawDiff: the ${which} drawing isn't self-contained (compile it with resolveVars)`);
  return s.rendered as Rendered;
};
/** what `o.id` may be: it is written into the drawing, and into what refers to its ids */
const NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
/** a short name for a text (FNV-1a) */
function hash(t: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

// ---- a drawing's text: its tags, its wrappers, its ids ----
const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
/** every id it defines, and what refers to it, with `by` in front */
const renamed = (svg: string, by: string) => svg.replace(TAG, (m, close: string, name: string, attrs: string, self: string) => (close ? m
  : `<${name}${attrs.replace(/\s((?:xlink:)?href|id)="(#?)([^"]*)"/g, (a, k: string, h: string, v: string) => (k === 'id' && !h ? ` id="${by}${v}"` : h ? ` ${k}="#${by}${v}"` : a)).replace(/url\(#([^)]*)\)/g, (_, v: string) => `url(#${by}${v})`)}${self ? '/' : ''}>`));
interface Wrapper { what: 'item' | 'route'; id: string; part: string; inside: string }
/** its wrappers, as they are painted, and its defs, by id */
function read(svg: string): { wrappers: Wrapper[]; defs: Map<string, string> } {
  const wrappers: Wrapper[] = [], defs = new Map<string, string>();
  const open: { name: string; attrs: string; at: number; from: number }[] = [];
  const get = (attrs: string, k: string) => new RegExp(`\\s${k}="([^"]*)"`).exec(attrs)?.[1];
  const done = (o: { name: string; attrs: string; at: number; from: number }, to: number, end: number) => {
    if (open.length !== 2) return;
    const id = get(o.attrs, 'id'), item = get(o.attrs, 'data-item'), route = get(o.attrs, 'data-route'), part = get(o.attrs, 'data-part');
    if (open[1].name === 'defs') { if (id !== undefined) defs.set(id, svg.slice(o.at, end)); } else if (part !== undefined && (item ?? route) !== undefined) wrappers.push({ what: route === undefined ? 'item' : 'route', id: (item ?? route)!, part, inside: svg.slice(o.from, to) });
  };
  for (const m of svg.matchAll(TAG)) {
    const at = m.index, end = at + m[0].length;
    if (m[1]) { const o = open.pop()!; done(o, at, end); } else if (m[4]) done({ name: m[2], attrs: m[3], at, from: end }, end, end); else open.push({ name: m[2], attrs: m[3], at, from: end });
  }
  return { wrappers, defs };
}
/** a ghost is a picture of what was: nothing a page finds things by */
const still = (svg: string) => svg.replace(TAG, (m, close: string, name: string, attrs: string, self: string) => (close ? m : `<${name}${attrs.replace(/\s(?:data-[\w-]+|tabindex|role|aria-label)="[^"]*"/g, '')}${self ? '/' : ''}>`));

// ---- what is marked, and how ----
const PLACE = ['in', 'at', 'right-of', 'left-of', 'below', 'behind', 'gap', 'align', 'shift', 'z'] as const, SIZE = ['size', 'height', 'padding'] as const;
const written = (r: RawRegion | undefined, keys: readonly string[], as: (id: unknown) => unknown) => JSON.stringify(keys.map(k => { const v = (r as Record<string, unknown> | undefined)?.[k]; return (typeof v === 'string' ? as(v) : v) ?? null; }));
/** resized where it stands: a corner or the middle of its floor is where it was */
const held = (p: Box, q: Box) => ([[p.x0, q.x0, p.y0, q.y0], [p.x1, q.x1, p.y1, q.y1], [p.x0 + p.x1, q.x0 + q.x1, p.y0 + p.y1, q.y0 + q.y1]] as const).some(([x, u, y, v]) => Math.abs(x - u) < 1e-3 && Math.abs(y - v) < 1e-3);
/** a node is marked for whatever changed (one only resized hasn't moved). A region that only grew with what it holds isn't: for what its file says of it, or a move whole */
function marksOf(t: ThingChange, was: Placed, now: Placed, as: (id: unknown) => unknown): { changed: boolean; moved: boolean } {
  if (t.type === 'node') return { changed: t.fields.length > 0, moved: !!t.by && !(t.fields.includes('size') && held(was.box, now.box)) };
  const same = (keys: readonly string[]) => written(was.region, keys, as) === written(now.region, keys, x => x), grew = t.fields.includes('size');
  return { changed: t.fields.some(f => f !== 'size') || (grew && !same(SIZE)), moved: !!t.by && (!grew || !same(PLACE)) };
}

/** The second drawing, with what changed since the first marked in it. */
export function drawDiff(a: CompiledScene, b: CompiledScene, o: DiffLookOptions = {}): DiffDrawing {
  const ra = resolved(a, 'first'), rb = resolved(b, 'second');
  if (ra.inks.surface !== rb.inks.surface || !ra.mono !== !rb.mono) throw new Error('drawDiff: the two drawings aren\'t painted alike (the mode, the treatment)');
  const diff = diffScenes(a, b, { as: o.as }), ghosts = o.ghosts !== false;
  if (o.id !== undefined && !(typeof o.id === 'string' && NAME.test(o.id))) throw new Error(`drawDiff: no name for a drawing: ${JSON.stringify(o.id)} (a letter, then letters, digits, - and _)`);
  // (a drawing compiled without its format's schema may have any id)
  const id = o.id ?? `${/^[A-Za-z]/.test(b.id) ? '' : 'd'}${b.id.replace(/[^A-Za-z0-9_-]/g, '_')}-diff-${hash(`${ra.svg}\n${rb.svg}\n${JSON.stringify([o.as ?? {}, ghosts])}`)}`;
  const ink = rb.mono ? rb.inks.control : undefined, table = COLORS[greyOf(rb.inks.surface) < 50 ? 'dark' : 'light'];
  const color = (k: DiffKind) => ink ?? table[k];
  const seen = new Set<DiffKind>();
  const stroke = (k: DiffKind, opacity?: number, width = RING) => { seen.add(k); return { fill: 'none', stroke: color(k), 'stroke-width': width, 'stroke-linejoin': 'round', 'stroke-dasharray': DASH[k], opacity: opacity && String(opacity) }; };   // (tag rounds a number to one place)
  const at = (pts: P2[]) => pts.map(q => q.map(n1).join(',')).join(' ');
  const wrap = (name: string, svg: string, part = 'block') => tag('g', { 'data-item': name, 'data-part': part }, svg);
  const ring = (p: Placed, k: DiffKind, opacity?: number) => tag('polygon', { points: at(silhouette(p.box)), ...stroke(k, opacity) });
  const wasOf = new Map<string, string>();
  for (const x of [...diff.things, ...diff.routes]) if (x.was !== undefined) wasOf.set(x.was, x.id);
  for (const [f, t] of Object.entries(o.as ?? {})) if (!diff.removed.things.includes(f) && (diff.same.things.includes(t) || diff.same.routes.includes(t))) wasOf.set(f, t);
  const as = (v: unknown) => (typeof v === 'string' ? wasOf.get(v) ?? v : v);

  // ---- things ----
  let under = '', over = '', altered = diff.routes.length;
  for (const i of diff.added.things) over += wrap(`mark:${i}`, ring(b.layout.byId.get(i)!, 'added'));
  for (const t of diff.things) {
    const was = a.layout.byId.get(t.was ?? t.id)!, now = b.layout.byId.get(t.id)!, m = marksOf(t, was, now, as);
    if (m.moved) over += wrap(`from:${t.id}`, ring(was, 'moved', FROM));
    // (both: changed where it is, and the outline where it was says that it moved)
    if (m.changed || m.moved) { altered++; over += wrap(`mark:${t.id}`, ring(now, m.changed ? 'changed' : 'moved')); }
  }
  // ---- connectors: a band under the line, as the line's own colour and dash are its kind's ----
  const band = (name: string, d: string | undefined, k: DiffKind) => {
    if (d) under += wrap(name, tag('path', { d, ...stroke(k, undefined, BAND) }) + tag('path', { d, fill: 'none', stroke: rb.inks.surface, 'stroke-width': CORE, 'stroke-linejoin': 'round' }));
  };
  for (const i of diff.added.routes) band(`band:${i}`, rb.paths[i], 'added');
  for (const r of diff.routes) {
    const route = r.fields.every(f => f === 'path'), old = ra.paths[r.was ?? r.id];
    band(`band:${r.id}`, rb.paths[r.id], route ? 'moved' : 'changed');
    if (r.fields.includes('path') && old) under += wrap(`path:${r.id}`, tag('path', { d: old, ...stroke('moved', FROM) }));
  }
  // ---- notes ----
  const outline = (i: string) => {
    const kernel = new Kernel(), n = Number(i.slice(`${b.id}-note-`.length));
    drawNote(kernel, b.raw.notes![n], b.layout, b.routes, i);
    const boxes: P2[][] = kernel.planePolys.map(p => p);
    if (kernel.texts.length) {
      const x0 = Math.min(...kernel.texts.map(t => t.x)) - 4, y0 = Math.min(...kernel.texts.map(t => t.y)) - 3, x1 = Math.max(...kernel.texts.map(t => t.x + t.w)) + 4, y1 = Math.max(...kernel.texts.map(t => t.y + t.h)) + 3;
      boxes.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    }
    return boxes.map(p => tag('polygon', { points: at(p), ...stroke('added') })).join('');
  };
  for (const i of diff.added.notes) over += wrap(`mark:${i}`, outline(i), 'note');

  // ---- what isn't there any more ----
  const A = ghosts ? read(renamed(ra.svg, `${id}-was-`)) : { wrappers: [], defs: new Map<string, string>() };
  const gone = { item: new Set([...diff.removed.things, ...diff.removed.notes]), route: new Set(diff.removed.routes) };
  const left = A.wrappers.filter(w => gone[w.what].has(w.id));
  let ghost = left.map(w => tag('g', { [`data-${w.what}`]: `was:${w.id}`, 'data-part': w.part }, tag('g', { opacity: GHOST }, still(w.inside)))).join('');
  if (left.length) seen.add('removed');
  // (a note is its ghost alone: an outline crowds its words)
  if (ghosts) for (const i of diff.removed.things) ghost += wrap(`was:${i}`, ring(a.layout.byId.get(i)!, 'removed', REMOVED), 'outline');
  // (what a def refers to comes with it)
  const need = new Map<string, string>(), want = (svg: string) => { for (const [, r] of svg.matchAll(/(?:url\(|href=")#([^)"]*)/g)) if (!need.has(r) && A.defs.has(r)) { need.set(r, A.defs.get(r)!); want(A.defs.get(r)!); } };
  want(ghost);

  // ---- together ----
  const va = ra.viewBox, vb = rb.viewBox, x0 = Math.min(va[0], vb[0]), y0 = Math.min(va[1], vb[1]);
  const viewBox: [number, number, number, number] = [x0, y0, Math.max(va[0] + va[2], vb[0] + vb[2]) - x0, Math.max(va[1] + va[3], vb[1] + vb[3]) - y0];
  const count = (k: 'added' | 'removed') => diff[k].things.length + diff[k].routes.length + diff[k].notes.length;
  const counts = [[count('added'), 'added'], [altered, 'changed or moved'], [count('removed'), 'removed']] as [number, string][];
  const says = esc(counts.every(c => !c[0]) ? ': nothing changed' : `: ${counts.filter(c => c[0]).map(c => c.join(' ')).join(', ')}`);
  const own = (svg: string) => renamed(svg, `${id}-`).replace(/^<svg[^>]*>/, m => m.replace(/(\sdata-scene=")[^"]*"/, (_, k: string) => `${k}${id}"`).replace(/(\sviewBox=")[^"]*"/, (_, k: string) => `${k}${viewBox.join(' ')}"`));
  let svg = own(rb.svg).replace(/^<svg[^>]*>/, m => m.replace(/(\saria-label="[^"]*)"/, (_, l: string) => `${l}${says}"`));
  const layer = (name: string, inner: string) => (inner ? tag('g', { class: `g-${name}` }, inner) : '');
  if (need.size) svg = svg.replace(/<defs\/>|<defs>/, d => (d === '<defs/>' ? `<defs>${[...need.values()].join('')}</defs>` : d + [...need.values()].join('')));
  svg = svg.replace('<g class="g-flows">', g => layer('bands', under) + g).replace('<g class="g-anim">', g => layer('was', ghost) + layer('diff', over) + g);
  const variants = rb.variants && Object.fromEntries(Object.entries(rb.variants).map(([k, v]) => [k, own(v)]));
  return {
    id, diff,
    rendered: { ...rb, svg, viewBox, ...(variants ? { variants } : {}) },
    legend: KINDS.filter(k => seen.has(k)).map(k => ({ kind: k, words: WORDS[k], color: color(k), ...(DASH[k] ? { dash: DASH[k] } : {}), ...(k === 'removed' ? { opacity: GHOST } : {}) })),
  };
}
