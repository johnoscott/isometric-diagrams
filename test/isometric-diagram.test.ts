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
const page = (body: string, run: (d: Driver) => Promise<void>, o: { errors?: RegExp; bars?: boolean } = {}) => async () => {
  // (bars: scrollbars that take room, as on GitHub's Macs, on Windows, and where a mouse is plugged in: here they lie over the page)
  const pre = `${o.bars || process.env.BARS ? "{ const s = new CSSStyleSheet(); s.replaceSync('html::-webkit-scrollbar{width:15px}'); document.adoptedStyleSheets = [s]; } " : ''}window.__t = { errors: [] }; addEventListener('error', e => __t.errors.push(e.message)); addEventListener('unhandledrejection', e => __t.errors.push(String(e.reason))); addEventListener('securitypolicyviolation', e => __t.errors.push('CSP ' + e.violatedDirective + ' ' + e.blockedURI)); __t.events = []; for (const k of ['beat', 'play', 'pause', 'end', 'loop', 'isometric-ready', 'isometric-error']) addEventListener(k, e => __t.events.push(k + (k === 'beat' ? ':' + e.detail.beat.name : '')), true);\n`;
  const js = Buffer.concat([Buffer.from(pre), (await bundle()).outputFiles[0].contents]);
  await drivePage(chrome!, js, '__t', async d => {
    await d.until('document.querySelector("isometric-diagram")?.shadowRoot?.childElementCount', 'drawn');
    await d.cdp('Page.bringToFront');
    await run(d);
    assert.deepEqual((await d.ev<string[]>('return B.errors;')).filter(e => !o.errors?.test(e)), []);
    assert.equal(await d.ev('return performance.getEntriesByType("resource").filter(r => !r.name.endsWith("/page.js")).length;'), 0, 'nothing fetched');
    assert.equal(await d.ev('let n = 0; try { n = localStorage.length + sessionStorage.length; } catch {} return n;'), 0, 'nothing stored');
  }, '1000,900', { html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>t</title></head><body>${body}<script type="module" src="page.js"></script></body></html>`, csp: STRICT });
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

test('a reader who asked for less motion: the element plays, and has a Motion off button; with respect, none', opts, page(`<isometric-diagram controls autoplay><script type="text/yaml">\n${MOVING}</script></isometric-diagram>`, async d => {
  const has = `${E0} const b = r.querySelector('.still'); return !!b && b.getClientRects().length > 0;`;
  for (const [v, want] of [['no-preference', false], ['reduce', true]] as const) {
    await d.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: v }] });
    // drawn anew, as a page opened by that reader is
    await d.ev(`const el = document.querySelector("isometric-diagram"), p = el.parentNode, n = el.nextSibling; el.remove(); const c = el.cloneNode(true); p.insertBefore(c, n);`);
    await d.until('document.querySelector("isometric-diagram")?.shadowRoot?.childElementCount', 'drawn again');
    assert.equal(await d.ev(has), want, v);
    await d.until('(t => t.playing && t.time > 0)(document.querySelector("isometric-diagram").transport)', 'it plays');
  }
  await d.ev(`${E0} r.querySelector('.still').click();`);
  const t = await d.ev<number>(`${E0} return tr.time;`); await d.ev('await tick(300);');
  assert.deepEqual(await d.ev(`${E0} return [tr.time, tr.playing, r.querySelector('.still').getAttribute('aria-pressed')];`), [t, false, 'true']);
  await d.ev(`document.querySelector("isometric-diagram").setAttribute('reduced-motion', 'respect'); await tick(200);`);
  assert.equal(await d.ev(has), false);
}));

test('attributes: none, the drawing alone; loop, rate and ambient as it plays; mode draws again and keeps the place; scene', opts, page(`<isometric-diagram rate="2"><script type="text/yaml">\n${MOVING}</script></isometric-diagram>`, async d => {
  // (a reader who asked for less motion has one button here, its own test's)
  assert.deepEqual(await d.ev(`${E0} return [...r.querySelectorAll('button')].filter(b => !b.classList.contains('still')).map(b => b.className.replace('iso-play-btn ', ''));`), ['z-out', 'z-in', 'z-fit', 'iso-enlarge']);
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
  assert.deepEqual(await d.ev(`const b = document.querySelector('#b'); return [b.transport.duration, [...b.shadowRoot.querySelectorAll('button,input')].filter(x => !x.hidden && x.getClientRects().length).map(x => x.className.replace('iso-play-btn ', '')), b.shadowRoot.querySelectorAll('[data-item=a]').length > 0];`), [0, ['z-out', 'z-in', 'iso-enlarge'], true]);
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

// ---------- 0.18.0: a host's marks, and the enlarged view ----------
const marked = (id: string) => `isodiag: 1\ntitle: t\nscenes:\n  - id: ${id}\n    title: t\n    nodes:\n      - { id: a, asset: block, at: [0, 0], label: A, deco: [{ icon: ours }] }\n`;
const MARKS = `const marks = { icons: { ours: (k, b) => k.line3([b.x0, b.y0, b.z1], [b.x1, b.y1, b.z1], 'ico-ours') }, css: '.ico-ours{stroke:#d97757;stroke-width:3}' };`;
const module = `const M = await import(document.querySelector('script[type=module]').src);`;
test('registerMarks: elements already drawn are drawn again with them, and those that come after; a name nobody has is the placeholder', opts, page(`<isometric-diagram mode="light"><script type="text/yaml">\n${marked('a')}</script></isometric-diagram><isometric-diagram id="b" mode="dark"><script type="text/yaml">\n${marked('b')}</script></isometric-diagram>`, async d => {
  const look = () => d.ev<[number, number, boolean][]>(`return [...document.querySelectorAll('isometric-diagram')].map(e => [e.shadowRoot.querySelectorAll('.ico-ours').length, e.shadowRoot.querySelectorAll('.ico-unknown').length, e.shadowRoot.querySelector('svg').outerHTML.toLowerCase().includes('#d97757')]);`);
  assert.deepEqual(await look(), [[0, 1, false], [0, 1, false]]);
  await d.ev(`${module} ${MARKS} M.registerMarks(marks); await tick(150);`);
  assert.deepEqual(await look(), [[1, 0, true], [1, 0, true]], 'both, in both modes');
  await d.ev(`const el = document.createElement('isometric-diagram'); el.source = ${JSON.stringify(marked('c').replace('icon: ours', 'icon: theirs'))}; document.body.append(el); const e2 = document.createElement('isometric-diagram'); e2.source = ${JSON.stringify(marked('d'))}; document.body.append(e2); await tick(200);`);
  assert.deepEqual((await look()).slice(2), [[0, 1, false], [1, 0, true]]);
  await d.ev(`document.querySelector('isometric-diagram').setAttribute('treatment', 'mono'); await tick(200);`);
  assert.equal((await look())[0][0], 1, 'black and white has it too');
  // one that is gone from the page is not drawn
  await d.ev(`${module} const el = document.querySelector('#b'); el.remove(); M.registerMarks({ icons: {} }); await tick(100); document.body.append(el); await tick(150);`);
  assert.deepEqual((await look()).at(-1), [1, 0, true]);
}));

test('registerMarks while it plays: its place is kept, and it plays on', opts, page(`<isometric-diagram controls><script type="text/yaml">\n${MOVING}</script></isometric-diagram>`, async d => {
  await d.ev(`${E0} window.__tr = tr; tr.seek(9000); tr.play(); await tick(80); ${module} ${MARKS} M.registerMarks(marks); await tick(120);`);
  assert.deepEqual(await d.ev(`${E0} return [tr === window.__tr, tr.playing, tr.time > 9000 && tr.time < 14000];`), [true, true, true]);
}));

// the window, less a scrollbar that takes room: what a dialog may cover
const FULL = `const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight; const el = document.querySelector('isometric-diagram'), r = el.shadowRoot, full = () => r.querySelector('dialog'), btn = r.querySelector('.iso-enlarge'), tr = el.transport;`;
const key = (d: Driver, k: string, code: number, shift = false) => (async () => { for (const type of ['rawKeyDown', 'keyUp']) await d.cdp('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 }); })();
const click = async (d: Driver, what: string) => { const p = await d.ev<{ x: number; y: number }>(`${FULL} const b = ${what}.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };`); for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await d.cdp('Input.dispatchMouseEvent', { type, ...p, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }); };
const TALL = `<p>before</p><isometric-diagram controls label="Built"><script type="text/yaml">\n${MOVING}</script></isometric-diagram><div id="gap"></div><p>after</p>`;
const LISTEN = `window.__ev = []; for (const k of ['expand', 'collapse', 'play', 'pause']) document.querySelector('isometric-diagram').addEventListener(k, () => __ev.push(k));`;

for (const bars of [false, true]) test(`enlarged: the same player, its time and playing kept, in a dialog nearly the window; Esc, the ✕ and collapse() put it back, and the focus${bars ? ' (scrollbars that take room)' : ''}`, opts, page(TALL, async d => {
  if (bars) assert.equal(await d.ev('document.body.style.minHeight = "3000px"; return innerWidth - document.documentElement.clientWidth;'), 15, 'a scrollbar');
  await d.ev(`${LISTEN} document.querySelector('#gap').style.height = '2000px'; scrollTo(0, 30); await tick(60);`);
  const place = () => d.ev<number[]>(`${FULL} const b = el.getBoundingClientRect(); return [scrollY, Math.round(b.top), Math.round(b.height), document.documentElement.scrollHeight];`);
  const before = await place();
  assert.deepEqual(await d.ev(`${FULL} return [btn.getAttribute('aria-label'), btn.getBoundingClientRect().width, btn.getBoundingClientRect().height, getComputedStyle(btn).opacity, el.expanded];`), ['Enlarge: Built', 36, 36, '0', false], 'there, and not seen until it is pointed at');
  const at = await d.ev<number[]>(`${FULL} const f = r.querySelector('.iso-frame').getBoundingClientRect(), b = btn.getBoundingClientRect(); return [Math.round(b.top - f.top), Math.round(f.right - b.right)];`); assert.deepEqual(at, [10, 10]);
  await d.ev(`${FULL} window.__tr = tr; window.__root = r.querySelector('.iso-play'); tr.seek(6400); tr.play(); btn.focus();`);
  for (const [how, shut] of [['Esc', () => key(d, 'Escape', 27)], ['the ✕', () => click(d, 'full().querySelector(".iso-full-close")')], ['collapse()', () => d.ev(`${FULL} el.collapse();`)]] as const) {
    await click(d, 'btn');
    await d.until(`document.querySelector('isometric-diagram').expanded`, `${how}: enlarged`);
    const on = await d.ev<Record<string, unknown>>(`${FULL} await tick(200); const b = full().querySelector('.iso-play').getBoundingClientRect(), s = full().querySelector('svg').getBoundingClientRect(); return { same: tr === __tr && full().querySelector('.iso-play') === __root, playing: tr.playing, modal: full().matches(':modal'), wide: b.width >= W - 40 && b.height >= H - 100, inside: s.right <= W && s.bottom <= H && s.width > 200 && s.height > 200, focus: full().contains(r.activeElement), name: full().getAttribute('aria-label') };`);
    assert.deepEqual(on, { same: true, playing: true, modal: true, wide: true, inside: true, focus: true, name: 'Built' }, how);
    assert.deepEqual((await place()).slice(1), before.slice(1), `${how}: the page behind is as it was`);
    await shut();
    await d.until(`!document.querySelector('isometric-diagram').expanded`, `${how}: back`);
    const off = await d.ev<Record<string, unknown>>(`${FULL} await tick(150); return { same: tr === __tr && r.querySelector('.iso-frame > .iso-play') === __root, playing: tr.playing, dialogs: r.querySelectorAll('dialog').length, focus: r.activeElement === btn, h: r.querySelector('.iso-frame').style.height };`);
    assert.deepEqual(off, { same: true, playing: true, dialogs: 0, focus: true, h: '' }, how);
    assert.deepEqual(await place(), before, `${how}: where it was`);
  }
  // opened by the page, with the focus on one of the player's own buttons: it goes in with the player, and back to that button
  assert.deepEqual(await d.ev(`${FULL} const n = __ev.length, next = r.querySelector('.next'); next.focus(); el.expand(); await tick(80); const inside = full().contains(r.activeElement); el.collapse(); await tick(80); __ev.length = n; return [inside, r.activeElement === next];`), [true, true]);
  assert.deepEqual(await d.ev('return __ev;'), ['play', 'expand', 'collapse', 'expand', 'collapse', 'expand', 'collapse'], 'told once each, and nothing paused');
}, { bars }));

test('enlarged: Tab stays in it, the arrows and Space work, and Motion off keeps', opts, page(TALL, async d => {
  await d.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await d.ev(`const el = document.querySelector('isometric-diagram'), p = el.parentNode, n = el.nextSibling; el.remove(); p.insertBefore(el.cloneNode(true), n); await tick(250); ${LISTEN}`);
  await d.ev(`document.querySelector('isometric-diagram').expand(); await tick(100);`);
  await key(d, 'ArrowRight', 39); await d.until(`document.querySelector('isometric-diagram').transport.time >= 3200`, 'the arrow steps');
  for (let i = 0; i < 45; i++) { await key(d, 'Tab', 9); const inside = await d.ev<boolean>(`const el = document.querySelector('isometric-diagram'); return document.activeElement === document.body || (document.activeElement === el && el.shadowRoot.querySelector('dialog').contains(el.shadowRoot.activeElement));`); assert.ok(inside, `Tab ${i}`); }
  await d.ev(`${FULL} r.querySelector('.still').click(); await tick(60); el.collapse(); await tick(60);`);
  assert.deepEqual(await d.ev(`${FULL} tr.play(); await tick(60); return [r.querySelector('.still').getAttribute('aria-pressed'), tr.playing, tr.time === tr.duration];`), ['true', false, true]);
  assert.equal(await d.ev(`${FULL} el.expand(); await tick(60); return full().querySelector('.still').getAttribute('aria-pressed');`), 'true');
}));

test('enlarged: expand="off" has no button and does nothing, and puts an open one back; a #still has none; with no controls it has; by hand, and shown where nothing hovers', opts, page(`<isometric-diagram expand="off"><script type="text/yaml">\n${MOVING}</script></isometric-diagram>`, async d => {
  const st = () => d.ev<unknown[]>(`${FULL} return [btn.hidden, btn.getClientRects().length > 0, el.expanded];`);
  assert.deepEqual(await st(), [true, false, false]); assert.equal(await d.ev(`${FULL} return el.expand();`), false);
  await d.ev(`${FULL} el.removeAttribute('expand');`); assert.deepEqual(await st(), [false, true, false], 'no controls: it has one');
  assert.equal(await d.ev(`${FULL} return el.expand();`), true); assert.equal(await d.ev(`${FULL} return el.expand();`), true, 'again: it is'); assert.equal(await d.ev(`${FULL} return r.activeElement === full().querySelector('.iso-play');`), true, 'the focus');
  await d.ev(`${FULL} el.setAttribute('expand', 'off'); await tick(60);`); assert.deepEqual(await st(), [true, false, false], 'put back');
  await d.ev(`${FULL} el.removeAttribute('expand'); el.setAttribute('links', ''); location.hash = '#step=2&still'; const p = el.parentNode; el.remove(); p.append(el); await tick(250);`);
  assert.deepEqual(await st(), [true, false, false], 'a picture'); assert.equal(await d.ev(`${FULL} return el.expand();`), false);
  await d.ev(`${FULL} location.hash = ''; const p = el.parentNode; el.remove(); p.append(el); await tick(250);`); assert.deepEqual(await st(), [false, true, false]);
  await d.cdp('Emulation.setTouchEmulationEnabled', { enabled: true }); await d.cdp('Emulation.setDeviceMetricsOverride', { width: 400, height: 800, deviceScaleFactor: 2, mobile: true }); assert.equal(await d.ev(`return matchMedia('(hover: none)').matches;`), true); assert.equal(await d.ev(`${FULL} return getComputedStyle(btn).opacity;`), '1', 'a touch screen');
  await d.cdp('Emulation.setTouchEmulationEnabled', { enabled: false }); await d.cdp('Emulation.clearDeviceMetricsOverride'); assert.equal(await d.ev(`${FULL} btn.blur(); return getComputedStyle(btn).opacity;`), '0');
  await d.ev('document.body.tabIndex = -1; document.body.focus();'); // after the player's own (under Reduce Motion it has a Motion off button)
  const order: string[] = []; for (let i = 0; i < 4 && order.at(-1) !== 'iso-enlarge'; i++) { await key(d, 'Tab', 9); order.push(await d.ev<string>(`${FULL} return r.activeElement?.className.replace('iso-play-btn ', '') ?? '';`)); }
  assert.deepEqual(order.filter(c => c !== 'still'), ['iso-play zooms', 'z-in', 'iso-enlarge']); assert.equal(await d.ev(`${FULL} return getComputedStyle(btn).opacity;`), '1', 'by keyboard');
}));

test('enlarged, and the page changes it: another mode, label, drawing, a fault, off the page and on again', opts, page(TALL, async d => {
  await d.ev(`${LISTEN} document.querySelector('isometric-diagram').expand(); await tick(60);`);
  const where = () => d.ev<unknown[]>(`${FULL} return [el.expanded, r.querySelectorAll('.iso-play').length, !!full()?.querySelector('.iso-play'), r.querySelectorAll('.iso-frame').length, r.querySelectorAll('.iso-enlarge').length];`);
  assert.deepEqual(await where(), [true, 1, true, 1, 1]);
  await d.ev(`${FULL} el.setAttribute('mode', 'dark'); await tick(150);`); assert.deepEqual(await where(), [true, 1, true, 1, 1], 'mode');
  await d.ev(`${FULL} el.setAttribute('label', 'Other'); await tick(150);`); assert.deepEqual(await where(), [true, 1, true, 1, 1], 'a label: the player is another'); assert.equal(await d.ev(`${FULL} return full().getAttribute('aria-label') + btn.getAttribute('aria-label');`), 'OtherEnlarge: Other');
  await d.ev(`${FULL} el.collapse(); await tick(60);`); assert.deepEqual(await where(), [false, 1, false, 1, 1], 'back, the one drawn anew');
  await d.ev(`${FULL} el.expand(); el.source = 'isodiag: 1\\nscenes: 3'; await tick(150);`); assert.deepEqual(await d.ev(`${FULL} return [el.expanded, r.querySelectorAll('[role=alert]').length, r.querySelectorAll('dialog').length];`), [false, 1, 0], 'a fault is said on the page');
  await d.ev(`${FULL} el.source = ${JSON.stringify(DEMO)}; await tick(200);`); assert.deepEqual(await where(), [false, 1, false, 1, 1]);
  await d.ev(`${FULL} __ev.length = 0; el.expand(); const p = el.parentNode; el.remove(); await tick(60); p.append(el); await tick(200);`); assert.deepEqual(await where(), [false, 1, false, 1, 1], 'off the page and on');
  assert.deepEqual(await d.ev(`${FULL} el.expand(); await tick(60); el.collapse(); return __ev.filter(k => k === 'expand' || k === 'collapse');`), ['expand', 'expand', 'collapse']);
}));

test('enlarged among several that play in view: it plays, and what is behind it doesn\'t; back, the one most in view', opts, page(`${[1, 2].map(i => `<isometric-diagram id="p${i}" autoplay="visible"><script type="text/yaml">\n${MOVING}</script></isometric-diagram>`).join('')}`, async d => {
  const playing = (a: boolean, b: boolean, what: string) => d.until(`(t => t(1) === ${a} && t(2) === ${b})(i => document.querySelector('#p' + i).transport?.playing)`, what);
  await d.ev('scrollTo(0, 0);'); await playing(true, false, 'the first');
  await d.ev(`document.querySelector('#p2').expand();`); await playing(false, true, 'the enlarged one');
  await d.ev('await tick(400);'); await playing(false, true, 'still');
  await d.ev(`document.querySelector('#p2').collapse();`); await playing(true, false, 'the first again');
}));

for (const bars of [false, true]) test(`enlarged on a phone, light and dark: nothing cut off, the ✕ clear of it${bars ? ' (scrollbars that take room)' : ''}`, opts, page(TALL, async d => {
  if (bars) assert.equal(await d.ev('document.body.style.minHeight = "3000px"; return innerWidth - document.documentElement.clientWidth;'), 15, 'a scrollbar');
  for (const [w, h2] of [[380, 760], [760, 380], [1400, 900]] as const) for (const mode of ['light', 'dark']) {
    await d.cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h2, deviceScaleFactor: 1, mobile: false });
    const bad = await d.ev<string[]>(`${FULL} el.setAttribute('mode', '${mode}'); await tick(150); tr.seek(40000); el.expand(); await tick(200); const out = [], p = full().querySelector('.iso-play').getBoundingClientRect(), x = full().querySelector('.iso-full-close').getBoundingClientRect();
      if (p.left < 0 || p.right > W + 1 || p.bottom > H + 1) out.push('outside ' + JSON.stringify(p)); if (x.bottom > p.top) out.push('the ✕ over it'); if (x.width !== 44 || Math.round(W - x.right) !== 16 || Math.round(x.top) !== 16) out.push('the ✕ is ' + JSON.stringify(x));
      const s = full().querySelector('svg').getBoundingClientRect(); if (s.width < 120 || s.height < 100) out.push('the drawing is ' + s.width + ' × ' + s.height); if (full().querySelector('.iso-play').scrollWidth > full().querySelector('.iso-play').clientWidth + 1) out.push('scrolls sideways'); return out;`);
    assert.deepEqual(bad, [], `${w} ${mode}`);
    if (process.env.PLAYER_SHOTS) (await import('node:fs')).writeFileSync(`${process.env.PLAYER_SHOTS}/full-${mode}-${w}${bars ? '-bars' : ''}.png`, Buffer.from((await d.cdp('Page.captureScreenshot', { format: 'png' })).data!, 'base64'));
    await d.ev(`${FULL} el.collapse(); await tick(60);`);
  }
}, { bars }));

// ---------- 0.19.0: a reader's zoom and pan, and a file's own ants ----------
// where a point of the drawing is on the screen, and how many times closer than fitted it is, as the browser has it
const ZOOM = `${FULL} const root = r.querySelector('.iso-play'), svg = r.querySelector('.iso-play-stage svg'), st = svg.getBoundingClientRect(), vb = svg.getAttribute('viewBox');
  const at = (x, y) => { const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM().inverse()); return [p.x, p.y]; }, own = window.__own ?? vb, o4 = own.split(' ').map(Number), v4 = vb.split(' ').map(Number);
  const times = Math.min(st.width / v4[2], st.height / v4[3]) / Math.min(st.width / o4[2], st.height / o4[3]);`;
const OWN = `window.__own = document.querySelector('isometric-diagram').shadowRoot.querySelector('.iso-play-stage svg').getAttribute('viewBox'); window.__w = []; addEventListener('wheel', e => __w.push(e.defaultPrevented));`;
const near = (a: number, b: number, e: number, what = '') => assert.ok(Math.abs(a - b) <= e, `${what} ${a} is not ${b}`);
/** a point of the drawing's stage, in parts of it */
const spot = (d: Driver, fx = 0.5, fy = 0.5) => d.ev<{ x: number; y: number }>(`${ZOOM} return { x: Math.round(st.left + st.width * ${fx}), y: Math.round(st.top + st.height * ${fy}) };`);
const wheel = async (d: Driver, p: { x: number; y: number }, deltaY: number, modifiers = 0) => { const n = await d.ev<number>('return __w.length;'); await d.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p }); await d.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', ...p, deltaX: 0, deltaY, modifiers }); await d.until(`__w.length > ${n}`, 'the wheel'); await d.ev('await tick(40);'); };
const META = 4, CTRL = 2;
const press = async (d: Driver, p: { x: number; y: number }, type: string, n = 1) => { await d.cdp('Input.dispatchMouseEvent', { type, ...p, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: n }); };
const drag = async (d: Driver, a: { x: number; y: number }, b: { x: number; y: number }, held?: () => Promise<void>) => { await d.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...a }); await press(d, a, 'mousePressed'); for (let i = 1; i <= 5; i++) await d.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + (b.x - a.x) * i / 5, y: a.y + (b.y - a.y) * i / 5, button: 'left', buttons: 1 }); await held?.(); await press(d, b, 'mouseReleased'); await d.ev('await tick(40);'); };
const touch = async (d: Driver, type: string, pts: [number, number][]) => { await d.cdp('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) }); await d.ev('await tick(20);'); };
const typed = (d: Driver, k: string, modifiers = 0) => (async () => { for (const type of ['rawKeyDown', 'keyUp']) await d.cdp('Input.dispatchKeyEvent', { type, key: k, modifiers, windowsVirtualKeyCode: ({ ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 } as Record<string, number>)[k] ?? 0 }); await d.ev('await tick(20);'); })();
const view = (d: Driver) => d.ev<{ vb: string; times: number; closer: boolean; fit: boolean; out: boolean; in: boolean; own: boolean }>(`${ZOOM} const b = c => r.querySelector(c); return { vb, times, closer: root.classList.contains('closer'), fit: !b('.z-fit').hidden, out: !b('.z-out').disabled, in: !b('.z-in').disabled, own: vb === own };`);
const FITTED = { closer: false, fit: false, out: false, in: true, own: true };
const fitted = async (d: Driver, what: string) => { const { vb: _, times: __, ...x } = await view(d); assert.deepEqual(x, FITTED, what); };
const LONG = `<p>before</p><isometric-diagram id="e" label="Built"><script type="text/yaml">\n${MOVING}</script></isometric-diagram><div style="height:3000px" id="long"></div>`;
/** (0.27.1) the page at its top, and staying there: a wheel's smooth scroll may still be under way when it is put back, and carry
 *  it down again after a fixed wait (CI, 27 Nov: scrollY 40 where 0 was due). Put back at each frame it has moved, until it has read 0
 *  for three frames running (2 s at most) */
const TOP = `for (let n = 0, k = 0; n < 3 && k < 120; k++) { if (scrollY !== 0) { scrollTo(0, 0); n = 0; } else n++; await new Promise(r => requestAnimationFrame(r)); }`;
const tallPage = (d: Driver) => d.ev(`document.querySelector('#long')?.style.setProperty('height', '3000px'); scrollTo(0, 0); await tick(80); ${OWN}`);

for (const bars of [false, true]) test(`zoom: on the page the wheel scrolls it, and says once how to zoom; with ⌘ or Ctrl it zooms about the pointer, 1 to 8 times${bars ? ' (scrollbars that take room)' : ''}`, opts, page(LONG, async d => {
  await tallPage(d);
  const p = await spot(d, 0.4, 0.45);
  await wheel(d, p, 40); await d.until('scrollY > 0', 'the page scrolls');
  const said = () => d.ev<[boolean, string, string]>(`${FULL} const h = r.querySelector('.iso-zoom-hint'); return [getComputedStyle(h).visibility === 'visible', h.textContent, /Mac/.test(navigator.platform) ? '⌘ + scroll to zoom' : 'Ctrl + scroll to zoom'];`);
  const [on, words, want] = await said(); assert.equal(on, true, 'the hint'); assert.equal(words, want); await fitted(d, 'the wheel alone');
  await d.until(`getComputedStyle(document.querySelector('isometric-diagram').shadowRoot.querySelector('.iso-zoom-hint')).visibility === 'hidden'`, 'and it goes', 6000);
  await d.ev(TOP); await wheel(d, p, 40); assert.equal((await said())[0], false, 'once a page');
  await d.ev(TOP);
  for (const mod of [META, CTRL]) {
    const q = await spot(d, 0.5, 0.5), was = await d.ev<number[]>(`${ZOOM} return at(${q.x}, ${q.y});`);
    await wheel(d, q, -60, mod); await wheel(d, q, -60, mod);
    const v = await view(d), is = await d.ev<number[]>(`${ZOOM} return at(${q.x}, ${q.y});`);
    assert.ok(v.times > 1.2 && v.times < 2, `${mod}: ${v.times}`); assert.ok(v.closer && v.fit && v.out && v.in);
    near(is[0], was[0], 1, 'what is under the pointer'); near(is[1], was[1], 1, 'what is under the pointer');
    assert.equal(await d.ev('return scrollY;'), 0, 'the page stays');
    // closer still, off the middle, the point stays under the pointer too
    const q2 = await spot(d, 0.62, 0.4), a = await d.ev<number[]>(`${ZOOM} return at(${q2.x}, ${q2.y});`); await wheel(d, q2, -50, mod); const b = await d.ev<number[]>(`${ZOOM} return at(${q2.x}, ${q2.y});`);
    near(b[0], a[0], 1, 'off the middle'); near(b[1], a[1], 1, 'off the middle');
    for (let i = 0; i < 14; i++) await wheel(d, q, -2000, mod);
    const most = await view(d); near(most.times, 8, 0.02, 'the most'); assert.equal(most.in, false);
    // closer, the wheel alone still scrolls the page
    await wheel(d, q, 40); await d.until('scrollY > 0', 'closer, the page scrolls'); await d.ev(TOP); near((await view(d)).times, 8, 0.02);
    for (let i = 0; i < 14; i++) await wheel(d, q, 2000, mod);
    await fitted(d, 'all the way out');
  }
  // a wheel's notch with Ctrl is not a leap
  const q = await spot(d); await wheel(d, q, -100, CTRL); assert.ok((await view(d)).times < 1.4, String((await view(d)).times));
  // as the drawing is put elsewhere and back by a resize, still as close
  const t0 = (await view(d)).times; await d.cdp('Emulation.setDeviceMetricsOverride', { width: 700, height: 900, deviceScaleFactor: 1, mobile: false }); await d.ev('await tick(200);'); near((await view(d)).times, t0, 0.02, 'resized');
  assert.ok((await d.ev<number>(`${ZOOM} return Math.abs(st.width / st.height - o4[2] / o4[3]);`)) < 0.01, 'the shape it has on the page');
}, { bars }));

const NUMBERED = `isodiag: 1\nscenes:\n  - id: s\n    title: t\n    badges: true\n    nodes:\n      - { id: a, asset: block }\n      - { id: b, asset: block, right-of: a, gap: 5 }\n      - { id: c, asset: block, below: b, gap: 5 }\n      - { id: f, asset: block, below: a, gap: 5 }\n    routes:\n      - { id: r1, from: a, to: b, kind: send }\n      - { id: r2, from: b, to: c, kind: send }\n      - { id: r3, from: c, to: f, kind: send }\n    steps:\n      - { id: s1, kind: send, heading: One, animate: [ r1 ] }\n      - { id: s2, kind: send, heading: Two, animate: [ r2 ] }\n      - { id: s3, kind: send, heading: Three, animate: [ r3 ] }\n`;
test('zoom: a drag moves it once it is closer, not off its edge, and is not a click; a click on a step\'s number still is; a double click fits', opts, page(`<isometric-diagram id="e" controls><script type="text/yaml">\n${NUMBERED}</script></isometric-diagram>`, async d => {
  await d.ev(OWN);
  // a step's number, pressed: at 1 and closer
  const badge = (n: number) => d.ev<{ x: number; y: number }>(`${ZOOM} const b = svg.querySelector('[data-badge="${n}"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };`);
  const beat = () => d.ev<number>(`${ZOOM} return tr.beat?.index ?? -1;`);
  await press(d, await badge(2), 'mousePressed'); await press(d, await badge(2), 'mouseReleased'); await d.ev('await tick(60);'); assert.equal(await beat(), 1, 'a click');
  await drag(d, await spot(d, 0.3, 0.3), await spot(d, 0.6, 0.6)); await fitted(d, 'fitted, a drag does nothing');
  const b1 = await badge(1); for (let i = 0; i < 3; i++) await wheel(d, b1, -100, META);
  await d.ev(`${ZOOM} tr.pause(); tr.seek(tr.timeline.beats[2].start); await tick(60);`);
  const from = await badge(1), was = await d.ev<number[]>(`${ZOOM} return at(${from.x}, ${from.y});`), to = { x: from.x + 24, y: from.y + 16 };
  let held: unknown; await drag(d, from, to, async () => { held = await d.ev(`${ZOOM} return [root.classList.contains('dragging'), getComputedStyle(svg).cursor];`); });
  assert.deepEqual(held, [true, 'grabbing']); assert.equal(await d.ev(`${ZOOM} return root.classList.contains('dragging');`), false);
  assert.equal(await beat(), 2, 'a drag that began on a number isn\'t a click on it');
  const is = await d.ev<number[]>(`${ZOOM} return at(${to.x}, ${to.y});`); near(is[0], was[0], 2, 'it goes with the pointer'); near(is[1], was[1], 2, 'it goes with the pointer');
  const now = await badge(1); await press(d, now, 'mousePressed'); await press(d, { x: now.x + 2, y: now.y + 1 }, 'mouseMoved'); await press(d, now, 'mouseReleased'); await d.ev('await tick(60);'); assert.equal(await beat(), 0, 'closer, a click is one, and one that moved 2 px');
  // to the edge and no further
  for (let i = 0; i < 9; i++) await drag(d, await spot(d, 0.1, 0.15), await spot(d, 0.95, 0.95));
  const e = await d.ev<number[][]>(`${ZOOM} return [o4, v4];`); near(e[1][0], e[0][0], 1, 'its left edge'); near(e[1][1], e[0][1], 1, 'its top');
  const p = await spot(d, 0.3, 0.8); for (const n of [1, 2]) { await press(d, p, 'mousePressed', n); await press(d, p, 'mouseReleased', n); } await d.ev('await tick(60);'); await fitted(d, 'a double click');
  for (const n of [1, 2]) { await press(d, p, 'mousePressed', n); await press(d, p, 'mouseReleased', n); } await d.ev('await tick(60);'); await fitted(d, 'and fitted, nothing');
  // the right button, and a drag with the buttons over it, are not drags
  for (let i = 0; i < 3; i++) await wheel(d, p, -100, META);
  const vb = (await view(d)).vb, z = await d.ev<{ x: number; y: number }>(`${ZOOM} const b = r.querySelector('.z-fit').getBoundingClientRect(); return { x: b.left + 4, y: b.top + 18 };`); await drag(d, z, { x: z.x - 200, y: z.y + 200 }); assert.equal((await view(d)).vb, vb);
}));

