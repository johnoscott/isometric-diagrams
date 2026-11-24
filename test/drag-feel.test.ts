// The editor's drag (0.14.0), in Chrome with a real mouse (DevTools' input events), on boxes/1:
//   - what is in the way makes way only for a drop that waits: nothing for 150 ms, then a jiggle and dashed outlines, at 700 ms it
//     goes there; another cell starts the clock again; a drop without the wait is refused as ever; left again, it goes back after
//     250 ms; Esc puts all back; the drop and all that moved are one undo step, each pinned;
//   - a new thing from the palette is the thing itself on the canvas, by the same drag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drivePage, bundlePage, type Driver } from './adapters/page-driver.ts';
import { readBoxes } from './adapters/boxes.ts';
import { C, S } from '../src/iso-core/kernel.ts';
import { DWELL_HINT, DWELL_GIVE, BACK_AFTER } from '../src/iso-editor/make-way.ts';
// @ts-ignore plain JS helper
import { chromePath } from '../scripts/chrome.mjs';

let chrome: string | undefined;
try { chrome = chromePath(); } catch { chrome = undefined; }
const PAGE = new URL('./adapters/boxes-page.ts', import.meta.url).pathname;
let js: Promise<Uint8Array> | undefined;
const bundled = () => (js ??= bundlePage(PAGE).then(r => r.outputFiles![0].contents));
const skip = chrome ? false : 'no Chrome';

const doc = (boxes: Record<string, [number, number, number?, number?]>, extra = '') => `format: boxes/1\ntitle: Drag\nboxes:\n${Object.entries(boxes).map(([n, [, , w = 2, d = 2]]) => `  ${n}: { size: [${w}, ${d}, 1] }\n`).join('')}${extra}x-editor:\n  layout:\n${Object.entries(boxes).map(([n, [x, y]]) => `    ${n}: { at: [${x}, ${y}] }\n`).join('')}`;
type At = Record<string, [number, number]>;
const pinsOf = (t: string) => Object.fromEntries(Object.entries((readBoxes(t).read!.data as { 'x-editor'?: { layout?: Record<string, { at: [number, number] }> } })['x-editor']?.layout ?? {}).map(([n, v]) => [n, v.at]));

