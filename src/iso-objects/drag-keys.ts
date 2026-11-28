// (0.31.0) The owner's drag keys (27 Nov): ⇧ during a drag keeps the move on one of eight lines from where the thing started (the
// grid's two axes, each way, and the four 45° diagonals between them); Ctrl during a drag, half cells; ⌥ at the start of a drag, a
// copy. A module of its own, so what doesn't drag bundles none of it.

/** The eight lines ⇧ keeps a move on, on the grid: x, y and the two diagonals, each way (unit-free directions) */
export const CONSTRAIN_LINES: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [1, 1], [1, -1]];

/** A grid move (dx, dy) from where a thing started, kept on the nearest of the eight lines: its projection on that line, and which
 *  line it is (for the dotted guide). On a diagonal the two parts are equal (or opposite), so snapping each to the grid keeps it there. */
export function constrainMove(d: readonly [number, number]): { d: [number, number]; line: [number, number] } {
  let best: readonly [number, number] = CONSTRAIN_LINES[0]!, bestCos = -1;
  const len = Math.hypot(d[0], d[1]);
  if (len < 1e-9) return { d: [0, 0], line: [1, 0] };
  for (const u of CONSTRAIN_LINES) {
    const c = Math.abs(d[0] * u[0] + d[1] * u[1]) / (len * Math.hypot(u[0], u[1]));
    if (c > bestCos + 1e-9) { bestCos = c; best = u; }
  }
  const t = (d[0] * best[0] + d[1] * best[1]) / (best[0] * best[0] + best[1] * best[1]);
  const z = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);
  return { d: [z(t * best[0]), z(t * best[1])], line: [best[0], best[1]] };
}

/** The step a drag snaps to: half cells while Ctrl is held (it was ⌥ before 0.31.0: ⌥ now starts a copy) */
export const dragStep = (e: { ctrlKey: boolean }): number => (e.ctrlKey ? 0.5 : 1);
