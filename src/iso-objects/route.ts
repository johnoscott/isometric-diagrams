// Routes: orthogonal paths on the floor between node sides, auto-routed around nodes, with lanes where several
// routes share a side, and steps up and down where a path crosses onto a raised region (as the references draw
// them: [12.6,2.6,zm] → [12.6,2.6,zd]).

import type { Box, P3 } from '../iso-core/kernel.ts';
import { didYouMean, type Diag } from '../iso-core/errors.ts';
import type { Placed, RawScene } from './types.ts';
import { WALL_T, type Layout, type Located } from './place.ts';
import { regionKind } from './kinds.ts';

export type Side = 'n' | 'e' | 's' | 'w' | 'top';
export interface RawRoute {
  id: string; from: string; to: string; kind?: string; via?: (number[] | string)[]; points?: number[][];
  lane?: number; arrow?: boolean; cross?: boolean;
  label?: string | { text: string; along?: number; side?: 'left' | 'right'; at?: number[]; dir?: 'x' | 'y'; anchor?: 'start' | 'middle' | 'end' };
  appears?: string | number; disappears?: string | number;
}
export interface Routed {
  id: string; raw: RawRoute; path: string; kind: string;
  points: P3[];
  from?: Placed; to?: Placed;
}

const GRID = 0.2;
const OUT = 0.05;      // ends stop this far from a face, so arrowheads show
const LANE = 0.6;      // spacing of parallel routes on one side
const INFLATE = 0.25;  // clearance around obstacles

interface End { node: Placed; side: Side; explicit: boolean; p: [number, number]; z: number }

const sideNormal: Record<Exclude<Side, 'top'>, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

export function parseEnd(s: string): { id: string; side?: Side } {
  const m = /^(.*?)(?:\.(n|e|s|w|top))?$/.exec(s)!;
  return { id: m[1], side: m[2] as Side | undefined };
}

/** Floor height under a point: the deepest raised region containing it. */
/** the regions that make a floor (not walled ones, zones or tunnels: their kinds say floor: false), with their depth:
 *  per layout, once (a label's search asks for the floor under every corner of every spot it weighs, and a large
 *  drawing has hundreds of items) */
const floors = new WeakMap<Layout, { r: Layout['items'][number]; d: number }[]>();
export function floorAt(layout: Layout, x: number, y: number): number {
  let fs = floors.get(layout);
  if (!fs) {
    fs = [];
    for (const r of layout.items) {
      if (r.type !== 'region') continue;
      if (!regionKind(layout.catalog, r.region!.kind)?.floor) continue;
      let d = 0; for (let a = r.parent; a; a = a.parent) d++;
      fs.push({ r, d });
    }
    floors.set(layout, fs);
  }
  let best = 0, depth = -1;
  for (const { r, d } of fs) {
    const b = r.box, e = 1e-6;
    if (x >= b.x0 - e && x <= b.x1 + e && y >= b.y0 - e && y <= b.y1 + e && d > depth) { depth = d; best = r.floor; }
  }
  return best;
}

