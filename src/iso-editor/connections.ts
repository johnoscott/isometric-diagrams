// Which of a drawing's routes are connections of the file's own: a route whose path is an entry of its own (not an object,
// not a key inside one, not a whole section), that nothing else in the drawing stands for. Only these are offered as
// connections (a wider place to click, the keyboard): elsewhere a route shows an object, or one of its settings. Pure.

import { fromPointer } from './path.ts';

/** path → route id, in the file's order as the drawing maps it */
export function connectionsOf(pathOf: ReadonlyMap<string, string>, isRoute: (id: string) => boolean, objectOf: (ptr: string) => unknown): Map<string, string> {
  const uses = new Map<string, number>();
  for (const p of pathOf.values()) uses.set(p, (uses.get(p) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const [id, p] of pathOf) if (isRoute(id) && uses.get(p) === 1 && fromPointer(p).length >= 2 && objectOf(p) === undefined) out.set(p, id);
  return out;
}

/** the nearest point of a polyline path ("M x,y L x,y …", the numbers taken in pairs) to a point */
export function nearestOn(d: string, x: number, y: number): { x: number; y: number; dist: number } | undefined {
  const n = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number), pts: [number, number][] = [];
  for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
  let best: { x: number; y: number; dist: number } | undefined;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], l2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2)) : 0;
    const px = ax + (bx - ax) * t, py = ay + (by - ay) * t, dist = Math.hypot(px - x, py - y);
    if (!best || dist < best.dist) best = { x: px, y: py, dist };
  }
  return best;
}
