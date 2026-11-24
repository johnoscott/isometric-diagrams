// Motion as a function of time: a plan is seekable. `at(ms)` gives what the scene looks like then, as plain JSON (a
// SceneState); svgAt(scene, state) is that as SVG text (no DOM), paint(svg, state) puts it on a live drawing,
// idempotently; frame(ms) is svgAt of at(ms). No clock, no DOM and no randomness that isn't seeded in what makes a frame:
// the same scene, options and seed give the same bytes, in any order, anywhere. assemble() ends, and disassemble()
// starts, on the scene's own still render, byte for byte; the other end is empty.
//
// How: motionModel(scene) is what a plan needs of a drawing, as plain data (a page carries it as JSON); planOf(model,
// options) works out when each piece, connector and label moves. A state touches only the drawing's wrappers (scene.ts:
// data-item or data-route, with data-part), the connectors' own paths, the overlay's layer and the viewBox.

import type { CompiledScene } from './compile.ts';
import type { Placed, RawMotion } from './types.ts';
import { iso } from '../iso-core/kernel.ts';
import { offscreen, type Assembly } from './assemble.ts';
import { polyBounds, silhouette, type Rect } from './labels.ts';

export const ASSEMBLE_STYLES = ['edge', 'drop', 'rise', 'fly', 'pop', 'scatter', 'build', 'fade'] as const;
export const DISASSEMBLE_STYLES = ['explode', 'lift-off', 'sink', 'scatter', 'fly-out', 'collapse', 'fade', 'reverse'] as const;
export const MOTION_ORDERS = ['by-depth', 'by-layer', 'by-region', 'by-flow', 'as-listed', 'random'] as const;
export const MOTION_EASINGS = ['linear', 'ease', 'ease-in', 'ease-out', 'settle', 'spring', 'bounce'] as const;
export type AssembleStyle = typeof ASSEMBLE_STYLES[number];
export type DisassembleStyle = typeof DISASSEMBLE_STYLES[number];
export type MotionOrder = typeof MOTION_ORDERS[number];
export type MotionEasing = typeof MOTION_EASINGS[number];
export type Direction = 'left' | 'right' | 'top' | 'bottom';

/** what one piece's (or a region's contents') `motion:` in the file may say */
export type PieceMotion = RawMotion;
interface CommonOptions {
  order?: MotionOrder;
  /** where by-flow starts: a piece's id (default: the first piece no connector ends at) */
  source?: string;
  connectors?: 'draw' | 'grow' | 'fade';
  /** after the connectors are in (before they go): a token runs along each, once */
  pulses?: boolean;
  labels?: 'fade' | 'type' | 'with-piece';
  /** the whole plan's length, ms: everything is scaled to it (default: as long as it comes to) */
  duration?: number;
  /** ms between one piece's start and the next's */
  stagger?: number;
  /** ms one piece's move takes */
  piece?: number;
  /** how much of the next part (pieces, connectors, labels) runs over the end of the one before, 0 to 1 */
  overlap?: number;
  easing?: MotionEasing;
  /** fly, fly-out: the side it comes from or goes to */
  from?: Direction;
  seed?: number;
}
export interface AssembleOptions extends CommonOptions { style?: AssembleStyle }
export interface DisassembleOptions extends CommonOptions {
  style?: DisassembleStyle;
  /** explode, collapse: the point (in the drawing's units), or a piece's id (default: the drawing's middle; collapse
   *  into the region that holds each piece: 'region') */
  point?: [number, number] | string;
  /** reverse: the assemble style it plays backwards */
  of?: AssembleStyle;
}

// ---------- what a plan needs of a drawing ----------

export interface MotionPiece {
  id: string; kind: 'region' | 'node'; parent?: string; depth: number; layer: number; key: number;
  bbox: Rect;
  /** the middle of its footprint, and its bottom outline (left, front, right corner), in the drawing's units */
  foot: [number, number]; base: [number, number][];
  motion?: PieceMotion;
}
export interface MotionModel {
  viewBox: [number, number, number, number];
  pieces: MotionPiece[];
  routes: { id: string; path: string; from?: string; to?: string }[];
  /** notes' ids and what they are on (a piece or a route) */
  notes: Record<string, string | undefined>;
  /** the build-time intro's own timing (`edge` with no other timing given plays exactly it) */
  intro: Assembly;
}

const r2 = (v: number) => Math.round(v * 100) / 100 || 0;   // (never -0)
const r4 = (v: number) => Math.round(v * 10000) / 10000 || 0;

