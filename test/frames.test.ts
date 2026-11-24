// A video's frames of a drawing (src/remotion/frames.ts), before any React: any frame, in any order, is the Timeline's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { cueAt, drawingOf, frameSvg, framesOf, isometricFonts, isometricMetadata, isometricTiming, timeOf } from '../src/remotion/frames.ts';
import { bindMotion } from '../src/iso-objects/timeline.ts';
import { compile } from '../src/iso-systems/compile.ts';
import { FONTS, textWidth, withFont } from '../src/iso-core/kernel.ts';
import { ARIMO } from '../src/iso-core/arimo.ts';
import { svgAt } from '../src/iso-objects/motion.ts';
import type { MotionDoc } from '../src/iso-objects/motion-doc.ts';

const read = (f: string) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const theme = read('themes/default.yaml'), src = read('test/fixtures/motion/stepped-build.yaml'), motion = parse(read('test/fixtures/motion/stepped-build.motion.yaml')) as MotionDoc;

test('a frame is the Timeline at its moment, in any order, whole or between; the ambient clock with the video, or off', () => {
  const d = drawingOf({ src, theme, motion });
  for (const f of [1343, 0, 700, 12.5, 1343, 3]) assert.equal(frameSvg(d, f, 30), svgAt(d.scene, d.timeline.at(f / 30 * 1000)));
  assert.equal(frameSvg(d, 1100, 30, { ambient: 'off' }), svgAt(d.scene, d.timeline.at(1100 / 30 * 1000, { ambient: 'off' })));
  assert.notEqual(frameSvg(d, 1100, 30, { ambient: 'off' }), frameSvg(d, 1100, 30));
  assert.equal(timeOf(45, 30), 1500); assert.equal(cueAt(d, 100, 30)!.beat, 's2');
  // a fresh drawing gives the same bytes
  assert.equal(frameSvg(drawingOf({ src, theme, motion }), 700, 30), frameSvg(d, 700, 30));
});

test('as long as its motion: the last frame shows its end; rates and sizes go through, and what isn\'t one is refused', () => {
  assert.deepEqual([framesOf(1000, 30), framesOf(1001, 30), framesOf(44800, 30), framesOf(100, 30), framesOf(1, 24), framesOf(1000, 29.97)], [30, 31, 1344, 3, 1, 30]);
  assert.deepEqual(isometricMetadata({ fps: 30, width: 1920, height: 1080 })({ props: { src, theme, motion } }), { fps: 30, width: 1920, height: 1080, durationInFrames: 1344 });
  for (const bad of [{ fps: 0, width: 1, height: 1 }, { fps: 30, width: NaN, height: 1 }, { fps: 30, width: 1, height: -1 }]) assert.throws(() => isometricMetadata(bad), /number over 0/);
});

