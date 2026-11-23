// Per-step focus: the build gives a step the screen box of its focus parts; the player zooms the viewBox to it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compile } from '../src/iso-systems/compile.ts';
import { renderPage } from '../src/iso-viewer/page.ts';
import { playerScript } from '../src/iso-viewer/bundle.ts';
// @ts-ignore plain JS helper
import { chromePath, headless } from '../scripts/chrome.mjs';

const THEME = readFileSync(new URL('../themes/default.yaml', import.meta.url), 'utf8');
const SRC = `isodiag: 1\nscenes:\n  - id: s\n    title: T\n    nodes:\n      - { id: a, at: [0, 0] }\n      - { id: b, at: [20, 0] }\n      - { id: c, at: [0, 20] }\n    steps:\n      - { heading: All }\n      - { heading: Just a, focus: [a] }\n      - { heading: All again }\n`;

test('focus: a step gets the screen box of its parts; an unknown id is an error with a suggestion', () => {
  const c = compile(SRC, THEME);
  assert.deepEqual(c.diags, []);
  const st = c.scenes[0].steps.steps;
  assert.equal(st[0].focus, undefined);
  const [x0, y0, x1, y1] = st[1].focus!;
  const [vx, vy, vw, vh] = c.scenes[0].rendered.viewBox;
  assert.ok(x1 - x0 < vw / 2 && y1 - y0 < vh / 2, 'the focus box is much smaller than the drawing');
  assert.ok(x0 >= vx - 80 && y0 >= vy - 80 && x1 <= vx + vw + 80 && y1 <= vy + vh + 80);
  assert.ok(st[1].lit.includes('a'), 'a focused part is lit');
  const bad = compile(SRC.replace('focus: [a]', 'focus: [aa]'), THEME).diags;
  assert.match(bad[0].message, /unknown node or region "aa" \(did you mean "a"\?\)/);
});

let chrome: string | undefined;
try { chrome = chromePath(); } catch { chrome = undefined; }

test('focus in Chrome: the viewBox zooms in at that step, keeping the proportions', { skip: chrome ? false : 'no Chrome' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'isodiag-focus-'));
  const html = join(dir, 'f.html');
  writeFileSync(html, renderPage(compile(SRC, THEME), { runtime: playerScript() }).replace('</body>',
    // wait for the page to settle, not for a fixed time: fonts loaded, then the viewBox unchanged over three readings
    // 50 ms apart (the player eases it to a step's focus box). Timers, not frames: headless virtual time runs timers
    // but a page drawing no frames gets no animation-frame callbacks.
    `<script>addEventListener('load',async()=>{await document.fonts.ready;const s=document.querySelector('svg');let last='',same=0;
      for(let i=0;i<300&&same<3;i++){await new Promise(r=>setTimeout(r,50));const v=s.getAttribute('viewBox');same=v===last?same+1:0;last=v;}
      const p=document.createElement('pre');p.id='probe';p.textContent=s.getAttribute('viewBox')+(same<3?' unsettled':'');document.body.appendChild(p)})</script></body>`));
  const vb = (step: number) => {
    const dom = execFileSync(chrome!, [...headless(), '--virtual-time-budget=20000', '--dump-dom', `file://${html}#still&step=${step}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const got = /<pre id="probe">([^<]*)<\/pre>/.exec(dom)?.[1];
    assert.ok(got && !got.includes('unsettled'), `step ${step}: the page didn't settle (${got ?? 'no probe'})`);
    return got.split(/\s+/).map(Number);
  };
  const full = vb(1), zoomed = vb(2), back = vb(3);
  assert.ok(zoomed[2] < full[2] * 0.6, `zoomed width ${zoomed[2]} vs full ${full[2]}`);
  assert.ok(Math.abs(zoomed[2] / zoomed[3] - full[2] / full[3]) < 0.01, 'same proportions');
  assert.deepEqual(back.map(Math.round), full.map(Math.round), 'a step without focus shows the whole drawing');
});
