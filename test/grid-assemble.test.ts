// Grid snapping, and the assemble intro: start offsets (at build time), and in Chrome: parts start outside the
// canvas, end in place, and reduced motion skips the intro.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compile } from '../src/iso-systems/compile.ts';
import { renderPage } from '../src/iso-viewer/page.ts';
import { playerScript } from '../src/iso-viewer/bundle.ts';
import { offscreen } from '../src/iso-objects/assemble.ts';
import { rectArea } from '../src/iso-objects/labels.ts';
// @ts-ignore plain JS helper
import { chromePath, headless } from '../scripts/chrome.mjs';

const THEME = readFileSync(new URL('../themes/default.yaml', import.meta.url), 'utf8');
const scene = (head: string, body: string) => `isodiag: 1\n${head}scenes:\n  - id: s\n    title: T\n${body}`;
const onGrid = (v: number, s: number) => Math.abs(v / s - Math.round(v / s)) < 1e-9;
const DEMO = readFileSync(new URL('../examples/grid-assemble.yaml', import.meta.url), 'utf8');

// ---- snapping ----

test('with grid.snap, every placed edge and via point lands on the grid, sizes at least one step', () => {
  const c = compile(scene('grid: { snap: 0.5 }\n', `    regions:\n      - id: mac\n        kind: slab\n        padding: 1.3\n        nodes:\n          - { id: a, size: [2.3, 1.7, 1] }\n          - { id: b, right-of: a, gap: 1.7, size: [0.2, 0.2, 1] }\n    routes:\n      - { id: r, from: a.s, to: b.s, via: [[3.5, 4.5]] }\n`), THEME);
  assert.deepEqual(c.diags.filter(d => d.severity === 'error'), []);
  for (const p of c.scenes[0].layout.items) {
    for (const v of [p.box.x0, p.box.x1, p.box.y0, p.box.y1]) assert.ok(onGrid(v, 0.5), `${p.id}: ${v} is not on the 0.5 grid`);
    assert.ok(p.box.x1 - p.box.x0 >= 0.5 - 1e-9 && p.box.y1 - p.box.y0 >= 0.5 - 1e-9, `${p.id} is smaller than a step`);
  }
  const pts = c.scenes[0].routes[0].points;
  const through = pts.slice(1).some((q, i) => { const p = pts[i];
    return Math.min(p[0], q[0]) - 1e-9 <= 3.5 && 3.5 <= Math.max(p[0], q[0]) + 1e-9 && Math.min(p[1], q[1]) - 1e-9 <= 4.5 && 4.5 <= Math.max(p[1], q[1]) + 1e-9; });
  assert.ok(through, 'the path passes through the via point');
});

test('without grid.snap, positions are left alone', () => {
  const c = compile(scene('', `    nodes:\n      - { id: a, at: [0.3, 0.7], size: [2.3, 1.7, 1] }\n`), THEME);
  assert.deepEqual([c.scenes[0].layout.byId.get('a')!.box.x0, c.scenes[0].layout.byId.get('a')!.box.y1], [0.3, 2.4]);
});

test('off-grid at and via values are warnings at their line', () => {
  const c = compile(scene('', `    grid: { snap: 1 }\n    nodes:\n      - { id: a, at: [0.5, 2] }\n      - { id: b, at: [6, 0] }\n    routes:\n      - { id: r, from: a, to: b, via: [[4, 0.25]] }\n`), THEME);
  const w = c.diags.filter(d => d.severity === 'warning').map(d => `${d.line}: ${d.message}`);
  assert.ok(w.some(x => /^7: 0\.5 is not on the 1 grid; it is drawn at (1|0)/.test(x)), w.join('\n'));
  assert.ok(w.some(x => /^10: 0\.25 is not on the 1 grid; it is drawn at 0/.test(x)), w.join('\n'));
});

test('the grid-assemble example is snapped and builds cleanly', () => {
  const c = compile(DEMO, THEME);
  assert.deepEqual(c.diags, []);
  for (const p of c.scenes[0].layout.items) if (!p.placedBy) for (const v of [p.box.x0, p.box.x1, p.box.y0, p.box.y1]) assert.ok(onGrid(v, 0.5), `${p.id}: ${v}`);
  assert.equal(c.scenes[0].assemble, true);
});

// ---- assemble timeline (build time) ----

test('offscreen() picks the nearest edge and moves the box fully outside', () => {
  const vb: [number, number, number, number] = [0, 0, 1000, 600];
  assert.equal(offscreen({ x: 10, y: 250, w: 50, h: 50 }, vb).edge, 'left');
  assert.equal(offscreen({ x: 900, y: 250, w: 50, h: 50 }, vb).edge, 'right');
  assert.equal(offscreen({ x: 480, y: 20, w: 50, h: 50 }, vb).edge, 'top');
  assert.equal(offscreen({ x: 480, y: 520, w: 50, h: 50 }, vb).edge, 'bottom');
});

