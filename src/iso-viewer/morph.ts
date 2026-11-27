// The morph between a drawing's two views (0.7.5, out of dual-view.ts so the editor's canvas can run it too, handed
// over by its 2D view's implementation): things move from where they are in one view to where they are in the other,
// a 3D top face becoming its 2D card (or coming from it), connectors fade out and draw in, on a layer of its own over
// both. No flat layout here: a page that only morphs bundles none of it.

import { parseEnd } from '../iso-objects/route.ts';
import type { CompiledScene } from '../iso-objects/compile.ts';
import type { Board } from '../iso-objects/flat.ts';

export type ViewMode = '3d' | '2d';
const NS = 'http://www.w3.org/2000/svg';
/** (0.30.0) layers made so far: each one's patterns are named apart */
let layers = 0;

/** a 3D drawing's connectors marked with the ends they join (data-a, data-b), as the 2D ones are: a board's link may be
 *  drawn to a panel, so its ends are the board's when given */
export function markConnectors(svg3: SVGSVGElement, scene: CompiledScene, board?: Board): void {
  const links = new Map((board?.links ?? []).map((l, i) => [l.id ?? `link-${i}`, l]));
  for (const r of scene.routes) {
    const l = links.get(r.id), a = l?.a ?? parseEnd(r.raw.from).id, b = l?.b ?? parseEnd(r.raw.to).id;
    for (const g of svg3.querySelectorAll(`[data-id="${CSS.escape(r.id)}"]`)) { g.setAttribute('data-a', a); g.setAttribute('data-b', b); }
  }
}

/** whether a switch should animate, by the motion option (0.7.3) */
export const morphs = (motion: 'auto' | 'always' | 'never' = 'auto') =>
  motion === 'always' || (motion === 'auto' && !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches));

/** A running morph between two drawings already laid out in `root` (positioned): `done` resolves when it ends,
 *  `finish()` ends it at once (the layer gone). The caller shows and hides the drawings themselves. */
export interface SvgMorph { readonly done: Promise<void>; finish(): void }
/** The morph dualView runs (0.7.5: for the editor's canvas too), from one view's svg to the other's, over `root`:
 *  things move from where they are to where they will be (a 3D top face becoming its 2D card, or back), connectors fade
 *  out and draw in. Undefined when the motion option says not to animate (or the duration is 0). */
export function morphSvgs(root: HTMLElement, fromSvg: SVGSVGElement, toSvg: SVGSVGElement, from: ViewMode,
  o: { duration?: number; motion?: 'auto' | 'always' | 'never' } = {}): SvgMorph | undefined {
  const T = o.duration ?? 600;
  if (!T || !morphs(o.motion)) return undefined;
  const layer = buildLayer(root, fromSvg, toSvg, from);
  root.appendChild(layer.svg);
  layer.at(0);
  let frame = 0, over = false, resolve!: () => void;
  const done = new Promise<void>(r => (resolve = r));
  const finish = () => { if (over) return; over = true; cancelAnimationFrame(frame); layer.svg.remove(); resolve(); };
  const t0 = performance.now();
  const step = (now: number) => {
    if (over) return;
    const t = Math.min(1, (now - t0) / T);
    layer.at(t);
    if (t < 1) frame = requestAnimationFrame(step); else finish();
  };
  frame = requestAnimationFrame(step);
  return { done, finish };
}


