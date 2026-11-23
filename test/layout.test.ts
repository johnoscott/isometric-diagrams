// Placement: relative layout, flow, auto-fit regions, heights, gates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../src/iso-systems/compile.ts';
import { overlap2 } from '../src/iso-objects/place.ts';

const THEME = readFileSync(new URL('../themes/default.yaml', import.meta.url), 'utf8');
const scene = (body: string) => `isodiag: 1\nscenes:\n  - id: s\n    title: T\n${body}`;
const boxes = (src: string) => {
  const c = compile(src, THEME);
  assert.deepEqual(c.diags.filter(d => d.severity === 'error'), []);
  return Object.fromEntries(c.scenes[0].layout.items.map(p => [p.id, p.box]));
};

test('right-of, below, left-of, behind with gap and centre alignment', () => {
  const b = boxes(scene(`    gap: 2\n    nodes:\n      - { id: a, at: [0, 0], size: [2, 2, 1] }\n      - { id: r, right-of: a, size: [1, 1, 1] }\n      - { id: d, below: a, size: [1, 1, 1] }\n      - { id: l, left-of: a, size: [1, 1, 1] }\n      - { id: k, behind: a, size: [1, 1, 1] }\n`));
  assert.deepEqual([b.r.x0, b.r.y0], [4, 0.5]);
  assert.deepEqual([b.d.x0, b.d.y0], [0.5, 4]);
  assert.deepEqual([b.l.x0, b.l.y0], [-3, 0.5]);
  assert.deepEqual([b.k.x0, b.k.y0], [0.5, -3]);
});

test('align start and end', () => {
  const b = boxes(scene(`    nodes:\n      - { id: a, at: [0, 0], size: [2, 4, 1] }\n      - { id: s, right-of: a, align: start, size: [1, 1, 1] }\n      - { id: e, right-of: s, align: end, size: [1, 2, 1] }\n`));
  assert.equal(b.s.y0, 0);
  assert.equal(b.e.y1, b.s.y1);
});

test('items with no placement flow in a row, or a column', () => {
  const row = boxes(scene(`    nodes:\n      - { id: a, size: [1, 1, 1] }\n      - { id: b, size: [1, 1, 1] }\n`));
  assert.equal(row.b.x0, row.a.x1 + 2);
  const col = boxes(scene(`    flow: column\n    nodes:\n      - { id: a, size: [1, 1, 1] }\n      - { id: b, size: [1, 1, 1] }\n`));
  assert.equal(col.b.y0, col.a.y1 + 2);
});

test('a region with no size fits its children plus padding', () => {
  const b = boxes(scene(`    regions:\n      - id: mac\n        kind: slab\n        padding: 1\n        nodes:\n          - { id: a, size: [2, 2, 1] }\n          - { id: b, size: [2, 2, 1] }\n`));
  assert.deepEqual([b.mac.x0, b.mac.y0, b.mac.x1, b.mac.y1], [0, 0, 8, 4]);
  assert.deepEqual([b.a.x0, b.a.y0], [1, 1]);
  assert.equal(b.b.x0, 5);
});

test('regions grow to the left when children are placed left-of', () => {
  const b = boxes(scene(`    regions:\n      - id: mac\n        kind: pad\n        padding: 1\n        nodes:\n          - { id: a, size: [2, 2, 1] }\n          - { id: b, left-of: a, size: [2, 2, 1] }\n`));
  assert.equal(b.mac.x0, 0);
  assert.equal(b.b.x0, 1);
  assert.equal(b.a.x0, 5);
});

test('heights: a slab is −0.8..0.35, nodes stand on it, a vm raises its contents, nodes on nodes', () => {
  const b = boxes(scene(`    regions:\n      - id: mac\n        kind: slab\n        nodes:\n          - id: folder\n            asset: folder\n            nodes: [{ id: f, asset: file }]\n        regions:\n          - id: vm\n            kind: vm\n            nodes: [{ id: w, size: [1, 1, 1] }]\n`));
  assert.deepEqual([b.mac.z0, b.mac.z1], [-0.8, 0.35]);
  assert.equal(b.folder.z0, 0.35);
  assert.equal(b.f.z0, b.folder.z1);
  assert.equal(b.vm.z0, 0.35);
  assert.equal(b.w.z0, 0.8);
});

test('a fence gate places its node in the wall', () => {
  const b = boxes(scene(`    regions:\n      - id: fence\n        kind: fence\n        size: [8, 10]\n        gate: { side: w, at: 0.5, width: 3, node: proxy }\n    nodes:\n      - { id: proxy, asset: gate }\n`));
  assert.ok(Math.abs((b.proxy.x0 + b.proxy.x1) / 2 - (b.fence.x0 + 0.08)) < 1e-9);
  assert.equal(b.proxy.y1 - b.proxy.y0, 3);
  assert.equal((b.proxy.y0 + b.proxy.y1) / 2, b.fence.y0 + 5);
});

test('the demo example lays out with no overlaps and every label inside the canvas', () => {
  const src = readFileSync(new URL('../examples/demo.yaml', import.meta.url), 'utf8');
  const c = compile(src, THEME);
  assert.deepEqual(c.diags, []);
  for (const s of c.scenes) {
    const nodes = s.layout.items.filter(p => p.type === 'node');
    for (const p of s.layout.items) {
      const sibs = p.children.filter(k => k.type === 'node' && !k.placedBy);
      for (let i = 0; i < sibs.length; i++) for (let j = i + 1; j < sibs.length; j++) assert.ok(!overlap2(sibs[i].box, sibs[j].box), `${sibs[i].id} overlaps ${sibs[j].id}`);
    }
    assert.ok(nodes.length > 0);
    const [vx, vy, vw, vh] = s.rendered.viewBox;
    for (const t of s.rendered.texts) {
      assert.ok(t.x >= vx && t.y >= vy && t.x + t.w <= vx + vw && t.y + t.h <= vy + vh, `label "${t.text}" outside the canvas`);
    }
  }
});

test('a region can be a ghost; screens can show tiles and a desktop', () => {
  const c = compile(scene(`    regions:\n      - { id: vm, kind: vm, ghost: true, size: [4, 4] }\n      - { id: f, kind: fence, ghost: true, size: [4, 4], right-of: vm }\n    nodes:\n      - { id: t, asset: screen, face: tiles, at: [0, 6] }\n      - { id: c, asset: screen, face: desktop, at: [3, 6] }\n`), THEME);
  assert.deepEqual(c.diags, []);
  const svg = c.scenes[0].rendered.svg;
  assert.match(svg, /class="blk k-sandbox ghost" data-id="vm"/);
  assert.match(svg, /class="blk k-fence wall ghost" data-id="f"/);
  assert.equal((svg.match(/class="t" /g) ?? []).length, 6, 'six terminal tiles');
  assert.equal((svg.match(/class="(wall|bar|win)" /g) ?? []).length, 3, 'a desktop: wallpaper, bar and window');
});
