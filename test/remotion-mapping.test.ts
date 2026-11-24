// The motion document's curves beside Remotion's own functions (remotion 4.0.546, its own licence; used here to compare, nothing copied).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Easing, interpolate, spring } from 'remotion';
import { curveAt, easeOf, springAt, type MotionEase } from '../src/iso-objects/motion-doc.ts';

const worst = (n: number, f: (i: number) => [number, number]) => { let w = 0; for (let i = 0; i <= n; i++) { const [a, b] = f(i); w = Math.max(w, Math.abs(a - b)); } return w; };
const eased = (e: MotionEase, theirs: (f: number) => number) => worst(400, i => [easeOf(e, 1000)(i / 400), theirs(i / 400)]);

test('interpolate: the same numbers, in and beyond its range, however it extends; with an easing too', () => {
  const times = [0, 400, 1500], values = [0, 10, -5];
  for (const l of ['extend', 'clamp', 'identity', 'wrap'] as const) for (const r of ['extend', 'clamp', 'identity', 'wrap'] as const) {
    assert.ok(worst(450, i => { const t = -700 + i * 7; return [curveAt({ times, values, extrapolateLeft: l, extrapolateRight: r }, t), interpolate(t, times, values, { extrapolateLeft: l, extrapolateRight: r })]; }) < 1e-9, `${l} ${r}`);
  }
  assert.ok(worst(150, i => [curveAt({ times, values, easing: { bezier: [0.16, 0.84, 0.3, 1] } }, i * 10), interpolate(i * 10, times, values, { easing: Easing.bezier(0.16, 0.84, 0.3, 1) })]) < 1e-5);
});

test('springs: the same at every frame, under, over and critically damped, clamped or not, at any rate', () => {
  for (const fps of [24, 30, 60, 29.97]) for (const c of [{}, { damping: 200 }, { mass: 2, stiffness: 50 }, { damping: 5, overshootClamping: true }, { damping: 20, stiffness: 100, mass: 1 }, { damping: 1, stiffness: 300 }])
    assert.ok(worst(150, k => [springAt(k / fps * 1000, c), spring({ frame: k, fps, config: c })]) < 1e-9, `${fps} ${JSON.stringify(c)}`);
});

test('easings by name: which are Remotion\'s and which only share a word', () => {
  assert.equal(eased('linear', Easing.linear), 0);
  assert.ok(eased('bounce', Easing.bounce) < 1e-12);
  for (const b of [[0.16, 0.84, 0.3, 1], [0.42, 0, 0.58, 1], [0.25, 0.1, 0.25, 1]] as const) assert.ok(eased({ bezier: [b[0], b[1], b[2], b[3]] }, Easing.bezier(b[0], b[1], b[2], b[3])) < 1e-5, String(b));
  // CSS's: ease, ease-in, ease-out, ease-in-out are its beziers
  assert.ok(eased('ease', Easing.bezier(0.25, 0.1, 0.25, 1)) < 1e-5); assert.ok(eased('ease-in', Easing.bezier(0.42, 0, 1, 1)) < 1e-5); assert.ok(eased('ease-out', Easing.bezier(0, 0, 0.58, 1)) < 1e-5);
  // and Remotion's Easing.ease is CSS's ease-in, not its ease: docs/MOTION.md says so
  assert.ok(eased('ease', Easing.ease) > 0.4); assert.ok(eased('ease-in', Easing.ease) < 1e-5);
  // ours in and out is near its inOut(quad), and is not it
  const d = eased('ease-in-out', Easing.inOut(Easing.quad)); assert.ok(d > 0.005 && d < 0.02, String(d));
});
