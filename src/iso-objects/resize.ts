// (0.28.0, 0.29.0) Resizing a group and growing it on its left and back sides: the arithmetic, apart from geometry.ts so that a bundle
// that neither drags nor resizes (a live page) carries none of it (a shared chunk takes a whole module).

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

/** (0.29.0) how a group grows on its left or back side, when it does (canvas.ts GROW_SIDES): its other contents' pins move the other
 *  way, so nothing but the dragged thing and the edge moves on screen ('pins'); or they keep theirs, so the whole group moves with
 *  the edge ('shift'). The owner's question 2. */
export type GrowLeftBack = 'pins' | 'shift';
/** (0.29.0) A thing dropped past a group's left or back margin `lo` (at: in the group's frame, less than lo), on the grid `step`: the
 *  pins that make the group grow that way. The thing comes in by s (to the margin), the group moves by -s in its parent's frame (its
 *  pin, `group.at`: where it stands now), and with 'pins' every other thing in it that can be pinned moves by +s. Undefined: not past
 *  the margin, or the group can't be pinned (then the side is held). */
export function growLeftBack(o: { name: string; at: [number, number]; lo: number; step: number; group?: { name: string; at: [number, number] };
  others: { name: string; at: [number, number] }[]; mode: GrowLeftBack }): { pins: [string, [number, number]][]; shift: [number, number] } | undefined {
  const by = (v: number) => (v < o.lo - 1e-9 ? Math.ceil((o.lo - v) / o.step - 1e-9) * o.step : 0);
  const s: [number, number] = [by(o.at[0]), by(o.at[1])];
  if (!o.group || (!s[0] && !s[1])) return undefined;
  const r = (v: number) => Math.round(v * 1000) / 1000, add = (a: [number, number], k: number): [number, number] => [r(a[0] + k * s[0]), r(a[1] + k * s[1])];
  return { pins: [[o.name, add(o.at, 1)], [o.group.name, add(o.group.at, -1)], ...(o.mode === 'pins' ? o.others.map(x => [x.name, add(x.at, 1)] as [string, [number, number]]) : [])], shift: s };
}

/** (0.29.0) the sides a resize handle moves (its corner, two; the middle of a side, one) */
export interface ResizeSides { left?: boolean; right?: boolean; back?: boolean; front?: boolean }
/** (0.29.0) A drag of (dx, dy) on a handle that moves `sides`: the new floor, snapped, never below `min` (`held`), and `shift`: how far
 *  the group's corner moves for a left or back side (positive: it grew that way), so that the opposite edge stays where it is on
 *  screen; the group's own pin moves by -shift and what it holds by +shift. */
export function resizeSides(size0: [number, number], d: [number, number], sides: ResizeSides, step: number, min: [number, number]): { size: [number, number]; held: boolean; shift: [number, number] } {
  const snap = (v: number) => Math.round(v / step) * step, r = (v: number) => Math.round(v * 1000) / 1000;
  let w = sides.right ? snap(size0[0] + d[0]) : sides.left ? snap(size0[0] - d[0]) : size0[0];
  let dd = sides.front ? snap(size0[1] + d[1]) : sides.back ? snap(size0[1] - d[1]) : size0[1];
  let held = false;
  if (w < min[0]) { w = min[0]; held = !!(sides.left || sides.right); }
  if (dd < min[1]) { dd = min[1]; held ||= !!(sides.back || sides.front); }
  return { size: [r(w), r(dd)], held, shift: [r(sides.left ? w - size0[0] : 0), r(sides.back ? dd - size0[1] : 0)] };
}
/** (0.29.0) The smallest floor for a resize that keeps `anchor` sides still (a left handle keeps the right edge: what it holds is
 *  measured from there). Boxes in one frame. */
export function minSizeFrom(box: { x0: number; y0: number; x1: number; y1: number }, children: { x0: number; y0: number; x1: number; y1: number }[], pad: number, sides: ResizeSides, step = 1): [number, number] {
  const up = (v: number) => Math.ceil(v / step - 1e-9) * step, base = pad * 2 + 0.5;
  const w = Math.max(base, ...children.map(c => (sides.left ? box.x1 - c.x0 : c.x1 - box.x0) + pad)), d = Math.max(base, ...children.map(c => (sides.back ? box.y1 - c.y0 : c.y1 - box.y0) + pad));
  return [up(w), up(d)];
}
