// The 2D view's layout (0.6.0, src/iso-objects/flat.ts): the model board laid out exactly as the reference
// (test/fixtures/flat/er2d-reference.ts, the kit's erScene2D) lays out the same drawing; then what the reference has
// no answer for: nested panels, links to a panel that holds their end, boards with errors, a board made from an
// engine drawing (board.ts), reproducibility and a time budget on a large board.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutFlat, metricsMeasure, boardErrors, type Board } from '../src/iso-objects/flat.ts';
import { MODEL, checkLayout, bigBoard } from './fixtures/flat/check.ts';
import { erScene2DRef, type RefEnt, type RefPlate, type RefConn } from './fixtures/flat/er2d-reference.ts';


/** a board in the reference's own shape */
function asRef(b: Board) {
  const ENT: Record<string, RefEnt> = {};
  for (const c of b.cards) ENT[c.id] = { c: c.cell, name: c.label, sub: c.sub };
  const P = b.panels ?? [];
  const PLATES: RefPlate[] = P.map(p => ({ i0: p.cells[0], j0: p.cells[1], i1: p.cells[2], j1: p.cells[3], label: p.label ?? '', sub: p.sub }));
  const at = (id?: string) => (id === undefined ? undefined : '@' + P.findIndex(p => p.id === id));
  const CONNS: RefConn[] = (b.links ?? []).map(l => ({ a: l.a, b: l.b, a2: at(l.aOn), b2: at(l.bOn), k: l.kind ?? '', t: l.label }));
  return { ENT, PLATES, CONNS };
}

test('the model board is laid out exactly as the reference lays it out: cards, panels, titles, routes', () => {
  const { ENT, PLATES, CONNS } = asRef(MODEL);
  const ref = erScene2DRef(ENT, PLATES, CONNS, metricsMeasure);
  const L = layoutFlat(MODEL, metricsMeasure);
  for (const c of L.cards) assert.deepEqual(c.rect, ref.R[c.id], `card ${c.id}`);
  L.panels.forEach((p, n) => { assert.deepEqual(p.rect, ref.R['@' + n], `panel ${p.id}`); assert.deepEqual(p.title, ref.TITLES[n], `title ${p.id}`); });
  assert.equal(ref.routes.length, 16);
  assert.deepEqual(L.links.map(l => ({ a: l.a, b: l.b, pts: l.points })), ref.routes);
  assert.deepEqual(L.warnings, []);
});

test('labels go where no line is, every line drawn: the reference placed each before the lines after it (four of its 16 sit on one), these sit on none', () => {
  const { ENT, PLATES, CONNS } = asRef(MODEL);
  const ref = erScene2DRef(ENT, PLATES, CONNS, metricsMeasure);
  const L = layoutFlat(MODEL, metricsMeasure);
  const box = (x: number, y: number, an: string, t: string) => { const w = metricsMeasure(t, 'label') + 6, l = an === 'middle' ? x - w / 2 : an === 'end' ? x - w : x; return { l, r: l + w, t: y - 11, b: y + 3 }; };
  const on = (q: { l: number; r: number; t: number; b: number }, own: number) => L.links.filter((l, i) => i !== own && l.points.some((p, k) => k > 0 && Math.min(p[0], l.points[k - 1][0]) < q.r && Math.max(p[0], l.points[k - 1][0]) > q.l && Math.min(p[1], l.points[k - 1][1]) < q.b && Math.max(p[1], l.points[k - 1][1]) > q.t)).length;
  const labelled = MODEL.links!.map((l, i) => [l, i] as const).filter(([l]) => l.label);
  const kitOnLines = labelled.filter(([l, i], n) => on(box(ref.labels[n].x, ref.labels[n].y, ref.labels[n].anchor, l.label!), i)).map(([l]) => l.label);
  assert.deepEqual(kitOnLines, ['1 : 1 document', '* lines → 1 blob each', 'external {account}', 'requests → the owner grants']);
  assert.deepEqual(labelled.filter(([, i]) => on(L.links[i].at!.box, i)).map(([l]) => l.label), []);
  // the others are where the reference put them, but the one after a moved label
  const same = labelled.filter(([, i], n) => L.links[i].at!.x === Math.round(ref.labels[n].x * 10) / 10 && L.links[i].at!.y === Math.round(ref.labels[n].y * 10) / 10).length;
  assert.equal(same, 16 - 5);
});