export function motionModel(s: CompiledScene): MotionModel {
  const depthOf = (p: Placed) => { let d = 0; for (let a = p.parent; a; a = a.parent) d++; return d; };
  const inherited = (p: Placed): PieceMotion | undefined => {
    // a region's motion is its contents' too, each key unless the piece (or a nearer region) says its own
    const chain: PieceMotion[] = [];
    for (let a: Placed | undefined = p; a; a = a.parent) { const m = (a.region ?? a.node)?.motion; if (m) chain.unshift(m); }
    return chain.length ? Object.assign({}, ...chain) as PieceMotion : undefined;
  };
  const AIR = new Set(s.layout.items.filter(p => p.region && s.layout.catalog && s.rendered.svg.includes(`class="tunnel" data-id="${p.id}"`)).map(p => p.id));
  return {
    viewBox: s.rendered.viewBox,
    pieces: s.layout.items.map(p => {
      const b = p.box, c = iso((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z0), m = inherited(p);
      return {
        id: p.id, kind: p.type, ...(p.parent ? { parent: p.parent.id } : {}), depth: depthOf(p),
        layer: AIR.has(p.id) ? 2 : p.type === 'region' ? 0 : 1, key: r2(b.x0 + b.y0 + b.z0 * 0.01),
        bbox: polyBounds(silhouette(b)), foot: [r2(c[0]), r2(c[1])],
        base: [iso(b.x0, b.y1, b.z0), iso(b.x1, b.y1, b.z0), iso(b.x1, b.y0, b.z0)].map(q => [r2(q[0]), r2(q[1])] as [number, number]),
        ...(m ? { motion: m } : {}),
      };
    }),
    routes: s.routes.filter(r => s.rendered.paths[r.id]).map(r => ({ id: r.id, path: s.rendered.paths[r.id], ...ends(r.raw as { from?: unknown; to?: unknown }) })),
    notes: Object.fromEntries((s.raw.notes ?? []).map((n, i) => [`${s.id}-note-${i}`, n.on])),
    intro: s.rendered.assembly,
  };
}
const endId = (v: unknown) => (typeof v === 'string' ? v.split('.')[0] : undefined);
const ends = (r: { from?: unknown; to?: unknown }) => { const from = endId(r.from), to = endId(r.to); return { ...(from ? { from } : {}), ...(to ? { to } : {}) }; };

// ---------- curves, and a seeded stream ----------

const bezier = (x1: number, y1: number, x2: number, y2: number) => (x: number) => {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (at(x1, x2, m) < x) lo = m; else hi = m; }
  return at(y1, y2, (lo + hi) / 2);
};
const CURVES: Record<MotionEasing, (f: number) => number> = {
  linear: f => f, ease: bezier(0.42, 0, 0.58, 1), 'ease-in': bezier(0.42, 0, 1, 1), 'ease-out': bezier(0, 0, 0.58, 1),
  // the page player's own: quick in, a long settle
  settle: bezier(0.16, 0.84, 0.3, 1),
  spring: f => (f <= 0 ? 0 : f >= 1 ? 1 : 1 - Math.exp(-6 * f) * Math.cos(9.5 * f) * (1 - f)),
  bounce: f => {
    if (f <= 0) return 0; if (f >= 1) return 1;
    const n = 7.5625, d = 2.75;
    if (f < 1 / d) return n * f * f;
    if (f < 2 / d) return n * (f - 1.5 / d) ** 2 + 0.75;
    if (f < 2.5 / d) return n * (f - 2.25 / d) ** 2 + 0.9375;
    return n * (f - 2.625 / d) ** 2 + 0.984375;
  },
};
/** a seeded stream of numbers in [0, 1) (mulberry32) */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** an id's own number, so a piece's random place doesn't depend on the others */
const hashOf = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const clamp = (f: number) => Math.max(0, Math.min(1, f));

// ---------- what a scene looks like at a moment ----------

/** a thing's block, walls, gate and name: what is not given is as in the still */
export interface ItemState {
  opacity?: number;
  /** in the drawing's units */
  dx?: number; dy?: number;
  /** about `about` (default: the drawing's origin) */
  scale?: number; about?: [number, number];
  /** only what is inside this shows (a polygon, before the offset) */
  clip?: [number, number][];
}
/** a label or a note: faded, or typed so far (0 to 1) */
export interface LabelState { opacity?: number; typed?: number; dx?: number; dy?: number }
/** a connector: how much of it is drawn (0 to 1: its arrowhead shows at 1), stroked in, or growing from its source */
export interface RouteState {
  opacity?: number; drawn?: number; by?: 'stroke' | 'grow';
  /** (a timeline's) marching dashes: on and off, and how far they have marched, in the drawing's units along it */
  ants?: { dash: [number, number]; offset: number };
}
/** Plain JSON. Empty: the still render. What isn't named is as in the still. */
export interface SceneState {
  items?: Record<string, ItemState>;
  /** by the id of a thing, a connector or a note */
  labels?: Record<string, LabelState>;
  routes?: Record<string, RouteState>;
  /** by the id of a thing: how much of each of its looks is there (the rest is its own), 0 to 1 */
  variants?: Record<string, Record<string, number>>;
  /** the step marks' and badges' layers */
  marks?: { opacity: number };
  /** a token on a connector, a fraction (0 to 1) of the way along it */
  tokens?: { route: string; at: number; color?: string; kind?: string }[];
  /** a ring round a point */
  pulses?: { x: number; y: number; rx: number; ry: number; opacity?: number; color?: string }[];
  /** (a timeline's) an outline round a thing: its silhouette */
  outlines?: { id: string; points: [number, number][]; opacity?: number; color?: string }[];
  /** the view, in the drawing's units */
  camera?: [number, number, number, number];
  /** how far toward the 2D view (0 to 1): a morph's, for a host that draws one; svgAt and paint draw the 3D view */
  morph?: number;
}
export interface MotionPlan {
  kind: 'assemble' | 'disassemble';
  /** ms */
  duration: number;
  /** when each piece moves, in the order it does */
  pieces: { id: string; delay: number; dur: number; style: string }[];
  routes: { id: string; delay: number; dur: number }[];
  labels: { delay: number; dur: number };
  /** what the scene looks like at t ms: plain JSON, the same for the same t */
  at(t: number): SceneState;
}
export interface ScenePlan extends MotionPlan {
  /** the scene's SVG at t ms, as text: svgAt(scene, at(t)) */
  frame(t: number): string;
}

interface Timed { p: MotionPiece; delay: number; dur: number; style: string; curve: (f: number) => number; from: Direction }

