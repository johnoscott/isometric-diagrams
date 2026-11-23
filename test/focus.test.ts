// Per-step focus: the build gives a step the screen box of its focus parts; the player zooms the viewBox to it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../src/iso-systems/compile.ts';
import { renderPage } from '../src/iso-viewer/page.ts';
import { playerScript } from '../src/iso-viewer/bundle.ts';
// @ts-ignore plain JS helper
import { chromePath } from '../scripts/chrome.mjs';
import { drivePage } from './adapters/page-driver.ts';

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

test('focus in Chrome: the viewBox zooms in at that step, keeping the proportions', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  // the page as it is served, its player and all; driven in real time: each step is asked for, then waited for (the
  // player says which step it shows, and the view has stopped moving), never a fixed time
  const html = renderPage(compile(SRC, THEME), { runtime: playerScript() });
  await drivePage(chrome!, new Uint8Array(), '__none', async ({ ev, until, cdp }) => {
    const base = (await ev<string>(`return location.href;`)).split(/[?#]/)[0];
    const vb = async (step: number) => {
      await cdp('Page.navigate', { url: `${base}?step-${step}#still&step=${step}` });
      await until(`location.search === '?step-${step}' && document.readyState === 'complete' && document.querySelectorAll('.dots .dot')[${step - 1}]?.classList.contains('on')`, `step ${step} is the one shown`);
      await until(`(() => { const s = document.querySelector('.figure svg'), v = s.getAttribute('viewBox'); if (window.__vb === v) window.__same = (window.__same ?? 0) + 1; else { window.__vb = v; window.__same = 0; } return window.__same >= 3; })()`, `step ${step}: the view has stopped`);
      return (await ev<string>(`return document.querySelector('.figure svg').getAttribute('viewBox');`)).split(/\s+/).map(Number);
    };
    const full = await vb(1), zoomed = await vb(2), back = await vb(3);
    assert.ok(zoomed[2] < full[2] * 0.6, `zoomed width ${zoomed[2]} vs full ${full[2]}`);
    assert.ok(Math.abs(zoomed[2] / zoomed[3] - full[2] / full[3]) < 0.01, 'same proportions');
    assert.deepEqual(back.map(Math.round), full.map(Math.round), 'a step without focus shows the whole drawing');
  }, '1240,900', { html, csp: null });
});
