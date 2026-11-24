// Ants on a still, in Chrome (src/iso-objects/ants.ts): an SVG on its own in an <img> marches; a page's stop when the page says; a
// planned connector stands. In the serial part of the suite: it watches pixels change. Skipped without Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../src/iso-systems/compile.ts';
import { renderSvg } from '../src/iso-systems/render.ts';
import { DRAWING_CSS } from '../src/iso-systems/css.ts';
import { themeCss } from '../src/iso-core/theme.ts';
import { withAnts, ANTS_CSS } from '../src/iso-objects/ants.ts';
import { drivePage } from './adapters/page-driver.ts';
// @ts-ignore plain JS helper
import { chromePath } from '../scripts/chrome.mjs';

let chrome: string | undefined;
try { chrome = chromePath(); } catch { chrome = undefined; }
const read = (f: string) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const THEME = read('themes/default.yaml'), BUILD = compile(read('test/fixtures/motion/stepped-build.yaml'), THEME), KINDS = BUILD.theme!.kinds;

test('ants in Chrome: an SVG alone in an <img> marches, a page\'s can be stopped; a frame of the track is where they are', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  const s = BUILD.scenes[0], alone = renderSvg(read('test/fixtures/motion/stepped-build.yaml'), { theme: THEME, ants: true });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${themeCss(BUILD.theme!)}${DRAWING_CSS}${ANTS_CSS} body{margin:0;background:#fff} img,#css svg{width:600px;display:block}</style></head><body><img id="alone" src="data:image/svg+xml;base64,${Buffer.from(alone).toString('base64')}"><div id="css">${withAnts(s, { by: 'css', kinds: KINDS })}</div></body></html>`;
  for (const motion of ['no-preference', 'reduce']) await drivePage(chrome!, new Uint8Array(), '__n', async ({ ev, until, cdp }) => {
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] });
    await until(`document.getElementById('alone')?.complete && document.querySelector('#css svg')`, 'the image');
    const box = (id: string) => ev<{ x: number; y: number; width: number; height: number }>(`const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height };`);
    const shot = async (id: string) => ((await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...(await box(id)), scale: 1 } })) as { data: string }).data;
    const moves = async (id: string) => { const seen = new Set<string>(); for (let i = 0; i < 8 && seen.size < 2; i++) { seen.add(await shot(id)); await ev(`await tick(90);`); } return seen.size > 1; };
    assert.equal(await moves('alone'), true, `${motion}: the SVG alone marches (a deliberate default: motion plays)`);
    assert.equal(await moves('css'), true, `${motion}: the page's`);
    await ev(`document.getElementById('css').style.setProperty('--ants', 'paused'); await tick(120);`);
    assert.equal(await moves('css'), false, 'stopped by the page');
    assert.equal(await ev<string>(`return getComputedStyle(document.querySelector('#css [data-id="clone"] path')).animationName;`), 'none', 'a planned one stands');
  }, '700,900', { html, csp: null });
});
