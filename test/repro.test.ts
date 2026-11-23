// The reproductions and examples: clean builds, no overlapping footprints, labels inside the canvas and clear of
// blocks, and the SVG unchanged from its snapshot (UPDATE_SNAPSHOTS=1 npm test to accept a change).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { compile } from '../src/iso-systems/compile.ts';
import { overlap2 } from '../src/iso-objects/place.ts';
import { polyRectArea, rectArea, silhouette } from '../src/iso-objects/labels.ts';

const THEME = readFileSync(new URL('../themes/default.yaml', import.meta.url), 'utf8');
const USE_CASES = readdirSync(new URL('../examples/scenarios/', import.meta.url)).filter(f => f.endsWith('.yaml')).sort().map(f => 'examples/scenarios/' + f);
const FILES = ['corpus/relay-hub.yaml', 'corpus/fenced-worker.yaml', 'corpus/messaging.yaml', 'examples/demo.yaml', 'examples/gallery.yaml', ...USE_CASES];
const SNAP = new URL('./snapshots/', import.meta.url);

for (const f of FILES) {
  const c = compile(readFileSync(new URL('../' + f, import.meta.url), 'utf8'), THEME);

  test(`${f}: builds with no errors or warnings`, () => {
    assert.deepEqual(c.diags.map(d => `${d.line}:${d.col} ${d.message}`), []);
  });

  test(`${f}: no two node footprints overlap`, () => {
    for (const s of c.scenes) {
      const nodes = s.layout.items.filter(p => p.type === 'node' && !p.node!.nodes?.length);
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        // a node standing on another is not an overlap
        if (a.parent === b || b.parent === a) continue;
        const zOverlap = a.box.z0 < b.box.z1 - 1e-6 && b.box.z0 < a.box.z1 - 1e-6;
        assert.ok(!(zOverlap && overlap2(a.box, b.box)), `${s.id}: "${a.id}" overlaps "${b.id}"`);
      }
    }
  });

  test(`${f}: every label is inside the canvas and clear of every block`, () => {
    for (const s of c.scenes) {
      const [vx, vy, vw, vh] = s.rendered.viewBox;
      const sil = s.layout.items.filter(p => p.type === 'node').map(p => ({ id: p.id, poly: silhouette(p.box) }));
      for (const t of s.rendered.texts) {
        assert.ok(t.x >= vx && t.y >= vy && t.x + t.w <= vx + vw && t.y + t.h <= vy + vh, `${s.id}: label "${t.text}" is outside the canvas`);
        for (const n of sil) {
          const a = polyRectArea(n.poly, { x: t.x + 1, y: t.y + 1, w: t.w - 2, h: t.h - 2 });
          // a label may touch a block's edge; it must not sit on it
          assert.ok(a < t.w * t.h * 0.12, `${s.id}: label "${t.text}" sits on "${n.id}" (${a.toFixed(0)} px²)`);
        }
      }
    }
  });

  test(`${f}: SVG matches its snapshot`, () => {
    mkdirSync(SNAP, { recursive: true });
    for (const s of c.scenes) {
      const name = new URL(`${f.replace(/[/.]/g, '_')}__${s.id}.svg`, SNAP);
      const svg = s.rendered.svg.replace(/></g, '>\n<') + '\n';
      if (process.env.UPDATE_SNAPSHOTS || !existsSync(name)) { writeFileSync(name, svg); continue; }
      const want = readFileSync(name, 'utf8');
      if (want !== svg) {
        const a = want.split('\n'), b = svg.split('\n');
        const i = a.findIndex((l, k) => l !== b[k]);
        assert.fail(`${s.id}: SVG differs from ${name.pathname.split('/').pop()} at line ${i + 1}:\n  was: ${a[i]?.slice(0, 160)}\n  now: ${b[i]?.slice(0, 160)}\n(UPDATE_SNAPSHOTS=1 npm test to accept)`);
      }
    }
  });
}

// At every step of both reproductions: no label, sublabel or callout overlaps another, or sits on a node.
for (const f of ['corpus/relay-hub.yaml', 'corpus/fenced-worker.yaml', 'corpus/messaging.yaml', 'examples/demo.yaml', ...USE_CASES]) {
  test(`${f}: at every step, labels and callouts overlap neither each other nor any node`, () => {
    const c = compile(readFileSync(new URL('../' + f, import.meta.url), 'utf8'), THEME);
    const problems: string[] = [];
    for (const s of c.scenes) {
      const st = s.steps, N = Math.max(1, st.steps.length);
      for (let i = 0; i < N; i++) {
        const visible = (id?: string) => !id || !st.vis[id] || st.vis[id][i];
        const labels = s.rendered.texts.filter(t => visible(t.owner)).map(t => ({ ...t, who: t.owner ?? t.text }));
        const calls = s.rendered.callouts.filter(cl => cl.step === i + 1).map(cl => ({ ...cl, who: 'callout ' + cl.text }));
        const nodes = s.layout.items.filter(p => p.type === 'node' && visible(p.id)).map(p => ({ id: p.id, poly: silhouette(p.box) }));
        const boxes = [...labels, ...calls];
        for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
          const A = boxes[a], B = boxes[b];
          if (A.who === B.who) continue;           // a label's own two lines
          const o = rectArea(A, B);
          if (o > 2) problems.push(`step ${i + 1}: "${A.text}" overlaps "${B.text}" (${o.toFixed(0)} px²)`);
        }
        for (const t of boxes) for (const n of nodes) {
          const o = polyRectArea(n.poly, { x: t.x + 1, y: t.y + 1, w: t.w - 2, h: t.h - 2 });
          if (o > 4) problems.push(`step ${i + 1}: "${t.text}" sits on node "${n.id}" (${o.toFixed(0)} px²)`);
        }
      }
    }
    assert.deepEqual([...new Set(problems)], []);
  });
}
