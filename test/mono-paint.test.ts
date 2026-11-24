// Black and white drawings (src/iso-objects/mono-paint.ts): the same drawing in another paint. No hue; the geometry, ids, wrappers and
// words of the styled one; patterns that stand out, inside the things they are on; motion that runs as it does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { compile } from '../src/iso-systems/compile.ts';
import { renderSvg } from '../src/iso-systems/render.ts';
import { assemble, svgAt } from '../src/iso-objects/motion.ts';
import { bindMotion, motionOfSteps } from '../src/iso-objects/timeline.ts';
import { contrast } from '../src/iso-core/mono.ts';

const read = (f: string) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const THEME = read('themes/default.yaml');
const dir = (d: string) => { try { return readdirSync(new URL('../' + d, import.meta.url)).filter(f => f.endsWith('.yaml')).map(f => `${d}/${f}`); } catch { return []; } };
const FILES = ['examples/demo.yaml', 'examples/gallery.yaml', 'examples/grid-assemble.yaml', ...dir('examples/scenarios'), ...dir('corpus')];
const MODES = ['light', 'dark'] as const;
const draw = (f: string, mode: 'light' | 'dark', mono = true) => compile(read(f), THEME, { mode, resolveVars: true, strict: 'throw', ...(mono ? { treatment: 'mono' as const } : {}) });
const hues = (svg: string) => [...svg.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)].map(m => m[1]).filter(x => (x.length === 3 ? new Set(x).size > 1 : new Set([x.slice(0, 2), x.slice(2, 4), x.slice(4)]).size > 1));
/** the drawing without its paint */
const bare = (svg: string) => svg.replace(/<pattern [\s\S]*?<\/pattern>/g, '').replace('<defs></defs>', '<defs/>').replace(/<(?:polygon|path)[^>]* class="mono-pattern"[^>]*\/>/g, '')
  .replace(/ (?:fill|stroke|stroke-width|stroke-dasharray|fill-opacity|stroke-opacity|opacity|stop-color|stop-opacity)="[^"]*"/g, '');