const MARGIN = 24;
function side(b: Rect, vb: [number, number, number, number], to: Direction): [number, number] {
  const [x, y, w, h] = vb;
  if (to === 'left') return [-(b.x + b.w - x) - MARGIN, 0];
  if (to === 'right') return [x + w - b.x + MARGIN, 0];
  if (to === 'top') return [0, -(b.y + b.h - y) - MARGIN];
  return [0, y + h - b.y + MARGIN];
}

/** the order the pieces move in: what they stand on, or are in, never after them (but as-listed and random) */
export function motionOrder(m: MotionModel, order: MotionOrder, o: { seed?: number; source?: string } = {}): MotionPiece[] {
  const P = m.pieces, byId = new Map(P.map(p => [p.id, p]));
  const back = (a: MotionPiece, b: MotionPiece) => a.depth - b.depth || a.key - b.key;
  if (order === 'as-listed') return [...P];
  if (order === 'random') { const next = stream(o.seed ?? 1); return P.map(p => [next(), p] as const).sort((a, b) => a[0] - b[0]).map(x => x[1]); }
  if (order === 'by-layer') return [...P].sort((a, b) => a.layer - b.layer || back(a, b));
  if (order === 'by-depth') return [...P].sort((a, b) => a.key - b.key || a.depth - b.depth);
  const kids = new Map<string | undefined, MotionPiece[]>();
  for (const p of [...P].sort(back)) { const l = kids.get(p.parent) ?? []; l.push(p); kids.set(p.parent, l); }
  const out: MotionPiece[] = [], seen = new Set<string>();
  const add = (p: MotionPiece) => { if (seen.has(p.id)) return; const up = p.parent ? byId.get(p.parent) : undefined; if (up) add(up); seen.add(p.id); out.push(p); };
  if (order === 'by-region') { const walk = (id?: string) => { for (const p of kids.get(id) ?? []) { add(p); walk(p.id); } }; walk(); return out; }
  // by-flow: from the source along the connectors, breadth first; what no connector reaches comes after, back to front
  const next = new Map<string, string[]>(), into = new Set<string>();
  for (const r of m.routes) if (r.from && r.to) { next.set(r.from, [...(next.get(r.from) ?? []), r.to]); into.add(r.to); }
  const start = o.source ?? m.routes.find(r => r.from && !into.has(r.from))?.from ?? m.routes[0]?.from;
  const queue = start ? [start] : [], queued = new Set(queue);
  while (queue.length) { const id = queue.shift()!, p = byId.get(id); if (p) add(p); for (const n of next.get(id) ?? []) if (!queued.has(n)) { queued.add(n); queue.push(n); } }
  for (const p of [...P].sort(back)) add(p);
  return out;
}

const STYLE_EASE: Record<string, MotionEasing> = { edge: 'settle', drop: 'settle', rise: 'ease-out', fly: 'settle', pop: 'spring', scatter: 'settle', build: 'ease-out', fade: 'linear',
  explode: 'ease-in', 'lift-off': 'ease-in', sink: 'ease-in', 'fly-out': 'ease-in', collapse: 'ease-in' };
/** the assemble style each disassemble style is, seen backwards: what a piece does is one function of how far in it is */
const OUT_AS: Record<string, string> = { 'lift-off': 'lift', sink: 'rise', scatter: 'scatter', 'fly-out': 'edge', fade: 'fade', explode: 'explode', collapse: 'collapse' };

/** either's options: the style is the plan's own kind's */
export type PlanOptions = Omit<AssembleOptions & DisassembleOptions, 'style'> & { style?: AssembleStyle | DisassembleStyle };
type AnyOptions = PlanOptions;

