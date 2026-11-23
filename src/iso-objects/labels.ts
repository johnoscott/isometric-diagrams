// Label placement in screen pixels. A label tries a few spots around its node (above first, as the references do)
// and takes the first one that clears every node's silhouette, the labels already placed and the routes' lines;
// failing that, the spot that overlaps least.

import { type Box, type P2, iso, textWidth, FONTS } from '../iso-core/kernel.ts';

export interface Rect { x: number; y: number; w: number; h: number }
export type Poly = P2[];

/** The outline of a box as seen: six corners, clockwise from the back-top corner. */
export function silhouette(b: Box): Poly {
  return [iso(b.x0, b.y0, b.z1), iso(b.x1, b.y0, b.z1), iso(b.x1, b.y0, b.z0), iso(b.x1, b.y1, b.z0), iso(b.x0, b.y1, b.z0), iso(b.x0, b.y1, b.z1)];
}
export function polyBounds(p: Poly): Rect {
  const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Area of a convex polygon clipped to a rectangle (Sutherland–Hodgman). */
export function polyRectArea(poly: Poly, r: Rect): number {
  let pts = poly;
  const clip = (inside: (p: P2) => boolean, cross: (a: P2, b: P2) => P2) => {
    const out: P2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cross(a, b));
    }
    pts = out;
  };
  const atX = (x: number) => (a: P2, b: P2): P2 => [x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])];
  const atY = (y: number) => (a: P2, b: P2): P2 => [a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y];
  clip(p => p[0] >= r.x, atX(r.x)); if (!pts.length) return 0;
  clip(p => p[0] <= r.x + r.w, atX(r.x + r.w)); if (!pts.length) return 0;
  clip(p => p[1] >= r.y, atY(r.y)); if (!pts.length) return 0;
  clip(p => p[1] <= r.y + r.h, atY(r.y + r.h)); if (!pts.length) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}
export function rectArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
/** How much of a polyline (as 4px-wide strokes) falls inside a rectangle, in px². */
export function lineRectArea(pts: P2[], r: Rect): number {
  let a = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i], q = pts[i + 1], len = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.ceil(len / 4));
    for (let j = 0; j < n; j++) {
      const x = p[0] + (q[0] - p[0]) * (j + 0.5) / n, y = p[1] + (q[1] - p[1]) * (j + 0.5) / n;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) a += (len / n) * 4;
    }
  }
  return a;
}

/**
 * Where shapes are, in buckets of a grid on the screen, so a query visits only the shapes near it. Lists are only ever
 * appended to, so each list's index catches up when it is next asked. A query returns indices in list order, so sums
 * run in the order a full scan would; the shapes it leaves out are those whose bounds miss the query's, which add
 * exactly nothing. The answers are the same as scanning every shape; on a large drawing, far fewer shapes are visited.
 */
const CELL = 64;
class Buckets {
  private cells = new Map<number, number[]>();
  n = 0;
  add(id: number, x0: number, y0: number, x1: number, y1: number) {
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
      const k = cx * 1048576 + cy;
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, list = []);
      if (list[list.length - 1] !== id) list.push(id);
    }
  }
  /** the ids whose buckets meet the box, ascending, each once */
  query(x0: number, y0: number, x1: number, y1: number): number[] {
    const out = new Set<number>();
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
      const list = this.cells.get(cx * 1048576 + cy);
      if (list) for (const id of list) out.add(id);
    }
    return [...out].sort((p, q) => p - q);
  }
}
type Box2 = [number, number, number, number];
const boundsOf = (p: Poly): Box2 => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; };
const indexes = new WeakMap<object, Buckets>();
/** the index of a list of shapes (one bounding box each), caught up with what was appended since */
function indexOf<T>(list: T[], box: (t: T) => Box2): Buckets {
  let ix = indexes.get(list);
  if (!ix || ix.n > list.length) indexes.set(list, ix = new Buckets());
  for (; ix.n < list.length; ix.n++) { const [x0, y0, x1, y1] = box(list[ix.n]); ix.add(ix.n, x0, y0, x1, y1); }
  return ix;
}
/** route lines by segment: id = line × 65536 + segment */
function segmentsOf(lines: { pts: P2[] }[]): Buckets {
  let ix = indexes.get(lines);
  if (!ix || ix.n > lines.length) indexes.set(lines, ix = new Buckets());
  for (; ix.n < lines.length; ix.n++) {
    const pts = lines[ix.n].pts;
    for (let i = 0; i + 1 < pts.length; i++) {
      // the cells the segment passes through, not its bounding box (on screen most segments are diagonal, and a long
      // one's box covers hundreds of cells it never touches): short pieces, each indexed by its own box, 1 px wider
      const a = pts[i], b = pts[i + 1], id = ix.n * 65536 + i;
      const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL / 2)));
      for (let m = 0; m < k; m++) {
        const u0 = m / k, u1 = (m + 1) / k;
        const x0 = a[0] + (b[0] - a[0]) * u0, y0 = a[1] + (b[1] - a[1]) * u0, x1 = a[0] + (b[0] - a[0]) * u1, y1 = a[1] + (b[1] - a[1]) * u1;
        ix.add(id, Math.min(x0, x1) - 1, Math.min(y0, y1) - 1, Math.max(x0, x1) + 1, Math.max(y0, y1) + 1);
      }
    }
  }
  return ix;
}
const near = (ix: Buckets, x0: number, y0: number, x1: number, y1: number) => ix.query(x0, y0, x1, y1);
const polyBox = (p: Poly) => boundsOf(p);
const rectBox = (r: Rect): Box2 => [r.x, r.y, r.x + r.w, r.y + r.h];