test('the model board keeps the rules: no route through a card or a title, ends on edges, labels clear', () => {
  assert.deepEqual(checkLayout(layoutFlat(MODEL, metricsMeasure)), []);
});

test('a layout is reproducible: twice the same, to the value', () => {
  assert.deepEqual(layoutFlat(MODEL, metricsMeasure), layoutFlat(MODEL, metricsMeasure));
});

// ---- beyond the reference ----

/** two levels of panels (a region holding two zones, each holding a subnet), links to a panel that holds their end */
const NESTED: Board = {
  cards: [
    { id: 'web-a', label: 'Web', sub: 'zone a', cell: [0, 0] }, { id: 'app-a', label: 'App', sub: 'zone a', cell: [0, 1] },
    { id: 'web-b', label: 'Web', sub: 'zone b', cell: [1, 0] }, { id: 'app-b', label: 'App', sub: 'zone b', cell: [1, 1] },
    { id: 'db', label: 'Database', cell: [2, 1] }, { id: 'users', label: 'Users', cell: [3, 0] },
  ],
  panels: [
    { id: 'region', label: 'REGION', sub: 'west', cells: [0, 0, 2, 1] },
    { id: 'zone-a', label: 'ZONE A', cells: [0, 0, 0, 1] },
    { id: 'zone-b', label: 'ZONE B', cells: [1, 0, 1, 1] },
    { id: 'pub-a', label: 'public', cells: [0, 0, 0, 0] },
  ],
  links: [
    { a: 'users', b: 'web-a', label: 'HTTPS' }, { a: 'users', b: 'web-b', label: 'HTTPS' },
    { a: 'app-a', b: 'db', label: 'SQL' }, { a: 'app-b', b: 'db', label: 'SQL' },
    { a: 'web-a', b: 'pub-a', label: 'in its subnet' },          // a card to the panel holding it
    { a: 'zone-b', b: 'region', label: 'in the region' },        // a panel to the panel holding it
    { a: 'users', b: 'region', label: 'enters' },                // a card to a panel from outside
  ],
};

test('nested panels: each holds its children with PAD round them (and TITLE below), siblings a channel apart', () => {
  const L = layoutFlat(NESTED, metricsMeasure), o = L.options;
  const P = Object.fromEntries(L.panels.map(p => [p.id, p])), C = Object.fromEntries(L.cards.map(c => [c.id, c.rect]));
  assert.equal(P['zone-a'].parent, 'region'); assert.equal(P['pub-a'].parent, 'zone-a'); assert.equal(P['pub-a'].depth, 2);
  assert.equal(P['pub-a'].rect.l, C['web-a'].l - o.PAD);
  assert.equal(P['zone-a'].rect.l, P['pub-a'].rect.l - o.PAD, 'zone a: PAD round the subnet it holds');
  assert.equal(P.region.rect.l, P['zone-a'].rect.l - o.PAD);
  assert.equal(P['zone-a'].rect.b, C['app-a'].b + o.PAD + o.TITLE);
  assert.equal(C['app-a'].t, P['pub-a'].rect.b + o.CH, 'below the subnet (its title in it): the channel, then the next card');
  assert.equal(P['zone-b'].rect.l - P['zone-a'].rect.r, o.CH, 'two zones: a free channel between');
  assert.ok(P.region.rect.r <= C.users.l - o.CH, 'outside the region: a channel');
  assert.deepEqual(checkLayout(L), []);
  assert.deepEqual(L.warnings, []);
});

test('a link to the panel that holds its end ends on that panel\'s inner border, crossing nothing', () => {
  const L = layoutFlat(NESTED, metricsMeasure);
  const P = Object.fromEntries(L.panels.map(p => [p.id, p.rect]));
  for (const [i, holder] of [[4, 'pub-a'], [5, 'region']] as const) {
    const l = L.links[i], end = l.points[l.points.length - 1], r = P[holder];
    assert.equal(l.points.length, 2, 'straight');
    assert.ok([r.l, r.r].includes(end[0]) || [r.t, r.b].includes(end[1]), `${l.id} ends on ${holder}'s border`);
    const s = l.points[0];
    assert.ok(s[0] >= r.l && s[0] <= r.r && s[1] >= r.t && s[1] <= r.b, 'from inside it');
  }
});