async function page(run: (d: Driver & ReturnType<typeof tools>) => Promise<void>, opts: { attrs?: string; reduce?: boolean } = {}) {
  await drivePage(chrome!, await bundled(), '__boxes', async d => {
    // DRAG_THROTTLE=6: a processor six times slower (a continuous-integration runner's, or a loaded machine)
    if (process.env.DRAG_THROTTLE) await d.cdp('Emulation.setCPUThrottlingRate', { rate: Number(process.env.DRAG_THROTTLE) });
    if (opts.reduce) await d.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await d.until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');
    const t = tools(d);
    await run({ ...d, ...t });
    assert.deepEqual(await d.ev(`return { violations: B.violations, errors: B.errors };`), { violations: [], errors: [] });
  }, '1280,860', { html: `<!doctype html><html><head><meta charset="utf-8"><title>page</title></head><body ${opts.attrs ?? ''} data-stored="{}" style="margin:0"><div id="app" style="height:100vh"></div><script type="module" src="page.js"></script></body></html>` });
}
function tools({ ev, until, cdp }: Driver) {
  let mx = 0, my = 0;
  const mouse = async (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', x: number, y: number) => { mx = x; my = y; await cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }); };
  const load = async (text: string) => {
    await ev(`E.setText(${JSON.stringify(text)}, { fit: true });`);
    const first = Object.keys((readBoxes(text).read!.data as { boxes: object }).boxes)[0];
    await until(`E.getText() === ${JSON.stringify(text)} && I.canvas.doc?.scene.layout.byId.get(${JSON.stringify(first)}) && !document.querySelector('.iso-canvas svg.scene [data-id="shelf"]')`, 'loaded');
    await ev(`await tick(250);`);
  };
  /** the px of a cell's step on screen */
  const cell = async ([gx, gy]: [number, number]): Promise<[number, number]> => { const k = await ev<number>(`return I.canvas.scale();`); return [(gx - gy) * C * S * k, (gx + gy) * 0.5 * S * k]; };
  const middle = (id: string) => ev<{ x: number; y: number }>(`return I.canvas.pageXYOf(['boxes', ${JSON.stringify(id)}]);`);
  /** press on a thing */
  const grab = async (id: string) => { const p = await middle(id); await mouse('mouseMoved', p.x, p.y); await mouse('mousePressed', p.x, p.y); return p; };
  /** the pointer by whole cells from where it was pressed, in steps of a cell */
  const by = async (p: { x: number; y: number }, to: [number, number], from: [number, number] = [0, 0]) => {
    const n = Math.max(1, ...to.map((v, i) => Math.abs(v - from[i])));
    for (let i = 1; i <= n; i++) { const [dx, dy] = await cell([from[0] + (to[0] - from[0]) * i / n, from[1] + (to[1] - from[1]) * i / n]); await mouse('mouseMoved', p.x + dx, p.y + dy); await ev(`await tick(40);`); }
  };
  /** things of one container whose footprints overlap, anywhere in the drawing (none, ever: sharing an edge isn't overlapping) */
  const sharing = () => ev<string[]>(`const L = I.canvas.doc.scene.layout.items, Z = 1e-6, out = []; for (const a of L) for (const b of L) if (a.id < b.id && a.parent?.id === b.parent?.id && a.box.x0 < b.box.x1 - Z && a.box.x1 > b.box.x0 + Z && a.box.y0 < b.box.y1 - Z && a.box.y1 > b.box.y0 + Z) out.push(a.id + ' and ' + b.id); return out;`);
  /** let go: after every drop, whatever made way, no two things of a container overlap */
  const up = async () => { await mouse('mouseReleased', mx, my); await until(`!I.canvas.drag`, 'the drag is over'); await ev(`await I.canvas.settled?.(); await tick(350);`); assert.deepEqual(await sharing(), [], 'no two things of a container overlap'); };
  const text = () => ev<string>(`return E.getText();`);
  const at = () => ev<At>(`const L = I.canvas.doc.scene.layout, o = {}; for (const i of L.items) if (!i.region) o[i.id] = [i.box.x0, i.box.y0]; return o;`);
  /** a record of every frame: when, whether it may drop, what is outlined, how far each thing is shifted, where the drawing has it */
  const record = () => ev(`window.__log = []; window.__rec = true; window.__moves = []; window.__mv ??= [addEventListener('pointermove', e => window.__moves.push(e.timeStamp), true), addEventListener('pointerup', e => { window.__upAt = e.timeStamp; }, true)]; const go = () => { if (!window.__rec) return; const g = I.canvas.drag, o = {}; for (const i of I.canvas.doc.scene.layout.items) o[i.id] = i.box.x0 + ',' + i.box.y0;
    window.__log.push({ t: performance.now(), inv: !!g?.invalid, at: g?.move ? g.move.at.join() : '', way: [...document.querySelectorAll('.iso-canvas .overlay .way')].map(e => e.dataset.way).join(), box: o,
      tf: Object.fromEntries(Object.keys(o).map(id => [id, document.querySelector('.iso-canvas svg.scene [data-id="' + id + '"]')?.getAttribute('transform') ?? ''])) }); requestAnimationFrame(go); }; requestAnimationFrame(go);`);
  type Frame = { t: number; inv: boolean; at: string; way: string; box: Record<string, string>; tf: Record<string, string> };
  const log = () => ev<Frame[]>(`window.__rec = false; return window.__log;`);
  /** the pointer's own times of its moves since record() began: a step of a test is one move, so the nth is the one that came to the nth cell. What
   *  the canvas does is after it however late a frame shows it; a frame's time, taken as the start, is late on a slow machine */
  const moves = () => ev<number[]>(`return window.__moves;`);
  /** what is only so when it is quick (two of the pointer's own times within `limit` ms): tried again, from the start, when the machine wasn't */
  const quickly = async (limit: number, again: () => Promise<void>, attempt: () => Promise<[number, number]>) => {
    for (let n = 0; n < 6; n++) { const [a, b] = await attempt(); if (b - a < limit) return; await again(); }
    assert.fail(`never within ${limit} ms: the machine is too slow to say`);
  };
  /** the pointer's own time of its last move, and of its release */
  const times = () => ev<[number, number]>(`return [window.__moves.at(-1), window.__upAt];`);
  const wait = (ms: number) => ev(`await tick(${ms});`);
  const esc = async () => { for (const type of ['rawKeyDown', 'keyUp']) await cdp('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await until(`!I.canvas.drag`, 'the drag is over'); };
  const undo = async (t: string, why: string) => { await ev(`I.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));`); await until(`E.getText() === ${JSON.stringify(t)}`, why); await wait(150); };
  /** press on a palette entry and bring the pointer over a thing (or a point of it), in steps */
  const take = async (entry: number, to: { x: number; y: number }) => {
    const b = await ev<{ x: number; y: number }>(`const r = document.querySelector('.palette .pal-item[data-entry="${entry}"]').getBoundingClientRect(); return { x: r.left + 8, y: r.top + 8 };`);
    await mouse('mouseMoved', b.x, b.y); await mouse('mousePressed', b.x, b.y);
    for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', b.x + (to.x - b.x) * i / 8, b.y + (to.y - b.y) * i / 8); await wait(25); }
    await wait(60);
  };
  return { mouse, load, cell, middle, grab, by, up, text, at, record, moves, quickly, times, log, wait, esc, undo, take };
}
const ROW = doc({ a: [0, 0], b: [4, 0], far: [0, 9] });

test('make way (0.14.0): a drop that waits, with a real mouse: 150 ms of nothing, a jiggle and outlines, at 700 ms it gives way; the drop is one undo step', { skip, timeout: 120000 }, async () => {
  await page(async ({ load, grab, by, record, moves, log, wait, at, up, text, undo, ev, mouse, esc, until }) => {
    await load(ROW);
    const p = await grab('a');
    await record();
    await by(p, [3, 0]);
    await until(`I.canvas.drag.given?.size && !document.querySelector('.iso-canvas .overlay .way') && I.canvas.doc.scene.layout.byId.get('b').box.x0 === 5`, 'it gave way'); await wait(900);
    const t0 = (await moves())[2], L = await log(), taken = L.findIndex(f => f.inv && f.at === '3,0');
    assert.ok(taken >= 0, 'taken'); const hint = L.slice(taken).find(f => f.way)!, gave = L.slice(taken).find(f => !f.inv)!;
    assert.ok(hint && gave, `outlined ${hint?.t}, gave ${gave?.t}`);
    // in this order, and never early, from the move that came there (a timer may be a millisecond early); late only as the machine is
    assert.ok(hint.t < gave.t); assert.ok(hint.t - t0 >= DWELL_HINT - 2, `the hint at ${hint.t - t0}`); assert.ok(gave.t - t0 >= DWELL_GIVE - 2, `gave way at ${gave.t - t0}`);
    assert.ok(L.filter(f => f.t < hint.t).every(f => !f.tf.b), 'still until the hint');
    const jig = L.filter(f => f.t > hint.t && f.t < gave.t).map(f => Number(/translate\(([-\d.]+) ([-\d.]+)\)/.exec(f.tf.b)?.[1] ?? 0)), k = await ev<number>(`return I.canvas.scale();`);
    assert.ok((jig.length < 8 || (jig.some(v => v > 0) && jig.some(v => v < 0))) && jig.some(v => v !== 0) && Math.max(...jig.map(Math.abs)) * k <= 1.55, `a jiggle of at most 1.5 px: ${Math.max(...jig.map(Math.abs)) * k}`);
    assert.ok(L.filter(f => f.way).every(f => f.way === 'b' && f.box.b === '4,0'), 'only what would move, where it was');
    const end = L[L.length - 1]; assert.ok(!end.way && !end.tf.b && end.box.b === '5,0', 'then it is there, still');
    // (a machine too slow for a frame in 180 ms shows no glide)
    const gl = L.filter(f => f.box.b === '5,0' && f.tf.b); assert.ok(gl.every(f => /translate\(-/.test(f.tf.b)) && (gl.length || L.filter(f => f.t >= gave.t && f.t < gave.t + 180).length < 3), 'it glided there');
    assert.equal(await text(), ROW, 'nothing is written until the drop');
    await up();
    await ev(`await tick(300);`);
    assert.deepEqual(pinsOf(await text()), { a: [3, 0], b: [5, 0], far: [0, 9] });
    assert.deepEqual(await at(), { a: [3, 0], b: [5, 0], far: [0, 9] });
    assert.match(await ev<string>(`return I.doc.undoLabel;`), /^Pin .*a at \[3, 0\] \(b made way\)$/);
    await undo(ROW, 'one undo puts both back');
    // a drag selects none of the drawing's words (from one thing's middle over the others' labels)
    const q = await grab('far'); for (const id of ['a', 'b']) { const m = await ev<{ x: number; y: number }>(`const t = [...document.querySelectorAll('.iso-canvas svg.scene text')].find(e => e.textContent.trim() === '${id}') ?? document.querySelector('.iso-canvas svg.scene text'); const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`); await mouse('mouseMoved', m.x - 20, m.y); await mouse('mouseMoved', m.x + 20, m.y + 2); await wait(60); }
    assert.deepEqual(await ev(`const s = getSelection(); return [s.isCollapsed, s.rangeCount ? [...document.querySelectorAll('.iso-canvas svg.scene text')].filter(t => s.containsNode(t, true) && getComputedStyle(t).userSelect !== 'none').length : 0];`), [true, 0]); await esc(); await mouse('mouseReleased', q.x, q.y); await wait(250);
    assert.deepEqual(await at(), { a: [0, 0], b: [4, 0], far: [0, 9] });
  });
});

test('make way: no wait, no push; another cell starts the clock again; drifting in the cell does not; Esc at any time is all back', { skip, timeout: 180000 }, async () => {
  await page(async ({ load, grab, by, record, moves, log, wait, at, up, text, esc, cell, mouse, ev, until, quickly, times }) => {
    await load(ROW);
    const reset = async () => { await load(ROW); };
    // dropped at once: refused
    let p = { x: 0, y: 0 };
    await quickly(DWELL_GIVE - 50, reset, async () => { await record(); p = await grab('a'); await by(p, [3, 0]); await up(); return times(); }); await wait(400);
    assert.equal(await text(), ROW); assert.deepEqual(await at(), { a: [0, 0], b: [4, 0], far: [0, 9] });
    // dropped in the jiggle: refused
    await quickly(DWELL_GIVE - 50, reset, async () => { await record(); p = await grab('a'); await by(p, [3, 0]); await until(`document.querySelector('.iso-canvas .overlay .way') || I.canvas.drag?.given?.size`, 'the hint'); await up(); return times(); }); await wait(400);
    assert.equal(await text(), ROW); assert.equal(await ev(`return document.querySelectorAll('.iso-canvas .overlay .way, .iso-canvas svg.scene [transform^="translate"]').length;`), 0);
    // another taken cell before it gives way: the outlines go at once and the clock starts again
    p = await grab('a'); await record(); await by(p, [3, 0]); await until(`document.querySelector('.iso-canvas .overlay .way')`, 'begun'); await by(p, [4, 0], [3, 0]); await until(`I.canvas.drag.given?.size`, 'it gave way'); await wait(100);
    let t1 = (await moves())[3], L = await log(), first = L.findIndex(f => f.at === '4,0');
    const again = L.slice(first).find(f => f.way)!, gave = L.slice(first).find(f => !f.inv)!;
    assert.ok(L.slice(0, first).some(f => f.at === '3,0' && f.way === 'b'), 'it had begun'); assert.ok(!L[first].way && !L[first].tf.b, 'stopped at once');
    assert.ok(again && again.t - t1 >= DWELL_HINT - 2 && gave.t - t1 >= DWELL_GIVE - 2, `${again?.t - t1} and ${gave?.t - t1} from the new cell`);
    await esc(); await wait(400);
    assert.equal(await text(), ROW); assert.deepEqual(await at(), { a: [0, 0], b: [4, 0], far: [0, 9] }, 'Esc after it gave way: all back');
    await mouse('mouseReleased', p.x, p.y); await wait(200); assert.equal(await text(), ROW);
    // the pointer cancelled after it gave way: all back, nothing written (the release that follows does nothing)
    p = await grab('a'); await by(p, [3, 0]); await until(`I.canvas.doc.scene.layout.byId.get('b').box.x0 === 5`, 'it gave way'); assert.deepEqual((await at()).b, [5, 0]);
    await ev(`I.canvas.stage.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));`); await wait(400); assert.equal(await ev(`return !!I.canvas.drag;`), false); await mouse('mouseReleased', p.x, p.y); await wait(200);
    assert.equal(await text(), ROW); assert.deepEqual(await at(), { a: [0, 0], b: [4, 0], far: [0, 9] });
    // drifting inside the cell
    p = await grab('a'); await record(); await by(p, [3, 0]); for (let i = 0; i < 12; i++) { const [dx, dy] = await cell([3 + (i % 2 ? 0.2 : -0.2), 0]); await mouse('mouseMoved', p.x + dx, p.y + dy); await wait(60); } await wait(500);
    L = await log(); // not restarted: it gave way while it drifted or soon after, not 700 ms after the last drift
    t1 = (await moves()).at(-1)!; { const i = L.findIndex(f => f.inv && f.at === '3,0'), g = L.slice(i).find(f => !f.inv)!; assert.ok(g && g.t - t1 < DWELL_GIVE, `not restarted: ${g?.t - t1} after the last drift`); }
    await esc(); await wait(300); await mouse('mouseReleased', p.x, p.y);
  });
});

test('make way: left again, it goes back (after 250 ms, no sooner), and a drop elsewhere leaves it unpinned; kept while the place is still needed', { skip, timeout: 180000 }, async () => {
  await page(async ({ load, grab, by, record, moves, log, wait, at, up, text, undo, until, quickly, times }) => {
    const gave = () => until(`I.canvas.doc.scene.layout.byId.get('b').box.x0 === 5`, 'it gave way');
    await load(ROW);
    let p = await grab('a'); await by(p, [3, 0]); await gave(); assert.deepEqual((await at()).b, [5, 0]);
    await record(); await by(p, [3, 5], [3, 0]); await until(`I.canvas.doc.scene.layout.byId.get('b').box.x0 === 4`, 'it went back'); await wait(100);
    // from the move that left (its second: two cells down, clear of where b was)
    const out = (await moves())[1], L = await log(), i = L.findIndex(f => f.at === '3,2'), back = L.slice(Math.max(0, i)).find(f => f.box.b === '4,0')!;
    assert.ok(back && back.t - out >= BACK_AFTER - 2, `back ${back?.t - out} ms after`);
    await up(); await wait(300);
    assert.deepEqual(pinsOf(await text()), { a: [3, 5], b: [4, 0], far: [0, 9] }); await undo(ROW, 'one step');
    // one more cell the same way still needs the place of b: it stays out of it, with no new wait for what is clear
    await quickly(BACK_AFTER - 40, async () => { await up(); await load(ROW); }, async () => {
      p = await grab('a'); await by(p, [3, 0]); await gave(); await record(); await by(p, [2, 0], [3, 0]); await by(p, [3, 0], [2, 0]);
      const m = await moves(); return [m[0], m[1]];
    });
    await wait(120); assert.deepEqual((await at()).b, [5, 0], 'out and in again within 250 ms: no flicker');
    await up(); await wait(300); assert.deepEqual(pinsOf(await text()), { a: [3, 0], b: [5, 0], far: [0, 9] }); await undo(ROW, 'one step');
    // dropped beyond it before it went back: it isn't pinned anywhere else
    await quickly(BACK_AFTER - 20, async () => { await load(ROW); }, async () => { await record(); p = await grab('a'); await by(p, [3, 0]); await gave(); const n = (await moves()).length; await by(p, [0, 3], [3, 0]); await up(); const m = await moves(); return [m[n], (await times())[1]]; });
    await wait(400); assert.deepEqual(pinsOf(await text()), { a: [0, 3], b: [4, 0], far: [0, 9] });
  });
});

test('make way: a chain of three; four, or a margin with no place, stays red with no jiggle', { skip, timeout: 120000 }, async () => {
  // three deep above and below, so that sideways is a chain of four
  const walls = { n: [-6, 2, 40, 1], n2: [-6, 3, 40, 1], n3: [-6, 4, 40, 1], s: [-6, -1, 40, 1], s2: [-6, -2, 40, 1], s3: [-6, -3, 40, 1] } as Record<string, [number, number, number, number]>;
  await page(async ({ load, grab, by, record, log, wait, up, text, esc, mouse, until }) => {
    for (const [n, gives] of [[3, true], [4, false]] as const) {
      const row = Object.fromEntries(Array.from({ length: n }, (_, i) => [`b${i}`, [4 + i * 2, 0]])) as Record<string, [number, number]>;
      const T = doc({ a: [0, 0], ...row, ...walls }); await load(T);
      const p = await grab('a'); await record(); await by(p, [3, 0]); if (gives) await until(`I.canvas.drag.given?.size`, 'it gave way'); await wait(gives ? 100 : 1500);
      const L = await log(); assert.equal(L.some(f => f.way), gives, `${n} in a row`);
      if (gives) { await up(); await wait(300); const q = pinsOf(await text()); assert.deepEqual([q.a, q.b0, q.b1, q.b2, q.n, q.s], [[3, 0], [5, 0], [7, 0], [9, 0], [-6, 2], [-6, -1]]); }
      else { assert.ok(L.every(f => Object.entries(f.tf).every(([id, t]) => id === 'a' || !t)), 'nothing moves'); await esc(); await mouse('mouseReleased', p.x, p.y); await wait(300); assert.equal(await text(), T); }
    }
  });
});

test('make way under Reduce Motion: it moves all the same (the default); with dragMotion: respect, the outlines and the wait only', { skip, timeout: 120000 }, async () => {
  for (const [attrs, moves] of [['', true], ['data-drag-motion="respect"', false]] as const) await page(async ({ load, grab, by, record, log, wait, up, text, until }) => {
    await load(ROW);
    const p = await grab('a'); await record(); await by(p, [3, 0]); await until(`I.canvas.doc.scene.layout.byId.get('b').box.x0 === 5`, 'it gave way'); await wait(300);
    const L = await log(); assert.ok(L.some(f => f.way === 'b'), 'outlined'); assert.equal(L.some(f => f.tf.b), moves, attrs); assert.equal(L[L.length - 1].box.b, '5,0');
    await up(); await wait(300); assert.deepEqual(pinsOf(await text()), { a: [3, 0], b: [5, 0], far: [0, 9] });
  }, { attrs, reduce: true });
});

// ---------- (b): a new thing from the palette, the thing itself ----------
const REAL = `return { drawn: document.querySelectorAll('.iso-canvas svg.scene [data-id="box-1"]').length > 0, ghost: !!document.querySelector('.pal-ghost'), grid: !!document.querySelector('.iso-canvas .overlay .dgrid'), drop: document.querySelector('.iso-canvas .overlay .drop')?.getAttribute('class') ?? null, at: I.canvas.drag?.move?.at ?? null, text: E.getText() };`;
type Real = { drawn: boolean; ghost: boolean; grid: boolean; drop: string | null; at: [number, number] | null; text: string };
const points = `const r = I.canvas.stage.getBoundingClientRect(); return { x: r.left + r.width * 0.55, y: r.top + r.height * 0.8 };`;

test('the palette (0.14.0): the real thing, on the grid, from the moment it is over the canvas; dropped, pinned where it is; one undo with its name; Esc and leaving take it away', { skip, timeout: 180000 }, async () => {
  await page(async ({ load, take, mouse, up, text, at, undo, esc, wait, ev, until, cell }) => {
    await load(ROW);
    const q = await ev<{ x: number; y: number }>(points);
    await take(0, q);
    let r = await ev<Real>(REAL);
    assert.deepEqual([r.drawn, r.ghost, r.grid, r.drop, r.text === ROW], [true, false, true, 'drop', true]);
    // the same cell step moves it a cell; the pointer is at its floor's middle
    const [dx, dy] = await cell([1, 0]); await mouse('mouseMoved', q.x + dx, q.y + dy); await wait(80);
    const r2 = await ev<Real>(REAL); assert.deepEqual([r2.at![0] - r.at![0], r2.at![1] - r.at![1]], [1, 0]);
    const mid = await ev<{ x: number; y: number }>(`const e = document.querySelector('.iso-canvas .overlay .drop').getBoundingClientRect(); return { x: e.left + e.width / 2, y: e.top + e.height / 2 };`);
    const [cx] = await cell([1, 0]); assert.ok(Math.abs(mid.x - q.x - dx) <= Math.abs(cx) + 1 && Math.abs(mid.y - q.y - dy) <= Math.abs(cx) + 1, `its floor's middle is at the pointer, to the grid: ${mid.x - q.x - dx}, ${mid.y - q.y - dy}`);
    // off the canvas and back: gone, and there again
    const pal = await ev<{ x: number; y: number }>(`const b = document.querySelector('.palette').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 30 };`);
    await mouse('mouseMoved', pal.x, pal.y); await wait(120); r = await ev<Real>(REAL); assert.deepEqual([r.drawn, r.text === ROW], [false, true]); assert.deepEqual(await at(), { a: [0, 0], b: [4, 0], far: [0, 9] });
    await mouse('mouseMoved', q.x, q.y); await wait(120); assert.equal((await ev<Real>(REAL)).drawn, true);
    // Esc: gone, nothing written
    await esc(); await mouse('mouseReleased', q.x, q.y); await wait(300);
    r = await ev<Real>(REAL); assert.deepEqual([r.drawn, r.grid, r.text === ROW], [false, false, true]);
    // dropped: pinned where it was shown, named in place, one undo
    await take(0, q); const shown = (await ev<Real>(REAL)).at!; await up();
    await until(`document.querySelector('.rename-field input')`, 'its name is asked');
    assert.deepEqual(pinsOf(await text()), { a: [0, 0], b: [4, 0], far: [0, 9], 'box-1': shown }); assert.deepEqual((await at())['box-1'], shown);
    await ev(`const i = document.querySelector('.rename-field input'); i.value = 'front'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));`);
    await until(`/\\n  front:/.test(E.getText())`, 'named'); assert.deepEqual(pinsOf(await text()).front, shown); assert.match(await ev<string>(`return I.doc.undoLabel;`), /^Add box front/);
    await undo(ROW, 'the drop and the name, one step');
    // the file still being read as it is dropped (an undo a moment before, mid-drag): what is dropped stays there, and the drawing without it
    // doesn't flash back
    for (const late of [0, 60, 120]) {
      await ev(`I.doc.redo();`); await wait(500); await take(0, q);
      await ev(`window.__gone = 0; window.__rec = true; const id = I.canvas.drag.id, go = () => { if (!window.__rec) return; if (!I.canvas.doc.scene.layout.byId.get(id)) window.__gone++; setTimeout(go, 4); }; go();`);
      await ev(`I.doc.undo();`); await wait(late); await up(); await until(`document.querySelector('.rename-field input')`, 'asked'); await wait(500);
      assert.equal(await ev(`window.__rec = false; return window.__gone;`), 0, 'never gone (' + late + ')');
      await ev(`document.querySelector('.rename-field input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));`); await undo(ROW, 'one step');
    }
  });
});

test('the palette: a taken cell: dropped at once the layout places it (with a note); held, what is there makes way, one undo', { skip, timeout: 180000 }, async () => {
  await page(async ({ load, take, middle, up, text, at, undo, wait, ev, until }) => {
    await load(ROW);
    const named = async () => { await until(`document.querySelector('.rename-field input')`, 'asked'); await ev(`document.querySelector('.rename-field input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));`); await wait(200); };
    const over = async () => { const m = await middle('b'); return { x: m.x, y: m.y }; };
    await take(0, await over()); let r = await ev<Real>(REAL); assert.deepEqual([r.drawn, r.drop], [true, 'drop bad']); await up(); await named();
    let q = pinsOf(await text()); assert.deepEqual(q, { a: [0, 0], b: [4, 0], far: [0, 9] }, 'not pinned, nothing pushed'); assert.match(await ev<string>(`return document.querySelector('#se-note')?.textContent ?? '';`), /taken/);
    { const l = await at(); for (const [a, b] of [['box-1', 'a'], ['box-1', 'b'], ['box-1', 'far']]) assert.ok(Math.abs(l[a][0] - l[b][0]) >= 2 || Math.abs(l[a][1] - l[b][1]) >= 2, 'clear'); }
    await undo(ROW, 'one step');
    await take(0, await over()); await until(`document.querySelector('.iso-canvas .overlay .drop')?.getAttribute('class') === 'drop'`, 'gave way', 6000); r = await ev<Real>(REAL); await up(); await named();
    q = pinsOf(await text()); assert.deepEqual(q['box-1'], r.at); assert.notDeepEqual(q.b, [4, 0]); assert.deepEqual([q.a, q.far], [[0, 0], [0, 9]]);
    const l = await at(); assert.deepEqual([l.b, l['box-1']], [q.b, q['box-1']]); assert.match(await ev<string>(`return I.doc.undoLabel;`), /b made way/);
    await undo(ROW, 'one step');
  });
});

test('the palette: into a container, by the same drag: shown in it, moved inside it, pinned there; where the layout would put it, not pinned; 2D keeps the label', { skip, timeout: 180000 }, async () => {
  const T = `format: boxes/1\ntitle: Drag\nboxes:\n  tray: { kind: tray, size: [12, 8] }\n  one: { in: tray, size: [2, 2, 1] }\n  out: { size: [2, 2, 1] }\n  z: { kind: tray }\n  two: { in: z, size: [1, 1, 1] }\nx-editor:\n  layout:\n    out: { at: [0, 24] }\n`;
  await page(async ({ load, take, up, text, at, undo, wait, ev, until, mouse, cell, esc }) => {
    await load(T);
    const inTray = `const L = I.canvas.doc.scene.layout.byId.get('tray').box, b = { x: L.x0 + 9, y: L.y0 + 5 }; const p = I.canvas.pageXYOf(['boxes', 'tray']); return p;`;
    const named = async () => { await until(`document.querySelector('.rename-field input')`, 'asked'); await ev(`document.querySelector('.rename-field input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));`); await wait(200); };
    const p = await ev<{ x: number; y: number }>(inTray);
    const trayAt = await ev<[number, number]>(`const t = I.canvas.doc.scene.layout.byId.get('tray').box, V = I.canvas.view, k = I.canvas.scale(); return [((t.x0 - t.y0) * ${C} * ${S} - V.x) * k, ((t.x0 + t.y0) * 0.5 * ${S} - t.z0 * ${S} - V.y) * k];`);
    await take(0, p);
    const d = await ev<{ parent: string | undefined; at: [number, number]; bad: boolean; start: [number, number] }>(`const g = I.canvas.drag; return { parent: I.canvas.doc.scene.layout.byId.get('box-1')?.parent?.id, at: g.move.at, bad: g.invalid, start: g.start };`);
    assert.equal(d.parent, 'tray');
    // the thing is drawn on its target, and its container stands where it stood, wherever the layout would have moved it to
    const on = () => ev<{ target: [number, number]; thing: [number, number]; tray: [number, number] }>(`const d = I.canvas.doc.scene.layout, g = I.canvas.drag, V = I.canvas.view, k = I.canvas.scale(), P = (x, y, z) => [(((x - y) * ${C} * ${S} - V.x) * k).toFixed(1), ((((x + y) * 0.5 * ${S}) - z * ${S} - V.y) * k).toFixed(1)].map(Number), b = d.byId.get('box-1').box, t = d.byId.get('tray').box;
      const dx = g.move.at[0] - g.shown[0], dy = g.move.at[1] - g.shown[1], pts = document.querySelector('.iso-canvas .overlay .drop').getAttribute('points').split(' ').map(q => q.split(',').map(Number)); return { target: [(pts[0][0] - V.x) * k, (pts[0][1] - V.y) * k].map(v => Number(v.toFixed(1))), thing: P(b.x0 + dx, b.y0 + dy, b.z0), tray: P(t.x0, t.y0, t.z0) };`);
    const near = (a: [number, number], b: [number, number], why: string) => assert.ok(Math.abs(a[0] - b[0]) < 0.3 && Math.abs(a[1] - b[1]) < 0.3, `${why}: ${a} and ${b}`);
    const o1 = await on(); near(o1.target, o1.thing, 'on its target'); near(o1.tray, trayAt, 'the tray stands still');
    const [dx, dy] = await cell([2, 1]); await mouse('mouseMoved', p.x + dx, p.y + dy); await wait(150);
    const o2 = await on(); near(o2.target, o2.thing, 'on its target, moved'); near(o2.tray, trayAt, 'the tray still stands');
    const e = await ev<{ at: [number, number]; bad: boolean; start: [number, number] }>(`const g = I.canvas.drag; return { at: g.move.at, bad: g.invalid, start: g.start };`);
    assert.equal(e.bad, false, JSON.stringify(e));
    await up(); await named();
    const t = await text(), read = readBoxes(t).read!.data as { boxes: Record<string, { in?: string }> }; assert.equal(read.boxes['box-1'].in, 'tray');
    if (e.at.join() !== e.start.join()) assert.deepEqual(pinsOf(t)['box-1'], e.at);
    { const l = await at(), L = await ev<{ x0: number; y0: number }>(`const b = I.canvas.doc.scene.layout.byId.get('tray').box; return { x0: b.x0, y0: b.y0 };`); assert.deepEqual([l['box-1'][0] - L.x0, l['box-1'][1] - L.y0], e.at, 'where it was shown'); }
    await undo(T, 'one step');
    // into z, which fits what it holds (the layout moves it as it grows): still under the pointer; Esc: the view as it was
    { const zAt = `const t = I.canvas.doc.scene.layout.byId.get('z').box, V = I.canvas.view, k = I.canvas.scale(); return [((t.x0 - t.y0) * ${C} * ${S} - V.x) * k, ((t.x0 + t.y0) * 0.5 * ${S} - t.z0 * ${S} - V.y) * k];`, at0 = await ev<[number, number]>(zAt), v0 = await ev(`return I.canvas.view;`), box0 = await ev<string>(`const t = I.canvas.doc.scene.layout.byId.get('z').box; return [t.x0, t.y0].join();`);
      await take(0, await ev(`return I.canvas.pageXYOf(['boxes', 'z']);`)); assert.equal(await ev(`return I.canvas.doc.scene.layout.byId.get('box-1')?.parent?.id;`), 'z');
      near(await ev(zAt), at0, 'z stands still'); assert.notEqual(await ev<string>(`const t = I.canvas.doc.scene.layout.byId.get('z').box; return [t.x0, t.y0].join();`), box0, 'though the layout moved it');
      const o = await on(); near(o.target, o.thing, 'on its target in z'); await esc(); await wait(250); assert.deepEqual(await ev(`return I.canvas.view;`), v0, 'the view as it was'); await mouse('mouseReleased', 5, 5); await wait(100); assert.equal(await text(), T); }
    // on the place the layout gives it anyway: in the tray, and not pinned
    await take(0, p); const g0 = await ev<{ at: [number, number]; start: [number, number] }>(`const g = I.canvas.drag; return { at: g.move.at, start: g.start };`);
    { const own = g0.start.map(v => Math.ceil(v - 1e-9)); const [x, y] = await cell([own[0] - g0.at[0], own[1] - g0.at[1]]); await mouse('mouseMoved', p.x + x, p.y + y); await wait(150); }
    assert.deepEqual(await ev(`return I.canvas.drag.move.at;`), g0.start.map(v => Math.ceil(v - 1e-9)), 'the cell of its place'); await up(); await named();
    assert.equal((readBoxes(await text()).read!.data as { boxes: Record<string, { in?: string }> }).boxes['box-1'].in, 'tray'); assert.equal(pinsOf(await text())['box-1'], undefined); await undo(T, 'one step');
    // 2D: the label, as before
    await ev(`document.querySelector('.view-seg [data-v="2d"]').click();`); await until(`I.canvas.mode === '2d' && document.querySelectorAll('.iso-canvas svg.scene').length === 1 && !document.querySelector('.dual-morph')`, '2D');
    const q = await ev<{ x: number; y: number }>(points); await take(0, q); assert.deepEqual((({ drawn, ghost }) => [drawn, ghost])(await ev<Real>(REAL)), [false, true]); await up(); await named(); assert.match(await text(), /\n  box-1:/); await undo(T, 'one step');
  });
});

// ---------- (a): the palette's entries as what they make ----------
test('the palette\'s look (0.14.0): the thing itself, small, in the theme; an entry that can\'t be drawn alone keeps its icon; icons by default', { skip, timeout: 120000 }, async () => {
  const look = `return [...document.querySelectorAll('.palette .pal-item')].map(b => ({ name: b.textContent.trim(), look: b.dataset.look ?? null, icon: !!b.querySelector(':scope > .icon'), solid: [...b.querySelectorAll('.pal-scene polygon, .pal-scene path')].filter(e => { const r = e.getBoundingClientRect(), o = b.getBoundingClientRect(); return r.width > 2 && r.left >= o.left - 1 && r.right <= o.right + 1 && r.top >= o.top - 1 && r.bottom <= o.bottom + 1; }).length, words: b.querySelectorAll('.pal-scene text').length, stops: b.querySelectorAll('.pal-scene [tabindex], .pal-scene [role]').length, hidden: b.querySelector('.pal-scene')?.getAttribute('aria-hidden') ?? null, fill: (e => e && getComputedStyle(e).fill)(b.querySelector('.pal-scene polygon')) }));`;
  type Look = { name: string; look: string | null; icon: boolean; solid: number; words: number; stops: number; hidden: string | null; fill: string };
  await page(async ({ ev, until, load, take, up, text, undo, wait }) => {
    await until(`document.querySelectorAll('.palette .pal-item').length && !document.querySelector('.palette .pal-item:not([data-look])')`, 'the looks are drawn');
    const L = await ev<Look[]>(look);
    assert.deepEqual(L.map(x => [x.name, x.look, x.icon, x.words, x.stops, x.hidden]), ['Box', 'Tray', 'Zone'].map(n => [n, 'object', false, 0, 0, 'true']));
    assert.ok(L.every(x => x.solid > 0), JSON.stringify(L)); assert.equal(new Set(L.map(x => x.solid + x.fill)).size, 3, 'each its own');
    await ev(`document.querySelector('#se-theme [data-v="dark"]')?.click(); document.documentElement.style.colorScheme = 'dark';`); await wait(200);
    // it still adds, by Enter and by a drag
    await load(ROW); await take(0, await ev(points)); assert.equal((await ev<Real>(REAL)).drawn, true); await up(); await until(`/\\n  box-1:/.test(E.getText())`, 'added'); await ev(`document.querySelector('.rename-field input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));`); await undo(ROW, 'one step');
    assert.equal(await text(), ROW);
  }, { attrs: 'data-looks' });
  await page(async ({ ev, wait }) => { await wait(300); const L = await ev<Look[]>(look); assert.deepEqual(L.map(x => [x.look, x.icon, x.solid]), [[null, true, 0], [null, true, 0], [null, true, 0]]); });
});

test('the palette: released as it crosses from a container onto the canvas: drawn where it was dropped from the first frame on (motion on and reduced)', { skip, timeout: 180000 }, async () => {
  for (const reduce of [false, true]) await page(async ({ mouse, ev, until, wait }) => {
    // the page's own file (two trays, a zone). The thing itself: its label may take another side once it is laid out where it was dropped
    const T = await ev<string>(`return E.getText();`);
    for (let n = 0; n < 3; n++) {
      const [x0, y0, x1, y1] = await ev<number[]>(`const b = document.querySelector('.palette .pal-item[data-entry="0"]').getBoundingClientRect(), s = I.canvas.stage.getBoundingClientRect(); return [b.left + 8, b.top + 8, s.left + s.width * 0.7, s.top + s.height * 0.9];`);
      await ev(`window.__w = []; window.__rec = false; addEventListener('pointerup', () => { window.__rec = true; const go = () => { if (!window.__rec) return; const rs = [...document.querySelectorAll('.iso-canvas svg.scene .g-blocks [data-id="box-1"]')].map(e => e.getBoundingClientRect()).filter(r => r.width); if (rs.length) window.__w.push([(Math.min(...rs.map(r => r.left)) + Math.max(...rs.map(r => r.right))) / 2, Math.min(...rs.map(r => r.top))].map(Math.round).join()); requestAnimationFrame(go); }; setTimeout(go, 0); }, { once: true });`);
      // in six steps, over the zone, the last onto the canvas and released with it
      await mouse('mouseMoved', x0, y0); await mouse('mousePressed', x0, y0); for (let i = 1; i <= 6; i++) await mouse('mouseMoved', x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6); await mouse('mouseReleased', x1, y1);
      await until(`document.querySelector('.rename-field input')`, 'asked'); await wait(600);
      const w = await ev<string[]>(`window.__rec = false; return window.__w;`); assert.ok(w.length > 5);
      const last = w[w.length - 1].split(',').map(Number); for (const q of w) { const [x, y] = q.split(',').map(Number); assert.ok(Math.abs(x - last[0]) < 2 && Math.abs(y - last[1]) < 2, `${reduce ? 'reduced' : 'motion'}: ${[...new Set(w)].join(' ; ')}`); }
      await ev(`document.querySelector('.rename-field input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); I.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));`); await until(`E.getText() === ${JSON.stringify(T)}`, 'undone'); await wait(400);
    }
  }, { reduce });
});
