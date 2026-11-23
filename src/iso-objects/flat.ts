// The 2D view's layout (0.6.0): a board (cards on a grid of cells, panels over cell ranges, links between them) laid
// out flat, as its own layout rather than a projection of the 3D one. Pure: no DOM; text is measured by the caller
// (the browser measures rendered text, Node uses L0's font metrics), so a layout is the same every time it is made.
//
// The rules, as settled for the 2D view:
//   - a card is one rounded rect (W × H); a panel is a rounded area with PAD on every side and a TITLE strip at its
//     bottom left;
//   - the gap between cards inside a panel is GX × GY; between two different containers there is a free channel CH;
//     the extra at a column (row) boundary is the largest any row (column) needs there: CH, plus the PAD (and, below a
//     panel, its TITLE) of every panel exited or entered there. With one level of panels that is exactly CH + PAD
//     (+ PAD) - GX;
//   - a card is placed by its innermost panel: evenly, between that panel's first and last column (row), so a panel
//     that spans a channel boundary keeps its cards evenly apart;
//   - links are orthogonal, card edge to card edge, never through a card or a panel's title: the cheapest of straight,
//     L, Z (VHV, HVH) and four-bend candidates through lanes at gap midpoints (±12, ±24) and the outer margins, ports
//     ±22/±44 off centre; cost = length + 70 a bend + 400 an overlap with a drawn line + 300 a crossing of a panel that
//     holds neither end + 120 a panel border crossed + 200 running within 16px of a panel edge;
//   - an end may be a panel; a link from something to a panel that holds it ends on that panel's inner border;
//   - a link's label goes beside its longest segment (then the others), clear of cards, titles, labels, lines and
//     panel borders; if no spot is clear, the least bad one.
// Ties go to the first candidate in a fixed order (link order, then the candidate order below), so a layout is
// reproducible to the byte.

import { textWidth, type Font } from '../iso-core/kernel.ts';

/** a card: one thing, at a cell of the grid ([column, row]) */
export interface BoardCard { id: string; label: string; sub?: string; role?: string; ghost?: boolean; cell: [number, number] }
/** a panel: a container over a range of cells, [c0, r0, c1, r1] inclusive; panels nest by containment */
export interface BoardPanel { id: string; label?: string; sub?: string; role?: string; cells: [number, number, number, number] }
/** a link between two cards or panels; aOn / bOn: draw that end to a panel (one holding it, or any) instead */
export interface BoardLink { id?: string; a: string; b: string; kind?: string; label?: string; aOn?: string; bOn?: string }
/** the scene description both views are drawn from */
export interface Board { cards: BoardCard[]; panels?: BoardPanel[]; links?: BoardLink[] }

export interface FlatRect { l: number; t: number; r: number; b: number }
export type FlatPoint = [number, number];
/** the fonts a 2D layout measures: a card's name and sub, a panel's title and its subtitle, a link's label */
export type FlatFont = 'name' | 'sub' | 'title' | 'titleSub' | 'label';
export type Measure = (text: string, font: FlatFont) => number;

export interface FlatOptions {
  W: number; H: number; GX: number; GY: number; PAD: number; TITLE: number; CH: number;
  /** card and panel corner radii */
  cardRx: number; panelRx: number;
  /** the cost model */
  bend: number; overlap: number; crossPanel: number; border: number; nearEdge: number;
  /** the margin round the drawing */
  margin: number;
  /** wrap a drawing wider than this (width / height) onto further shelves (wrapBoard); off by default */
  wrap?: { aspect: number };
}
export const FLAT_DEFAULTS: Readonly<FlatOptions> = Object.freeze({
  W: 178, H: 58, GX: 44, GY: 44, PAD: 22, TITLE: 30, CH: 96, cardRx: 9, panelRx: 14,
  bend: 70, overlap: 400, crossPanel: 300, border: 120, nearEdge: 200, margin: 16,
});

export interface FlatCard extends BoardCard { rect: FlatRect }
export interface FlatPanel extends BoardPanel {
  rect: FlatRect;
  /** the title strip's box (what a link may not cross) */
  title: FlatRect;
  /** the title's baseline */
  titleAt: FlatPoint;
  /** the panel it sits in, if any */
  parent?: string;
  depth: number;
}
export interface FlatLabel { x: number; y: number; anchor: 'start' | 'middle' | 'end'; box: FlatRect; text: string }
export interface FlatLink extends BoardLink { id: string; points: FlatPoint[]; at?: FlatLabel; routed: boolean }
export interface FlatLayout {
  cards: FlatCard[]; panels: FlatPanel[]; links: FlatLink[];
  /** everything drawn, with the margin */
  bounds: FlatRect;
  options: FlatOptions;
  /** warnings: a link with no clear route (drawn the least bad way) */
  warnings: string[];
}

/** the 2D view's fonts (its stylesheet's: src/iso-viewer/flat-view.ts), as L0's measured metrics have them */
export const FLAT_FONTS: Record<FlatFont, Font> = {
  name: { key: 'sans600_12', size: 13 },
  sub: { key: 'sans400_13', size: 10 },
  title: { key: 'sans700_13', size: 12, spacing: 0.02 },
  titleSub: { key: 'sans400_13', size: 10.5 },
  label: { key: 'sans600_12', size: 10.5 },
};
/** text measured with L0's font metrics: the same in Node and every browser (stills and tests); a page measures its
 *  rendered text instead (flat-view.ts: measureIn) */
export const metricsMeasure: Measure = (text, font) => textWidth(text, FLAT_FONTS[font]);

