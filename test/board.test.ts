// A board both ways (0.6.0, src/iso-objects/board.ts), and the 2D view drawn (src/iso-viewer/flat-view.ts): a board
// drawn in 3D through the engine reads back as the same board; a drawing in the engine's own format gives a board
// (near-aligned boxes sharing a column, two in one cell split, regions nesting as panels); the 2D SVG carries the ids
// selection needs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileRaw } from '../src/iso-objects/compile.ts';
import { boardOf, boardDiagram, boardCatalog } from '../src/iso-objects/board.ts';
import { layoutFlat, metricsMeasure, type Board } from '../src/iso-objects/flat.ts';
import { flatSvg, flatCss } from '../src/iso-viewer/flat-view.ts';
import { compile } from '../src/iso-systems/compile.ts';
import { MODEL, checkLayout } from './fixtures/flat/check.ts';

const THEME = readFileSync(new URL('../themes/default.yaml', import.meta.url), 'utf8');
const ROLES = { orange: { h: 24, s: 78 }, tan: { h: 28, s: 58 }, yellow: { h: 46, s: 74 } };
const KINDS = { own: { color: 'control', dash: 'solid' as const }, ref: { color: 'send', dash: 'dashed' as const }, derived: { color: 'reply', dash: 'dotted' as const } };

test('a board drawn in 3D (boardDiagram) reads back as the same board (boardOf): cells, panels, links', () => {
  const c = compileRaw(boardDiagram(MODEL, { roles: ROLES, kinds: KINDS }), THEME, boardCatalog(MODEL));
  assert.deepEqual(c.diags.filter(d => d.severity === 'error'), []);
  const back = boardOf(c.scenes[0]);
  const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map(x => [x.id, x]));
  const cards = byId(back.cards);
  // (the 3D card shows the board's text, not a node label, so the text read back is the id: a page passes the board)
  for (const k of MODEL.cards) assert.deepEqual([cards[k.id].cell, cards[k.id].role], [k.cell, k.role], k.id);
  assert.match(c.scenes[0].rendered.svg, /class="card-name"[^>]*>Owned \+ lifetime</, 'the card shows its text');
  assert.deepEqual(back.panels.map(p => [p.id, p.cells, p.label]).sort(), MODEL.panels!.map(p => [p.id, p.cells, p.label]).sort());
  assert.deepEqual(back.links.map(l => [l.a, l.b, l.kind, l.label]), MODEL.links!.map(l => [l.aOn ?? l.a, l.bOn ?? l.b, l.kind, l.label]));
  // every card and panel is drawn, under its id
  for (const id of [...MODEL.cards.map(k => k.id), ...MODEL.panels!.map(p => p.id)]) assert.match(c.scenes[0].rendered.svg, new RegExp(`data-id="${id}"`), id);
});

test('a drawing in the engine\'s own format gives its board: nested regions as panels, near-aligned boxes in one column', () => {
  const c = compile(readFileSync(new URL('../examples/boards/network.yaml', import.meta.url), 'utf8'), THEME);
  assert.deepEqual(c.diags.filter(d => d.severity === 'error'), []);
  const b = boardOf(c.scenes[0]);
  const cell = Object.fromEntries(b.cards.map(k => [k.id, k.cell]));
  // work-b sits 0.1 further right than nat-b (gap 2.1, not 2): the same column all the same
  const sc = c.scenes[0].layout.byId;
  assert.notEqual(sc.get('work-b')!.box.x0, sc.get('nat-b')!.box.x0, 'the fixture is near-aligned, not aligned');
  assert.equal(cell['work-b'][0], cell['nat-b'][0]);
  assert.equal(cell['app-a'][0], cell['lb-a'][0]);
  const P = Object.fromEntries(b.panels.map(p => [p.id, p]));
  for (const id of ['region', 'zone-a', 'zone-b', 'pub-a', 'priv-a', 'pub-b', 'priv-b', 'data']) assert.ok(P[id], id);
  const L = layoutFlat(b, metricsMeasure);
  const LP = Object.fromEntries(L.panels.map(p => [p.id, p]));
  assert.equal(LP['pub-a'].parent, 'zone-a'); assert.equal(LP['zone-a'].parent, 'region');
  assert.deepEqual(checkLayout(L), []);
  assert.equal(L.links.length, 11);
});

test('a nested drawing (four levels, from a real page): its board keeps every rule, no empty bands across or down', () => {
  const c = compile(readFileSync(new URL('./fixtures/flat/arch.yaml', import.meta.url), 'utf8'), THEME);
  assert.deepEqual(c.diags.filter(d => d.severity === 'error'), []);
  const b = boardOf(c.scenes[0]);
  const cell = Object.fromEntries(b.cards.map(k => [k.id, k.cell]));
  // the owned row packs to its own columns (it shared the places' before: 450 px of nothing)
  assert.deepEqual([cell.channel, cell.folder, cell.data], [[0, 2], [1, 2], [2, 2]]);
  const L = layoutFlat(b, metricsMeasure);
  assert.deepEqual(checkLayout(L), []);
  assert.deepEqual(L.warnings, []);
  console.log(`# the nested drawing: ${Math.round(L.bounds.r - L.bounds.l)} × ${Math.round(L.bounds.b - L.bounds.t)}`);
});

