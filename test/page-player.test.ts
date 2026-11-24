// The page's step player (src/iso-viewer/player.ts) in Chrome, on a clock moved by hand: its steps, tokens, pulses and camera are its
// Timeline's, its lights and words its classes'; the buttons, dots and keys; one clock, stopped when nobody looks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../src/iso-systems/compile.ts';
import { bindMotion, motionOfSteps, motionSource } from '../src/iso-objects/timeline.ts';
import type { MotionDoc } from '../src/iso-objects/motion-doc.ts';
import { alongPath } from '../src/iso-objects/motion.ts';
import { renderPage } from '../src/iso-viewer/page.ts';
import { playerScript } from '../src/iso-viewer/bundle.ts';
import { drivePage, type Driver } from './adapters/page-driver.ts';
// @ts-ignore plain JS helper
import { chromePath } from '../scripts/chrome.mjs';

const read = (f: string) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const THEME = read('themes/default.yaml');
let chrome: string | undefined;
try { chrome = chromePath(); } catch { chrome = undefined; }
const opts = { skip: chrome ? false : 'no Chrome', timeout: 180000 } as const;
const SRC = `isodiag: 1
title: t
scenes:
  - id: s
    title: Steps
    loop: false
    nodes:
      - { id: a, asset: block }
      - { id: b, asset: block, right-of: a, gap: 4 }
      - { id: c, asset: block, right-of: b, gap: 4 }
    routes:
      - { id: r1, from: a, to: b, kind: send }
      - { id: r2, from: b, to: c, kind: token }
      - { id: r3, from: c, to: a, kind: blocked }
    steps:
      - { heading: One, caption: First., animate: [r1, r2], duration: 6000 }
      - { heading: Two, caption: Second., animate: [r3], pulse: [c], focus: [c], duration: 6000 }
      - { heading: Three, caption: Third., animate: [[r1, r2]], highlight: [a], duration: 6000 }
`;
const C = compile(SRC, THEME), S = C.scenes[0], TL = bindMotion(S, motionOfSteps(S));
const go = `
  const st = window.__clk = { now: 0, q: new Map(), id: 0 };
  performance.now = () => st.now;
  window.requestAnimationFrame = f => { st.q.set(++st.id, f); return st.id; };
  window.cancelAnimationFrame = id => st.q.delete(id);
  const set0 = window.setTimeout; window.setTimeout = (f, ms, ...a) => (ms === 100 ? (st.id++, -st.id) : set0(f, ms, ...a));
  window.__go = (ms, n = 1) => { for (let i = 0; i < n; i++) { st.now += ms; const fs = [...st.q.values()]; st.q.clear(); for (const f of fs) f(st.now); } };`;
/** the page, for a reader who asked for this much motion (a page follows it, and the machine's own setting is nobody's to assume) */
const page = (src: string, run: (d: Driver) => Promise<void>, motion: 'no-preference' | 'reduce' = 'no-preference') => async () => {
  const c = compile(src, THEME);
  assert.deepEqual(c.diags.filter(d => d.severity === 'error'), []);
  const html = renderPage(c, { runtime: playerScript(), extraHead: `<script>window.__t={errors:[]};addEventListener('error',e=>__t.errors.push(e.message));${go}</script>` });
  await drivePage(chrome!, new Uint8Array(), '__t', async d => {
    await d.cdp('Page.bringToFront');
    await d.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] });
    await d.until('document.readyState === "complete"', 'the page');
    await d.ev('window.__before = true; location.reload();').catch(() => undefined);
    await d.until('!window.__before && document.readyState === "complete" && window.__go && document.querySelector(".dots")', 'the page, again');
    await run(d);
    assert.deepEqual(await d.ev('return B.errors;'), []);
  }, '1100,900', { html, csp: null });
};
const seen = (d: Driver) => d.ev<{ step: number; play: string; tokens: [number, number][]; pulses: number[][]; viewBox: string; prog: number; heading: string; lit: string[]; frames: number }>(`
  const q = s => document.querySelector(s), svg = q('svg');
  return { step: [...document.querySelectorAll('.dot')].findIndex(x => x.classList.contains('on')), play: q('[data-a=play]').textContent, heading: q('.cap-h .h').textContent,
    tokens: [...svg.querySelectorAll('.g-anim circle')].map(c => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]),
    pulses: [...svg.querySelectorAll('.g-anim ellipse')].map(c => ['cx', 'cy', 'rx', 'ry', 'opacity'].map(k => Number(c.getAttribute(k)))),
    viewBox: svg.getAttribute('viewBox'), prog: parseFloat(q('.prog i').style.width), lit: [...svg.querySelectorAll('[data-hl].hl')].map(e => e.dataset.hl), frames: window.__clk.q.size };`);
