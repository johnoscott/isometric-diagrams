// The player (src/iso-viewer/play.ts) in Chrome, under a CSP that allows a script and nothing else, on a clock moved by hand: what it
// draws is the Timeline's, whatever is pressed; its controls, keys and words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bundlePage, drivePage, type Driver } from './adapters/page-driver.ts';
// @ts-ignore plain JS helper
import { chromePath } from '../scripts/chrome.mjs';

let chrome: string | undefined;
try { chrome = chromePath(); } catch { chrome = undefined; }
const HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>page</title></head><body><div id="app"></div><script type="module" src="page.js"></script></body></html>';
const STRICT = "default-src 'none'; script-src 'self'; base-uri 'none'; form-action 'none'";
const page = (run: (d: Driver & { state(): Promise<{ t: number; a: number | string; playing: string; beat: number; same: string }> }) => Promise<void>) => async () => {
  const js = (await bundlePage(fileURLToPath(new URL('./adapters/player-page.ts', import.meta.url)), ['../src/iso-systems/schema.json'])).outputFiles[0].contents;
  await drivePage(chrome!, js, '__play', async d => {
    await d.until('document.title === "ready"', 'the page');
    await d.cdp('Page.bringToFront');
    const state = () => d.ev<{ t: number; a: number | string; playing: string; beat: number; same: string }>('const p = B.player, tr = p.transport; return { t: tr.time, a: tr.ambientTime, playing: p.root.dataset.playing, beat: tr.beat?.index, same: B.same(tr.state()) };');
    await run({ ...d, state });
    assert.deepEqual(await d.ev('return B.errors;'), []);
  }, '1000,1000', { html: HTML, csp: STRICT });
};
const key = async (d: Driver, k: string, text?: string) => {
  const code = { ArrowRight: 39, ArrowLeft: 37, Home: 36, ' ': 32, Tab: 9, Enter: 13 }[k]!;
  await d.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: code, ...(text ? { text } : {}) });
  await d.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: code });
};
const press = async (d: Driver, sel: string) => {
  const p = await d.ev<{ x: number; y: number }>(`const e = B.q(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  for (const type of ['mousePressed', 'mouseReleased']) await d.cdp('Input.dispatchMouseEvent', { type, ...p, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
};
const opts = { skip: chrome ? false : 'no Chrome', timeout: 180000 } as const;

test('the player draws what the Timeline says, at any time: playing, paused, sought, at its end, again from the start', opts, page(async d => {
  await d.ev('B.mount();');
  assert.equal((await d.state()).same, '');
  await press(d, '.iso-play-btn.play');
  for (const ms of [16, 200, 450, 3000, 9000, 20000]) { await d.ev(`B.go(${ms});`); const s = await d.state(); assert.equal(s.same, '', `after ${ms}`); assert.equal(s.playing, 'true'); }
  await press(d, '.iso-play-btn.play');
  assert.equal((await d.state()).playing, 'false');
  const held = await d.state();
  await d.ev('B.go(700);');
  const later = await d.state();
  assert.equal(later.t, held.t); assert.equal(later.a, (held.a as number) + 700); assert.equal(later.same, '');
  for (const t of [44000, 100, 33333, 1]) { await d.ev(`B.player.transport.seek(${t});`); assert.equal((await d.state()).same, '', `at ${t}`); }
  await press(d, '.iso-play-btn.play'); await d.ev('B.go(99999);');
  const end = await d.state();
  assert.equal(end.t, 14 * 3200); assert.equal(end.playing, 'false'); assert.equal(end.same, '');
  await press(d, '.iso-play-btn.play'); await d.ev('B.go(50);');
  assert.equal((await d.state()).t, 50);
}));

test('next, back, the dots and the arrows go through one beat and stop in it, drawn; a step taken is not the player playing', opts, page(async d => {
  await d.ev('B.mount();');
  await press(d, '.iso-play-btn.next');
  let s = await d.state();
  assert.equal(s.beat, 1); assert.equal(s.t, 3200); assert.equal(s.playing, 'false');
  await d.ev('B.go(200);'); s = await d.state(); assert.equal(s.t, 3400); assert.equal(s.same, '');
  await d.ev('B.go(9000);'); s = await d.state(); assert.equal(s.t, 6399); assert.equal(s.beat, 1); assert.equal(s.same, '');
  await d.ev('B.q(".iso-play").focus();'); await key(d, 'ArrowRight'); assert.equal((await d.state()).beat, 2);
  await key(d, 'ArrowLeft'); assert.equal((await d.state()).beat, 1);
  await key(d, 'ArrowLeft'); await key(d, 'ArrowLeft'); assert.equal((await d.state()).beat, 0);
  await d.ev('B.q(".iso-play-dots").querySelectorAll("button")[13].click(); B.go(9000);');
  s = await d.state(); assert.equal(s.beat, 13); assert.equal(s.same, '');
  await press(d, '.iso-play-btn.next'); assert.equal((await d.state()).beat, 13);
  await key(d, 'Home'); s = await d.state(); assert.equal(s.t, 0); assert.equal(s.playing, 'false');
  // space on the player plays and pauses; on a button it is the button's own
  await d.ev('B.q(".iso-play").focus();'); await key(d, ' ', ' '); assert.equal((await d.state()).playing, 'true'); await key(d, ' ', ' '); assert.equal((await d.state()).playing, 'false');
}));

test('the words: the beat\'s title, chapter, text and facts; dots by chapter; a list of all; the scrubber says where it is', opts, page(async d => {
  await d.ev('B.mount({ label: "How it is built" });');
  const said = () => d.ev<string[]>('return [".iso-play-num", ".iso-play-title", ".iso-play-chapter", ".iso-play-count", ".iso-play-facts"].map(B.text);');
  assert.deepEqual(await said(), ['1', 'The machine and the host', 'Once per machine', '1 / 14', 'Step1']);
  await d.ev('B.player.transport.seekBeat(2);');
  assert.deepEqual((await said()).slice(0, 4), ['3', 'The base', 'Once per base', '3 / 14']);
  assert.deepEqual(await d.ev('return [...B.q(".iso-play-dots").querySelectorAll("[role=group]")].map(g => [g.getAttribute("aria-label"), g.children.length]).slice(0, 2);'), [['Once per machine', 2], ['Once per base', 3]]);
  assert.equal(await d.ev('return B.q("[aria-current=step]").getAttribute("aria-label");'), 'Step 3: The base');
  assert.equal(await d.ev('return B.q(".iso-play-list ol").children.length;'), 14);
  assert.match(await d.ev<string>('return B.q(".iso-play-bar").getAttribute("aria-valuetext");'), /^0:06 of 0:45, The base$/);
  assert.equal(await d.ev('return B.q(".iso-play").getAttribute("aria-label");'), 'How it is built');
  assert.equal(await d.ev('return B.q(".iso-play-say").getAttribute("aria-live");'), 'polite');
  await d.ev('B.q(".iso-play-btn.play").click();'); assert.equal(await d.ev('return B.q(".iso-play-say").getAttribute("aria-live");'), 'off');
  // the commentary is text: markup in it is shown, not made
  await d.ev('const doc = structuredClone(B.doc); doc.series[0].sequence.say = { title: "<img src=x onerror=alert(1)>", text: "<b>no</b> **yes** [l](javascript:alert(1))", code: "<i>", facts: [["<u>", "<s>"]] }; B.mount({}, doc);');
  assert.deepEqual(await d.ev('return [B.q(".iso-play-say").querySelectorAll("img,i,u,s,a").length, B.q(".iso-play-text").innerHTML, B.text(".iso-play-title")];'), [0, '&lt;b&gt;no&lt;/b&gt; <b>yes</b> l)', '<img src=x onerror=alert(1)>']);
  // the scrubber, by its own keys
  await d.ev('B.mount(); B.q(".iso-play-bar").focus();'); await key(d, 'ArrowRight');
  assert.ok((await d.state()).t > 0); assert.equal((await d.state()).beat, 0);
  // no motion, no controls for it
  await d.ev('B.mount({}, null);');
  assert.deepEqual(await d.ev('return [".play", ".next", ".back", ".ambient", ".again"].map(c => B.q(".iso-play-btn" + c).hidden);'), [true, true, true, true, true]);
}));

test('the ambient switch stops what loops where it is and starts it there; it shows only where something loops', opts, page(async d => {
  await d.ev('B.mount(); B.player.transport.seekBeat(12); B.go(500);');
  const at = await d.state();
  await press(d, '.iso-play-btn.ambient');
  assert.equal(await d.ev('return B.q(".iso-play-btn.ambient").getAttribute("aria-pressed");'), 'false');
  await d.ev('B.go(1000); B.player.transport.seek(39000);');
  let s = await d.state(); assert.equal(s.a, at.a); assert.equal(s.same, '');
  await press(d, '.iso-play-btn.ambient'); await d.ev('B.go(10);');
  s = await d.state(); assert.equal(s.a, (at.a as number) + 10); assert.equal(s.same, '');
  await d.ev('const doc = structuredClone(B.doc); for (const x of doc.series) delete x.sequence.ants; B.mount({}, doc);');
  assert.equal(await d.ev('return B.q(".iso-play-btn.ambient").hidden;'), true);
}));

test('set: another document keeps the place, another mode redraws, faults are refused; freeze is one moment and no controls', opts, page(async d => {
  await d.ev('B.mount(); B.player.transport.seek(7000);');
  assert.equal(await d.ev('const doc = structuredClone(B.doc); doc.series.shift(); return B.set(doc, "dark");'), true);
  let s = await d.state(); assert.equal(s.t, 7000 - 3200);
  assert.equal(await d.ev('return B.same(B.player.transport.state(), "dark");'), '');
  assert.equal(await d.ev('return B.q(".iso-play").dataset.mode;'), 'dark');
  assert.equal(await d.ev('return B.q(".iso-play-dots").querySelectorAll("button").length;'), 13);
  assert.equal(await d.ev('return B.set({ isomotion: 1, series: [{ sequence: { duration: "soon" } }] });'), false);
  assert.equal((await d.state()).t, 3800);
  await d.ev('B.mount(); B.player.freeze(5000); B.go(1000);');
  assert.equal(await d.ev('return B.same(B.player.transport.timeline.at(5000));'), '');
  assert.deepEqual(await d.ev('return [".iso-play-row", ".iso-play-say", ".iso-play-dots"].map(x => getComputedStyle(B.q(x)).display);'), ['none', 'none', 'none']);
}));

test('reduced motion: ignored by default; with respect, the last state, everything lit, until Play is pressed', opts, page(async d => {
  await d.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await d.ev('B.mount({ autoplay: true }); B.go(100);');
  assert.equal((await d.state()).t, 100);
  await d.ev('B.mount({ autoplay: true, reducedMotion: "respect" }); B.go(100);');
  assert.equal((await d.state()).t, 0);
  const seen = await d.ev<{ dim: number; gone: number; anim: number }>('const S = B.player.transport.timeline.at(1e9), ws = [...B.q(".iso-play-stage svg").querySelectorAll("[data-item]")]; return { dim: ws.filter(w => w.hasAttribute("opacity") && w.getAttribute("opacity") !== "0").length, gone: new Set(ws.filter(w => w.getAttribute("opacity") === "0").map(w => w.dataset.item)).size, anim: B.q(".g-anim").children.length };');
  assert.equal(seen.dim, 0); assert.equal(seen.anim, 0); assert.ok(seen.gone > 0, 'what the last beat hides stays hidden');
  // (exactly what the last state hides, and not what the first one does)
  const last = await d.ev<{ want: string[]; got: string[]; first: string[] }>('const tl = B.player.transport.timeline, gone = S => Object.entries(S.items ?? {}).filter(([, v]) => v.opacity === 0).map(([k]) => k).sort(); return { want: gone(tl.at(1e9)), first: gone(tl.at(0)), got: [...new Set([...B.q(".iso-play-stage svg").querySelectorAll("[data-item]")].filter(w => w.getAttribute("opacity") === "0" && w.dataset.part !== "label").map(w => w.dataset.item))].sort() };');
  assert.deepEqual(last.got, last.want); assert.notDeepEqual(last.want, last.first);
  await press(d, '.iso-play-btn.play'); await d.ev('B.go(40);');
  const s = await d.state(); assert.equal(s.t, 40); assert.equal(s.same, '');
}));

const calmer = async (d: Driver, v = 'reduce') => { await d.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: v }] }); };
const STILL = 'const b = B.q(".iso-play-btn.still"); b && getComputedStyle(b).display !== "none" && b.getClientRects().length > 0';
test('a reader who asked for less motion: it plays the same, with a Motion off button; off, everything is lit and nothing moves, whoever asks; on again, from the first step', opts, page(async d => {
  await calmer(d);
  await d.ev('B.mount({ autoplay: true }); B.go(700);');
  assert.equal((await d.state()).t, 700, 'it plays'); assert.equal((await d.state()).same, '');
  assert.equal(await d.ev(`return (() => { ${STILL.replace('b &&', 'return b &&')}; })();`), true, 'its button');
  assert.equal(await d.ev('return B.q(".iso-play-btn.still").getAttribute("aria-pressed");'), 'false');
  await press(d, '.iso-play-btn.still');
  const off = await d.ev<Record<string, unknown>>('const q = B.q, tr = B.player.transport, ws = [...q(".iso-play-stage svg").querySelectorAll("[data-item]")]; return { pressed: q(".still").getAttribute("aria-pressed"), play: q(".play").disabled, playing: tr.playing, at: tr.time === tr.duration, list: q(".iso-play-list").open, dim: ws.filter(w => w.hasAttribute("opacity") && w.getAttribute("opacity") !== "0").length, anim: q(".g-anim").children.length, n: q(".iso-play-count").textContent };');
  assert.deepEqual(off, { pressed: 'true', play: true, playing: false, at: true, list: true, dim: 0, anim: 0, n: '14 / 14' });
  // nothing moves: not by time, not by Space, not by the host
  const html = 'return B.q(".iso-play-stage").innerHTML;', was = await d.ev<string>(html);
  await d.ev('B.go(900, 3); B.q(".iso-play").dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })); B.go(900); const tr = B.player.transport; tr.play(); B.go(900); tr.toggle(); B.go(900);');
  assert.ok(await d.ev<string>(html) === was, 'the same picture');
  assert.deepEqual(await d.ev('const tr = B.player.transport, p = B.q(".play"); return { playing: tr.playing, end: tr.time === tr.duration, label: p.getAttribute("aria-label"), text: p.textContent, off: p.disabled, root: B.q(".iso-play").dataset.playing };'), { playing: false, end: true, label: 'Play', text: '▶', off: true, root: 'false' }, 'and the transport and the button are left alone');
  // its steps are still the reader's: each as it is when it is over, with no way there
  await press(d, '.iso-play-btn.again'); assert.equal((await d.state()).t, 0);
  await press(d, '.iso-play-btn.next'); const t = (await d.state()).t; await d.ev('B.go(500, 4);'); assert.equal((await d.state()).t, t); assert.match(await d.ev<string>('return B.q(".iso-play-count").textContent;'), /^2 /);
  assert.equal(await d.ev('return B.same(B.player.transport.timeline.at(B.player.transport.time, { ambient: "off" }));'), '');
  // on again, from the first; it goes on by Play (a step by hand was a pause)
  await press(d, '.iso-play-btn.still');
  assert.equal((await d.state()).t, 0); assert.equal(await d.ev('return B.q(".still").getAttribute("aria-pressed") + B.q(".play").disabled;'), 'falsefalse');
  await press(d, '.iso-play-btn.play'); await d.ev('B.go(40);'); assert.equal((await d.state()).t, 40); assert.equal((await d.state()).same, '');
  // off and on at once, with no step between: it plays again by itself, as it began
  await d.ev('B.mount({ autoplay: true }); B.go(300);'); await press(d, '.iso-play-btn.still'); await press(d, '.iso-play-btn.still'); await d.ev('B.go(60);');
  assert.equal((await d.state()).t, 60);
  // one that does not begin by itself plays from the first step too; not one its reader had paused
  await d.ev('B.mount({}); B.go(300);'); assert.equal((await d.state()).t, 0); await press(d, '.iso-play-btn.still'); await press(d, '.iso-play-btn.still'); await d.ev('B.go(60);');
  assert.equal((await d.state()).t, 60);
  await d.ev('B.mount({ autoplay: true }); B.go(300);'); await press(d, '.iso-play-btn.play'); await press(d, '.iso-play-btn.still'); await press(d, '.iso-play-btn.still'); await d.ev('B.go(60);');
  assert.equal((await d.state()).t, 0); assert.equal(await d.ev('return B.player.transport.playing;'), false);
  // and the host\'s play() is its own again
  await d.ev('B.player.transport.play(); B.go(40);'); assert.equal((await d.state()).t, 40);
}));

test('Motion off: with no controls where it could move by itself; not for a still drawing, with respect, or for anybody else', opts, page(async d => {
  const shown = (mount: string) => d.ev<boolean>(`${mount}; const b = B.q(".iso-play-btn.still"); return !!b && getComputedStyle(b).display !== "none" && b.getClientRects().length > 0;`);
  await calmer(d);
  assert.equal(await shown('B.mount({ controls: false, autoplay: true })'), true, 'plays by itself, no controls');
  assert.deepEqual(await d.ev('return [...B.q(".iso-play").querySelectorAll("button")].filter(b => b.getClientRects().length).map(b => b.textContent);'), ['Motion off'], 'that button alone');
  await press(d, '.iso-play-btn.still'); await d.ev('B.go(400);'); assert.equal(await d.ev('return B.player.transport.playing;'), false);
  assert.equal(await shown('B.mount({}, null)'), false, 'nothing to play');
  assert.equal(await shown('B.mount({ reducedMotion: "respect" })'), false, 'still until they play it');
  assert.equal(await shown('B.mount({}); B.player.freeze(100)'), false, 'a picture');
  await calmer(d, 'no-preference');
  assert.equal(await shown('B.mount({ autoplay: true })'), false, 'nobody asked');
}));

test('one plays at a time: the one most in view; a reader\'s pause is kept', opts, page(async d => {
  // two, a tall gap between them, on the page's own clock
  await d.ev('B.shadow.replaceChildren(); B.two = []; for (let i = 0; i < 2; i++) { B.player = undefined; B.mount({ autoplay: "visible", clock: undefined }); B.two.push(B.player); B.player = undefined; const gap = document.createElement("div"); gap.className = "gap"; gap.style.height = "1600px"; B.shadow.append(gap); } scrollTo(0, 0);');
  await d.until('B.two[0].transport.playing && !B.two[1].transport.playing', 'the first plays');
  await d.ev('B.two[1].root.scrollIntoView();');
  await d.until('!B.two[0].transport.playing && B.two[1].transport.playing', 'the second plays');
  await d.ev('B.two[1].root.querySelector(".play").click(); scrollTo(0, 0);');
  await d.until('B.two[0].transport.playing', 'the first again');
  await d.ev('B.two[1].root.scrollIntoView();');
  await d.until('!B.two[0].transport.playing', 'the first stops'); await d.ev('await tick(300);');
  assert.equal(await d.ev('return B.two[1].transport.playing;'), false);
}));

test('it looks right: light and dark, wide and narrow', opts, page(async d => {
  for (const [mode, w] of [['light', 900], ['dark', 900], ['light', 380]] as const) {
    await d.cdp('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
    await d.ev(`B.mount({ mode: "${mode}" }); B.player.transport.seek(40000);`);
    const bad = await d.ev<string[]>('const r = B.q(".iso-play"), R = r.getBoundingClientRect(); return [...r.querySelectorAll("button,input,.iso-play-say,summary")].filter(e => !e.hidden && e.getClientRects().length).filter(e => { const b = e.getBoundingClientRect(); return b.left < R.left - 1 || b.right > R.right + 1; }).map(e => e.className);');
    assert.deepEqual(bad, []);
    const sc = await d.ev<number>('return document.documentElement.scrollWidth - innerWidth;'); assert.ok(sc <= 0, `sideways ${sc}`);
    if (process.env.PLAYER_SHOTS) writeFileSync(`${process.env.PLAYER_SHOTS}/player-${mode}-${w}.png`, Buffer.from((await d.cdp('Page.captureScreenshot', { format: 'png' })).data!, 'base64'));
  }
}));