/** The samples j (0 … n−1, at (j + ½)/n along a→b) that may lie in a box: a range, one wider each side. */
function sampleRange(a: P2, b: P2, n: number, [x0, y0, x1, y1]: Box2): [number, number] {
  let lo = 0, hi = n - 1;
  for (const k of [0, 1] as const) {
    const d = b[k] - a[k], min = k ? y0 : x0, max = k ? y1 : x1;
    if (Math.abs(d) < 1e-12) { if (a[k] < min || a[k] > max) return [1, 0]; continue; }
    let t0 = ((min - a[k]) / d) * n - 0.5, t1 = ((max - a[k]) / d) * n - 0.5;
    if (t0 > t1) [t0, t1] = [t1, t0];
    lo = Math.max(lo, Math.floor(t0) - 1); hi = Math.min(hi, Math.ceil(t1) + 1);
  }
  return [lo, hi];
}

export class Obstacles {
  polys: { poly: Poly; owner: string }[] = [];
  rects: { r: Rect; owner: string }[] = [];
  lines: { pts: P2[]; owner: string }[] = [];
  /** everything drawn over the floor (nodes, walls, gates): floor text under them is hidden */
  solids: Poly[] = [];
  /** text lying in a plane (floor and face labels), as parallelograms */
  slants: Poly[] = [];
  /** label spots the scene may still weigh (see LABEL_BUDGET in src/iso-objects/scene.ts); shared with forks */
  budget = { spots: Infinity, over: false, told: false };
  /** px² of a rectangle hidden under solids */
  hidden(r: Rect): number {
    let c = 0;
    for (const i of near(indexOf(this.solids, polyBox), ...rectBox(r))) c += polyRectArea(this.solids[i], r);
    return c;
  }
  /** px² of a convex polygon (slanted floor text) hidden under solids */
  hiddenPoly(q: Poly): number {
    let c = 0;
    for (const i of near(indexOf(this.solids, polyBox), ...boundsOf(q))) c += convexOverlap(q, this.solids[i]);
    return c;
  }
  /** like cost(), for a convex polygon */
  costPoly(q: Poly, limit = Infinity): number {
    const qb = boundsOf(q);
    let c = 0;
    for (const i of near(indexOf(this.polys, p => polyBox(p.poly)), ...qb)) c += convexOverlap(q, this.polys[i].poly);
    for (const i of near(indexOf(this.rects, x => rectBox(x.r)), ...qb)) c += polyRectArea(q, this.rects[i].r) * 2;
    for (const i of near(indexOf(this.slants, polyBox), ...qb)) c += convexOverlap(q, this.slants[i]) * 2;
    // (a caller comparing against a best so far passes it as `limit`: past it, the exact sum no longer matters)
    if (c >= limit) return c;
    for (const id of near(segmentsOf(this.lines), ...qb)) {
      if (c >= limit) return c;
      const pts = this.lines[Math.floor(id / 65536)].pts, i = id % 65536;
      const a = pts[i], b = pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / 4));
      // only the samples that can fall in q's bounds (a sample outside them is outside q), one more each side to be
      // safe with rounding; in order, so the sum is the same
      const [j0, j1] = sampleRange(a, b, n, qb);
      for (let j = j0; j <= j1; j++) if (inConvex(q, [a[0] + (b[0] - a[0]) * (j + 0.5) / n, a[1] + (b[1] - a[1]) * (j + 0.5) / n])) c += (len / n) * 4 * 0.6;
    }
    return c;
  }
  /** px² a rectangle shares with nodes, labels and (weighted by lineW) route lines */
  cost(r: Rect, owner?: string, lineW = 0.6): number {
    const rb = rectBox(r);
    let c = 0;
    for (const i of near(indexOf(this.polys, p => polyBox(p.poly)), ...rb)) { const p = this.polys[i]; c += polyRectArea(p.poly, r) * (p.owner === owner ? 1.5 : 1); }
    for (const i of near(indexOf(this.rects, x => rectBox(x.r)), ...rb)) { const q = this.rects[i]; if (q.owner !== owner || !owner) c += rectArea(q.r, r) * 2; }
    for (const i of near(indexOf(this.slants, polyBox), ...rb)) c += polyRectArea(this.slants[i], r) * 2;
    if (lineW) {
      // each line's share, summed over its segments in order (as lineRectArea does), then weighted
      let line = -1, a = 0;
      for (const id of near(segmentsOf(this.lines), ...rb)) {
        const li = Math.floor(id / 65536);
        if (li !== line) { if (line >= 0) c += a * lineW; line = li; a = 0; }
        // lineRectArea's samples on this segment, only those that can fall in r (the same sum)
        const pts = this.lines[li].pts, i = id % 65536, p = pts[i], q = pts[i + 1];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.ceil(len / 4));
        const [j0, j1] = sampleRange(p, q, n, rb);
        for (let j = j0; j <= j1; j++) {
          const x = p[0] + (q[0] - p[0]) * (j + 0.5) / n, y = p[1] + (q[1] - p[1]) * (j + 0.5) / n;
          if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) a += (len / n) * 4;
        }
      }
      if (line >= 0) c += a * lineW;
    }
    return c;
  }
  /** a copy whose added rectangles do not reach this one (callouts of one step) */
  fork(): Obstacles {
    const o = new Obstacles();
    o.budget = this.budget; o.polys = this.polys; o.lines = this.lines; o.solids = this.solids; o.rects = [...this.rects]; o.slants = this.slants;
    return o;
  }
}

