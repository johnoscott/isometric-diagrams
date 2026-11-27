// The geometry an interactive view and an editor need over a laid-out scene (moved here from the editor canvas's
// drawing, R1 S3): a screen move as a floor move, where an item sits in its parent's frame, a box's outline and floor
// on screen, and where a drag lands, inside its parent and clear of its siblings. Pure.

import { C, S, iso } from '../iso-core/kernel.ts';
import type { CompiledScene } from './compile.ts';
import { type KindCatalog, regionKind } from './kinds.ts';

/** A move on screen (SVG units) as a move on the floor (grid units): the inverse of the iso projection at one height. */
export function screenToGrid(dx: number, dy: number): [number, number] {
  const a = dx / (C * S), b = (2 * dy) / S;   // a = x − y, b = x + y
  return [(a + b) / 2, (b - a) / 2];
}

/** Where an element sits in its parent's frame (what at: means), in grid units. */
export function localAt(sc: CompiledScene, id: string): [number, number] | undefined {
  const p = sc.layout.byId.get(id);
  if (!p) return undefined;
  const o = p.parent ? [p.parent.box.x0, p.parent.box.y0] : [0, 0];
  return [p.box.x0 - o[0], p.box.y0 - o[1]];
}

type Box3 = { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number };
/** The outline a box makes on screen: the convex hull of its eight projected corners (a hexagon, seen from above). */
export function boxSilhouette(b: Box3): [number, number][] {
  const pts: [number, number][] = [];
  for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) pts.push(iso(x, y, z));
  return hull(pts);
}
/** A region's floor: its footprint at the height it stands on, projected (a parallelogram). */
export function floorOf(b: Box3): [number, number][] {
  return [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(([x, y]) => iso(x, y, b.z0));
}
/** convex hull (Andrew's monotone chain), counter-clockwise, no repeated point */
function hull(p: [number, number][]): [number, number][] {
  const pts = [...new Map(p.map(q => [`${q[0].toFixed(3)},${q[1].toFixed(3)}`, q])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], hi: [number, number][] = [];
  for (const q of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-9) lo.pop(); lo.push(q); }
  for (const q of [...pts].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 1e-9) hi.pop(); hi.push(q); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

// ---------- dragging: where a move lands, inside its parent, clear of its siblings ----------

/** a region's inner margin: its own, else its kind's (as place.ts pads it); 0 for a kind the catalogue doesn't have */
export const paddingOf = (cat: KindCatalog, region: { kind?: string; padding?: number } | undefined) => region?.padding ?? regionKind(cat, region?.kind)?.pad ?? 0;

export interface Move {
  /** the new at: in the parent's frame */
  at: [number, number];
  /** the grid move actually made (after snapping and clamping) */
  delta: [number, number];
  /** which edges of the parent stopped it */
  clamped: { left: boolean; right: boolean; top: boolean; bottom: boolean };
}

/**
 * A drag of (dx, dy) grid units, from `start` (at: in the parent's frame), to a position snapped to `step` (1: whole
 * cells; 0.5: half cells), then clamped so the item's footprint `size` stays inside its parent's inner area (`parent`: its size, `pad`:
 * its margin). With no parent (the scene), nothing clamps. (0.28.0) `parent.grow`: a side that grows (a group that fits what it
 * holds, dragged past its right or front edge) isn't held at its edge, only kept within GROW_REACH cells of the furthest the
 * thing has been on that side (`reach`, its position there; the edge, if it has been no further): no runaway from a fling.
 */
export const GROW_REACH = 2;
export function snapMove(start: [number, number], d: [number, number], step: number, size: [number, number],
  parent?: { w: number; d: number; pad: number; grow?: { right?: boolean; front?: boolean; reach?: [number, number] } }): Move {
  const snap = (v: number) => Math.round(v / step) * step;
  // the position lands on the grid (the lines drawn while dragging), not just moves by whole steps
  let x = snap(start[0] + d[0]), y = snap(start[1] + d[1]);
  const clamped = { left: false, right: false, top: false, bottom: false };
  if (parent) {
    // the bounds are on the grid too (the layout snaps positions to it), inside the parent's margin
    const lo = Math.ceil(parent.pad / step - 1e-9) * step;
    const hiX = Math.floor((parent.w - parent.pad - size[0]) / step + 1e-9) * step, hiY = Math.floor((parent.d - parent.pad - size[1]) / step + 1e-9) * step;
    if (x < lo) { x = lo; clamped.left = true; }
    const g = parent.grow, far = (hi: number, reach: number | undefined) => Math.floor((Math.max(hi, reach ?? hi) + GROW_REACH) / step + 1e-9) * step;
    const maxX = g?.right ? far(hiX, g.reach?.[0]) : hiX, maxY = g?.front ? far(hiY, g.reach?.[1]) : hiY;
    if (maxX >= lo && x > maxX) { x = maxX; clamped.right = !g?.right; }
    if (y < lo) { y = lo; clamped.top = true; }
    if (maxY >= lo && y > maxY) { y = maxY; clamped.bottom = !g?.front; }
  }
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { at: [r(x), r(y)], delta: [r(x - start[0]), r(y - start[1])], clamped };
}

/** Does a footprint overlap any of these (sharing an edge isn't overlapping)? */
export function overlaps(a: { x0: number; y0: number; x1: number; y1: number }, others: { x0: number; y0: number; x1: number; y1: number }[]): boolean {
  const e = 1e-6;
  return others.some(b => a.x0 < b.x1 - e && a.x1 > b.x0 + e && a.y0 < b.y1 - e && a.y1 > b.y0 + e);
}

/** (0.28.0) a group's resize handle: its front-right corner (width and depth), or the middle of its right side (width) or of its
 *  front side (depth). Left and back wait for the owner (canvas.ts GROW_SIDES). */
export type ResizeHandle = 'corner' | 'right' | 'front';
/** The smallest floor a group can have and still hold what it holds: its children's furthest extent, and its margin, from its corner
 *  (on the grid `step`; at least two margins and half a cell, as a fitting group is). Boxes in the same frame as `box`. */
export function minSizeFor(box: { x0: number; y0: number }, children: { x1: number; y1: number }[], pad: number, step = 1): [number, number] {
  const up = (v: number) => Math.ceil(v / step - 1e-9) * step;
  const w = Math.max(pad * 2 + 0.5, ...children.map(c => c.x1 - box.x0 + pad)), d = Math.max(pad * 2 + 0.5, ...children.map(c => c.y1 - box.y0 + pad));
  return [up(w), up(d)];
}
/** A drag of (dx, dy) grid units on a resize handle, from `size0`: the new floor, snapped to `step`, never below `min` (`held`: it
 *  stopped there). The corner changes both; the right side the width alone; the front side the depth alone. */
export function resizeTo(size0: [number, number], d: [number, number], handle: ResizeHandle, step: number, min: [number, number]): { size: [number, number]; held: boolean } {
  const snap = (v: number) => Math.round(v / step) * step;
  let w = handle === 'front' ? size0[0] : snap(size0[0] + d[0]), dd = handle === 'right' ? size0[1] : snap(size0[1] + d[1]);
  let held = false;
  if (w < min[0]) { w = min[0]; held = handle !== 'front'; }
  if (dd < min[1]) { dd = min[1]; held ||= handle !== 'right'; }
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { size: [r(w), r(dd)], held };
}
