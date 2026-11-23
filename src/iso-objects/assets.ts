// Node kinds as data, and the factories a kind pack builds them with (docs/editor/LAYERS.md §2): what a node kind says
// (its default size and colour role, how it draws itself in a box, where its label and pulse go), the plain box with
// decorations, the plate figures stand on, and the cloud. The kinds themselves are a pack's (src/iso-systems/nodes.ts).

import { type Box, type Kernel, type Mat, type P3, iso, tag, S, C, center } from '../iso-core/kernel.ts';
import * as D from '../iso-core/glyphs.ts';
import type { RawDeco, RawNode } from './types.ts';

export interface LabelSpot {
  /** screen pixels: where the label's first line's baseline sits */
  x: number; y: number;
  anchor: 'start' | 'middle' | 'end';
}

export interface NodeAsset {
  name: string;
  description: string;
  /** default w (x), d (y), h (z) in grid units */
  size: [number, number, number];
  role: string;
  deco?: RawDeco[];
  /** SVG for the inside of the node's <g class="blk k-ROLE">; b is the node's box */
  draw(k: Kernel, b: Box, n: RawNode): string;
  /** where the label goes; default: centred above the top */
  label?(b: Box, n: RawNode, hasSub: boolean): LabelSpot;
  /** [x, y, z, r]: centre and radius (px) of the step pulse ring; default from the footprint */
  pulse?(b: Box): [number, number, number, number];
  /** extra classes for the node group */
  cls?: string;
}

/** an icon a node can wear (deco: icon: NAME), painted on its box */
export type IconPainter = (k: Kernel, b: Box) => string;

/** The icons and screen faces a drawing may name beyond the engine's own (terminal, chat, desktop, tiles): a host
 *  registers its marks once, before it draws (registerMarks). A name nothing has registered draws a neutral
 *  placeholder, and the compile warns (unknownMarks). */
const ICONS: Record<string, IconPainter> = Object.create(null);

const CSS: string[] = [];

/** `css`: the marks' styles; drawingCss() includes them from then on */
export function registerMarks(marks: { icons?: Record<string, IconPainter>; faces?: Record<string, D.FacePainter>; css?: string }): void {
  Object.assign(ICONS, marks.icons ?? {});
  Object.assign(D.screenFaces, marks.faces ?? {});
  if (marks.css && !CSS.includes(marks.css)) CSS.push(marks.css);
}
/** the registered marks' styles */
export const markCss = (): string => CSS.join('');
export const iconPainter = (name: string): IconPainter | undefined => (Object.hasOwn(ICONS, name) ? ICONS[name] : undefined);
export const facePainter = (name: string): D.FacePainter | undefined => (Object.hasOwn(D.screenFaces, name) ? D.screenFaces[name] : undefined);

/** an icon the drawing names but nothing has registered: a dashed square with a question mark on the top face */
export function placeholderIcon(k: Kernel, b: Box): string {
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, z = b.z1 + 0.005, r = Math.min(0.6, (b.x1 - b.x0) * 0.24, (b.y1 - b.y0) * 0.24);
  const q: P3[] = [[cx - r, cy - r, z], [cx + r, cy - r, z], [cx + r, cy + r, z], [cx - r, cy + r, z]];
  return k.poly(q, 'ico-unknown') + k.line3([cx - r * 0.3, cy - r * 0.35, z], [cx + r * 0.3, cy - r * 0.35, z], 'ico-unknown-q')
    + k.line3([cx + r * 0.3, cy - r * 0.35, z], [cx, cy + r * 0.1, z], 'ico-unknown-q') + k.line3([cx, cy + r * 0.45, z], [cx, cy + r * 0.5, z], 'ico-unknown-q');
}

export function drawDecos(k: Kernel, b: Box, decos: RawDeco[] | undefined): string {
  let s = '';
  for (const d of decos ?? []) {
    if (d === 'terminal') s += D.termLines(k, b, 3);
    else if (d === 'envelope') s += D.envelope(k, b);
    else if (d === 'bubble') s += D.bubble(k, b);
    else if (d === 'file-lines') s += D.fileLines(k, b);
    else if (typeof d === 'object') {
      if (d.terminal) s += D.termLines(k, b, d.terminal);
      if (d.icon) s += (iconPainter(d.icon) ?? placeholderIcon)(k, b);
    }
  }
  return s;
}

const decosOf = (n: RawNode, a: NodeAsset) => (n.deco ?? a.deco ?? []).filter(d => d !== 'ghost');

/** A plain box, with decorations: the workhorse. */
export function boxAsset(name: string, description: string, size: [number, number, number], role: string, deco?: RawDeco[], extra?: (k: Kernel, b: Box) => string): NodeAsset {
  const a: NodeAsset = {
    name, description, size, role, deco,
    draw: (k, b, n) => k.blockFaces(b) + drawDecos(k, b, decosOf(n, a)) + (extra ? extra(k, b) : ''),
  };
  return a;
}

/** The plate figures stand on: 1.5 × 1.5, 0.18 high, centred in the box. */
export function plate(b: Box): Box {
  const [cx, cy] = center(b);
  return { x0: cx - 0.75, y0: cy - 0.75, x1: cx + 0.75, y1: cy + 0.75, z0: b.z0, z1: b.z0 + 0.18 };
}

/** A puffy cloud outline in a face's 2D plane (w × h px), drawn clockwise with outward bumps. */
export function cloudPath(w: number, h: number): string {
  const r = Math.max(8, Math.min(w, h) * 0.18), ins = r * 0.55;
  const x0 = ins, y0 = ins, x1 = w - ins, y1 = h - ins;
  const edge = (ax: number, ay: number, bx: number, by: number) => {
    const len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(len / (r * 1.7)));
    let d = '';
    for (let i = 1; i <= n; i++) {
      const x = ax + (bx - ax) * i / n, y = ay + (by - ay) * i / n, rr = (len / n) / 2 * 1.08;
      d += ` A${rr.toFixed(1)},${rr.toFixed(1)} 0 0 1 ${x.toFixed(1)},${y.toFixed(1)}`;
    }
    return d;
  };
  return `M${x0.toFixed(1)},${y0.toFixed(1)}` + edge(x0, y0, x1, y0) + edge(x1, y0, x1, y1) + edge(x1, y1, x0, y1) + edge(x0, y1, x0, y0) + 'Z';
}

/** A cloud lying on the floor with a little thickness: the side is the outline dropped by the height. */
export function drawCloud(k: Kernel, b: Box): string {
  const top = { ...b, z0: b.z1 };
  const f = (z: number) => { const [X, Y] = iso(b.x0, b.y0, z); return [C, 0.5, -C, 0.5, X, Y] as Mat; };
  const w = (b.x1 - b.x0) * S, h = (b.y1 - b.y0) * S, d = cloudPath(w, h);
  void top;
  return k.onMatrix(f(b.z0), w, h, () => tag('path', { d, class: 'lft cloud-side' }))
    + k.onMatrix(f(b.z1), w, h, () => tag('path', { d, class: 'top cloud-top' }));
}

export function defaultLabel(b: Box, hasSub: boolean): LabelSpot {
  const [X, Y] = iso((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z1 + 0.75);
  return { x: X, y: Y - 18 + (hasSub ? 0 : 6), anchor: 'middle' };
}
