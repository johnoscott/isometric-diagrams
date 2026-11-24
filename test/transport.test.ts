// The transport (src/iso-viewer/transport.ts): the one clock of the motion code, given here so that every number is exact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../src/iso-systems/compile.ts';
import { bindMotion, type Timeline } from '../src/iso-objects/timeline.ts';
import type { MotionDoc } from '../src/iso-objects/motion-doc.ts';
import { pageClock, transport, type TransportClock, type TransportOptions } from '../src/iso-viewer/transport.ts';

const read = (f: string) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const THEME = read('themes/default.yaml');
const scene = compile(`isodiag: 1
title: t
scenes:
  - id: s
    title: t
    nodes:
      - { id: a, asset: block }
      - { id: b, asset: block, right-of: a, gap: 3 }
    routes:
      - { id: r1, from: a, to: b, kind: send }
`, THEME).scenes[0];
const bind = (doc: unknown): Timeline => { const t = bindMotion(scene, doc as MotionDoc); assert.deepEqual(t.diags, []); return t; };
const beat = (name: string, duration: number, more: object = {}) => ({ sequence: { name, duration, say: { title: name }, ...more } });
const THREE = { isomotion: 1, series: [beat('one', 1000), beat('two', 1000, { children: [{ travel: ['r1'], loop: true }] }), beat('three', 1000)] };

/** a clock moved by hand: go(ms) moves it and gives the frame that is waiting, if one is */
function hand() {
  let t = 1000, waiting: (() => void) | undefined, asked = 0;
  const clock: TransportClock = { now: () => t, next(f) { assert.equal(waiting, undefined, 'one frame at a time'); asked++; waiting = f; return f; }, cancel(id) { assert.equal(id, waiting); waiting = undefined; } };
  return { clock, go(ms: number, n = 1) { for (let i = 0; i < n; i++) { t += ms; const f = waiting; waiting = undefined; f?.(); } }, get waiting() { return waiting !== undefined; }, get asked() { return asked; } };
}
const make = (doc: unknown = THREE, o: TransportOptions = {}) => {
  const h = hand(), tr = transport(bind(doc), { clock: h.clock, ...o }), log: string[] = [];
  tr.on('play', () => log.push('play')); tr.on('pause', () => log.push('pause')); tr.on('end', () => log.push('end')); tr.on('loop', () => log.push('loop'));
  tr.on('beat', (b, how) => log.push(`${how}:${b.name}`));
  return { h, tr, log };
};

test('playing follows the clock, at its rate; it ends at the end, once, and plays again from the start', () => {
  const { h, tr, log } = make();
  assert.equal(tr.time, 0); assert.equal(tr.playing, false); assert.equal(tr.duration, 3000);
  tr.play();
  h.go(16, 10); assert.equal(tr.time, 160);
  tr.rate = 2; h.go(20); assert.equal(tr.time, 200);
  tr.rate = 0.5; h.go(20); assert.equal(tr.time, 210);
  assert.throws(() => { tr.rate = 0; }, /rate/); assert.throws(() => { tr.rate = NaN; }, /rate/);
  tr.rate = 1; h.go(5000);
  assert.equal(tr.time, 3000); assert.equal(tr.playing, false);
  assert.deepEqual(log, ['play', 'play:one', 'play:two', 'play:three', 'pause', 'end']);
  tr.play(); assert.equal(tr.time, 0); assert.equal(tr.playing, true);
  h.go(100); assert.equal(tr.time, 100);
});

test('a beat is told once as it begins, in order, also the ones a slow frame passed; after a seek, the one landed in', () => {
  const { h, tr, log } = make();
  tr.play(); h.go(2500);
  assert.deepEqual(log.splice(0), ['play', 'play:one', 'play:two', 'play:three']);
  tr.seek(1200); tr.seek(1300); assert.deepEqual(log.splice(0), ['seek:two']);
  assert.equal(tr.seekBeat('three'), true); assert.equal(tr.time, 2000); assert.equal(tr.seekBeat(0), true); assert.equal(tr.time, 0); assert.equal(tr.seekBeat('no'), false); assert.equal(tr.seekBeat(9), false);
  assert.deepEqual(log.splice(0), ['seek:three', 'seek:one']);
  tr.restart(); assert.deepEqual(log.splice(0), ['seek:one']);
  tr.seek(-5); assert.equal(tr.time, 0); tr.seek(99999); assert.equal(tr.time, 3000); tr.seek(NaN); assert.equal(tr.time, 3000);
});