test('wrap: a wide drawing wrapped for a 4:3 frame is drawn larger in it, keeps every rule, and keeps its order', () => {
  const c = compile(readFileSync(new URL('./fixtures/flat/arch.yaml', import.meta.url), 'utf8'), THEME);
  const b = boardOf(c.scenes[0]);
  const fit = (L: ReturnType<typeof layoutFlat>, a: number) => Math.max(L.bounds.r - L.bounds.l, (L.bounds.b - L.bounds.t) * a);
  const plain = layoutFlat(b, metricsMeasure), wrapped = layoutFlat(b, metricsMeasure, { wrap: { aspect: 4 / 3 } });
  assert.ok(fit(wrapped, 4 / 3) < fit(plain, 4 / 3) * 0.95, `${fit(wrapped, 4 / 3)} vs ${fit(plain, 4 / 3)}`);
  assert.deepEqual(checkLayout(wrapped), []);
  assert.equal(wrapped.cards.length, plain.cards.length);
  // what was left of what stays before it, reading across then down
  const at = (L: typeof plain, id: string) => L.cards.find(k => k.id === id)!.rect;
  for (const [x, y] of [['builder', 'reviewer'], ['channel', 'folder'], ['folder', 'data'], ['daemon', 'msg'], ['msg', 'grants']]) {
    const A = at(wrapped, x), B = at(wrapped, y);
    assert.ok(A.t < B.t || (A.t === B.t && A.l < B.l), `${x} before ${y}`);
  }
  // off unless asked: the model board is as the reference has it (flat.test.ts)
  assert.deepEqual(layoutFlat(MODEL, metricsMeasure, {}), layoutFlat(MODEL, metricsMeasure));
});

test('boardOf: a card is a column right of what is left of it and a row below what is above it; two in one cell part', () => {
  const doc = (xs: [string, number, number][]) => ({ isodiag: 1 as const, scenes: [{ id: 's', title: 's', nodes: xs.map(([id, x, y]) => ({ id, asset: 'card', at: [x, y] as [number, number], size: [4, 2, 0.9] })) }] });
  const cat = boardCatalog({ cards: [] });
  const cells = (xs: [string, number, number][]) => Object.fromEntries(boardOf(compileRaw(doc(xs), THEME, cat).scenes[0]).cards.map(k => [k.id, k.cell]));
  // near-aligned (off by 0.3, 1.9 across; 0.4 down): one column, one row
  assert.deepEqual(cells([['a', 0, 0], ['b', 0.3, 4], ['c', 1.9, 8], ['d', 6, 0.4]]), { a: [0, 0], b: [0, 1], c: [0, 2], d: [1, 0] });
  // below and overlapping it across: the same column, the next row; further down but beside it: the same row
  assert.deepEqual(cells([['a', 0, 0], ['b', 2.1, 4], ['c', 6.5, 4]]), { a: [0, 0], b: [0, 1], c: [1, 0] });
  // one cell twice (overlapping boxes): the later moves right, and what was right of it with it
  assert.deepEqual(cells([['a', 0, 0], ['b', 0.5, 0.5], ['c', 6, 0]]), { a: [0, 0], b: [1, 0], c: [2, 0] });
});

test('the 2D svg: ids on every card and panel, ends on every connector, a label for each, the same every time', () => {
  const L = layoutFlat(MODEL, metricsMeasure);
  const styles = { own: { start: 'diamond' as const, end: 'none' as const }, ref: { end: 'open' as const, dash: '5 4', color: 'send' } };
  const svg = flatSvg(L, { id: 'm', title: 'A data model', styles });
  assert.equal(svg, flatSvg(L, { id: 'm', title: 'A data model', styles }));
  assert.match(svg, /^<svg[^>]* role="img" aria-label="A data model"/);
  for (const k of MODEL.cards) assert.match(svg, new RegExp(`<g class="card k-${k.role}[^"]*" data-id="${k.id}" tabindex="0" role="button"`), k.id);
  for (const p of MODEL.panels!) assert.match(svg, new RegExp(`<g class="panel k-${p.role}" data-id="${p.id}"`), p.id);
  MODEL.links!.forEach((l, i) => assert.match(svg, new RegExp(`<path class="conn k-${l.kind}" d="M[^"]+" data-id="link-${i}" data-a="${l.a}" data-b="${l.b}"`), `link ${i}`));
  assert.equal((svg.match(/<text class="cl /g) ?? []).length, 16);
  assert.match(svg, /<marker id="m-mk-own-diamond"/); assert.match(svg, /<marker id="m-mk-ref-open"/);
  assert.match(svg, /marker-start="url\(#m-mk-own-diamond\)"/);
  assert.match(flatCss(styles), /\.flat \.conn\.k-ref\{stroke:var\(--send\);stroke-dasharray:5 4\}/);
});

test('an empty board, and one with no panels or links, still lay out', () => {
  const one: Board = { cards: [{ id: 'a', label: 'A', cell: [0, 0] }] };
  const L = layoutFlat(one, metricsMeasure);
  assert.deepEqual(L.cards[0].rect, { l: 0, t: 0, r: 178, b: 58 });
  assert.match(flatSvg(L, { id: 'x' }), /data-id="a"/);
});
