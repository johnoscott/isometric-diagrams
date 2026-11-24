// One scene → one SVG string. Pure: no DOM, so it runs the same in Node and in the browser.

import { type Attrs, type Box, type P2, Kernel, FONTS, S, tag, iso, pt, n1, esc, textWidth } from '../iso-core/kernel.ts';
import { drawCloud } from './assets.ts';
import { type KindCatalog, regionKind, nodeKindOr } from './kinds.ts';
import { depthSort } from '../iso-core/depth.ts';
import { labelRect, Obstacles, placeCallout, placeNodeLabel, polyBounds, silhouette, type Rect } from './labels.ts';
import { WALL_T, gateBox, type Layout } from './place.ts';
import { floorAt, type Routed } from './route.ts';
import { assembly, type Assembly } from './assemble.ts';
import type { Steps } from './steps.ts';
import type { Placed, RawNote, RawScene, Theme } from './types.ts';
import { colorRef } from '../iso-core/theme.ts';

/** the colour role a region is drawn in: its own, else its kind's */
export const regionRole = (cat: KindCatalog, r: { role?: string; kind: string }): string => r.role ?? regionKind(cat, r.kind)?.role!;
const shapeOf = (cat: KindCatalog, r: Placed) => regionKind(cat, r.region!.kind)?.shape;

export interface RenderedScene {
  svg: string;
  viewBox: [number, number, number, number];
  /** text rectangles in screen px, for layout tests */
  texts: { x: number; y: number; w: number; h: number; text: string; owner?: string }[];
  /** each route's path, for the player's tokens; in screen px */
  paths: Record<string, string>;
  /** things drawn worse than asked, e.g. a route label shortened or dropped */
  warnings: RenderWarning[];
  /** (0.15.0) a self-contained drawing's own colours, for what a state adds to it (a token's rim and fill) */
  inks?: { surface: string; control: string; kinds?: Record<string, string> };
  /** the drawing with every thing that has a look of this name in it, as SVG text (what a switch takes the thing's parts from);
   *  none when nothing declares one */
  variants?: Record<string, string>;
  /** the looks each thing declares */
  looks?: Record<string, string[]>;
  /** the assemble intro's timeline */
  assembly: Assembly;
  /** callout pills in screen px, per step, for layout tests */
  callouts: { step: number; x: number; y: number; w: number; h: number; text: string }[];
}
export interface RenderWarning { path: string; message: string }

interface Item { box: Box; svg: string }

/** (0.15.0) A thing's parts in a layer, in a wrapper of their own: `<g data-item=ID data-part=…>` (block, wall-1…, gate,
 *  name, label, note), a route's `<g data-route=ID data-part=…>` (line, with its arrowhead's marker; label). A wrapper has
 *  no transform and no class: a host (and motion.ts) moves and fades wrappers, never what is inside them, whose texts
 *  have transforms, and whose classes have opacities, of their own. One wrapper a part and a layer, not one a thing: its
 *  block, walls and label are painted in different layers, among other things' (its data-id stays on every part of it;
 *  data-item and data-part together are one wrapper's). */
const wrap = (id: string, part: string, svg: string, what: 'item' | 'route' = 'item') => (svg ? tag('g', { [`data-${what}`]: id, 'data-part': part }, svg) : '');

export interface SceneInput { scene: RawScene; layout: Layout; routes: Routed[]; steps: Steps; theme: Theme; id: string; gridStep?: number }