test('zoom: its buttons and keys; the arrows still step; with Shift they move it; the focus is never lost; ⌘ + is the page\'s', opts, page(LONG.replace('<isometric-diagram id="e"', '<isometric-diagram id="e" controls'), async d => {
  await tallPage(d);
  assert.deepEqual(await d.ev(`${ZOOM} return [r.querySelector('.iso-zoom').getAttribute('role'), ...[...r.querySelectorAll('.iso-zoom button')].map(b => b.getAttribute('aria-label'))];`), ['group', 'Zoom out', 'Zoom in', 'Fit']);
  await d.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 990, y: 890 });
  const seen = () => d.ev<string>(`${ZOOM} return getComputedStyle(r.querySelector('.iso-zoom')).opacity;`);
  assert.equal(await d.ev(`${FULL} return matchMedia('(hover: none)').matches;`), false);
  if (await d.ev(`${FULL} return !el.matches(':hover');`)) assert.equal(await seen(), '0', 'not seen until it is pointed at');
  await d.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...await spot(d) }); assert.equal(await seen(), '1', 'pointed at');
  await click(d, `r.querySelector('.z-in')`); near((await view(d)).times, 1.25, 0.02, '+'); await click(d, `r.querySelector('.z-in')`); near((await view(d)).times, 1.5625, 0.02, '+ again');
  await click(d, `r.querySelector('.z-out')`); near((await view(d)).times, 1.25, 0.02, '−');
  await click(d, `r.querySelector('.z-fit')`); await fitted(d, 'Fit');
  const focus = () => d.ev<string>(`${ZOOM} const a = r.activeElement; return a === root ? 'the drawing' : a?.className ?? 'lost';`);
  // by keyboard on the buttons: where a button goes or can do no more, the focus is the drawing's
  await d.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 }); assert.equal(await d.ev(`${ZOOM} return root.matches(':hover');`), false);
  await d.ev(`${ZOOM} r.querySelector('.z-in').focus();`); assert.equal(await seen(), '1', 'by keyboard');
  await d.ev(`${ZOOM} for (let i = 0; i < 4; i++) r.querySelector('.z-in').click(); await tick(20);`); assert.match(await focus(), /z-in/, 'it stays');
  await d.ev(`${ZOOM} for (let i = 0; i < 12; i++) r.querySelector('.z-in').click(); await tick(20);`); assert.equal((await view(d)).in, false); assert.equal(await focus(), 'the drawing', 'at the most');
  await d.ev(`${ZOOM} r.querySelector('.z-fit').focus(); r.querySelector('.z-fit').click(); await tick(20);`); assert.equal(await focus(), 'the drawing', 'fitted'); await fitted(d, 'fitted');
  await d.ev(`${ZOOM} r.querySelector('.z-in').click(); r.querySelector('.z-out').focus(); r.querySelector('.z-out').click(); await tick(20);`); assert.equal(await focus(), 'the drawing', 'all the way out');
  await d.ev(`${ZOOM} root.focus();`);
  for (const [k, t] of [['+', 1.25], ['=', 1.5625], ['-', 1.25], ['_', 1]] as const) { await typed(d, k, k === '+' || k === '_' ? 8 : 0); near((await view(d)).times, t, 0.02, k); }
  await typed(d, '+'); await typed(d, '+'); const a = await d.ev<{ v: number[]; i: number }>(`${ZOOM} return { v: v4, i: tr.beat?.index ?? -1 };`);
  await typed(d, 'ArrowRight', 8); const b = await d.ev<{ v: number[]; i: number }>(`${ZOOM} return { v: v4, i: tr.beat?.index ?? -1 };`); assert.ok(b.v[0] > a.v[0] + 5 && b.v[1] === a.v[1] && b.i === a.i, 'Shift and the right arrow: further right');
  for (const k of ['ArrowLeft', 'ArrowLeft']) await typed(d, k, 8); assert.ok((await d.ev<number>(`${ZOOM} return v4[0];`)) < a.v[0]);
  await typed(d, 'ArrowDown', 8); assert.ok((await d.ev<number>(`${ZOOM} return v4[1];`)) > a.v[1]); await typed(d, 'ArrowUp', 8); await typed(d, 'ArrowUp', 8); assert.ok((await d.ev<number>(`${ZOOM} return v4[1];`)) < a.v[1]);
  const t = await d.ev<number>(`${ZOOM} tr.pause(); return tr.beat?.index ?? -1;`); await typed(d, 'ArrowRight'); await d.until(`(document.querySelector('isometric-diagram').transport.beat?.index ?? -1) === ${t + 1}`, 'the arrow alone steps');
  const z = (await view(d)).times; for (const mod of [META, CTRL]) { await d.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: '-', modifiers: mod }); await d.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: '-', modifiers: mod }); } near((await view(d)).times, z, 1e-9, 'with ⌘ or Ctrl the keys are the browser\'s');
  // the scrubber keeps its own keys
  await d.ev(`${ZOOM} r.querySelector('.iso-play-bar').focus();`); await typed(d, '0'); near((await view(d)).times, z, 1e-9, 'on the scrubber');
  await d.ev(`${ZOOM} root.focus();`); await typed(d, '0'); await fitted(d, '0');
}));

