// The motion document and its Timeline (src/iso-objects/motion-doc.ts, timeline.ts):
//   - the stepped build (fixtures/motion): a hand-made page's build player, 14 steps in 5 chapters, against that page's own rules
//     written again here (what is shown at each step, what is ringed, the .45 s CSS ease, the ants from the eleventh);
//   - any moment in any order gives the same plain JSON, with no clock; two clocks: what the ambient one moves, and only that;
//   - Remotion's names as data: sequences, series, offsets, loops, rates, transitions; interpolate's and spring's values;
//   - the schema (ajv) and checkMotion agree; what is wrong is said, with its place; every drawing's steps as a document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';
import { compile } from '../src/iso-systems/compile.ts';
import { Ajv2020, AJV_OPTIONS } from '../src/iso-core/compile-schema.ts';
import { bindMotion, motionOfSteps, type Timeline } from '../src/iso-objects/timeline.ts';
import { checkMotion, curveAt, easeOf, msOf, springAt, type MotionDoc } from '../src/iso-objects/motion-doc.ts';
import { MOTION_SCHEMA } from '../src/iso-objects/motion-schema.ts';
import { svgAt, assemble } from '../src/iso-objects/motion.ts';
import { motion } from '../src/iso-objects/motion-builder.ts';
import { withAnts } from '../src/iso-objects/ants.ts';
import { renderSvg } from '../src/iso-systems/render.ts';


const read = (f: string) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const THEME = read('themes/default.yaml');
const compiled = (t: string) => { const c = compile(t, THEME); assert.deepEqual(c.diags.filter(d => d.severity === 'error'), []); return c; };
const BUILD = compiled(read('test/fixtures/motion/stepped-build.yaml'));
const DOC = parse(read('test/fixtures/motion/stepped-build.motion.yaml')) as MotionDoc;
const KINDS = BUILD.theme!.kinds;
const SMALL = compiled(`isodiag: 1
title: small
scenes:
  - id: s
    title: small
    nodes:
      - { id: a, asset: block }
      - { id: b, asset: block, right-of: a, gap: 3 }
      - { id: c, asset: block, right-of: b, gap: 3 }
    routes:
      - { id: r1, from: a, to: b, kind: send }
      - { id: r2, from: b, to: c, kind: token, label: go }
      - { id: r3, from: c, to: a, kind: blocked }
    notes:
      - { on: b, text: a note, at: [0, 0] }
`.replace('    notes:\n      - { on: b, text: a note, at: [0, 0] }\n', '')).scenes[0];
const bind = (doc: object, scene = SMALL): Timeline => { const t = bindMotion(scene, { isomotion: 1, ...doc } as MotionDoc, { kinds: KINDS }); assert.deepEqual(t.diags, []); return t; };
const wrong = (doc: object, scene = SMALL) => bindMotion(scene, { isomotion: 1, ...doc } as MotionDoc, { kinds: KINDS }).diags.map(d => `${d.path}: ${d.message}${d.hint ? ` (${d.hint})` : ''}`);
const opacity = (t: Timeline, id: string, ms: number) => { const s = t.at(ms); return s.items?.[id]?.opacity ?? s.routes?.[id]?.opacity ?? 1; };

test('the stepped build: what the page shows, rings and marches at every step, by its own rules', () => {
  const tl = bindMotion(BUILD.scenes[0], DOC, { kinds: KINDS });
  assert.deepEqual(tl.diags, []); assert.equal(tl.duration, 14 * 3200); assert.equal(tl.beats.length, 14);
  // the page: shown = every step's show less every step's hide, to here; focus = the step's own, else what it shows
  const steps = (DOC.series as { sequence: { show?: string[]; hide?: string[]; highlight?: string[]; say: { chapter: string } } }[]).map(x => x.sequence);
  assert.equal(new Set(steps.map(s => s.say.chapter)).size, 5);
  const every = [...new Set(steps.flatMap(s => s.show ?? []))], routes = new Set(BUILD.scenes[0].routes.map(r => r.id));
  const shown = new Set<string>();
  const ease = easeOf('ease', 450);
  let before = new Set<string>();
  steps.forEach((s, i) => {
    (s.show ?? []).forEach(id => shown.add(id)); (s.hide ?? []).forEach(id => shown.delete(id));
    const end = i * 3200 + 3199.9, st = tl.at(end);
    assert.deepEqual(every.filter(id => opacity(tl, id, end) === 1), every.filter(id => shown.has(id)), `step ${i + 1}: shown`);
    assert.deepEqual(every.filter(id => opacity(tl, id, end) === 0), every.filter(id => !shown.has(id)), `step ${i + 1}: not shown, at all`);
    const label = (id: string) => st.labels?.[id]?.opacity ?? 1;
    assert.deepEqual(every.filter(id => label(id) === 0), every.filter(id => !shown.has(id)), `step ${i + 1}: their labels go with them`);
    assert.deepEqual((st.outlines ?? []).map(o => o.id), s.highlight ?? [], `step ${i + 1}: ringed`);
    // the rings are seen with no stylesheet but the drawing's
    assert.equal([...svgAt(BUILD.scenes[0], st).matchAll(/<polygon [^>]*class="ring"[^>]*style="stroke:var\(--ring,var\(--control,currentColor\)\)"/g)].length, (s.highlight ?? []).length);
    // the ants: from the eleventh, on every connector shown but the planned one (it stands still, with its own dash)
    const marching = Object.entries(st.routes ?? {}).filter(([, r]) => r.ants).map(([id]) => id);
    assert.deepEqual(marching.sort(), i < 10 ? [] : [...routes].filter(r => shown.has(r) && r !== 'clone').sort(), `step ${i + 1}: marching`);
    // half way in, and a quarter: the CSS ease from the step before (its first moment is that step's last)
    for (const q of [0, 0.25, 0.5]) for (const id of every) {
      const want = Math.round(((before.has(id) ? 1 : 0) + ((shown.has(id) ? 1 : 0) - (before.has(id) ? 1 : 0)) * ease(q)) * 1e4) / 1e4;
      assert.equal(opacity(tl, id, i * 3200 + q * 450), want, `step ${i + 1}, ${q}: ${id}`);
    }
    before = new Set(shown);
    const cue = tl.cues(end)!;
    assert.deepEqual([cue.beat, cue.index, cue.of, cue.chapter, cue.say!.title], [`s${i + 1}`, i, 14, s.say.chapter, (s.say as { title?: string }).title]);
  });
  // any step first: the same as having come to it
  const fresh = bindMotion(BUILD.scenes[0], DOC, { kinds: KINDS });
  for (const i of [13, 4, 0, 9]) assert.deepEqual(fresh.at(i * 3200 + 1000), tl.at(i * 3200 + 1000));
  // 32 units in 1.1 s, with no seam from one step to the next
  const off = (t: number) => tl.at(t).routes!.net.ants!.offset;
  const gone = (a: number, b: number) => ((off(b) - off(a)) % 16 + 16) % 16;
  assert.ok(Math.abs(gone(36000, 36000 + 275) - 8) < 0.02, 'half a period in 275 ms');
  assert.ok(Math.abs(gone(38400 - 1, 38400 + 1) - (32 / 1100) * 2) < 0.02, 'no seam at a step');
  assert.deepEqual(tl.at(36000).routes!.net2.ants!.dash, [7, 6], 'a dashed kind marches with its own dash');
});

