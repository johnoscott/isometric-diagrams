// Routes and steps: orthogonal paths that start and end at node faces, avoid other nodes, step onto platforms;
// step references resolve or fail with suggestions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../src/iso-systems/compile.ts';
import type { P3 } from '../src/iso-core/kernel.ts';

const THEME = readFileSync(new URL('../themes/default.yaml', import.meta.url), 'utf8');
const scene = (body: string) => `isodiag: 1\nscenes:\n  - id: s\n    title: T\n${body}`;
const errs = (src: string) => compile(src, THEME).diags.filter(d => d.severity === 'error');

function orthogonal(pts: P3[]) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const changed = [a[0] !== b[0], a[1] !== b[1], a[2] !== b[2]].filter(Boolean).length;
    assert.ok(changed <= 1 || (Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6) && Math.abs(a[2] - b[2]) < 1e-6, `segment ${i} is not straight: ${a} → ${b}`);
  }
}
const inside = (x: number, y: number, b: { x0: number; y0: number; x1: number; y1: number }, e = 0.01) => x > b.x0 + e && x < b.x1 - e && y > b.y0 + e && y < b.y1 - e;

test('a route between two nodes is orthogonal and starts and ends at their faces', () => {
  const c = compile(scene(`    nodes:\n      - { id: a, at: [0, 0], size: [2, 2, 1] }\n      - { id: b, at: [6, 4], size: [2, 2, 1] }\n    routes:\n      - { id: r, from: a, to: b }\n`), THEME);
  assert.deepEqual(c.diags, []);
  const r = c.scenes[0].routes[0], p = r.points;
  orthogonal(p);
  assert.ok(Math.abs(p[0][0] - 2.05) < 1e-9, 'leaves a from its east face');
  const end = p[p.length - 1];
  assert.ok(Math.abs(end[0] - 5.95) < 1e-9 || Math.abs(end[1] - 3.95) < 1e-9, 'arrives at a face of b');
});

test('routes go around a node in the way', () => {
  const c = compile(scene(`    nodes:\n      - { id: a, at: [0, 0], size: [2, 2, 1] }\n      - { id: wall, at: [4, -1], size: [1, 4, 1] }\n      - { id: b, at: [8, 0], size: [2, 2, 1] }\n    routes:\n      - { id: r, from: a.e, to: b.w }\n`), THEME);
  const p = c.scenes[0].routes[0].points, wall = c.scenes[0].layout.byId.get('wall')!.box;
  orthogonal(p);
  for (let i = 0; i + 1 < p.length; i++) for (let t = 0; t <= 20; t++) {
    const x = p[i][0] + (p[i + 1][0] - p[i][0]) * t / 20, y = p[i][1] + (p[i + 1][1] - p[i][1]) * t / 20;
    assert.ok(!inside(x, y, wall), `crosses the wall at ${x},${y}`);
  }
});

test('two routes on the same side get separate lanes', () => {
  const c = compile(scene(`    nodes:\n      - { id: a, at: [0, 0], size: [2, 2, 1] }\n      - { id: b, at: [6, 0], size: [2, 2, 1] }\n    routes:\n      - { id: r1, from: a, to: b }\n      - { id: r2, from: b, to: a, kind: reply }\n`), THEME);
  const [r1, r2] = c.scenes[0].routes;
  assert.ok(Math.abs(r1.points[0][1] - r2.points[r2.points.length - 1][1]) >= 0.5);
});

test('a route steps up onto a raised platform at its edge', () => {
  const c = compile(scene(`    regions:\n      - id: p\n        kind: platform\n        at: [5, -1]\n        size: [4, 4]\n        nodes: [{ id: b, at: [1, 1], size: [2, 2, 1] }]\n    nodes:\n      - { id: a, at: [0, 0], size: [2, 2, 1] }\n    routes:\n      - { id: r, from: a.e, to: b.w }\n`), THEME);
  const p = c.scenes[0].routes[0].points;
  const zs = [...new Set(p.map(q => q[2].toFixed(2)))];
  assert.deepEqual(zs, ['0.01', '0.71']);
  const step = p.findIndex((q, i) => i > 0 && q[2] !== p[i - 1][2]);
  assert.equal(p[step][0], 5, 'the step is at the platform edge');
  assert.equal(p[step - 1][0], 5);
});

