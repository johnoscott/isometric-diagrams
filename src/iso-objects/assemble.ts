// Assemble mode: the timeline of an intro in which each region and node flies in from just outside the canvas,
// from the canvas edge nearest to where it ends up, then routes draw in and labels fade in. Computed at build time,
// so it can be tested without a browser; the player only plays it.

import type { Routed } from './route.ts';
import type { Layout } from './place.ts';
import type { Placed } from './types.ts';
import { polyBounds, silhouette, type Rect } from './labels.ts';

export type Edge = 'left' | 'right' | 'top' | 'bottom';
export interface Piece { id: string; kind: 'region' | 'node'; edge: Edge; dx: number; dy: number; delay: number; dur: number; bbox: Rect }
export interface Assembly {
  pieces: Piece[];
  routes: { id: string; delay: number; dur: number }[];
  labels: { delay: number; dur: number };
  /** ms until everything is in place */
  total: number;
}

const MARGIN = 24;

/** The edge of the canvas nearest a box, and the offset that puts the box fully outside the canvas beyond it. */
export function offscreen(b: Rect, vb: [number, number, number, number]): { edge: Edge; dx: number; dy: number } {
  const [vx, vy, vw, vh] = vb, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const d: [Edge, number][] = [['left', cx - vx], ['right', vx + vw - cx], ['top', cy - vy], ['bottom', vy + vh - cy]];
  d.sort((p, q) => p[1] - q[1]);
  const edge = d[0][0];
  if (edge === 'left') return { edge, dx: -(b.x + b.w - vx) - MARGIN, dy: 0 };
  if (edge === 'right') return { edge, dx: vx + vw - b.x + MARGIN, dy: 0 };
  if (edge === 'top') return { edge, dx: 0, dy: -(b.y + b.h - vy) - MARGIN };
  return { edge, dx: 0, dy: vy + vh - b.y + MARGIN };
}

export function assembly(layout: Layout, routes: Routed[], vb: [number, number, number, number]): Assembly {
  const depth = (p: Placed) => { let d = 0; for (let a = p.parent; a; a = a.parent) d++; return d; };
  const key = (p: Placed) => p.box.x0 + p.box.y0 + p.box.z0 * 0.01;
  // base slabs, then the regions inside them; then nodes back to front
  const regions = layout.items.filter(p => p.type === 'region').sort((a, b) => depth(a) - depth(b) || key(a) - key(b));
  const nodes = layout.items.filter(p => p.type === 'node').sort((a, b) => key(a) - key(b) || a.box.z0 - b.box.z0);
  const pieces: Piece[] = [];
  const rStep = Math.min(90, 400 / Math.max(1, regions.length)), rDur = 650;
  regions.forEach((p, i) => {
    const bbox = polyBounds(silhouette(p.box));
    pieces.push({ id: p.id, kind: 'region', ...offscreen(bbox, vb), delay: Math.round(i * rStep), dur: rDur, bbox });
  });
  const nStart = 250 + Math.round(rStep * regions.length), nStep = Math.min(70, 700 / Math.max(1, nodes.length)), nDur = 600;
  nodes.forEach((p, i) => {
    const bbox = polyBounds(silhouette(p.box));
    pieces.push({ id: p.id, kind: 'node', ...offscreen(bbox, vb), delay: Math.round(nStart + i * nStep), dur: nDur, bbox });
  });
  const lastNode = nodes.length ? nStart + (nodes.length - 1) * nStep : nStart;
  const rtStart = Math.round(lastNode + 300), rtStep = Math.min(30, 300 / Math.max(1, routes.length)), rtDur = 400;
  const rts = routes.filter(r => r.points.length >= 2).map((r, i) => ({ id: r.id, delay: Math.round(rtStart + i * rtStep), dur: rtDur }));
  const labels = { delay: rtStart + 200, dur: 400 };
  const total = Math.max(...pieces.map(p => p.delay + p.dur), ...rts.map(r => r.delay + r.dur), labels.delay + labels.dur);
  return { pieces, routes: rts, labels, total };
}