export function renderScene({ scene, layout, routes, steps, theme, id, gridStep = 1 }: SceneInput): RenderedScene {
  const k = new Kernel();
  const L = { base: '', floor: '', flows: '', blocks: [] as Item[], air: '', labels: '', marks: '', badges: '' };
  const obs = new Obstacles();
  obs.budget.spots = LABEL_BUDGET;
  const visAttr = (oid: string) => (steps.vis[oid] ? { 'data-vis': '1' } : {});

  // ---- regions ----
  const regions = layout.items.filter(p => p.type === 'region');
  const depthOf = (p: Placed) => { let d = 0; for (let a = p.parent; a; a = a.parent) d++; return d; };
  const cat = layout.catalog;
  const flat = regions.filter(r => shapeOf(cat, r) !== 'walled' && shapeOf(cat, r) !== 'tunnel');
  // parents before children; siblings back to front
  const ordered = depthSort(flat.map(r => ({ box: r.box, r }))).map(x => x.r).sort((a, b) => depthOf(a) - depthOf(b));
  for (const r of ordered) L.base += drawFlatRegion(k, cat, r, visAttr(r.id), gridStep);
  for (const r of regions.filter(r => shapeOf(cat, r) === 'walled')) {
    for (const w of wallsOf(r)) obs.solids.push(silhouette(w));
    for (const [i, w] of wallsOf(r).entries()) L.blocks.push({ box: w, svg: wrap(r.id, `wall-${i + 1}`, tag('g', { class: `blk k-${regionRole(cat, r.region!)} wall${r.region!.ghost ? ' ghost' : ''}`, 'data-id': r.id, 'data-dim': '1', ...visAttr(r.id) }, k.blockFaces(w))) });
    const g = r.region!.gate;
    if (g && !g.node) {
      const b = gateBox(r, g.height ?? (r.region!.height ?? 0.8) + 0.3, 0.3, 0.3);
      obs.solids.push(silhouette(b));
      L.blocks.push({ box: b, svg: wrap(r.id, 'gate', tag('g', { class: 'blk k-gate', 'data-id': r.id, ...visAttr(r.id) }, k.blockFaces(b))) });
    }
    if (r.region!.label && (r.region!['label-style'] ?? 'face') !== 'none') {
      L.labels += wrap(r.id, 'name', k.faceText(r.box.x0 + 0.3, r.box.y1, r.box.z0 + 0.13, r.region!.label, 'slabname sm fz', FONTS.sm, 'left', 'start', { 'data-id': r.id, ...visAttr(r.id) }));
    }
  }

  // ---- tunnels: translucent tubes in the air layer ----
  for (const r of regions.filter(r => shapeOf(cat, r) === 'tunnel')) L.air += wrap(r.id, 'block', drawTunnel(k, r, visAttr(r.id)));

  // ---- nodes ----
  const nodes = layout.items.filter(p => p.type === 'node');
  for (const p of nodes) {
    const n = p.node!, a = nodeKindOr(cat, n.asset);
    const ghost = n.ghost || (n.deco ?? []).includes('ghost');
    const cls = ['blk', `k-${n.role ?? a.role}`, a.cls, ghost ? 'ghost' : ''].filter(Boolean).join(' ');
    L.blocks.push({ box: p.box, svg: wrap(p.id, 'block', tag('g', { class: cls, 'data-id': p.id, 'data-dim': '1', ...visAttr(p.id) }, a.draw(k, p.box, n))) });
    obs.polys.push({ poly: silhouette(p.box), owner: p.id });
    obs.solids.push(silhouette(p.box));
  }
  const blocks = depthSort(L.blocks).map(i => i.svg).join('');

  // ---- routes ----
  const markers = new Set<string>();
  const paths: Record<string, string> = {};
  for (const r of routes) {
    if (r.points.length < 2) continue;
    const scr = r.points.map(q => iso(q[0], q[1], q[2]));
    scr.forEach(q => k.bounds.add(q));
    const d = 'M' + scr.map(pt).join(' L');
    paths[r.id] = d;
    const arrow = r.raw.arrow !== false;
    if (arrow) markers.add(r.kind);
    L.flows += wrap(r.id, 'line', tag('g', { 'data-hl': r.id, 'data-id': r.id, ...visAttr(r.id) },
      tag('path', { d, class: `flow f-${r.kind}`, 'marker-end': arrow ? `url(#ah-${id}-${r.kind})` : undefined })), 'route');
    obs.lines.push({ pts: scr, owner: r.id });
  }
  for (const kd of markers) {
    k.def(`ah-${id}-${kd}`, tag('marker', { id: `ah-${id}-${kd}`, viewBox: '0 0 10 10', refX: '7', refY: '5', markerWidth: '4.2', markerHeight: '4.2', orient: 'auto-start-reverse' },
      tag('path', { d: 'M0,0 L10,5 L0,10 z', style: `fill:${colorRef(theme, theme.kinds[kd]?.color ?? 'control')}` })));
  }

  // region names on faces and floors are obstacles for labels too
  for (const q of k.planePolys) obs.slants.push(q);
  // ---- node labels: biggest first, each clear of nodes, routes and the labels before it ----
  const labelled = nodes.filter(p => p.node!.label || p.node!.sub)
    .sort((a, b) => (b.box.x1 - b.box.x0) * (b.box.y1 - b.box.y0) - (a.box.x1 - a.box.x0) * (a.box.y1 - a.box.y0));
  for (const p of labelled) L.labels += wrap(p.id, 'label', nodeLabel(k, cat, p, obs, visAttr(p.id)));

  // ---- route labels and notes ----
  const warnings: RenderWarning[] = [];
  for (const r of routes) if (r.raw.label && r.points.length >= 2) {
    const out = routeLabel(k, r, obs, visAttr(r.id), layout);
    L.floor += wrap(r.id, 'label', out.svg, 'route');
    if (out.warning) warnings.push({ path: `${r.path}/label`, message: out.warning });
    if (obs.budget.over && !obs.budget.told) {
      obs.budget.told = true;
      warnings.push({ path: r.path, message: `from route "${r.id}" on, route labels were placed without weighing what other labels and lines cover: the scene is too large to search every spot (${LABEL_BUDGET.toLocaleString('en')} spots); split it into scenes, or give the labels "along", "side" or "at"` });
    }
  }
  (scene.notes ?? []).forEach((note, i) => {
    const s = wrap(`${id}-note-${i}`, 'note', drawNote(k, note, layout, routes, `${id}-note-${i}`));
    if (note.floor) L.floor += s; else L.labels += s;
  });

  // ---- step marks: callouts, crosses, badges ----
  const callouts: RenderedScene['callouts'] = [];
  const byStep = new Map<number, Obstacles>();
  for (const sy of steps.says) {
    const o = byStep.get(sy.step) ?? obs.fork();
    byStep.set(sy.step, o);
    const w = textWidth(sy.text, FONTS.say) + 18;
    const spot = placeCallout(w, sy.ax, sy.ay, { x: sy.x, y: sy.y, anchor: sy.anchor }, o);
    o.rects.push({ r: spot.rect, owner: '' });
    callouts.push({ step: sy.step, ...spot.rect, text: sy.text });
    const left = spot.rect.x + 2;
    k.bounds.addRect(spot.rect.x, spot.rect.y, spot.rect.w, spot.rect.h);
    const c = colorRef(theme, theme.kinds[sy.kind]?.color ?? 'control');
    L.marks += tag('g', { class: 'say', 'data-step': sy.step },
      tag('rect', { x: left, y: spot.y - 12, width: w, height: 24, rx: 12, style: `stroke:${c}` }) +
      tag('text', { x: left + w / 2, y: spot.y + 4, 'text-anchor': 'middle', style: `fill:${c}` }, esc(sy.text)));
  }
  for (const m of steps.marks) {
    const [X, Y] = iso(...m.p);
    k.bounds.addRect(X - 12, Y - 12, 24, 24);
    L.marks += tag('g', { class: 'xm', 'data-step': m.step, 'data-hl': m.on },
      tag('circle', { cx: X, cy: Y, r: 10 }) + tag('path', { d: `M${n1(X - 4.5)},${n1(Y - 4.5)} L${n1(X + 4.5)},${n1(Y + 4.5)} M${n1(X + 4.5)},${n1(Y - 4.5)} L${n1(X - 4.5)},${n1(Y + 4.5)}` }));
  }
  for (const b of steps.badges) {
    const [X, Y] = iso(...b.p);
    k.bounds.addRect(X - 13, Y - 13, 26, 26);
    L.badges += tag('g', { class: `badge c-${b.kind}`, 'data-go': b.step, 'data-badge': b.step, tabindex: '0', role: 'button', 'aria-label': `Step ${b.num}` },
      tag('circle', { cx: X, cy: Y, r: 11.5 }) + tag('text', { x: X, y: Y + 0.5 }, String(b.num)));
  }

  const bb = k.bounds, pad = 22;
  const vb: [number, number, number, number] = bb.empty ? [0, 0, 100, 100] : [Math.floor(bb.x0 - pad), Math.floor(bb.y0 - pad), Math.ceil(bb.x1 - bb.x0 + pad * 2), Math.ceil(bb.y1 - bb.y0 + pad * 2)];
  const defs = [...k.defs.values()].join('');
  const g = (name: string, inner: string) => tag('g', { class: 'g-' + name }, inner);
  const svg = tag('svg', {
    xmlns: 'http://www.w3.org/2000/svg', viewBox: vb.join(' '), role: 'img', 'aria-label': scene.aria ?? scene.title,
    'data-scene': id,
  }, tag('defs', {}, defs) + g('base', L.base) + g('floor', L.floor) + g('flows', L.flows) + g('blocks', blocks) + g('air', L.air) + g('labels', L.labels) + g('marks', L.marks) + g('badges', L.badges) + g('anim', ''));
  return { svg, viewBox: vb, texts: k.texts, paths, warnings, callouts, assembly: assembly(layout, routes, vb) };
}