export function planOf(m: MotionModel, kind: 'assemble' | 'disassemble', opts: AnyOptions = {}): MotionPlan {
  const seed = opts.seed ?? 1, leaving = kind === 'disassemble';
  const reverse = leaving && opts.style === 'reverse';
  const own = (p: MotionPiece): string => {
    if (!leaving) return p.motion?.style ?? (opts.style as AssembleStyle | undefined) ?? 'edge';
    const out = p.motion?.out ?? (opts.style as DisassembleStyle | undefined) ?? 'fly-out';
    return out === 'reverse' ? p.motion?.style ?? opts.of ?? 'edge' : OUT_AS[out];
  };
  const named = (p: MotionPiece): string => (leaving ? p.motion?.out ?? (opts.style as string | undefined) ?? 'fly-out' : own(p));
  // the build-time intro's own timing: the page's assemble, unless something else is asked
  const asIntro = !leaving && !opts.order && opts.stagger === undefined && opts.piece === undefined && opts.overlap === undefined && (opts.style ?? 'edge') === 'edge';
  const order = opts.order ?? (opts.style === 'build' ? 'by-layer' : 'by-depth');
  const timed: Timed[] = [];
  let routes: { id: string; delay: number; dur: number }[], labels: { delay: number; dur: number };
  const mk = (p: MotionPiece, delay: number, dur: number): Timed => {
    const style = own(p), e = p.motion?.easing ?? opts.easing ?? STYLE_EASE[leaving && named(p) !== 'reverse' ? named(p) : style] ?? 'ease';
    return { p, delay: delay + (p.motion?.delay ?? 0), dur: Math.max(1, p.motion?.duration ?? dur), style, curve: CURVES[e], from: p.motion?.from ?? opts.from ?? 'left' };
  };
  if (asIntro) {
    const by = new Map(m.pieces.map(p => [p.id, p]));
    for (const a of m.intro.pieces) { const p = by.get(a.id); if (p) timed.push(mk(p, a.delay, a.dur)); }
    routes = m.intro.routes.map(r => ({ ...r })); labels = { ...m.intro.labels };
  } else {
    const seq = motionOrder(m, order, { seed, source: opts.source });
    const dur = opts.piece ?? 600, step = opts.stagger ?? Math.min(70, 900 / Math.max(1, seq.length)), over = clamp(opts.overlap ?? 0.5);
    const list = reverse || leaving ? [...seq].reverse() : seq;
    const rStep = Math.min(30, 300 / Math.max(1, m.routes.length)), rDur = 400, lDur = 400;
    if (!leaving) {
      list.forEach((p, i) => timed.push(mk(p, i * step, dur)));
      const pEnd = Math.max(0, ...timed.map(x => x.delay + x.dur));
      const rAt = Math.max(0, pEnd - over * dur);
      routes = m.routes.map((r, i) => ({ id: r.id, delay: rAt + i * rStep, dur: rDur }));
      const rEnd = Math.max(rAt, ...routes.map(r => r.delay + r.dur));
      labels = { delay: Math.max(0, rEnd - over * lDur), dur: lDur };
    } else {
      // labels go first, then the connectors un-draw, then the pieces leave
      labels = { delay: 0, dur: lDur };
      const rAt = lDur * (1 - over);
      routes = [...m.routes].reverse().map((r, i) => ({ id: r.id, delay: rAt + i * rStep, dur: rDur }));
      const rEnd = Math.max(rAt, ...routes.map(r => r.delay + r.dur));
      const pAt = Math.max(0, rEnd - over * rDur);
      list.forEach((p, i) => timed.push(mk(p, pAt + i * step, dur)));
    }
  }
  const pulse = opts.pulses && m.routes.length ? 700 : 0;
  if (pulse && leaving) { for (const x of [...timed, ...routes, labels]) x.delay += pulse; }
  let total = Math.max(1, ...timed.map(x => x.delay + x.dur), ...routes.map(r => r.delay + r.dur), labels.delay + labels.dur);
  const pulseAt = leaving ? 0 : total;
  if (pulse && !leaving) total += pulse;
  // scaled to the length asked for
  const k = opts.duration !== undefined ? Math.max(1, opts.duration) / total : 1;
  for (const x of [...timed, ...routes, labels]) { x.delay = r2(x.delay * k); x.dur = Math.max(0.01, r2(x.dur * k)); }
  const duration = opts.duration !== undefined ? Math.max(1, opts.duration) : Math.max(1, r2(total));

  const byPiece = new Map(timed.map(x => [x.p.id, x])), byRoute = new Map(routes.map(r => [r.id, r]));
  const [vx, vy, vw, vh] = m.viewBox, middle: [number, number] = [vx + vw / 2, vy + vh / 2];
  const middleOf = (b: Rect): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];
  const pointOf = (p: MotionPiece, what: string): [number, number] => {
    const pt = opts.point;
    if (Array.isArray(pt)) return pt;
    if (pt === 'region' || (what === 'collapse' && pt === undefined && p.parent)) { const up = m.pieces.find(x => x.id === p.parent); return up ? up.foot : middle; }
    if (typeof pt === 'string') { const at = m.pieces.find(x => x.id === pt); if (at) return at.foot; }
    return middle;
  };
  /** a piece, `e` of the way in (0: away, 1: in place; a spring may pass 1) */
  function piece(x: Timed, e: number, f: number): ItemState {
    const { p } = x, b = p.bbox, away = 1 - e;
    const move = (dx: number, dy: number): ItemState => ({ dx: r2(dx * away), dy: r2(dy * away) });
    switch (x.style) {
      case 'drop': return move(...side(b, m.viewBox, 'top'));
      case 'lift': return move(...side(b, m.viewBox, 'top'));
      case 'fly': return move(...side(b, m.viewBox, x.from));
      case 'rise': {
        // up through its own floor: what is below its bottom outline doesn't show
        const dy = b.h * away, [l, fr, r] = p.base, top = b.y - b.h - 4;
        return { ...move(0, b.h), clip: [[l[0], l[1] - dy], [fr[0], fr[1] - dy], [r[0], r[1] - dy], [r[0] + 2, top - dy], [l[0] - 2, top - dy]].map(q => [r2(q[0]), r2(q[1])] as [number, number]) };
      }
      case 'pop': return { scale: r4(Math.max(0, e)), about: p.foot, opacity: r4(clamp(f * 4)) };
      case 'scatter': {
        const next = stream((seed ^ hashOf(p.id)) >>> 0), a = next() * Math.PI * 2, d = 0.35 + next() * 0.65;
        return { ...move(Math.cos(a) * vw * d * 0.6, Math.sin(a) * vh * d * 0.6), opacity: r4(clamp(e * 1.6)) };
      }
      case 'build': return { ...move(0, -18), opacity: r4(clamp(e)) };
      case 'fade': return { opacity: r4(clamp(e)) };
      case 'explode': {
        const c = pointOf(p, 'explode'), q = middleOf(b), dx = q[0] - c[0], dy = q[1] - c[1], l = Math.hypot(dx, dy);
        const next = stream((seed ^ hashOf(p.id)) >>> 0), a = next() * Math.PI * 2, u = l > 1 ? [dx / l, dy / l] : [Math.cos(a), Math.sin(a)];
        const far = Math.hypot(vw, vh) + Math.max(b.w, b.h);
        return move(u[0] * far, u[1] * far);
      }
      case 'collapse': {
        const c = pointOf(p, 'collapse');
        return { ...move(c[0] - p.foot[0], c[1] - p.foot[1]), scale: r4(Math.max(0, e)), about: p.foot, opacity: r4(clamp(e * 3)) };
      }
      default: { const o = offscreen(b, m.viewBox); return move(o.dx, o.dy); }
    }
  }
  /** how far in something is at t (0 to 1): an arrival's share done, a leaving's share left */
  const share = (t: number, delay: number, dur: number) => { const f = clamp((t - delay) / dur); return leaving ? 1 - f : f; };
  const HIDDEN = { opacity: 0 };
  const connectors = opts.connectors ?? 'draw', labelling = opts.labels ?? 'fade';
  const labelled = [...m.pieces.map(p => p.id), ...m.routes.map(r => r.id), ...Object.keys(m.notes)];
  function at(t0: number): SceneState {
    const t = Math.max(0, Math.min(duration, Number.isFinite(t0) ? t0 : 0));
    if (leaving ? t <= 0 : t >= duration) return {};
    const empty = leaving ? t >= duration : t <= 0;
    const items: Record<string, ItemState> = {}, routeStates: Record<string, RouteState> = {}, labelStates: Record<string, LabelState> = {};
    for (const x of timed) {
      const f = empty ? 0 : share(t, x.delay, x.dur);
      if (f <= 0) items[x.p.id] = HIDDEN;
      else if (f < 1) items[x.p.id] = piece(x, leaving ? 1 - x.curve(1 - f) : x.curve(f), f);
    }
    for (const r of m.routes) {
      const w = byRoute.get(r.id), f = empty || !w ? 0 : share(t, w.delay, w.dur);
      if (f <= 0) routeStates[r.id] = { opacity: 0, drawn: 0 };
      else if (f < 1) routeStates[r.id] = connectors === 'fade' ? { opacity: r4(f) } : connectors === 'grow' ? { drawn: r4(f), by: 'grow' } : { drawn: r4(CURVES['ease-out'](f)) };
    }
    const lf = empty ? 0 : share(t, labels.delay, labels.dur);
    const all: LabelState | undefined = lf <= 0 ? HIDDEN : lf >= 1 ? undefined : labelling === 'type' ? { typed: r4(lf) } : { opacity: r4(lf) };
    for (const id of labelled) {
      let c = all;
      if (labelling === 'with-piece') {
        const on = Object.hasOwn(m.notes, id) ? m.notes[id] : id, w = on === undefined ? undefined : byPiece.get(on) ?? byRoute.get(on);
        if (w) { const f = empty ? 0 : share(t, w.delay, w.dur); c = f <= 0 ? HIDDEN : f >= 1 ? undefined : { opacity: r4(f) }; }
      }
      if (c) labelStates[id] = c;
    }
    const tokens: { route: string; at: number }[] = [];
    if (pulse && !empty) {
      const f = (t - pulseAt * k) / (pulse * k);
      if (f > 0 && f < 1) for (const r of m.routes) tokens.push({ route: r.id, at: r4(CURVES.ease(f)) });
    }
    const some = (o: object) => Object.keys(o).length > 0;
    return {
      ...(some(items) ? { items } : {}), ...(some(labelStates) ? { labels: labelStates } : {}), ...(some(routeStates) ? { routes: routeStates } : {}),
      ...(lf < 1 ? { marks: { opacity: r4(Math.max(0, lf)) } } : {}), ...(tokens.length ? { tokens } : {}),
    };
  }
  return { kind, duration, pieces: timed.map(x => ({ id: x.p.id, delay: x.delay, dur: x.dur, style: named(x.p) })), routes, labels, at };
}