test('route and step references fail with suggestions', () => {
  const d = errs(scene(`    nodes:\n      - { id: worker }\n      - { id: chat }\n    routes:\n      - { id: w-c, from: workr, to: chat, kind: sned }\n    steps:\n      - { heading: H, animate: [w-x, "w-c: replay"], pulse: [chta] }\n`));
  const m = d.map(x => x.message);
  assert.ok(m.some(x => /unknown node "workr" \(did you mean "worker"\?\)/.test(x)));
  assert.ok(m.some(x => /unknown flow kind "sned" \(did you mean "send"\?\)/.test(x)));
  assert.ok(m.some(x => /unknown route "w-x" \(did you mean "w-c"\?\)/.test(x)));
  assert.ok(m.some(x => /unknown flow kind "replay" \(did you mean "reply"\?\)/.test(x)));
  assert.ok(m.some(x => /unknown node "chta" \(did you mean "chat"\?\)/.test(x)));
});

test('steps: phases, token recolouring, visibility from appears and show/hide', () => {
  const c = compile(scene(`    nodes:\n      - { id: a }\n      - { id: b }\n      - { id: l, appears: two }\n    routes:\n      - { id: r, from: a, to: b }\n    steps:\n      - { heading: One, animate: [r, { r: token }, [r, "r: reply"]] }\n      - { id: two, heading: Two, hide: [b] }\n      - { heading: Three, show: [b] }\n`), THEME);
  assert.deepEqual(c.diags, []);
  const st = c.scenes[0].steps;
  assert.deepEqual(st.steps[0].phases.map(p => p.map(t => t.kind)), [['send'], ['token'], ['send', 'reply']]);
  assert.deepEqual(st.vis.l, [false, true, true]);
  assert.deepEqual(st.vis.b, [true, false, true]);
});

test('step numbers out of range and unknown step ids', () => {
  const d = errs(scene(`    nodes:\n      - { id: a, appears: 4 }\n      - { id: b, appears: tow }\n    steps:\n      - { id: two, heading: H }\n`));
  assert.ok(d.some(x => /there is no step 4; this scene has 1 step/.test(x.message)));
  assert.ok(d.some(x => /unknown step "tow" \(did you mean "two"\?\)/.test(x.message)));
});

test('the demo has every route orthogonal, and builds a player for its steps', () => {
  const c = compile(readFileSync(new URL('../examples/demo.yaml', import.meta.url), 'utf8'), THEME);
  assert.deepEqual(c.diags, []);
  for (const r of c.scenes[0].routes) orthogonal(r.points);
  assert.equal(c.scenes[0].steps.steps.length, 6);
});

test('a floor label that blocks would hide is shortened or dropped, with a warning at its line', () => {
  const c = compile(scene(`    nodes:\n      - { id: a, at: [0, 0], size: [2, 2, 3] }\n      - { id: b, at: [3, 0], size: [2, 2, 3] }\n    routes:\n      - { id: r, from: a, to: b, label: "a very long label that cannot fit between two tall blocks" }\n`), THEME);
  const w = c.diags.filter(d => d.severity === 'warning');
  assert.equal(w.length, 1);
  assert.match(w[0].message, /label .*of route "r" (was dropped|shortened to ".*…")/);
  assert.equal(w[0].line, 9);
});

test('the router\'s open list takes states in exactly the order the array scan it replaced did', async () => {
  const { openList } = await import('../src/iso-objects/route.ts');
  // a seeded generator: pushes and takes interleaved, many equal f (ties are where order matters)
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let run = 0; run < 20; run++) {
    const heap = openList<{ f: number; idx: number; hp: number; id: number }>();
    const arr: { f: number; id: number }[] = [];
    let id = 0;
    for (let step = 0; step < 2000; step++) {
      if (arr.length && rnd() < 0.45) {
        // the old way: the first lowest f; the last moves into its place
        let bi = 0;
        for (let k = 1; k < arr.length; k++) if (arr[k].f < arr[bi].f) bi = k;
        const want = arr[bi]; arr[bi] = arr[arr.length - 1]; arr.pop();
        assert.equal(heap.take().id, want.id, `run ${run}, step ${step}`);
      } else {
        const f = Math.floor(rnd() * 12) * 0.6;
        arr.push({ f, id }); heap.push({ f, idx: 0, hp: 0, id }); id++;
      }
    }
    assert.equal(heap.length(), arr.length);
  }
});