/** Floor grid lines on a region's top, hidden until the Grid button shows them. */
function gridLines(b: Box, step: number): string {
  const z = b.z1 + 0.002, e = 1e-6, d: string[] = [];
  const seg = (a: [number, number], c: [number, number]) => { const p = iso(a[0], a[1], z), q = iso(c[0], c[1], z); d.push(`M${pt(p)}L${pt(q)}`); };
  for (let x = Math.ceil((b.x0 + e) / step) * step; x < b.x1 - e; x += step) seg([x, b.y0], [x, b.y1]);
  for (let y = Math.ceil((b.y0 + e) / step) * step; y < b.y1 - e; y += step) seg([b.x0, y], [b.x1, y]);
  return d.length ? tag('path', { class: 'grid', d: d.join('') }) : '';
}

function drawFlatRegion(k: Kernel, cat: KindCatalog, r: Placed, vis: Attrs, gridStep = 1): string {
  const R = r.region!, b = r.box, role = regionRole(cat, R), rk = regionKind(cat, R.kind), shape = rk?.shape;
  const attrs = { 'data-id': r.id, 'data-dim': '1', ...vis };
  let s = '';
  if (shape === 'cloud') s = tag('g', { class: `blk k-${role} cloud`, ...attrs }, drawCloud(k, b));
  else if (shape === 'zone') s = tag('g', { class: `zone k-${role}`, ...attrs }, k.poly([[b.x0, b.y0, b.z1], [b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]]));
  else s = tag('g', { class: `blk k-${role}${R.ghost ? ' ghost' : ''}`, ...attrs }, k.blockFaces(b) + gridLines(b, gridStep));
  s = wrap(r.id, 'block', s);
  const style = R['label-style'] ?? rk?.labelStyle;
  if (R.label && style !== 'none') {
    if (style === 'face') {
      // (0.12.2) a thin slab's face can't hold the large name: it has the small one, in the middle of the face
      const h = b.z1 - b.z0, cap = (f: { size: number }) => (f.size * 0.73) / S, thin = shape === 'slab' && 0.28 + cap(FONTS.slabname) + 0.08 > h;
      const big = shape === 'slab' && !thin;
      const z = big ? b.z0 + 0.28 : thin ? b.z0 + Math.max(0.02, (h - cap(FONTS.sm)) / 2) : b.z0 + Math.min(0.1, h * 0.25);
      s += wrap(r.id, 'name', tag('g', attrs, k.faceText(b.x0 + (big ? 0.6 : 0.3), b.y1, z, R.label, big ? 'slabname' : 'slabname sm', big ? FONTS.slabname : FONTS.sm, 'left', 'start')));
    } else if (style === 'face-right') {
      s += wrap(r.id, 'name', tag('g', attrs, k.faceText(b.x1, b.y0 + 0.6, b.z0 + Math.max(0.14, (b.z1 - b.z0) * 0.2), R.label, 'slabname', FONTS.slabname, 'right', 'end')));
    } else {
      const m = shape === 'cloud' ? 'middle' : 'start';
      const x = shape === 'cloud' ? (b.x0 + b.x1) / 2 : b.x0 + 0.35, y = shape === 'cloud' ? (b.y0 + b.y1) / 2 : b.y1 - 0.35;
      s += wrap(r.id, 'name', tag('g', attrs, k.floorText(x, y, b.z1 + 0.01, R.label, 'slabname sm', 'x', m)));
    }
  }
  return s;
}