const n2 = (v: number) => { const s = v.toFixed(2); return s === '-0.00' ? '0' : String(Number(s)); };
const scaleAt = (c: [number, number], s: number) => `translate(${n2(c[0])} ${n2(c[1])}) scale(${Number(s.toFixed(4))}) translate(${n2(-c[0])} ${n2(-c[1])})`;

// ---------- connectors: their paths are polylines in the drawing's units ----------

const pointsOf = (d: string) => [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])] as [number, number]);
const lengthOf = (pts: [number, number][]) => pts.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
/** a point a fraction of the way along an SVG polyline path ("M x,y L x,y …") */
export function alongPath(d: string, f: number): [number, number] {
  const pts = pointsOf(d);
  let left = lengthOf(pts) * f;
  for (let i = 0; i + 1 < pts.length; i++) {
    const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (left <= seg && seg > 0) { const t = left / seg; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]; }
    left -= seg;
  }
  return pts[pts.length - 1] ?? [0, 0];
}
/** the first part of a path: it grows from its source, its arrowhead at the tip */
function partOf(d: string, f: number): string {
  const pts = pointsOf(d), end = alongPath(d, f), out: [number, number][] = [];
  let left = lengthOf(pts) * f;
  for (let i = 0; i < pts.length; i++) {
    out.push(pts[i]);
    const seg = i + 1 < pts.length ? Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) : Infinity;
    if (left <= seg) break;
    left -= seg;
  }
  return 'M' + [...out, end].map(q => `${n2(q[0])},${n2(q[1])}`).join(' L');
}

// ---------- drawing a state: into the still's text, or onto its elements ----------

