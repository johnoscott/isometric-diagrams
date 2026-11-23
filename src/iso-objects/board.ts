// A board both ways (0.6.0): boardOf reads one from any drawing the engine has laid out (so a drawing in any format
// has a 2D view), and boardDiagram draws a board in 3D through the engine (a neutral card kind and a panel kind).
//
// boardOf: the 2D view is derived from the 3D placement, never authored on its own. A card's row is one below every
// card above it, and its column one right of every card left of it, asked of the two things that part them (so each
// container's rows and columns are its own, and near-aligned boxes share them); a card in no region keeps its place
// across. Two cards in one cell get a column each. A region (or a node
// holding nodes) is a panel over the cells of what it holds; one holding nothing has no cell and isn't shown. Routes
// are links, their ends' sides dropped. What 2D leaves out: sizes (every card is the same size), heights, a route's
// sides and via points, a region's label style.

import { type Box, type Kernel, FONTS } from '../iso-core/kernel.ts';
import type { NodeAsset } from './assets.ts';
import type { KindCatalog } from './kinds.ts';
import { nodeKindOr, regionKind } from './kinds.ts';
import type { CompiledScene } from './compile.ts';
import type { Placed, RawDiagram, RawNode, RawRegion, RawKind, RawRole } from './types.ts';
import { parseEnd, type RawRoute } from './route.ts';
import { placeBoard, type Board, type BoardCard, type BoardLink, type BoardPanel } from './flat.ts';