test('next and prev: the next beat, or the end; this one\'s start, or the one before when it has only begun', () => {
  const { tr } = make();
  tr.next(); assert.equal(tr.time, 1000); tr.next(); tr.next(); assert.equal(tr.time, 3000); tr.next(); assert.equal(tr.time, 3000);
  tr.prev(); assert.equal(tr.time, 2000);
  tr.seek(1900); tr.prev(); assert.equal(tr.time, 1000);
  tr.seek(1200); tr.prev(); assert.equal(tr.time, 0); tr.prev(); assert.equal(tr.time, 0);
});

test('two clocks: paused, the ambient one goes on alone; a seek moves both by the same; a restart makes them one again', () => {
  const { h, tr } = make();
  tr.play(); h.go(1100); assert.equal(tr.ambientTime, 1100);
  tr.pause(); h.go(300); assert.equal(tr.time, 1100); assert.equal(tr.ambientTime, 1400);
  tr.seek(1600); assert.equal(tr.ambientTime, 1900);
  assert.deepEqual(tr.state(), tr.timeline.at(1600, { ambient: 1900 }));
  tr.restart(); assert.equal(tr.time, 0); assert.equal(tr.ambientTime, 0);
  // a step taken: what loops starts with it; not while it is off
  h.go(300); tr.seek(1000, { join: true }); assert.equal(tr.ambientTime, 1000); h.go(50); tr.ambient = false; tr.seek(2000, { join: true }); assert.equal(tr.ambientTime, 1050); tr.ambient = true; tr.restart();
  // at a rate, both
  tr.rate = 2; h.go(50); assert.equal(tr.time, 0); assert.equal(tr.ambientTime, 100);
});

test('ambient off: it stops where it is, through play, pause, seek and restart; on again, it goes on from there with no jump', () => {
  const { h, tr } = make();
  const said: boolean[] = []; tr.on('ambient', v => said.push(v));
  tr.play(); h.go(1250); tr.ambient = false;
  const held = tr.state().tokens;
  assert.ok(held?.length);
  h.go(100); assert.equal(tr.time, 1350); assert.equal(tr.ambientTime, 1250); assert.deepEqual(tr.state().tokens, held);
  tr.pause(); h.go(500); tr.seek(1700); assert.equal(tr.ambientTime, 1250);
  tr.restart(); assert.equal(tr.ambientTime, 1250); tr.seek(1700);
  tr.ambient = true; assert.equal(tr.ambientTime, 1250); assert.deepEqual(tr.state().tokens, held);
  h.go(10); assert.equal(tr.ambientTime, 1260);
  assert.deepEqual(said, [false, true]);
});

test('off from the start (the option, or the document): each loop at its own start, and on begins there', () => {
  for (const { h, tr } of [make(THREE, { ambient: 'off' }), make({ ...THREE, ambient: 'off' })]) {
    assert.equal(tr.ambient, false); assert.equal(tr.ambientTime, 'off');
    tr.seek(1400); const start = tr.state();
    assert.deepEqual(start, tr.timeline.at(1400, { ambient: 'off' }));
    tr.ambient = true; assert.equal(tr.ambientTime, 1000); assert.deepEqual(tr.state(), start);
    h.go(40); assert.equal(tr.ambientTime, 1040);
  }
  // and the option wins over the document
  assert.equal(make({ ...THREE, ambient: 'off' }, { ambient: 'on' }).tr.ambient, true);
});

test('a loop comes round: the beats again, and the two clocks one', () => {
  const { h, tr, log } = make(THREE, { loop: true });
  tr.play(); tr.pause(); h.go(500); tr.play(); log.length = 0;
  h.go(2900); assert.equal(tr.ambientTime, 3400);
  h.go(200); assert.equal(tr.time, 100); assert.equal(tr.ambientTime, 100); assert.equal(tr.playing, true);
  assert.deepEqual(log, ['play:two', 'play:three', 'loop', 'play:one']);
  // many turns in one frame (a page that was not shown): one is told
  log.length = 0; h.go(3000 * 5 + 1100);
  assert.equal(tr.time, 1200); assert.deepEqual(log, ['play:two', 'play:three', 'loop', 'play:one', 'play:two']);
});

test('no frame is asked for while nothing moves, or while it is not active; the clocks stand meanwhile', () => {
  const still = make({ isomotion: 1, series: [beat('one', 1000)] });
  assert.equal(still.h.waiting, false); still.tr.play(); assert.equal(still.h.waiting, true); still.tr.pause(); assert.equal(still.h.waiting, false);
  const { h, tr } = make();
  assert.equal(h.waiting, true, 'ambient, paused'); tr.ambient = false; assert.equal(h.waiting, false); tr.ambient = true;
  tr.play(); h.go(100); tr.active = false; assert.equal(h.waiting, false); h.go(60000); assert.equal(tr.time, 100); assert.equal(tr.playing, true);
  tr.active = true; h.go(10); assert.equal(tr.time, 110); assert.equal(tr.ambientTime, 110);
  tr.dispose(); assert.equal(h.waiting, false); tr.play(); tr.seek(5); h.go(100); assert.equal(tr.time, 110);
});