test('a board with errors is refused, saying each: duplicate ids (cards and panels share them), missing ends, cells', () => {
  const bad: Board = {
    cards: [{ id: 'a', label: 'A', cell: [0, 0] }, { id: 'b', label: 'B', cell: [0, 0] }, { id: 'c', label: 'C', cell: [-1, 0] }],
    panels: [{ id: 'a', label: 'P', cells: [0, 0, 1, 1] }, { id: 'q', cells: [1, 1, 2, 2] }],
    links: [{ a: 'a', b: 'nowhere' }, { a: 'b', b: 'c', bOn: 'b' }],
  };
  const e = boardErrors(bad);
  assert.ok(e.some(m => /duplicate id "a": a card and a panel/.test(m)), e.join('\n'));
  assert.ok(e.some(m => /cards "a" and "b" are both at cell \[0,0\]/.test(m)));
  assert.ok(e.some(m => /card "c": cell must be/.test(m)));
  assert.ok(e.some(m => /panels "a" and "q" overlap/.test(m)));
  assert.ok(e.some(m => /b "nowhere" is no card or panel/.test(m)));
  assert.ok(e.some(m => /bOn "b" is no panel/.test(m)));
  assert.throws(() => layoutFlat(bad, metricsMeasure), /the board has 6 errors/);
});

test('a large board (60 cards, 100 links) keeps the rules (its time: test/flat-perf.test.ts)', () => {
  const big = bigBoard();
  const L = layoutFlat(big, metricsMeasure);
  assert.equal(L.links.filter(l => l.points.length).length, 100);
  assert.deepEqual(checkLayout(L).filter(m => !m.startsWith('label')), [], 'routes keep the rules (labels: least bad when crowded)');
  // crowded, some labels have to touch a line; none sits on a crossing of two
  const segs = L.links.flatMap(l => l.points.slice(1).map((p, k) => [l.points[k], p] as const));
  const crossings: [number, number][] = [];
  for (const [a, b] of segs) for (const [c, d] of segs) {
    if (a[1] !== b[1] || c[0] !== d[0]) continue;
    const x = c[0], y = a[1];
    if (x > Math.min(a[0], b[0]) && x < Math.max(a[0], b[0]) && y > Math.min(c[1], d[1]) && y < Math.max(c[1], d[1])) crossings.push([x, y]);
  }
  const touching = checkLayout(L).filter(m => / on the line of /.test(m)).length;
  console.log(`# ${crossings.length} crossings; labels touching a line: ${touching} of ${L.links.length}`);
  for (const l of L.links) { const q = l.at!.box; assert.ok(!crossings.some(([x, y]) => x > q.l && x < q.r && y > q.t && y < q.b), `the label of ${l.id} is on a crossing`); }
});

// 0.8.2: two panels covering the same cells (an AZ that holds only its VPC): wrapping took each for the other's parent
// and never ended. A cloud diagram's board (test/fixtures/flat/equal-panels.json) wraps now, and narrower.
test('wrap: panels with the same cells (an AZ holding only its VPC) wrap, in time, narrower, and nested as they were', () => {
  const board = JSON.parse(readFileSync(new URL('./fixtures/flat/equal-panels.json', import.meta.url), 'utf8')) as Board;
  const same = board.panels!.filter((p, i, a) => a.some((q, j) => j !== i && q.cells.every((v, k) => v === p.cells[k])));
  assert.deepEqual(same.map(p => p.id), ['az-a', 'prod-vpc'], 'the fixture has two equal panels');
  const plain = layoutFlat(board, metricsMeasure);
  const t = Date.now();
  const L = layoutFlat(board, metricsMeasure, { wrap: { aspect: 4 / 3 } });
  assert.ok(Date.now() - t < 10000, `wrapped in ${Date.now() - t} ms`);
  const w = (x: typeof L) => x.bounds.r - x.bounds.l, h = (x: typeof L) => x.bounds.b - x.bounds.t;
  assert.ok(w(L) / h(L) < w(plain) / h(plain) - 0.5, `narrower: ${Math.round(w(L))}x${Math.round(h(L))}, was ${Math.round(w(plain))}x${Math.round(h(plain))}`);
  // the VPC still inside the AZ, inside the region
  const r = (id: string) => L.panels.find(p => p.id === id)!.rect;
  const inside = (a: { l: number; t: number; r: number; b: number }, b: typeof a) => a.l >= b.l && a.t >= b.t && a.r <= b.r && a.b <= b.b;
  assert.ok(inside(r('prod-vpc'), r('az-a')) && inside(r('az-a'), r('us-east')));
});
