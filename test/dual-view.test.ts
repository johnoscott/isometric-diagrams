// The two views and the morph in Chrome (0.6.0): the demo page (examples/boards/demo-page.ts) with both drawings.
// Both views carry the same ids; the switch morphs both ways (and is remembered); a selection and the keyboard focus
// hold through it; a switch in the middle of a morph leaves nothing behind; reduced motion swaps at once; the layouts
// the page made with its own measured text keep the rules; no errors, no CSP violations. Skipped without Chrome.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundlePage, drivePage } from './adapters/page-driver.ts';
import { DEMO_PAGE, DEMO_SCHEMAS } from '../scripts/dual-demo.ts';
import { checkLayout, MODEL } from './fixtures/flat/check.ts';
import type { FlatLayout } from '../src/iso-objects/flat.ts';
// @ts-ignore plain JS helper
import { chromePath } from '../scripts/chrome.mjs';

let chrome: string | undefined;
try { chrome = chromePath(); } catch { chrome = undefined; }

test('the two views in Chrome: ids, the switch both ways, selection and focus through it, an interrupted morph, reduced motion', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  const b = await bundlePage(DEMO_PAGE, DEMO_SCHEMAS);
  await drivePage(chrome!, b.outputFiles![0].contents, '__dual', async ({ ev, until, cdp }) => {
    const motion = (value: 'reduce' | 'no-preference') => cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });
    await motion('no-preference');
    await until(`document.title === 'ready'`, 'the page mounts');
    assert.equal(await ev<number>(`return B.diags.length;`), 0);

    // the same ids in both views: every card and panel, every connector's ends
    const ids = await ev<{ d3: string[]; d2: string[]; c3: string[]; c2: string[]; label2: string | null }>(`const v = B.views.model;
      const of = (m, sel, f) => [...new Set([...v.svgOf(m).querySelectorAll(sel)].map(f))].sort();
      return { d3: of('3d', 'g[data-id]:not([data-a])', e => e.dataset.id), d2: of('2d', 'g[data-id]', e => e.dataset.id),
        c3: of('3d', '[data-a]', e => e.dataset.a + '>' + e.dataset.b), c2: of('2d', '[data-a]', e => e.dataset.a + '>' + e.dataset.b),
        label2: v.svgOf('2d').getAttribute('aria-label') };`);
    for (const id of [...MODEL.cards.map(c => c.id), ...MODEL.panels!.map(p => p.id)]) { assert.ok(ids.d3.includes(id), `3D: ${id}`); assert.ok(ids.d2.includes(id), `2D: ${id}`); }
    assert.equal(ids.c2.length, 16);
    assert.deepEqual(ids.c2.filter(x => !ids.c3.includes(x)), [], 'every 2D connector joins what a 3D one joins');
    assert.equal(ids.label2, 'A data model');

    // the switch: two buttons, aria-pressed, keyboard reachable; to 2D, animated, remembered
    const sw = await ev<{ role: string | null; pressed: (string | null)[]; tab: boolean[] }>(`const s = B.toggle; return { role: s.getAttribute('role'), pressed: [...s.querySelectorAll('button')].map(b => b.getAttribute('aria-pressed')), tab: [...s.querySelectorAll('button')].map(b => b.tabIndex >= 0) };`);
    assert.deepEqual(sw, { role: 'group', pressed: ['true', 'false'], tab: [true, true] });
    await ev(`B.toggle.querySelector('[data-mode="2d"]').click(); await tick(120);`);
    assert.equal(await ev<number>(`return document.querySelectorAll('.dual-morph').length;`), await ev<number>(`return Object.keys(B.views).length;`), 'every drawing morphs, each on its own layer');
    await until(`!document.querySelector('.dual-morph') && Object.values(B.views).every(v => v.root.dataset.mode === '2d')`, 'the morph ends in 2D');
    assert.equal(await ev<string>(`return localStorage.getItem('iso-view');`), '2d');
    assert.deepEqual(await ev<(string | null)[]>(`return [...B.toggle.querySelectorAll('button')].map(b => b.getAttribute('aria-pressed'));`), ['false', 'true']);

    // a click selects in 2D; the selection and its connectors show in both views; focus follows it through the switch
    await ev(`const g = B.views.model.svgOf('2d').querySelector('[data-id="member"]'); g.focus(); g.dispatchEvent(new MouseEvent('click', { bubbles: true }));`);
    const hot = await ev<{ picked: string[]; sel3: boolean; sel2: boolean; hot2: number; dim2: number }>(`const v = B.views.model;
      return { picked: B.picked, sel3: v.svgOf('3d').querySelector('[data-id="member"]').classList.contains('sel'), sel2: v.svgOf('2d').querySelector('[data-id="member"]').classList.contains('sel'),
        hot2: v.svgOf('2d').querySelectorAll('.conn.hot').length, dim2: v.svgOf('2d').querySelectorAll('.conn.dim').length };`);
    assert.deepEqual(hot.picked, ['model:member']);
    assert.ok(hot.sel2 && hot.sel3, 'selected in both');
    assert.equal(hot.hot2, MODEL.links!.filter(l => l.a === 'member' || l.b === 'member').length);
    assert.equal(hot.hot2 + hot.dim2, 16);
    await ev(`await B.views.model.morph('3d');`);
    const after = await ev<{ mode: string; focus: string | undefined; in3d: boolean; sel: boolean }>(`const a = document.activeElement;
      return { mode: B.views.model.mode, focus: a?.dataset?.id, in3d: !!a?.closest('[data-view="3d"]'), sel: B.views.model.svgOf('3d').querySelector('[data-id="member"]').classList.contains('sel') };`);
    assert.deepEqual(after, { mode: '3d', focus: 'member', in3d: true, sel: true }, 'the selection and the focus came through');

    // interrupted: a second switch in the middle; the first layer goes, the final view is exact
    await ev(`B.opts.model.duration = 2000; B.views.model.morph('2d'); await tick(400); await B.views.model.morph('3d');`);
    await until(`!document.querySelector('.dual-morph')`, 'no layer left');
    const exact = await ev<unknown>(`const v = B.views.model, w3 = v.root.querySelector('.dual-3d'), w2 = v.root.querySelector('.dual-2d');
      return { mode: v.mode, data: v.root.dataset.mode, h3: w3.hidden, h2: w2.hidden, s3: w3.style.cssText, s2: w2.style.cssText, height: v.root.style.height, layers: v.root.querySelectorAll('svg').length };`);
    assert.deepEqual(exact, { mode: '3d', data: '3d', h3: false, h2: true, s3: '', s2: '', height: '', layers: 2 });
    await ev(`B.views.model.morph('2d'); await tick(300); B.views.model.morph('2d'); await tick(50);`);
    assert.equal(await ev<string>(`return B.views.model.root.dataset.mode;`), '2d', 'a switch to the view a morph is going to finishes it');
    await ev(`B.opts.model.duration = 600;`);

    // reduced motion: an instant swap, no layer
    await motion('reduce');
    const instant = await ev<{ mode: string; layers: number }>(`const p = B.views.model.morph('3d'); const r = { mode: B.views.model.root.dataset.mode, layers: document.querySelectorAll('.dual-morph').length }; await p; return r;`);
    assert.deepEqual(instant, { mode: '3d', layers: 0 });

    // the layouts the page made, measured with its own text, keep the rules (labels clear of cards, titles, each other)
    for (const k of await ev<string[]>(`return Object.keys(B.views);`)) {
      const L = await ev<FlatLayout>(`return B.views.${k}.layout;`);
      assert.deepEqual(checkLayout(L), [], k);
    }
    const bad = await ev<{ violations: string[]; errors: string[] }>(`return { violations: B.violations, errors: B.errors };`);
    assert.deepEqual(bad, { violations: [], errors: [] });
  });
});