/** what is wrong with a board, as messages; layoutFlat refuses a board with any */
export function boardErrors(board: Board): string[] {
  const out: string[] = [], seen = new Map<string, string>();
  const name = (what: string, id: unknown) => {
    if (typeof id !== 'string' || !id) { out.push(`${what} has no id`); return; }
    const was = seen.get(id);
    if (was) out.push(`duplicate id "${id}": a ${was} and a ${what} (cards and panels share one set of ids)`);
    else seen.set(id, what);
  };
  for (const c of board.cards) {
    name('card', c.id);
    if (!Array.isArray(c.cell) || c.cell.length !== 2 || !c.cell.every(v => Number.isInteger(v) && v >= 0)) out.push(`card "${c.id}": cell must be [column, row], whole numbers from 0`);
  }
  for (const p of board.panels ?? []) {
    name('panel', p.id);
    const k = p.cells;
    if (!Array.isArray(k) || k.length !== 4 || !k.every(v => Number.isInteger(v) && v >= 0) || k[2] < k[0] || k[3] < k[1]) out.push(`panel "${p.id}": cells must be [c0, r0, c1, r1] with c0 ≤ c1 and r0 ≤ r1`);
  }
  const cells = new Map<string, string>();
  for (const c of board.cards) {
    const key = String(c.cell);
    if (cells.has(key)) out.push(`cards "${cells.get(key)}" and "${c.id}" are both at cell [${key}]`);
    else cells.set(key, c.id);
  }
  const P = (board.panels ?? []).filter(p => Array.isArray(p.cells) && p.cells.length === 4);
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const a = P[i].cells, b = P[j].cells;
    const meet = a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
    if (meet && !within(a, b) && !within(b, a)) out.push(`panels "${P[i].id}" and "${P[j].id}" overlap without one holding the other`);
  }
  const ends = new Set([...board.cards.map(c => c.id), ...P.map(p => p.id)]), panelIds = new Set(P.map(p => p.id));
  (board.links ?? []).forEach((l, i) => {
    const who = `link ${l.id ? `"${l.id}"` : i}`;
    for (const k of ['a', 'b'] as const) if (!ends.has(l[k])) out.push(`${who}: ${k} "${l[k]}" is no card or panel`);
    for (const k of ['aOn', 'bOn'] as const) if (l[k] !== undefined && !panelIds.has(l[k]!)) out.push(`${who}: ${k} "${l[k]}" is no panel`);
    if (l.id !== undefined) name('link', l.id);
  });
  return out;
}

/** b holds a (cell ranges) */
const within = (a: number[], b: number[]) => a[0] >= b[0] && a[2] <= b[2] && a[1] >= b[1] && a[3] <= b[3];

/** where a board's cards and panels go on a grid with the given sizes and gaps (the 2D layout's, in px; the 3D
 *  drawing's, in grid units): each card's top-left corner, each panel's rect, and how the panels nest */
