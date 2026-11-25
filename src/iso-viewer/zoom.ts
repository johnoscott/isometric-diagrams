// A reader's own zoom and pan on a drawing (docs/design/MOTION.md, 5): how close and where, on top of whatever view the drawing has (its
// frame, or its document's camera, which may move meanwhile). The arithmetic is the one camera's (iso-core/camera.ts), at turn 0. Pure.

import { cameraOf, panBy, viewOf, zoomAt, type Camera, type Stage, type ViewBox } from '../iso-core/camera.ts';

/** times: 1 (fitted) to MAX_TIMES. dx, dy: the middle's offset from the view's own middle, in parts of the view's width and height */
export interface Reader { times: number; dx: number; dy: number }
export const FITTED: Reader = { times: 1, dx: 0, dy: 0 };
export const MAX_TIMES = 8;

const middle = (base: ViewBox, r: Reader): [number, number] => [base[0] + base[2] / 2 + r.dx * base[2], base[1] + base[3] / 2 + r.dy * base[3]];
/** the camera it is */
function cam(base: ViewBox, stage: Stage, r: Reader): Camera {
  const fit = cameraOf(base, stage), [x, y] = middle(base, r), w = stage.w / (fit.zoom * r.times), h = stage.h / (fit.zoom * r.times);
  return cameraOf([x - w / 2, y - h / 2, w, h], stage);
}
/** a camera, as a reader's: no smaller than fitted, and never off the drawing */
function reader(base: ViewBox, stage: Stage, c: Camera): Reader {
  const fit = cameraOf(base, stage).zoom, asked = c.zoom / fit, times = asked > MAX_TIMES - 1e-6 ? MAX_TIMES : Math.max(1, asked), v = viewOf(c, stage);
  if (times <= 1 + 1e-9) return FITTED;
  const along = (len: number, shown: number, off: number) => { const slack = Math.max(0, (len - shown) / 2); return Math.max(-slack, Math.min(slack, off)) / len; };
  const k = fit * times;
  return { times, dx: along(base[2], stage.w / k, v[0] + v[2] / 2 - base[0] - base[2] / 2) + 0, dy: along(base[3], stage.h / k, v[1] + v[3] / 2 - base[1] - base[3] / 2) + 0 };
}
/** what shows: the base itself when fitted */
export function readerView(base: ViewBox, stage: Stage, r: Reader): ViewBox { return r.times <= 1 ? base : viewOf(cam(base, stage, r), stage); }
/** closer by f about a point of the stage (px from its top left) */
export function readerZoom(base: ViewBox, stage: Stage, r: Reader, f: number, px = stage.w / 2, py = stage.h / 2): Reader {
  const to = Math.max(1, Math.min(MAX_TIMES, r.times * f));
  return reader(base, stage, zoomAt(cam(base, stage, r), stage, to / r.times, px, py));
}
/** the drawing moved by px of the stage */
export function readerPan(base: ViewBox, stage: Stage, r: Reader, dx: number, dy: number): Reader { return r.times <= 1 ? FITTED : reader(base, stage, panBy(cam(base, stage, r), dx, dy)); }
/** where it is on another stage, or under another view: kept, and still on the drawing */
export function readerOn(base: ViewBox, stage: Stage, r: Reader): Reader { return r.times <= 1 ? FITTED : reader(base, stage, cam(base, stage, r)); }
