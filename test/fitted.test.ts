// The arithmetic of a fit (src/iso-viewer/viewport.ts, fitted): what it frames keeps its margin, what must be on the stage too is, a few
// px inside; the zoom is the most that allows, the middle moves no further than it must; without that, or with it inside already, the fit it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitted, MAX_ZOOM, MIN_ZOOM } from '../src/iso-viewer/viewport.ts';

const PAD = 24, INSET = 6, E = 1e-6;
test('fitted: both inside, the most zoom, the least move; and what it was where nothing is added', () => {
  let seed = 11; const rnd = (a: number, b: number) => a + (b - a) * ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let same = 0, pushed = 0, mixed = 0;
  for (let n = 0; n < 4000; n++) {
    const s = { w: rnd(300, 1600), h: rnd(300, 1000) }, box = { x: rnd(-500, 0), y: rnd(-500, 0), w: rnd(100, 2500), h: rnd(100, 1800) };
    const also = n % 4 === 0 ? { x: box.x + rnd(5, 20), y: box.y + rnd(5, 20), w: box.w - 45, h: box.h - 45 } : { x: rnd(-900, 300), y: rnd(-900, 300), w: rnd(50, 2600), h: rnd(50, 2000) };
    const old = fitted(s, box), k0 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((s.w - 48) / box.w, (s.h - 48) / box.h)));
    assert.deepEqual(old, { k: k0, cx: box.x + box.w / 2, cy: box.y + box.h / 2 }, 'alone, as it was');
    const f = fitted(s, box, also);
    const gaps = (b: typeof box, q: typeof f) => [(b.x - q.cx) * q.k + s.w / 2, s.w / 2 - (b.x + b.w - q.cx) * q.k, (b.y - q.cy) * q.k + s.h / 2, s.h / 2 - (b.y + b.h - q.cy) * q.k];
    if (f.k <= MIN_ZOOM || f.k >= MAX_ZOOM) continue;
    for (const g of gaps(box, f)) assert.ok(g >= PAD - E, `the things' margin: ${g}`);
    for (const g of gaps(also, f)) assert.ok(g >= INSET - E, `the rest is on the stage: ${g}`);
    assert.ok(f.k <= old.k + E);
    if (gaps(also, old).every(g => g >= INSET)) { assert.deepEqual(f, old, 'inside already: the same view'); same++; continue; }
    pushed++;
    // the most: a hair more zoom and some axis has no middle that does
    const more = f.k * 1.001, room = (len: number, a0: number, a1: number, b0: number, b1: number) => Math.min(a0 + (len / 2 - PAD) / more, b0 + (len / 2 - INSET) / more) - Math.max(a1 - (len / 2 - PAD) / more, b1 - (len / 2 - INSET) / more);
    assert.ok(Math.min(room(s.w, box.x, box.x + box.w, also.x, also.x + also.w), room(s.h, box.y, box.y + box.h, also.y, also.y + also.h)) < E, 'no more zoom than this');
    const [l, r] = gaps(box, f), [al, ar] = gaps(also, f); if ((Math.abs(l - PAD) < 1e-3 && Math.abs(ar - INSET) < 1e-3) || (Math.abs(r - PAD) < 1e-3 && Math.abs(al - INSET) < 1e-3)) mixed++;
    // the least move: nearer the middle of the things, the rest isn't inside
    for (const [axis, i, j] of [['cx', 0, 1], ['cy', 2, 3]] as const) if (Math.abs(f[axis] - old[axis]) > 1e-3) { const q = { ...f, [axis]: f[axis] + (old[axis] - f[axis]) * 0.01 }, g = gaps(also, q); assert.ok(Math.min(g[i], g[j]) < INSET, 'moved no further than it must'); }
  }
  assert.ok(same > 300 && pushed > 1500 && mixed > 100, `${same} the same, ${pushed} changed, ${mixed} bound by one on one side and the other on the other`);
});
