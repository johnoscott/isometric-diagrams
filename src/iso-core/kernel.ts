// The drawing kernel, generalised from the reference pages: the isometric projection, block faces,
// 2D painting on any face, text on the floor or a face, and an SVG string builder that tracks bounds.

import metrics from './metrics.json' with { type: 'json' };

/** pixels per grid unit, as in the references */
export const S = 34;
export const C = Math.cos(Math.PI / 6);

export type P2 = [number, number];
export type P3 = [number, number, number];
export interface Box { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }

export const iso = (x: number, y: number, z = 0): P2 => [(x - y) * C * S, (x + y) * 0.5 * S - z * S];
export const n1 = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? '0' : String(r);
};
export const pt = (p: P2) => `${n1(p[0])},${n1(p[1])}`;

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type Attrs = Record<string, string | number | undefined | null | false>;
export function tag(name: string, attrs: Attrs = {}, inner?: string): string {
  let a = '';
  for (const k in attrs) {
    const v = attrs[k];
    if (v === undefined || v === null || v === false || v === '') continue;
    a += ` ${k}="${esc(typeof v === 'number' ? n1(v) : v)}"`;
  }
  return inner === undefined ? `<${name}${a}/>` : `<${name}${a}>${inner}</${name}>`;
}

// ---- text metrics ----

export type FontKey = keyof typeof metrics;
export interface Font { key: FontKey; size: number; spacing?: number /* em */ }

/** the fonts of the reference CSS classes; metrics are measured at these exact sizes (scripts/measure-fonts.mjs) */
export const FONTS = {
  lbl: { key: 'sans700_13', size: 13 },
  sub: { key: 'mono400_11', size: 11 },
  slabname: { key: 'sans800_15', size: 15, spacing: 0.12 },
  sm: { key: 'sans800_10_5', size: 10.5, spacing: 0.1 },
  floor: { key: 'mono600_11', size: 11, spacing: 0.01 },
  say: { key: 'sans600_12', size: 12 },
  tunname: { key: 'sans800_12', size: 12, spacing: 0.14 },
  badge: { key: 'sans800_11_5', size: 11.5 },
} satisfies Record<string, Font>;

export function textWidth(str: string, f: Font): number {
  const table = metrics[f.key] as Record<string, number>;
  const avg = f.key.startsWith('mono') ? 0.6 : 0.58;
  let w = 0;
  for (const ch of str) w += table[ch] ?? avg;
  return (w + (f.spacing ?? 0) * [...str].length) * f.size;
}

// ---- 2D affine maps for painting on faces ----

/** [a b c d e f] as in SVG matrix(): x' = a x + c y + e, y' = b x + d y + f */
export type Mat = [number, number, number, number, number, number];
export const apply = (m: Mat, x: number, y: number): P2 => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const matStr = (m: Mat) => `matrix(${m.map(v => (Math.round(v * 10000) / 10000)).join(' ')})`;

export type Face = 'top' | 'left' | 'right';
/**
 * A face's own 2D plane, in pixels: u to the right, v down, origin at the face's top-left corner as seen.
 * left = the +y face (front-left), right = the +x face (front-right), top = the z1 face (u along +x, v along +y).
 */
export function faceFrame(b: Box, face: Face): { m: Mat; w: number; h: number } {
  if (face === 'left') { const [X, Y] = iso(b.x0, b.y1, b.z1); return { m: [C, 0.5, 0, 1, X, Y], w: (b.x1 - b.x0) * S, h: (b.z1 - b.z0) * S }; }
  if (face === 'right') { const [X, Y] = iso(b.x1, b.y1, b.z1); return { m: [C, -0.5, 0, 1, X, Y], w: (b.y1 - b.y0) * S, h: (b.z1 - b.z0) * S }; }
  const [X, Y] = iso(b.x0, b.y0, b.z1);
  return { m: [C, 0.5, -C, 0.5, X, Y], w: (b.x1 - b.x0) * S, h: (b.y1 - b.y0) * S };
}

// ---- the canvas: SVG strings plus the bounds of everything drawn ----

export class Bounds {
  x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity;
  add(p: P2) { if (p[0] < this.x0) this.x0 = p[0]; if (p[0] > this.x1) this.x1 = p[0]; if (p[1] < this.y0) this.y0 = p[1]; if (p[1] > this.y1) this.y1 = p[1]; }
  addRect(x: number, y: number, w: number, h: number) { this.add([x, y]); this.add([x + w, y + h]); }
  get empty() { return this.x0 === Infinity; }
}

export interface TextRect { x: number; y: number; w: number; h: number; text: string; owner?: string }

/** One per scene: collects bounds (and text rectangles for layout checks) while assets draw. */
export class Kernel {
  bounds = new Bounds();
  texts: TextRect[] = [];
  /** screen bounds of text drawn in a skewed plane (floor, faces), for label placement */
  planes: { x: number; y: number; w: number; h: number }[] = [];
  /** the same, as the actual parallelograms */
  planePolys: P2[][] = [];
  defs = new Map<string, string>();