/** The walls of a walled region's cage, with a gap where its gate is. */
export function wallsOf(r: Placed): Box[] {
  const { x0, y0, x1, y1, z0, z1 } = r.box, t = WALL_T, g = r.region!.gate;
  const walls: Box[] = [];
  const W = (b: Omit<Box, 'z0' | 'z1'>) => { if (b.x1 - b.x0 > 1e-6 && b.y1 - b.y0 > 1e-6) walls.push({ ...b, z0, z1 }); };
  const span = (lo: number, hi: number, side: 'n' | 'e' | 's' | 'w') => {
    if (!g || g.side !== side) return [[lo, hi]];
    const at = g.at ?? 0.5, w = g.width ?? 2;
    const c = side === 'e' || side === 'w' ? y0 + (y1 - y0) * at : x0 + (x1 - x0) * at;
    return [[lo, c - w / 2], [c + w / 2, hi]];
  };
  for (const [a, b] of span(x0, x1, 'n')) W({ x0: a, y0, x1: b, y1: y0 + t });
  for (const [a, b] of span(y0 + t, y1 - t, 'w')) W({ x0, y0: a, x1: x0 + t, y1: b });
  for (const [a, b] of span(y0 + t, y1 - t, 'e')) W({ x0: x1 - t, y0: a, x1, y1: b });
  for (const [a, b] of span(x0, x1, 's')) W({ x0: a, y0: y1 - t, x1: b, y1 });
  return walls;
}