export function placeBoard(board: Board, o: Pick<FlatOptions, 'W' | 'H' | 'GX' | 'GY' | 'PAD' | 'TITLE' | 'CH'>) {
  const { W, H, GX, GY, PAD, TITLE, CH } = o;
  const PL = board.panels ?? [];
  // ---- containment: each panel's parent (the smallest other panel holding it; of equal ranges, the earlier holds) ----
  const area = (k: number[]) => (k[2] - k[0] + 1) * (k[3] - k[1] + 1);
  const holds = (outer: number, inner: number) => {
    const a = PL[outer].cells, b = PL[inner].cells;
    if (!within(b, a)) return false;
    return area(a) > area(b) || outer < inner;
  };
  const parentIx = PL.map((_, i) => {
    let best = -1;
    PL.forEach((_, j) => { if (j !== i && holds(j, i) && (best < 0 || holds(best, j))) best = j; });
    return best;
  });
  const depthOf = (i: number): number => (parentIx[i] < 0 ? 0 : 1 + depthOf(parentIx[i]));
  /** the panels holding a cell, outermost first */
  const chainOf = (i: number, j: number): number[] => {
    let inner = -1;
    PL.forEach((p, n) => {
      const k = p.cells;
      if (i >= k[0] && i <= k[2] && j >= k[1] && j <= k[3] && (inner < 0 || holds(inner, n))) inner = n;
    });
    const c: number[] = [];
    for (let n = inner; n >= 0; n = parentIx[n]) c.unshift(n);
    return c;
  };

  // ---- the grid: columns and rows, with the extra at each boundary ----
  const NI = Math.max(1, ...board.cards.map(c => c.cell[0] + 1), ...PL.map(p => p.cells[2] + 1));
  const NJ = Math.max(1, ...board.cards.map(c => c.cell[1] + 1), ...PL.map(p => p.cells[3] + 1));
  const chains: number[][][] = [];
  for (let i = 0; i < NI; i++) { chains.push([]); for (let j = 0; j < NJ; j++) chains[i].push(chainOf(i, j)); }
  const boundary = (A: number[], B: number[], below: boolean): number => {
    const out = A.filter(n => !B.includes(n)), into = B.filter(n => !A.includes(n));
    if (!out.length && !into.length) return 0;
    return out.length * (PAD + (below ? TITLE : 0)) + into.length * PAD + CH;
  };
  const exX = new Array(NI + 1).fill(0), exY = new Array(NJ + 1).fill(0);
  for (let j = 0; j < NJ; j++) for (let i = 1; i < NI; i++) {
    const need = boundary(chains[i - 1][j], chains[i][j], false);
    if (need) exX[i] = Math.max(exX[i], need - GX);
  }
  for (let i = 0; i < NI; i++) for (let j = 1; j < NJ; j++) {
    const need = boundary(chains[i][j - 1], chains[i][j], true);
    if (need) exY[j] = Math.max(exY[j], need - GY);
  }
  const bx = (i: number) => { let v = i * (W + GX); for (let k = 1; k <= i; k++) v += exX[k]; return v; };
  const by = (j: number) => { let v = j * (H + GY); for (let k = 1; k <= j; k++) v += exY[k]; return v; };
  const lerp = (f0: (n: number) => number, i0: number, i1: number, i: number) => (i1 === i0 ? f0(i0) : f0(i0) + (i - i0) * (f0(i1) - f0(i0)) / (i1 - i0));
  // ---- a panel's rows: its own, compact. The rows a panel uses are its range's first and last and every row its
  // cards and inner panels use; each is the gap below the one before (GY, or more where something inside the panel
  // ends or starts there) further down, from where its parent has its first row. Rows only another panel needs (a
  // tall neighbour's) open no gap inside it. With one level of panels and every row used, this is where the even
  // spacing between the global rows puts them. ----
  const rowsOf = PL.map(() => new Set<number>());
  const addRow = (n: number, j: number) => { for (let m = n; m >= 0; m = parentIx[m]) rowsOf[m].add(j); };
  PL.forEach((p, n) => { addRow(n, p.cells[1]); addRow(n, p.cells[3]); });
  for (const c of board.cards) { const ch = chains[c.cell[0]][c.cell[1]]; if (ch.length) addRow(ch[ch.length - 1], c.cell[1]); }
  const rowY = PL.map(() => new Map<number, number>());
  const below = (chain: number[], n: number) => chain.slice(chain.indexOf(n) + 1);
  for (const n of PL.map((_, i) => i).sort((a, b) => depthOf(a) - depthOf(b) || a - b)) {
    const k = PL[n].cells, rows = [...rowsOf[n]].sort((a, b) => a - b);
    let y = parentIx[n] >= 0 ? rowY[parentIx[n]].get(rows[0])! : by(rows[0]);
    rowY[n].set(rows[0], y);
    for (let r = 1; r < rows.length; r++) {
      let need = 0;
      for (let i = k[0]; i <= k[2]; i++) need = Math.max(need, boundary(below(chains[i][rows[r - 1]], n), below(chains[i][rows[r]], n), true));
      y += H + Math.max(GY, need);
      rowY[n].set(rows[r], y);
    }
  }
  // ---- a panel's columns, the same way: its own, packed (one gap, or what a boundary inside it needs), from where its
  // parent has its first column. A top-level panel of cards only that uses every column of its range keeps decision 4's
  // even spread between its first and last column of the drawing's (so a panel spanning a channel stays even). ----
  const colsOf = PL.map(() => new Set<number>());
  const addCol = (n: number, i: number) => { for (let m = n; m >= 0; m = parentIx[m]) colsOf[m].add(i); };
  PL.forEach((p, n) => { addCol(n, p.cells[0]); addCol(n, p.cells[2]); });
  for (const c of board.cards) { const ch = chains[c.cell[0]][c.cell[1]]; if (ch.length) addCol(ch[ch.length - 1], c.cell[0]); }
  const colX = PL.map(() => new Map<number, number>());
  for (const n of PL.map((_, i) => i).sort((a, b) => depthOf(a) - depthOf(b) || a - b)) {
    const k = PL[n].cells, cols = [...colsOf[n]].sort((a, b) => a - b);
    if (parentIx[n] < 0 && !parentIx.includes(n) && cols.length === k[2] - k[0] + 1) { for (const i of cols) colX[n].set(i, lerp(bx, k[0], k[2], i)); continue; }
    let x = parentIx[n] >= 0 ? colX[parentIx[n]].get(cols[0])! : bx(cols[0]);
    colX[n].set(cols[0], x);
    for (let c = 1; c < cols.length; c++) {
      let need = 0;
      for (let j = k[1]; j <= k[3]; j++) need = Math.max(need, boundary(below(chains[cols[c - 1]][j], n), below(chains[cols[c]][j], n), false));
      x += W + Math.max(GX, need);
      colX[n].set(cols[c], x);
    }
  }
  const pos = (i: number, j: number): FlatPoint => {
    const c = chains[i][j], n = c.length ? c[c.length - 1] : -1;
    return n >= 0 ? [colX[n].get(i)!, rowY[n].get(j)!] : [bx(i), by(j)];
  };

  // ---- panels, innermost first (a panel holds its own cards and its children's rects, PAD round, TITLE below) ----
  const order = PL.map((_, i) => i).sort((a, b) => depthOf(b) - depthOf(a) || a - b);
  const prect: FlatRect[] = new Array(PL.length);
  for (const n of order) {
    const k = PL[n].cells;
    // across: its range; down: its own cards (and any end row of its range nothing uses), and its inner panels
    const xs: number[] = [], ys: number[] = [];
    for (const c of board.cards) { const ch = chains[c.cell[0]][c.cell[1]]; if (ch[ch.length - 1] === n) { xs.push(colX[n].get(c.cell[0])!); ys.push(rowY[n].get(c.cell[1])!); } }
    const inRange = (c: BoardCard) => c.cell[0] >= k[0] && c.cell[0] <= k[2] && c.cell[1] >= k[1] && c.cell[1] <= k[3];
    for (const j of [k[1], k[3]]) if (!board.cards.some(c => c.cell[1] === j && inRange(c))) ys.push(rowY[n].get(j)!);
    for (const i of [k[0], k[2]]) if (!board.cards.some(c => c.cell[0] === i && inRange(c))) xs.push(colX[n].get(i)!);
    const box = { l: xs.length ? Math.min(...xs) : Infinity, t: ys.length ? Math.min(...ys) : Infinity, r: xs.length ? Math.max(...xs) + W : -Infinity, b: ys.length ? Math.max(...ys) + H : -Infinity };
    PL.forEach((_, m) => {
      if (parentIx[m] !== n) return;
      const c = prect[m];
      box.l = Math.min(box.l, c.l); box.t = Math.min(box.t, c.t); box.r = Math.max(box.r, c.r); box.b = Math.max(box.b, c.b);
    });
    prect[n] = { l: box.l - PAD, t: box.t - PAD, r: box.r + PAD, b: box.b + PAD + TITLE };
  }
  // ---- then each panel's contents slid left as far as they may go, innermost first: a card GX from a card beside it, a
  // channel between a container and what stands beside it. Positions by columns are where a column could be; a panel
  // that packed narrower than its column says would leave a band of nothing beside it. Not inside a top-level panel
  // of cards only (decision 4 spreads those) or at the drawing's own level. ----
  const at = board.cards.map(c => pos(c.cell[0], c.cell[1]));
  const innerOf = board.cards.map(c => { const ch = chains[c.cell[0]][c.cell[1]]; return ch.length ? ch[ch.length - 1] : -1; });
  const inside = (m: number, n: number) => { for (let a = m; a >= 0; a = parentIx[a]) if (a === n) return true; return false; };
  const shift = (m: number, dx: number) => {
    board.cards.forEach((_, i) => { if (innerOf[i] >= 0 && inside(innerOf[i], m)) at[i] = [at[i][0] + dx, at[i][1]]; });
    PL.forEach((_, q) => { if (inside(q, m)) prect[q] = { ...prect[q], l: prect[q].l + dx, r: prect[q].r + dx }; });
  };
  const fit = (n: number) => {
    const xs: number[] = [], ys: number[] = [], xr: number[] = [], yb: number[] = [];
    board.cards.forEach((_, i) => { if (innerOf[i] === n) { xs.push(at[i][0]); xr.push(at[i][0] + W); ys.push(at[i][1]); yb.push(at[i][1] + H); } });
    PL.forEach((_, m) => { if (parentIx[m] === n) { xs.push(prect[m].l); xr.push(prect[m].r); ys.push(prect[m].t); yb.push(prect[m].b); } });
    // a range end nothing uses still counts (as the panel's own rect had it)
    const keep = prect[n];
    const l = Math.min(...xs, keep.l + PAD), r = Math.max(...xr, keep.r - PAD), t = Math.min(...ys, keep.t + PAD), b = Math.max(...yb, keep.b - PAD - TITLE);
    prect[n] = { l: l - PAD, t: t - PAD, r: r + PAD, b: b + PAD + TITLE };
  };
  for (const n of order) {
    const even = parentIx[n] < 0 && !parentIx.includes(n);
    if (!even) {
      type It = { l: number; r: number; t: number; b: number; card?: number; panel?: number };
      const items: It[] = [];
      board.cards.forEach((_, i) => { if (innerOf[i] === n) items.push({ l: at[i][0], r: at[i][0] + W, t: at[i][1], b: at[i][1] + H, card: i }); });
      PL.forEach((_, m) => { if (parentIx[m] === n) items.push({ ...prect[m], panel: m }); });
      items.sort((a, b) => a.l - b.l || a.t - b.t);
      const left = Math.min(...items.map(i => i.l));
      const placed: It[] = [];
      for (const it of items) {
        let x = left;
        for (const q of placed) if (q.t < it.b && it.t < q.b && q.r <= it.l + 1e-6) x = Math.max(x, q.r + (q.card !== undefined && it.card !== undefined ? GX : CH));
        const dx = x - it.l;
        if (dx < -1e-6) {
          if (it.card !== undefined) at[it.card] = [at[it.card][0] + dx, at[it.card][1]];
          else shift(it.panel!, dx);
          it.l += dx; it.r += dx;
        }
        placed.push(it);
      }
      // its rect: what it holds now (its range's ends no longer stretch it)
      const xs = items.map(i => i.l), xr = items.map(i => i.r);
      prect[n] = { ...prect[n], l: Math.min(...xs) - PAD, r: Math.max(...xr) + PAD };
    } else fit(n);
  }
  const cardAt = (i: number): FlatPoint => at[i];
  return { prect, parentIx, depthOf, pos, cardAt };
}

