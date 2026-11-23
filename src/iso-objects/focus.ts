// The view a step's focus asks for: its screen box grown to the drawing's proportions, kept inside the drawing.
// Shared by the player (which eases to it) and the proof sheet (which draws it).

export function focusView(full: number[], box: [number, number, number, number] | undefined): number[] {
  if (!box) return full;
  const [x0, y0, x1, y1] = box, ar = full[2] / full[3];
  let w = x1 - x0, h = y1 - y0;
  if (w / h < ar) w = h * ar; else h = w / ar;
  w = Math.min(w, full[2]); h = Math.min(h, full[3]);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const x = Math.max(full[0], Math.min(full[0] + full[2] - w, cx - w / 2));
  const y = Math.max(full[1], Math.min(full[1] + full[3] - h, cy - h / 2));
  return [x, y, w, h];
}
