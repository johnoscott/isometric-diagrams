// From one drawing to another: the first as it was, and the second with what changed marked in it (diff-look.ts), and what both look like
// any part of the way between, from a number alone (0: the first, 1: the second, as it rests). Pure: no clock, no randomness; a player has
// the clock (src/iso-viewer), and draws the two, `fade` of the second on the first: an exact crossfade, when it can add the two together.
//
// What is in both and has moved glides, its outline and its label with it; the rest is the crossfade's. Connectors are out of the way while
// things move (as in the 3D to 2D morph): those that aren't the same in both go in the first fifth and come in the last, as marks and ghosts
// do, so nothing lies over, or hangs beside, what glides.

import { tag } from '../iso-core/kernel.ts';
import type { CompiledScene } from './compile.ts';
import { drawDiff, markedIn, renamed, type DiffKind, type DiffLegend, type DiffLookOptions } from './diff-look.ts';
import type { SceneDiff } from './diff.ts';
import { svgAt, type ItemState, type LabelState, type RouteState, type SceneState } from './motion.ts';
import { parseEnd, type Routed } from './route.ts';
import type { RenderedScene } from './scene.ts';

export interface CompareOptions extends DiffLookOptions { /** how long it takes when it plays, ms (default 900) */ duration?: number }
/** undefined: not drawn */
export interface CompareState { before: SceneState | undefined; after: SceneState | undefined; /** how much of the second there is, 0 to 1 */ fade: number }
/** one thing that changed, in names a reader knows it by */
export interface ChangeSaid { kind: DiffKind; what: 'thing' | 'connector' | 'note'; name: string; /** what it was called, where that changed */ was?: string }
export interface Comparison {
  /** what is marked, in words: things, then connectors, then notes */
  changes: ChangeSaid[];
  id: string; diff: SceneDiff; legend: DiffLegend[]; viewBox: [number, number, number, number]; duration: number;
  /** the two drawings, on one view, their ids their own: each is drawn in its state, the second over the first */
  before: { id: string; rendered: RenderedScene }; after: { id: string; rendered: RenderedScene };
  at(f: number): CompareState;
  /** the frame as one SVG: at 0 the first drawing's own still, at 1 the second's, between them both on the drawing's paper */
  svgAt(f: number): string;
}

const OUT = 0.2, IN = 0.8;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const r4 = (v: number) => Math.round(v * 10000) / 10000 || 0;
const r2 = (v: number) => Math.round(v * 100) / 100 || 0;

function changesOf(a: CompiledScene, b: CompiledScene, d: SceneDiff, marked: ReturnType<typeof markedIn>): ChangeSaid[] {
  const thing = (s: CompiledScene, i: string) => { const p = s.layout.byId.get(i), r = p?.region ?? p?.node; return r?.label || i; };
  const line = (s: CompiledScene, i: string) => { const r = s.routes.find((x: Routed) => x.id === i), end = (v: unknown) => (typeof v === 'string' ? thing(s, parseEnd(v).id) : '?'); return r ? `${end(r.raw.from)} → ${end(r.raw.to)}` : i; };
  const note = (s: CompiledScene, i: string) => { const n = s.raw.notes?.[Number(/-note-(\d+)$/.exec(i)?.[1])]; return n?.label ?? n?.floor ?? n?.face ?? n?.sub ?? i; };
  const out: ChangeSaid[] = [];
  for (const i of d.added.things) out.push({ kind: 'added', what: 'thing', name: thing(b, i) });
  for (const m of marked) if (m.changed || m.moved) { const name = thing(b, m.id), was = thing(a, m.was.id); out.push({ kind: m.changed ? 'changed' : 'moved', what: 'thing', name, ...(was !== name ? { was } : {}) }); }
  for (const i of d.removed.things) out.push({ kind: 'removed', what: 'thing', name: thing(a, i) });
  for (const i of d.added.routes) out.push({ kind: 'added', what: 'connector', name: line(b, i) });
  for (const r of d.routes) { const name = line(b, r.id), was = line(a, r.was ?? r.id); out.push({ kind: r.fields.every(f => f === 'path') ? 'moved' : 'changed', what: 'connector', name, ...(was !== name ? { was } : {}) }); }
  for (const i of d.removed.routes) out.push({ kind: 'removed', what: 'connector', name: line(a, i) });
  for (const i of d.added.notes) out.push({ kind: 'added', what: 'note', name: note(b, i) });
  for (const i of d.removed.notes) out.push({ kind: 'removed', what: 'note', name: note(a, i) });
  return out;
}

