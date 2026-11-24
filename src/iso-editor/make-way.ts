// Making way for a dragged thing: which of the things beside it would step aside, and where to. Pure arithmetic on boxes in the
// container's own grid; the canvas says when (its dwell) and draws it (ui/drag-way.ts).
//   - Only what the dragged thing's cells overlap, and what those then overlap, moves: at most MAX_CHAIN things, all the same way.
//   - The fewest whole cells; among equals, the way the dragged thing was going; never back towards where it came from.
//   - Clear of everything else and of the dragged thing, inside the container's margin. If there is no such place, undefined.

/** a drop that overlaps waits this long on one cell before anything shows (ms) */
export const DWELL_HINT = 150;
/** and this long, from the same start, before the things in its way give way (ms) */
export const DWELL_GIVE = 700;
/** what gave way goes back this long after the dragged thing no longer needs the place (ms) */
export const BACK_AFTER = 250;
/** a thing's glide to its place, or back (ms) */
export const GLIDE = 180;
/** the jiggle: how far (screen px), and how often (a second) */
export const JIGGLE = { px: 1.5, hz: 8 };
/** the most things that may step aside for one drop */
export const MAX_CHAIN = 3;

export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface Beside extends Rect {
  id: string;
  /** whether it may be pinned somewhere else */
  movable: boolean;
}
export interface WayOptions {
  /** where the dragged thing would be */
  foot: Rect;
  /** everything else in the container */
  others: Beside[];
  /** the way it was going: its last step, or from where it started */
  going: [number, number];
  /** what a thing that steps aside must stay in (the container, less its margin); none: anywhere */
  bounds?: Rect;
  max?: number;
}

const E = 1e-6;
export const hits = (a: Rect, b: Rect) => a.x0 < b.x1 - E && a.x1 > b.x0 + E && a.y0 < b.y1 - E && a.y1 > b.y0 + E;
const at = (b: Rect, [dx, dy]: [number, number]): Rect => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });

/** The steps (whole cells) of what would move, by id; undefined: nothing can make way. */
export function makeWay({ foot, others, going, bounds, max = MAX_CHAIN }: WayOptions): Map<string, [number, number]> | undefined {
  const first = others.filter(o => hits(o, foot));
  if (!first.length) return new Map();
  if (first.some(o => !o.movable)) return undefined;
  const ways: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let best: { steps: Map<string, [number, number]>; cells: number; along: number } | undefined;
  for (const w of ways) {
    const along = w[0] * going[0] + w[1] * going[1];
    // back to where it came from: against its larger component
    if (along < 0 && Math.abs(along) >= Math.max(Math.abs(going[0]), Math.abs(going[1])) - E) continue;
    const steps = push(foot, others, w, bounds, max);
    if (!steps) continue;
    const cells = [...steps.values()].reduce((n, [dx, dy]) => n + Math.abs(dx) + Math.abs(dy), 0);
    if (!best || cells < best.cells || (cells === best.cells && along > best.along + E)) best = { steps, cells, along };
  }
  return best?.steps;
}
/** all that is in the way, pushed one way by whole cells until each is clear of what pushes it */
function push(foot: Rect, others: Beside[], w: [number, number], bounds: Rect | undefined, max: number): Map<string, [number, number]> | undefined {
  const far = new Map<string, number>();          // cells, by id
  const byId = new Map<string, Beside>(others.map(o => [o.id, o]));
  const boxOf = (o: Beside) => at(o, [w[0] * (far.get(o.id) ?? 0), w[1] * (far.get(o.id) ?? 0)]);
  // what pushes: the dragged thing first, then each that moved (again, if it moved again)
  const queue: (string | undefined)[] = [undefined];
  for (let guard = 0; queue.length; guard++) {
    if (guard > 100) return undefined;
    const id = queue.shift(), by = id === undefined ? foot : boxOf(byId.get(id)!);
    for (const o of others) {
      if (o.id === id) continue;
      const b = boxOf(o);
      if (!hits(b, by)) continue;
      if (!o.movable) return undefined;
      const gap = w[0] > 0 ? by.x1 - b.x0 : w[0] < 0 ? b.x1 - by.x0 : w[1] > 0 ? by.y1 - b.y0 : b.y1 - by.y0;
      far.set(o.id, (far.get(o.id) ?? 0) + Math.max(1, Math.ceil(gap - E)));
      if (far.size > max) return undefined;
      if (!queue.includes(o.id)) queue.push(o.id);
    }
  }
  const steps = new Map([...far].map(([id, n]) => [id, [w[0] * n, w[1] * n] as [number, number]]));
  // clear of everything, the dragged thing too, and inside
  for (const id of steps.keys()) {
    const o = byId.get(id)!, b = boxOf(o);
    if (hits(b, foot) || others.some(q => q.id !== id && hits(b, boxOf(q)))) return undefined;
    if (bounds && (b.x0 < bounds.x0 - E || b.y0 < bounds.y0 - E || b.x1 > bounds.x1 + E || b.y1 > bounds.y1 + E)) return undefined;
  }
  return steps;
}