/** where the Timeline has the tokens, as points on their routes */
const at = (T: number, A = T) => (TL.at(T, { ambient: A }).tokens ?? []).map(k => alongPath(S.rendered.paths[k.route], k.at).map(v => Math.round(v * 100) / 100));
const started = (d: Driver) => d.until('document.querySelector("[data-a=play]").textContent.includes("Pause")', 'it plays when in view');

test('a page binds the same Timeline from its data as the compiler does', () => {
  for (const [file, doc] of [['test/fixtures/motion/stepped-build.yaml', undefined], ['examples/demo.yaml', undefined], ['corpus/messaging.yaml', undefined]] as const) for (const s of compile(read(file), THEME).scenes) {
    const d = (doc ?? (s.steps.steps.length ? motionOfSteps(s) : undefined)) as MotionDoc | undefined;
    if (!d) continue;
    const a = bindMotion(s, d), b = bindMotion(JSON.parse(JSON.stringify(motionSource(s))), JSON.parse(JSON.stringify(d)));
    assert.deepEqual(b.diags, []); assert.equal(b.duration, a.duration);
    for (let k = 0; k <= 30; k++) assert.deepEqual(b.at(a.duration * k / 30), a.at(a.duration * k / 30));
  }
  // a blocked token stalls short and falls back
  assert.equal(TL.at(6000 + 0.7 * 1150).tokens![0].at, 1); assert.ok(TL.at(6000 + 1149).tokens![0].at < 0.76);
});

test('it plays: tokens and pulses where the Timeline has them, the camera to a step\'s focus, the steps\' lights and words; it stops at the end', opts, page(SRC, async d => {
  await started(d);
  for (const [ms, T] of [[400, 400], [1500, 1900]] as const) {
    await d.ev(`__go(${ms});`);
    const s = await seen(d);
    assert.deepEqual(s.tokens.map(p => p.map(v => Math.round(v * 100) / 100)), at(T), `at ${T}`); assert.equal(s.step, 0); assert.ok(Math.abs(s.prog - T / 60) < 0.1);
  }
  await d.ev('__go(4200);');   // 6100: into the second
  let s = await seen(d);
  assert.equal(s.step, 1); assert.equal(s.heading, 'Two'); assert.deepEqual(s.lit.sort(), ['r3']);
  assert.equal(s.pulses.length, 1); assert.ok(s.pulses[0][4] > 0 && s.pulses[0][4] < 0.95);
  const r0 = s.pulses[0][2];
  await d.ev('__go(500);'); s = await seen(d); assert.ok(s.pulses[0][2] > r0, 'the ring grows');
  await d.ev('__go(600);'); s = await seen(d);
  assert.notEqual(s.viewBox, S.rendered.svg.match(/viewBox="([^"]*)"/)![1]);
  assert.equal(s.viewBox, TL.at(7200).camera!.map(v => String(Math.round(v * 100) / 100)).join(' '));
  await d.ev('__go(99999);'); s = await seen(d);
  assert.equal(s.step, 2); assert.match(s.play, /Play/);
  await d.ev('document.querySelector("[data-a=play]").click(); __go(100);'); s = await seen(d);
  assert.equal(s.step, 0); assert.match(s.play, /Pause/); assert.deepEqual(s.tokens.map(p => p.map(v => Math.round(v * 100) / 100)), at(100));
}));