function autoSide(a: Box, b: Box): Exclude<Side, 'top'> {
  const ac = [(a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2], bc = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  const dx = bc[0] - ac[0], dy = bc[1] - ac[1];
  // prefer the axis with a clear gap between the boxes
  const gapX = Math.max(b.x0 - a.x1, a.x0 - b.x1), gapY = Math.max(b.y0 - a.y1, a.y0 - b.y1);
  if (gapX > 0 && (gapY <= 0 || gapX >= gapY)) return dx > 0 ? 'e' : 'w';
  if (gapY > 0) return dy > 0 ? 's' : 'n';
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
}

export interface RouteResult { routes: Routed[]; diags: Diag[] }

/**
 * The search steps routing may take in one scene. The heaviest diagram in this repo takes about 57,000
 * (the session-messaging reproduction in repro/); a drawing with 40 more nodes took 11 million, and minutes. Past the budget,
 * the routes left are drawn as plain elbows and the scene says so, so a large diagram draws in about a second.
 */
export const ROUTE_BUDGET = 500_000;

export function routeAll(scene: RawScene, scenePath: string, layout: Layout, src: Located, kinds: Set<string>, snap?: number): RouteResult {
  const diags: Diag[] = [];
  const err = (path: string, message: string, hint?: string, severity: 'error' | 'warning' = 'error') => {
    const p = src.locate(path); diags.push({ severity, message, line: p.line, col: p.col, path, hint });
  };
  const raws = (scene.routes ?? []) as RawRoute[];
  const budget = { left: ROUTE_BUDGET };
  let overBudget = 0;
  const nodeIds = () => layout.items.map(i => i.id);
  const seen = new Map<string, number>();
  const routes: Routed[] = [];

  // ---- resolve ends ----
  const ends: { r: Routed; a?: End; b?: End }[] = [];
  raws.forEach((raw, i) => {
    const path = `${scenePath}/routes/${i}`;
    if (seen.has(raw.id) || layout.byId.has(raw.id)) err(path + '/id', `duplicate id "${raw.id}"`);
    seen.set(raw.id, i);
    const kind = raw.kind ?? 'send';
    if (!kinds.has(kind)) err(path + '/kind', `unknown flow kind "${kind}"` + dym(kind, kinds), `kinds: ${[...kinds].join(', ')}; add one under "kinds:"`);
    const r: Routed = { id: raw.id, raw, path, kind, points: [] };
    const get = (s: string, key: 'from' | 'to') => {
      const { id } = parseEnd(s);
      const p = layout.byId.get(id);
      if (!p) { err(`${path}/${key}`, `unknown node "${id}"` + dym(id, nodeIds())); return undefined; }
      return p;
    };
    r.from = get(raw.from, 'from'); r.to = get(raw.to, 'to');
    routes.push(r);
    ends.push({ r });
  });

  // sides and lanes
  type Slot = { e: End; other: [number, number] };
  const slots = new Map<string, Slot[]>();
  for (const it of ends) {
    const { r } = it;
    if (!r.from || !r.to || r.raw.points) continue;
    const fs = parseEnd(r.raw.from).side, ts = parseEnd(r.raw.to).side;
    const first = r.raw.via?.[0], last = r.raw.via?.[r.raw.via.length - 1];
    const toward = (v: (number[] | string) | undefined, fallback: Placed): Box => {
      if (Array.isArray(v)) return { x0: v[0], x1: v[0], y0: v[1], y1: v[1], z0: 0, z1: 0 };
      if (typeof v === 'string') { const p = layout.byId.get(parseEnd(v).id); if (p) return p.box; }
      return fallback.box;
    };
    const mk = (n: Placed, s: Side | undefined, other: Box): End => {
      const side = s ?? autoSide(n.box, other);
      return { node: n, side, explicit: !!s, p: [0, 0], z: 0 };
    };
    it.a = mk(r.from, fs, toward(first, r.to));
    it.b = mk(r.to, ts, toward(last, r.from));
    const ob = toward(first, r.to), oa = toward(last, r.from);
    for (const [e, o] of [[it.a, ob], [it.b, oa]] as [End, Box][]) {
      const key = `${e.node.id}.${e.side}`;
      if (!slots.has(key)) slots.set(key, []);
      slots.get(key)!.push({ e, other: [(o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2] });
    }
  }
  for (const [, list] of slots) {
    const e0 = list[0].e, b = e0.node.box, side = e0.side;
    const along = side === 'e' || side === 'w' ? 1 : 0;  // the coordinate that varies along the side
    list.sort((p, q) => p.other[along] - q.other[along]);
    const lo = along ? b.y0 : b.x0, hi = along ? b.y1 : b.x1, mid = (lo + hi) / 2;
    const span = Math.max(0, hi - lo - 0.3), step = list.length > 1 ? Math.min(LANE, span / (list.length - 1)) : 0;
    list.forEach((s, i) => {
      const off = (i - (list.length - 1) / 2) * step;
      const c = mid + off;
      const z = s.e.node.box.z0;
      if (side === 'top') { s.e.p = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; s.e.z = b.z1; return; }
      const [nx, ny] = sideNormal[side];
      s.e.p = along ? [nx > 0 ? b.x1 + OUT : b.x0 - OUT, c] : [c, ny > 0 ? b.y1 + OUT : b.y0 - OUT];
      s.e.z = z;
    });
  }

  // ---- obstacles ----
  const obstacles: Box[] = [];
  for (const p of layout.items) {
    if (p.type === 'node') obstacles.push(p.box);
  }
  const walls: Box[] = [];
  for (const f of layout.items.filter(p => regionKind(layout.catalog, p.region?.kind)?.shape === 'walled')) {
    const { x0, y0, x1, y1 } = f.box, t = WALL_T, g = f.region!.gate;
    const sides: [Box, 'n' | 'e' | 's' | 'w'][] = [
      [{ x0, y0, x1, y1: y0 + t, z0: 0, z1: 0 }, 'n'], [{ x0, y0: y1 - t, x1, y1, z0: 0, z1: 0 }, 's'],
      [{ x0, y0, x1: x0 + t, y1, z0: 0, z1: 0 }, 'w'], [{ x0: x1 - t, y0, x1, y1, z0: 0, z1: 0 }, 'e'],
    ];
    for (const [w, side] of sides) {
      if (g && g.side === side) {
        // the gate is passable only through its node (an obstacle like any node) or its gap when it has no node
        if (g.node) continue;
        const at = g.at ?? 0.5, gw = g.width ?? 2;
        if (side === 'e' || side === 'w') { const c = y0 + (y1 - y0) * at; walls.push({ ...w, y1: c - gw / 2 }, { ...w, y0: c + gw / 2 }); }
        else { const c = x0 + (x1 - x0) * at; walls.push({ ...w, x1: c - gw / 2 }, { ...w, x0: c + gw / 2 }); }
      } else walls.push(w);
    }
  }

  // ---- route each ----
  const used = new Map<string, number>();
  for (const it of ends) {
    const { r, a, b } = it;
    if (r.raw.points) {
      r.points = r.raw.points.map(q => [q[0], q[1], q.length > 2 ? q[2] : floorAt(layout, q[0], q[1]) + 0.01] as P3);
      continue;
    }
    if (!a || !b) continue;
    const vias: { p: [number, number]; dir?: [number, number] }[] = [];
    (r.raw.via ?? []).forEach((v, vi) => {
      if (Array.isArray(v)) {
        if (snap) {
          const q = (u: number) => Math.round(Math.round(u / snap) * snap * 1e9) / 1e9;
          v.forEach((u, k) => { if (Math.abs(u / snap - Math.round(u / snap)) > 1e-6) err(`${r.path}/via/${vi}/${k}`, `${u} is not on the ${snap} grid; it is drawn at ${q(u)}`, undefined, 'warning'); });
          vias.push({ p: [q(v[0]), q(v[1])] });
        } else vias.push({ p: [v[0], v[1]] });
      }
      else {
        const { id, side } = parseEnd(v), n = layout.byId.get(id);
        if (!n) { err(`${r.path}/via/${vi}`, `unknown node "${id}"` + dym(id, nodeIds())); return; }
        const s = (side && side !== 'top') ? side : 'n';
        const [nx, ny] = sideNormal[s], bx = n.box;
        vias.push({ p: [nx ? (nx > 0 ? bx.x1 + 0.4 : bx.x0 - 0.4) : (bx.x0 + bx.x1) / 2, ny ? (ny > 0 ? bx.y1 + 0.4 : bx.y0 - 0.4) : (bx.y0 + bx.y1) / 2] });
      }
    });
    const obs = obstacles.filter(o => o !== a.node.box && o !== b.node.box).concat(r.raw.cross ? [] : walls);
    // nodes standing on an end node, or that an end stands on, do not block it
    const blockers = obs.filter(o => !contains(a.node.box, o) && !contains(b.node.box, o) && !contains(o, a.node.box) && !contains(o, b.node.box));
    const startDir = a.side === 'top' ? undefined : sideNormal[a.side];
    const endDir = b.side === 'top' ? undefined : sideNormal[b.side];
    const stops = [a.p, ...vias.map(v => v.p), b.p];
    let pts2: [number, number][] = [a.p];
    let dir = startDir;
    let ok = true;
    for (let i = 0; i + 1 < stops.length; i++) {
      const last = i + 2 === stops.length;
      const seg = astar(stops[i], stops[i + 1], blockers, used, dir, last && endDir ? [-endDir[0], -endDir[1]] as [number, number] : undefined, budget);
      if (!seg) { ok = false; break; }
      pts2.push(...seg.slice(1));
      const n = pts2.length;
      if (n >= 2) { const dx = Math.sign(pts2[n - 1][0] - pts2[n - 2][0]), dy = Math.sign(pts2[n - 1][1] - pts2[n - 2][1]); dir = [dx, dy]; }
    }
    if (!ok && budget.left <= 0) { overBudget++; pts2 = [a.p, [b.p[0], a.p[1]], b.p]; }
    else if (!ok) {
      err(r.path, `no path found for route "${r.id}" from "${a.node.id}" to "${b.node.id}"`, 'add "via" points, or use "points" to draw it by hand', 'warning');
      pts2 = [a.p, [b.p[0], a.p[1]], b.p];
    }
    pts2 = simplify(pts2);
    for (let i = 0; i + 1 < pts2.length; i++) mark(used, pts2[i], pts2[i + 1]);
    r.points = withHeights(layout, pts2, a, b);
  }

  if (overBudget) err(scenePath, `${overBudget} of ${routes.length} routes were drawn as plain elbows: the scene is too large to route them all around what stands in the way (${ROUTE_BUDGET.toLocaleString('en')} search steps)`, 'split it into scenes, or give the busiest routes "via" points or "points"', 'warning');
  // ---- route ids must be unique across nodes too; report steps referencing them later ----
  return { routes, diags };
}

function contains(outer: Box, inner: Box): boolean {
  return inner.x0 >= outer.x0 - 1e-6 && inner.x1 <= outer.x1 + 1e-6 && inner.y0 >= outer.y0 - 1e-6 && inner.y1 <= outer.y1 + 1e-6 && inner.z0 >= outer.z1 - 1e-6;
}

const key = (x: number, y: number) => `${Math.round(x / GRID)},${Math.round(y / GRID)}`;
function mark(used: Map<string, number>, a: [number, number], b: [number, number]) {
  const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / GRID));
  for (let i = 0; i <= n; i++) { const k = key(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n); used.set(k, (used.get(k) ?? 0) + 1); }
}