test('two at once: each instance\'s ids are its own, and each one used is there', () => {
  const d = drawingOf({ src, theme, motion }), a = frameSvg(d, 900, 30, { prefix: 'one_' }), b = frameSvg(d, 900, 30, { prefix: 'two_' });
  const ids = (s: string) => [...s.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]), used = (s: string) => [...s.matchAll(/url\(#([^)]+)\)/g)].map(m => m[1]);
  assert.ok(ids(a).length); assert.equal(new Set([...ids(a), ...ids(b)]).size, ids(a).length + ids(b).length);
  for (const s of [a, b]) for (const u of used(s)) assert.ok(ids(s).includes(u), u);
  assert.equal(a.split('one_').join(''), b.split('two_').join(''));
});

test('its own motion, its steps, a scene, a mode, black and white; what can\'t be a video is said whole', () => {
  const demo = read('examples/demo.yaml');
  assert.ok(drawingOf({ src: demo, theme }).timeline.beats.length > 1, 'its steps');
  assert.notEqual(frameSvg(drawingOf({ src: demo, theme, mode: 'dark' }), 10, 30), frameSvg(drawingOf({ src: demo, theme }), 10, 30));
  assert.doesNotMatch(frameSvg(drawingOf({ src: demo, theme, treatment: 'mono' }), 10, 30), /#(?!([0-9a-f]{2})\1\1)[0-9a-f]{6}/);
  assert.throws(() => drawingOf({ src: demo, theme, scene: 'nope' }), /no scene "nope"/);
  assert.throws(() => drawingOf({ src: 'isodiag: 1\nscenes:\n  - id: s\n    title: T\n    nodes:\n      - { id: a, asset: block }\n', theme }), /no motion/);
  assert.throws(() => drawingOf({ src: src.replace('asset: block', 'asset: nope'), theme, motion }), /line \d+: .*nope/);
  assert.throws(() => drawingOf({ src, theme, motion: { isomotion: 1, series: [{ sequence: { duration: 'soon' } }] } as unknown as MotionDoc }), /\/series\/0/);
});

test('a timing is the document\'s: the same length and the same share at every moment, written in ms, seconds or frames', () => {
  const doc = (timing: unknown) => ({ isomotion: 1, fps: 30, series: [{ sequence: { name: 'a', duration: 2000, show: ['api'] } }, { transition: { presentation: 'fade', timing } }, { sequence: { name: 'b', duration: 3000, show: ['worker'] } }] }) as unknown as MotionDoc;
  const y = 'isodiag: 1\nscenes:\n  - id: s\n    title: T\n    nodes:\n      - { id: api, asset: block, label: A }\n      - { id: worker, asset: block, label: B, right-of: api }\n';
  const s = compile(y, theme).scenes[0];
  for (const timing of [{ linear: 400 }, { linear: '1.2s' }, { linear: '12f' }, { spring: { damping: 200 } }, { spring: { damping: 12, mass: 2 } }, { spring: { duration: 700 } }] as const) {
    const t = bindMotion(s, doc(timing)), g = isometricTiming(timing), overlap = 5000 - t.duration;
    assert.ok(t.ok, JSON.stringify(t.diags));
    assert.equal(g.getDurationInFrames({ fps: 30 }), framesOf(overlap, 30), JSON.stringify(timing));
    const start = t.beats[1].start;
    // what the document shows of the beat coming in is the share Remotion is told
    for (const f of [0, 1, 4, 9, 11]) {
      const ms = f / 30 * 1000; if (ms >= overlap) continue;
      const seen = t.at(start + ms).items?.worker?.opacity ?? 1;
      assert.ok(Math.abs(seen - g.getProgress({ frame: f, fps: 30 })) < 1e-4, `${JSON.stringify(timing)} frame ${f}: ${seen} ${g.getProgress({ frame: f, fps: 30 })}`);
    }
    assert.equal(g.getProgress({ frame: 0, fps: 30 }), 0); assert.equal(g.getProgress({ frame: g.getDurationInFrames({ fps: 30 }), fps: 30 }), 1);
    for (let f = 0; f < 60; f++) { const p = g.getProgress({ frame: f, fps: 30 }); assert.ok(p >= 0 && p <= 1); }
  }
  for (const bad of [undefined, {}, { linear: 0 }, { linear: -1 }, { linear: 'soon' }, { linear: 1, spring: {} }, { spring: { damping: 0 } }, { spring: { mass: NaN } }]) assert.throws(() => isometricTiming(bad as never), /isometricTiming/);
});

test('Arimo\'s widths: only when asked for, only the sans, and the drawing says so', () => {
  const plain = drawingOf({ src, theme, motion }), arimo = drawingOf({ src, theme, motion, font: 'arimo' });
  const svg = frameSvg(arimo, 1343, 30), was = frameSvg(plain, 1343, 30);
  assert.ok(svg.startsWith('<svg data-font="arimo" ')); assert.ok(svg.includes('font-family="Arimo, Arial, Helvetica, sans-serif"'));
  assert.ok(!/data-font|Arimo/.test(was));
  assert.ok(/ui-monospace/.test(frameSvg(drawingOf({ src: read('examples/demo.yaml'), theme, font: 'arimo' }), 400, 30)), 'its mono text is the system\'s');
  // asked for once, it is not kept: the next drawing is the default's, byte for byte, and so is one after a fault
  assert.equal(frameSvg(drawingOf({ src, theme, motion }), 1343, 30), was);
  assert.throws(() => drawingOf({ src: src.replace('asset: block', 'asset: nope'), theme, motion, font: 'arimo' }));
  assert.equal(frameSvg(drawingOf({ src, theme, motion }), 1343, 30), was);
  assert.throws(() => withFont(ARIMO, () => { throw new Error('x'); }));
  const w = textWidth('Gateway', FONTS.lbl), m = textWidth('Gateway', FONTS.sub);
  withFont(ARIMO, () => { assert.notEqual(textWidth('Gateway', FONTS.lbl), w); assert.equal(textWidth('Gateway', FONTS.sub), m); });
  assert.equal(textWidth('Gateway', FONTS.lbl), w);
  assert.throws(() => drawingOf({ src, theme, motion, font: 'helvetica' as never }), /no "helvetica"/);
  assert.throws(() => compile(src, theme, { font: ARIMO }), /self-contained/);
  // black and white too
  assert.match(frameSvg(drawingOf({ src, theme, motion, font: 'arimo', treatment: 'mono' }), 10, 30), /data-font="arimo"[^>]*Arimo, Arial|Arimo, Arial/);
});

test('fonts: the host\'s own file, in what a font loader takes; nothing of ours is loaded', () => {
  assert.deepEqual(isometricFonts({ url: '/public/Arimo-wght.ttf' }), { family: 'Arimo', url: '/public/Arimo-wght.ttf', weight: '400 700' });
  assert.deepEqual(isometricFonts({ url: 'blob:x', format: 'truetype' }), { family: 'Arimo', url: 'blob:x', weight: '400 700', format: 'truetype' });
  for (const bad of [undefined, {}, { url: '' }, { url: 3 }]) assert.throws(() => isometricFonts(bad as never), /url is where/);
});

test('the sample project: its drawing is a video, its font is the one it says, and nothing in it has a licence key or a renderer', async () => {
  const { DRAWING, MOTION } = (await import(new URL('../samples/remotion/src/drawing.ts', import.meta.url).href)) as { DRAWING: string; MOTION: MotionDoc };
  const d = drawingOf({ src: DRAWING, theme, motion: MOTION, font: 'arimo' });
  assert.deepEqual(d.compiled.diags, []); assert.equal(d.timeline.beats.length, 3); assert.ok(d.timeline.beats.every(b => b.say?.text));
  const bytes = readFileSync(new URL('../samples/remotion/public/Arimo-wght.ttf', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'e43898b143ec826ac8cb4034816458a7047fbe0836558de2a1f8c6223ae3e0ca', 'unmodified');
  assert.match(read('samples/remotion/public/OFL.txt'), /^Copyright 2026 The Arimo Project Authors[\s\S]*SIL OPEN FONT LICENSE Version 1\.1/);
  const pkg = JSON.parse(read('samples/remotion/package.json')), dev = JSON.parse(read('package.json'));
  assert.ok(!Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some(k => /renderer|bundler|cli|lambda/.test(k)));
  assert.equal(pkg.dependencies.remotion, dev.devDependencies.remotion); assert.equal(pkg.dependencies['@remotion/fonts'], dev.devDependencies.remotion); assert.equal(pkg.dependencies['@remotion/transitions'], dev.devDependencies.remotion);
  for (const f of ['src/Root.tsx', 'src/index.ts', 'src/drawing.ts', 'package.json']) assert.doesNotMatch(read(`samples/remotion/${f}`), /licen[sc]e-?key|free-license/i, f);
});
