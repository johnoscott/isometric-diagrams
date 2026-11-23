// The overlay's painters (docs/editor/LAYERS.md §2): state drawn over a scene's objects, keyed by what each is drawn
// over. A domain says what to draw (marks: an outline, a badge, a dot, a tag; ghosts: things not in the drawing; cards:
// a thick card standing over what it is about, with a stack behind it); these make the elements. Shared by an
// interactive view (drawn into its DOM, measured there) and a still render (drawn into a small virtual document,
// measured from the layout), so the two never differ. The painters only make elements, with createElementNS,
// setAttribute, append, textContent and style, the subset the virtual document (src/iso-core/vdom.ts) has.

import { C, S } from '../iso-core/kernel.ts';
import { overlaps } from '../iso-objects/geometry.ts';

const SVGNS = 'http://www.w3.org/2000/svg';
export type Box = { x: number; y: number; w: number; h: number };
export type Outline = { kind: 'poly'; id: string; points: [number, number][] } | { kind: 'route'; d: string };
/** a box in grid cells */
export type Box3 = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
/** a card's model: its middle, the tail's tip (z), the card's box and its stack's boxes */
export interface CardGeo { cx: number; cy: number; tipZ: number; card: Box3; panes: Box3[] }

/** a badge: a character, or an icon (by name), in a small circle; cls: its tone */
export type Glyph = { g: string; cls: string } | { icon: string; cls: string };

/** what is drawn over one object, in this order: its outline, its badge (or, with none, a hit area for its title),
 *  badges beside it, a dot at its bottom left and a tag at its bottom right */
export interface Mark {
  /** what it is drawn over (the host's boxOf and outlinesFor know it) */
  at: string;
  title: string;
  /** the class of its outline: an outline is drawn when it has one */
  outline?: string;
  badge?: Glyph;
  /** no badge: a transparent rect over it, holding its title */
  hit?: boolean;
  /** badges beside the first, each a badge's width further right */
  beside?: { glyph: Glyph; title: string }[];
  dot?: { glyph: Glyph; title: string };
  tag?: { cls: string; text: string };
}

/** a thing that isn't in the drawing, drawn as a ghost where the domain puts it */
export interface Ghost {
  rect: { x: number; y: number; w: number; hgt: number; k: number };
  /** classes beside the ghost's own */
  cls: string;
  /** attributes on its group (data-*) */
  data: [string, string][];
  line1: string; line2: string; title: string;
}

/** a card standing over what it is about */
export interface Card {
  /** the box (grid cells) it stands over */
  over: { x0: number; y0: number; x1: number; y1: number; z1: number };
  /** classes beside the card's own */
  cls: string;
  /** attributes on its group (data-*) */
  data: [string, string][];
  /** the big mark on its face, who it is from, how old it is, and (shown near) one line of its text */
  mark: string; who: string; age: string; line?: string;
  /** how many it stands for: more than one, a stack behind it (up to three) and the count on it */
  count: number;
  title: string;
}

export interface OverlayCtx {
  /** pixels per unit of the drawing (badges keep their size on screen) */
  k(): number;
  /** an object's box on screen (the view measures its elements; a still render, its layout) */
  boxOf(at: string): Box | undefined;
  outlinesFor(at: string): Outline[];
  /** an icon's reference (the view's sprite, or the still render's own symbols) */
  iconHref(name: string): string;
  /** a card drawn, with its geometry in grid cells (a view turns it in 3D) */
  onCard?(card: Element, geo: CardGeo): void;
}

/** the card's size in grid cells (large: the first thing the eye finds), its height above what it stands over, the
 *  stack's fan (up and right per card) and the gap between its cards (back to front) */
export const CARD = { half: 2.4, h: 3.2, t: 0.25, above: 1.4, lift: 3.8, fan: 0.32, gap: 0.3 };
export const P3 = (x: number, y: number, z: number) => [(x - y) * C * S, (x + y) * 0.5 * S - z * S] as [number, number];
export const pts = (ps: [number, number][]) => ps.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