export const clamp = (v: number) => Math.max(0, Math.min(1, v));
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** an element and everything in it, with its computed paint inlined (the layer is outside the views' stylesheets). (0.30.0) A paint that
 *  is a reference (a black-and-white pattern: url(#…)) goes through `keep`, which gives the layer's own copy of what it names */
function paintedClone(el: Element, keep: (paint: string, from: Element) => string = p => p): Element {
  const c = el.cloneNode(true) as Element;
  const src = [el, ...el.querySelectorAll('*')], dst = [c, ...c.querySelectorAll('*')];
  src.forEach((s, i) => {
    const cs = getComputedStyle(s), d = dst[i] as SVGElement;
    d.removeAttribute('class');
    d.removeAttribute('tabindex');
    for (const p of ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'opacity', 'font-size', 'font-weight', 'font-family', 'letter-spacing', 'paint-order', 'stroke-linejoin', 'text-anchor']) d.style.setProperty(p, cs.getPropertyValue(p));
    for (const p of ['fill', 'stroke']) { const v = d.style.getPropertyValue(p); if (v.startsWith('url(')) d.style.setProperty(p, keep(v, s)); }
  });
  return c;
}

interface Rect { x: number; y: number; w: number; h: number }
const rectIn = (el: Element, origin: DOMRect): Rect => { const r = el.getBoundingClientRect(); return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height }; };
const union = (rs: Rect[]): Rect => {
  const x0 = Math.min(...rs.map(r => r.x)), y0 = Math.min(...rs.map(r => r.y)), x1 = Math.max(...rs.map(r => r.x + r.w)), y1 = Math.max(...rs.map(r => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
/** the svg's own coordinates in the root's pixels */
const ctmIn = (svg: SVGSVGElement, origin: DOMRect) => { const m = svg.getScreenCTM()!; return `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e - origin.left} ${m.f - origin.top})`; };
/** the map taking rect a onto rect b, `t` of the way (0: none) */
const toward = (a: Rect, b: Rect, t: number) => {
  const sx = 1 + (b.w / Math.max(a.w, 1e-6) - 1) * t, sy = 1 + (b.h / Math.max(a.h, 1e-6) - 1) * t;
  const tx = (b.x - a.x * (b.w / Math.max(a.w, 1e-6))) * t, ty = (b.y - a.y * (b.h / Math.max(a.h, 1e-6))) * t;
  return `matrix(${sx} 0 0 ${sy} ${tx} ${ty})`;
};
/** the top face of a 3D thing (its four corners, in the root's pixels), if it has one */
function topFace(g: Element, origin: DOMRect): { pts: [number, number][]; fill: string; pattern?: string } | undefined {
  const poly = g.querySelector('polygon.top') as SVGPolygonElement | null;
  if (!poly) return undefined;
  const m = poly.getScreenCTM()!, pts: [number, number][] = [];
  for (let i = 0; i < poly.points.numberOfItems; i++) { const p = poly.points.getItem(i); pts.push([m.a * p.x + m.c * p.y + m.e - origin.left, m.b * p.x + m.d * p.y + m.f - origin.top]); }
  // (0.30.0) in black and white, a patterned face has its pattern drawn over it, straight after it (mono-paint.ts)
  const over = poly.nextElementSibling?.classList.contains('mono-pattern') ? getComputedStyle(poly.nextElementSibling).fill : undefined;
  return pts.length === 4 ? { pts, fill: getComputedStyle(poly).fill, ...(over?.startsWith('url(') ? { pattern: over } : {}) } : undefined;
}

/** a morph's layer: append `svg` to the root; `at(t)` paints it t (0 to 1) of the way, in any order (no clock) */
export interface MorphLayer { svg: SVGSVGElement; at(t: number): void }
/** the layer a morph draws on: `at(t)` paints it t of the way from one view to the other. Both views are in the root and
 *  laid out (hidden is fine, display: none is not): a host seeks it frame by frame (0.12.2: exported). */
export function buildLayer(root: HTMLElement, fromSvg: SVGSVGElement, toSvg: SVGSVGElement, from: ViewMode): MorphLayer {
  const origin = root.getBoundingClientRect();
  const layer = document.createElementNS(NS, 'svg') as SVGSVGElement;
  // (0.30.0) the patterns its clones paint with, copied into the layer under ids of its own: a reference to another svg's defs (a view
  // hidden, or two views with the same ids) paints nothing, and black and white lost its hatching (M6.B4)
  const defs = document.createElementNS(NS, 'defs'), copied = new Map<Element, string>(), tag = `dual-morph-${++layers}`;
  layer.appendChild(defs);
  const keep = (paint: string, from: Element) => {
    const id = /url\(\s*["']?[^"')]*#([^"')]+)["']?\s*\)/.exec(paint)?.[1];
    const svg = id ? ((from as SVGElement).ownerSVGElement ?? from.closest('svg')) : null;
    const src = id ? (svg?.querySelector(`[id="${CSS.escape(id)}"]`) ?? from.ownerDocument.getElementById(id)) : null;
    if (!src) return paint;
    let mine = copied.get(src);
    if (!mine) { mine = `${tag}-${copied.size}`; const c = src.cloneNode(true) as Element; c.id = mine; defs.appendChild(c); copied.set(src, mine); }
    return `url(#${mine})`;
  };
  layer.setAttribute('class', 'dual-morph');
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = `position:absolute;left:0;top:0;width:${origin.width}px;height:${Math.max(origin.height, fromSvg.getBoundingClientRect().height, toSvg.getBoundingClientRect().height)}px;overflow:visible;pointer-events:none`;
  const inUser = (svg: SVGSVGElement) => { const g = document.createElementNS(NS, 'g'); g.setAttribute('transform', ctmIn(svg, origin)); return g; };
  const isConn = (e: Element) => e.hasAttribute('data-a') || e.hasAttribute('data-for');
  const things = (svg: SVGSVGElement) => {
    const m = new Map<string, Element[]>();
    for (const e of svg.querySelectorAll('[data-id]')) {
      if (isConn(e) || e.parentElement?.closest('[data-id]') || e.closest('.overlay')) continue;
      const id = e.getAttribute('data-id')!;
      (m.get(id) ?? m.set(id, []).get(id)!).push(e);
    }
    return m;
  };
  const A = things(fromSvg), B = things(toSvg);
  // connectors (and their labels) of each view
  const connsOut = document.createElementNS(NS, 'g'), connsIn = document.createElementNS(NS, 'g');
  const cOut = inUser(fromSvg), cIn = inUser(toSvg);
  // (an editor's overlay marks carry data-for too: never theirs)
  for (const e of fromSvg.querySelectorAll('[data-a],[data-for]')) if (!e.closest('.overlay')) cOut.appendChild(paintedClone(e, keep));
  for (const e of toSvg.querySelectorAll('[data-a],[data-for]')) if (!e.closest('.overlay')) cIn.appendChild(paintedClone(e, keep));
  connsOut.appendChild(cOut); connsIn.appendChild(cIn);
  const drawIn = [...cIn.querySelectorAll('path')].map(p => { const len = (p as SVGPathElement).getTotalLength?.() ?? 0; return { p: p as SVGPathElement, len }; });
  const inLabels = [...cIn.children].filter(e => e.tagName.toLowerCase() === 'text') as SVGElement[];
  // panels below cards: the 2D order (panels by depth, then cards), the 3D one's by its painter's order
  const order = [...(from === '2d' ? A : B).keys()];
  const items: { a?: Rect; b?: Rect; src?: SVGGElement; dst?: SVGGElement; face?: SVGPolygonElement; facePat?: SVGPolygonElement; faceFrom?: [number, number][]; faceTo?: [number, number][]; faceFill?: [string, string] }[] = [];
  const shapes = document.createElementNS(NS, 'g');
  for (const id of new Set([...order, ...A.keys(), ...B.keys()])) {
    const ea = A.get(id), eb = B.get(id);
    const it: (typeof items)[number] = {};
    if (ea) {
      it.a = union(ea.map(e => rectIn(e, origin)));
      const g = document.createElementNS(NS, 'g') as SVGGElement, u = inUser(fromSvg);
      for (const e of ea) u.appendChild(paintedClone(e, keep));
      g.appendChild(u); it.src = g;
    }
    if (eb) {
      it.b = union(eb.map(e => rectIn(e, origin)));
      const g = document.createElementNS(NS, 'g') as SVGGElement, u = inUser(toSvg);
      for (const e of eb) u.appendChild(paintedClone(e, keep));
      g.appendChild(u); it.dst = g;
    }
    // the 3D top face becomes the 2D card (or comes from it)
    const g3 = from === '3d' ? ea?.[0] : eb?.[0], g2 = from === '3d' ? eb?.[0] : ea?.[0];
    const top = g3 ? topFace(g3, origin) : undefined, face2 = g2?.querySelector('rect.face');
    if (top && face2) {
      const r = rectIn(face2, origin);
      const flat: [number, number][] = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
      // match the corners: the 3D face's corners in order round it, starting from its leftmost
      const k = top.pts.reduce((m, p, i) => (p[0] < top.pts[m][0] ? i : m), 0);
      const rot = [...top.pts.slice(k), ...top.pts.slice(0, k)];
      const ordered: [number, number][] = [rot[0], rot[1], rot[2], rot[3]];
      const f2 = getComputedStyle(face2).fill;
      const poly = document.createElementNS(NS, 'polygon') as SVGPolygonElement;
      it.face = poly;
      it.faceFrom = from === '3d' ? ordered : flat; it.faceTo = from === '3d' ? flat : ordered;
      it.faceFill = from === '3d' ? [top.fill, f2] : [f2, top.fill];
      // (0.30.0) its black-and-white pattern goes with it (the 2D card brings its own strip of it)
      if (top.pattern) { const pp = document.createElementNS(NS, 'polygon') as SVGPolygonElement; pp.style.fill = keep(top.pattern, g3!); pp.style.stroke = 'none'; it.facePat = pp; }
    }
    if (it.src) shapes.appendChild(it.src);
    if (it.face) shapes.appendChild(it.face);
    if (it.facePat) shapes.appendChild(it.facePat);
    if (it.dst) shapes.appendChild(it.dst);
    items.push(it);
  }
  layer.append(connsOut, shapes, connsIn);
  const mix = (a: string, b: string, t: number) => `color-mix(in srgb, ${a} ${Math.round((1 - t) * 100)}%, ${b})`;
  return {
    svg: layer,
    at(t: number) {
      const out = clamp(t / 0.2), mid = ease(clamp((t - 0.2) / 0.6)), inn = clamp((t - 0.8) / 0.2);
      connsOut.setAttribute('opacity', String(1 - out));
      for (const { p, len } of drawIn) { p.style.strokeDasharray = `${len} ${len}`; p.style.strokeDashoffset = String(len * (1 - inn)); }
      connsIn.setAttribute('opacity', String(inn > 0 ? 1 : 0));
      for (const l of inLabels) l.style.opacity = String(inn);
      for (const it of items) {
        if (it.src) {
          it.src.setAttribute('transform', it.a && it.b ? toward(it.a, it.b, mid) : '');
          it.src.setAttribute('opacity', String(it.b ? 1 - clamp(mid / (it.face ? 0.35 : 0.6)) : 1 - mid));
        }
        if (it.dst) {
          it.dst.setAttribute('transform', it.a && it.b ? toward(it.b, it.a, 1 - mid) : '');
          it.dst.setAttribute('opacity', String(it.a ? clamp((mid - (it.face ? 0.65 : 0.4)) / (it.face ? 0.35 : 0.6)) : mid));
        }
        if (it.face) {
          const pts = it.faceFrom!.map((p, i) => [p[0] + (it.faceTo![i][0] - p[0]) * mid, p[1] + (it.faceTo![i][1] - p[1]) * mid]);
          it.face.setAttribute('points', pts.map(p => p.join(',')).join(' '));
          it.face.style.fill = mix(it.faceFill![0], it.faceFill![1], mid);
          const fo = mid < 0.08 ? mid / 0.08 : mid > 0.92 ? (1 - mid) / 0.08 : 1;
          it.face.setAttribute('opacity', String(fo));
          // its pattern: the 3D face's, as much as the face is still the 3D one
          if (it.facePat) { it.facePat.setAttribute('points', it.face.getAttribute('points')!); it.facePat.setAttribute('opacity', String(fo * (from === '3d' ? 1 - mid : mid))); }
        }
      }
    },
  };
}