test('pause holds the step, and its tokens go on; next, back, the dots and the arrows take a step and stop in it', opts, page(SRC, async d => {
  await started(d); await d.ev('__go(1000); document.querySelector("[data-a=play]").click();');
  let s = await seen(d); assert.match(s.play, /Play/);
  const before = s.tokens;
  await d.ev('__go(300);'); s = await seen(d); assert.notDeepEqual(s.tokens, before); assert.equal(s.step, 0);
  assert.deepEqual(s.tokens.map(p => p.map(v => Math.round(v * 100) / 100)), at(1000, 1300));
  await d.ev('document.querySelector("[data-a=next]").click(); __go(50);'); s = await seen(d);
  assert.equal(s.step, 1); assert.match(s.play, /Play/); assert.deepEqual(s.tokens.map(p => p.map(v => Math.round(v * 100) / 100)), at(6050), 'its tokens start with it');
  await d.ev('__go(20000);'); s = await seen(d); assert.equal(s.step, 1, 'it stops in it');
  await d.ev('document.querySelector("[data-a=prev]").click();'); assert.equal((await seen(d)).step, 0);
  await d.ev('document.querySelectorAll(".dot")[2].click();'); s = await seen(d); assert.equal(s.step, 2); assert.deepEqual(s.lit.sort(), ['r1', 'r2']);
  await d.ev('const f = document.querySelector(".figure"); f.focus(); f.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));'); assert.equal((await seen(d)).step, 1);
  await d.ev('document.querySelector("[data-a=play]").click(); __go(10);'); s = await seen(d); assert.match(s.play, /Pause/);
  await d.ev('__go(6100);'); assert.equal((await seen(d)).step, 2, 'playing goes on');
}));

test('out of view, no frame is asked for; back in view, it goes on', opts, page(SRC, async d => {
  await started(d); await d.ev('__go(500);');
  await d.ev('document.body.style.paddingBottom = "4000px"; scrollTo(0, 3500);');
  await d.until('window.__clk.q.size === 0', 'no frame waits');
  await d.ev('__go(5000);');
  await d.ev('scrollTo(0, 0);');
  await started(d); await d.ev('__go(100);');
  assert.equal((await seen(d)).step, 0);
}));

test('the assemble intro is a transport over its plan: it plays, then the steps do; a step taken ends it', opts, page(SRC.replace('    loop: false\n', '    loop: false\n    assemble: true\n'), async d => {
  await d.until('!document.querySelector("svg").classList.contains("pre-assemble")', 'it starts in view');
  await d.ev('__go(200);');
  assert.ok(await d.ev<number>('return document.querySelectorAll("svg [data-part][opacity], svg [data-part][transform]").length;') > 0);
  assert.match((await seen(d)).play, /Play/);
  await d.ev('__go(20000);'); await started(d);
  assert.equal(await d.ev<number>('return document.querySelectorAll("svg [data-part][transform]").length;'), 0);
  await d.ev('document.querySelector("[data-a=assemble]").click(); __go(100); document.querySelector("[data-a=next]").click();');
  const s = await seen(d); assert.equal(s.step, 1);
  assert.equal(await d.ev<number>('return document.querySelectorAll("svg [data-part][transform]").length;'), 0);
}));

const OWN = SRC.replace(/    steps:[\s\S]*$/, '') + `    motion:
      isomotion: 1
      series:
        - sequence: { name: one, duration: 2000, say: { title: First beat, text: "**Bold**" }, show: [a], enter: { fade: 400 } }
        - sequence: { name: two, duration: 2000, say: { title: Second beat }, show: [b, r1] }
`;
test('a scene\'s own motion is what its page plays: its beats as steps, all of it drawn by the Timeline', opts, page(OWN, async d => {
  await started(d);
  let s = await seen(d); assert.equal(s.heading, 'First beat');
  const op = (id: string) => d.ev<string | null>(`return document.querySelector('svg [data-item=${id}]').getAttribute('opacity');`);
  assert.equal(await op('b'), '0');
  await d.ev('__go(200);'); const mid = Number(await op('a')); assert.ok(mid > 0 && mid < 1, String(mid));
  await d.ev('__go(3000);'); s = await seen(d); assert.equal(s.heading, 'Second beat'); assert.equal(s.step, 1); assert.equal(await op('b'), null);
  assert.deepEqual(await d.ev('return [document.querySelectorAll(".steps li").length, document.querySelectorAll(".dot").length];'), [2, 2]);
}));

