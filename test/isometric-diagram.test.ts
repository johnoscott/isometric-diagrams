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
  assert.deepEqual(await d.ev(`${E0} return [...r.querySelectorAll('button')].filter(b => !b.classList.contains('still')).map(b => b.className);`), ['iso-enlarge']);
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
  assert.deepEqual(await d.ev(`const b = document.querySelector('#b'); return [b.transport.duration, [...b.shadowRoot.querySelectorAll('button,input')].filter(x => !x.hidden && x.getClientRects().length).map(x => x.className), b.shadowRoot.querySelectorAll('[data-item=a]').length > 0];`), [0, ['iso-enlarge'], true]);
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
  assert.equal(await d.ev(`${FULL} return el.expand();`), true); assert.equal(await d.ev(`${FULL} return el.expand();`), true, 'again: it is'); assert.equal(await d.ev(`${FULL} return r.activeElement === full().querySelector('.iso-full-close');`), true, 'the focus');
  await d.ev(`${FULL} el.setAttribute('expand', 'off'); await tick(60);`); assert.deepEqual(await st(), [true, false, false], 'put back');
  await d.ev(`${FULL} el.removeAttribute('expand'); el.setAttribute('links', ''); location.hash = '#step=2&still'; const p = el.parentNode; el.remove(); p.append(el); await tick(250);`);
  assert.deepEqual(await st(), [true, false, false], 'a picture'); assert.equal(await d.ev(`${FULL} return el.expand();`), false);
  await d.ev(`${FULL} location.hash = ''; const p = el.parentNode; el.remove(); p.append(el); await tick(250);`); assert.deepEqual(await st(), [false, true, false]);
  await d.cdp('Emulation.setTouchEmulationEnabled', { enabled: true }); await d.cdp('Emulation.setDeviceMetricsOverride', { width: 400, height: 800, deviceScaleFactor: 2, mobile: true }); assert.equal(await d.ev(`return matchMedia('(hover: none)').matches;`), true); assert.equal(await d.ev(`${FULL} return getComputedStyle(btn).opacity;`), '1', 'a touch screen');
  await d.cdp('Emulation.setTouchEmulationEnabled', { enabled: false }); await d.cdp('Emulation.clearDeviceMetricsOverride'); assert.equal(await d.ev(`${FULL} btn.blur(); return getComputedStyle(btn).opacity;`), '0');
  await d.ev('document.body.tabIndex = -1; document.body.focus();'); // after the player's own (under Reduce Motion it has a Motion off button)
  const order: string[] = []; for (let i = 0; i < 2 && order.at(-1) !== 'iso-enlarge'; i++) { await key(d, 'Tab', 9); order.push(await d.ev<string>(`${FULL} return r.activeElement?.className.replace('iso-play-btn ', '') ?? '';`)); }
  assert.deepEqual(order.filter(c => c !== 'still'), ['iso-enlarge']); assert.equal(await d.ev(`${FULL} return getComputedStyle(btn).opacity;`), '1', 'by keyboard');
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
