// Making way for a dragged thing (src/iso-editor/make-way.ts): who steps aside and where to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWay, hits, MAX_CHAIN, DWELL_HINT, DWELL_GIVE, BACK_AFTER, GLIDE, JIGGLE, type Beside, type Rect } from '../src/iso-editor/make-way.ts';

const b = (id: string, x: number, y: number, w = 2, d = 2, movable = true): Beside => ({ id, x0: x, y0: y, x1: x + w, y1: y + d, movable });
const r = (x: number, y: number, w = 2, d = 2): Rect => ({ x0: x, y0: y, x1: x + w, y1: y + d });
const of = (m: ReturnType<typeof makeWay>) => m && Object.fromEntries(m);

test('the numbers the owner approved', () => {
  assert.deepEqual({ DWELL_HINT, DWELL_GIVE, BACK_AFTER, GLIDE, JIGGLE, MAX_CHAIN }, { DWELL_HINT: 150, DWELL_GIVE: 700, BACK_AFTER: 250, GLIDE: 180, JIGGLE: { px: 1.5, hz: 8 }, MAX_CHAIN: 3 });
});
test('nothing in the way: nothing moves; touching is not in the way', () => {
  assert.deepEqual(of(makeWay({ foot: r(0, 0), others: [b('a', 2, 0), b('c', 5, 5)], going: [1, 0] })), {});
});
test('the fewest whole cells; among equals the way it was going; never back', () => {
  assert.deepEqual(of(makeWay({ foot: r(0, 0), others: [b('a', 1, 0)], going: [0, 1] })), { a: [1, 0] }, 'one cell beats the way it was going');
  assert.deepEqual(of(makeWay({ foot: r(0, 0), others: [b('a', 0, 0)], going: [0, 1] })), { a: [0, 2] }, 'equal: the way it was going');
  assert.notDeepEqual(of(makeWay({ foot: r(0, 0), others: [b('a', -1, 0)], going: [1, 0] })), { a: [-1, 0] }, 'one cell back towards where it came from is not taken');
  const boxed = [b('a', -1, 0), b('n', -9, 2, 30, 1, false), b('s', -9, -1, 30, 1, false), b('e', 2, 0, 1, 2, false)];
  assert.equal(makeWay({ foot: r(0, 0), others: boxed, going: [1, 0] }), undefined, 'even where it is the only way'); assert.deepEqual(of(makeWay({ foot: r(0, 0), others: boxed, going: [-1, 0] })), { a: [-1, 0] });
  assert.deepEqual(of(makeWay({ foot: { x0: 0.5, y0: 0, x1: 2.5, y1: 2 }, others: [b('a', 2, 0)], going: [1, 0] })), { a: [1, 0] }, 'whole cells, from half a cell');
});
test('a chain: at most three; what can\'t be pinned, the margin and the chain\'s end refuse', () => {
  const row = (n: number) => Array.from({ length: n }, (_, i) => b(`n${i}`, 1 + i * 2, 0)), walls = [b('n', -9, 2, 60, 1, false), b('s', -9, -1, 60, 1, false)];
  assert.deepEqual(of(makeWay({ foot: r(0, 0), others: [...row(3), ...walls], going: [1, 0] })), { n0: [1, 0], n1: [1, 0], n2: [1, 0] });
  assert.equal(makeWay({ foot: r(0, 0), others: [...row(4), ...walls], going: [1, 0] }), undefined, 'four');
  assert.deepEqual(of(makeWay({ foot: r(0, 0), others: [...row(4), ...walls], going: [1, 0], max: 4 })), { n0: [1, 0], n1: [1, 0], n2: [1, 0], n3: [1, 0] });
  assert.equal(makeWay({ foot: r(0, 0), others: [b('a', 1, 0, 2, 2, false)], going: [1, 0] }), undefined);
  assert.equal(makeWay({ foot: r(0, 0), others: [b('a', 1, 0)], going: [1, 0], bounds: { x0: 0, y0: 0, x1: 3, y1: 2 } }), undefined, 'no place inside');
  assert.deepEqual(of(makeWay({ foot: r(0, 0), others: [b('a', 1, 0)], going: [1, 0], bounds: { x0: 0, y0: 0, x1: 4, y1: 2 } })), { a: [1, 0] });
});
test('five thousand at random: what moves is in the way, moves by whole cells one way, and ends clear and inside; the same each time', () => {
  let seed = 7; const rnd = (n: number) => Math.floor(n * ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648));
  let moved = 0, refused = 0, chains = 0;
  for (let k = 0; k < 5000; k++) {
    const others: Beside[] = [];
    for (let i = 0; i < 9; i++) { const q = b('n' + i, rnd(12), rnd(12), 1 + rnd(3), 1 + rnd(3), rnd(12) > 0); if (!others.some(o => hits(o, q)) && q.x1 <= 13 && q.y1 <= 13) others.push(q); }
    const bounds = { x0: 0, y0: 0, x1: 13, y1: 13 }, foot = r(rnd(11), rnd(11)), going: [number, number] = [rnd(5) - 2, rnd(5) - 2], o = { foot, others, going, bounds };
    const m = makeWay(o); assert.deepEqual(of(makeWay({ ...o, others: others.map(q => ({ ...q })) })), of(m));
    if (!m) { refused++; continue; }
    if (!m.size) { assert.ok(!others.some(q => hits(q, foot))); continue; }
    moved++; if (m.size > 1) chains++;
    assert.ok(m.size <= MAX_CHAIN);
    const now = others.map(q => { const [dx, dy] = m.get(q.id) ?? [0, 0]; return { ...q, x0: q.x0 + dx, x1: q.x1 + dx, y0: q.y0 + dy, y1: q.y1 + dy }; });
    for (const q of now) { assert.ok(!hits(q, foot)); for (const p of now) if (p !== q) assert.ok(!hits(p, q)); }
    const dirs = new Set<string>();
    for (const [id, [dx, dy]] of m) { assert.ok(others.find(q => q.id === id)!.movable); assert.ok(Number.isInteger(dx) && Number.isInteger(dy) && (dx === 0) !== (dy === 0)); dirs.add(`${Math.sign(dx)},${Math.sign(dy)}`); const q = now.find(x => x.id === id)!; assert.ok(q.x0 >= 0 && q.y0 >= 0 && q.x1 <= 13 && q.y1 <= 13); }
    assert.equal(dirs.size, 1); { const [dx, dy] = [...dirs][0].split(',').map(Number), v = dx * going[0] + dy * going[1]; assert.ok(!(v < 0 && -v >= Math.max(...going.map(Math.abs))), 'never back'); }
    // nothing moves that isn't needed: put any one back, and it is in the way of something
    for (const id of m.keys()) { const home = others.find(q => q.id === id)!; assert.ok(hits(home, foot) || now.some(q => q.id !== id && m.has(q.id) && hits(q, home))); }
  }
  assert.ok(moved > 1000 && refused > 100 && chains > 200, `${moved} moved, ${refused} refused, ${chains} chains`);
});