test('zoom by touch: on the page two fingers zoom and move it and one scrolls the page; enlarged and closer, one moves it', opts, page(LONG, async d => {
  await d.cdp('Emulation.setDeviceMetricsOverride', { width: 400, height: 800, deviceScaleFactor: 2, mobile: true }); await d.cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await tallPage(d); await d.ev(`window.__m = []; addEventListener('touchmove', e => __m.push([e.touches.length, e.defaultPrevented]), { passive: true }); window.__s2 = []; addEventListener('touchstart', e => __s2.push([e.touches.length, e.defaultPrevented]), { passive: true });`);
  const which = () => d.ev<string[]>(`${ZOOM} return [...r.querySelectorAll('.iso-zoom button')].filter(b => b.getClientRects().length).map(b => b.className.split(' ').pop());`);
  assert.deepEqual(await which(), [], 'no buttons over a phone\'s drawing until it is closer');
  const c = await spot(d), pinch = async (from: number, to: number, dx = 0, dy = 0) => { await touch(d, 'touchStart', [[c.x - from, c.y], [c.x + from, c.y]]); for (let i = 1; i <= 4; i++) { const k = from + (to - from) * i / 4; await touch(d, 'touchMove', [[c.x - k + dx * i / 4, c.y + dy * i / 4], [c.x + k + dx * i / 4, c.y + dy * i / 4]]); } await touch(d, 'touchEnd', []); };
  const was = await d.ev<number[]>(`${ZOOM} return at(${c.x}, ${c.y});`);
  await pinch(30, 75); const v = await view(d); near(v.times, 2.5, 0.1, 'the fingers apart'); assert.equal(await d.ev('return scrollY;'), 0); assert.ok((await d.ev<[number, boolean][]>('return __m;')).every(([n, p]) => n === 2 && p), 'the page\'s own pinch is not what happens');
  const is = await d.ev<number[]>(`${ZOOM} return at(${c.x}, ${c.y});`); near(is[0], was[0], 3); near(is[1], was[1], 3);
  assert.deepEqual(await d.ev('return __s2.filter(x => x[0] === 2);'), [[2, true]], 'from where it begins'); assert.equal(await d.ev('return visualViewport.scale;'), 1, 'the page is not zoomed'); assert.deepEqual(await which(), ['z-fit']);
  // two fingers together move it, and what is between them goes along
  const a = await d.ev<number[]>(`${ZOOM} return at(${c.x}, ${c.y});`); await pinch(40, 40, 30, 12); const b = await d.ev<number[]>(`${ZOOM} return at(${c.x + 30}, ${c.y + 12});`); near(b[0], a[0], 3); near(b[1], a[1], 3);
  // one finger: the page's, closer or not
  const vb = (await view(d)).vb; await d.ev('__m.length = 0;'); await touch(d, 'touchStart', [[c.x, c.y]]); for (let i = 1; i <= 6; i++) await touch(d, 'touchMove', [[c.x, c.y - 12 * i]]); await touch(d, 'touchEnd', []);
  assert.equal((await view(d)).vb, vb); assert.ok((await d.ev<[number, boolean][]>('return __m;')).every(([, p]) => !p)); await d.until('scrollY > 10', 'the page scrolls');
  await d.ev('scrollTo({ top: 0, behavior: "instant" }); await tick(400); scrollTo(0, 0); await tick(100);');
  // a tap on Fit
  const f = await d.ev<{ x: number; y: number }>(`${ZOOM} const b = r.querySelector('.z-fit').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };`); await touch(d, 'touchStart', [[f.x, f.y]]); await touch(d, 'touchEnd', []); await d.ev('await tick(400);'); await fitted(d, 'a tap on Fit');
  // enlarged
  await d.ev(`${FULL} el.expand(); await tick(200);`); assert.deepEqual(await which(), ['z-out', 'z-in']);
  const e = await spot(d), one = async (dx: number, dy: number) => { await touch(d, 'touchStart', [[e.x, e.y]]); for (let i = 1; i <= 4; i++) await touch(d, 'touchMove', [[e.x + dx * i / 4, e.y + dy * i / 4]]); await touch(d, 'touchEnd', []); };
  await one(40, 30); await fitted(d, 'fitted, one finger moves nothing');
  await touch(d, 'touchStart', [[e.x - 30, e.y], [e.x + 30, e.y]]); for (let i = 1; i <= 4; i++) await touch(d, 'touchMove', [[e.x - 30 - 30 * i, e.y], [e.x + 30 + 30 * i, e.y]]);
  near((await view(d)).times, 5, 0.3); await touch(d, 'touchEnd', []);
  // one of two fingers is lifted: the other goes on, with no jump (made by hand: the tools lift them all)
  await d.ev(`${ZOOM} window.__f = (type, xs) => { const pts = xs.map((x, identifier) => new Touch({ identifier, target: svg, clientX: x, clientY: ${e.y} })); svg.dispatchEvent(new TouchEvent(type, { touches: pts, changedTouches: pts, targetTouches: pts, bubbles: true, cancelable: true, composed: true })); }; __f('touchstart', [${e.x - 50}, ${e.x + 50}]); __f('touchmove', [${e.x - 40}, ${e.x + 50}]); await tick(30);`);
  const j = await view(d), h = await d.ev<number[]>(`${ZOOM} return at(${e.x - 40}, ${e.y});`); await d.ev(`__f('touchend', [${e.x - 40}]); __f('touchmove', [${e.x - 30}]); await tick(30);`);
  near((await view(d)).times, j.times, 0.02, 'lifted'); const h2 = await d.ev<number[]>(`${ZOOM} return at(${e.x - 30}, ${e.y});`); near(h2[0], h[0], 2, 'no jump'); near(h2[1], h[1], 2, 'no jump'); await d.ev(`__f('touchend', []);`);
  const a2 = await d.ev<number[]>(`${ZOOM} return at(${e.x}, ${e.y});`); await one(-30, 0); const b2 = await d.ev<number[]>(`${ZOOM} return at(${e.x - 30}, ${e.y});`); near(b2[0], a2[0], 3, 'one finger moves it'); near(b2[1], a2[1], 3);
  const t = (await view(d)).times; await d.ev(`${FULL} el.collapse(); await tick(200);`); near((await view(d)).times, t, 0.02, 'back on the page it is as close');
}));

