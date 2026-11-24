// Motion as a function of time (src/iso-objects/motion.ts): for every style, assemble's end and disassemble's start are the
// still render byte for byte and the other end is empty; frames are the same for the same scene, options, seed and time,
// in any order, and read no clock and no unseeded randomness; a state is plain JSON; golden frames (their hashes:
// UPDATE_SNAPSHOTS=1 to accept). In Chrome, paint() gives exactly the DOM svgAt() writes, in any order, and the empty
// frame draws nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { compile, CompileError } from '../src/iso-systems/compile.ts';
import { resolveSvg } from '../src/iso-objects/resolve.ts';
import { GRID_CSS } from '../src/iso-objects/css.ts';
import { ASSEMBLE_STYLES, DISASSEMBLE_STYLES, MOTION_ORDERS, MOTION_EASINGS, assemble, disassemble, motionModel, motionOrder, planOf, svgAt, typed, type ScenePlan, type SceneState } from '../src/iso-objects/motion.ts';
import { themeCss, loadTheme } from '../src/iso-core/theme.ts';
import { DRAWING_CSS } from '../src/iso-systems/css.ts';
import { MARKS_CSS } from '../src/iso-objects/css.ts';
import { bundlePage, drivePage } from './adapters/page-driver.ts';
// @ts-ignore plain JS helper
import { chromePath } from '../scripts/chrome.mjs';

const THEME = readFileSync(new URL('../themes/default.yaml', import.meta.url), 'utf8');
const read = (f: string) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const sceneOf = (text: string) => { const c = compile(text, THEME); assert.deepEqual(c.diags.filter(d => d.severity === 'error'), []); return c.scenes[0]; };
const FILES = ['examples/demo.yaml', 'corpus/fenced-worker.yaml', 'corpus/messaging.yaml', 'examples/scenarios/h-layered-stack.yaml'];
const SCENES = FILES.map(f => [f, sceneOf(read(f))] as const);
const plans = (s: typeof SCENES[number][1]): [string, ScenePlan][] => [
  ...ASSEMBLE_STYLES.map(style => [`assemble ${style}`, assemble(s, { style })] as [string, ScenePlan]),
  ...DISASSEMBLE_STYLES.map(style => [`disassemble ${style}`, disassemble(s, { style })] as [string, ScenePlan]),
];
/** everything a frame draws that isn't hidden: the wrappers that show, the mark layers that do, the overlay's shapes */
function shown(svg: string): string[] {
  const out: string[] = [];
  for (const m of svg.matchAll(/<g data-(?:item|route)="([^"]*)" data-part="([^"]*)"([^>]*)>/g)) if (!/ opacity="0"/.test(m[3])) out.push(`${m[1]}/${m[2]}`);
  for (const l of ['marks', 'badges']) { const m = new RegExp(`<g class="g-${l}"([^>]*)>(?!</g>)`).exec(svg); if (m && !/ opacity="0"/.test(m[1])) out.push(l); }
  if (!svg.includes('<g class="g-anim"></g>')) out.push('anim');
  return out;
}

for (const [f, s] of SCENES) test(`${f}: every style ends (or starts) on the still, byte for byte, and its other end is empty`, () => {
  const still = s.rendered.svg;
  for (const [name, p] of plans(s)) {
    const full = p.kind === 'assemble' ? p.duration : 0, none = p.kind === 'assemble' ? 0 : p.duration;
    assert.equal(p.frame(full), still, `${name}: the still`);
    assert.deepEqual(shown(p.frame(none)), [], `${name}: empty`);
    assert.deepEqual(p.at(full), {}, `${name}: the still's state is empty`);
    // past either end, and nonsense, is an end
    assert.equal(p.frame(p.duration + 1e6), p.frame(p.duration)); assert.equal(p.frame(-5), p.frame(0)); assert.equal(p.frame(NaN), p.frame(0));
    // in between something moves, and nothing in it is not a number
    const mid = p.frame(p.duration * 0.5);
    assert.notEqual(mid, still, name); assert.doesNotMatch(mid, /NaN|undefined|Infinity/, name);
    assert.ok(shown(mid).length > 0, `${name}: something shows half way`);
  }
});