function blocked(x: number, y: number, obs: Box[]): boolean {
  for (const o of obs) if (x > o.x0 - INFLATE && x < o.x1 + INFLATE && y > o.y0 - INFLATE && y < o.y1 + INFLATE) return true;
  return false;
}

/**
 * Orthogonal A* on a GRID lattice from a to b, avoiding obstacles. Costs: length, a penalty per bend, a small cost on
 * cells other routes use (so lanes spread). The first move goes along startDir, the last along endDir, when given.
 */
function astar(a: [number, number], b: [number, number], obs: Box[], used: Map<string, number>, startDir?: [number, number], endDir?: [number, number], budget = { left: Infinity }): [number, number][] | null {
  // a straight line needs no search
  if ((Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6) && clear(a, b, obs)) {
    const d: [number, number] = [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
    const okStart = !startDir || (startDir[0] === d[0] && startDir[1] === d[1]);
    const okEnd = !endDir || (endDir[0] === d[0] && endDir[1] === d[1]);
    if (okStart && okEnd) return [a, b];
  }
  // the scene's budget spent: no search (and none of its arrays)
  if (budget.left <= 0) return null;
  // lattice anchored at a; b is joined from the nearest lattice point
  const gx = (x: number) => Math.round((x - a[0]) / GRID), gy = (y: number) => Math.round((y - a[1]) / GRID);
  const X = (i: number) => a[0] + i * GRID, Y = (j: number) => a[1] + j * GRID;
  const ti = gx(b[0]), tj = gy(b[1]);
  const pad = 30;
  const minI = Math.min(0, ti) - pad, maxI = Math.max(0, ti) + pad, minJ = Math.min(0, tj) - pad, maxJ = Math.max(0, tj) + pad;
  const BEND = 1.2, STEP = GRID, USED = 0.06;
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  type S = { i: number; j: number; d: number; g: number; f: number; prev?: S; idx: number; hp: number };
  // per lattice cell, worked out once a search: whether it's blocked, what other routes' use of it costs, and the best
  // cost so far to reach it heading each way (numbers in typed arrays, not string keys: the same answers, faster)
  const W = maxI - minI + 1, H = maxJ - minJ + 1;
  const cell = (i: number, j: number) => (i - minI) * H + (j - minJ);
  const blockedAt = new Int8Array(W * H).fill(-1);
  const usedAt = new Float64Array(W * H).fill(-1);
  const best = new Float64Array(W * H * 4).fill(Infinity);
  const isBlocked = (i: number, j: number) => { const c = cell(i, j); if (blockedAt[c] < 0) blockedAt[c] = blocked(X(i), Y(j), obs) ? 1 : 0; return blockedAt[c] === 1; };
  const usedCost = (i: number, j: number) => { const c = cell(i, j); if (usedAt[c] < 0) usedAt[c] = used.get(key(X(i), Y(j))) ?? 0; return usedAt[c]; };
  const open = openList<S>();
  const h = (i: number, j: number) => (Math.abs(i - ti) + Math.abs(j - tj)) * STEP;
  const sd = startDir ? dirs.findIndex(d => d[0] === startDir[0] && d[1] === startDir[1]) : -1;
  open.push({ i: 0, j: 0, d: sd, g: 0, f: h(0, 0), idx: 0, hp: 0 });
  const startNear = (i: number, j: number) => Math.abs(i) + Math.abs(j) <= 2;
  const endNear = (i: number, j: number) => Math.abs(i - ti) + Math.abs(j - tj) <= 2;
  let iter = 0;
  while (open.length() && iter++ < 200000) {
    if (budget.left-- <= 0) return null;
    const s = open.take();
    if (s.i === ti && s.j === tj) {
      if (endDir && s.d >= 0 && (dirs[s.d][0] !== endDir[0] || dirs[s.d][1] !== endDir[1])) { /* arrives the wrong way: keep searching */ }
      else {
        const out: [number, number][] = [];
        for (let q: S | undefined = s; q; q = q.prev) out.push([X(q.i), Y(q.j)]);
        out.reverse();
        out[0] = a;
        return fixEnd(simplify(out), b);
      }
    }
    for (let di = 0; di < 4; di++) {
      const d = dirs[di];
      if (s.d >= 0 && d[0] === -dirs[s.d][0] && d[1] === -dirs[s.d][1]) continue;
      const i = s.i + d[0], j = s.j + d[1];
      if (i < minI || i > maxI || j < minJ || j > maxJ) continue;
      if (!startNear(i, j) && !endNear(i, j) && isBlocked(i, j)) continue;
      if ((startNear(i, j) || endNear(i, j)) && isBlocked(i, j) && !(i === ti && j === tj)) {
        // near the ends, allow only moves straight out of the face
        const out = startNear(i, j) ? startDir : endDir && [-endDir[0], -endDir[1]];
        if (!out || (startNear(i, j) ? (d[0] !== out[0] || d[1] !== out[1]) : (d[0] !== endDir![0] || d[1] !== endDir![1]))) continue;
      }
      const bend = s.d >= 0 && s.d !== di ? BEND : 0;
      const g = s.g + STEP + bend + usedCost(i, j) * USED;
      const kk = cell(i, j) * 4 + di;
      if (best[kk] <= g) continue;
      best[kk] = g;
      open.push({ i, j, d: di, g, f: g + h(i, j), prev: s, idx: 0, hp: 0 });
    }
  }
  return null;
}

/**
 * A* open list, taking the state with the lowest f, ties to the one earliest in the list, where taking one moves the
 * last into its place (so the order is exactly that of the array scan this replaces, and every route is the same).
 * A binary heap ordered by (f, position): O(log n) a step instead of a scan of the whole list, which on a large drawing
 * (tens of thousands of open states, hundreds of thousands of steps) took minutes.
 */
export function openList<T extends { f: number; idx: number; hp: number }>() {
  const arr: T[] = [], heap: T[] = [];
  const less = (a: T, b: T) => a.f < b.f || (a.f === b.f && a.idx < b.idx);
  const swap = (x: number, y: number) => { const t = heap[x]; heap[x] = heap[y]; heap[y] = t; heap[x].hp = x; heap[y].hp = y; };
  const up = (k: number) => { while (k > 0) { const p = (k - 1) >> 1; if (!less(heap[k], heap[p])) break; swap(k, p); k = p; } };
  const down = (k: number) => {
    for (;;) {
      const l = 2 * k + 1, r = l + 1;
      let m = k;
      if (l < heap.length && less(heap[l], heap[m])) m = l;
      if (r < heap.length && less(heap[r], heap[m])) m = r;
      if (m === k) return;
      swap(k, m); k = m;
    }
  };
  return {
    length: () => arr.length,
    push(s: T) { s.idx = arr.length; arr.push(s); s.hp = heap.length; heap.push(s); up(s.hp); },
    take(): T {
      const s = heap[0], lastH = heap.pop()!;
      if (heap.length) { heap[0] = lastH; lastH.hp = 0; down(0); }
      // the list: the last state moves into the taken one's place (an earlier position: it rises in the heap)
      const last = arr.pop()!;
      if (last !== s) { arr[s.idx] = last; last.idx = s.idx; up(last.hp); }
      return s;
    },
  };
}

/**
 * The lattice is anchored at the start, so only the end was snapped: move the corner before it onto the exact end
 * coordinate, keeping every segment straight.
 */
function fixEnd(lat: [number, number][], b: [number, number]): [number, number][] {
  const q = lat.map(x => [x[0], x[1]] as [number, number]);
  const n = q.length, L = q[n - 1];
  if (n >= 2) {
    const prev = q[n - 2];
    if (Math.abs(prev[1] - L[1]) < 1e-9) { prev[1] = b[1]; if (n >= 3 && Math.abs(q[n - 3][1] - L[1]) < 1e-9) q[n - 3][1] = b[1]; }
    else if (Math.abs(prev[0] - L[0]) < 1e-9) { prev[0] = b[0]; if (n >= 3 && Math.abs(q[n - 3][0] - L[0]) < 1e-9) q[n - 3][0] = b[0]; }
  }
  q[n - 1] = b;
  return simplify(q);
}

function clear(a: [number, number], b: [number, number], obs: Box[]): boolean {
  const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / (GRID / 2)));
  for (let i = 2; i < n - 1; i++) if (blocked(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, obs)) return false;
  return true;
}