test('any moment, in any order, from anywhere: the same plain JSON; no clock; a frame without a DOM', () => {
  const a = bindMotion(BUILD.scenes[0], DOC, { kinds: KINDS }), b = bindMotion(compiled(read('test/fixtures/motion/stepped-build.yaml')).scenes[0], JSON.parse(JSON.stringify(DOC)), { kinds: KINDS });
  const ts = Array.from({ length: 60 }, (_, i) => ((i * 7919.37) % a.duration) + i / 7);
  const first = ts.map(t => JSON.stringify(a.at(t)));
  assert.deepEqual([...ts].reverse().map(t => JSON.stringify(b.at(t))).reverse(), first);
  for (const t of ts) { const s = a.at(t); assert.deepEqual(JSON.parse(JSON.stringify(s)), s); assert.doesNotMatch(JSON.stringify(s), /null|NaN/); }
  assert.equal(svgAt(BUILD.scenes[0], a.at(ts[7])), svgAt(BUILD.scenes[0], JSON.parse(first[7])));
  assert.doesNotMatch(svgAt(BUILD.scenes[0], a.at(36000)), /<animate|@keyframes|animation/, 'a frame has no animation of its own');
  const src = ['motion-doc', 'timeline'].map(f => read(`src/iso-objects/${f}.ts`).replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')).join('\n');
  assert.doesNotMatch(src, /\bDate\b|\bperformance\b|requestAnimationFrame|setTimeout|setInterval|Math\.random|\bdocument\.|\bwindow\b|globalThis/);
  // past either end is that end; nonsense is the start
  assert.deepEqual(a.at(1e9), a.at(a.duration)); assert.deepEqual(a.at(-5), a.at(0)); assert.deepEqual(a.at(NaN), a.at(0));
});

test('two clocks: the ambient moves ants and loops only; stopped, they stand; off, each stands at its start; at(T) is at(T, { ambient: T })', () => {
  const tl = bind({ series: [{ sequence: { name: 'one', duration: 4000, ants: ['r1'], children: [{ travel: ['r1', ['r1', 'r2']], loop: true }, { travel: ['r2'], each: 800 }, { pulse: ['a'], loop: true }, { lift: ['c'], by: 40 }] } }] });
  for (const t of [0, 333.3, 1700, 3999]) assert.deepEqual(tl.at(t), tl.at(t, { ambient: t }));
  const still = (s: object) => { const { tokens, pulses, routes, ...rest } = s as Record<string, unknown>; void tokens; void pulses; void routes; return rest; };
  const x = tl.at(500), y = tl.at(500, { ambient: 1300 });
  assert.deepEqual(still(x), still(y), 'the timeline stands'); assert.notDeepEqual(x.routes, y.routes); assert.notDeepEqual(x.pulses, y.pulses);
  assert.deepEqual(x.tokens![1], y.tokens!.find(t => t.route === 'r2' && t.at === x.tokens![1].at), 'a token sent once is the timeline\'s');
  // a whole turn of the loop (2 groups of 1150, and 700) is where it was; a second group is both at once
  assert.deepEqual(tl.at(500, { ambient: 500 + 3000 }).tokens, x.tokens);
  assert.deepEqual(tl.at(2000, { ambient: 1150 + 575 }).tokens!.slice(0, 2).map(t => t.route), ['r1', 'r2']);
  const off = tl.at(500, { ambient: 'off' });
  assert.deepEqual(still(off), still(x));
  // off: nothing is hidden. The loops are at their starts, whenever it is asked; what is sent once goes on
  assert.equal(off.routes!.r1.ants!.offset, 0); assert.deepEqual(off.tokens, [{ route: 'r1', at: 0 }, x.tokens![1]]); assert.deepEqual([off.pulses!.length, off.pulses![0].opacity], [1, 1]);
  const later = tl.at(700, { ambient: 'off' }); assert.deepEqual([later.routes!.r1.ants, later.tokens![0], later.pulses], [off.routes!.r1.ants, off.tokens![0], off.pulses]); assert.notDeepEqual(later.tokens![1], off.tokens![1]);
  // stopped at 1300: where they were then, at every moment after it, and at a beat that only starts later too
  const held = (t: number) => { const s = tl.at(t, { ambient: 1300 }); return [s.routes!.r1.ants, s.tokens![0], s.pulses]; }; assert.deepEqual(held(1300), (s => [s.routes!.r1.ants, s.tokens![0], s.pulses])(tl.at(1300))); for (const t of [1301, 2500, 3999]) assert.deepEqual(held(t), held(1300), String(t));
  const two = bind({ series: [{ sequence: { duration: 2000 } }, { sequence: { duration: 2000, children: [{ travel: ['r1'], loop: true }] } }] }); const b = (t: number) => two.at(t, { ambient: 900 }).tokens; assert.ok(b(2100)); assert.deepEqual(b(2100), b(3900));
  const doc = bind({ ambient: 'off', series: [{ sequence: { duration: 1000, ants: true } }] });
  assert.equal(doc.at(500).routes!.r1.ants!.offset, 0); assert.deepEqual(doc.at(900), doc.at(500)); assert.notEqual(doc.at(500, { ambient: 500 }).routes!.r1.ants!.offset, 0, 'a host may ask for it');
});

test('series, offsets, loops, rates, trims and transitions: where each thing is, and how long it all lasts', () => {
  const seq = (o: object) => ({ sequence: { duration: 1000, ...o } });
  assert.equal(bind({ series: [seq({}), seq({ offset: 500 }), seq({ offset: '-250ms' })] }).duration, 1000 + 500 + 1000 - 250 + 1000);
  assert.equal(bind({ fps: 30, series: [seq({ duration: '45f' }), seq({ duration: '1.5s' })] }).duration, 3000);
  const t = bind({ series: [seq({ name: 'x', show: ['a'] }), { transition: { presentation: 'fade', timing: { linear: 400 } } }, seq({ name: 'y', show: ['b'], hide: ['a'] })] });
  assert.equal(t.duration, 1600, 'a transition shortens it'); assert.equal(t.startOf('y'), 600);
  assert.equal(opacity(t, 'b', 800), 0.5); assert.equal(opacity(t, 'a', 800), 0.5); assert.equal(opacity(t, 'b', 1000), 1);
  // a nested sequence's clock: from, rate, trim, loop
  const at = (o: object, when: number) => bind({ series: [{ sequence: { duration: 6000, children: [{ sequence: { from: 1000, duration: 2000, children: [{ move: 'a', x: { times: [0, 2000], values: [0, 200], extrapolateRight: 'clamp' } }], ...o } }] } }] }).at(when).items?.a?.dx ?? 0;
  assert.equal(at({}, 500), 0); assert.equal(at({}, 2000), 100); assert.equal(at({}, 3500), 0, 'what is outside its span isn\'t drawn');
  assert.equal(at({ playbackRate: 2 }, 1500), 100); assert.equal(at({ trimBefore: 1000 }, 1500), 150);
  assert.equal(at({ loop: 2 }, 4000), 100); assert.equal(at({ loop: true, duration: 1000 }, 4250), 25);
  const marks = bind({ markers: { m: 'y+250', n: 40, k: 'y-100' }, series: [seq({ name: 'x' }), seq({ name: 'y' })] }).markers;
  assert.deepEqual(marks, { m: 1250, n: 40, k: 900 });
  // reading time is the length of the words
  assert.equal(bind({ series: [{ sequence: { say: { text: 'x'.repeat(100) }, duration: { read: true } } }] }).duration, 6600);
});

test('what children do: assemble and leave, draw, type, lift and back, camera, focus', () => {
  const asm = bind({ series: [{ sequence: { children: [{ assemble: { style: 'drop' } }] } }] }), plan = assemble(SMALL, { style: 'drop', seed: 1 });
  assert.equal(asm.duration, plan.duration);
  for (const f of [0, 0.3, 0.7]) assert.equal(svgAt(SMALL, asm.at(f * plan.duration)), plan.frame(f * plan.duration), `the plan's own frame at ${f}`);
  assert.deepEqual(asm.at(asm.duration), {}); assert.equal(svgAt(SMALL, asm.at(asm.duration)), SMALL.rendered.svg, 'it ends on the still, byte for byte');
  // an explosion: 40 more than the one below, 750 ms each, 50 apart; back in 500, 40 apart from the top
  const lift = bind({ layers: [{ lift: ['a', 'b', 'c'], by: 40, stagger: 50, easing: { bezier: [0.2, 0.8, 0.2, 1] } }, { lift: ['a', 'b', 'c'], by: 40, stagger: 40, from: 2000, duration: 500, to: 'down', easing: { bezier: [0.55, 0, 0.8, 0.3] } }] });
  const dy = (id: string, t: number) => lift.at(t).items?.[id]?.dy ?? 0, up = easeOf({ bezier: [0.2, 0.8, 0.2, 1] }, 750), down = easeOf({ bezier: [0.55, 0, 0.8, 0.3] }, 500);
  assert.deepEqual(['a', 'b', 'c'].map(id => dy(id, 900)), [-40, -80, -120]);
  assert.equal(dy('b', 350), Math.round(-80 * up(300 / 750) * 100) / 100); assert.equal(dy('a', 2080 + 250), Math.round((-40 + 40 * down(0.5)) * 100) / 100);
  assert.deepEqual(lift.at(2000 + 80 + 500), {}); assert.deepEqual(lift.at(900).labels?.c, { dy: -120 });
  // a connector and its label come together, drawn; typed
  const d = bind({ layers: [{ draw: ['r1', 'r2'], stagger: 200, easing: 'linear' }, { type: ['a'], from: 1000, duration: 1000 }] });
  assert.equal(d.duration, 2000); assert.equal(bind({ layers: [{ draw: ['r1', 'r2', 'r3'], stagger: 200, duration: 600 }] }).duration, 1000); assert.equal(lift.duration, 2580);
  assert.deepEqual(d.at(200).routes, { r1: { drawn: 0.5 }, r2: { opacity: 0, drawn: 0 } }); assert.deepEqual(d.at(400).labels?.r2, { opacity: 0.5 });
  assert.deepEqual(d.at(1250).labels, { a: { typed: 0.25 } });
  // the camera: there and held, even in log-zoom, back to fit
  const vb = SMALL.rendered.viewBox, cam = bind({ series: [{ sequence: { duration: 3000, children: [{ camera: { focus: 'b', zoom: 4 }, from: 500, duration: 1000, easing: 'linear' }] } }, { sequence: { duration: 2000, children: [{ camera: 'fit', duration: 1000 }] } }] });
  assert.equal(cam.at(400).camera, undefined); assert.equal(cam.at(1000).camera![2], Math.round(vb[2] / 2 * 100) / 100, 'half way in time is half way in log-zoom (4 → 2)');
  assert.equal(cam.at(2000).camera![2], vb[2] / 4); assert.deepEqual(cam.at(2999).camera, cam.at(1500).camera); assert.equal(cam.at(4000).camera, undefined);
  const aspect = cam.at(1200).camera!; assert.ok(Math.abs(aspect[2] / aspect[3] - vb[2] / vb[3]) < 0.01);
  // focus as a beat's own, and as a child with a fade each way
  const f = bind({ series: [{ sequence: { duration: 1000, focus: { lit: ['a', 'r1'], level: 0.3 } } }, { sequence: { duration: 2000, focus: { lit: ['r2'], scope: 'links' }, children: [{ focus: { lit: ['b'] }, from: 500, duration: 1000 }] } }] });
  assert.deepEqual([opacity(f, 'a', 500), opacity(f, 'b', 500), opacity(f, 'r1', 500), opacity(f, 'r2', 500)], [1, 0.3, 1, 0.3]);
  assert.deepEqual([opacity(f, 'a', 1200), opacity(f, 'r1', 1200), opacity(f, 'r2', 1200)], [1, 0.12, 1]);
  assert.equal(opacity(f, 'a', 1500 + 125), 0.56); assert.equal(opacity(f, 'a', 2000), 0.12); assert.equal(opacity(f, 'a', 2500 - 125), 0.56);
});

test('an explosion whole, and phases: the slabs appear as they rise, the rest fades to .1 in .45 s and comes back; levels as a phase has them', () => {
  // the page: the layers' opacity is 0 until each rises (.25 s, 50 ms apart); everything else goes to .1 over .45 s (CSS ease), but one to .6
  const up = { times: [0, 250], values: [0, 1], extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }, away = { times: [380, 560], values: [1, 0], extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
  const tl = bind({ series: [
    { sequence: { name: 'here', duration: 1000 } },
    { sequence: { name: 'out', duration: 3000, enter: { fade: 450 }, levels: { '*': 0.1, a: 0.6 }, children: [{ lift: ['b', 'c'], by: 40, stagger: 50, duration: 750, opacity: up, easing: { bezier: [0.2, 0.8, 0.2, 1] } }] } },
    { sequence: { name: 'back', duration: 1200, enter: { fade: 450 } } },
  ] });
  const ease = easeOf('ease', 450), near = (x: number, y: number) => assert.ok(Math.abs(x - y) < 2e-4, `${x} ~ ${y}`);
  near(opacity(tl, 'r1', 1225), 1 + (0.1 - 1) * ease(0.5)); near(opacity(tl, 'a', 2500), 0.6); near(opacity(tl, 'r2', 2500), 0.1); near(opacity(tl, 'r2', 4225), 0.1 + 0.9 * ease(0.5)); assert.deepEqual(tl.at(4900), {});
  // each slab's own opacity: the first at once, the second 50 ms after
  const alone = bind({ layers: [{ lift: ['b', 'c'], by: 40, stagger: 50, duration: 750, opacity: up }, { lift: ['b', 'c'], by: 40, stagger: 40, from: 2000, duration: 500, to: 'down', opacity: away }] });
  assert.equal(opacity(alone, 'b', 0), 0); near(opacity(alone, 'b', 125), 0.5); near(opacity(alone, 'c', 125), 0.3); assert.equal(opacity(alone, 'b', 1000), 1);
  assert.equal(alone.at(125).labels!.c.opacity, 0.3, 'its label with it');
  near(opacity(alone, 'c', 2000 + 470), 0.5); near(opacity(alone, 'b', 2040 + 470), 0.5); assert.equal(opacity(alone, 'c', 2600), 0);
  // a child's focus with the page's .45 s, each way
  const f = bind({ layers: [{ focus: { lit: ['b'], level: 0.1 }, fade: 450, duration: 2000, easing: 'ease' }] });
  near(opacity(f, 'a', 225), 1 + (0.1 - 1) * ease(0.5)); near(opacity(f, 'a', 2000 - 225), 1 + (0.1 - 1) * ease(0.5));
  // phases: each a beat's levels, reached from the one before
  const ph = bind({ series: [{ sequence: { duration: 1000, ants: true } }, { sequence: { duration: 1000, enter: { fade: 500, easing: 'linear' }, levels: { b: 0.22, r1: 0.25 } } }, { sequence: { duration: 1000, enter: { fade: 500, easing: 'linear' }, levels: { b: 0.06, r1: 0.15 } } }] });
  near(opacity(ph, 'b', 1250), 0.61); near(opacity(ph, 'b', 1900), 0.22); near(opacity(ph, 'b', 2250), 0.14); near(opacity(ph, 'r1', 2900), 0.15); near(opacity(ph, 'a', 2900), 1);
  assert.ok(ph.at(500).routes!.r1.ants); assert.equal(ph.at(1500).routes!.r1.ants, undefined, 'the ants are a beat\'s own');
  assert.match(wrong({ series: [{ sequence: { duration: 9, levels: { zz: 0.5 } } }] })[0], /levels\/zz: no thing, connector or note "zz"/); assert.match(checkMotion({ isomotion: 1, series: [{ sequence: { duration: 9, levels: { a: 2 } } }] })[0].message, /from 0 to 1/);
});

test('interpolate and spring as data: piecewise, eased, each end as asked; a spring\'s closed form', () => {
  const c = { times: [0, 100, 200], values: [0, 10, 0] };
  assert.deepEqual([-50, 0, 50, 100, 150, 250].map(t => curveAt(c, t)), [-5, 0, 5, 10, 5, -5], 'extend, the default');
  assert.deepEqual([-50, 250].map(t => curveAt({ ...c, values: [1, 10, 2], extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }, t)), [1, 2]);
  assert.deepEqual([-50, 250].map(t => curveAt({ ...c, extrapolateLeft: 'identity', extrapolateRight: 'identity' }, t)), [-50, 250]);
  assert.deepEqual([250, 350, -50].map(t => curveAt({ ...c, extrapolateLeft: 'wrap', extrapolateRight: 'wrap' }, t)), [5, 5, 5]);
  assert.equal(curveAt({ times: [0, '1s'], values: [0, 1] }, 250), 0.25); assert.equal(curveAt({ times: [0, '30f'], values: [0, 1] }, 500, 30), 0.5);
  // against the equation of motion: m x'' = -k (x - 1) - d x', integrated finely
  for (const cfg of [{}, { damping: 200 }, { mass: 2, stiffness: 180, damping: 12 }, { damping: 20 }]) {
    const { mass: m = 1, damping: d = 10, stiffness: k = 100 } = cfg as { mass?: number; damping?: number; stiffness?: number };
    if (d > 2 * Math.sqrt(k * m)) continue;       // (past critical it is the critical one, as the documentation has it)
    let x = 0, v = 0; const h = 1e-5, seen: number[] = [];
    for (let i = 1; i <= 200000; i++) { const acc = (-k * (x - 1) - d * v) / m; v += acc * h; x += v * h; if (i % 25000 === 0) seen.push(x); }
    seen.forEach((want, i) => assert.ok(Math.abs(springAt((i + 1) * 250, cfg) - want) < 2e-3, `${JSON.stringify(cfg)} at ${(i + 1) * 250}`));
  }
  assert.ok(springAt(400) > 1 && springAt(400, { overshootClamping: true }) === 1); assert.equal(springAt(0), 0); assert.ok(Math.abs(springAt(5000) - 1) < 1e-6);
  assert.deepEqual([msOf('1.2s'), msOf('450ms'), msOf(7), msOf('30f', 60), msOf('30f'), msOf('x'), msOf(Infinity)], [1200, 450, 7, 500, undefined, undefined, undefined]);
});

const GOOD: object[] = [DOC, { isomotion: 1, series: [{ sequence: { duration: '2s', children: [{ travel: ['r1', ['r1', 'r2:token']], loop: true }, { camera: 'fit' }, { camera: { focus: ['a', 'b'], margin: 3 } }, { move: 'a', x: { times: [0, '1s'], values: [0, 4], easing: { spring: { damping: 200 } } } }, { ants: true, dash: [4, 4] }, { lift: ['a'], by: 40, to: 'down' }] } }, { transition: { presentation: 'fade', timing: { spring: { damping: 200 } } } }, { sequence: { duration: 3000, ants: ['r1'], enter: { fade: 200, easing: 'settle' } } }], markers: { a: 100 } }];
const BAD: [object, RegExp][] = [
  [{ isomotion: 2 }, /^\/isomotion/], [{ isomotion: 1, serie: [] }, /unknown key "serie".*did you mean "series"/], [{ isomotion: 1, ambient: 'no' }, /^\/ambient/],
  [{ isomotion: 1, series: [{ sequence: { duration: -5 } }] }, /can't be negative/], [{ isomotion: 1, series: [{ sequence: { duration: 'soon' } }] }, /isn't a time/], [{ isomotion: 1, series: [{ sequence: { duration: '30f' } }] }, /needs its fps/],
  [{ isomotion: 1, series: [{ sequence: { duration: 1, from: 3 } }] }, /in a series a sequence follows/], [{ isomotion: 1, series: [{ transition: { presentation: 'fade', timing: { linear: 1 } } }] }, /between two sequences/],
  [{ isomotion: 1, series: [{ sequence: { duration: 9, children: [{ trvel: ['r1'] }] } }] }, /did you mean "travel"/], [{ isomotion: 1, layers: [{ morph: '2d' }] }, /morph: the 2D morph is a later version's/], [{ isomotion: 1, layers: [{ diff: {} }] }, /diffs are a later/],
  [{ isomotion: 1, layers: [{ move: 'a', x: { times: [0, 5, 5], values: [1, 2, 3] } }] }, /times go up/], [{ isomotion: 1, layers: [{ move: 'a', x: { times: [0, 5], values: [1] } }] }, /1 values for 2 times/],
  [{ isomotion: 1, layers: [{ assemble: { style: 'dropp' } }] }, /did you mean "drop"/], [{ isomotion: 1, layers: [{ camera: { focus: 3 } }] }, /an id, some ids, or a box/], [{ isomotion: 1, layers: [{ lift: ['a'] }] }, /how far apart/],
  [{ isomotion: 1, series: [{ sequence: { duration: 1, say: { facts: [['x']] } } }] }, /name, value/], [{ isomotion: 1, series: [{ sequence: { name: 'x', duration: 1 } }, { sequence: { name: 'x', duration: 1 } }] }, /already a name/],
  [{ isomotion: 1, series: [{ sequence: { name: 'x', duration: 1 } }], markers: { m: 'xx+5' } }, /no sequence is named/], [{ isomotion: 1, layers: [{ draw: ['a'], easing: { bezier: [1, 2] } }] }, /four numbers/], [{ isomotion: 1, layers: [{ draw: ['a'], easing: { spring: { mass: 0 } } }] }, /over 0/],
];
test('the schema and the checks agree; what is wrong is said where it is', () => {
  const valid = new Ajv2020(AJV_OPTIONS).compile(MOTION_SCHEMA as object);
  for (const g of GOOD) { assert.deepEqual(checkMotion(g), []); assert.equal(valid(JSON.parse(JSON.stringify(g))), true, JSON.stringify(valid.errors?.slice(0, 3))); }
  // what only the checks can say (names, order, frames, what a schema has no words for)
  const beyond = /negative|needs its fps|between two|times go up|values for|already a name|no sequence is named/;
  for (const [b, re] of BAD) {
    const said = checkMotion(b).map(d => `${d.path}: ${d.message}${d.hint ? ` (${d.hint})` : ''}`);
    assert.ok(said.some(x => re.test(x)), `${JSON.stringify(b)}: ${said.join(' | ')}`);
    if (!beyond.test(said.join())) { if (!/follows the one before/.test(said.join())) assert.equal(valid(JSON.parse(JSON.stringify(b))), false, `the schema takes ${JSON.stringify(b)}`); }
  }
  for (const junk of [null, 3, 'x', [], { isomotion: 1, series: 3 }, { isomotion: 1, layers: [3] }, { isomotion: 1, series: [{ sequence: 3 }] }]) assert.ok(checkMotion(junk).length, JSON.stringify(junk));
  // ids, against the drawing
  assert.deepEqual(wrong({ series: [{ sequence: { duration: 9, show: ['a', 'bb'] } }] }), ['/series/0/sequence/show/1: no thing, connector or note "bb" in this drawing (did you mean "b"?)']);
  assert.match(wrong({ layers: [{ draw: ['a'] }] })[0], /^\/layers\/0\/draw\/0: no connector "a"/); assert.match(wrong({ layers: [{ lift: ['r1'], by: 4 }] })[0], /no thing "r1"/);
  assert.match(wrong({ series: [{ sequence: { duration: 100, children: [{ sequence: { duration: 10, show: ['a'] } }] } }] })[0], /show is for a sequence of the document's own series/);
  assert.match(wrong({ series: [{ sequence: { duration: 100, loop: true, children: [{ camera: 'fit' }] } }] })[0], /camera can't be in a loop/);
  for (const [k, v] of Object.entries({ ants: ['r9'], hide: ['zz'], highlight: ['r1'], focus: { lit: ['zz'] } })) assert.match(wrong({ series: [{ sequence: { duration: 9, [k]: v } }] })[0] ?? '', new RegExp(`^/series/0/sequence/${k}`), k);
  assert.match(wrong({ series: [{ sequence: {} }] })[0], /how long is it/); assert.match(wrong({})[0], /a series, or layers, that last/);
  assert.match(wrong({ series: [{ sequence: { duration: 100 } }, { transition: { presentation: 'fade', timing: { linear: 400 } } }, { sequence: { duration: 1000 } }] })[0], /no longer than either side/);
  const t = bindMotion(SMALL, { isomotion: 1, layers: [{ draw: ['zz'] }] }); assert.equal(t.ok, false); assert.deepEqual(t.at(5), {}); assert.equal(t.duration, 0);
});

test('every drawing\'s own steps are a document: the same things there at each step, the same length, the same words', () => {
  let n = 0;
  const files = ['examples/demo.yaml', ...['examples/scenarios', 'corpus'].flatMap(d => { try { return readdirSync(new URL('../' + d, import.meta.url)).filter(f => f.endsWith('.yaml')).map(f => `${d}/${f}`); } catch { return []; } })];
  for (const f of files) for (const s of compiled(read(f)).scenes) {
    if (!s.steps.steps.length) continue;
    const doc = motionOfSteps(s), tl = bindMotion(s, doc);
    assert.deepEqual(tl.diags, [], `${f} ${s.id}`); assert.equal(tl.duration, s.steps.steps.reduce((a, x) => a + x.duration, 0));
    s.steps.steps.forEach((st, i) => {
      const t = tl.startOf(`step-${st.n}`)! + st.duration * 0.6, cue = tl.cues(t)!;
      // there or not, and dimmed or not, as the page's stylesheet has it: a connector no step lights at .12; with `dim: all`, a thing too, at .14
      for (const id of [...s.layout.byId.keys(), ...Object.keys(s.rendered.paths)]) {
        const there = s.steps.vis[id]?.[i] ?? true, lit = st.lit.includes(id), all = s.raw.dim === 'all', want = !there ? 0 : lit ? 1 : all ? 0.14 : s.rendered.paths[id] ? 0.12 : 1;
        assert.equal(opacity(tl, id, t), want, `${f} ${s.id} step ${i + 1}: ${id}`);
      }
      assert.equal(cue.say!.title, st.heading); assert.equal(cue.index, i);
    });
    n++;
  }
  assert.ok(n >= 10, `${n} drawings with steps`);
});

const FILE = `isodiag: 1
title: small
scenes:
  - id: s
    title: small
    motion:
      series:
        - sequence: { name: one, duration: 1000, show: [a, b, r1] }
        - sequence:
            name: two
            duration: 2000
            show: [c]
            ants: [r1]
            children:
              - { travel: [r1, "r2:token"], each: 500 }
    nodes:
      - { id: a, asset: block }
      - { id: b, asset: block, right-of: a, gap: 3 }
      - { id: c, asset: block, right-of: b, gap: 3 }
    routes:
      - { id: r1, from: a, to: b, kind: send }
      - { id: r2, from: b, to: c, kind: reply }
      - { id: r3, from: c, to: a, kind: blocked }
`;
test('motion: in a file: the scene has it; its faults are the file\'s, where they are; a file without one is as it was', () => {
  const c = compiled(FILE); assert.equal(c.scenes[0].motion!.isomotion, 1);
  assert.equal(bindMotion(c.scenes[0], c.scenes[0].motion!, { kinds: KINDS }).duration, 3000);
  const bad = compile(FILE.replace('show: [c]', 'show: [cc]').replace('each: 500', 'eech: 500'), THEME);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.diags.map(d => [d.severity, d.line, d.path]), [['error', 15, '/scenes/0/motion/series/1/sequence/children/0/eech']], 'its shape first');
  const ids = compile(FILE.replace('show: [c]', 'show: [cc]'), THEME);
  assert.deepEqual(ids.diags.map(d => [d.line, d.col, d.message]), [[12, 20, 'no thing, connector or note "cc" in this drawing']]); assert.equal(ids.scenes[0].motion, undefined);
  assert.match(compile(FILE.replace('show: [c]', 'show: [bb]'), THEME).diags[0].hint ?? '', /did you mean "b"/);
  const plain = FILE.replace(/    motion:[\s\S]*?(?=    nodes:)/, '');
  assert.equal(compiled(plain).scenes[0].rendered.svg, c.scenes[0].rendered.svg, 'the still is the same drawing'); assert.equal(compiled(plain).scenes[0].motion, undefined);
});

test('renderSvg: one call, one SVG that needs nothing else: the still, a moment, the ants; faults thrown with their lines', () => {
  const still = renderSvg(FILE, { theme: THEME }), at = renderSvg(FILE, { theme: THEME, t: 1750, mode: 'dark' });
  for (const s of [still, at, renderSvg(FILE, { theme: THEME, ants: true })]) { assert.match(s, /^<svg /); assert.doesNotMatch(s, /var\(|hsl\(|color-mix|<style|<script|NaN|undefined/); }
  assert.equal(renderSvg(FILE, { theme: THEME, t: 1750, mode: 'dark' }), at, 'again, the same bytes'); assert.notEqual(at, still);
  assert.equal(renderSvg(FILE, { theme: THEME, t: 1e9 }).length > 0, true); assert.match(renderSvg(FILE, { theme: THEME, t: 100 }), /data-item="c"[^>]* opacity="0"/);
  // the second token is of its own kind's colour (the theme's, in the mode asked)
  const token = /<circle[^>]*class="tok"[^>]*fill="([^"]*)"/; assert.equal(token.exec(at)![1], compiled(FILE).theme!.dark.token); assert.equal(token.exec(renderSvg(FILE, { theme: THEME, t: 1250 }))![1], compiled(FILE).theme!.light.control);
  assert.match(renderSvg(FILE, { theme: THEME, t: 1750, ambient: 'off' }), /stroke-dasharray:9 7;stroke-dashoffset:0\b/); { const st = renderSvg(FILE, { theme: THEME, ants: true, ambient: 'off' }); assert.match(st, /stroke-dasharray:9 7/); assert.doesNotMatch(st, /<animate/); } assert.match(at, /stroke-dasharray:9 7;stroke-dashoffset:/); assert.doesNotMatch(at, /<animate/);
  // another motion for the file's; a scene by id or place
  const doc = { isomotion: 1, layers: [{ lift: ['a'], by: 40 }] } as MotionDoc;
  assert.match(renderSvg(FILE, { theme: THEME, t: 750, motion: doc }), /data-item="a" data-part="block" transform="translate\(0 -40\)"/);
  assert.equal(renderSvg(FILE, { theme: THEME, scene: 's' }), still); assert.equal(renderSvg(FILE, { theme: THEME, scene: 0 }), still);
  assert.throws(() => renderSvg(FILE, { theme: THEME, scene: 'x' }), /no scene "x".*is s/); assert.throws(() => renderSvg(FILE.replace('show: [c]', 'show: [cc]'), { theme: THEME }), /line 12: no thing/);
  assert.throws(() => renderSvg(FILE, { theme: THEME, t: 5, ants: true }), /motion document's/); assert.throws(() => renderSvg(FILE.replace(/    motion:[\s\S]*?(?=    nodes:)/, ''), { theme: THEME, t: 5 }), /no motion/);
  assert.throws(() => renderSvg(FILE, { theme: THEME, t: 5, motion: { isomotion: 1, layers: [{ draw: ['zz'] }] } }), /\/layers\/0\/draw\/0: no connector "zz"/);
});

test('ants on a still: its connectors, with their own dashes; blocked and planned stand; nothing else changes', () => {
  const s = BUILD.scenes[0], smil = withAnts(s, { kinds: KINDS }), css = withAnts(s, { by: 'css', kinds: KINDS }), n = s.routes.filter(r => r.kind !== 'planned').length;
  assert.equal([...smil.matchAll(/<animate attributeName="stroke-dashoffset"/g)].length, n); assert.equal([...css.matchAll(/class="flow iso-ants/g)].length, n);
  assert.match(smil, /data-id="net2"[^>]*><path [^>]*style="stroke-dasharray:7 6"><animate attributeName="stroke-dashoffset" from="0" to="-13" dur="0.447s" repeatCount="indefinite"\/><\/path>/);
  assert.match(smil, /data-id="net"[^>]*><path [^>]*style="stroke-dasharray:9 7"><animate [^>]*to="-16" dur="0.55s"/, 'two periods in 1.1 s');
  assert.doesNotMatch(smil, /data-id="clone"[^>]*><path [^>]*style=/);
  // taken away again, the still; some only; backwards; a dash of one's own
  assert.equal(smil.replace(/ style="stroke-dasharray:[^"]*"><animate [^>]*\/><\/path>/g, '/>'), s.rendered.svg);
  assert.equal(css.replace(/flow iso-ants/g, 'flow').replace(/ style="--ant-on[^"]*"\/>/g, '/>'), s.rendered.svg);
  assert.equal([...withAnts(s, { ids: ['net', 'sess'] }).matchAll(/<animate/g)].length, 2); assert.match(withAnts(s, { ids: ['net'], speed: -16, dash: [4, 4] }), /to="8" dur="0.5s"/);
});

test('a note goes with the thing it is on: shown, dimmed, levelled and lifted with it, and by its own name on top', () => {
  const scene = compiled(`isodiag: 1
title: n
scenes:
  - id: n
    title: n
    nodes: [ { id: a, asset: block }, { id: b, asset: block, right-of: a, gap: 3 } ]
    notes: [ { face: "on a", on: a } ]
`).scenes[0], note = 'n-note-0', of = (doc: object, t: number) => bind(doc, scene).at(t).labels?.[note];
  assert.deepEqual(of({ series: [{ sequence: { duration: 9, show: ['b'] } }, { sequence: { duration: 9, show: ['a'] } }] }, 5), { opacity: 0 });
  assert.equal(of({ series: [{ sequence: { duration: 9, levels: { '*': 0.1, a: 1 } } }] }, 5), undefined, 'not "*"\'s: its thing\'s'); assert.deepEqual(of({ series: [{ sequence: { duration: 9, levels: { a: 0.5 } } }] }, 5), { opacity: 0.5 });
  assert.deepEqual(of({ series: [{ sequence: { duration: 9, levels: { a: 0.5, [note]: 0.5 } } }] }, 5), { opacity: 0.25 }); assert.deepEqual(of({ series: [{ sequence: { duration: 9, focus: { lit: ['b'], level: 0.3 } } }] }, 5), { opacity: 0.3 });
  assert.equal(of({ series: [{ sequence: { duration: 9, focus: { lit: ['a'], level: 0.3 } } }] }, 5), undefined); assert.equal(of({ layers: [{ focus: { lit: ['a'] }, duration: 2000 }] }, 1000), undefined); assert.deepEqual(of({ layers: [{ focus: { lit: ['b'] }, duration: 2000 }] }, 1000), { opacity: 0.12 });
  assert.deepEqual(of({ layers: [{ lift: ['a'], by: 40 }] }, 750), { dy: -40 }); assert.deepEqual(of({ series: [{ sequence: { duration: 9, hide: [note] } }] }, 5), { opacity: 0 });
});

test('the builder writes the document and nothing else: the stepped build, and one of each thing', () => {
  // page 5's document, in code, is the file's
  const m = motion();
  for (const { sequence: q } of DOC.series as { sequence: Record<string, any> }[]) m.beat(q.name, q.say, { duration: 3200, ...(q.show ? { show: q.show } : {}), ...(q.hide ? { hide: q.hide } : {}), ...(q.highlight ? { highlight: q.highlight } : {}), enter: { fade: 450 }, ...(q.ants ? { ants: true } : {}) });
  assert.deepEqual(m.toJSON(), DOC); assert.deepEqual(JSON.parse(JSON.stringify(m)), DOC, 'JSON.stringify is the document');
  // one of each: every node kind the document has, and nothing undefined in it
  const all = motion({ fps: 30, seed: 4, ambient: 'on' })
    .assemble({ style: 'drop', order: 'by-flow' }, { over: 1200 })
    .sequence('ask', { read: { min: 1000 }, say: { title: 'It asks', text: 'A sentence.' }, show: ['b'] }, b => b
      .travel(['r1', ['r1', 'r2:token']], { loop: true, hold: '7f' }).pulse('a', { loop: true }).ants().ants('r1', { dash: [4, 4], speed: 20, from: 100 })
      .draw(['r1'], { over: 600, easing: 'settle', by: 'grow', stagger: 40 }).type('a').move('a', { x: { times: [0, '1s'], values: [0, 9], easing: { spring: { damping: 200 } } } })
      .lift(['a', 'b'], 40, { stagger: 50, to: 'down' }).focus('a', { level: 0.2, always: ['c'], fade: 100 }).highlight(['a', 'b'], { over: 900 })
      .camera.focus('b', { zoom: 1.6, over: 900 }).camera.focus([0, 0, 10, 10]).camera.fit({ from: 2000 })
      .sequence('in', { from: 200, duration: 400, loop: 2 }, c => c.pulse(['c'])).series(s => s.sequence(undefined, { duration: 100 }).sequence(undefined, { duration: 100 })).layers(c => c.type(['b'])).disassemble({ style: 'fade' }, { from: 3000 }))
    .transition({ presentation: 'fade', timing: { linear: 400 } })
    .sequence('end', { duration: 4000, levels: { a: 0.5 } }).mark('reveal', 'ask+1200').layers(b => b.highlight('c', { from: 100, over: 300 }));
  const doc = all.toJSON(), said = JSON.stringify(doc);
  assert.deepEqual(checkMotion(doc), []); assert.equal(new Ajv2020(AJV_OPTIONS).compile(MOTION_SCHEMA as object)(doc), true); assert.deepEqual(bindMotion(SMALL, doc).diags, []);
  assert.deepEqual(JSON.parse(said), doc, 'nothing in it JSON hasn\'t');
  const kinds = Object.keys((MOTION_SCHEMA.$defs.nodes.items.anyOf as readonly { properties?: object }[]).reduce((o, n) => ({ ...o, [Object.keys(n.properties ?? { sequence: 1 })[0]]: 1 }), {}));
  for (const k of kinds) assert.ok(said.includes(`"${k}":`), `a ${k}`); assert.ok(kinds.length >= 14, kinds.join());
  assert.deepEqual(doc.layers, [{ highlight: ['c'], from: 100, duration: 300 }]); assert.deepEqual(doc.markers, { reveal: 'ask+1200' });
  // it keeps nothing of the caller's, and gives nothing of its own away
  const ids = ['a']; const routes: (string | string[])[] = [['r1']]; const b2 = motion().sequence('x', { duration: 9, show: ids }), b3 = motion().layers(b => { b.travel(routes); (routes[0] as string[]).push('r2'); }); ids.push('b'); assert.deepEqual(b3.toJSON().layers, [{ travel: [['r1']] }]); const one = b2.toJSON(); (one.series![0] as { sequence: { show: string[] } }).sequence.show.push('c');
  assert.deepEqual((b2.toJSON().series![0] as { sequence: { show: string[] } }).sequence.show, ['a']);
});

const LOOKS = read('test/fixtures/motion/looks.yaml');
test('looks (a thing\'s variants): what it declares, switched to by a beat and crossfaded; the still is as if it declared none; each fault said', () => {
  const s = compiled(LOOKS).scenes[0];
  assert.equal(s.rendered.svg, compiled(LOOKS.replace(/,? ?variants: \{ (asleep|off).*?\} \} ?\}/g, ' }').replace(/        variants:.*\n/, '')).scenes[0].rendered.svg, 'the still');
  assert.deepEqual(s.rendered.looks, { vm: ['asleep', 'deleted'], root: ['asleep', 'off'], agent: ['asleep'] }); assert.deepEqual(Object.keys(s.rendered.variants!).sort(), ['asleep', 'deleted', 'off']);
  // the phases of a hand-made page: grey inside, a dashed outline, levels; each reached over half a second
  const tl = bind({ series: [
    { sequence: { name: 'running', duration: 1000, ants: true } },
    { sequence: { name: 'asleep', duration: 1000, enter: { fade: 500, easing: 'linear' }, variants: { vm: 'asleep', root: 'asleep', agent: 'asleep' }, levels: { r1: 0.25 } } },
    { sequence: { name: 'deleted', duration: 1000, enter: { fade: 500, easing: 'linear' }, variants: { vm: 'deleted', root: 'off' }, levels: { agent: 0.06 } } },
    { sequence: { name: 'back', duration: 1000, enter: { fade: 500, easing: 'linear' }, variants: { vm: '', root: '', agent: '' } } },
  ] }, s);
  assert.equal(tl.at(500).variants, undefined); assert.deepEqual(tl.at(1250).variants, { vm: { asleep: 0.5 }, root: { asleep: 0.5 }, agent: { asleep: 0.5 } });
  assert.deepEqual(tl.at(1800).variants, { vm: { asleep: 1 }, root: { asleep: 1 }, agent: { asleep: 1 } });
  assert.deepEqual(tl.at(2250).variants, { vm: { asleep: 0.5, deleted: 0.5 }, root: { asleep: 0.5, off: 0.5 }, agent: { asleep: 1 } }, 'what isn\'t named keeps the look it has');
  assert.deepEqual(tl.at(3250).variants, { vm: { deleted: 0.5 }, root: { off: 0.5 }, agent: { asleep: 0.5 } }); assert.deepEqual(tl.at(3900), {}); assert.equal(svgAt(s, tl.at(3900)), s.rendered.svg, 'back on the still, byte for byte');
  // what is drawn: the thing's own going, the look coming, inside its own wrapper; whole, only the look; nothing else touched
  const part = (svg: string, id: string, p: string) => { const at = svg.indexOf(`<g data-item="${id}" data-part="${p}"`); let d = 0; for (const m of svg.slice(at).matchAll(/<(\/?)g\b[^>]*?(\/?)>/g)) { d += m[1] ? -1 : m[2] ? 0 : 1; if (!d) return svg.slice(at, at + m.index + m[0].length); } return ''; };
  const half = svgAt(s, tl.at(1250)), whole = svgAt(s, tl.at(1800));
  assert.match(part(half, 'root', 'block'), /^<g data-item="root" data-part="block"><g opacity="0.5"><g class="blk k-folder[\s\S]*<g opacity="0.5"><g class="blk k-grey/); assert.match(part(whole, 'root', 'block'), /^<g data-item="root" data-part="block"><g opacity="1"><g class="blk k-grey/);
  assert.match(part(whole, 'vm', 'block'), /ghost/); assert.match(part(whole, 'agent', 'label'), /asleep/); assert.equal(part(half, 'root', 'label'), part(s.rendered.svg, 'root', 'label'), 'a part that looks the same isn\'t doubled');
  for (const id of ['host']) for (const p of ['block', 'label']) assert.equal(part(half, id, p), part(s.rendered.svg, id, p)); assert.match(svgAt(s, tl.at(2900)), />GONE</);
  // a look with a move on it goes with the thing; the same moment again is the same bytes
  const lifted = bind({ series: [{ sequence: { duration: 1000, variants: { root: 'asleep' }, children: [{ lift: ['root'], by: 40 }] } }] }, s);
  assert.match(part(svgAt(s, lifted.at(800)), 'root', 'block'), /^<g data-item="root" data-part="block" transform="translate\(0 -40\)"><g opacity="1"><g class="blk k-grey/); assert.equal(svgAt(s, tl.at(1250)), half);
  // self-contained, in either mode
  for (const mode of ['light', 'dark'] as const) { const svg = renderSvg(LOOKS, { theme: THEME, mode, t: 250, motion: { isomotion: 1, series: [{ sequence: { duration: 500, variants: { root: 'asleep', vm: 'deleted' } } }] } }); assert.doesNotMatch(svg, /var\(|hsl\(|color-mix/); assert.match(svg, />GONE</); const shapes = [...part(svg, 'root', 'block').matchAll(/<(?:polygon|path|line) [^>]*>/g)].map(m => m[0]); assert.ok(shapes.length > 3 && shapes.every(x => / fill="#| stroke="#/.test(x)), `the look has its colours on it: ${shapes[0]}`); }
  const bad = (v: object) => wrong({ series: [{ sequence: { duration: 9, variants: v } }] }, s)[0];
  assert.match(bad({ root: 'aslep' }), /root has no look "aslep" \(it has asleep, off\) \(did you mean "asleep"/); assert.match(bad({ host: 'asleep' }), /host declares no looks/); assert.match(bad({ r1: 'asleep' }), /no thing "r1"/); assert.match(checkMotion({ isomotion: 1, series: [{ sequence: { duration: 9, variants: { a: 3 } } }] })[0].message, /a look's name/);
  assert.equal(compile(LOOKS.replace('{ role: grey }', '{ size: [9, 9] }'), THEME).ok, false, 'a look can\'t change the thing\'s box');
});

test('ants in the file: the still marches by itself, a frame has their offsets, a beat says otherwise; an unknown connector is an error with its line', () => {
  const src = (ants: string, motion = '') => `isodiag: 1\ntitle: T\nscenes:\n  - id: s\n    title: S\n${ants}${motion}    nodes:\n      - { id: a, asset: server }\n      - { id: b, asset: server }\n      - { id: c, asset: server }\n    routes:\n      - { id: r1, from: a, to: b, kind: send }\n      - { id: r2, from: b, to: c, kind: send }\n`;
  const still = (t: string, o = {}) => renderSvg(t, { theme: THEME, ...o }), n = (s: string) => (s.match(/<animate /g) ?? []).length;
  assert.equal(n(still(src(''))), 0); assert.equal(n(still(src('    ants: true\n'))), 2); assert.equal(n(still(src('    ants: [r2]\n'))), 1); assert.equal(n(still(src('    ants: false\n'))), 0);
  assert.match(still(src('    ants: { ids: [r1], speed: 64, dash: [4, 4] }\n')), /stroke-dasharray:4 4"><animate [^>]*dur="0.125s"/);
  assert.equal(n(still(src('    ants: true\n'), { ants: false })), 0, 'a host may say no'); { const s = still(src('    ants: true\n'), { ambient: 'off' }); assert.equal(n(s), 0); assert.match(s, /stroke-dasharray:9 7/); }
  // a frame: the file's, unless the beat says
  const M = '    motion: { series: [{ sequence: { duration: 1000 } }, { sequence: { duration: 1000, ants: false } }, { sequence: { duration: 1000, ants: [r1] } }] }\n';
  const at = (t: number) => (still(src('    ants: [r2]\n', M), { t }).match(/stroke-dashoffset:/g) ?? []).length;
  assert.deepEqual([at(500), at(1500), at(2500)], [1, 0, 1]);
  const c = compiled(src('    ants: [r2]\n', M)), tl = bindMotion(c.scenes[0], c.scenes[0].motion!, { kinds: c.theme!.kinds }); assert.deepEqual([Object.keys(tl.at(500).routes!), Object.keys(tl.at(2500).routes!)], [['r2'], ['r1']]);
  // a fault, with its place and what there is
  for (const [bad, path] of [['    ants: [r1, r9]\n', '/scenes/0/ants/1'], ['    ants: { ids: [r9] }\n', '/scenes/0/ants/ids/0']] as const) { const d = compile(src(bad), THEME).diags.find(x => x.severity === 'error')!; assert.equal(d.path, path); assert.equal(d.line, 6); assert.match(d.message, /no connector "r9"/); assert.match(d.hint ?? '', /r1, r2/); }
  assert.ok(compile(src('    ants: 3\n'), THEME).diags.some(x => x.severity === 'error'), 'the schema refuses nonsense');
});

test('docs/MOTION.md: the element\'s own drawing compiles, binds and plays', () => {
  const md = readFileSync(new URL('../docs/MOTION.md', import.meta.url), 'utf8'), text = /<script type="text\/yaml">\n([\s\S]*?)<\/script>/.exec(md)![1].replace(/^ {4}/gm, '').trimEnd() + '\n';
  const s = compiled(text).scenes[0], tl = bindMotion(s, s.motion!);
  assert.deepEqual(tl.diags, []); assert.equal(tl.duration, 3000); assert.equal(tl.loops, true); assert.equal(tl.at(600).tokens?.length, 1);
});

test('docs/MOTION.md: the document in it compiles, binds and plays; the one made in code is checked against it', () => {
  const md = readFileSync(new URL('../docs/MOTION.md', import.meta.url), 'utf8'), yaml = /```yaml\n(# file: story\.yaml\n[\s\S]*?)```/.exec(md)![1];
  const c = compiled(yaml), s = c.scenes[0], tl = bindMotion(s, s.motion!, { kinds: c.theme!.kinds }); assert.deepEqual(tl.diags, []);
  assert.deepEqual(tl.beats.map(b => b.name), ['ask', 'data', 'rest']); assert.equal(tl.beats[0].end, 3000); assert.ok(tl.beats[1].end - tl.beats[1].start >= 5600);
  assert.equal(tl.at(1500).items!.db.opacity, 0); assert.deepEqual(tl.at(tl.duration).variants, { db: { asleep: 1 } }); assert.ok(tl.at(5000).routes!.q.ants); assert.equal(tl.at(tl.duration - 1).routes?.q?.ants, undefined);
  assert.equal(tl.cues(1500)!.say!.title, 'The question'); assert.match(renderSvg(yaml, { theme: THEME, mode: 'dark', t: 1500 }), /^<svg /); assert.match(renderSvg(yaml, { theme: THEME }), /<animate /);
  const code = /```js\nconst doc = (objects\.motion\(\)[\s\S]*?);\n```/.exec(md)![1];
  const doc = new Function('objects', `return ${code};`)({ motion }) as MotionDoc; assert.deepEqual(bindMotion(s, doc).diags, []); assert.equal(bindMotion(s, doc).markers.answer, 3800);
});

test('/motion (0.15.0): the package\'s subpath carries plans, documents, the Timeline, the builder, ants and looks, the same as objects\' own', async () => {
  const M = await import('../src/iso-objects/motion-entry.ts') as Record<string, unknown>, O = await import('../src/iso-objects/index.ts') as Record<string, unknown>;
  for (const n of ['assemble', 'disassemble', 'svgAt', 'paint', 'bindMotion', 'motionOfSteps', 'motion', 'MOTION_SCHEMA', 'checkMotion', 'springAt', 'withAnts', 'ANTS_CSS', 'drawLooks']) { assert.ok(n in M, n); assert.equal(M[n], O[n], n); }
  // everything of motion's that objects has, /motion has
  const own = ['motion', 'timeline', 'motion-doc', 'motion-schema', 'motion-builder', 'ants', 'looks'], src = readFileSync(new URL('../src/iso-objects/index.ts', import.meta.url), 'utf8');
  const names = [...src.matchAll(/^export \{ ([^}]*) \} from '\.\/([\w-]+)\.ts';/gm)].filter(m => own.includes(m[2])).flatMap(m => m[1].split(', ').map(x => x.split(' as ').at(-1)!));
  assert.ok(names.length > 30); assert.deepEqual(names.filter(n => !(n in M)), []);
});