test('frames are the same for the same scene, options, seed and time: again, backwards, and from a fresh compile', () => {
  for (const [f, s] of SCENES.slice(0, 2)) {
    const fresh = sceneOf(read(f)), A = plans(s), B = plans(fresh);
    for (const [i, [name, p]] of A.entries()) {
      const ts = [0.1, 0.25, 0.4, 0.55, 0.7, 0.9].map(x => x * p.duration), first = ts.map(t => p.frame(t));
      assert.deepEqual([...ts].reverse().map(t => p.frame(t)).reverse(), first, `${name}: backwards`);
      assert.deepEqual(ts.map(t => B[i][1].frame(t)), first, `${name}: a fresh compile`);
    }
  }
  const s = SCENES[0][1], at = (o: object) => assemble(s, o).frame(500);
  for (const o of [{ style: 'scatter' as const }, { order: 'random' as const, style: 'drop' as const }]) {
    assert.equal(at({ ...o, seed: 3 }), at({ ...o, seed: 3 }));
    assert.notEqual(at({ ...o, seed: 3 }), at({ ...o, seed: 4 }), 'the seed matters');
  }
});

test('a frame reads no clock and no unseeded randomness, and needs no DOM', () => {
  const src = read('src/iso-objects/motion.ts').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(src, /\bDate\b|\bperformance\b|requestAnimationFrame|setTimeout|setInterval|Math\.random|\bcrypto\b|\.animate\(|\bdocument\b|\bwindow\b|\bglobalThis\b/);
  const kept = { now: Date.now, perf: performance.now, random: Math.random };
  const no = () => { throw new Error('a clock or randomness was read'); };
  try {
    Date.now = no; performance.now = no; Math.random = no;
    for (const [, p] of plans(sceneless)) for (const x of [0, 0.3, 0.6, 1]) p.frame(p.duration * x);
  } finally { Date.now = kept.now; performance.now = kept.perf; Math.random = kept.random; }
  assert.equal((globalThis as { document?: unknown }).document, undefined);
});
const sceneless = SCENES[0][1];

test('a state is plain JSON: through JSON and back it is the same, and draws the same', () => {
  const s = SCENES[0][1];
  for (const [name, p] of plans(s)) for (const x of [0, 0.33, 0.66]) {
    const st = p.at(p.duration * x), back = JSON.parse(JSON.stringify(st)) as SceneState;
    assert.deepEqual(back, st, name);
    assert.equal(svgAt(s, back), p.frame(p.duration * x), name);
  }
  assert.equal(svgAt(s, {}), s.rendered.svg);
  assert.equal(svgAt(s, { morph: 0.5 }), s.rendered.svg, 'morph is a host\'s');
});

test('golden frames: each style at 35% and 70%, for two drawings', () => {
  const snap = new URL('./snapshots/motion.json', import.meta.url);
  const got: Record<string, string> = {};
  for (const [f, s] of SCENES.slice(0, 2)) for (const [name, p] of plans(s)) for (const x of [0.35, 0.7]) got[`${f} ${name} ${x}`] = createHash('sha256').update(p.frame(p.duration * x)).digest('hex').slice(0, 16);
  if (process.env.UPDATE_SNAPSHOTS || !existsSync(snap)) { writeFileSync(snap, JSON.stringify(got, null, 1) + '\n'); return; }
  assert.deepEqual(got, JSON.parse(readFileSync(snap, 'utf8')));
});

test('orders: every piece once; a region before what it holds; along the connectors; seeded; as listed', () => {
  for (const [f, s] of SCENES) {
    const m = motionModel(s), ids = m.pieces.map(p => p.id).sort();
    for (const o of MOTION_ORDERS) assert.deepEqual(motionOrder(m, o).map(p => p.id).sort(), ids, `${f} ${o}`);
    for (const o of ['by-region', 'by-flow'] as const) {
      const seen = new Set<string>();
      for (const p of motionOrder(m, o)) { assert.ok(!p.parent || seen.has(p.parent), `${f} ${o}: ${p.id} after ${p.parent}`); seen.add(p.id); }
    }
    const layers = motionOrder(m, 'by-layer').map(p => p.layer);
    assert.deepEqual(layers, [...layers].sort((a, b) => a - b), `${f} by-layer`);
    assert.deepEqual(motionOrder(m, 'as-listed').map(p => p.id), m.pieces.map(p => p.id));
    assert.deepEqual(motionOrder(m, 'random', { seed: 5 }), motionOrder(m, 'random', { seed: 5 }));
  }
  const flow = sceneOf(`isodiag: 1\nscenes:\n  - id: s\n    title: T\n    nodes:\n      - { id: c, at: [0, 0] }\n      - { id: b, at: [5, 0] }\n      - { id: a, at: [10, 0] }\n    routes:\n      - { id: r1, from: a, to: b, kind: send }\n      - { id: r2, from: b, to: c, kind: send }\n`);
  assert.deepEqual(motionOrder(motionModel(flow), 'by-flow').map(p => p.id), ['a', 'b', 'c']);
  assert.deepEqual(motionOrder(motionModel(flow), 'by-flow', { source: 'b' }).map(p => p.id), ['b', 'c', 'a']);
});

test('connectors: no arrowhead until a connector is there; grow keeps its dashes and ends on its path; pulses run and are gone', () => {
  const s = SCENES[0][1], path = (svg: string, id: string) => new RegExp(`data-route="${id}" data-part="line"[^>]*>.*?(<path[^>]*>)`).exec(svg)![1];
  for (const connectors of ['draw', 'grow'] as const) {
    const p = assemble(s, { connectors }), r = p.routes[0], mid = path(p.frame(r.delay + r.dur / 2), r.id);
    assert.match(path(s.rendered.svg, r.id), /marker-end/);
    assert.doesNotMatch(mid, /marker-end/, connectors);
    assert.match(path(p.frame(r.delay + r.dur), r.id), /marker-end/, `${connectors}: at its end`);
    if (connectors === 'grow') { assert.doesNotMatch(mid, /dasharray/); assert.ok(mid.length > 0 && / d="M[-\d.]+,[-\d.]+ L/.test(mid)); } else assert.match(mid, /stroke-dasharray/);
  }
  const q = assemble(s, { pulses: true }), plain = assemble(s);
  assert.ok(q.duration > plain.duration);
  assert.equal((q.at(q.duration - 300).tokens ?? []).length, s.routes.length);
  assert.equal(q.frame(q.duration), s.rendered.svg);
});

test('labels: typed a character at a time (an entity is one), or each with its piece', () => {
  assert.equal(typed('a&amp;b', 2 / 3), 'a&amp;'); assert.equal(typed('abc', 0), ''); assert.equal(typed('abc', 1), 'abc');
  const s = SCENES[0][1], p = assemble(s, { labels: 'type' }), f = p.frame(p.labels.delay + p.labels.dur / 2);
  const text = (svg: string) => [...svg.matchAll(/data-part="label"[^>]*>(.*?)<\/g>/g)].map(m => m[1].replace(/<[^>]*>/g, '')).join('|');
  assert.ok(text(f).length < text(s.rendered.svg).length && text(f).replace(/\|/g, '').length > 0);
  const w = assemble(s, { labels: 'with-piece' }), last = w.pieces[w.pieces.length - 1], t = last.delay + 1;
  const st = w.at(t);
  for (const x of w.pieces) if (x.delay + x.dur <= t) assert.equal(st.labels?.[x.id], undefined, `${x.id}'s label is there with it`);
});

test('motion: in the file: a piece\'s own, a region\'s for what it holds, the nearer winning; checked by the schema', () => {
  const src = (m: string, n: string) => `isodiag: 1\nscenes:\n  - id: s\n    title: T\n    regions:\n      - id: r\n        kind: slab\n        ${m}\n        nodes:\n          - { id: a${n} }\n          - { id: b }\n    nodes:\n      - { id: c, at: [20, 0] }\n`;
  const p = assemble(sceneOf(src('motion: { style: drop, out: sink, delay: 100, duration: 900 }', ', motion: { style: pop }')), { style: 'fade' });
  assert.deepEqual(Object.fromEntries(p.pieces.map(x => [x.id, [x.style, x.dur]])), { r: ['drop', 900], a: ['pop', 900], b: ['drop', 900], c: ['fade', 600] });
  const out = disassemble(sceneOf(src('motion: { out: sink }', '')), { style: 'explode' });
  assert.deepEqual(Object.fromEntries(out.pieces.map(x => [x.id, x.style])), { r: 'sink', a: 'sink', b: 'sink', c: 'explode' });
  for (const bad of ['motion: { style: whoosh }', 'motion: {}', 'motion: { delay: -1 }', 'motion: { speed: 2 }']) assert.ok(!compile(src(bad, ''), THEME).ok, bad);
  // the schema offers exactly what the code does
  const M = (JSON.parse(read('src/iso-systems/schema.json')) as { $defs: { motion: { properties: Record<string, { enum?: string[] }> } } }).$defs.motion.properties;
  assert.deepEqual([M.style.enum, M.out.enum, M.easing.enum], [[...ASSEMBLE_STYLES], [...DISASSEMBLE_STYLES], [...MOTION_EASINGS]]);
});

test('timing: the length asked for is the plan\'s; the default assemble is the page\'s intro; every easing starts and ends where it should', () => {
  const s = SCENES[0][1];
  for (const d of [200, 1400, 5000]) for (const [name, p] of [['in', assemble(s, { style: 'drop', duration: d })], ['out', disassemble(s, { duration: d })]] as const) {
    assert.equal(p.duration, d, name);
    for (const x of [...p.pieces, ...p.routes, p.labels]) assert.ok(x.delay >= 0 && x.delay + x.dur <= d + 0.05, `${name}: ${x.delay} + ${x.dur} in ${d}`);
  }
  const p = assemble(s), A = s.rendered.assembly;
  assert.equal(p.duration, A.total);
  assert.deepEqual(p.pieces.map(x => [x.id, x.delay, x.dur]), A.pieces.map(x => [x.id, x.delay, x.dur]));
  for (const easing of MOTION_EASINGS) { const q = assemble(s, { easing, style: 'fly' }); assert.equal(q.frame(q.duration), s.rendered.svg, easing); assert.doesNotMatch(q.frame(q.duration / 2), /NaN/, easing); }
  // a plan from the model alone (as a page has it, from JSON) is the scene's
  const m = JSON.parse(JSON.stringify(motionModel(s))) as ReturnType<typeof motionModel>;
  for (const t of [100, 700, 1200]) assert.deepEqual(planOf(m, 'assemble', { style: 'rise' }).at(t), assemble(s, { style: 'rise' }).at(t));
});

let chrome: string | undefined;
try { chrome = chromePath(); } catch { chrome = undefined; }
test('in Chrome: paint() gives exactly what svgAt() writes, seeking in any order, and the still back; the empty frame draws nothing', { skip: chrome ? false : 'no Chrome', timeout: 180000 }, async () => {
  const s = SCENES[1][1], css = themeCss(loadTheme(THEME)) + DRAWING_CSS + MARKS_CSS;
  const js = (await bundlePage('test/adapters/motion-page.ts')).outputFiles![0].contents;
  await drivePage(chrome!, js, '__motion', async ({ ev, until, cdp }) => {
    await until(`document.title === 'ready'`, 'the page');
    await ev(`const st = document.createElement('style'); st.textContent = ${JSON.stringify(css)} + 'body{margin:0}svg{width:800px;height:600px;display:block}'; document.head.append(st); const g = B.live(${JSON.stringify(s.rendered.svg)}); g.id = ''; document.body.append(g); window.__g = g;`);
    const cases: { name: string; state: SceneState; svg: string }[] = [];
    for (const [name, p] of plans(s)) for (const x of [0.8, 0, 0.45, 1, 0.2]) cases.push({ name: `${name} ${x}`, state: p.at(p.duration * x), svg: p.frame(p.duration * x) });
    const more: SceneState[] = [{ camera: [0, 0, 300, 200] }, { tokens: [{ route: s.routes[0].id, at: 0.5, color: 'red' }] }, { pulses: [{ x: 1, y: 2, rx: 3, ry: 4, opacity: 0.5, color: 'blue' }] }];
    const t = assemble(s, { labels: 'type', connectors: 'grow', pulses: true });
    for (const x of [0.3, 0.8, 0.97]) more.push(t.at(t.duration * x));
    // labels being typed, one moment after another and back (each from the whole text again)
    for (const x of [0.5, 0.8, 0.3]) more.push(t.at(t.labels.delay + t.labels.dur * x));
    for (const [i, st] of more.entries()) cases.push({ name: `state ${i}`, state: st, svg: svgAt(s, st) });
    cases.push({ name: 'the still back', state: {}, svg: s.rendered.svg });
    const bad = await ev<string[]>(`const out = []; const norm = e => { e.removeAttribute('id'); return e; }; for (const c of ${JSON.stringify(cases).replace(/</g, '\\u003c')}) { B.paint(window.__g, c.state); B.paint(window.__g, c.state); if (!norm(window.__g).isEqualNode(norm(B.live(c.svg)))) out.push(c.name); } return out;`);
    assert.deepEqual(bad, []);
    const shot = async () => (await cdp('Page.captureScreenshot', { format: 'png' })).data;
    await ev(`document.body.innerHTML = '<svg></svg>'; await tick(100);`);
    const blank = await shot();
    for (const [name, p] of plans(s)) { await ev(`document.body.replaceChildren(B.live(${JSON.stringify(p.frame(p.kind === 'assemble' ? 0 : p.duration))})); await tick(30);`); assert.equal(await shot(), blank, `${name}: its empty frame draws nothing`); }
  }, '800,600');
});

test('strict: a file with an error draws nothing, or throws its problems; stepMs: each step lasts what is asked', () => {
  const bad = `isodiag: 1\nscenes:\n  - id: s\n    title: T\n    nodes:\n      - { id: a }\n      - { id: b, right-of: nope }\n`;
  const loose = compile(bad, THEME), strict = compile(bad, THEME, { strict: true });
  assert.ok(!loose.ok && loose.scenes.length === 1, 'as before without it');
  assert.deepEqual([strict.ok, strict.scenes], [false, []]);
  assert.deepEqual(strict.diags, loose.diags);
  assert.throws(() => compile(bad, THEME, { strict: 'throw' }), e => e instanceof CompileError && /line 7: .*nope/.test(e.message) && e.diags.length === loose.diags.length);
  const ok = read('examples/demo.yaml');
  assert.equal(compile(ok, THEME, { strict: 'throw' }).scenes[0].rendered.svg, compile(ok, THEME).scenes[0].rendered.svg);
  assert.deepEqual([...new Set(compile(ok, THEME, { stepMs: 3000 }).scenes.flatMap(s => s.steps.steps.map(x => x.duration)))], [3000]);
});

test('resolveVars: a self-contained drawing in the mode asked; its frames too; nothing left to a stylesheet', () => {
  for (const f of [...FILES, 'examples/gallery.yaml', 'examples/grid-assemble.yaml', 'corpus/relay-hub.yaml']) for (const mode of ['light', 'dark'] as const) {
    const c = compile(read(f), THEME, { mode, resolveVars: true });
    for (const s of c.scenes) {
      assert.doesNotMatch(s.rendered.svg, /var\(|hsl\(|color-mix|style=|<style|currentColor|NaN/, `${f} ${mode}`);
      const p = assemble(s, { pulses: true, connectors: 'grow' });
      assert.equal(p.frame(p.duration), s.rendered.svg);
      for (const x of [0.2, 0.6, 0.97]) assert.doesNotMatch(p.frame(p.duration * x), /var\(|hsl\(|color-mix|NaN/, `${f} ${mode} ${x}`);
    }
  }
  const at = (mode?: 'light' | 'dark') => compile(read(FILES[0]), THEME, { mode, resolveVars: true }).scenes[0].rendered.svg;
  assert.notEqual(at('dark'), at('light')); assert.equal(at(), at('light'));
  const T = loadTheme(THEME), one = (css: string) => resolveSvg('<svg><g class="k-lead"><path class="x"/></g></svg>', { mode: 'light', theme: T, css });
  // !important, specificity, order, :not, a style attribute, inherited custom properties, alpha
  assert.match(one('.x{fill:#111}.k-lead .x{fill:#222}.x{fill:#333}'), /fill="#222222"/);
  assert.match(one('.x{fill:#111!important}.k-lead .x{fill:#222}'), /fill="#111111"/);
  assert.match(one('.x:not(.y){fill:#444}'), /fill="#444444"/); assert.doesNotMatch(one('.x:not(.x){fill:#444}'), /fill=/);
  assert.match(one('.x{fill:hsl(0 100% 50% / .5);fill-opacity:.5}'), /fill="#ff0000" fill-opacity="0.25"|fill-opacity="0.25" fill="#ff0000"/);
  assert.match(one('.x{fill:color-mix(in srgb,#000 25%,#fff)}'), /fill="#bfbfbf"/);
  assert.match(one('.k-lead{--q:#123456}.x{stroke:var(--q)}'), /stroke="#123456"/);
  for (const bad of ['.x{filter:blur(1px)}', '.x:hover{fill:red}', '.x{fill:lab(1 2 3)}', '.x{fill:var(--none)}', '@supports (x:y){.x{fill:#000}}']) assert.throws(() => one(bad), /resolve:/, bad);
});

test('in Chrome: a self-contained drawing on a page with no stylesheet looks exactly as the styled one, light and dark', { skip: chrome ? false : 'no Chrome', timeout: 180000 }, async () => {
  await drivePage(chrome!, new Uint8Array(), '__none', async ({ ev, cdp }) => {
    for (const f of ['examples/demo.yaml', 'corpus/fenced-worker.yaml']) for (const mode of ['light', 'dark'] as const) {
      const c = compile(read(f), THEME), r = compile(read(f), THEME, { mode, resolveVars: true }), bg = c.theme![mode].surface;
      await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
      const styled = themeCss(c.theme!) + '.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' + DRAWING_CSS + MARKS_CSS + GRID_CSS + '*{transition:none!important}';
      const shot = async (svg: string, css: string) => {
        await ev(`document.head.querySelectorAll('style').forEach(s => s.remove()); const st = document.createElement('style'); st.textContent = ${JSON.stringify(`body{margin:0;background:${bg}}body>svg{display:block;width:1000px;height:700px}${css}`)}; document.head.append(st); document.body.innerHTML = ${JSON.stringify(svg)}; await tick(80);`);
        return (await cdp('Page.captureScreenshot', { format: 'png' })).data;
      };
      // (the rasteriser itself varies from one picture to the next, by a few pixels: the two share one)
      const A = new Set<unknown>(), B = new Set<unknown>();
      for (let i = 0; i < 6 && ![...A].some(x => B.has(x)); i++) { A.add(await shot(c.scenes[0].rendered.svg, styled)); B.add(await shot(r.scenes[0].rendered.svg, '')); }
      assert.ok([...A].some(x => B.has(x)), `${f} ${mode}`);
    }
  }, '1000,700', { html: '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>', csp: null });
});