test('rebind keeps the place by beat and how far in it; a beat that went away falls to the nearest before; faults are refused', () => {
  const { tr, log } = make();
  tr.seek(1500); log.length = 0;
  assert.equal(tr.rebind(bind({ isomotion: 1, series: [beat('zero', 500), beat('one', 1000), beat('two', 4000), beat('three', 1000)] })), true);
  assert.equal(tr.time, 500 + 1000 + 2000); assert.equal(tr.beat!.name, 'two'); assert.equal(tr.ambientTime, tr.time);
  // two goes: one is the nearest before
  tr.rebind(bind({ isomotion: 1, series: [beat('one', 700), beat('three', 1000)] }));
  assert.equal(tr.time, 0); assert.equal(tr.beat!.name, 'one');
  const before = tr.timeline;
  assert.equal(tr.rebind(bindMotion(scene, { isomotion: 1, series: [{ sequence: { name: 'x', duration: 'never' } }] } as unknown as MotionDoc)), false);
  assert.equal(tr.timeline, before);
  // and playing goes on through it
  const p = make(); p.tr.play(); p.h.go(1500); p.tr.rebind(bind({ isomotion: 1, series: [beat('one', 100), beat('two', 1000)] }));
  assert.equal(p.tr.playing, true); p.h.go(10); assert.equal(p.tr.time, 610);
});

test('a listener may seek, pause or dispose inside an event: what that frame would still have said is not said', () => {
  const a = make(); a.tr.on('beat', b => { if (b.name === 'two') a.tr.seek(200); });
  a.tr.play(); a.log.length = 0; a.h.go(2500);
  assert.equal(a.tr.time, 200); assert.ok(!a.log.includes('play:three'), a.log.join()); assert.equal(a.tr.playing, true); a.h.go(10); assert.equal(a.tr.time, 210);
  const b = make(); b.tr.on('beat', x => { if (x.name === 'three') b.tr.pause(); });
  b.tr.play(); b.h.go(9000); assert.deepEqual(b.log.filter(x => x === 'pause' || x === 'end'), ['pause']);
  const c = make(); let n = 0; c.tr.on('time', () => { n++; c.tr.dispose(); }); c.tr.play(); c.h.go(10); c.h.go(10); assert.equal(n, 1); assert.equal(c.h.waiting, false);
  const d = make(); const off = d.tr.on('time', () => n++); n = 0; off(); d.tr.play(); d.h.go(10); assert.equal(n, 0);
});

test('the page\'s clock goes on where no frames are drawn, and calls once', async () => {
  const c = pageClock(); let n = 0;
  await new Promise<void>(res => { c.next(() => { n++; setTimeout(res, 150); }); });
  assert.equal(n, 1);
  const id = c.next(() => n++); c.cancel(id); await new Promise(res => setTimeout(res, 150)); assert.equal(n, 1);
});

test('no other motion module has a clock', () => {
  const clocks = /performance\.now|Date\.now|new Date|requestAnimationFrame|setTimeout|setInterval/;
  for (const f of ['motion', 'timeline', 'motion-doc', 'motion-builder', 'ants', 'looks', 'motion-entry']) {
    const code = read(`src/iso-objects/${f}.ts`).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.ok(!clocks.test(code), f);
  }
  assert.ok(clocks.test(read('src/iso-viewer/transport.ts')));
  // the players' own: none (the page's timers wait for a scroll or a first look, and draw nothing)
  for (const f of ['play', 'player']) assert.doesNotMatch(read(`src/iso-viewer/${f}.ts`).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /performance\.now|Date\.now|new Date|requestAnimationFrame|setInterval/, f);
});

test('play until a time: it pauses there, exactly, and says pause and not end; a seek past it, a pause or a restart forgets it', () => {
  const { h, tr, log } = make();
  tr.play({ until: 1999 }); h.go(16, 3); assert.equal(tr.playing, true);
  h.go(5000); assert.equal(tr.time, 1999); assert.equal(tr.playing, false);
  assert.deepEqual(log, ['play', 'play:one', 'play:two', 'pause']);
  tr.play({ until: 500 }); assert.equal(tr.playing, false, 'a time that has gone by');
  tr.seek(0); tr.play({ until: 500 }); tr.seek(700); h.go(10); assert.equal(tr.time, 710); assert.equal(tr.playing, true);
  tr.pause(); tr.seek(0); tr.play({ until: 500 }); tr.pause(); tr.play(); h.go(600); assert.equal(tr.time, 600); assert.equal(tr.playing, true);
});
