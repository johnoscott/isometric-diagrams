// From a drawing's 3D view to its 2D one, or back, as a drawing of its own at any part of the way, from a number alone: the morph of
// morph.ts (the editor's and dualView's), made from the two drawings' own shapes and colours where that one reads a page's. Pure: no page, no
// clock, so a frame is the same anywhere, and a video can have one. Both views are self-contained (resolveVars; flatStill), and are drawn
// as wide as each other and from the same top, as a page shows them.
//
// As morph.ts: the first fifth, the connectors of the view it leaves fade out; to four fifths, each thing (by id) moves and resizes from
// where it is in one view to where it is in the other, eased, a 3D top face becoming its 2D card (or back) as the rest crossfades; the last
// fifth, the other view's connectors draw in. The ends are the two stills themselves.

import { iso, tag } from '../iso-core/kernel.ts';
import type { Theme } from '../iso-core/theme.ts';
import type { CompiledScene } from '../iso-objects/compile.ts';
import { renamed } from '../iso-objects/diff-look.ts';
import { polyBounds, silhouette } from '../iso-objects/labels.ts';
import type { ThemeMode } from '../iso-objects/resolve.ts';
import { flatStill, type FlatStillOptions } from './flat-still.ts';
import { clamp, ease, type ViewMode } from './morph.ts';