/** the 2D layout of a board. Throws on a board with errors (boardErrors). */
export function layoutFlat(board: Board, measure: Measure, opts: Partial<FlatOptions> = {}): FlatLayout {
  if (opts.wrap) { const { wrap, ...rest } = opts; return layoutFlat(wrapBoard(board, measure, wrap.aspect, rest), measure, rest); }
  const errs = boardErrors(board);
  if (errs.length) throw new Error(`the board has ${errs.length} error${errs.length > 1 ? 's' : ''}:\n  ${errs.join('\n  ')}`);
  const o: FlatOptions = { ...FLAT_DEFAULTS, ...opts };
  const { W, H } = o;
  const f1 = (v: number) => Math.round(v * 10) / 10;
  const warnings: string[] = [];
  const PL = board.panels ?? [];

  const { prect, parentIx, depthOf, cardAt } = placeBoard(board, o);
  const panels: FlatPanel[] = PL.map((p, n) => {
    const r = prect[n];
    const tw = measure(p.label ?? '', 'title') + (p.sub ? measure(p.sub, 'titleSub') : 0);
    return {
      ...p, rect: r, titleAt: [f1(r.l + 16), f1(r.b - 15)], depth: depthOf(n), parent: parentIx[n] >= 0 ? PL[parentIx[n]].id : undefined,
      title: { l: r.l + 10, r: r.l + 22 + tw, t: r.b - 30, b: r.b - 6 },
    };
  });
  const cards: FlatCard[] = board.cards.map(c => {
    const [x, y] = cardAt(board.cards.indexOf(c));
    return { ...c, rect: { l: x, t: y, r: x + W, b: y + H } };
  });

  // ---- routing ----
  const R = new Map<string, FlatRect>();
  panels.forEach(p => R.set(p.id, p.rect));
  cards.forEach(c => R.set(c.id, c.rect));
  const CR = cards.map(c => c.rect), PANELS = panels.map(p => p.rect), TITLES = panels.filter(p => p.label).map(p => p.title);
  const inside = (c: FlatRect, p: FlatRect) => c.l >= p.l && c.r <= p.r && c.t >= p.t && c.b <= p.b;
  const hits = (a: FlatPoint, b: FlatPoint, q: FlatRect, m: number) => Math.min(a[0], b[0]) < q.r + m && Math.max(a[0], b[0]) > q.l - m && Math.min(a[1], b[1]) < q.b + m && Math.max(a[1], b[1]) > q.t - m;
  // how many panel edges a segment crosses (a route should leave a panel once, by the nearest channel)
  const borders = (a: FlatPoint, b: FlatPoint) => PANELS.reduce((n, p) => {
    if (a[0] === b[0]) { const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]); if (a[0] > p.l && a[0] < p.r) n += [p.t, p.b].filter(y => y > lo + 1 && y < hi - 1).length; }
    else { const lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]); if (a[1] > p.t && a[1] < p.b) n += [p.l, p.r].filter(x => x > lo + 1 && x < hi - 1).length; }
    return n;
  }, 0);
  // a segment running along a panel edge (within 16px) reads as part of the panel
  const nearEdge = (a: FlatPoint, b: FlatPoint) => PANELS.some(p => (a[1] === b[1]
    ? [p.t, p.b].some(y => Math.abs(a[1] - y) < 16 && Math.max(a[0], b[0]) > p.l && Math.min(a[0], b[0]) < p.r)
    : [p.l, p.r].some(x => Math.abs(a[0] - x) < 16 && Math.max(a[1], b[1]) > p.t && Math.min(a[1], b[1]) < p.b)));
  // a segment crossing the inside of a panel that holds neither end
  const crossesPanel = (a: FlatPoint, b: FlatPoint, A: FlatRect, B: FlatRect) => PANELS.filter(p => p !== A && p !== B && !inside(A, p) && !inside(B, p) && hits(a, b, { l: p.l + 3, r: p.r - 3, t: p.t + 3, b: p.b - 3 }, 0)).length;
  const used: [FlatPoint, FlatPoint][] = [];
  const hUsed = new Map<number, [FlatPoint, FlatPoint][]>(), vUsed = new Map<number, [FlatPoint, FlatPoint][]>();
  const use = (a: FlatPoint, b: FlatPoint) => {
    used.push([a, b]);
    const [m, v] = a[1] === b[1] ? [hUsed, a[1]] : a[0] === b[0] ? [vUsed, a[0]] : [undefined, 0];
    if (!m) return;
    const k = Math.floor(v / 6);
    (m.get(k) ?? m.set(k, []).get(k)!).push([a, b]);
  };
  /** how many drawn segments a segment runs along (parallel, within 6px, sharing some length) */
  const overlapUsed = (a: FlatPoint, b: FlatPoint) => {
    const horiz = a[1] === b[1];
    if (!horiz && a[0] !== b[0]) return 0;
    const ax = horiz ? 1 : 0, ac = horiz ? 0 : 1, m = horiz ? hUsed : vUsed, k = Math.floor(a[ax] / 6);
    const lo = Math.min(a[ac], b[ac]), hi = Math.max(a[ac], b[ac]);
    let n = 0;
    for (let q = k - 1; q <= k + 1; q++) for (const [c, d] of m.get(q) ?? []) {
      if (Math.abs(a[ax] - c[ax]) < 6 && Math.min(hi, Math.max(c[ac], d[ac])) - Math.max(lo, Math.min(c[ac], d[ac])) > 0) n++;
    }
    return n;
  };
  const all = [...R.values()];
  const L0 = Math.min(...all.map(r => r.l)), R0 = Math.max(...all.map(r => r.r)), T0 = Math.min(...all.map(r => r.t)), B0 = Math.max(...all.map(r => r.b));
  const mids = (lo: number, hi: number) => { const v = (lo + hi) / 2; return [v, v - 12, v + 12, v - 24, v + 24]; };
  const LY = (() => { const ys: number[] = []; CR.forEach(a => CR.forEach(b => { if (b.t > a.b && b.l < a.r + 400 && b.r > a.l - 400) ys.push(...mids(a.b, b.t)); })); ys.push(T0 - 22, T0 - 34, B0 + 22, B0 + 34); return [...new Set(ys.map(Math.round))]; })();
  const LX = (() => { const xs: number[] = []; CR.forEach(a => CR.forEach(b => { if (b.l > a.r) xs.push(...mids(a.r, b.l)); })); xs.push(L0 - 22, L0 - 34, R0 + 22, R0 + 34); return [...new Set(xs.map(Math.round))]; })();

  /** a route's cost; Infinity through a card or a title (strict), or a count of those hits (lenient). `bound`: stop
   *  early once the cost can't beat it (the result is then only known to be ≥ bound) */
  // the cards a segment can meet: a horizontal one at y meets only cards whose band (t - 6, b + 6) holds y, a vertical
  // one at x only those whose (l - 6, r + 6) holds x; kept per coordinate, in board order
  const byRow = new Map<number, FlatRect[]>(), byCol = new Map<number, FlatRect[]>();
  const rowAt = (y: number) => { let v = byRow.get(y); if (!v) byRow.set(y, v = CR.filter(q => y < q.b + 6 && y > q.t - 6)); return v; };
  const colAt = (x: number) => { let v = byCol.get(x); if (!v) byCol.set(x, v = CR.filter(q => x < q.r + 6 && x > q.l - 6)); return v; };
  const kc = o.crossPanel / o.overlap, kb = o.border / o.overlap, ke = o.nearEdge / o.overlap;
  /** a route's cost: length, bends, and 400 × its overlap units (an overlap with a drawn line; crossings, borders and
   *  running near an edge as fractions of one); Infinity through a card or a title (strict), else 1e5 a hit.
   *  `bound`: once the cost can't beat it, any value ≥ it is returned */
  function cost(pts: FlatPoint[], A: FlatRect, B: FlatRect, bound: number, strict = true): number {
    let len = 0;
    for (let k = 1; k < pts.length; k++) len += Math.abs(pts[k - 1][0] - pts[k][0]) + Math.abs(pts[k - 1][1] - pts[k][1]);
    const base = len + o.bend * (pts.length - 2);
    if (base >= bound) return base;
    let bad = 0, ov = 0;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      if (strict) { if (blocked(a, b, A, B) || nearEdge(a, b)) return Infinity; continue; }
      for (const q of a[1] === b[1] ? rowAt(a[1]) : colAt(a[0])) if (q !== A && q !== B && hits(a, b, q, 6)) bad++;
      for (const q of TITLES) if (hits(a, b, q, 2)) bad++;
    }
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      ov += overlapUsed(a, b) + kc * crossesPanel(a, b, A, B) + kb * borders(a, b);
      if (nearEdge(a, b)) ov += ke;
      if (base + o.overlap * ov >= bound) return base + o.overlap * ov;
    }
    return base + o.overlap * ov + bad * 1e5;
  }
  const cx = (r: FlatRect) => (r.l + r.r) / 2, cy = (r: FlatRect) => (r.t + r.b) / 2;
  const OXS = [0, -22, 22, -44, 44];
  /** the candidate routes from A to B, in a fixed order */
  /** the best cost so far for the link being routed: the candidates skip what can't beat it (as cost() would) */
  const bound = { bc: Infinity };
  // a candidate's length and bends, summed as cost() sums them, before the candidate is made
  const seg = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) + Math.abs(ay - by);
  const base4 = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    let len = 0; len += seg(x0, y0, x1, y1); len += seg(x1, y1, x2, y2); len += seg(x2, y2, x3, y3); return len + o.bend * 2;
  };
  const base5 = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number) => {
    let len = 0; len += seg(x0, y0, x1, y1); len += seg(x1, y1, x2, y2); len += seg(x2, y2, x3, y3); len += seg(x3, y3, x4, y4); return len + o.bend * 3;
  };
  /** a segment through a card (but A or B) or a title: a strict route may not have one */
  const blocked = (a: FlatPoint, b: FlatPoint, A: FlatRect, B: FlatRect) => {
    for (const q of a[1] === b[1] ? rowAt(a[1]) : colAt(a[0])) if (q !== A && q !== B && hits(a, b, q, 6)) return true;
    for (const q of TITLES) if (hits(a, b, q, 2)) return true;
    return nearEdge(a, b);
  };
  /** the candidate routes from A to B, in a fixed order. Strict: a candidate whose first or last segment is blocked
   *  (which cost() would make Infinity) is skipped before it is made; those segments are tested once a link */
  function routes(A: FlatRect, B: FlatRect, take: (p: FlatPoint[]) => void, strict: boolean): void {
    // straight
    const ol = Math.max(A.l, B.l), orr = Math.min(A.r, B.r);
    if (orr - ol > 24) for (const d of OXS) { const x = (ol + orr) / 2 + d; if (x > ol + 8 && x < orr - 8) take(B.t >= A.b ? [[x, A.b], [x, B.t]] : [[x, A.t], [x, B.b]]); }
    const ot = Math.max(A.t, B.t), ob = Math.min(A.b, B.b);
    if (ob - ot > 16) for (const d of [0, -10, 10]) { const y = (ot + ob) / 2 + d; take(B.l >= A.r ? [[A.r, y], [B.l, y]] : [[A.l, y], [B.r, y]]); }
    // per port offset and lane: is the segment out of A (into B) clear? 0 unknown, 1 clear, 2 blocked
    const NX = LX.length, NY = LY.length;
    const vA = new Uint8Array(OXS.length * NY), vB = new Uint8Array(OXS.length * NY), hA = new Uint8Array(OXS.length * NX), hB = new Uint8Array(OXS.length * NX);
    const clear = (t: Uint8Array, i: number, a: FlatPoint, b: FlatPoint) => {
      if (!strict) return true;
      if (!t[i]) t[i] = blocked(a, b, A, B) ? 2 : 1;
      return t[i] === 1;
    };
    OXS.forEach((da, di) => OXS.forEach((db, dj) => {
      const ax = cx(A) + da, bxx = cx(B) + db, ay = cy(A) + da / 3, byy = cy(B) + db / 3;
      // vertical – horizontal – vertical, through a lane between, above or below
      LY.forEach((y, yi) => {
        const ya = y > A.b ? A.b : y < A.t ? A.t : null, yb = y > B.b ? B.b : y < B.t ? B.t : null;
        if (ya !== null && yb !== null && base4(ax, ya, ax, y, bxx, y, bxx, yb) < bound.bc
          && clear(vA, di * NY + yi, [ax, ya], [ax, y]) && clear(vB, dj * NY + yi, [bxx, y], [bxx, yb])) take([[ax, ya], [ax, y], [bxx, y], [bxx, yb]]);
      });
      // horizontal – vertical – horizontal
      LX.forEach((x, xi) => {
        const xa = x > A.r ? A.r : x < A.l ? A.l : null, xb = x > B.r ? B.r : x < B.l ? B.l : null;
        if (xa !== null && xb !== null && base4(xa, ay, x, ay, x, byy, xb, byy) < bound.bc
          && clear(hA, di * NX + xi, [xa, ay], [x, ay]) && clear(hB, dj * NX + xi, [x, byy], [xb, byy])) take([[xa, ay], [x, ay], [x, byy], [xb, byy]]);
      });
      // four bends: out of a side, along a lane, across another lane, into the top or bottom (and the reverse)
      if (da === 0 && db === 0) LX.forEach((x, xi) => LY.forEach((y, yi) => {
        const xa = x > A.r ? A.r : x < A.l ? A.l : null, yb = y > B.b ? B.b : y < B.t ? B.t : null;
        if (xa !== null && yb !== null && base5(xa, ay, x, ay, x, y, bxx, y, bxx, yb) < bound.bc
          && clear(hA, di * NX + xi, [xa, ay], [x, ay]) && clear(vB, dj * NY + yi, [bxx, y], [bxx, yb])) take([[xa, ay], [x, ay], [x, y], [bxx, y], [bxx, yb]]);
        const ya = y > A.b ? A.b : y < A.t ? A.t : null, xb = x > B.r ? B.r : x < B.l ? B.l : null;
        if (ya !== null && xb !== null && base5(ax, ya, ax, y, x, y, x, byy, xb, byy) < bound.bc
          && clear(vA, di * NY + yi, [ax, ya], [ax, y]) && clear(hB, dj * NX + xi, [x, byy], [xb, byy])) take([[ax, ya], [ax, y], [x, y], [x, byy], [xb, byy]]);
      }));
      // L shapes
      const xb2 = cx(A) < B.l ? B.l : cx(A) > B.r ? B.r : null, yA = byy < A.t ? A.t : byy > A.b ? A.b : null;
      if (xb2 !== null && yA !== null) take([[ax, yA], [ax, byy], [xb2, byy]]);
      const yb2 = cy(A) < B.t ? B.t : cy(A) > B.b ? B.b : null, xA = bxx < A.l ? A.l : bxx > A.r ? A.r : null;
      if (yb2 !== null && xA !== null) take([[xA, ay], [bxx, ay], [bxx, yb2]]);
    }));
  }
  /** from something to a panel holding it: straight out of a side to that panel's inner border */
  function toHolder(A: FlatRect, B: FlatRect, flip: boolean, take: (p: FlatPoint[]) => void): void {
    for (const d of OXS) {
      const x = cx(A) + d, y = cy(A) + d / 3;
      const c: FlatPoint[][] = [[[x, A.t], [x, B.t]], [[A.r, y], [B.r, y]], [[x, A.b], [x, B.b]], [[A.l, y], [B.l, y]]];
      for (const p of c) take(flip ? [p[1], p[0]] : p);
    }
  }
  /** the cheapest candidate, the first of equals (in the candidates' order) */
  const best = (gen: (take: (p: FlatPoint[]) => void, strict: boolean) => void, A: FlatRect, B: FlatRect, strict: boolean) => {
    let pick: FlatPoint[] | null = null;
    bound.bc = Infinity;
    gen(p => { const k = cost(p, A, B, bound.bc, strict); if (k < bound.bc) { bound.bc = k; pick = p; } }, strict);
    return pick as FlatPoint[] | null;
  };

  // ---- labels ----
  const labs: FlatRect[] = [];
  const onBorder = (q: FlatRect) => PANELS.some(p => [p.l, p.r].some(x => q.l < x + 3 && q.r > x - 3 && q.b > p.t && q.t < p.b) || [p.t, p.b].some(y => q.t < y + 3 && q.b > y - 3 && q.r > p.l && q.l < p.r));
  const onLine = (q: FlatRect) => used.filter(([a, b]) => hits(a, b, q, 1)).length;
  const overTitle = (q: FlatRect) => TITLES.some(t => q.l < t.r && q.r > t.l && q.t < t.b && q.b > t.t);
  const nearCards = (q: FlatRect) => CR.filter(c => q.l < c.r + 3 && q.r > c.l - 3 && q.t < c.b + 3 && q.b > c.t - 3).length;
  const nearLabels = (q: FlatRect) => labs.filter(c => q.l < c.r + 4 && q.r > c.l - 4 && q.t < c.b + 2 && q.b > c.t - 2).length;
  const boxBad = (q: FlatRect) => 50 * onCrossing(q) + 3 * onLine(q) + (onBorder(q) ? 1 : 0) + (overTitle(q) ? 5 : 0) + 5 * nearCards(q) + 5 * nearLabels(q);
  const boxHits = (q: FlatRect) => onLine(q) > 0 || onBorder(q) || overTitle(q) || nearCards(q) > 0 || nearLabels(q) > 0;

  const links: FlatLink[] = [];
  (board.links ?? []).forEach((c, n) => {
    const id = c.id ?? `link-${n}`;
    const A = R.get(c.aOn ?? c.a)!, B = R.get(c.bOn ?? c.b)!;
    if (A === B) { warnings.push(`link "${id}" joins "${c.aOn ?? c.a}" to itself: not drawn`); links.push({ ...c, id, points: [], routed: false }); return; }
    const gen = inside(A, B) ? (t: (p: FlatPoint[]) => void) => toHolder(A, B, false, t) : inside(B, A) ? (t: (p: FlatPoint[]) => void) => toHolder(B, A, true, t) : (t: (p: FlatPoint[]) => void, strict: boolean) => routes(A, B, t, strict);
    let route = best(gen, A, B, true), routed = true;
    if (!route) { route = best(gen, A, B, false); routed = false; warnings.push(`link "${id}": no clear route; drawn the least bad way`); }
    if (!route) { links.push({ ...c, id, points: [], routed: false }); return; }
    for (let k = 1; k < route.length; k++) use(route[k - 1], route[k]);
    links.push({ ...c, id, points: route, routed });
  });
  // ---- labels, once every line is drawn (a line drawn after a label would run through it) ----
  // where two drawn lines cross: a label never sits on a crossing, even the least bad one
  const crossings: FlatPoint[] = [];
  for (let i = 0; i < used.length; i++) for (let j = i + 1; j < used.length; j++) {
    const [a, b] = used[i], [c, d] = used[j];
    const h1 = a[1] === b[1], h2 = c[1] === d[1];
    if (h1 === h2) continue;
    const [H1, V1] = h1 ? [[a, b], [c, d]] : [[c, d], [a, b]];
    const x = V1[0][0], y = H1[0][1];
    if (x > Math.min(H1[0][0], H1[1][0]) && x < Math.max(H1[0][0], H1[1][0]) && y > Math.min(V1[0][1], V1[1][1]) && y < Math.max(V1[0][1], V1[1][1])) crossings.push([x, y]);
  }
  const onCrossing = (q: FlatRect) => crossings.filter(([x, y]) => x > q.l - 2 && x < q.r + 2 && y > q.t - 2 && y < q.b + 2).length;
  for (const L of links) {
    const c = L, route = L.points;
    if (!c.label || !route.length) continue;
    // the label: beside the longest segment first, then the others; above or below a horizontal, right or left of a vertical
    const segs: [FlatPoint, FlatPoint][] = [];
    for (let k = 1; k < route.length; k++) segs.push([route[k - 1], route[k]]);
    const segLen = (s: [FlatPoint, FlatPoint]) => Math.abs(s[0][0] - s[1][0]) + Math.abs(s[0][1] - s[1][1]);
    segs.sort((p, q) => segLen(q) - segLen(p));
    const w = measure(c.label, 'label') + 6;
    type Spot = [number, number, FlatLabel['anchor'], FlatRect];
    let placed: Spot | null = null, least: Spot | null = null, leastBad = Infinity;
    for (const [a, b] of segs) {
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const tries: [number, number, FlatLabel['anchor']][] = a[1] === b[1]
        ? [0, -0.3, 0.3, -0.15, 0.15].flatMap(k => { const x = mx + k * Math.abs(a[0] - b[0]); return [[x, my - 6, 'middle'], [x, my + 15, 'middle']] as [number, number, FlatLabel['anchor']][]; })
        : [0, -0.3, 0.3].flatMap(k => { const y = my + 4 + k * Math.abs(a[1] - b[1]); return [[mx + 7, y, 'start'], [mx - 7, y, 'end'], [mx + 24, y, 'start'], [mx - 24, y, 'end']] as [number, number, FlatLabel['anchor']][]; });
      for (const [x, y, an] of tries) {
        const l = an === 'middle' ? x - w / 2 : an === 'end' ? x - w : x, q = { l, r: l + w, t: y - 11, b: y + 3 };
        if (!boxHits(q)) { placed = [x, y, an, q]; break; }
        const bad = boxBad(q); if (bad < leastBad) { leastBad = bad; least = [x, y, an, q]; }
      }
      if (placed) break;
    }
    if (!placed && least) placed = least;
    if (!placed) { const [a, b] = segs[0]; const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2 - 6; placed = [x, y, 'middle', { l: x - w / 2, r: x + w / 2, t: y - 11, b: y + 3 }]; }
    labs.push(placed[3]);
    L.at = { x: f1(placed[0]), y: f1(placed[1]), anchor: placed[2], box: placed[3], text: c.label };
  }

  // ---- bounds: everything drawn, and the margin ----
  const xs: number[] = [], ys: number[] = [];
  for (const r of [...all, ...labs, ...panels.map(p => p.title)]) { xs.push(r.l, r.r); ys.push(r.t, r.b); }
  for (const l of links) for (const p of l.points) { xs.push(p[0]); ys.push(p[1]); }
  const m = o.margin;
  const bounds = { l: Math.min(...xs) - m, t: Math.min(...ys) - m, r: Math.max(...xs) + m, b: Math.max(...ys) + m };
  return { cards, panels, links, bounds, options: o, warnings };
}