const num = (v: number) => String(Number(v.toFixed(4)));
/** the start of a text run: an entity counts as one character */
export function typed(s: string, f: number): string {
  const ch = s.match(/&[^;\s]+;|[\s\S]/gu) ?? [];
  return ch.slice(0, Math.round(ch.length * f)).join('');
}
/** what a wrapper's state is: its attributes, and what is inside it (a connector's path, a label's text) */
interface Drawn { attrs: Record<string, string>; clip?: [number, number][]; path?: { d?: string; style?: string; head: boolean }; typed?: number }
function drawnItem(i: ItemState): Drawn {
  const t: string[] = [];
  if (i.dx || i.dy) t.push(`translate(${n2(i.dx ?? 0)} ${n2(i.dy ?? 0)})`);
  if (i.scale !== undefined && i.scale !== 1) t.push(scaleAt(i.about ?? [0, 0], i.scale));
  return { attrs: { ...(i.opacity === undefined || i.opacity === 1 ? {} : { opacity: num(i.opacity) }), ...(t.length ? { transform: t.join(' ') } : {}) }, clip: i.clip };
}
function drawnRoute(r: RouteState, d: string | undefined): Drawn {
  const out: Drawn = { attrs: r.opacity === undefined || r.opacity === 1 ? {} : { opacity: num(r.opacity) } };
  if (r.drawn !== undefined && r.drawn < 1 && d !== undefined) {
    const f = clamp(r.drawn), len = lengthOf(pointsOf(d));
    out.path = r.by === 'grow' ? { d: partOf(d, f), head: false } : { style: `stroke-dasharray:${n2(len)} ${n2(len)};stroke-dashoffset:${n2(len * (1 - f))}`, head: false };
  } else if (r.ants) out.path = { style: `stroke-dasharray:${n2(r.ants.dash[0])} ${n2(r.ants.dash[1])};stroke-dashoffset:${n2(-r.ants.offset)}`, head: true };
  return out;
}
/** the state of one wrapper, by its id and part (undefined: as in the still) */
function wrapperState(S: SceneState, what: 'item' | 'route', id: string, part: string, pathOf: (id: string) => string | undefined): Drawn | undefined {
  if (part === 'label' || part === 'note') {
    const l = S.labels && Object.hasOwn(S.labels, id) ? S.labels[id] : undefined;
    return l && { attrs: { ...(l.opacity === undefined || l.opacity === 1 ? {} : { opacity: num(l.opacity) }), ...(l.dx || l.dy ? { transform: `translate(${n2(l.dx ?? 0)} ${n2(l.dy ?? 0)})` } : {}) }, ...(l.typed === undefined || l.typed >= 1 ? {} : { typed: l.typed }) };
  }
  if (what === 'route') { const r = S.routes && Object.hasOwn(S.routes, id) ? S.routes[id] : undefined; return r && drawnRoute(r, pathOf(id)); }
  const i = S.items && Object.hasOwn(S.items, id) ? S.items[id] : undefined;
  return i && drawnItem(i);
}
/** what a state adds to the overlay's layer: rings and tokens, as [name, attributes] */
function overlay(S: SceneState, pathOf: (id: string) => string | undefined, inks?: { surface: string; control: string; kinds?: Record<string, string> }): [string, Record<string, string>][] {
  const out: [string, Record<string, string>][] = [];
  for (const o of S.outlines ?? []) out.push(['polygon', { points: o.points.map(q => q.map(n2).join(',')).join(' '), class: 'ring', fill: 'none', 'stroke-width': '2.5', 'stroke-linejoin': 'round', ...(o.opacity === undefined ? {} : { opacity: num(o.opacity) }), ...(inks ? { stroke: o.color ?? inks.control } : { style: `stroke:${o.color ?? 'var(--ring,var(--control,currentColor))'}` }) }]);
  for (const p of S.pulses ?? []) out.push(['ellipse', { cx: n2(p.x), cy: n2(p.y), rx: n2(p.rx), ry: n2(p.ry), class: 'ring', fill: 'none', 'stroke-width': '2.5', ...(p.opacity === undefined ? {} : { opacity: num(p.opacity) }), ...(inks ? { stroke: p.color ?? inks.control } : { style: `stroke:${p.color ?? 'currentColor'}` }) }]);
  for (const k of S.tokens ?? []) { const d = pathOf(k.route); if (d === undefined) continue; const [x, y] = alongPath(d, clamp(k.at)); out.push(['circle', { cx: n2(x), cy: n2(y), r: '7', class: 'tok', ...(inks ? { fill: k.color ?? (k.kind !== undefined ? inks.kinds?.[k.kind] : undefined) ?? inks.control, stroke: inks.surface, 'stroke-width': '2.5' } : { style: `fill:${k.color ?? (k.kind !== undefined ? `var(--${k.kind},var(--control,currentColor))` : 'var(--control,currentColor)')}` }) }]); }
  return out;
}
const isStill = (S: SceneState) => Object.keys(S).every(k => k === 'morph' || S[k as keyof SceneState] === undefined);
const MARK_LAYERS = new Set(['marks', 'badges']);
const attrText = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** the insides of a drawing's thing wrappers, by id and part: [where the inside starts, where it ends] */
function insides(svg: string): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>(), open: { key?: string; from: number }[] = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g)) {
    if (m[1]) { const o = open.pop(); if (o?.key !== undefined) out.set(o.key, [o.from, m.index]); continue; }
    if (m[4]) continue;
    const id = /\sdata-item="([^"]*)"/.exec(m[3])?.[1], part = /\sdata-part="([^"]*)"/.exec(m[3])?.[1];
    open.push({ ...(open.length === 2 && id !== undefined && part !== undefined ? { key: `${unescape(id)}\n${part}` } : {}), from: m.index + m[0].length });
  }
  return out;
}
type Looks = Pick<CompiledScene['rendered'], 'svg' | 'variants' | 'looks'>;
const lookCache = new WeakMap<object, Map<string, Map<string, string>>>();
/** a look's parts of a thing: id and part → what is inside, where it isn't as in the still */
function lookParts(r: Looks, name: string): Map<string, string> {
  const all = lookCache.get(r) ?? new Map<string, Map<string, string>>(); lookCache.set(r, all);
  let parts = all.get(name);
  if (!parts) {
    all.set(name, (parts = new Map()));
    const v = r.variants?.[name], own = insides(r.svg);
    if (v !== undefined) for (const [key, [a, b]] of insides(v)) { const o = own.get(key); if (o && r.looks?.[key.split('\n')[0]]?.includes(name) && r.svg.slice(...o) !== v.slice(a, b)) parts.set(key, v.slice(a, b)); }
  }
  return parts;
}
/** what a thing's part is made of now: its own (how much), and each look's, in the order the thing declares them */
function mixOf(r: Looks, id: string, part: string, want: Record<string, number>): { own: number; looks: [string, number][] } | undefined {
  const looks: [string, number][] = [];
  for (const name of r.looks?.[id] ?? []) { const a = clamp(want[name] ?? 0), inside = a > 0 ? lookParts(r, name).get(`${id}\n${part}`) : undefined; if (inside !== undefined) looks.push([inside, a]); }
  return looks.length ? { own: clamp(1 - looks.reduce((n, [, a]) => n + a, 0)), looks } : undefined;
}
const layers = (own: string, m: { own: number; looks: [string, number][] }) => (m.own > 0 ? `<g opacity="${num(m.own)}">${own}</g>` : '') + m.looks.map(([x, a]) => `<g opacity="${num(a)}">${x}</g>`).join('');
function withLooks(r: Looks, want: Record<string, Record<string, number>>): string {
  let out = '', at = 0;
  for (const [key, [a, b]] of [...insides(r.svg)].sort((x, y) => x[1][0] - y[1][0])) {
    const [id, part] = key.split('\n'), m = Object.hasOwn(want, id) ? mixOf(r, id, part, want[id]) : undefined;
    if (!m) continue;
    out += r.svg.slice(at, a) + layers(r.svg.slice(a, b), m); at = b;
  }
  return out + r.svg.slice(at);
}