function nodeLabel(k: Kernel, cat: KindCatalog, p: Placed, obs: Obstacles, vis: Attrs): string {
  const n = p.node!, a = nodeKindOr(cat, n.asset), b = p.box;
  const t = { name: n.label, sub: n.sub };
  const la = n['label-at'];
  let spot: { x: number; y: number; anchor: 'start' | 'middle' | 'end' };
  if (la) {
    // the author decides: no nudging
    const sb = polyBounds(silhouette(b));
    const side = la.side ?? 'above', midY = sb.y + Math.min(sb.h, 60) * 0.45;
    if (side === 'right') spot = { x: sb.x + sb.w + 8, y: midY, anchor: 'start' };
    else if (side === 'left') spot = { x: sb.x - 8, y: midY, anchor: 'end' };
    else if (side === 'below') spot = { x: sb.x + sb.w / 2, y: sb.y + sb.h + 14, anchor: 'middle' };
    else spot = placeNodeLabel(t, b, silhouette(b), new Obstacles(), p.id);
    spot = { ...spot, x: spot.x + (la.dx ?? 0), y: spot.y + (la.dy ?? 0) };
  } else {
    const pref = a.label ? a.label(b, n, !!n.sub) : undefined;
    spot = placeNodeLabel(t, b, silhouette(b), obs, p.id, pref);
  }
  obs.rects.push({ r: labelRect(t, spot.x, spot.y, spot.anchor), owner: '' });
  let s = '';
  if (n.label) s += k.text(spot.x, spot.y, n.label, 'lbl', FONTS.lbl, spot.anchor, {}, p.id);
  if (n.sub) s += k.text(spot.x, n.label ? spot.y + 14 : spot.y, n.sub, 'sub mono', FONTS.sub, spot.anchor, {}, p.id);
  return tag('g', { 'data-id': p.id, 'data-dim': '1', ...vis }, s);
}

/** A tunnel: a translucent box with ribs across it and its name along one side, as in the reference page. */
function drawTunnel(k: Kernel, r: Placed, vis: Attrs): string {
  const { x0, y0, x1, y1, z0, z1 } = r.box;
  let s = k.blockFaces(r.box);
  const alongX = x1 - x0 >= y1 - y0, n = Math.max(1, Math.round((alongX ? x1 - x0 : y1 - y0) / 1.6));
  for (let i = 1; i < n; i++) {
    const t = alongX ? x0 + (x1 - x0) * i / n : y0 + (y1 - y0) * i / n;
    s += k.poly(alongX ? [[t, y0, z1], [t, y1, z1], [t, y1, z0]] : [[x0, t, z1], [x1, t, z1], [x1, t, z0]], 'rib');
  }
  const label = r.region!.label;
  if (label && r.region!['label-style'] !== 'none') {
    s += alongX ? k.faceText(x0 + 0.35, y1, z0 + 0.14, label, 'tunname', FONTS.tunname, 'left', 'start')
      : k.faceText(x1, y1 - 0.35, z0 + 0.18, label, 'tunname', FONTS.tunname, 'right', 'start');
  }
  return tag('g', { class: 'tunnel', 'data-id': r.id, 'data-dim': '1', ...vis }, s);
}