test('motion (0.7.3): auto honours reduced motion, always morphs regardless, never swaps at once; an interrupted always-morph still ends exact', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  const b = await bundlePage(DEMO_PAGE, DEMO_SCHEMAS);
  await drivePage(chrome!, b.outputFiles![0].contents, '__dual', async ({ ev, until, cdp }) => {
    await until(`document.title === 'ready'`, 'the page mounts');
    const animates = async (media: 'reduce' | 'no-preference', motion: string) => {
      await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: media }] });
      return ev<boolean>(`const v = B.views.model; B.opts.model.motion = ${JSON.stringify(motion)}; B.opts.model.duration = 400;
        const to = v.mode === '3d' ? '2d' : '3d'; const p = v.morph(to); const layer = !!v.root.querySelector('.dual-morph'); await p;
        if (v.mode !== to || v.root.querySelector('.dual-morph')) throw new Error('not ended exact'); return layer;`);
    };
    const got: Record<string, boolean> = {};
    for (const media of ['reduce', 'no-preference'] as const) for (const motion of ['auto', 'always', 'never']) got[`${media}/${motion}`] = await animates(media, motion);
    assert.deepEqual(got, { 'reduce/auto': false, 'reduce/always': true, 'reduce/never': false, 'no-preference/auto': true, 'no-preference/always': true, 'no-preference/never': false });

    // interrupted, under reduced motion with 'always': the first morph's layer goes, the final view is exact
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await ev(`B.opts.model.motion = 'always'; B.opts.model.duration = 2000; const v = B.views.model; await v.morph('3d'); v.morph('2d'); await tick(300); await v.morph('3d');`);
    await until(`!document.querySelector('.dual-morph')`, 'no layer left');
    const exact = await ev<unknown>(`const v = B.views.model, w3 = v.root.querySelector('.dual-3d'), w2 = v.root.querySelector('.dual-2d');
      return { mode: v.mode, data: v.root.dataset.mode, h3: w3.hidden, h2: w2.hidden, s3: w3.style.cssText, s2: w2.style.cssText, height: v.root.style.height };`);
    assert.deepEqual(exact, { mode: '3d', data: '3d', h3: false, h2: true, s3: '', s2: '', height: '' });
  });
});