for (const f of ['examples/grid-assemble.yaml', 'corpus/fenced-worker.yaml', 'corpus/relay-hub.yaml']) {
  test(`${f}: every part starts outside the canvas on its nearest edge, in order, within 2.5 s`, () => {
    const c = compile(readFileSync(new URL('../' + f, import.meta.url), 'utf8'), THEME);
    for (const s of c.scenes) {
      const A = s.rendered.assembly, [vx, vy, vw, vh] = s.rendered.viewBox, V = { x: vx, y: vy, w: vw, h: vh };
      assert.equal(A.pieces.length, s.layout.items.length, 'every region and node is a piece');
      for (const p of A.pieces) {
        const start = { x: p.bbox.x + p.dx, y: p.bbox.y + p.dy, w: p.bbox.w, h: p.bbox.h };
        assert.equal(rectArea(start, V), 0, `${p.id} starts inside the canvas`);
        const cx = p.bbox.x + p.bbox.w / 2, cy = p.bbox.y + p.bbox.h / 2;
        const dist = { left: cx - vx, right: vx + vw - cx, top: cy - vy, bottom: vy + vh - cy };
        assert.equal(dist[p.edge], Math.min(...Object.values(dist)), `${p.id} does not come from its nearest edge`);
        assert.ok((p.edge === 'left' || p.edge === 'right') ? p.dy === 0 : p.dx === 0, `${p.id} moves along one axis`);
      }
      // regions before nodes, outer regions before inner ones
      const firstNode = Math.min(...A.pieces.filter(p => p.kind === 'node').map(p => p.delay));
      assert.ok(A.pieces.filter(p => p.kind === 'region').every(p => p.delay < firstNode));
      assert.ok(A.total >= 1200 && A.total <= 2500, `total ${A.total} ms`);
    }
  });
}

// ---- in the browser ----

let chrome: string | undefined;
try { chrome = chromePath(); } catch { chrome = undefined; }
const tmp = mkdtempSync(join(tmpdir(), 'isodiag-asm-'));
function probe(hash: string, js: string, flags: string[] = [], budget = 6000): string {
  const html = join(tmp, `p-${Math.random().toString(36).slice(2)}.html`);
  const page = renderPage(compile(DEMO, THEME), { runtime: playerScript() }).replace('</body>',
    `<script>addEventListener('load',()=>setTimeout(async()=>{const p=document.createElement('pre');p.id='probe';p.textContent=await (async()=>{${js}})();document.body.appendChild(p)},${Math.min(1200, budget - 1500)}))</script></body>`);
  writeFileSync(html, page);
  const dom = execFileSync(chrome!, [...headless(), '--window-size=1240,1300', `--virtual-time-budget=${budget}`, ...flags, '--dump-dom', `file://${html}#${hash}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return (/<pre id="probe">([^<]*)<\/pre>/.exec(dom)?.[1] ?? 'no probe').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
const PIECES = `[...document.querySelectorAll('.g-base [data-id], .g-blocks [data-id], .g-air [data-id]')]`;

test('in Chrome: at the start of the intro, every part is outside the canvas', { skip: chrome ? false : 'no Chrome' }, () => {
  const out = probe('assemble&at=0', `const s=document.querySelector('svg').getBoundingClientRect();
    const bad=${PIECES}.filter(e=>{const r=e.getBoundingClientRect(); if(!r.width&&!r.height) return false;
      return r.right>s.left+1&&r.left<s.right-1&&r.bottom>s.top+1&&r.top<s.bottom-1;}).map(e=>e.dataset.id);
    return JSON.stringify({n:${PIECES}.length,bad:[...new Set(bad)]});`);
  const r = JSON.parse(out);
  assert.ok(r.n > 5);
  assert.deepEqual(r.bad, []);
});

test('in Chrome: after the intro, every part is in place and the step player runs', { skip: chrome ? false : 'no Chrome' }, () => {
  // the browser's animation clock and headless virtual time drift apart, so wait for the intro to start, then
  // fast-forward it, rather than trusting a fixed delay
  const out = probe('assemble&motion', `const svg0=document.querySelector('svg'); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    for(let i=0;i<50&&svg0.classList.contains('pre-assemble');i++) await sleep(50);
    document.getAnimations().forEach(a=>{ if(a.constructor===Animation) a.finish(); }); await sleep(100);
    const moved=${PIECES}.filter(e=>{const t=getComputedStyle(e).transform;return t!=='none'&&t!=='matrix(1, 0, 0, 1, 0, 0)'}).map(e=>e.dataset.id);
    const svg=document.querySelector('svg');
    const playing=document.querySelector('[data-a=play]').textContent.includes('Pause');
    return JSON.stringify({anims:document.getAnimations().filter(a=>a.constructor===Animation&&a.playState==='running').length,moved,pre:svg.classList.contains('pre-assemble'),focus:svg.classList.contains('focus'),playing});`, [], 12000);
  assert.deepEqual(JSON.parse(out), { anims: 0, moved: [], pre: false, focus: true, playing: true });
});

test('in Chrome: reduced motion skips the intro and draws everything in place', { skip: chrome ? false : 'no Chrome' }, () => {
  // Count only animations made by script (the intro uses the Web Animations API). CSS transitions (opacity fades when
  // a step's classes change) are also in getAnimations(), and whether one is still running at this moment is timing;
  // counting them made this test flaky. Displacement is checked directly as well.
  const out = probe('', `const svg=document.querySelector('svg');
    const moved=${PIECES}.filter(e=>{const t=getComputedStyle(e).transform;return t!=='none'&&t!=='matrix(1, 0, 0, 1, 0, 0)'}).length;
    return JSON.stringify({anims:document.getAnimations().filter(a=>a.constructor===Animation).length,moved,pre:svg.classList.contains('pre-assemble'),all:svg.classList.contains('all'),btn:document.querySelector('[data-a=assemble]').disabled});`,
    ['--force-prefers-reduced-motion'], 3000);
  assert.deepEqual(JSON.parse(out), { anims: 0, moved: 0, pre: false, all: true, btn: true });
});