/** which card or panel a point is on (topmost: a card, then the innermost panel) */
export function flatHit(L: FlatLayout, x: number, y: number): string | undefined {
  const on = (r: FlatRect) => x >= r.l && x <= r.r && y >= r.t && y <= r.b;
  const c = L.cards.find(k => on(k.rect));
  if (c) return c.id;
  return [...L.panels].sort((a, b) => b.depth - a.depth).find(p => on(p.rect))?.id;
}

// ---- wrapping a wide drawing ----

/** A wide drawing wrapped for a frame of an aspect (width / height): in a container (the drawing, or a panel) whose
 *  children stand side by side, the last of them go onto a shelf of their own below the others, in their order. Each
 *  step takes the wrap that lets the drawing be drawn largest in such a frame, while one does. Cards inside a panel of cards only
 *  stay as they are: what moves is a container's children as wholes (inner panels, and cards beside them). */
export function wrapBoard(board: Board, measure: Measure, aspect: number, opts: Partial<FlatOptions> = {}): Board {
  // fitted into a frame of that aspect, how large it is drawn: the smaller its larger side (height as width), the larger
  const score = (b: Board) => { const L = layoutFlat(b, measure, opts); return Math.max(L.bounds.r - L.bounds.l, (L.bounds.b - L.bounds.t) * aspect); };
  let cur = board, best = score(board);
  for (let step = 0; step < 12; step++) {
    let next: Board | undefined, nextScore = best;
    for (const cand of wraps(cur)) {
      if (boardErrors(cand).length) continue;
      const sc = score(cand);
      if (sc < nextScore - 0.5) { nextScore = sc; next = cand; }
    }
    if (!next) break;
    cur = next; best = nextScore;
  }
  return cur;
}

