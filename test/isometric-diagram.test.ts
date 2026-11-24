// <isometric-diagram> (src/player/isometric-diagram.ts) in Chrome, its own bundle alone, under a CSP of one script: text in, a player out;
// its attributes, its faults in words, the links, and what a page without its script shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/iso-systems/compile.ts';
import { stillsIn } from '../src/cli/stills.ts';
import { drivePage, bundlePage, type Driver } from './adapters/page-driver.ts';
// @ts-ignore plain JS helper
import { chromePath } from '../scripts/chrome.mjs';

const read = (f: string) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let chrome: string | undefined;
try { chrome = chromePath(); } catch { chrome = undefined; }
const opts = { skip: chrome ? false : 'no Chrome', timeout: 180000 } as const;
const STRICT = "default-src 'none'; script-src 'self'; base-uri 'none'; form-action 'none'";
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const BUILD = read('test/fixtures/motion/stepped-build.yaml'), DEMO = read('examples/demo.yaml');
const MOVING = `${BUILD}    motion:\n${read('test/fixtures/motion/stepped-build.motion.yaml').split('\n').map(l => (l ? '      ' + l : l)).join('\n')}`;
const bundle = async () => (await bundlePage(fileURLToPath(new URL('../src/player/isometric-diagram.ts', import.meta.url)), ['../src/iso-systems/schema.json']));
/** a page of it: its errors gathered before anything else runs */
const page = (body: string, run: (d: Driver) => Promise<void>, o: { errors?: RegExp } = {}) => async () => {
  const pre = `window.__t = { errors: [] }; addEventListener('error', e => __t.errors.push(e.message)); addEventListener('unhandledrejection', e => __t.errors.push(String(e.reason))); addEventListener('securitypolicyviolation', e => __t.errors.push('CSP ' + e.violatedDirective + ' ' + e.blockedURI)); __t.events = []; for (const k of ['beat', 'play', 'pause', 'end', 'loop', 'isometric-ready', 'isometric-error']) addEventListener(k, e => __t.events.push(k + (k === 'beat' ? ':' + e.detail.beat.name : '')), true);\n`;
  const js = Buffer.concat([Buffer.from(pre), (await bundle()).outputFiles[0].contents]);
  await drivePage(chrome!, js, '__t', async d => {
    await d.until('document.querySelector("isometric-diagram")?.shadowRoot?.childElementCount', 'drawn');
    await d.cdp('Page.bringToFront');
    await run(d);
    assert.deepEqual((await d.ev<string[]>('return B.errors;')).filter(e => !o.errors?.test(e)), []);
    assert.equal(await d.ev('return performance.getEntriesByType("resource").filter(r => !r.name.endsWith("/page.js")).length;'), 0, 'nothing fetched');
    assert.equal(await d.ev('let n = 0; try { n = localStorage.length + sessionStorage.length; } catch {} return n;'), 0, 'nothing stored');
  }, '1000,900', { html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body>${body}<script type="module" src="page.js"></script></body></html>`, csp: STRICT });
};
const E0 = 'const el = document.querySelector("isometric-diagram"), r = el.shadowRoot, tr = el.transport;';

test('a drawing with motion: drawn from a script of YAML or from the element\'s own text, with its controls; its events', opts, page(`<isometric-diagram controls label="Built"><script type="text/yaml">\n${MOVING}</script></isometric-diagram><isometric-diagram id="b" controls>\n${esc(MOVING.split('\n').map(l => '    ' + l).join('\n'))}</isometric-diagram>`, async d => {
  const seen = await d.ev<{ n: number; dots: number[]; label: string; same: boolean }>(`${E0} const b = document.querySelector('#b').shadowRoot; return { n: r.querySelectorAll('[data-item]').length, dots: [r, b].map(x => x.querySelectorAll('.iso-play-dot').length), label: r.querySelector('.iso-play').getAttribute('aria-label'), same: r.querySelector('svg').isEqualNode(b.querySelector('svg')) };`);
  assert.ok(seen.n > 30); assert.deepEqual(seen.dots, [14, 14]); assert.equal(seen.label, 'Built'); assert.equal(seen.same, true, 'indented or not');
  await d.ev(`${E0} tr.play(); tr.seek(3100);`);
  await d.until('B.events.includes("beat:s2")', 'the second beat is told');
  await d.ev(`${E0} tr.seek(tr.duration - 60);`);
  await d.until('B.events.includes("end")', 'the end is told');
  assert.ok((await d.ev<string[]>('return B.events;')).includes('isometric-ready'));
}));

test('attributes: none, the drawing alone; loop, rate and ambient as it plays; mode draws again and keeps the place; scene', opts, page(`<isometric-diagram rate="2"><script type="text/yaml">\n${MOVING}</script></isometric-diagram>`, async d => {
  assert.equal(await d.ev(`${E0} return r.querySelectorAll('button').length;`), 0);
  assert.deepEqual(await d.ev(`${E0} el.setAttribute('loop', ''); el.setAttribute('rate', '3'); el.setAttribute('ambient', 'off'); return [tr.rate, tr.loop, tr.ambient];`), [3, true, false]);
  assert.deepEqual(await d.ev(`${E0} el.removeAttribute('loop'); el.setAttribute('rate', 'no'); el.removeAttribute('ambient'); return [tr.rate, tr.loop, tr.ambient];`), [1, false, true]);
  await d.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await d.until('document.querySelector("isometric-diagram").shadowRoot.querySelector(".iso-play").dataset.mode === "light"', 'light to begin');
  const light = await d.ev<string>(`${E0} tr.seek(5000); return r.querySelector('svg polygon').getAttribute('fill') + r.querySelector('.iso-play').dataset.mode;`);
  const dark = await d.ev<{ look: string; t: number; same: boolean }>(`${E0} el.setAttribute('mode', 'dark'); await tick(200); return { look: r.querySelector('svg polygon').getAttribute('fill') + r.querySelector('.iso-play').dataset.mode, t: el.transport.time, same: el.transport === tr };`);
  assert.notEqual(dark.look, light); assert.match(dark.look, /dark$/); assert.equal(dark.t, 5000); assert.equal(dark.same, true);
  // the reader's own, when it isn't said
  await d.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await d.ev(`${E0} el.setAttribute('mode', 'light'); await tick(100); el.removeAttribute('mode');`);
  await d.until('document.querySelector("isometric-diagram").shadowRoot.querySelector(".iso-play").dataset.mode === "dark"', 'the reader\'s dark');
  await d.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await d.until('document.querySelector("isometric-diagram").shadowRoot.querySelector(".iso-play").dataset.mode === "light"', 'the reader\'s light');
  // the scene: one by its id, and a wrong one in words
  await d.ev(`${E0} el.setAttribute('scene', 'nope'); await tick(200);`);
  assert.match(await d.ev<string>(`${E0} return r.querySelector('[role=alert]').textContent;`), /no scene "nope" \(there is build\)/);
  await d.ev(`${E0} el.setAttribute('scene', 'build'); await tick(200);`);
  assert.equal(await d.ev(`${E0} return r.querySelectorAll('.iso-play').length;`), 1);
  await d.ev(`${E0} el.setAttribute('controls', '');`);
  await d.until('document.querySelector("isometric-diagram").shadowRoot.querySelectorAll("button").length > 10', 'controls');
}));

test('a drawing with steps and no motion plays its steps; one with neither is a drawing, with nothing to play', opts, page(`<isometric-diagram controls><script type="text/yaml">\n${DEMO}</script></isometric-diagram><isometric-diagram id="b" controls><script type="text/yaml">\nisodiag: 1\nscenes:\n  - id: s\n    title: T\n    nodes:\n      - { id: a, asset: block }\n</script></isometric-diagram>`, async d => {
  const n = await d.ev<number>(`${E0} return r.querySelectorAll('.iso-play-dot').length;`);
  assert.ok(n > 1);
  // each step as its page has it: its own callouts and marks, its own number, its connectors lit and the others dimmed
  const steps = await d.ev<{ shown: string[]; hidden: number; bright: string[]; faint: number; routes: [string, string | null][] }[]>(`${E0} const out = []; for (let i = 0; i < tr.timeline.beats.length; i++) { tr.seek(tr.timeline.beats[i].end - 1); const svg = r.querySelector('svg'), q = s => [...svg.querySelectorAll(s)];
    out.push({ shown: [...new Set(q('[data-step][visibility=visible]').map(e => e.dataset.step))], hidden: q('[data-step][visibility=hidden]').length, bright: q('[data-badge]:not([opacity])').map(e => e.dataset.badge), faint: q('[data-badge][opacity="0.14"]').length, routes: q('[data-route][data-part=line]').map(e => [e.dataset.route, e.getAttribute('opacity')]) }); } return out;`);
  const s0 = compile(DEMO, read('themes/default.yaml')).scenes[0], said = new Set([...s0.steps.says, ...s0.steps.marks].map(x => String(x.step)));
  assert.ok(said.size > 0);
  steps.forEach((x, i) => {
    assert.deepEqual(x.shown, said.has(String(i + 1)) ? [String(i + 1)] : [], `step ${i + 1}`);
    for (const b of x.bright) assert.equal(b, String(i + 1));
    for (const [id, o] of x.routes) { const there = s0.steps.vis[id]?.[i] ?? true; assert.equal(o, !there ? '0' : s0.steps.steps[i].lit.includes(id) ? null : '0.12', `step ${i + 1}: ${id}`); }
  });
  assert.deepEqual(await d.ev(`const b = document.querySelector('#b'); return [b.transport.duration, [...b.shadowRoot.querySelectorAll('button,input')].filter(x => !x.hidden && x.getClientRects().length).length, b.shadowRoot.querySelectorAll('[data-item=a]').length > 0];`), [0, 0, true]);
}));

test('faults are said in words, as text, and mended by a new source; a fault while it plays keeps nothing half drawn', opts, page(`<isometric-diagram controls><script type="text/yaml">\nisodiag: 1\nscenes:\n  - id: s\n    title: "<img src=x>"\n    nodes:\n      - { id: a, right-of: nope }\n</script></isometric-diagram>`, async d => {
  assert.match(await d.ev<string>(`${E0} return r.querySelector('[role=alert]').textContent;`), /line \d+: .*nope/);
  assert.ok((await d.ev<string[]>('return B.events;')).includes('isometric-error'));
  await d.ev(`${E0} el.source = ${JSON.stringify(MOVING)}; await tick(300);`);
  assert.deepEqual(await d.ev(`${E0} return [r.querySelectorAll('[role=alert]').length, r.querySelectorAll('.iso-play').length, r.querySelectorAll('.iso-play-dot').length];`), [0, 1, 14]);
  await d.ev(`${E0} el.source = 'isodiag: 1\\nscenes: <b>'; await tick(300);`);
  assert.deepEqual(await d.ev(`${E0} return [r.querySelectorAll('[role=alert]').length, r.querySelectorAll('.iso-play').length, r.querySelectorAll('b').length, el.transport === undefined];`), [1, 0, 0, true]);
  // motion given as data, and a fault in it
  await d.ev(`${E0} el.source = ${JSON.stringify(BUILD)}; el.motion = { isomotion: 1, series: [{ sequence: { name: 'x', duration: 500 } }] }; await tick(300);`);
  assert.equal(await d.ev(`${E0} return tr.duration;`), 500);
  await d.ev(`${E0} el.motion = { isomotion: 1, series: [{ sequence: { duration: 'soon' } }] }; await tick(300);`);
  assert.match(await d.ev<string>(`${E0} return r.querySelector('[role=alert]').textContent;`), /series/);
  // taken out of the page and put back
  await d.ev(`${E0} el.motion = undefined; el.source = ${JSON.stringify(MOVING)}; await tick(200); el.remove(); await tick(50); document.body.append(el); await tick(300);`);
  assert.equal(await d.ev(`${E0} return r.querySelectorAll('.iso-play').length;`), 1);
}));

test('links, where they are asked for: #step, #t, #still', opts, page(`<isometric-diagram controls links autoplay><script type="text/yaml">\n${MOVING}</script></isometric-diagram>`, async d => {
  const open = async (hash: string) => { await d.ev(`const el = document.querySelector('isometric-diagram'); location.hash = ${JSON.stringify(hash)}; el.remove(); document.body.append(el); await tick(250);`); return d.ev<{ t: number; playing: boolean; frozen: boolean; shown: string }>(`${E0} return { t: tr.time, playing: tr.playing, frozen: r.querySelector('.iso-play').classList.contains('frozen'), shown: r.querySelector('.iso-play').dataset.time };`); };
  assert.equal((await d.ev<boolean>(`${E0} return tr.playing;`)), true);
  assert.deepEqual(await open('#step=3'), { t: 6400, playing: false, frozen: false, shown: '6400' });
  assert.deepEqual(await open('#step=3&t=0.5'), { t: 8000, playing: false, frozen: false, shown: '8000' });
  assert.equal((await open('#step=2&t=1')).t, 6399);
  assert.equal((await open('#step=99&t=1')).t, 14 * 3200);
  const still = await open('#step=2&still'); assert.equal(still.frozen, true); assert.equal(still.shown, String(3200 + 0.6 * 3200));
  assert.equal((await open('#elsewhere')).playing, true);
}));

test('black and white by attribute, the place kept; a still written in the page is what shows without the script, and not with it', opts, page(stillsIn(`<isometric-diagram controls mode="light"><script type="text/yaml">\n${MOVING}</script></isometric-diagram>`, read('themes/default.yaml')).html, async d => {
  const hues = () => d.ev<number>(`${E0} return [...r.querySelector('svg').outerHTML.matchAll(/#([0-9a-f]{6})/g)].filter(m => new Set([m[1].slice(0, 2), m[1].slice(2, 4), m[1].slice(4)]).size > 1).length;`);
  assert.ok(await hues() > 0);
  await d.ev(`${E0} tr.seek(40000); el.setAttribute('treatment', 'mono'); await tick(300);`);
  assert.equal(await hues(), 0); assert.equal(await d.ev(`${E0} return tr.time >= 40000 && r.querySelectorAll('.mono-pattern, .flow').length > 0;`), true);
  await d.ev(`${E0} el.setAttribute('treatment', 'sepia'); await tick(200);`);
  assert.match(await d.ev<string>(`${E0} return r.querySelector('[role=alert]').textContent;`), /sepia/);
  await d.ev(`${E0} el.removeAttribute('treatment'); await tick(300);`); assert.ok(await hues() > 0);
  // the page's own still: in the element, not drawn beside the player's
  assert.deepEqual(await d.ev(`const s = document.querySelector('isometric-diagram > svg[data-isometric-still]'); return [!!s, s.getClientRects().length];`), [true, 0]);
}));

test('a page whose script never runs shows the still', opts, async () => {
  const html = stillsIn(`<!doctype html><body><isometric-diagram><script type="text/yaml">\n${BUILD}</script></isometric-diagram>`, read('themes/default.yaml')).html;
  await drivePage(chrome!, new Uint8Array(), '__none', async ({ ev, until }) => {
    await until('document.readyState === "complete" && document.querySelector("svg")', 'the page');
    const box = await ev<number[]>('const r = document.querySelector("isometric-diagram > svg").getBoundingClientRect(); return [r.width, r.height];');
    assert.ok(box[0] > 300 && box[1] > 100, String(box));
    assert.equal(await ev('return document.body.innerText.includes("isodiag: 1");'), false, 'and not its text');
  }, '1000,800', { html, csp: "default-src 'none'" });
});

test('the script: no eval, nothing unsafe to inline, and its size', async () => {
  const b = (await bundlePage(fileURLToPath(new URL('../src/player/isometric-diagram.ts', import.meta.url)), ['../src/iso-systems/schema.json']));
  const js = b.outputFiles[0].text;
  assert.doesNotMatch(js, /\beval\(|new Function\(|localStorage|sessionStorage|\bfetch\(|XMLHttpRequest|WebSocket/);
  // its own sources: the app and the layers it is on, and nothing else of ours
  assert.deepEqual(Object.keys(b.metafile!.inputs).filter(f => f.startsWith('src/') && !/^src\/(player|iso-core|iso-objects|iso-viewer|iso-systems)\//.test(f)), []);
  console.log(`# isometric-diagram: ${js.length} bytes unminified, ${gzipSync(js).length} gzipped`);
});