export interface LabelText { name?: string; sub?: string }
export interface PlacedLabel { x: number; y: number; anchor: 'start' | 'middle' | 'end'; rect: Rect }

const LINE = 14;
/** The rectangle a label block covers when its first baseline is at (x, y). */
export function labelRect(t: LabelText, x: number, y: number, anchor: 'start' | 'middle' | 'end'): Rect {
  const w = Math.max(t.name ? textWidth(t.name, FONTS.lbl) : 0, t.sub ? textWidth(t.sub, FONTS.sub) : 0) + 4;
  const lines = (t.name ? 1 : 0) + (t.sub ? 1 : 0);
  const top = y - (t.name ? 11 : 9) - 1;
  const h = (lines - 1) * LINE + (t.name ? 11 : 9) + 4;
  const left = anchor === 'start' ? x - 2 : anchor === 'end' ? x - w + 2 : x - w / 2;
  return { x: left, y: top, w, h };
}

/**
 * Place a node's label. Spots, each with a penalty that says how natural it is: above the node clear of its top (the
 * references' place), a little higher, beside it, then below. Each spot costs its penalty plus what it covers;
 * route lines count little, since labels have a halo. The cheapest wins.
 */
export function placeNodeLabel(t: LabelText, box: Box, own: Poly, obs: Obstacles, owner: string, preferred?: { x: number; y: number; anchor: 'start' | 'middle' | 'end' }): PlacedLabel {
  const sb = polyBounds(own);
  const cx = iso((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, box.z1)[0];
  const lines = (t.name ? 1 : 0) + (t.sub ? 1 : 0);
  const blockBelowBaseline = (lines - 1) * LINE + 4;
  const aboveY = sb.y - 6 - blockBelowBaseline;   // the last line clears the silhouette's top
  const midY = sb.y + Math.min(sb.h, 60) * 0.45;
  const cands: { x: number; y: number; anchor: 'start' | 'middle' | 'end'; pen: number }[] = [];
  if (preferred) cands.push({ ...preferred, pen: 0 });
  cands.push({ x: cx, y: aboveY, anchor: 'middle', pen: preferred ? 20 : 0 });
  for (const up of [12, 24, 40]) cands.push({ x: cx, y: aboveY - up, anchor: 'middle', pen: 20 + up });
  for (const dx of [-30, 30, -60, 60]) cands.push({ x: cx + dx, y: aboveY - 4, anchor: 'middle', pen: 30 + Math.abs(dx) });
  cands.push({ x: sb.x + sb.w + 8, y: midY, anchor: 'start', pen: 120 });
  cands.push({ x: sb.x - 8, y: midY, anchor: 'end', pen: 120 });
  cands.push({ x: cx, y: sb.y + sb.h + 14, anchor: 'middle', pen: 300 });
  let best: PlacedLabel | undefined, bestCost = Infinity;
  for (const c of cands) {
    const rect = labelRect(t, c.x, c.y, c.anchor);
    const cost = obs.cost(rect, owner, 0.15) * 2 + c.pen;
    if (cost < bestCost) { bestCost = cost; best = { x: c.x, y: c.y, anchor: c.anchor, rect }; }
  }
  return best!;
}

export interface CalloutSpot { x: number; y: number; anchor: 'start' | 'middle' | 'end'; rect: Rect }
/** The rectangle of a callout pill whose text centre line is at y. */
export function calloutRect(w: number, x: number, y: number, anchor: 'start' | 'middle' | 'end'): Rect {
  const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return { x: left - 2, y: y - 14, w: w + 4, h: 28 };
}
/**
 * Place a step's callout pill: where the author put it if that is clear, else around its anchor (above first),
 * whichever covers least of the nodes, the labels and the step's other callouts. Callouts move; labels stay.
 */
export function placeCallout(w: number, ax: number, ay: number, preferred: { x: number; y: number; anchor: 'start' | 'middle' | 'end' }, obs: Obstacles): CalloutSpot {
  const cands: { x: number; y: number; anchor: 'start' | 'middle' | 'end'; pen: number }[] = [{ ...preferred, pen: 0 }];
  for (const dy of [-46, -66, -86, -106, -126, -146]) for (const dx of [0, -70, 70, -140, 140]) {
    cands.push({ x: ax + dx, y: ay + dy, anchor: 'middle', pen: 10 + (-dy - 46) * 0.5 + Math.abs(dx) * 0.4 });
  }
  for (const dy of [34, 60, 86]) cands.push({ x: ax, y: ay + dy, anchor: 'middle', pen: 60 + dy * 0.3 });
  const pdx = preferred.x - ax, pdy = preferred.y - ay;
  for (const k of [-1, 1]) for (const d of [16, 32, 48]) cands.push({ ...preferred, y: ay + pdy + k * d, x: ax + pdx, pen: 5 + d });
  for (const k of [-1, 1]) for (const d of [30, 60, 90]) for (const e of [0, 16, -16]) cands.push({ ...preferred, x: ax + pdx + k * d, y: ay + pdy + e, pen: 8 + d * 0.6 + Math.abs(e) });
  let best: CalloutSpot | undefined, bestCost = Infinity;
  for (const c of cands) {
    const rect = calloutRect(w, c.x, c.y, c.anchor);
    const cost = obs.cost(rect, undefined, 0.05) * 3 + c.pen;
    if (cost < bestCost) { bestCost = cost; best = { x: c.x, y: c.y, anchor: c.anchor, rect }; }
  }
  return best!;
}

const area = (p: Poly) => { let a = 0; for (let i = 0; i < p.length; i++) { const u = p[i], v = p[(i + 1) % p.length]; a += u[0] * v[1] - v[0] * u[1]; } return a / 2; };
const ccw = (p: Poly) => (area(p) < 0 ? [...p].reverse() : p);

export function inConvex(poly: Poly, q: P2): boolean {
  const p = ccw(poly);
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    if ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) < 0) return false;
  }
  return true;
}

/** Area of the intersection of two convex polygons (Sutherland–Hodgman, clipping a by each edge of b). */
export function convexOverlap(a: Poly, b: Poly): number {
  let out: Poly = ccw(a);
  const c = ccw(b);
  for (let i = 0; i < c.length && out.length; i++) {
    const e0 = c[i], e1 = c[(i + 1) % c.length];
    const side = (p: P2) => (e1[0] - e0[0]) * (p[1] - e0[1]) - (e1[1] - e0[1]) * (p[0] - e0[0]);
    const inp = out; out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length], sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
  }
  return out.length >= 3 ? Math.abs(area(out)) : 0;
}
