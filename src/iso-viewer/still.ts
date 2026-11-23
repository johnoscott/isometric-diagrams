// A still render's machinery (docs/editor/LAYERS.md §2): a drawing (the renderer's SVG, parsed) and its overlay,
// fitted to a size and written as one SVG with every id prefixed, so many can share a page. No DOM: the overlay is
// drawn into the virtual document (src/iso-core/vdom.ts) and measured from what it drew. The domain's entry reads its
// file, says what the overlay draws, and assembles the SVG with its own classes and stylesheet.

import type { SvgNode } from '../iso-core/svg-dom.ts';
import type { VNode } from '../iso-core/vdom.ts';

import type { Box } from './overlay.ts';
export type { Box };

export const n = (v: number) => String(Math.round(v * 100) / 100);
export const node = (name: string, attrs: Record<string, string | number> = {}, ...children: (VNode | string)[]): VNode =>
  ({ name, attrs: Object.entries(attrs).map(([k, v]) => [k, typeof v === 'number' ? n(v) : v]), children });

/** "var(--x)" → "var(--iso-x)" (the drawing's tokens, as the stylesheet names them); "#id" → the prefixed id */
export function rewrite(t: SvgNode | VNode | string, pfx: string): VNode | string {
  if (typeof t === 'string') return t;
  const attrs = t.attrs.map(([k, v]) => {
    if (k === 'id') return [k, pfx + v] as [string, string];
    let w = v.replace(/var\(--([a-zA-Z][\w-]*)/g, 'var(--iso-$1').replace(/url\(\s*(['"]?)#/g, (_m, q: string) => `url(${q}#${pfx}`);
    if ((k === 'href' || k === 'xlink:href') && w.startsWith('#') && !w.startsWith(`#${pfx}`)) w = `#${pfx}${w.slice(1)}`;
    return [k, w] as [string, string];
  });
  return { name: t.name, attrs, children: t.children.map(c => rewrite(c, pfx)) };
}

/** keep a node? (for thumbs: no text, no titles, no small things, no badges) */
export function prune(t: VNode | string, drop: (n: VNode) => boolean): VNode | string | undefined {
  if (typeof t === 'string') return t;
  if (drop(t)) return undefined;
  return { ...t, children: t.children.map(c => prune(c, drop)).filter((c): c is VNode | string => c !== undefined) };
}

export const cls = (t: VNode) => (t.attrs.find(a => a[0] === 'class')?.[1] ?? '').split(/\s+/);
export const attr = (t: VNode, k: string) => t.attrs.find(a => a[0] === k)?.[1];

/** every point a tree draws (polygon points, rects, circles), for the overlay's extent */
export function extent(ts: (VNode | string)[]): Box | undefined {
  const xs: number[] = [], ys: number[] = [];
  const walk = (t: VNode | string) => {
    if (typeof t === 'string') return;
    const tr = attr(t, 'transform');
    if (tr && /matrix/.test(tr)) return;   // a card's face text: inside its card
    const pts = attr(t, 'points');
    if (pts) for (const p of pts.trim().split(/\s+/)) { const [x, y] = p.split(',').map(Number); if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); } }
    if (t.name === 'rect') { const x = Number(attr(t, 'x')), y = Number(attr(t, 'y')), w = Number(attr(t, 'width')), h = Number(attr(t, 'height')); if ([x, y, w, h].every(Number.isFinite)) { xs.push(x, x + w); ys.push(y, y + h); } }
    if (t.name === 'circle') { const x = Number(attr(t, 'cx')), y = Number(attr(t, 'cy')), r = Number(attr(t, 'r')); if ([x, y, r].every(Number.isFinite)) { xs.push(x - r, x + r); ys.push(y - r, y + r); } }
    t.children.forEach(walk);
  };
  ts.forEach(walk);
  if (!xs.length) return undefined;
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}
export const unite = (a: Box, b?: Box): Box => {
  if (!b) return a;
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
};

/** The scale that fits the drawing and its overlay. The overlay's badges keep their size in px, so it is drawn at a
 *  scale, measured, and drawn again at the scale that holds both (twice: the scale it ends at is the one it is drawn at). */
export function fitWithOverlay(drawn: Box, size: { width: number; height: number; pad: number }, paint: (k: number) => (VNode | string)[]) {
  const fitK = (b: Box) => Math.min((size.width - size.pad * 2) / b.w, (size.height - size.pad * 2) / b.h);
  let k = fitK(drawn);
  let live = paint(k);
  let box = unite(drawn, extent(live));
  k = fitK(box);
  live = paint(k);
  box = unite(drawn, extent(live));
  k = fitK(box);
  return { k, box, live };
}