test('a reader who asked for less motion: the page plays the same, with a Motion off button; off, everything is lit and nothing moves; on again, from the first step', opts, page(SRC, async d => {
  await started(d); await d.ev('__go(400);');
  let s = await seen(d);
  assert.deepEqual(s.tokens.map(p => p.map(v => Math.round(v * 100) / 100)), at(400));
  await d.ev('document.querySelector("[data-a=motion]").click();');
  s = await seen(d); assert.equal(s.step, 2); assert.equal(s.frames, 0); assert.equal(s.play, 'Motion off');
  const off = await d.ev<unknown[]>('const q = x => document.querySelector(x); return [q("svg").classList.contains("all"), q("[data-a=play]").disabled, q("[data-a=assemble]").disabled, q("details.steps").open, q("[data-a=motion]").getAttribute("aria-pressed")];');
  assert.deepEqual(off, [true, true, true, true, 'true']);
  await d.ev('__go(9000); document.querySelector("[data-a=prev]").click();'); s = await seen(d); assert.equal(s.step, 1); assert.equal(s.frames, 0); assert.equal(s.play, 'Motion off');
  await d.ev('scrollTo(0, 1); scrollTo(0, 0); await tick(400);'); assert.equal((await seen(d)).frames, 0);
  // (a reader's own step is a pause, as it is for anybody: Play goes on)
  await d.ev('document.querySelector("[data-a=motion]").click();'); s = await seen(d);
  assert.equal(s.step, 0); assert.match(s.play, /Play/); assert.equal(await d.ev('return document.querySelector("svg").classList.contains("all");'), false);
  await d.ev('document.querySelector("[data-a=play]").click(); __go(100);'); s = await seen(d); assert.match(s.play, /Pause/); assert.deepEqual(s.tokens.map(p => p.map(v => Math.round(v * 100) / 100)), at(100));
}, 'reduce'));

test('Motion off during the intro, and before it is in view, ends it; nobody else has the button', opts, async () => {
  const intro = SRC.replace('    loop: false\n', '    loop: false\n    assemble: true\n');
  await page(intro, async d => {
    await d.until('!document.querySelector("svg").classList.contains("pre-assemble")', 'it starts in view'); await d.ev('__go(200); document.querySelector("[data-a=motion]").click();');
    assert.equal(await d.ev<number>('return document.querySelectorAll("svg [data-part][transform]").length;'), 0); assert.equal((await seen(d)).frames, 0);
  }, 'reduce')();
  // far below: hidden until it is in view, and off before then
  const far = intro.replace('    title: Steps', '    title: Steps\n    caption: "' + 'Far down the page. '.repeat(900) + '"');
  await page(far, async d => {
    assert.equal(await d.ev<boolean>('return document.querySelector("svg").classList.contains("pre-assemble");'), true);
    await d.ev('document.querySelector("[data-a=motion]").click();');
    assert.equal(await d.ev<boolean>('return document.querySelector("svg").classList.contains("pre-assemble");'), false);
    await d.ev('document.querySelector("svg").scrollIntoView(); await tick(400); __go(100, 5);');
    assert.equal(await d.ev<number>('return document.querySelectorAll("svg [data-part][transform]").length;'), 0); assert.equal((await seen(d)).frames, 0);
  }, 'reduce')();
  await page(SRC, async d => { assert.equal(await d.ev<number>('return document.querySelectorAll("[data-a=motion]").length;'), 0); })();
});