/**
 * A route's floor label: beside one of its level segments (the `along` one, else the longest first), on either side,
 * slid along the segment, wherever nothing drawn over the floor would hide it. If nowhere fits, the text is shortened
 * with an ellipsis; if even that fails, the label is dropped. Either way the caller gets a warning.
 */
/** label spots weighed in one scene: the busiest diagram here weighs under 200; a drawing with 80 more nodes, 79,000 */
export const LABEL_BUDGET = 20_000;

function routeLabel(k: Kernel, r: Routed, obs: Obstacles, vis: Attrs, layout: Layout): { svg: string; warning?: string } {
  const L = typeof r.raw.label === 'string' ? { text: r.raw.label } : r.raw.label!;
  const cls = `floor mono t-${r.kind}`, attrs = { 'data-hl': r.id, ...vis };
  const font = FONTS.floor;
  if (L.at) {
    const z = L.at.length > 2 ? L.at[2] : r.points[0][2];
    return { svg: k.floorText(L.at[0], L.at[1], z, L.text, cls, L.dir ?? 'x', L.anchor ?? 'start', attrs) };
  }
  const P = r.points;
  const segs: { i: number; len: number }[] = [];
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i], b = P[i + 1];
    if (Math.abs(a[2] - b[2]) > 1e-6) continue; // a step up or down
    segs.push({ i, len: Math.hypot(b[0] - a[0], b[1] - a[1]) });
  }
  if (!segs.length) return { svg: '', warning: `label "${L.text}" of route "${r.id}" was dropped: the route has no level segment` };
  const order = L.along ? segs.filter(sg => sg.i === Math.min(L.along! - 1, P.length - 2)) : [...segs].sort((a, b) => b.len - a.len);
  const GAP = 0.22, hgt = 11 / S;

  const attempt = (text: string) => {
    const w = textWidth(text, font) / S;
    let best: { x: number; y: number; z: number; dir: 'x' | 'y'; rect: Rect; poly: P2[]; hidden: number } | undefined, bestCost = Infinity;
    let rank = 0;
    // Every spot costs at least rank × 0.5, and rank only grows: once the best is no more than that, no later spot can
    // beat it, so the search stops (the same spot as searching on; on a large drawing it was most of the drawing time).
    search:
    for (const sg of order.length ? order : segs) {
      const a = P[sg.i], b = P[sg.i + 1], z = a[2];
      const alongX = Math.abs(a[1] - b[1]) < 1e-6;
      const lo = alongX ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]), hi = alongX ? Math.max(a[0], b[0]) : Math.max(a[1], b[1]);
      const line = alongX ? a[1] : a[0];
      const sides = L.side === 'left' ? [-1] : L.side === 'right' ? [1] : [-1, 1];
      // slide the text along the segment; it may run past the segment's end if the floor there is clear
      const starts: number[] = [];
      for (let t = lo + 0.3; t <= Math.max(lo + 0.3, hi - w - 0.2) + 1e-9; t += 0.4) starts.push(t);
      for (let t = hi - w - 0.2 + 0.4; t < hi + 0.5 && hi - lo < w + 0.5; t += 0.6) starts.push(t);
      for (const sd of sides) for (const st of starts) {
        if (bestCost <= rank * 0.5) break search;
        // glyphs rise toward −y (dir x) or −x (dir y) from the baseline
        const base = sd < 0 ? line - GAP : line + GAP + hgt;
        let x: number, y: number, poly: P2[];
        if (alongX) { x = st; y = base; poly = [iso(x, y - hgt, z), iso(x + w, y - hgt, z), iso(x + w, y, z), iso(x, y, z)]; }
        else { x = base; y = st + w; poly = [iso(x - hgt, y, z), iso(x - hgt, y - w, z), iso(x, y - w, z), iso(x, y, z)]; }
        // the text must lie on this segment's floor: every corner over the same surface
        const corners = alongX ? [[x, y - hgt], [x + w, y - hgt], [x + w, y], [x, y]] : [[x - hgt, y], [x - hgt, y - w], [x, y - w], [x, y]];
        if (corners.some(([u, v]) => Math.abs(floorAt(layout, u, v) + 0.01 - z) > 1e-3)) { rank++; continue; }
        const hidden = obs.hiddenPoly(poly);
        // what is known already can't beat the best: skip the rest of the cost (it only adds). Past the scene's budget
        // of spots, what other labels and lines cover isn't weighed: the first spot nothing hides wins.
        const known = hidden * 50 + rank * 0.5;
        const weigh = obs.budget.spots-- > 0;
        if (!weigh) obs.budget.over = true;
        const cost = known >= bestCost ? Infinity : weigh ? known + obs.costPoly(poly, bestCost - known) : known;
        rank++;
        if (cost < bestCost) { bestCost = cost; best = { x, y, z, dir: alongX ? 'x' : 'y', rect: polyBounds(poly), poly, hidden }; }
      }
    }
    return best && best.hidden < 6 ? best : undefined;
  };

  let text = L.text, spot = attempt(text), warning: string | undefined;
  if (!spot) {
    const words = L.text.split(/(\s+)/);
    for (let n = words.length - 1; n > 0 && !spot; n--) {
      const t = words.slice(0, n).join('').trimEnd().replace(/[\s,;:·–-]+$/, '') + '…';
      if (t.length < 6) break;
      const sp = attempt(t);
      if (sp) { spot = sp; text = t; }
    }
    warning = spot ? `label of route "${r.id}" shortened to "${text}": no clear floor for the whole text`
      : `label "${L.text}" of route "${r.id}" was dropped: blocks cover every spot beside it`;
    if (spot) warning += '; give it "along", "side" or "at", or move the nodes apart';
    else warning += '; give it "at: [x, y]", or move the nodes apart';
  }
  if (!spot) return { svg: '', warning };
  obs.slants.push(spot.poly);
  return { svg: k.floorText(spot.x, spot.y, spot.z + 0.01, text, cls, spot.dir, 'start', attrs), warning };
}