/** The first drawing, the second with its marks, and how to go from one to the other. */
export function compareScenes(a: CompiledScene, b: CompiledScene, o: CompareOptions = {}): Comparison {
  const d = drawDiff(a, b, o), { diff, id } = d, viewBox = d.rendered.viewBox, duration = o.duration ?? 900;
  if (!(Number.isFinite(duration) && duration >= 0)) throw new Error(`compareScenes: no duration: ${String(o.duration)}`);
  const own = (svg: string) => renamed(svg, `${id}-before-`).replace(/^<svg[^>]*>/, m => m.replace(/(\sdata-scene=")[^"]*"/, (_, k: string) => `${k}${id}-before"`).replace(/(\sviewBox=")[^"]*"/, (_, k: string) => `${k}${viewBox.join(' ')}"`));
  const before = { id: `${id}-before`, rendered: { ...a.rendered, svg: own(a.rendered.svg), viewBox, ...(a.rendered.variants ? { variants: Object.fromEntries(Object.entries(a.rendered.variants).map(([k, v]) => [k, own(v)])) } : {}) } };
  const after = { id, rendered: d.rendered };

  // ---- what glides, by the second's id: how far, and its label ----
  const named = (s: CompiledScene, i: string) => s.rendered.texts.find(t => t.owner === i);
  // (a changed thing's old id is the diff's; one that is the same and renamed is in `as`, where the diff took it: a name the first drawing has is refused unless that is renamed too)
  const changedBy = new Map(diff.things.map(t => [t.id, t.was ?? t.id])), renames = Object.entries(o.as ?? {}).filter(([f, t]) => !diff.removed.things.includes(f) && (!a.layout.byId.has(t) || Object.hasOwn(o.as!, t)));
  const wasOf = (i: string) => changedBy.get(i) ?? renames.find(([, t]) => t === i)?.[0] ?? i;
  const marked = markedIn(a, b, diff, o.as), glide = new Map(marked.filter(m => m.moved && m.by).map(m => [m.id, m.by!]));
  const labels = new Map<string, [number, number]>();
  for (const i of [...diff.same.things, ...marked.map(m => m.id)]) {
    const p = named(a, wasOf(i)), q = named(b, i), g = glide.get(i);
    // (the same words: from their place to their place; others: with their thing)
    if (p && q && p.text === q.text) { const by: [number, number] = [r2(q.x - p.x), r2(q.y - p.y)]; if (by[0] || by[1]) labels.set(i, by); } else if (g) labels.set(i, g);
  }
  // the marks and the ghosts, by the wrapper each is in: a thing's (its block, its outline), a word's (its label, its note), a connector's
  const marks = { items: new Set<string>(), labels: new Set<string>(), routes: new Set<string>() };
  for (const [, what, i, part] of d.rendered.svg.matchAll(/\sdata-(item|route)="([^"]*:[^"]*)" data-part="([^"]*)"/g)) marks[part === 'label' || part === 'note' ? 'labels' : what === 'item' ? 'items' : 'routes'].add(i);
  const gone = new Set(diff.removed.routes), fresh = new Set([...diff.added.routes, ...diff.routes.map(r => r.id)]), changed = diff.routes.map(r => r.was ?? r.id);

  function at(f0: number): CompareState {
    const f = Number.isFinite(f0) ? clamp(f0) : 0;
    if (f <= 0) return { before: {}, after: undefined, fade: 0 };
    if (f >= 1) return { before: undefined, after: {}, fade: 1 };
    const go = r4(1 - clamp(f / OUT)), come = r4(clamp((f - IN) / (1 - IN)));
    const bi: Record<string, ItemState> = {}, ai: Record<string, ItemState> = {}, bl: Record<string, LabelState> = {}, al: Record<string, LabelState> = {}, br: Record<string, RouteState> = {}, ar: Record<string, RouteState> = {};
    for (const [i, by] of glide) {
      const w = wasOf(i);
      bi[w] = { dx: r2(by[0] * f), dy: r2(by[1] * f) };
      ai[i] = { dx: r2(-by[0] * (1 - f)), dy: r2(-by[1] * (1 - f)) };
    }
    for (const [i, by] of labels) {
      bl[wasOf(i)] = { dx: r2(by[0] * f), dy: r2(by[1] * f) };
      al[i] = { dx: r2(-by[0] * (1 - f)), dy: r2(-by[1] * (1 - f)) };
    }
    for (const i of marks.items) { const g = i.startsWith('mark:') ? glide.get(i.slice(5)) : undefined; ai[i] = { opacity: come, ...(g ? { dx: r2(-g[0] * (1 - f)), dy: r2(-g[1] * (1 - f)) } : {}) }; }
    for (const i of marks.labels) al[i] = { opacity: come };
    for (const i of marks.routes) ar[i] = { opacity: come };
    for (const i of [...gone, ...changed]) { br[i] = { opacity: go }; bl[i] = { ...bl[i], opacity: go }; }
    for (const i of fresh) { ar[i] = { opacity: come }; al[i] = { ...al[i], opacity: come }; }
    const some = (S: SceneState): SceneState => Object.fromEntries(Object.entries(S).filter(([, v]) => Object.keys(v as object).length)) as SceneState;
    return { before: some({ items: bi, labels: bl, routes: br }), after: some({ items: ai, labels: al, routes: ar }), fade: r4(f) };
  }

  const within = (svg: string) => svg.replace(/^<svg[^>]*>/, m => `<svg x="${viewBox[0]}" y="${viewBox[1]}" width="${viewBox[2]}" height="${viewBox[3]}"${m.slice(4).replace(/\s(?:xmlns|role|aria-label)="[^"]*"/g, '')}`);
  return {
    changes: changesOf(a, b, diff, marked),
    id, diff, legend: d.legend, viewBox, duration, before, after, at,
    svgAt(f) {
      const s = at(f);
      if (!s.after) return svgAt(before, s.before!);
      if (!s.before) return svgAt(after, s.after);
      const paper = tag('rect', { x: viewBox[0], y: viewBox[1], width: viewBox[2], height: viewBox[3], fill: d.rendered.inks!.surface }), root = /^<svg[^>]*>/.exec(d.rendered.svg)![0];
      return `${root}${paper}${within(svgAt(before, s.before))}<g opacity="${s.fade}">${paper}${within(svgAt(after, s.after))}</g></svg>`;
    },
  };
}
