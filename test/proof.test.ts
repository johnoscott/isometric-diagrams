// The proof sheet: a frame per step, each frame's YAML exactly its source lines, every id in the catalog, frames in
// the step's state, and a snapshot of the messaging sheet (its hash; UPDATE_SNAPSHOTS=1 to accept).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compile } from '../src/iso-systems/compile.ts';
import { renderProof, stepYaml, frameSvg, alongPath } from '../src/proof/proof.ts';

const THEME = readFileSync(new URL('../themes/default.yaml', import.meta.url), 'utf8');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

for (const f of ['corpus/messaging.yaml', 'corpus/fenced-worker.yaml', 'examples/demo.yaml', 'examples/scenarios/g-coordinating-workers.yaml']) {
  test(`${f}: a frame per step, each with its own YAML lines, and every id in the catalog`, () => {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    const lines = src.split(/\r?\n/);
    const c = compile(src, THEME);
    assert.ok(c.ok);
    const html = renderProof(c, { liveHref: 'x.live.html', fileName: f });
    c.scenes.forEach((s, si) => {
      s.steps.steps.forEach((st, i) => {
        assert.ok(html.includes(`id="f-${s.id}-${String(st.n).padStart(2, '0')}"`), `${s.id}: frame for step ${st.n}`);
        assert.ok(html.includes(`x.live.html#scene=${s.id}&amp;step=${i + 1}`), `${s.id}: live link for step ${i + 1}`);
        const y = stepYaml(c, si, i)!;
        assert.ok(y, `${s.id} step ${i + 1}: a YAML span`);
        assert.deepEqual(y.lines, lines.slice(y.start - 1, y.end), 'the excerpt is the source lines');
        assert.match(y.lines[0], /^\s*- /, 'it starts at the step\'s own "- "');
        // printed with its line numbers
        assert.ok(html.includes(`<span class="ln">${y.start}</span>${esc(y.lines[0])}`), `${s.id} step ${i + 1}: printed from line ${y.start}`);
      });
      for (const p of s.layout.items) assert.ok(html.includes(`id="c-${s.id}-${p.id}"`), `${s.id}: catalog lists ${p.id}`);
      for (const r of s.routes) assert.ok(html.includes(`id="c-${s.id}-${r.id}"`), `${s.id}: catalog lists route ${r.id}`);
    });
  });
}

test('frames show their step: focus, things that appear later, tokens three quarters along', () => {
  const c = compile(readFileSync(new URL('../corpus/messaging.yaml', import.meta.url), 'utf8'), THEME);
  const s = c.scenes[0], steps = s.steps.steps;
  // step 22 focuses on the human's pad: a smaller view than the whole drawing
  const last = frameSvg(s, steps.length - 1, 't');
  const vb = /viewBox="([^"]+)"/.exec(last)![1].split(' ').map(Number);
  assert.ok(vb[2] < s.rendered.viewBox[2] * 0.6, 'focus zooms in');
  // step 5 animates r5: one token on it, at 3/4 of its length
  const f5 = frameSvg(s, 4, 't');
  assert.equal((f5.match(/class="tok"/g) ?? []).length, 1);
  const [x, y] = alongPath(s.rendered.paths['r5'], 0.75);
  assert.ok(f5.includes(`cx="${Math.round(x * 10) / 10}" cy="${Math.round(y * 10) / 10}"`.replace(/\.0"/g, '"')), 'the token is 3/4 along r5');
  assert.match(f5, /<svg [^>]*class="focus dim-all"/);
  assert.match(f5, /data-hl="r5"[^>]*class="hl"|class="hl"[^>]*data-hl="r5"/, 'the step\'s route is lit');
  // ids are unique per frame
  assert.match(f5, /id="t-ah-scene1-send"/);
});

test('the messaging proof sheet is stable (snapshot)', () => {
  const src = readFileSync(new URL('../corpus/messaging.yaml', import.meta.url), 'utf8');
  const a = renderProof(compile(src, THEME), { liveHref: 'messaging.live.html', withIntro: true, fileName: 'messaging.yaml' });
  const b = renderProof(compile(src, THEME), { liveHref: 'messaging.live.html', withIntro: true, fileName: 'messaging.yaml' });
  assert.equal(a, b, 'deterministic');
  const hash = createHash('sha256').update(a).digest('hex');
  const snap = new URL('./snapshots/proof-messaging.sha256', import.meta.url);
  if (process.env.UPDATE_SNAPSHOTS || !existsSync(snap)) { writeFileSync(snap, hash + '\n'); return; }
  const want = readFileSync(snap, 'utf8').trim();
  if (want !== hash) {
    const out = join(mkdtempSync(join(tmpdir(), 'isodiag-proof-')), 'proof.html');
    writeFileSync(out, a);
    assert.fail(`the proof sheet changed (new one: ${out}); UPDATE_SNAPSHOTS=1 npm test to accept`);
  }
});