const shrink = (r: Rect, d: number): Rect => ({ x: r.x + d, y: r.y + d, w: Math.max(0, r.w - 2 * d), h: Math.max(0, r.h - 2 * d) });

function drawNote(k: Kernel, note: RawNote, layout: Layout, routes: Routed[], id: string): string {
  const route = note.on ? routes.find(r => r.id === note.on) : undefined;
  const on = note.on && !route ? layout.byId.get(note.on) : undefined;
  const at = note.at;
  const attrs = { 'data-id': id, 'data-hl': route?.id, 'data-dim': route ? undefined : '1' };
  const kind = note.kind ?? route?.kind ?? 'control';
  if (note.floor) {
    const z = at && at.length > 2 ? at[2] : route ? route.points[0][2] : on ? on.floor : 0.36;
    const [x, y] = at ? [at[0], at[1]] : route ? [route.points[0][0] + 0.35, route.points[0][1] - 0.25] : on ? [on.box.x0 + 0.3, on.box.y1 - 0.3] : [0, 0];
    return k.floorText(x, y, z + 0.01, note.floor, `floor mono t-${kind}`, note.dir ?? 'x', note.anchor ?? 'start', attrs);
  }
  if (note.face) {
    const b = on?.box;
    const [x, y, z] = at ? [at[0], at[1], at[2] ?? 0.45] : b ? [b.x0 + 0.3, b.y1, b.z0 + 0.13] : [0, 0, 0];
    return k.faceText(x, y, z, note.face, 'slabname sm', FONTS.sm, 'left', note.anchor ?? 'start', attrs);
  }
  if (note.label || note.sub) {
    const b = on?.box;
    const p3 = at ? [at[0], at[1], at[2] ?? 0.36] : b ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z1 + 0.75] : [0, 0, 0];
    const [X, Y] = iso(p3[0], p3[1], p3[2]);
    const x = X + (note.dx ?? 0), y = Y - 18 + (note.dy ?? 0), anchor = note.anchor ?? 'middle';
    let s = '';
    if (note.label) s += k.text(x, y, note.label, 'lbl', FONTS.lbl, anchor);
    if (note.sub) s += k.text(x, note.label ? y + 14 : y, note.sub, 'sub mono', FONTS.sub, anchor);
    return tag('g', attrs, s);
  }
  return '';
}