export interface MorphOptions extends Pick<FlatStillOptions, 'board' | 'flat' | 'styles'> {
  theme: Theme; mode: ThemeMode;
  /** the view it begins in (default: 3D) */
  from?: ViewMode;
  /** what its ids begin with (default: the scene's id and `-morph`) */
  id?: string;
}
type Box = { x: number; y: number; w: number; h: number };
type M = [number, number, number, number, number, number];
/** a thing's part of the way: each view's shapes, moved by a matrix, and how much of it shows; its face where it has one */
export interface MorphThing { from?: { m: M; opacity: number }; to?: { m: M; opacity: number }; face?: { points: [number, number][]; fill: string; opacity: number } }
export interface MorphState { out: number; in: number; things: Record<string, MorphThing> }
export interface MorphDrawing {
  id: string; from: ViewMode;
  /** the stage, in the 3D view's own units */
  viewBox: [number, number, number, number];
  at(t: number): MorphState;
  /** the frame: at 0 the view it begins in, at 1 the other, each as its own still (in the stage's view) */
  svgAt(t: number): string;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0, r5 = (v: number) => Math.round(v * 100000) / 100000 || 0;
const mat = (m: M) => `matrix(${m.join(' ')})`;
/** what takes box a onto b, f of the way (0: none) */
function toward(a: Box, b: Box, f: number): M {
  const sx = b.w / Math.max(a.w, 1e-6), sy = b.h / Math.max(a.h, 1e-6);
  // (a scale's place matters more: a thousandth of it is a pixel's half across a drawing)
  return [r5(1 + (sx - 1) * f), 0, 0, r5(1 + (sy - 1) * f), r3((b.x - a.x * sx) * f), r3((b.y - a.y * sy) * f)];
}
const union = (rs: Box[]): Box => { const x0 = Math.min(...rs.map(r => r.x)), y0 = Math.min(...rs.map(r => r.y)); return { x: x0, y: y0, w: Math.max(...rs.map(r => r.x + r.w)) - x0, h: Math.max(...rs.map(r => r.y + r.h)) - y0 }; };
const hex = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const mix = (a: string, b: string, f: number) => { if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return f < 0.5 ? a : b; const p = hex(a), q = hex(b); return '#' + p.map((v, i) => Math.round(v + (q[i] - v) * f).toString(16).padStart(2, '0')).join(''); };
const lengthOf = (pts: number[][]) => pts.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
/** the elements at a depth (the layers' children), as text, with their attributes; and the defs */
function partsOf(svg: string, depth: number): { attrs: string; layer: string; text: string }[] {
  const out: { attrs: string; layer: string; text: string }[] = [], open: { attrs: string; at: number }[] = [];
  for (const m of svg.matchAll(TAG)) {
    if (m[1]) { const o = open.pop()!; if (open.length === depth) out.push({ attrs: o.attrs, layer: open[depth - 1]?.attrs ?? '', text: svg.slice(o.at, m.index + m[0].length) }); continue; }
    if (m[4]) { if (open.length === depth) out.push({ attrs: m[3], layer: open[depth - 1]?.attrs ?? '', text: m[0] }); continue; }
    open.push({ attrs: m[3], at: m.index });
  }
  return out;
}
const get = (attrs: string, k: string) => new RegExp(`\\s${k}="([^"]*)"`).exec(attrs)?.[1];

/** A scene's two views, and the way from one to the other. */
export function morphDrawing(scene: CompiledScene, o: MorphOptions): MorphDrawing {
  if (!scene.rendered.inks) throw new Error('morphDrawing: the scene isn\'t self-contained (compile it with resolveVars)');
  const id = o.id ?? `${/^[A-Za-z]/.test(scene.id) ? '' : 'd'}${scene.id.replace(/[^A-Za-z0-9_-]/g, '_')}-morph`, from = o.from ?? '3d';
  const flat = flatStill(scene, { theme: o.theme, mode: o.mode, board: o.board, flat: o.flat, styles: o.styles, id: `${id}-2d` });
  // the stage: the 3D view; the 2D one as wide, from the same top (and as far down as it goes)
  const v3 = scene.rendered.viewBox, v2 = flat.viewBox, k = v3[2] / v2[2];
  const T: M = [r5(k), 0, 0, r5(k), r3(v3[0] - v2[0] * k), r3(v3[1] - v2[1] * k)], at2 = (x: number, y: number): [number, number] => [T[0] * x + T[4], T[3] * y + T[5]];
  const viewBox: [number, number, number, number] = [v3[0], v3[1], v3[2], Math.max(v3[3], v2[3] * k)];
  const svg3 = renamed(scene.rendered.svg, `${id}-3d-`), svg2 = flat.svg;

  // ---- each view's things, by id, as the page morph finds them: what carries the id, in its order ----
  const three = new Map<string, string[]>(), lines3: string[] = [];
  for (const w of partsOf(svg3, 2)) {
    const route = get(w.attrs, 'data-route'), item = get(w.attrs, 'data-item');
    if (route !== undefined) lines3.push(w.text);
    else if (item !== undefined && get(w.attrs, 'data-part') !== undefined) (three.get(item) ?? three.set(item, []).get(item)!).push(w.text);
  }
  const two = new Map<string, string>(), lines2: string[] = [];
  for (const w of partsOf(svg2, 2)) {
    const layer = get(w.layer, 'class'), i = get(w.attrs, 'data-id');
    if (layer === 'conns' || layer === 'labels') lines2.push(w.text);
    else if (i !== undefined) two.set(i, w.text);
  }
  const rectOf = (i: string): Box | undefined => {
    const r = flat.layout.cards.find(c => c.id === i)?.rect ?? flat.layout.panels.find(p => p.id === i)?.rect;
    if (!r) return undefined;
    const [x0, y0] = at2(r.l, r.t), [x1, y1] = at2(r.r, r.b);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const boxOf = (i: string): Box | undefined => {
    const p = scene.layout.byId.get(i);
    return p && union([polyBounds(silhouette(p.box)), ...scene.rendered.texts.filter(t => t.owner === i)]);
  };
  const topOf = (i: string): { points: [number, number][]; fill: string } | undefined => {
    const blk = three.get(i)?.find(t => /data-part="block"/.test(t)), top = blk && /<polygon[^>]* points="([^"]*)"[^>]* class="top"[^>]*>/.exec(blk);
    let pts: [number, number][], fill: string;
    if (top) { pts = top[1].split(' ').map(q => q.split(',').map(Number) as [number, number]); fill = get(top[0], 'fill') ?? '#000000'; } else {
      // a walled region has walls and no block: the top of its box, in its walls' colour. (morph.ts takes the first thing with the id, which for
      // such a region is a wall, and so turns that wall's top into the panel: by accident)
      const p = scene.layout.byId.get(i), wall = three.get(i)?.map(t => /<polygon[^>]* class="top"[^>]*>/.exec(t)).find(Boolean);
      if (!p || !wall) return undefined;
      const b = p.box; pts = [iso(b.x0, b.y0, b.z1), iso(b.x1, b.y0, b.z1), iso(b.x1, b.y1, b.z1), iso(b.x0, b.y1, b.z1)]; fill = get(wall[0], 'fill') ?? '#000000';
    }
    if (pts.length !== 4) return undefined;
    // its corners round it from the leftmost, as the 2D card's from its top left
    const k0 = pts.reduce((m, p, n) => (p[0] < pts[m][0] ? n : m), 0);
    return { points: [...pts.slice(k0), ...pts.slice(0, k0)], fill };
  };
  const cardOf = (i: string): { points: [number, number][]; fill: string } | undefined => {
    const r = rectOf(i), face = two.get(i) && /<rect class="face"[^>]*>/.exec(two.get(i)!);
    return r && face ? { points: [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]], fill: get(face[0], 'fill') ?? '#000000' } : undefined;
  };
  // the 2D order (panels by depth, then cards), then what only the 3D view has
  const ids = [...new Set([...two.keys(), ...three.keys()])];
  // (a thing the 3D view alone has, a note, has no box of the layout's, and needs none: it fades where it is)
  const none: Box = { x: 0, y: 0, w: 0, h: 0 }, in3 = (i: string) => (three.has(i) ? boxOf(i) ?? none : undefined);
  const there = (i: string) => ({ a: from === '3d' ? in3(i) : rectOf(i), b: from === '3d' ? rectOf(i) : in3(i) });
  const faces = new Map(ids.map(i => { const t = topOf(i), c = cardOf(i); return [i, t && c ? (from === '3d' ? [t, c] : [c, t]) : undefined] as const; }));

  function at(t0: number): MorphState {
    const t = Number.isFinite(t0) ? clamp(t0) : 0, out = clamp(t / 0.2), mid = ease(clamp((t - 0.2) / 0.6)), inn = clamp((t - 0.8) / 0.2);
    const things: Record<string, MorphThing> = {};
    for (const i of ids) {
      const { a, b } = there(i), f = faces.get(i), th: MorphThing = {};
      if (a) th.from = { m: b ? toward(a, b, mid) : [1, 0, 0, 1, 0, 0], opacity: r3(b ? 1 - clamp(mid / (f ? 0.35 : 0.6)) : 1 - mid) };
      if (b) th.to = { m: a ? toward(b, a, 1 - mid) : [1, 0, 0, 1, 0, 0], opacity: r3(a ? clamp((mid - (f ? 0.65 : 0.4)) / (f ? 0.35 : 0.6)) : mid) };
      if (f) th.face = { points: f[0].points.map((p, n) => [r3(p[0] + (f[1].points[n][0] - p[0]) * mid), r3(p[1] + (f[1].points[n][1] - p[1]) * mid)] as [number, number]), fill: mix(f[0].fill, f[1].fill, mid), opacity: r3(mid < 0.08 ? mid / 0.08 : mid > 0.92 ? (1 - mid) / 0.08 : 1) };
      things[i] = th;
    }
    return { out: r3(out), in: r3(inn), things };
  }

  const ends = { '3d': svg3.replace(/^<svg[^>]*>/, m => m.replace(/(\sviewBox=")[^"]*"/, (_, q: string) => `${q}${viewBox.join(' ')}"`)), '2d': svg2.replace(/^<svg[^>]*>/, m => m.replace(/(\sviewBox=")[^"]*"/, (_, q: string) => `${q}${[(viewBox[0] - T[4]) / k, (viewBox[1] - T[5]) / k, viewBox[2] / k, viewBox[3] / k].map(r3).join(' ')}"`)) };
  const defs = (s: string) => /<defs>([\s\S]*?)<\/defs>/.exec(s)?.[1] ?? '';
  const in2 = (x: string) => `<g transform="${mat(T)}">${x}</g>`;
  /** a view's connectors, drawn in as far as f: whatever the order of a path's attributes */
  const drawIn = (x: string, f: number) => x.replace(/<path((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g, (m, attrs: string, self: string) => {
    if (!/\sclass="(?:flow|conn)\b/.test(attrs)) return m;
    const d = get(attrs, 'd') ?? '', len = r3(lengthOf([...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(q => [Number(q[1]), Number(q[2])])));
    return `<path${attrs.replace(/\s(?:stroke-dasharray|stroke-dashoffset)="[^"]*"/g, '')} stroke-dasharray="${len} ${len}" stroke-dashoffset="${r3(len * (1 - f))}"${self ? '/' : ''}>`;
  });
  return {
    id, from, viewBox, at,
    svgAt(t0) {
      const t = Number.isFinite(t0) ? clamp(t0) : 0, to: ViewMode = from === '3d' ? '2d' : '3d';
      if (t <= 0) return ends[from];
      if (t >= 1) return ends[to];
      const s = at(t), root = /^<svg[^>]*>/.exec(svg3)![0].replace(/(\sviewBox=")[^"]*"/, (_, q: string) => `${q}${viewBox.join(' ')}"`).replace(/(\sdata-scene=")[^"]*"/, (_, q: string) => `${q}${id}"`);
      const linesOf = (v: ViewMode) => (v === '3d' ? lines3.join('') : in2(lines2.join('')));
      const shapeOf = (v: ViewMode, i: string) => (v === '3d' ? (three.get(i) ?? []).join('') : in2(two.get(i) ?? ''));
      let body = `<g opacity="${r3(1 - s.out)}">${linesOf(from)}</g>`;
      for (const i of ids) {
        const th = s.things[i];
        if (th.from) body += `<g transform="${mat(th.from.m)}" opacity="${th.from.opacity}">${shapeOf(from, i)}</g>`;
        if (th.face) body += tag('polygon', { points: th.face.points.map(p => p.map(r3).join(',')).join(' '), fill: th.face.fill, opacity: String(th.face.opacity) });
        if (th.to) body += `<g transform="${mat(th.to.m)}" opacity="${th.to.opacity}">${shapeOf(to, i)}</g>`;
      }
      // (the 2D lines' words come in as the lines do, as the page has them; the 3D view's are in wrappers the page doesn't fade, and neither does this)
      const lines = to === '3d' ? drawIn(lines3.join(''), s.in) : in2(drawIn(lines2.join(''), s.in).replace(/<text class="cl /g, `<text opacity="${s.in}" class="cl `));
      body += `<g opacity="${s.in > 0 ? 1 : 0}">${lines}</g>`;
      return `${root}<defs>${defs(svg3)}${defs(svg2)}</defs>${body}</svg>`;
    },
  };
}