/** The painters. cards: the class prefix the domain's cards are drawn and styled with (PREFIX-card, PREFIX-face…). */
export function overlayPaint(ctx: OverlayCtx, cards: string) {
  function paintMarks(d: Document, put: (n: Element) => void, marks: Mark[]) {
    const k = ctx.k();
    const glyph = (x: number, y: number, spec: Glyph, title: string, extra = '') => {
      const g = d.createElementNS(SVGNS, 'g');
      g.setAttribute('class', `live-badge ${spec.cls} ${extra}`.trim());
      const rr = 8 / k;
      const c = d.createElementNS(SVGNS, 'circle'); c.setAttribute('cx', String(x)); c.setAttribute('cy', String(y)); c.setAttribute('r', String(rr));
      g.append(c);
      if ('g' in spec) {
        const t = d.createElementNS(SVGNS, 'text'); t.setAttribute('x', String(x)); t.setAttribute('y', String(y)); t.style.fontSize = `${(10 / k).toFixed(2)}px`; t.textContent = spec.g; g.append(t);
      } else {
        const u = d.createElementNS(SVGNS, 'use'); u.setAttribute('href', ctx.iconHref(spec.icon)); const s = 11 / k;
        u.setAttribute('x', String(x - s / 2)); u.setAttribute('y', String(y - s / 2)); u.setAttribute('width', String(s)); u.setAttribute('height', String(s)); g.append(u);
      }
      const tt = d.createElementNS(SVGNS, 'title'); tt.textContent = title; g.append(tt);
      put(g);
    };
    const outline = (at: string, cls: string) => {
      for (const sh of ctx.outlinesFor(at)) {
        if (sh.kind !== 'poly') continue;
        const p = d.createElementNS(SVGNS, 'polygon');
        p.setAttribute('class', cls);
        p.setAttribute('points', sh.points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
        put(p);
      }
    };
    for (const m of marks) {
      const b = ctx.boxOf(m.at);
      if (!b) continue;
      if (m.outline) outline(m.at, m.outline);
      if (m.badge) glyph(b.x, b.y, m.badge, m.title);
      else if (m.hit) { const t = d.createElementNS(SVGNS, 'title'); t.textContent = m.title; const hit = d.createElementNS(SVGNS, 'rect'); hit.setAttribute('class', 'live-hit'); hit.setAttribute('x', String(b.x)); hit.setAttribute('y', String(b.y)); hit.setAttribute('width', String(b.w)); hit.setAttribute('height', String(b.h)); hit.append(t); put(hit); }
      (m.beside ?? []).forEach((x, i) => glyph(b.x + (18 * (i + 1)) / k, b.y, x.glyph, x.title));
      if (m.dot) glyph(b.x, b.y + b.h, m.dot.glyph, m.dot.title);
      if (m.tag) {
        const t = d.createElementNS(SVGNS, 'text');
        t.setAttribute('class', `live-life ${m.tag.cls}`); t.setAttribute('x', String(b.x + b.w)); t.setAttribute('y', String(b.y + b.h));
        t.style.fontSize = `${(9 / k).toFixed(2)}px`; t.textContent = m.tag.text;
        put(t);
      }
    }
  }

  function paintGhosts(d: Document, put: (n: Element) => void, ghosts: Ghost[]) {
    for (const gh of ghosts) {
      const g = d.createElementNS(SVGNS, 'g');
      g.setAttribute('class', `live-extra${gh.cls}`);
      for (const [a, v] of gh.data) g.setAttribute(a, v);
      const { x, y, w, hgt, k } = gh.rect;
      const r = d.createElementNS(SVGNS, 'rect');
      r.setAttribute('x', String(x)); r.setAttribute('y', String(y)); r.setAttribute('width', String(w)); r.setAttribute('height', String(hgt)); r.setAttribute('rx', String(6 / k));
      const t1 = d.createElementNS(SVGNS, 'text'); t1.setAttribute('x', String(x + 8 / k)); t1.setAttribute('y', String(y + 13 / k)); t1.style.fontSize = `${(11 / k).toFixed(2)}px`; t1.textContent = gh.line1;
      const t2 = d.createElementNS(SVGNS, 'text'); t2.setAttribute('class', 'sub'); t2.setAttribute('x', String(x + 8 / k)); t2.setAttribute('y', String(y + 27 / k)); t2.style.fontSize = `${(9 / k).toFixed(2)}px`; t2.textContent = gh.line2;
      const tt = d.createElementNS(SVGNS, 'title'); tt.textContent = gh.title;
      g.append(r, t1, t2, tt);
      put(g);
    }
  }

  /** each card over its box, lifted until it overlaps no card already placed; drawn back to front */
  function paintCards(d: Document, put: (n: Element) => void, list: Card[]) {
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const cd of list) {
      const b = cd.over, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      let lift = 0, bbox = { x0: 0, y0: 0, x1: 0, y1: 0 };
      for (let tries = 0; tries < 6; tries++) {
        const z0 = b.z1 + CARD.above + lift, z1 = z0 + CARD.h;
        const corners = [P3(cx - CARD.half, cy + CARD.t, z0), P3(cx + CARD.half, cy + CARD.t, z0), P3(cx + CARD.half, cy - CARD.t, z1), P3(cx - CARD.half, cy + CARD.t, z1)];
        bbox = { x0: Math.min(...corners.map(p => p[0])), y0: Math.min(...corners.map(p => p[1])), x1: Math.max(...corners.map(p => p[0])), y1: Math.max(...corners.map(p => p[1])) };
        if (!overlaps(bbox, placed)) break;
        lift += CARD.lift;
      }
      placed.push(bbox);
      const z0 = b.z1 + CARD.above + lift, z1 = z0 + CARD.h, x0 = cx - CARD.half, x1 = cx + CARD.half, yf = cy + CARD.t, yb = cy - CARD.t;
      const g = d.createElementNS(SVGNS, 'g');
      g.setAttribute('class', `${cards}-card${cd.cls}`);
      for (const [a, v] of cd.data) g.setAttribute(a, v);
      // it grows out of what it stands over: every motion's origin is the tail's tip
      const [tipX, tipY] = P3(cx, cy, b.z1 + 0.15);
      const origin = `${tipX.toFixed(1)}px ${tipY.toFixed(1)}px`;
      g.style.transformOrigin = origin;
      const float = d.createElementNS(SVGNS, 'g');
      float.setAttribute('class', `${cards}-float`);
      float.style.transformOrigin = origin;
      const panes: Box3[] = [];
      // the stack behind it: one card per further one, each as thick as the front one (its front, top and side), behind
      // the card's back face by a constant pitch and fanned up and right by the same step, so the gaps read equal.
      // Drawn back to front.
      for (let i = Math.min(cd.count - 1, 3); i >= 1; i--) {
        const o = i * CARD.fan, pf = yb - (i - 1) * (2 * CARD.t + CARD.gap) - CARD.gap, pb = pf - 2 * CARD.t;
        const a0 = x0 + o, a1 = x1 + o, h0 = z0 + o, h1 = z1 + o;
        const pane = (cls: string, ps: [number, number][]) => { const f = d.createElementNS(SVGNS, 'polygon'); f.setAttribute('class', `${cards}-face stacked ${cls}`); f.setAttribute('points', pts(ps)); float.append(f); };
        pane('s-top', [P3(a0, pb, h1), P3(a1, pb, h1), P3(a1, pf, h1), P3(a0, pf, h1)]);
        pane('s-side', [P3(a1, pb, h0), P3(a1, pf, h0), P3(a1, pf, h1), P3(a1, pb, h1)]);
        pane('s-front', [P3(a0, pf, h0), P3(a1, pf, h0), P3(a1, pf, h1), P3(a0, pf, h1)]);
        panes.push({ x0: a0, x1: a1, y0: pb, y1: pf, z0: h0, z1: h1 });
      }
      // the tail, down to what it stands over
      const tail = d.createElementNS(SVGNS, 'polygon');
      tail.setAttribute('class', `${cards}-tail`);
      tail.setAttribute('points', pts([P3(cx - 0.5, yf, z0 + 0.05), P3(cx + 0.5, yf, z0 + 0.05), P3(cx, cy, b.z1 + 0.15)]));
      // the card: its top, its side, its face
      const face = (cls: string, ps: [number, number][]) => { const f = d.createElementNS(SVGNS, 'polygon'); f.setAttribute('class', cls); f.setAttribute('points', pts(ps)); return f; };
      const front = face(`${cards}-face front`, [P3(x0, yf, z0), P3(x1, yf, z0), P3(x1, yf, z1), P3(x0, yf, z1)]);
      float.append(tail,
        face(`${cards}-face top`, [P3(x0, yb, z1), P3(x1, yb, z1), P3(x1, yf, z1), P3(x0, yf, z1)]),
        face(`${cards}-face side`, [P3(x1, yb, z0), P3(x1, yf, z0), P3(x1, yf, z1), P3(x1, yb, z1)]),
        front);
      // what the face says, on the face (its plane: x along the card, down the card's height)
      const [ox, oy] = P3(x0, yf, z1), U = 40;
      const txt = d.createElementNS(SVGNS, 'g');
      txt.setAttribute('transform', `matrix(${(C * S / U).toFixed(4)} ${(0.5 * S / U).toFixed(4)} 0 ${(S / U).toFixed(4)} ${ox.toFixed(1)} ${oy.toFixed(1)})`);
      const t = (cls: string, x: number, y: number, text: string) => { const e = d.createElementNS(SVGNS, 'text'); e.setAttribute('class', cls); e.setAttribute('x', String(x)); e.setAttribute('y', String(y)); e.textContent = text; return e; };
      // the face is 192 × 128 of these units (40 a cell): the mark fills its left, who and the age beside it
      txt.append(t(`${cards}-mark`, 34, 98, cd.mark), t(`${cards}-who`, 70, 52, cd.who), t(`${cards}-age`, 70, 82, cd.age));
      if (cd.line !== undefined) txt.append(t(`${cards}-q`, 12, 118, cd.line));
      if (cd.count > 1) { const c = d.createElementNS(SVGNS, 'circle'); c.setAttribute('class', `${cards}-count-bg`); c.setAttribute('cx', '178'); c.setAttribute('cy', '14'); c.setAttribute('r', '15'); txt.append(c, t(`${cards}-count`, 178, 14, String(cd.count))); }
      float.append(txt);
      const title = d.createElementNS(SVGNS, 'title');
      title.textContent = cd.title;
      g.append(float, title);
      ctx.onCard?.(g, { cx, cy, tipZ: b.z1 + 0.15, card: { x0, x1, y0: yb, y1: yf, z0, z1 }, panes: panes.reverse() });
      put(g);
    }
  }

  return { paintMarks, paintGhosts, paintCards };
}
export type OverlayPaint = ReturnType<typeof overlayPaint>;
