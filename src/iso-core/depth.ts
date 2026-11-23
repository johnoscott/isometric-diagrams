// Painter's order for boxes seen from the isometric viewpoint (looking from +x, +y, +z toward the origin).
// A box is drawn before another when it is separated from it on the far side of some axis and their
// pictures overlap; everything else keeps the references' rule, the sum x0 + y0, then z0.

import { type Box, iso } from './kernel.ts';

export interface Drawable { box: Box; key?: number }

function screenRect(b: Box): [number, number, number, number] {
  const pts = [iso(b.x0, b.y0, b.z1), iso(b.x1, b.y0, b.z0), iso(b.x0, b.y1, b.z0), iso(b.x1, b.y1, b.z0), iso(b.x1, b.y1, b.z1), iso(b.x0, b.y0, b.z0)];
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** -1: a before b; 1: b before a; 0: no constraint */
function behind(a: Box, b: Box): number {
  const e = 1e-6;
  const ax = a.x1 <= b.x0 + e, bx = b.x1 <= a.x0 + e;
  const ay = a.y1 <= b.y0 + e, by = b.y1 <= a.y0 + e;
  const az = a.z1 <= b.z0 + e, bz = b.z1 <= a.z0 + e;
  const aFirst = ax || ay || az, bFirst = bx || by || bz;
  if (aFirst && !bFirst) return -1;
  if (bFirst && !aFirst) return 1;
  return 0;
}

export function depthSort<T extends Drawable>(list: T[]): T[] {
  const n = list.length;
  const rects = list.map(d => screenRect(d.box));
  const prio = (d: T) => d.box.x0 + d.box.y0 + d.box.z0 * 0.01;
  const after: number[][] = list.map(() => []);
  const indeg = new Array(n).fill(0);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const ri = rects[i], rj = rects[j];
    if (ri[2] <= rj[0] || rj[2] <= ri[0] || ri[3] <= rj[1] || rj[3] <= ri[1]) continue;
    const c = behind(list[i].box, list[j].box);
    if (c < 0) { after[i].push(j); indeg[j]++; } else if (c > 0) { after[j].push(i); indeg[i]++; }
  }
  const out: T[] = [];
  const ready = list.map((_, i) => i).filter(i => !indeg[i]);
  const used = new Array(n).fill(false);
  while (out.length < n) {
    if (!ready.length) {
      // a cycle (boxes that interpenetrate): take the furthest-back remaining box
      const rest = list.map((_, i) => i).filter(i => !used[i]).sort((x, y) => prio(list[x]) - prio(list[y]));
      ready.push(rest[0]);
      indeg[rest[0]] = 0;
    }
    ready.sort((x, y) => prio(list[x]) - prio(list[y]) || x - y);
    const i = ready.shift()!;
    if (used[i]) continue;
    used[i] = true; out.push(list[i]);
    for (const j of after[i]) if (!used[j] && --indeg[j] === 0) ready.push(j);
  }
  return out;
}