test('zoom enlarged: the wheel alone zooms, the page behind stays; kept from the page to it and back, and over a document\'s camera; Esc closes', opts, page(LONG, async d => {
  await tallPage(d);
  const p = await spot(d); for (let i = 0; i < 4; i++) await wheel(d, p, -100, META);
  const t = (await view(d)).times, mid = () => d.ev<number[]>(`${ZOOM} return [v4[0] + v4[2] / 2, v4[1] + v4[3] / 2];`), m = await mid(), rest = await d.ev<number[]>('return [scrollY, document.documentElement.scrollHeight];');
  await d.ev(`${FULL} el.expand(); await tick(250);`); near((await view(d)).times, t, 0.02, 'as close'); const m2 = await mid(); near(m2[0], m[0], 2); near(m2[1], m[1], 2);
  assert.equal(await d.ev(`${ZOOM} return getComputedStyle(r.querySelector('.iso-zoom')).opacity;`), '1', 'its buttons always show there');
  const q = await spot(d); await wheel(d, q, -100); assert.ok((await view(d)).times > t * 1.2, 'the wheel alone'); await wheel(d, q, -100, META); for (let i = 0; i < 20; i++) await wheel(d, q, 200); await fitted(d, 'out'); assert.deepEqual(await d.ev('return [scrollY, document.documentElement.scrollHeight];'), rest);
  assert.equal(await d.ev(`${FULL} return getComputedStyle(r.querySelector('.iso-zoom-hint')).visibility;`), 'hidden');
  // the window made another shape while it is enlarged: as close, the stage filled, still on the drawing; at its edge too
  await d.ev(`${FULL} el.setAttribute('ambient', 'off'); tr.pause(); await tick(40);`);
  for (let i = 0; i < 4; i++) await wheel(d, q, -100); for (let i = 0; i < 4; i++) await drag(d, await spot(d, 0.2, 0.5), await spot(d, 0.95, 0.5));
  const edge = async (what: string) => { const g = await d.ev<{ times: number; shape: number; over: number }>(`${ZOOM} const k = Math.min(st.width / v4[2], st.height / v4[3]); return { times, shape: v4[2] / v4[3] - st.width / st.height, over: Math.max(o4[2] * k > st.width ? o4[0] - v4[0] : 0, o4[2] * k > st.width ? v4[0] + v4[2] - o4[0] - o4[2] : 0, o4[3] * k > st.height ? o4[1] - v4[1] : 0, o4[3] * k > st.height ? v4[1] + v4[3] - o4[1] - o4[3] : 0) }; `); near(g.shape, 0, 0.02, `${what}: the stage filled`); assert.ok(g.over < 1, `${what}: ${g.over} past its edge`); return g.times; };
  const w0 = await edge('at the edge'); for (const [w, h2] of [[500, 900], [1300, 500], [1000, 900]] as const) { await d.cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h2, deviceScaleFactor: 1, mobile: false }); await d.ev('await tick(200);'); near(await edge(`${w} × ${h2}`), w0, 0.02, 'as close'); }
  await d.ev(`${ZOOM} r.querySelector('.z-fit').click(); await tick(40);`);
  for (let i = 0; i < 3; i++) await wheel(d, q, -100); const t2 = (await view(d)).times; await key(d, 'Escape', 27); await d.until(`!document.querySelector('isometric-diagram').expanded`, 'Esc'); await d.ev('await tick(150);'); near((await view(d)).times, t2, 0.02, 'back');
  // a document's camera: as close on top of where it looks, and gone with Fit
  await d.ev(`${FULL} el.motion = { isomotion: 1, series: [{ sequence: { name: 'x', duration: 2000, children: [{ camera: { focus: [0, 0, 300, 200] }, duration: 500 }] } }, { sequence: { name: 'y', duration: 1000 } }] }; await tick(200);`);
  const cams = await d.ev<{ free: number[]; closer: number[] }>(`${ZOOM} tr.pause(); tr.seek(900); await tick(40); const g = () => svg2().getAttribute('viewBox').split(' ').map(Number), svg2 = () => r.querySelector('.iso-play-stage svg'); const closer = g(); r.querySelector('.z-fit').click(); await tick(40); return { closer, free: g() };`);
  assert.ok(Math.abs(cams.free[2] - (await d.ev<number>(`${ZOOM} return o4[2];`))) > 50, 'the camera looks somewhere');
  assert.ok(cams.closer[2] < cams.free[2] / 1.2, `${cams.closer} on ${cams.free}`); assert.ok(cams.closer[0] >= cams.free[0] - 1 && cams.closer[0] + cams.closer[2] <= cams.free[0] + cams.free[2] + 1);
  // and over the camera's end the drawing's own view is back
  await d.ev(`${ZOOM} tr.seek(tr.duration); await tick(40);`); assert.equal(await d.ev(`${ZOOM} return vb === own;`), await d.ev(`${ZOOM} return !tr.state().camera;`));
}));