/** A scene as it looks in a state, as SVG text. An empty state is the still render itself, byte for byte. */
export function svgAt(scene: Pick<CompiledScene, 'rendered' | 'id'>, S: SceneState): string {
  if (isStill(S)) return scene.rendered.svg;
  const svg = S.variants ? withLooks(scene.rendered, S.variants) : scene.rendered.svg;
  const pathOf = (id: string) => (Object.hasOwn(scene.rendered.paths, id) ? scene.rendered.paths[id] : undefined);
  let depth = 0, layer = '', clips = '', nClips = 0;
  let inside: { at: number; w: Drawn } | undefined;
  let out = svg.replace(/<(\/?)([a-zA-Z]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g, (m, close: string, name: string | undefined, attrs: string, self: string, text: string | undefined) => {
    if (text !== undefined) return inside?.w.typed === undefined ? m : typed(text, inside.w.typed);
    if (close) { depth--; if (inside && depth === inside.at) inside = undefined; if (depth === 1) layer = ''; return m; }
    const at = depth;
    if (!self) depth++;
    const a: Record<string, string> = {};
    for (const [, k, v] of attrs.matchAll(/([\w:-]+)="([^"]*)"/g)) a[k] = v;
    if (at === 0) { if (!S.camera) return m; a.viewBox = S.camera.map(n2).join(' '); } else if (at === 1) {
      layer = name === 'g' && a.class?.startsWith('g-') ? a.class.slice(2) : '';
      if (MARK_LAYERS.has(layer) && S.marks && S.marks.opacity !== 1) a.opacity = num(S.marks.opacity); else return m;
    } else if (at === 2 && a['data-part'] !== undefined) {
      const what = a['data-route'] === undefined ? 'item' : 'route', id = unescape(a['data-route'] ?? a['data-item'] ?? '');
      const w = wrapperState(S, what, id, a['data-part'], pathOf);
      if (!w) return m;
      for (const [k, v] of Object.entries(w.attrs)) a[k] = attrText(v);
      if (w.clip) { const c = `${scene.id}-mc${nClips++}`; clips += `<clipPath id="${c}"><polygon points="${w.clip.map(q => q.join(',')).join(' ')}"/></clipPath>`; a['clip-path'] = `url(#${c})`; }
      if (!self && (w.path || w.typed !== undefined)) inside = { at, w };
      if (!Object.keys(w.attrs).length && !w.clip) return m;
    } else if (inside?.w.path && name === 'path' && a.class?.split(' ')[0] === 'flow') {
      const p = inside.w.path;
      if (p.d !== undefined) a.d = p.d;
      if (p.style !== undefined) a.style = p.style;
      if (!p.head) delete a['marker-end'];
    } else return m;
    return `<${name}${Object.entries(a).map(([k, v]) => ` ${k}="${v}"`).join('')}${self ? '/' : ''}>`;
  });
  if (clips) out = out.replace(/<defs>|<defs\/>/, d => (d === '<defs/>' ? `<defs>${clips}</defs>` : d + clips));
  const over = overlay(S, pathOf, scene.rendered.inks);
  if (over.length) out = out.replace('<g class="g-anim">', g => g + over.map(([n, at]) => `<${n}${Object.entries(at).map(([k, v]) => ` ${k}="${attrText(v)}"`).join('')}/>`).join(''));
  return out;
}
const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

type Kept = { attrs: Map<Element, Map<string, string | null>>; texts: Map<Text, string>; gone: [Text, Node, Node | null][]; made: Element[]; mixed: [Element, Node[]][] };
const keptOf = new WeakMap<Element, Kept>();
/** The same on a live drawing (a scene's own <svg>). Idempotent, in any order: what the last state changed is put back
 *  first, so the same state gives the same DOM; an empty state gives the still back. */
export function paint(svg: SVGSVGElement, S: SceneState, rendered?: Looks): void {
  const was = keptOf.get(svg);
  if (was) {
    for (const [el, kids] of was.mixed) el.replaceChildren(...kids);
    for (const [el, attrs] of was.attrs) for (const [k, v] of attrs) { if (v === null) el.removeAttribute(k); else el.setAttribute(k, v); }
    for (const [n, up, next] of was.gone.reverse()) up.insertBefore(n, next);
    for (const [n, t] of was.texts) n.data = t;
    for (const e of was.made) e.remove();
    keptOf.delete(svg);
  }
  if (isStill(S)) return;
  const kept: Kept = { attrs: new Map(), texts: new Map(), gone: [], made: [], mixed: [] };
  keptOf.set(svg, kept);
  const set = (el: Element, k: string, v: string | null) => {
    const m = kept.attrs.get(el) ?? new Map<string, string | null>();
    if (!m.has(k)) m.set(k, el.getAttribute(k));
    kept.attrs.set(el, m);
    if (v === null) el.removeAttribute(k); else el.setAttribute(k, v);
  };
  const doc = svg.ownerDocument;
  const make = (name: string, attrs: Record<string, string>, into: Element) => { const e = doc.createElementNS('http://www.w3.org/2000/svg', name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); into.append(e); kept.made.push(e); return e; };
  const layers = Array.from(svg.children), layer = (name: string) => layers.find(g => g.getAttribute('class') === `g-${name}`);
  const paths = new Map<string, string>();
  for (const w of Array.from(layer('flows')?.children ?? [])) { const id = w.getAttribute('data-route'), d = w.querySelector('path.flow')?.getAttribute('d'); if (id !== null && d) paths.set(id, d); }
  const pathOf = (id: string) => paths.get(id);
  if (S.camera) set(svg, 'viewBox', S.camera.map(n2).join(' '));
  for (const name of MARK_LAYERS) { const g = layer(name); if (g && S.marks && S.marks.opacity !== 1) set(g, 'opacity', num(S.marks.opacity)); }
  let nClips = 0;
  const defs = layers.find(e => e.localName === 'defs'), first = defs?.firstChild ?? null, id0 = svg.getAttribute('data-scene') ?? 'scene';
  for (const g of layers) for (const el of Array.from(g.children)) {
    const part = el.getAttribute('data-part');
    if (part === null) continue;
    const rid = el.getAttribute('data-route');
    // its looks (the scene's `rendered` has them): the thing's own inside a layer, and each look's over it
    const iid = rid === null ? el.getAttribute('data-item') ?? '' : '', mix = rendered && S.variants && Object.hasOwn(S.variants, iid) ? mixOf(rendered, iid, part, S.variants[iid]) : undefined;
    if (mix) {
      const own = Array.from(el.childNodes), put = (a: number, kids: Node[]) => { const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g'); g.setAttribute('opacity', num(a)); g.append(...kids); return g; };
      const inside = (text: string) => Array.from(doc.importNode(new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${text}</svg>`, 'image/svg+xml').documentElement, true).childNodes);
      kept.mixed.push([el, own]);
      el.replaceChildren(...(mix.own > 0 ? [put(mix.own, own)] : []), ...mix.looks.map(([x, a]) => put(a, inside(x))));
    }
    const w = wrapperState(S, rid === null ? 'item' : 'route', rid ?? el.getAttribute('data-item') ?? '', part, pathOf);
    if (!w) continue;
    for (const [k, v] of Object.entries(w.attrs)) set(el, k, v);
    if (w.clip && defs) { const c = make('clipPath', { id: `${id0}-mc${nClips++}` }, defs); defs.insertBefore(c, first); const p = doc.createElementNS('http://www.w3.org/2000/svg', 'polygon'); p.setAttribute('points', w.clip.map(q => q.join(',')).join(' ')); c.append(p); set(el, 'clip-path', `url(#${c.id})`); }
    if (w.typed !== undefined) {
      const runs: Text[] = [];
      for (const tw = doc.createTreeWalker(el, 4); tw.nextNode();) runs.push(tw.currentNode as Text);
      for (const n of runs) {
        kept.texts.set(n, n.data); n.data = Array.from(n.data).slice(0, Math.round(Array.from(n.data).length * w.typed)).join('');
        // no letter yet: no text at all, as svgAt writes it
        if (!n.data) { kept.gone.push([n, n.parentNode!, n.nextSibling]); n.remove(); }
      }
    }
    const path = w.path && el.querySelector('path.flow');
    if (path && w.path) { if (w.path.d !== undefined) set(path, 'd', w.path.d); if (w.path.style !== undefined) set(path, 'style', w.path.style); if (!w.path.head) set(path, 'marker-end', null); }
  }
  const anim = layer('anim');
  if (anim) for (const [n, at] of overlay(S, pathOf)) make(n, at, anim);
}

// ---------- a compiled scene's plans ----------

const ofScene = (s: CompiledScene, p: MotionPlan): ScenePlan => ({ ...p, frame: t => svgAt(s, p.at(t)) });
/** the drawing arrives: frame(0) is empty, frame(duration) is the still render */
export const assemble = (s: CompiledScene, o: AssembleOptions = {}): ScenePlan => ofScene(s, planOf(motionModel(s), 'assemble', o));
/** the drawing leaves: frame(0) is the still render, frame(duration) is empty */
export const disassemble = (s: CompiledScene, o: DisassembleOptions = {}): ScenePlan => ofScene(s, planOf(motionModel(s), 'disassemble', o));

/** A frame of the page's intro (the default assemble) at t ms, as SVG text. */
export const introSvg = (s: CompiledScene, t: number): string => assemble(s).frame(t);
