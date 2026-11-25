// The one camera (docs/design/MOTION.md, 5): where it looks, how close, and how far round. Pure: no DOM, no clock.
//
// At turn 0 it is the drawing's own projection (kernel's iso), point for point, and a motion document's camera (a view box in the
// drawing's units) is viewOf(camera, stage) there. A turn goes round the upright axis through the plane's origin, so a picture at a turn
// has its own drawing units, and panning never turns anything. What shows of a box, and what is in front of what, is the same all
// through a turn's nearest quarter (an eighth either side): quarterOf says which.

import { C, S, iso, type Box, type P2, type P3 } from './kernel.ts';

export interface Camera {
  /** what it looks at: a point, in grid units (the middle of the stage) */
  at: P3;
  /** px on the stage for each of the drawing's units */
  zoom: number;
  /** how far round, in quarter turns, any number (0.5 is 45°): 0 as drawn; 1 brings the side that was on the left to the front */
  turn: number;
}
export interface Stage { w: number; h: number }
/** a view box, in the drawing's units at the camera's turn: x, y, w, h */
export type ViewBox = [number, number, number, number];

/** a turn's cosine and sine: exact at the quarters, so four of them are nothing */
function trig(turn: number): [number, number] {
  const q = ((turn % 4) + 4) % 4;
  return q === 0 ? [1, 0] : q === 1 ? [0, 1] : q === 2 ? [-1, 0] : q === 3 ? [0, -1] : [Math.cos((q * Math.PI) / 2), Math.sin((q * Math.PI) / 2)];
}
/** a point of the plane, gone round */
export function turned(x: number, y: number, turn: number): P2 {
  const [c, s] = trig(turn);
  return [c * x + s * y + 0, c * y - s * x + 0];
}
/** the projection at a turn: grid units to the drawing's */
export function isoAt(turn: number, x: number, y: number, z = 0): P2 {
  const [a, b] = turned(x, y, turn);
  return iso(a, b, z);
}
/** and back: the point at height z (the floor: 0) that the drawing shows at px, py */
export function planeAt(turn: number, px: number, py: number, z = 0): P2 {
  const d = px / (C * S), m = (py + z * S) / (0.5 * S);
  return turned((m + d) / 2, (m - d) / 2, -turn);
}
/** the nearest whole quarter, 0 to 3 */
export const quarterOf = (turn: number): 0 | 1 | 2 | 3 => (((Math.round(turn) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
/** a box gone round by whole quarters: still square to the grid */
export function turnBox(b: Box, quarter: number): Box {
  const [ax, ay] = turned(b.x0, b.y0, Math.round(quarter)), [bx, by] = turned(b.x1, b.y1, Math.round(quarter));
  return { x0: Math.min(ax, bx), y0: Math.min(ay, by), z0: b.z0, x1: Math.max(ax, bx), y1: Math.max(ay, by), z1: b.z1 };
}
/** what is on the stage */
export function viewOf(c: Camera, stage: Stage): ViewBox {
  const [x, y] = isoAt(c.turn, ...c.at), w = stage.w / c.zoom, h = stage.h / c.zoom;
  return [x - w / 2, y - h / 2, w, h];
}
/** the camera that shows a view box, all of it, in its middle: it looks at the floor there (or at height z) */
export function cameraOf(v: ViewBox, stage: Stage, turn = 0, z = 0): Camera {
  const [x, y] = planeAt(turn, v[0] + v[2] / 2, v[1] + v[3] / 2, z);
  return { at: [x, y, z], zoom: Math.min(stage.w / v[2], stage.h / v[3]), turn };
}
/** the camera that has these boxes on the stage, `margin` px inside it */
export function fitCamera(boxes: readonly Box[], stage: Stage, o: { turn?: number; margin?: number } = {}): Camera | undefined {
  if (!boxes.length) return undefined;
  const turn = o.turn ?? 0, m = o.margin ?? 24;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) {
    const [px, py] = isoAt(turn, x, y, z);
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  const inner = { w: Math.max(1, stage.w - 2 * m), h: Math.max(1, stage.h - 2 * m) };
  return cameraOf([x0, y0, Math.max(1e-6, x1 - x0), Math.max(1e-6, y1 - y0)], inner, turn);
}
/** the stage's point (px from its top left) on the drawing, at height z; and where a point is on the stage */
export function fromStage(c: Camera, stage: Stage, px: number, py: number, z = 0): P2 {
  const v = viewOf(c, stage);
  return planeAt(c.turn, v[0] + px / c.zoom, v[1] + py / c.zoom, z);
}
export function toStage(c: Camera, stage: Stage, p: P3): P2 {
  const v = viewOf(c, stage), [x, y] = isoAt(c.turn, ...p);
  return [(x - v[0]) * c.zoom, (y - v[1]) * c.zoom];
}
/** closer by f, or round by a quarter's part, with what is at that stage point (on the floor) staying under it */
export function zoomAt(c: Camera, stage: Stage, f: number, px = stage.w / 2, py = stage.h / 2): Camera { return keeping(c, stage, { ...c, zoom: c.zoom * f }, px, py); }
export function turnAt(c: Camera, stage: Stage, by: number, px = stage.w / 2, py = stage.h / 2): Camera { return keeping(c, stage, { ...c, turn: c.turn + by }, px, py); }
function keeping(was: Camera, stage: Stage, now: Camera, px: number, py: number): Camera {
  const z = was.at[2], [x, y] = fromStage(was, stage, px, py, z), [x2, y2] = fromStage(now, stage, px, py, z);
  return { ...now, at: [was.at[0] + x - x2, was.at[1] + y - y2, z] };
}
/** moved by px of the stage: the drawing goes that way under it */
export function panBy(c: Camera, dx: number, dy: number): Camera {
  const z = c.at[2], [x, y] = isoAt(c.turn, ...c.at), [ax, ay] = planeAt(c.turn, x - dx / c.zoom, y - dy / c.zoom, z);
  return { ...c, at: [ax, ay, z] };
}
/** the turn nearest to `from` that looks the same as `to`: the short way round */
export const shortTurn = (from: number, to: number): number => to + 4 * Math.round((from - to) / 4);
/** between two cameras: even in log-zoom, and the middle goes with the zoom, as a motion document's camera does; the turn evenly, from a's to b's as they are (shortTurn for the short way) */
export function mixCamera(a: Camera, b: Camera, u: number): Camera {
  if (u <= 0) return a;
  if (u >= 1) return b;
  const zoom = Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * u);
  const wa = 1 / a.zoom, wb = 1 / b.zoom, g = Math.abs(wb - wa) < 1e-9 * wa ? u : (1 / zoom - wa) / (wb - wa);
  return { at: [0, 1, 2].map(i => a.at[i] + (b.at[i] - a.at[i]) * g) as P3, zoom, turn: a.turn + (b.turn - a.turn) * u };
}