// Safari's trackpad pinch, as it says it (there is none in Chrome): its events, made by hand
const PINCH = `for (const [type, scale] of [['gesturestart', 1], ['gesturechange', 1.5], ['gesturechange', 2], ['gestureend', 2]]) { const e = new Event(type, { bubbles: true, cancelable: true, composed: true }); Object.assign(e, { scale, clientX: st.left + st.width * 0.6, clientY: st.top + st.height * 0.4 }); svg.dispatchEvent(e); window.__g = (window.__g ?? []).concat(e.defaultPrevented); }`;
test('zoom: Safari\'s own pinch events zoom about the pointer, once; a host that freezes a player puts it back', opts, page(LONG, async d => {
  await tallPage(d); const p = await spot(d, 0.6, 0.4), a = await d.ev<number[]>(`${ZOOM} return at(st.left + st.width * 0.6, st.top + st.height * 0.4);`);
  await d.ev(`${ZOOM} ${PINCH} await tick(40);`); near((await view(d)).times, 2, 0.01); const b = await d.ev<number[]>(`${ZOOM} return at(st.left + st.width * 0.6, st.top + st.height * 0.4);`); near(b[0], a[0], 1, `at ${p.x}`); near(b[1], a[1], 1);
  assert.deepEqual(await d.ev('return __g.slice(0, 3);'), [true, true, true], 'not the page\'s pinch');
  await d.ev(`${ZOOM} ${PINCH} await tick(40);`); near((await view(d)).times, 4, 0.02, 'again, from where it is');
  // mountPlayer: no zoom unless it is asked for; frozen, it is the moment as drawn, and it stays so
  assert.deepEqual(await d.ev(`${module} const el = document.querySelector('isometric-diagram'), out = []; for (const zoom of [undefined, true]) { const h = document.createElement('div'), svgText = el.shadowRoot.querySelector('.iso-play-stage svg').cloneNode(true); svgText.setAttribute('viewBox', __own); document.body.prepend(h); const p = M.mountPlayer(h, { scene: { id: 'x', rendered: { svg: new XMLSerializer().serializeToString(svgText), viewBox: __own.split(' ').map(Number) } }, controls: false, zoom }); const vb = () => p.root.querySelector('svg').getAttribute('viewBox'); out.push(p.root.querySelectorAll('.iso-zoom').length); p.root.querySelector('.z-in')?.click(); out.push(vb() === __own); p.freeze(0); out.push(vb() === __own); p.dispose(); h.remove(); } return out;`), [0, true, true, 1, false, true]);
}));

