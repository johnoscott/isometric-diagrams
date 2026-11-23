// What every 2D layout must keep (test/flat.test.ts, board.test.ts, dual-view.test.ts), and the model board.
import { readFileSync } from 'node:fs';
import type { Board, FlatLayout, FlatRect, FlatPoint } from '../../../src/iso-objects/flat.ts';

export const MODEL: Board = JSON.parse(readFileSync(new URL('../../../examples/boards/model.json', import.meta.url), 'utf8'));


const meets = (a: FlatPoint, b: FlatPoint, q: FlatRect, m = 0) => Math.min(a[0], b[0]) < q.r + m && Math.max(a[0], b[0]) > q.l - m && Math.min(a[1], b[1]) < q.b + m && Math.max(a[1], b[1]) > q.t - m;
const onEdge = (p: FlatPoint, r: FlatRect) => ((p[0] === r.l || p[0] === r.r) && p[1] >= r.t && p[1] <= r.b) || ((p[1] === r.t || p[1] === r.b) && p[0] >= r.l && p[0] <= r.r);
const overlaps = (a: FlatRect, b: FlatRect) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

/** the rules: no route through a card (but its own ends) or a title; each end on its card's or panel's edge;
 *  orthogonal; no label over a card, a title, another label or any line but its own link's; and inside every panel
 *  no empty band (between its cards and inner panels, top to bottom) wider than the channel */
export function checkLayout(L: FlatLayout): string[] {
  const out: string[] = [];
  const rect = new Map<string, FlatRect>([...L.cards.map(c => [c.id, c.rect] as const), ...L.panels.map(p => [p.id, p.rect] as const)]);
  for (const l of L.links) {
    const A = rect.get(l.aOn ?? l.a)!, B = rect.get(l.bOn ?? l.b)!, P = l.points;
    if (!P.length) { out.push(`${l.id}: not drawn`); continue; }
    if (!onEdge(P[0], A)) out.push(`${l.id}: starts off its end's edge`);
    if (!onEdge(P[P.length - 1], B)) out.push(`${l.id}: ends off its end's edge`);
    for (let k = 1; k < P.length; k++) {
      const a = P[k - 1], b = P[k];
      if (a[0] !== b[0] && a[1] !== b[1]) out.push(`${l.id}: a diagonal segment`);
      for (const c of L.cards) if (c.rect !== A && c.rect !== B && meets(a, b, c.rect)) out.push(`${l.id}: through card ${c.id}`);
      for (const p of L.panels) if (p.label && meets(a, b, p.title)) out.push(`${l.id}: through the title of ${p.id}`);
      // along a panel's edge (parallel, within 16 px, overlapping it) reads as the panel's own line; crossing it is fine
      for (const p of L.panels) {
        const along = a[1] === b[1]
          ? [p.rect.t, p.rect.b].some(y => Math.abs(a[1] - y) < 16 && Math.max(a[0], b[0]) > p.rect.l && Math.min(a[0], b[0]) < p.rect.r)
          : [p.rect.l, p.rect.r].some(x => Math.abs(a[0] - x) < 16 && Math.max(a[1], b[1]) > p.rect.t && Math.min(a[1], b[1]) < p.rect.b);
        if (along && (a[0] !== b[0] || a[1] !== b[1])) out.push(`${l.id}: along an edge of ${p.id}`);
      }
    }
  }
  const labels = L.links.filter(l => l.at).map(l => ({ id: l.id, box: l.at!.box }));
  for (const x of labels) {
    for (const c of L.cards) if (overlaps(x.box, c.rect)) out.push(`label of ${x.id} over card ${c.id}`);
    for (const p of L.panels) if (p.label && overlaps(x.box, p.title)) out.push(`label of ${x.id} over the title of ${p.id}`);
    for (const y of labels) if (y.id > x.id && overlaps(x.box, y.box)) out.push(`labels of ${x.id} and ${y.id} overlap`);
    for (const l of L.links) if (l.id !== x.id) for (let k = 1; k < l.points.length; k++) if (meets(l.points[k - 1], l.points[k], x.box)) { out.push(`label of ${x.id} on the line of ${l.id}`); break; }
  }
  out.push(...airIn(L));
  return out;
}


/** inside each panel, down and across: the empty bands between what it holds (its cards and inner panels) wider than
 *  the channel (the most two things in one panel are ever apart: two inner panels, the channel between them), and any
 *  slack between its padding and what it holds */
export function airIn(L: FlatLayout): string[] {
  const out: string[] = [], o = L.options;
  for (const p of L.panels) {
    const inner = [...L.cards.filter(c => holder(L, c.rect) === p.id).map(c => c.rect), ...L.panels.filter(q => q.parent === p.id).map(q => q.rect)];
    if (!inner.length) continue;
    // down, then across: the bands what it holds covers, and the gaps between them
    // across, a top-level panel of cards only is spread evenly over the drawing's columns (decision 4): not air
    const even = p.depth === 0 && !L.panels.some(q => q.parent === p.id);
    for (const [lo, hi, from, to, what] of [['t', 'b', p.rect.t + o.PAD, p.rect.b - o.PAD - o.TITLE, 'down'], ['l', 'r', p.rect.l + o.PAD, p.rect.r - o.PAD, 'across']] as const) {
      if (even && what === 'across') continue;
      const spans = inner.map(r => [r[lo], r[hi]]).sort((a, b) => a[0] - b[0]);
      let reach = spans[0][1];
      for (const [t, b] of spans.slice(1)) {
        if (t - reach > o.CH) out.push(`${p.id}: an empty band of ${t - reach} px inside it (${what})`);
        reach = Math.max(reach, b);
      }
      if (spans[0][0] - from > 0.5) out.push(`${p.id}: ${spans[0][0] - from} px empty at its ${what === 'down' ? 'top' : 'left'}`);
      if (to - reach > 0.5) out.push(`${p.id}: ${to - reach} px empty at its ${what === 'down' ? 'bottom' : 'right'}`);
    }
  }
  return out;
}
/** the innermost panel holding a rect */
const holder = (L: FlatLayout, r: FlatRect) => [...L.panels].sort((a, b) => b.depth - a.depth).find(p => r.l >= p.rect.l && r.r <= p.rect.r && r.t >= p.rect.t && r.b <= p.rect.b)?.id;

/** a large synthetic board: 60 cards in a 10 × 6 grid, six panels of two rows, 100 links between cards picked by a
 *  fixed sequence (the same every run) */
export function bigBoard(): Board {
  const cards: Board['cards'] = [], panels: NonNullable<Board['panels']> = [], links: NonNullable<Board['links']> = [];
  for (let j = 0; j < 6; j++) for (let i = 0; i < 10; i++) cards.push({ id: `c${i}-${j}`, label: `Card ${i}.${j}`, sub: 'a synthetic card', cell: [i, j] });
  for (let j = 0; j < 6; j += 2) for (let i = 0; i < 10; i += 5) panels.push({ id: `p${i}-${j}`, label: `PANEL ${i}.${j}`, sub: 'two rows', cells: [i, j, i + 4, j + 1] });
  let s = 7;
  const rnd = (n: number) => { s = (s * 1103515245 + 12345) % 2147483648; return s % n; };
  while (links.length < 100) { const a = cards[rnd(60)], b = cards[rnd(60)]; if (a !== b) links.push({ a: a.id, b: b.id, label: `link ${links.length}` }); }
  const big = { cards, panels, links };
  return big;
}