  poly(pts: P3[], cls?: string, extra: Attrs = {}): string {
    const p = pts.map(q => iso(q[0], q[1], q[2]));
    p.forEach(q => this.bounds.add(q));
    return tag('polygon', { points: p.map(pt).join(' '), class: cls, ...extra });
  }
  line3(a: P3, b: P3, cls?: string, extra: Attrs = {}): string {
    const p = iso(...a), q = iso(...b);
    this.bounds.add(p); this.bounds.add(q);
    return tag('line', { x1: p[0], y1: p[1], x2: q[0], y2: q[1], class: cls, ...extra });
  }
  /** The three visible faces of a box, as in the references: lft (+y), rgt (+x), top. */
  blockFaces(b: Box): string {
    const { x0, y0, x1, y1, z0, z1 } = b;
    return this.poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], 'lft')
      + this.poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], 'rgt')
      + this.poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 'top');
  }
  /** A group in a face's own 2D pixel plane. `draw` gets the face width and height. */
  onFace(b: Box, face: Face, draw: (w: number, h: number) => string, cls?: string): string {
    const f = faceFrame(b, face);
    for (const [u, v] of [[0, 0], [f.w, 0], [0, f.h], [f.w, f.h]]) this.bounds.add(apply(f.m, u, v));
    return tag('g', { class: cls, transform: matStr(f.m) }, draw(f.w, f.h));
  }
  /** Same, with an explicit matrix (screens at an angle). */
  onMatrix(m: Mat, w: number, h: number, draw: (w: number, h: number) => string, cls?: string): string {
    for (const [u, v] of [[0, 0], [w, 0], [0, h], [w, h]]) this.bounds.add(apply(m, u, v));
    return tag('g', { class: cls, transform: matStr(m) }, draw(w, h));
  }
  /** Upright text, e.g. labels. (x, y) in screen pixels; y is the baseline. */
  text(x: number, y: number, str: string, cls: string, font: Font, anchor: 'start' | 'middle' | 'end' = 'middle', extra: Attrs = {}, owner?: string): string {
    const w = textWidth(str, font);
    const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
    const r = { x: left, y: y - font.size * 0.8, w, h: font.size * 1.05, text: str, owner };
    // the halo stroke (4px) also paints
    this.bounds.addRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
    this.texts.push(r);
    return tag('text', { x, y, class: cls, 'text-anchor': anchor === 'start' ? undefined : anchor, ...extra }, esc(str));
  }
  /** Text in a skewed plane (floor or face), with bounds through the matrix. */
  planeText(m: Mat, str: string, cls: string, font: Font, anchor: 'start' | 'middle' | 'end' = 'start', extra: Attrs = {}): string {
    const w = textWidth(str, font);
    const left = anchor === 'start' ? 0 : anchor === 'end' ? -w : -w / 2;
    const c = [[left, -font.size * 0.8], [left + w, -font.size * 0.8], [left, font.size * 0.25], [left + w, font.size * 0.25]].map(([u, v]) => apply(m, u, v));
    c.forEach(p => this.bounds.add(p));
    const xs = c.map(p => p[0]), ys = c.map(p => p[1]);
    this.planePolys.push([c[0], c[1], c[3], c[2]]);
    this.planes.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    return tag('text', { transform: matStr(m), class: cls, 'text-anchor': anchor === 'start' ? undefined : anchor, ...extra }, esc(str));
  }
  /** Text lying on the floor at height z: dir 'x' runs along +x, 'y' runs along −y (as in floorText()). */
  floorText(x: number, y: number, z: number, str: string, cls: string, dir: 'x' | 'y' = 'x', anchor: 'start' | 'middle' | 'end' = 'start', extra: Attrs = {}): string {
    const [X, Y] = iso(x, y, z);
    const m: Mat = dir === 'x' ? [C, 0.5, -C, 0.5, X, Y] : [C, -0.5, C, 0.5, X, Y];
    return this.planeText(m, str, cls, FONTS.floor, anchor, extra);
  }
  /** Text standing on a +y face (left) or a +x face (right) at a point. */
  faceText(x: number, y: number, z: number, str: string, cls: string, font: Font, face: 'left' | 'right' = 'left', anchor: 'start' | 'middle' | 'end' = 'start', extra: Attrs = {}): string {
    const [X, Y] = iso(x, y, z);
    const m: Mat = face === 'left' ? [C, 0.5, 0, 1, X, Y] : [C, -0.5, 0, 1, X, Y];
    return this.planeText(m, str, cls, font, anchor, extra);
  }
  def(id: string, svg: string) { this.defs.set(id, svg); }
}

export const center = (b: Box): P3 => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z1];