test('zoom: kept when it is drawn again (mode, marks), not for another drawing; off with zoom="off"; none on a #still; with Motion off it zooms; printed, no buttons', opts, page(LONG, async d => {
  await tallPage(d);
  const p = await spot(d); for (let i = 0; i < 3; i++) await wheel(d, p, -100, META);
  const v = await view(d);
  await d.ev(`${FULL} el.setAttribute('mode', 'dark'); await tick(150); el.setAttribute('mode', 'light'); await tick(150);`); assert.equal((await view(d)).vb, v.vb, 'mode');
  await d.ev(`${module} ${MARKS} M.registerMarks(marks); await tick(150);`); assert.equal((await view(d)).vb, v.vb, 'marks');
  await d.ev(`${FULL} tr.seek(9000); await tick(60);`); assert.equal((await view(d)).vb, v.vb, 'as it plays');
  await d.ev(`${FULL} el.motion = undefined; el.source = ${JSON.stringify(MOVING.replace(/id: build\b/, 'id: other'))}; await tick(250);`); await fitted(d, 'another drawing');
  for (let i = 0; i < 3; i++) await wheel(d, p, -100, META);
  await d.ev(`${FULL} el.source = ${JSON.stringify(MOVING)}; await tick(250);`); await fitted(d, 'and back');
  // off: nothing of it, and the wheel with ⌘ or Ctrl is the page's
  await d.ev(`${FULL} el.setAttribute('zoom', 'off'); await tick(200);`);
  const none = () => d.ev<unknown[]>(`${ZOOM} return [r.querySelectorAll('.iso-zoom, .iso-zoom-hint').length, root.hasAttribute('tabindex'), vb === own];`);
  assert.deepEqual(await none(), [0, false, true]); await d.ev('__w.length = 0; addEventListener("wheel", e => e.preventDefault(), { passive: false });'); await wheel(d, p, -100, META); await wheel(d, p, -100, CTRL); assert.deepEqual(await d.ev('return __w;'), [false, false], 'not the player\'s'); assert.deepEqual(await none(), [0, false, true]);
  await d.ev(`${FULL} el.expand(); await tick(150);`); await wheel(d, p, -100); assert.deepEqual(await none(), [0, false, true], 'enlarged too'); await d.ev(`${FULL} el.collapse(); el.removeAttribute('zoom'); await tick(200);`); await fitted(d, 'on again'); for (let i = 0; i < 3; i++) await wheel(d, p, -100, META); assert.ok((await view(d)).times > 1.5);
  await d.cdp('Emulation.setEmulatedMedia', { media: 'print' }); assert.equal(await d.ev(`${ZOOM} return r.querySelector('.iso-zoom').getClientRects().length;`), 0, 'printed'); await d.cdp('Emulation.setEmulatedMedia', { media: '' });
  // a reader who asked for less motion, with Motion off: it zooms, at once, and plays nothing
  await d.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await d.ev(`${FULL} el.setAttribute('controls', ''); await tick(250); r.querySelector('.still').click(); await tick(60);`); await d.ev('__w.length = 0;');
  await wheel(d, await spot(d), -100, META); assert.ok((await view(d)).times > 1.2); assert.deepEqual(await d.ev(`${FULL} return [tr.playing, tr.time === tr.duration, r.querySelector('.still').getAttribute('aria-pressed')];`), [false, true, 'true']);
  // a picture
  await d.ev(`${FULL} el.setAttribute('links', ''); location.hash = '#step=2&still'; const q = el.parentNode; el.remove(); q.prepend(el); await tick(250); ${OWN}`);
  assert.equal(await d.ev(`${ZOOM} return r.querySelector('.iso-zoom').getClientRects().length;`), 0); await d.ev('__w.length = 0;'); await wheel(d, await spot(d), -100, META); assert.equal(await d.ev('return __w[0];'), false, 'the wheel is the page\'s'); await d.ev(`${ZOOM} window.__k = []; addEventListener('keydown', e => __k.push(e.defaultPrevented)); root.focus(); ${PINCH}`); await typed(d, '+'); assert.deepEqual(await d.ev('return __k;'), [false], 'and the key'); assert.equal(await d.ev(`${ZOOM} return vb === own && !root.classList.contains('closer');`), true, 'a #still stands');
}));