/** the board of a laid-out scene; `visible`: only what it says is shown (e.g. a step's visible set) */
export function boardOf(scene: CompiledScene, visible: (id: string) => boolean = () => true): Required<Board> {
  const items = scene.layout.items.filter(p => visible(p.id));
  const cat = scene.layout.catalog;
  const isCard = (p: Placed) => p.type === 'node' && !p.children.some(c => c.type === 'node' && visible(c.id));
  const cardsP = items.filter(isCard);
  // rows and columns: a card is a row below every card above it, and a column right of every card left of it, asked of
  // the two things that part them (the children of their nearest common container holding each: their regions, or the
  // cards themselves): one wholly behind (left of) the other and overlapping it across (down). So a region's rows and
  // columns are its own: a tall or wide neighbour opens none inside it.
  const line = (p: Placed) => { const a: Placed[] = []; for (let q: Placed | undefined = p; q; q = q.parent) a.unshift(q); return a; };
  const lines = new Map(cardsP.map(p => [p.id, line(p)]));
  const parted = (q: Placed, p: Placed) => {
    const A = lines.get(q.id)!, B = lines.get(p.id)!;
    let i = 0;
    while (i < A.length && i < B.length && A[i] === B[i]) i++;
    return [A[i].box, B[i].box] as const;
  };
  const e = 1e-6;
  const above = (q: Placed, p: Placed) => { const [a, b] = parted(q, p); return a.y1 <= b.y0 + e && a.x0 < b.x1 - e && b.x0 < a.x1 - e; };
  const leftOf = (q: Placed, p: Placed) => { const [a, b] = parted(q, p); return a.x1 <= b.x0 + e && a.y0 < b.y1 - e && b.y0 < a.y1 - e; };
  const longest = (rel: (q: Placed, p: Placed) => boolean, key: (p: Placed) => number) => {
    const out = new Map<string, number>(), done: Placed[] = [];
    for (const p of [...cardsP].sort((a, b) => key(a) - key(b))) {
      let r = 0;
      for (const q of done) if (out.get(q.id)! + 1 > r && rel(q, p)) r = out.get(q.id)! + 1;
      out.set(p.id, r); done.push(p);
    }
    return out;
  };
  const rowOf = longest(above, p => p.box.y0), colOf = longest(leftOf, p => p.box.x0);
  // a card in no region (one floating over the drawing) keeps its place across: no further left than any card that
  // starts left of it
  const tolX = Math.min(...cardsP.map(p => p.box.x1 - p.box.x0)) / 2;
  for (const p of cardsP) if (!p.parent) for (const q of cardsP) if (q.parent && q.box.x0 <= p.box.x0 + tolX) colOf.set(p.id, Math.max(colOf.get(p.id)!, colOf.get(q.id)!));
  const cell = new Map<string, [number, number]>();
  for (const p of cardsP) cell.set(p.id, [colOf.get(p.id)!, rowOf.get(p.id)!]);
  // two in one cell: the later one gets a new column just right of it (everything right of it moves along)
  const taken = new Map<string, string>();
  for (const p of cardsP) {
    const c = cell.get(p.id)!;
    const was = taken.get(String(c));
    if (was !== undefined && was !== p.id) {
      for (const [, k] of cell) if (k[0] > c[0] && k !== c) k[0]++;
      c[0]++;
      taken.clear();
      for (const q of cardsP) taken.set(String(cell.get(q.id)), q.id);
    } else taken.set(String(c), p.id);
  }
  const cards: BoardCard[] = cardsP.map(p => {
    const n = p.node!, a = nodeKindOr(cat, n.asset);
    return { id: p.id, label: n.label ?? p.id, sub: n.sub, role: n.role ?? a.role, ghost: n.ghost || undefined, cell: cell.get(p.id)! };
  });
  const panels: BoardPanel[] = [];
  for (const p of items) {
    if (isCard(p)) continue;
    const inner: [number, number][] = [];
    const walk = (q: Placed) => { for (const c of q.children) { const k = cell.get(c.id); if (k) inner.push(k); walk(c); } };
    walk(p);
    if (!inner.length) continue;
    const xs = inner.map(k => k[0]), ys = inner.map(k => k[1]);
    const label = p.type === 'region' ? p.region!.label : (p.node!.label ?? p.id);
    const role = p.type === 'region' ? (p.region!.role ?? regionKind(cat, p.region!.kind)?.role) : (p.node!.role ?? nodeKindOr(cat, p.node!.asset).role);
    panels.push({ id: p.id, label, sub: p.type === 'node' ? p.node!.sub : undefined, role, cells: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  }
  const ends = new Set([...cards.map(c => c.id), ...panels.map(p => p.id)]);
  const links: BoardLink[] = [];
  for (const r of scene.routes) {
    if (!visible(r.id)) continue;
    const a = parseEnd(r.raw.from).id, b = parseEnd(r.raw.to).id;
    if (!ends.has(a) || !ends.has(b)) continue;
    const label = typeof r.raw.label === 'string' ? r.raw.label : r.raw.label?.text;
    links.push({ id: r.id, a, b, kind: r.kind, label });
  }
  return { cards, panels, links };
}

// ---- a board in 3D ----

/** the 3D board's sizes, in grid units: a card's footprint and height, the gaps, a panel's margin, the channel */
export const BOARD_3D = { W: 4, D: 2, H: 0.9, GX: 2, GY: 2.4, PAD: 0.6, CH: 2.2, PANEL_H: 0.3 };

/** the text on a 3D card's front face */
export const BOARD_CSS = `
.blk .card-name{font-size:13px;font-weight:600;fill:var(--ink)}
.blk .card-sub{font-size:10px;fill:var(--ink);opacity:.75}
.blk.ghost .card-name,.blk.ghost .card-sub{fill:var(--muted)}
`;

/** a card: a slab with its name (and sub) on its front face. The text is the board's (`text`), not the node's label:
 *  a node with a label gets the scene's upright label above it as well */
export function cardAsset(text: (id: string) => { label: string; sub?: string } | undefined): NodeAsset {
  return {
    name: 'card', description: 'A card: a slab with its name on its front face', size: [BOARD_3D.W, BOARD_3D.D, BOARD_3D.H], role: 'grey',
    draw(k: Kernel, b: Box, n: RawNode) {
      const t = text(n.id);
      let s = k.blockFaces(b);
      if (!t) return s;
      const h = b.z1 - b.z0;
      s += k.faceText(b.x0 + 0.2, b.y1, b.z0 + (t.sub ? h * 0.52 : h * 0.34), t.label, 'card-name', FONTS.lbl, 'left', 'start');
      if (t.sub) s += k.faceText(b.x0 + 0.2, b.y1, b.z0 + h * 0.14, t.sub, 'card-sub', FONTS.sub, 'left', 'start');
      return s;
    },
  };
}

/** the catalogue a board is drawn with in 3D: a panel (a thin slab, its name on its floor) and a card showing the
 *  board's text */
export function boardCatalog(board: Board): KindCatalog {
  const text = new Map(board.cards.map(c => [c.id, { label: c.label, sub: c.sub }]));
  return {
    regions: { panel: { shape: 'slab', pad: BOARD_3D.PAD, z: [BOARD_3D.PANEL_H, 0], floor: true, role: 'grey', labelStyle: 'floor' } },
    nodes: { card: cardAsset(id => text.get(id)) },
    defaultNode: 'card',
  };
}

/** a board as an engine drawing (one scene): panels as regions, nested as they hold each other, cards as nodes, links
 *  as routes (kinds and roles: the drawing's own, as a document's `kinds:` and `roles:`) */
export function boardDiagram(board: Board, opts: { title?: string; kinds?: Record<string, RawKind>; roles?: Record<string, RawRole> } = {}): RawDiagram {
  const g = BOARD_3D;
  const { prect, parentIx, cardAt } = placeBoard(board, { W: g.W, H: g.D, GX: g.GX, GY: g.GY, PAD: g.PAD, TITLE: 0, CH: g.CH });
  const PL = board.panels ?? [];
  const r1 = (v: number) => Math.round(v * 1000) / 1000;
  // each card in its innermost panel: the smallest holding its cell (of equal ones, the later: the earlier holds it)
  const area = (p: BoardPanel) => (p.cells[2] - p.cells[0] + 1) * (p.cells[3] - p.cells[1] + 1);
  const holder = (c: BoardCard) => {
    let best = -1;
    PL.forEach((p, n) => {
      const k = p.cells;
      if (c.cell[0] >= k[0] && c.cell[0] <= k[2] && c.cell[1] >= k[1] && c.cell[1] <= k[3] && (best < 0 || area(p) <= area(PL[best]))) best = n;
    });
    return best;
  };
  const regions: RawRegion[] = PL.map((p, n) => {
    const r = prect[n], par = parentIx[n] >= 0 ? prect[parentIx[n]] : { l: 0, t: 0 };
    return { id: p.id, kind: 'panel', label: p.label, role: p.role, at: [r1(r.l - par.l), r1(r.t - par.t)], size: [r1(r.r - r.l), r1(r.b - r.t)], regions: [], nodes: [] };
  });
  const top: RawRegion[] = [], topNodes: RawNode[] = [];
  regions.forEach((r, n) => (parentIx[n] >= 0 ? regions[parentIx[n]].regions!.push(r) : top.push(r)));
  for (const c of board.cards) {
    const [x, y] = cardAt(board.cards.indexOf(c)), h = holder(c), par = h >= 0 ? prect[h] : { l: 0, t: 0 };
    const node: RawNode = { id: c.id, asset: 'card', role: c.role, ghost: c.ghost || undefined, at: [r1(x - par.l), r1(y - par.t)], size: [g.W, g.D, g.H] };
    (h >= 0 ? regions[h].nodes! : topNodes).push(node);
  }
  for (const r of regions) { if (!r.regions!.length) delete r.regions; if (!r.nodes!.length) delete r.nodes; }
  const routes: RawRoute[] = (board.links ?? []).map((l, i) => ({ id: l.id ?? `link-${i}`, from: l.aOn ?? l.a, to: l.bOn ?? l.b, kind: l.kind, label: l.label }));
  return { isodiag: 1, title: opts.title, kinds: opts.kinds, roles: opts.roles, scenes: [{ id: 'board', title: opts.title ?? 'board', regions: top, nodes: topNodes, routes }] };
}
