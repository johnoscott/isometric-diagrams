// Decorations painted on a block's faces, from the reference pages: terminal lines, icons, envelope,
// chat bubble, file lines, and the faces shown on upright screens.

import { type Box, type Kernel, type P3, iso, pt, tag, n1 } from './kernel.ts';

/** "terminal lines" on the +y (front-left) face */
export function termLines(k: Kernel, b: Box, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) {
    const z = b.z1 - (b.z1 - b.z0) * (0.28 + i * 0.2);
    const len = (b.x1 - b.x0) * (i === n - 1 ? 0.35 : 0.62 - i * 0.1);
    s += k.line3([b.x0 + 0.35, b.y1, z], [b.x0 + 0.35 + len, b.y1, z], 'det');
  }
  return s;
}

/** Envelope on the top face (a mailbox, an inbox). */
export function envelope(k: Kernel, b: Box): string {
  const m = 0.55, z = b.z1;
  const a: P3 = [b.x0 + m, b.y0 + m, z], bb: P3 = [b.x1 - m, b.y0 + m, z], c: P3 = [b.x1 - m, b.y1 - m, z], d: P3 = [b.x0 + m, b.y1 - m, z];
  const mid: P3 = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, z];
  return k.poly([a, bb, c, d], 'det') + k.line3(a, mid, 'det') + k.line3(mid, bb, 'det');
}

/** Chat bubble on the top face: a frame with two lines of text (chat servers). */
export function bubble(k: Kernel, b: Box): string {
  const m = 0.55, z = b.z1;
  let s = k.poly([[b.x0 + m, b.y0 + m, z], [b.x1 - m, b.y0 + m, z], [b.x1 - m, b.y1 - m, z], [b.x0 + m, b.y1 - m, z]], 'det');
  for (let i = 1; i <= 2; i++) {
    const y = b.y0 + m + (b.y1 - b.y0 - 2 * m) * i / 3;
    s += k.line3([b.x0 + m + 0.3, y, z], [b.x1 - m - 0.3 - (i === 2 ? 0.5 : 0), y, z], 'det');
  }
  return s;
}

/** Two lines of text on the top face (files, records). */
export function fileLines(k: Kernel, b: Box): string {
  const m = 0.3, z = b.z1, ym = (b.y0 + b.y1) / 2;
  return k.line3([b.x0 + m, ym - 0.2, z], [b.x1 - m, ym - 0.2, z], 'det') + k.line3([b.x0 + m, ym + 0.2, z], [b.x1 - m - 0.3, ym + 0.2, z], 'det');
}

/** A key glyph on the top face: a bow and a bit. */
export function keyGlyph(k: Kernel, b: Box): string {
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, z = b.z1 + 0.005, r = Math.min(b.x1 - b.x0, b.y1 - b.y0) * 0.16;
  const ring: P3[] = [];
  for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; ring.push([cx - r * 1.4 + Math.cos(a) * r, cy + Math.sin(a) * r, z]); }
  return k.poly(ring, 'det') + k.line3([cx - r * 0.4, cy, z], [cx + r * 2.2, cy, z], 'det') + k.line3([cx + r * 1.7, cy, z], [cx + r * 1.7, cy + r * 0.8, z], 'det');
}

/** A socket: a round opening on the top face. */
export function socketGlyph(k: Kernel, b: Box): string {
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, z = b.z1 + 0.005, r = Math.min(b.x1 - b.x0, b.y1 - b.y0) * 0.28;
  const ring: P3[] = [];
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; ring.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]); }
  return k.poly(ring, 'det sock-hole');
}

// ---- screen faces: drawn in a screen's own 2D pixel plane (w across, h down) ----

const rect = (cls: string, x: number, y: number, w: number, h: number, rx = 0) => tag('rect', { class: cls, x, y, width: w, height: h, rx: rx || undefined });

/** what a screen shows, drawn in its own 2D plane; a host adds its own by name (iso-objects' registerMarks) */
export type FacePainter = (w: number, h: number) => string;

export const screenFaces: Record<string, FacePainter> = {
  terminal(w, h) {
    let s = '';
    const rows = Math.max(2, Math.floor((h - 12) / 9));
    for (let i = 0; i < rows; i++) {
      const y = 10 + i * 9, len = (w - 18) * [0.7, 0.45, 0.6, 0.3, 0.55][i % 5];
      s += tag('line', { class: 'ln', x1: 8, y1: y, x2: 8 + len, y2: y });
    }
    return s;
  },
  chat(w, h) {
    const rows: [number, number, string][] = [[6, 0.62, 'w'], [0.30, 0.58, 'm'], [6, 0.46, 'w'], [0.42, 0.5, 'm']];
    return rows.map((r, i) => {
      const bw = (w - 14) * r[1], x = r[0] === 6 ? 7 : w - 7 - bw;
      return rect(r[2], x, 8 + i * (h - 18) / 4, bw, (h - 18) / 4 - 4, 3);
    }).join('');
  },
  desktop(w, h) {
    return rect('wall', 5, 5, w - 10, h - 10, 2) + rect('bar', 5, 5, w - 10, 6) + rect('win', w * 0.5, 13, w * 0.38, h * 0.42, 2);
  },
  /** a tiled grid of terminals: a dashboard of sessions */
  tiles(w, h) {
    const m = 6, gap = 2.5, cols = 3, rows = 2, tw = (w - 2 * m - gap * (cols - 1)) / cols, th = (h - 2 * m - gap * (rows - 1)) / rows;
    let s = '';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = m + c * (tw + gap), y = m + r * (th + gap);
      s += rect('t', x, y, tw, th, 1.5);
      [0.3, 0.52, 0.74].forEach((k, i) => { s += tag('line', { class: 'ln', x1: x + 2.5, y1: y + th * k, x2: x + 2.5 + (tw - 5) * [0.8, 0.5, 0.65][(i + r + c) % 3], y2: y + th * k }); });
    }
    return s;
  },
};

/** a face the drawing names but nothing has registered: a dashed frame with a question mark, so the gap shows */
export function placeholderFace(w: number, h: number): string {
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.22;
  return rect('unk', w * 0.2, h * 0.2, w * 0.6, h * 0.6, 2)
    + tag('path', { class: 'unk-q', d: `M${n1(cx - r * 0.5)},${n1(cy - r * 0.45)}a${n1(r * 0.5)},${n1(r * 0.5)} 0 1 1 ${n1(r * 0.5)},${n1(r * 0.55)}v${n1(r * 0.3)}` })
    + tag('circle', { class: 'unk-dot', cx: n1(cx), cy: n1(cy + r * 0.75), r: n1(Math.max(0.8, r * 0.1)) });
}

export function screenGlass(w: number, h: number): string {
  return rect('glass', 3, 3, w - 6, h - 6, 3);
}