export function simplify(p: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const q of p) {
    const n = out.length;
    if (n && Math.abs(out[n - 1][0] - q[0]) < 1e-6 && Math.abs(out[n - 1][1] - q[1]) < 1e-6) continue;
    if (n >= 2) {
      const a = out[n - 2], b = out[n - 1];
      const col = (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(b[0] - q[0]) < 1e-6) || (Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(b[1] - q[1]) < 1e-6);
      if (col) { out[n - 1] = q; continue; }
    }
    out.push(q);
  }
  return out;
}

/** Give each point its floor height, with a vertical step where a segment crosses a region edge. */
function withHeights(layout: Layout, p: [number, number][], a: End, b: End): P3[] {
  const edgesX = new Set<number>(), edgesY = new Set<number>();
  for (const r of layout.items) {
    if (r.type !== 'region' || !regionKind(layout.catalog, r.region!.kind)?.floor) continue;
    edgesX.add(r.box.x0); edgesX.add(r.box.x1); edgesY.add(r.box.y0); edgesY.add(r.box.y1);
  }
  const out: P3[] = [];
  const zf = (x: number, y: number) => floorAt(layout, x, y) + 0.01;
  for (let i = 0; i + 1 < p.length; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[i + 1];
    const cuts = [0, 1];
    if (Math.abs(y0 - y1) < 1e-6) for (const e of edgesX) { const t = (e - x0) / (x1 - x0); if (t > 1e-6 && t < 1 - 1e-6) cuts.push(t); }
    else for (const e of edgesY) { const t = (e - y0) / (y1 - y0); if (t > 1e-6 && t < 1 - 1e-6) cuts.push(t); }
    cuts.sort((m, n) => m - n);
    for (let c = 0; c + 1 < cuts.length; c++) {
      const t0 = cuts[c], t1 = cuts[c + 1], tm = (t0 + t1) / 2;
      const z = zf(x0 + (x1 - x0) * tm, y0 + (y1 - y0) * tm);
      const P: P3 = [x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0, z], Q: P3 = [x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1, z];
      const last = out[out.length - 1];
      if (last && (Math.abs(last[0] - P[0]) > 1e-6 || Math.abs(last[1] - P[1]) > 1e-6 || Math.abs(last[2] - P[2]) > 1e-6)) out.push(P);
      else if (!last) out.push(P);
      out.push(Q);
    }
  }
  // ends sit at the floor their node stands on
  if (out.length) { out[0][2] = a.side === 'top' ? a.z : a.node.box.z0 + 0.01; out[out.length - 1][2] = b.side === 'top' ? b.z : b.node.box.z0 + 0.01; }
  // drop collinear points at equal height
  const res: P3[] = [];
  for (const q of out) {
    const n = res.length;
    if (n >= 2) {
      const u = res[n - 2], v = res[n - 1];
      const same = Math.abs(u[2] - v[2]) < 1e-9 && Math.abs(v[2] - q[2]) < 1e-9;
      const col = (Math.abs(u[0] - v[0]) < 1e-6 && Math.abs(v[0] - q[0]) < 1e-6) || (Math.abs(u[1] - v[1]) < 1e-6 && Math.abs(v[1] - q[1]) < 1e-6);
      if (same && col) { res[n - 1] = q; continue; }
    }
    res.push(q);
  }
  return res;
}

function dym(w: string, c: Iterable<string>): string {
  const d = didYouMean(w, c);
  return d ? ` (did you mean "${d}"?)` : '';
}