for (const mode of MODES) test(`every drawing, ${mode}: no hue, nothing left to a stylesheet, and the styled drawing's geometry, ids, wrappers and words`, () => {
  for (const f of FILES) {
    const c = draw(f, mode), plain = draw(f, mode, false);
    c.scenes.forEach((s, i) => {
      const svg = s.rendered.svg;
      assert.deepEqual(hues(svg), [], f); assert.doesNotMatch(svg, /var\(|hsl\(|rgb\(|color-mix|style=|<style|currentColor|NaN|undefined/, f);
      const x = bare(svg), y = bare(plain.scenes[i].rendered.svg);
      if (x !== y) { let k = 0; while (k < x.length && x[k] === y[k]) k++; assert.fail(`${f} ${s.id}: …${x.slice(Math.max(0, k - 160), k + 80)} ≠ …${y.slice(Math.max(0, k - 160), k + 80)}`); }
      assert.deepEqual(hues(Object.values(s.rendered.inks!.kinds!).join(' ') + s.rendered.inks!.control + s.rendered.inks!.surface), []);
    });
  }
});

test('a pattern stands out from the face it is on, and is inside its thing; a ground\'s top and front have none; ids begin with the scene\'s', () => {
  let n = 0;
  for (const f of FILES) for (const mode of MODES) for (const s of draw(f, mode).scenes) {
    const svg = s.rendered.svg;
    for (const m of svg.matchAll(/<(?:polygon|path)([^>]*)\/><(?:polygon|path)([^>]*) class="mono-pattern" fill="url\(#([^)]*)\)"/g)) {
      n++;
      const face = / fill="(#[0-9a-f]{6})"/.exec(m[1])![1], ink = '#' + m[3].slice(-6);
      assert.ok(contrast(face, ink) >= 3, `${f} ${mode}: ${ink} on ${face}: ${contrast(face, ink).toFixed(2)}`);
      assert.equal(/ (?:points|d)="([^"]*)"/.exec(m[1])![1], / (?:points|d)="([^"]*)"/.exec(m[2])![1]);
      assert.ok(m[3].startsWith(`${s.id}-mono-`), m[3]); assert.ok(svg.includes(`<pattern id="${m[3]}"`), m[3]);
    }
    const base = /<g class="g-base">([\s\S]*?)<g class="g-floor">/.exec(svg)![1];
    for (const m of base.matchAll(/class="(?:top|lft)[^>]*\/><(?:polygon|path)[^>]* class="mono-pattern"/g)) assert.fail(`${f}: a ground's top or front: ${m[0].slice(0, 80)}`);
    // nothing of it outside a thing's wrapper
    const outside = svg.replace(/<defs>[\s\S]*?<\/defs>/, '').split(/<g data-(?:item|route)=/)[0];
    assert.doesNotMatch(outside, /mono-pattern/);
  }
  assert.ok(n > 100, `${n} patterned faces`);
});

test('connectors keep apart by rhythm, not by colour: each kind its own dash and weight, dark heavier', () => {
  const seen = (mode: 'light' | 'dark') => { const s = draw('examples/demo.yaml', mode).scenes[0], out = new Map<string, string>(); for (const m of s.rendered.svg.matchAll(/<path[^>]*class="flow f-([\w-]+)"[^>]*>/g)) { const w = / stroke-width="([^"]*)"/.exec(m[0])![1], d = / stroke-dasharray="([^"]*)"/.exec(m[0])?.[1] ?? 'none'; out.set(m[1], `${w} ${d}`); } return out; };
  const light = seen('light'), dark = seen('dark');
  assert.ok(light.size >= 3); assert.equal(new Set(light.values()).size, light.size, JSON.stringify([...light]));
  for (const [k, v] of light) assert.ok(Math.abs(parseFloat(dark.get(k)!) - parseFloat(v) - 0.4) < 1e-9, k);
});

test('every connector is drawn in ink, whatever colour its kind has: a pale one would be lost on the paper', () => {
  const src = `isodiag: 1\nkinds:\n  pale: { like: send, color: "#ffee00" }\nscenes:\n  - id: s\n    title: T\n    nodes:\n      - { id: a, asset: server }\n      - { id: b, asset: server, right-of: a, gap: 4 }\n    routes:\n      - { id: r, from: a, to: b, kind: pale, label: go }\n`;
  for (const mode of MODES) {
    const s = compile(src, THEME, { mode, resolveVars: true, treatment: 'mono', strict: 'throw' }).scenes[0], ink = s.rendered.mono!.ink;
    const flows = [...s.rendered.svg.matchAll(/<path[^>]*class="flow f-pale"[^>]*>/g)];
    assert.ok(flows.length); for (const m of flows) assert.match(m[0], new RegExp(`stroke="${ink}"`));
    assert.match(s.rendered.svg, new RegExp(`<text[^>]*class="[^"]*t-pale[^"]*"[^>]*fill="${ink}"|<text[^>]*fill="${ink}"[^>]*class="[^"]*t-pale`));
    assert.equal(s.rendered.inks!.kinds!.pale, ink);
  }
});

test('words: every text against what the treatment draws them on, light and dark, at least 4.5; small notes too', () => {
  for (const f of FILES) for (const mode of MODES) for (const s of draw(f, mode).scenes) {
    const paper = s.rendered.mono!.paper;
    // the labels over things have a halo in paper, so paper is what they are read on
    const labels = /<g class="g-labels">([\s\S]*?)<g class="g-marks">/.exec(s.rendered.svg)![1];
    for (const m of labels.matchAll(/<text[^>]* fill="(#[0-9a-f]{6})"[^>]*>/g)) assert.ok(contrast(m[1], paper) >= 4.5, `${f} ${mode}: ${m[1]}`);
  }
});

test('motion runs as it does: the plan\'s ends and the steps\' frames, with no hue; its tokens and rings in ink', () => {
  for (const mode of MODES) {
    const s = draw('examples/demo.yaml', mode).scenes[0], p = assemble(s, { pulses: true, connectors: 'grow' });
    assert.equal(p.frame(p.duration), s.rendered.svg);
    for (const x of [0.2, 0.6, 0.97]) assert.deepEqual(hues(p.frame(p.duration * x)), []);
    const tl = bindMotion(s, motionOfSteps(s)), plain = draw('examples/demo.yaml', mode, false).scenes[0];
    for (const t of [500, 7000, 20000]) { const svg = svgAt(s, tl.at(t)); assert.deepEqual(hues(svg), []); assert.deepEqual(tl.at(t), bindMotion(plain, motionOfSteps(plain)).at(t)); }
    assert.match(svgAt(s, tl.at(500)), new RegExp(`class="tok" fill="${s.rendered.mono!.ink}"`));
  }
});

test('the options: renderSvg\'s, a host\'s own table, looks too; what can\'t be is said', () => {
  const src = read('examples/demo.yaml');
  assert.equal(renderSvg(src, { theme: THEME, mode: 'dark', treatment: 'mono' }), draw('examples/demo.yaml', 'dark').scenes[0].rendered.svg);
  assert.equal(renderSvg(src, { theme: THEME }), renderSvg(src, { theme: THEME, mode: 'light' }));
  const role = Object.entries(draw('examples/demo.yaml', 'light').scenes[0].rendered.mono!.roles).find(([, r]) => r.pattern === 'none')![0];
  const own = compile(src, THEME, { resolveVars: true, treatment: 'mono', mono: { roles: { [role]: { step: 3, pattern: 'dots' } }, kinds: { send: { dash: [1, 9], width: 5 } } } }).scenes[0];
  assert.equal(own.rendered.mono!.roles[role].pattern, 'dots'); assert.match(own.rendered.svg, /-mono-dots-/); assert.match(own.rendered.svg, /class="flow f-send"[^>]*stroke-dasharray="1 9"/);
  assert.throws(() => compile(src, THEME, { treatment: 'mono' }), /resolveVars/);
  assert.throws(() => compile(src, THEME, { resolveVars: true, treatment: 'sepia' as 'mono' }), /sepia/);
  const looks = compile(`isodiag: 1\nscenes:\n  - id: s\n    title: T\n    nodes:\n      - { id: a, asset: server, role: blue, variants: { hot: { role: gate } } }\n`, THEME, { resolveVars: true, treatment: 'mono', strict: 'throw' }).scenes[0];
  assert.deepEqual(hues(looks.rendered.variants!.hot), []); assert.notEqual(looks.rendered.variants!.hot, looks.rendered.svg);
  assert.ok(looks.rendered.mono!.roles.gate && looks.rendered.mono!.roles.blue, 'one table for both');
});

test('the document may name it, and the host may say otherwise; ants march in their kind\'s own rhythm', () => {
  const src = read('examples/demo.yaml'), named = 'treatment: mono\n' + src, mono = renderSvg(src, { theme: THEME, treatment: 'mono' });
  assert.equal(renderSvg(named, { theme: THEME }), mono); assert.equal(renderSvg(named, { theme: THEME, treatment: 'none' }), renderSvg(src, { theme: THEME }));
  // a styled compile is the page's, in colour, as it was
  assert.equal(compile(named, THEME).scenes[0].rendered.svg, compile(src, THEME).scenes[0].rendered.svg);
  assert.match(compile('treatment: sepia\n' + src, THEME).diags.map(d => d.message).join(), /treatment|mono/);
  const c = draw('examples/demo.yaml', 'light'), s = c.scenes[0], tl = bindMotion(s, { isomotion: 1, series: [{ sequence: { name: 'x', duration: 1000, ants: true } }] }, { kinds: c.theme!.kinds }), st = tl.at(300);
  let n = 0;
  for (const r of s.routes) { const d = s.rendered.mono!.kinds[r.kind].dash, a = st.routes?.[r.id]?.ants; if (!a) continue; n++; assert.deepEqual(a.dash, d.length > 1 ? [d[0], d[1]] : [9, 7], r.kind); }
  assert.ok(n > 2);
});

test('more roles on a grey than there are patterns: a warning names them', () => {
  const roles = ['belt', 'cloud', 'file', 'folder', 'gate', 'grey'];
  const s = compile(`isodiag: 1\nscenes:\n  - id: s\n    title: T\n    nodes:\n${roles.map((r, i) => `      - { id: n${i}, asset: block, role: ${r}, at: [${i * 3}, 0] }\n`).join('')}`, THEME, { resolveVars: true, treatment: 'mono', strict: 'throw' }).scenes[0];
  const w = s.rendered.warnings.filter(x => /black and white/.test(x.message));
  assert.ok(w.length >= 1, JSON.stringify(s.rendered.warnings)); assert.match(w[0].message, /"(\w+)".*"(\w+)"/);
});