for (const [w, h2, mobile] of [[320, 640, true], [400, 800, true], [760, 380, true], [1000, 900, false]] as const) test(`zoom: its buttons clear of Enlarge, within the drawing, big enough: ${w} × ${h2}`, opts, page(LONG, async d => {
  await d.cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h2, deviceScaleFactor: 1, mobile }); if (mobile) await d.cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
  await tallPage(d); await d.ev(`${ZOOM} tr.seek(40000); el.setAttribute('mode', 'light'); await tick(150); root.focus();`); for (let i = 0; i < 4; i++) await typed(d, '+');
  for (const where of ['page', 'full'] as const) {
    if (where === 'full') await d.ev(`${FULL} el.expand(); await tick(200);`);
    if (!mobile) await d.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...await spot(d) });
    const bad = await d.ev<string[]>(`${ZOOM} const out = [], s = r.querySelector('.iso-play-stage').getBoundingClientRect(), bs = [...r.querySelectorAll('.iso-zoom button')].filter(b => b.getClientRects().length), other = [btn, r.querySelector('.iso-full-close')].filter(b => b && b.getClientRects().length && (!el.expanded || b !== btn));
      const rs = bs.map(b => b.getBoundingClientRect()); if (rs.length !== ${mobile ? (`${where === 'full' ? 3 : 1}`) : 3}) out.push(rs.length + ' buttons'); rs.forEach((a, i) => { if (a.width < 36 || a.height < 36) out.push('small'); if (a.left < s.left || a.right > s.right || a.top < s.top || a.bottom > Math.min(H, s.bottom)) out.push('outside'); for (const b of [...rs.slice(i + 1), ...other.map(x => x.getBoundingClientRect())]) if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push('over another'); if (!bs[i].matches(':disabled') && !bs[i].contains(r.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2))) out.push('covered'); });
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth) out.push('scrolls sideways'); return out;`);
    assert.deepEqual(bad, [], where);
    if (process.env.PLAYER_SHOTS) (await import('node:fs')).writeFileSync(`${process.env.PLAYER_SHOTS}/zoom-${where}-${w}.png`, Buffer.from((await d.cdp('Page.captureScreenshot', { format: 'png' })).data!, 'base64'));
  }
}));