/** every way to wrap one shelf of one container's children: each split of each row of side-by-side children */
function* wraps(board: Board): Generator<Board> {
  const PL = board.panels ?? [];
  const within2 = (a: number[], b: number[]) => a[0] >= b[0] && a[2] <= b[2] && a[1] >= b[1] && a[3] <= b[3];
  const same = (a: number[], b: number[]) => a.every((v, i) => v === b[i]);
  // the innermost panel holding k. Two panels may cover the same cells (an AZ that holds only its VPC): the board lists
  // the outer first, so of equal ones the later is inside the earlier (0.8.2: else each was the other's parent, and the
  // walk up from one never ended)
  const parentOf = (k: number[], self = -1) => {
    let best = -1;
    PL.forEach((p, n) => {
      if (n === self || !within2(k, p.cells)) return;
      if (self >= 0 && n > self && same(p.cells, PL[self].cells)) return;        // an equal panel after self is inside it
      if (best < 0 || (within2(p.cells, PL[best].cells) && (!same(p.cells, PL[best].cells) || n > best))) best = n;
    });
    return best;
  };
  // a container's children, as blocks of cells: its child panels, and its own cards
  const blocks = (c: number) => {
    const out: { range: number[]; panel?: number; card?: number }[] = [];
    PL.forEach((p, n) => { if (parentOf(p.cells, n) === c) out.push({ range: [...p.cells], panel: n }); });
    board.cards.forEach((k, i) => { const r = [k.cell[0], k.cell[1], k.cell[0], k.cell[1]]; if (parentOf(r) === c) out.push({ range: r, card: i }); });
    return out;
  };
  for (const c of [-1, ...PL.map((_, n) => n)]) {
    const bs = blocks(c);
    if (c >= 0 && !bs.some(b => b.panel !== undefined)) continue;        // a panel of cards only: left as it is
    // shelves: children whose rows overlap, left to right
    const rows = (b: { range: number[] }) => [b.range[1], b.range[3]];
    const shelves: (typeof bs)[] = [];
    for (const b of [...bs].sort((x, y) => x.range[1] - y.range[1] || x.range[0] - y.range[0])) {
      const sh = shelves.find(s => s.some(o => rows(o)[0] <= rows(b)[1] && rows(b)[0] <= rows(o)[1]));
      if (sh) sh.push(b); else shelves.push([b]);
    }
    const R = Math.max(...bs.map(b => b.range[3]));
    for (const sh of shelves) {
      sh.sort((x, y) => x.range[0] - y.range[0]);
      for (let m = 1; m < sh.length; m++) {
        const moved = sh.slice(m), c0 = sh[0].range[0], r0 = R + 1, top = Math.min(...moved.map(b => b.range[1]));
        const h = Math.max(...moved.map(b => b.range[3])) - top + 1;
        const cards = board.cards.map(k => ({ ...k, cell: [...k.cell] as [number, number] }));
        const panels = PL.map(p => ({ ...p, cells: [...p.cells] as [number, number, number, number] }));
        // below the container: down by the new shelf's height; the container and what holds it: taller
        for (const k of cards) if (k.cell[1] > R) k.cell[1] += h;
        const holds = new Set<number>();
        for (let a = c; a >= 0 && !holds.has(a); a = parentOf(PL[a].cells, a)) holds.add(a);
        panels.forEach((p, n) => { if (p.cells[1] > R) { p.cells[1] += h; p.cells[3] += h; } else if (holds.has(n) || (p.cells[1] <= R && p.cells[3] > R)) p.cells[3] += h; });
        // the moved children: onto the shelf, left to right from the container's first column, in their order
        let x = c0;
        for (const b of moved) {
          const dx = x - b.range[0], dy = r0 + (b.range[1] - top) - b.range[1];
          const inside = (cell: number[]) => cell[0] >= b.range[0] && cell[0] <= b.range[2] && cell[1] >= b.range[1] && cell[1] <= b.range[3];
          board.cards.forEach((k, i) => { if (inside([k.cell[0], k.cell[1]])) { cards[i].cell = [k.cell[0] + dx, k.cell[1] + dy]; } });
          PL.forEach((p, n) => { if (within2(p.cells, b.range)) panels[n].cells = [p.cells[0] + dx, p.cells[1] + dy, p.cells[2] + dx, p.cells[3] + dy]; });
          x += b.range[2] - b.range[0] + 1;
        }
        // each panel as wide and tall as the cards it held (a move leaves no empty end in a range)
        PL.forEach((p, n) => {
          const mine = board.cards.map((k, i) => (within2([k.cell[0], k.cell[1], k.cell[0], k.cell[1]], p.cells) ? cards[i].cell : undefined)).filter((v): v is [number, number] => !!v);
          if (mine.length) panels[n].cells = [Math.min(...mine.map(v => v[0])), Math.min(...mine.map(v => v[1])), Math.max(...mine.map(v => v[0])), Math.max(...mine.map(v => v[1]))];
        });
        yield { cards, panels, links: board.links };
      }
    }
  }
}