const ANTS = (ants: string) => `isodiag: 1\nscenes:\n  - id: s\n    title: t\n${ants}    nodes:\n      - { id: a, asset: block }\n      - { id: b, asset: block, right-of: a, gap: 3 }\n      - { id: c, asset: block, right-of: b, gap: 3 }\n    routes:\n      - { id: r1, from: a, to: b, kind: send }\n      - { id: r2, from: b, to: c, kind: send }\n`;
const el2 = (id: string, yaml: string, at = '') => `<isometric-diagram id="${id}" ${at} style="display:block;width:300px"><script type="text/yaml">\n${yaml}</script></isometric-diagram>`;
test('a file\'s own ants march with no motion and no controls; only those it asks for; ambient="off", Motion off, respect, off the page: they stand', opts, page([el2('all', ANTS('    ants: true\n')), el2('some', ANTS('    ants: [r2]\n')), el2('none', ANTS('')), el2('off', ANTS('    ants: true\n'), 'ambient="off"'), el2('resp', ANTS('    ants: true\n'), 'reduced-motion="respect"')].join(''), async d => {
  const offs = (id: string) => d.ev<(string | null)[]>(`const r = document.querySelector('#${id}').shadowRoot; return ['r1', 'r2'].map(k => { const p = r.querySelector('[data-route="' + k + '"][data-part=line]') ?? r.querySelector('[data-id="' + k + '"]'); const e = p.matches('path') ? p : p.querySelector('path'); return e.style.strokeDashoffset || null; });`);
  const marches = async (id: string) => { const a = await offs(id); let m = [false, false]; for (let i = 0; i < 12 && !m.every(Boolean); i++) { await d.ev('await tick(60);'); const b = await offs(id); m = m.map((x, k) => x || a[k] !== b[k]); } return m; };
  for (const motion of ['no-preference', 'reduce']) {
    await d.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] });
    await d.ev(`for (const el of [...document.querySelectorAll('isometric-diagram')]) el.replaceWith(el.cloneNode(true)); scrollTo(0, 0); await tick(300);`);
    const see = (id: string) => d.ev(`document.querySelector('#${id}').scrollIntoView({ block: 'center' }); await tick(250);`);
    await see('all'); assert.deepEqual(await marches('all'), [true, true], motion); await see('some'); assert.deepEqual(await marches('some'), [false, true], motion); await see('none'); assert.deepEqual(await marches('none'), [false, false]); await see('off'); assert.deepEqual(await marches('off'), [false, false], 'ambient="off"');
    await see('resp'); assert.deepEqual(await marches('resp'), motion === 'reduce' ? [false, false] : [true, true], `${motion}: respect`);
    // Motion off, for a reader who asked for less: there with nothing else to play, and it stops them
    await see('all'); const still = await d.ev<boolean>(`const b = document.querySelector('#all').shadowRoot.querySelector('.still'); return !!b && b.getClientRects().length > 0;`); assert.equal(still, motion === 'reduce');
    if (still) { await d.ev(`document.querySelector('#all').shadowRoot.querySelector('.still').click(); await tick(60);`); assert.deepEqual(await marches('all'), [false, false], 'Motion off'); await d.ev(`document.querySelector('#all').shadowRoot.querySelector('.still').click(); await tick(60);`); assert.deepEqual(await marches('all'), [true, true], 'and on again'); }
    // the page turns them off and on as they go, and draws again
    await d.ev(`document.querySelector('#all').setAttribute('ambient', 'off');`); assert.deepEqual(await marches('all'), [false, false]); await d.ev(`document.querySelector('#all').removeAttribute('ambient');`); assert.deepEqual(await marches('all'), [true, true]);
    await d.ev(`document.querySelector('#all').setAttribute('mode', 'dark'); await tick(150);`); assert.deepEqual(await marches('all'), [true, true], 'dark');
    assert.deepEqual(await d.ev(`const t = document.querySelector('#all').transport; return [t.duration, t.timeline.beats.length, t.playing];`), [0, 0, false]);
  }
  // with controls: the ambient switch, and nothing that plays
  await d.ev(`const el = document.querySelector('#some'); el.setAttribute('controls', ''); await tick(250); el.scrollIntoView({ block: 'center' }); await tick(200);`);
  assert.deepEqual(await d.ev(`return [...document.querySelector('#some').shadowRoot.querySelectorAll('.iso-play-row .iso-play-btn, .iso-play-row input')].filter(b => b.getClientRects().length && !b.classList.contains('still')).map(b => b.className.split(' ').pop());`), ['ambient']);
  await d.ev(`document.querySelector('#some').shadowRoot.querySelector('.ambient').click();`); assert.deepEqual(await marches('some'), [false, false]);
}));

test('autoplay="visible" plays once: at its end a scroll, away and back, Enlarge and a redraw leave it there; Play begins again; one that loops goes on', opts, page(`<isometric-diagram id="e" controls autoplay="visible" rate="20"><script type="text/yaml">\n${MOVING}</script></isometric-diagram><div style="height:3000px" id="long"></div>`, async d => {
  await d.ev(`document.querySelector('#long').style.setProperty('height', '3000px'); window.__n = 0; document.querySelector('isometric-diagram').addEventListener('play', () => __n++); scrollTo(0, 0);`);
  await d.until('(t => !t.playing && t.time > 0 && t.time === t.duration)(document.querySelector("isometric-diagram").transport)', 'to its end');
  const n = await d.ev<number>('return __n;');
  // what shows: the pieces that aren't hidden
  const shown = () => d.ev<number>(`${FULL} return [...r.querySelectorAll('.iso-play-stage svg [data-item]')].filter(e => { for (let x = e; x && x.localName !== 'svg'; x = x.parentElement) if (x.getAttribute('opacity') === '0' || x.style.opacity === '0') return false; return true; }).length;`), all = await shown();
  assert.ok(all > 20, `${all} pieces`);
  for (const y of [60, 200, 330, 450, 2500, 400, 200, 0]) await d.ev(`scrollTo(0, ${y}); await tick(120);`);
  await d.ev(`${FULL} el.expand(); await tick(150); el.collapse(); await tick(150); el.setAttribute('mode', 'dark'); await tick(150);`);
  assert.deepEqual(await d.ev(`${FULL} return [__n, tr.playing, tr.time === tr.duration];`), [n, false, true]);
  assert.equal(await shown(), all, 'all of it still');
  await d.ev(`${FULL} r.querySelector('.play').click(); await tick(60);`); assert.deepEqual(await d.ev(`${FULL} return [__n, tr.playing, tr.time < tr.duration];`), [n + 1, true, true], 'Play');
  await d.ev(`${FULL} tr.seek(tr.duration); await tick(60); r.querySelector('.again').click(); await tick(60); __n = 0; tr.pause(); tr.seek(tr.duration); tr.play(); await tick(60);`); assert.deepEqual(await d.ev(`${FULL} return [__n, tr.playing, tr.time < tr.duration];`), [1, true, true], 'the page\'s own play()');
  // stopped part way by leaving, it goes on from there; looping, it has no end
  await d.ev(`${FULL} tr.pause(); el.setAttribute('rate', '1'); tr.seek(5000); el.remove(); await tick(60); document.body.prepend(el); await tick(60);`);
  await d.until('document.querySelector("isometric-diagram").transport?.playing', 'put back, it begins'); await d.ev('scrollTo(0, 2500); await tick(300);'); assert.equal(await d.ev(`${FULL} return tr.playing;`), false, 'away');
  const at = await d.ev<number>(`${FULL} return tr.time;`); await d.ev('scrollTo(0, 0);'); await d.until('document.querySelector("isometric-diagram").transport.playing', 'back'); assert.ok(await d.ev<number>(`${FULL} return tr.time;`) >= at, 'on from there');
  await d.ev(`${FULL} el.setAttribute('loop', ''); tr.seek(tr.duration - 100);`); await d.until('(t => t.playing && t.time > 0 && t.time < 5000)(document.querySelector("isometric-diagram").transport)', 'loops');
  // a reader who asked for less motion: Motion off and on begins it again, as before
  await d.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await d.ev(`${FULL} el.removeAttribute('loop'); el.setAttribute('rate', '20'); const p = el.parentNode; el.remove(); await tick(60); p.prepend(el); await tick(60); scrollTo(0, 0);`); await d.until('(t => !!t && !t.playing && t.time > 0 && t.time === t.duration)(document.querySelector("isometric-diagram").transport)', 'to its end again');
  await d.ev(`${FULL} el.setAttribute('rate', '1'); r.querySelector('.still').click(); await tick(60); r.querySelector('.still').click();`); await d.until('(t => t.playing && t.time > 0 && t.time < 5000)(document.querySelector("isometric-diagram").transport)', 'Motion off, and on again');
}));
