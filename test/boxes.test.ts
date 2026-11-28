// boxes/1 (R1 S8, docs/editor/LAYERS.md §6.3): the editor runs on a neutral format through L0–L3's public API alone.
//   - Node: the reader, the drawing with pins, references that follow a rename, a still with Live marks; boxes.ts
//     imports only L0–L3's public modules, and the page's bundle has no input from P or L4;
//   - Chrome: the editor mounted on it (L3's plain skin, no Monaco): it draws; a rename in the tree (the tree's own
//     field) renames the references too; ⌘Z undoes it; a pin dragged on the canvas is written to x-editor.layout;
//     Live marks from a fake state; no errors, no CSP violations. Skipped without Chrome.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, sep, dirname, relative } from 'node:path';
import { bundlePage, drivePage } from './adapters/page-driver.ts';
import { readBoxes, drawBoxes, boxesStill, boxesAdapter } from './adapters/boxes.ts';
import { commandsFor } from '../src/iso-editor/commands.ts';
import { applyStep } from '../src/iso-editor/splice.ts';
import { LAYERS, layerOf, publicOf, importsOf, ROOT } from '../scripts/layers.ts';
// @ts-ignore plain JS helper
import { chromePath } from '../scripts/chrome.mjs';
import { connectionsOf, nearestOn } from '../src/iso-editor/connections.ts';

let chrome: string | undefined;
try { chrome = chromePath(); } catch { chrome = undefined; }
const THEME = readFileSync(new URL('../themes/default.yaml', import.meta.url), 'utf8');
const TEXT = readFileSync(new URL('./fixtures/boxes/two-trays.yaml', import.meta.url), 'utf8');
const run = (text: string, c: { build(t: string): { steps: Parameters<typeof applyStep>[1][] } }) => c.build(text).steps.reduce((t, s) => applyStep(t, s), text);

test('boxes/1 reads, draws (pins applied), and keeps its references through a rename and a delete', () => {
  const r = readBoxes(TEXT);
  assert.deepEqual(r.diags, []);
  const pinned = TEXT + 'x-editor:\n  layout:\n    c: { at: [3, 1] }\n';
  const rp = readBoxes(pinned).read!;
  const d = drawBoxes(rp, rp.data, THEME);
  assert.deepEqual(d.diags, []);
  for (const id of ['shelf', 'floor', 'a', 'b', 'c', 'link-0', 'link-1']) assert.match(d.svg, new RegExp(`data-id="${id}"`), id);
  assert.equal(d.pathOf.get('link-1'), '/links/1');
  const c = d.scene.layout.byId.get('c')!, floor = d.scene.layout.byId.get('floor')!;
  assert.deepEqual([c.box.x0 - floor.box.x0, c.box.y0 - floor.box.y0], [3, 1], 'the pin is in its parent\'s frame');
  const C = commandsFor(boxesAdapter);
  const renamed = run(TEXT, C.renameCmd(['boxes', 'a'], 'alpha'));
  assert.match(renamed, /^  alpha: \{ in: shelf/m);
  assert.match(renamed, /from: alpha, to: b/);
  // (0.12.5) its pin follows the name, so it stays where it was put; a pin of the new name's already there is left alone
  const withPin = TEXT + '\nx-editor:\n  layout:\n    a: { at: [5, 6] }\n';
  assert.match(run(withPin, C.renameCmd(['boxes', 'a'], 'alpha')), /layout:\n    alpha: \{ at: \[5, 6\] \}\n$/);
  const taken = run(withPin + '    alpha: { at: [1, 1] }\n', C.renameCmd(['boxes', 'a'], 'alpha'));
  assert.match(taken, /    a: \{ at: \[5, 6\] \}\n    alpha: \{ at: \[1, 1\] \}\n$/); assert.deepEqual(readBoxes(taken).diags, []);
  assert.deepEqual(readBoxes(renamed).diags, []);
  const gone = run(TEXT, C.deleteCmd(['boxes', 'c'], { withRefs: true }));
  assert.doesNotMatch(gone, /\bc:|to: c/);
  assert.deepEqual(readBoxes(gone).diags, [], 'the link to it went with it');
  assert.match(readBoxes(TEXT.replace('in: floor', 'in: nowhere')).diags[0].path, /^\/boxes\/c\/in$/);
});

test('a still of boxes/1, with Live marks, made in Node', () => {
  const svg = boxesStill(TEXT, THEME, { a: 'on', c: 'off' });
  assert.match(svg, /^<svg/);
  assert.equal((svg.match(/class="live-badge box-on/g) ?? []).length, 1);
  assert.equal((svg.match(/class="live-badge box-off/g) ?? []).length, 1);
  assert.match(svg, /id="st-ah-boxes-send"/, 'the drawing\'s own ids are prefixed, as a still\'s are');
  assert.match(svg, /<g class="overlay boxes-live">[\s\S]*<\/g><\/svg>$/, 'the marks are inside the svg, last');
});

const PAGE = 'test/adapters/boxes-page.ts';
let bundle: ReturnType<typeof bundlePage> | undefined;
const bundled = () => (bundle ??= bundlePage(PAGE));

test('boxes/1 uses only L0–L3\'s public modules: none of P\'s, none of L4\'s', async () => {
  const generic = LAYERS.filter(l => l.rank <= 3 && l.dir !== 'src/iso-systems');
  // publicOf names a layer's modules from its folder
  const pub = new Set(generic.flatMap(l => [...publicOf(l)].map(m => `${l.dir}/${m}`)));
  for (const f of ['test/adapters/boxes.ts', PAGE]) {
    for (const spec of importsOf(readFileSync(join(ROOT, f), 'utf8'))) {
      if (!spec.startsWith('.')) continue;
      const target = relative(ROOT, resolve(ROOT, dirname(f), spec)).split(sep).join('/');
      if (!target.startsWith('src/')) continue;
      const l = layerOf(target);
      assert.ok(l && generic.includes(l), `${f} imports ${target}: not L0–L3`);
      assert.ok(pub.has(target), `${f} imports ${target}: not public in ${l!.name}`);
    }
  }
  const inputs = Object.keys((await bundled()).metafile!.inputs);
  assert.deepEqual(inputs.filter(i => i.startsWith('src/iso-systems/')), []);
  assert.ok(inputs.some(i => i.startsWith('src/iso-editor/ui/mount.ts')), 'the editor is in it');
});

test('boxes/1 in Chrome: it draws, a rename in the tree, undo, a pin dragged, Live marks', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');

    const drawn = await ev<{ rows: string[]; ids: string[] }>(`return { rows: [...document.querySelectorAll('.trow')].map(r => r.dataset.id), ids: [...new Set([...document.querySelectorAll('.iso-canvas svg.scene [data-id]')].map(e => e.dataset.id))] };`);
    for (const p of ['/boxes/a', '/boxes/shelf', '/links']) assert.ok(drawn.rows.includes(p), `the tree has ${p}: ${drawn.rows}`);
    for (const x of ['a', 'b', 'c', 'shelf', 'floor', 'link-0']) assert.ok(drawn.ids.includes(x), `drawn: ${x}`);

    // a rename in the tree's own field: the box, and every link that names it
    await ev(`const row = document.querySelector('.trow[data-id="/boxes/a"]'); row.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick();
      document.querySelector('#se-outline').dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true })); await tick();
      const inp = document.querySelector('input.tedit.tname'); inp.value = 'alpha'; inp.dispatchEvent(new Event('input')); inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
    await until(`E.getText().includes('alpha:')`, 'the rename');
    const after = await ev<string>(`return E.getText();`);
    assert.match(after, /from: alpha, to: b/);
    await until(`document.querySelector('.iso-canvas svg.scene [data-id="alpha"]')`, 'the renamed box drawn');

    // ⌘Z: one undo step takes it all back
    await ev(`I.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));`);
    await until(`E.getText() === ${JSON.stringify(TEXT)}`, 'the undo');

    // a pin: the floor zone dragged on the canvas (pressed where it is the floor under the pointer, not c on it), written to x-editor.layout
    await until(`I.canvas.pageXYOf(['boxes', 'floor'])`, 'the floor on the stage');
    const moved = await ev<boolean>(`const c = I.canvas, mid = c.pageXYOf(['boxes', 'floor']);
      let at; for (let dy = -60; dy <= 60 && !at; dy += 4) for (let dx = -90; dx <= 90 && !at; dx += 4) { const e = document.elementFromPoint(mid.x + dx, mid.y + dy); if (e?.closest('[data-id]')?.dataset.id === 'floor') at = { x: mid.x + dx, y: mid.y + dy, e }; }
      if (!at) return false;
      // pressed on the floor; then to the stage, which a real pointer is captured by (the drag redraws the drawing it pressed)
      const P = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 3 }));
      P(at.e, 'pointerdown', at.x, at.y); for (let i = 1; i <= 8; i++) { P(c.stage, 'pointermove', at.x + i * 12, at.y + i * 6); await tick(40); } P(c.stage, 'pointerup', at.x + 96, at.y + 48); return true;`);
    assert.ok(moved, 'a point on the floor, not on c');
    await until(`/x-editor:\\n  layout:\\n    floor: \\{ at: \\[/.test(E.getText())`, 'the pin written');

    // Live marks: a fake source says a is on, b is off
    await ev(`I.canvas.setState({ a: 'on', b: 'off' });`);
    await until(`document.querySelectorAll('.iso-canvas .boxes-live .live-badge').length === 2`, 'two marks');
    const marks = await ev<string[]>(`return [...document.querySelectorAll('.iso-canvas .boxes-live .live-badge title')].map(t => t.textContent);`);
    assert.deepEqual(marks.sort(), ['a is on', 'b is off']);

    // L3's own icons (0.5.2): every icon the editor shows resolves to a symbol in its root (setupFor's sprite)
    const icons = await ev<{ uses: number; dangling: string[] }>(`const root = document.querySelector('.' + ${JSON.stringify('iso-editor')}); const hrefs = [...root.querySelectorAll('use')].map(u => u.getAttribute('href'));
      return { uses: hrefs.length, dangling: [...new Set(hrefs.filter(h => !root.querySelector(h)))] };`);
    assert.ok(icons.uses >= 5, `${icons.uses} icons shown`);
    assert.deepEqual(icons.dangling, [], 'every icon shown has its symbol');

    const bad = await ev<{ violations: string[]; errors: string[] }>(`return { violations: B.violations, errors: B.errors };`);
    assert.deepEqual(bad, { violations: [], errors: [] });
  });
});

test('boxes/1 in 2D (0.6.0): the switch, select on the canvas, rename and undo, no pins, a marquee, the palette, delete', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');
    // the switch: 3D | 2D in the canvas's toolbar
    assert.deepEqual(await ev<(string | null)[]>(`return [...document.querySelectorAll('.view-seg .seg')].map(b => b.getAttribute('aria-pressed'));`), ['true', 'false']);
    await ev(`document.querySelector('.view-seg [data-v="2d"]').click();`);
    await until(`I.canvas.mode === '2d' && document.querySelectorAll('.iso-canvas svg.scene').length === 1 && !document.querySelector('.dual-morph') && document.querySelector('.iso-canvas svg.scene.flat [data-id="a"]')`, 'the 2D view');
    const drawn = await ev<{ ids: string[]; conns: string[]; pressed: (string | null)[]; tab: number; full: unknown }>(`const s = document.querySelector('.iso-canvas svg.scene');
      return { ids: [...s.querySelectorAll('g[data-id]')].map(e => e.dataset.id).sort(), conns: [...s.querySelectorAll('path.conn')].map(e => e.dataset.id + ':' + e.dataset.a + '>' + e.dataset.b),
        pressed: [...document.querySelectorAll('.view-seg .seg')].map(b => b.getAttribute('aria-pressed')), tab: s.querySelectorAll('[tabindex]').length, full: I.canvas.flat.bounds };`);
    assert.deepEqual(drawn.ids, ['a', 'b', 'c', 'floor', 'shelf']);
    assert.deepEqual(drawn.conns, ['link-0:a>b', 'link-1:b>c']);
    assert.deepEqual(drawn.pressed, ['false', 'true']);
    assert.equal(drawn.tab, 0, 'the stage takes the keys; the cards are no tab stops');

    // a press on a card selects it: the tree shows it, the overlay rings its rect
    const P = (sel: string, type: string, dx: number | string = 0, dy: number | string = 0) => `{ const el = document.querySelector('.iso-canvas svg.scene ${sel}'); const r = el.getBoundingClientRect(); const x = r.left + r.width / 2 + ${dx}, y = r.top + r.height / 2 + ${dy};
      (${type === 'pointerdown' ? 'el' : 'I.canvas.stage'}).dispatchEvent(new PointerEvent('${type}', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 5 })); }`;
    await ev(`${P('[data-id="a"] rect', 'pointerdown')} ${P('[data-id="a"] rect', 'pointerup')} await tick();`);
    await until(`document.querySelector('.trow[data-id="/boxes/a"]')?.getAttribute('aria-selected') === 'true'`, 'selected in the tree');
    assert.equal(await ev<number>(`return document.querySelectorAll('.iso-canvas svg.scene .overlay polygon.ring').length;`), 1, 'its ring');

    // F2 on the canvas renames it, references and all; ⌘Z takes it back
    await ev(`I.canvas.stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true })); await tick();
      const inp = document.querySelector('.rename-field input'); inp.value = 'alpha'; inp.dispatchEvent(new Event('input')); await tick(); inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));`);
    await until(`/from: alpha, to: b/.test(E.getText())`, 'the rename');
    await until(`I.canvas.mode === '2d' && document.querySelector('.iso-canvas svg.scene.flat [data-id="alpha"]')`, 'redrawn in 2D');
    await ev(`I.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));`);
    await until(`E.getText() === ${JSON.stringify(TEXT)}`, 'the undo');
    await until(`document.querySelector('.iso-canvas svg.scene.flat [data-id="a"]')`, 'redrawn');

    // a drag on a card moves nothing in 2D (moving is 3D's): no pin, and a hint
    await ev(`${P('[data-id="b"] rect', 'pointerdown')} for (let i = 1; i <= 6; i++) { ${P('[data-id="b"] rect', 'pointermove', 'i * 15', 'i * 8')} await tick(30); } ${P('[data-id="b"] rect', 'pointerup', 90, 48)} await tick(200);`);
    assert.doesNotMatch(await ev<string>(`return E.getText();`), /x-editor/);
    assert.match(await ev<string>(`return document.querySelector('#se-st-hint')?.textContent ?? '';`), /Moving is in 3D/);

    // a marquee (⇧-drag from nothing) round the shelf selects it and its two boxes (a press on a panel selects it)
    const pick = await ev<string[]>(`I.doc.select([], 'canvas'); const s = document.querySelector('.iso-canvas svg.scene'), r = s.querySelector('[data-id="shelf"] rect').getBoundingClientRect();
      const x0 = r.left - 8, y0 = r.top - 8, x1 = r.right + 8, y1 = r.bottom + 8;
      const at = document.elementFromPoint(x0, y0);
      const ev2 = (t, x, y, el = I.canvas.stage) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 6, shiftKey: true }));
      ev2('pointerdown', x0, y0, at); for (let i = 1; i <= 5; i++) { ev2('pointermove', x0 + (x1 - x0) * i / 5, y0 + (y1 - y0) * i / 5); await tick(20); } ev2('pointerup', x1, y1);
      await tick(); return [at.closest('[data-id]')?.dataset.id ?? 'nothing', ...I.doc.selection.map(p => p.join('/')).sort()];`);
    assert.deepEqual(pick, ['nothing', 'boxes/a', 'boxes/b', 'boxes/shelf']);

    // Delete removes them (and the links naming them); ⌘Z brings them back
    await ev(`I.doc.select([['boxes', 'a'], ['boxes', 'b']], 'canvas'); I.canvas.stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); await tick(); document.querySelector('dialog.dlg button[value="with"]').click();`);
    await until(`!/\\ba:/.test(E.getText())`, 'deleted');
    await ev(`I.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));`);
    await until(`E.getText() === ${JSON.stringify(TEXT)}`, 'the undo');

    // the palette: a drop on the 2D canvas adds it, placed by the layout (a pin is 3D's), and asks for its name
    const added = await ev<{ path: string; text: string }>(`const sec = document.querySelector('.palette .pal-item').dataset.section, r = I.canvas.stage.getBoundingClientRect();
      const p = I.canvas.addFromPalette(sec, { x: r.left + r.width - 30, y: r.top + r.height - 30 }); await tick();
      document.querySelector('.rename-field input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await tick();
      return { path: p.join('/'), text: E.getText() };`);
    assert.match(added.path, /^boxes\//);
    assert.ok(added.text.includes(`  ${added.path.split('/')[1]}:`), 'the new box is in the file');
    assert.doesNotMatch(added.text, /x-editor/, 'not pinned');
    const nm = added.path.split('/')[1];
    await until(`document.querySelector('.iso-canvas svg.scene.flat [data-id="${nm}"]')`, 'drawn in 2D');
    await ev(`I.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));`);
    await until(`E.getText() === ${JSON.stringify(TEXT)}`, 'the undo');

    // back to 3D: the drawing as it was, the selection kept
    await ev(`I.doc.select([['boxes', 'c']], 'tree'); document.querySelector('.view-seg [data-v="3d"]').click();`);
    await until(`I.canvas.mode === '3d' && !document.querySelector('.iso-canvas svg.scene.flat') && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, '3D again');
    assert.equal(await ev<number>(`return document.querySelectorAll('.iso-canvas svg.scene .overlay polygon.ring').length;`), 1, 'c still ringed');

    const bad = await ev<{ violations: string[]; errors: string[] }>(`return { violations: B.violations, errors: B.errors };`);
    assert.deepEqual(bad, { violations: [], errors: [] });
  });
});

test('delete with references (0.7.1): list entries go last first however the adapter maps a reference to them, each once', () => {
  const C = commandsFor(boxesAdapter);
  // b is named by both links: /links/0/to and /links/1/from, which boxes/1 maps to the entries /links/0 and /links/1
  const gone = run(TEXT, C.deleteCmd(['boxes', 'b'], { withRefs: true }));
  assert.doesNotMatch(gone, /\bb:|from: b|to: b|from: a, to: b/);
  assert.deepEqual(readBoxes(gone).diags, [], 'no reference left dangling, and the wrong entry not taken');
  // a link from b to b: two references, one entry
  const self = TEXT.replace('links:\n', 'links:\n  - { from: b, to: b }\n');
  const gone2 = run(self, C.deleteCmd(['boxes', 'b'], { withRefs: true }));
  assert.deepEqual(readBoxes(gone2).diags, []);
  assert.doesNotMatch(gone2, /- \{/, 'all three links named b');
});

test('scope (0.7.1): the state root reads the same with its dot (as the root is given) or without', async () => {
  const { scope } = await import('../src/iso-viewer/view-css.ts');
  const css = ':root[data-theme="dark"]{--bg:#000} :root{--bg:#fff} .a{color:red}';
  const dotted = scope(css, '.iso-canvas', '.iso-editor'), bare = scope(css, '.iso-canvas', 'iso-editor');
  assert.equal(dotted, bare);
  assert.match(dotted, /^\.iso-editor\[data-theme="dark"\] \.iso-canvas\{--bg:#000\}/m);
  assert.doesNotMatch(dotted, /\.\./, 'no "..": the boxes page gives the state root with its dot');
});

// 0.10.0: the palette's presets, connecting two objects (by the handle's drag, or "Connect to…" then a click), and
// grouping the selection, each by the adapter's plan, each one undo step; and none of it where the adapter says nothing.
test('boxes/1 in Chrome (0.10.0): palette presets, connect by drag and by the menu, Esc cancels, group in one step', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');
    const parsed = (t: string) => readBoxes(t).read!.data as { boxes: Record<string, Record<string, unknown>>; links: { from: string; to: string }[] };
    const undoAll = async () => { await ev(`I.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));`); await until(`E.getText() === ${JSON.stringify(TEXT)}`, 'one undo, all of it'); };

    // the palette: its presets, in order; Enter on "Zone" adds a zone as the preset says
    assert.deepEqual(await ev<string[]>(`return [...document.querySelectorAll('.palette .pal-item')].map(b => b.dataset.entry + ':' + b.textContent.trim());`), ['0:Box', '1:Tray', '2:Zone']);
    // (0.11.0) entries without a section are as before: the palette's own children, no header, no group
    assert.deepEqual(await ev(`const p = document.querySelector('.palette'); return { kids: [...p.children].map(c => c.className), heads: p.querySelectorAll('.pal-head, .pal-section, .pal-body').length };`), { kids: ['pal-item', 'pal-item', 'pal-item'], heads: 0 });
    await ev(`document.querySelector('.palette .pal-item[data-entry="2"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick();
      document.querySelector('.rename-field input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await tick();`);
    await until(`/\\n  zone-1:/.test(E.getText())`, 'the zone added');
    assert.deepEqual(parsed(await ev<string>(`return E.getText();`)).boxes['zone-1'], { kind: 'zone', label: 'Zone' }, 'named from the preset, as the preset says');
    await until(`document.querySelector('.iso-canvas svg.scene [data-id="zone-1"]')`, 'drawn');
    await undoAll();

    // the handle: on the one selected object
    await ev(`I.doc.select([['boxes', 'c']], 'canvas');`);
    await until(`document.querySelector('.iso-canvas svg.scene .overlay .connect-handle')`, 'the handle on c');
    assert.equal(await ev<string>(`return getComputedStyle(document.querySelector('.overlay .connect-handle')).pointerEvents;`), 'all', 'it takes the pointer');
    // dragged from c to a: a line while it goes, solid once it is over a; on release, the link, selected
    const P = `const P = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 9 }));
      const h = document.querySelector('.overlay .connect-handle').getBoundingClientRect(), hx = h.left + h.width / 2, hy = h.top + h.height / 2;
      const a = I.canvas.pageXYOf(['boxes', 'a']);`;
    const mid = await ev<{ line: boolean; ok: boolean }>(`${P}
      P(document.querySelector('.overlay .connect-handle'), 'pointerdown', hx, hy);
      for (let i = 1; i <= 6; i++) { P(I.canvas.stage, 'pointermove', hx + (a.x - hx) * i / 6, hy + (a.y - hy) * i / 6); await tick(30); }
      return { line: !!document.querySelector('.overlay .connect-line'), ok: !!document.querySelector('.overlay .connect-line.ok') };`);
    assert.deepEqual(mid, { line: true, ok: true });
    await ev(`const a = I.canvas.pageXYOf(['boxes', 'a']); I.canvas.stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: a.x, clientY: a.y, button: 0, pointerId: 9 }));`);
    await until(`/from: c, to: a/.test(E.getText())`, 'the link written');
    assert.deepEqual(parsed(await ev<string>(`return E.getText();`)).links.at(-1), { from: 'c', to: 'a' });
    assert.deepEqual(await ev<string[]>(`return I.doc.selection.map(p => p.join('/'));`), ['links/2'], 'the new link selected');
    await until(`document.querySelector('.iso-canvas svg.scene [data-id="link-2"]')`, 'drawn');
    assert.equal(await ev(`return !!document.querySelector('.overlay .connect-line');`), false, 'the line gone');
    await undoAll();

    // Esc mid-drag: nothing written, the line gone
    await ev(`I.doc.select([['boxes', 'c']], 'canvas'); await tick(); ${P}
      P(document.querySelector('.overlay .connect-handle'), 'pointerdown', hx, hy); P(I.canvas.stage, 'pointermove', a.x, a.y); await tick(30);
      I.canvas.stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick();
      P(I.canvas.stage, 'pointerup', a.x, a.y); await tick(100);`);
    assert.equal(await ev<string>(`return E.getText();`), TEXT, 'nothing written');
    assert.equal(await ev(`return I.canvas.linking === undefined && !document.querySelector('.overlay .connect-line');`), true);

    // the menu: Connect to… and Group, for one object
    const items = await ev<string[]>(`I.doc.select([['boxes', 'b']], 'canvas'); await tick();
      I.canvas.stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true })); await tick();
      const labels = [...document.querySelectorAll('.menu .menu-item .mi-label')].map(e => e.textContent);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.querySelector('.menu')?.remove(); return labels;`);
    assert.ok(items.includes('Connect to…') && items.includes('Group'), `the menu: ${items}`);
    // "Connect to…", then a click: b to c is refused (b → c is there already), b to a is written
    const clickOn = (name: string) => `{ const at = I.canvas.pageXYOf(['boxes', '${name}']); const el = document.elementFromPoint(at.x, at.y); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 0, pointerId: 10 })); await tick(); }`;
    await ev(`I.canvas.startPick(); await tick(); ${clickOn('c')}`);
    assert.equal(await ev<string>(`return E.getText();`), TEXT, 'refused: they are linked already');
    assert.match(await ev<string>(`return document.querySelector('#se-note')?.textContent ?? '';`), /b and c can't be connected/);
    await ev(`I.doc.select([['boxes', 'b']], 'canvas'); await tick(); I.canvas.startPick(); await tick(); ${clickOn('a')}`);
    await until(`/from: b, to: a/.test(E.getText())`, 'b to a written');
    await undoAll();

    // ⌘G: a and b into a new zone in the shelf, each now in it; one undo takes it all back
    await ev(`I.doc.select([['boxes', 'a'], ['boxes', 'b']], 'canvas'); await tick(); I.canvas.stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', metaKey: true, bubbles: true }));`);
    await until(`/\\n  group-1:/.test(E.getText())`, 'grouped');
    const g = parsed(await ev<string>(`return E.getText();`)).boxes;
    assert.deepEqual(g['group-1'], { kind: 'zone', label: 'Group', in: 'shelf' });
    assert.equal(g.a.in, 'group-1'); assert.equal(g.b.in, 'group-1');
    assert.deepEqual(readBoxes(await ev<string>(`return E.getText();`)).diags, [], 'it reads cleanly');
    assert.deepEqual(await ev<string[]>(`return I.doc.selection.map(p => p.join('/'));`), ['boxes/group-1']);
    await until(`document.querySelector('.iso-canvas svg.scene [data-id="group-1"]')`, 'the group drawn');
    await undoAll();

    const bad = await ev<{ violations: string[]; errors: string[] }>(`return { violations: B.violations, errors: B.errors };`);
    assert.deepEqual(bad, { violations: [], errors: [] });
  });
  // the same format without connect, group or presets: no handle, no menu items, one palette entry per kind
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');
    assert.deepEqual(await ev<string[]>(`return [...document.querySelectorAll('.palette .pal-item')].map(b => b.textContent.trim());`), ['Box']);
    await ev(`I.doc.select([['boxes', 'c']], 'canvas'); await tick(200);`);
    assert.equal(await ev(`return document.querySelectorAll('.overlay .connect-handle').length;`), 0, 'no handle');
    const items = await ev<string[]>(`I.canvas.stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true })); await tick();
      return [...document.querySelectorAll('.menu .menu-item .mi-label')].map(e => e.textContent);`);
    assert.ok(!items.includes('Connect to…') && !items.some(l => l.startsWith('Group')), `no connect, no group: ${items}`);
    await ev(`document.querySelector('.menu')?.remove(); I.canvas.stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', metaKey: true, bubbles: true })); await tick();`);
    assert.equal(await ev<string>(`return E.getText();`), TEXT, '⌘G does nothing');
  }, '1280,860', { html: '<!doctype html><html><head><meta charset="utf-8"><title>page</title></head><body data-bare style="margin:0"><div id="app" style="height:100vh"></div><script type="module" src="page.js"></script></body></html>' });
});

// 0.10.1: a palette drop onto a container puts the new thing inside it (the adapter's dropInto), the innermost that
// holds it: onto the floor zone, in it; onto box c (which holds nothing), in c's zone. One undo each. In 2D, the same.
test('boxes/1 in Chrome (0.10.1): a palette drop onto a container nests the new box, innermost first, one undo', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');
    const parsed = (t: string) => readBoxes(t).read!.data as { boxes: Record<string, Record<string, unknown>> };
    const undo = async () => { await ev(`I.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));`); await until(`E.getText() === ${JSON.stringify(TEXT)}`, 'one undo'); };
    // a point on the floor zone, clear of c: found by asking the page what is under each point near its middle
    const onFloor = `const mid = I.canvas.pageXYOf(['boxes', 'floor']); let at;
      for (let dy = -60; dy <= 60 && !at; dy += 4) for (let dx = -90; dx <= 90 && !at; dx += 4) { const e = document.elementFromPoint(mid.x + dx, mid.y + dy); if (e?.closest('[data-id]')?.dataset.id === 'floor') at = { x: mid.x + dx, y: mid.y + dy }; }`;
    // the "Box" preset, by its button's entry: the palette items carry it; the API takes it as the third argument
    const dropBox = (where: string) => `${where}; const btn = document.querySelector('.palette .pal-item[data-entry="0"]');
      const r0 = btn.getBoundingClientRect(), P = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 11 }));
      P(btn, 'pointerdown', r0.left + 5, r0.top + 5); for (let i = 1; i <= 6; i++) { P(btn, 'pointermove', r0.left + 5 + (at.x - r0.left - 5) * i / 6, r0.top + 5 + (at.y - r0.top - 5) * i / 6); await tick(20); }
      const shelf = () => { const b = document.querySelector('.iso-canvas svg.scene.flat [data-id="shelf"] rect')?.getBoundingClientRect(); return b && [b.left, b.top, b.right, b.bottom].map(Math.round); };
      B.saw = { at, was: B.was, now: shelf(), mode: I.canvas.mode, zoom: I.canvas.zoom, scenes: document.querySelectorAll('.iso-canvas svg.scene').length, under: document.elementsFromPoint(at.x, at.y).slice(0, 5).map(e => e.tagName + '.' + (e.getAttribute('class') ?? '') + '#' + (e.closest('[data-id]')?.dataset.id ?? '')), drawn: [...new Set([...document.querySelectorAll('.iso-canvas svg.scene [data-id]')].map(e => e.dataset.id))] };
      P(btn, 'pointerup', at.x, at.y); await tick(); document.querySelector('.rename-field input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await tick();`;
    // onto the floor zone: in it, and not pinned
    await ev(dropBox(onFloor));
    await until(`/\\n  box-1:/.test(E.getText())`, 'added');
    const b1 = parsed(await ev<string>(`return E.getText();`)).boxes['box-1'];
    assert.deepEqual(b1, { size: [2, 2, 1], in: 'floor' });
    assert.doesNotMatch(await ev<string>(`return E.getText();`), /x-editor/, 'placed by the layout, not pinned');
    await until(`document.querySelector('.iso-canvas svg.scene [data-id="box-1"]')`, 'drawn');
    await undo();
    // onto box c: c holds nothing, so the innermost that does: c's zone
    await ev(dropBox(`const at = I.canvas.pageXYOf(['boxes', 'c'])`));
    await until(`/\\n  box-1:/.test(E.getText())`, 'added');
    assert.equal(parsed(await ev<string>(`return E.getText();`)).boxes['box-1'].in, 'floor');
    await undo();
    // in 2D: onto the shelf's panel, in the shelf
    await ev(`document.querySelector('.view-seg [data-v="2d"]').click();`);
    await until(`I.canvas.mode === '2d' && document.querySelectorAll('.iso-canvas svg.scene').length === 1 && !document.querySelector('.dual-morph') && document.querySelector('.iso-canvas svg.scene.flat [data-id="shelf"]')`, 'the 2D view');
    await ev(dropBox(`const r = document.querySelector('.iso-canvas svg.scene.flat [data-id="shelf"] rect').getBoundingClientRect(); B.was = [r.left, r.top, r.right, r.bottom].map(Math.round); const at = { x: r.left + 6, y: r.bottom - 6 }`));
    await until(`/\\n  box-1:/.test(E.getText())`, 'added in 2D');
    // (it has landed outside on a slow machine, and not on any of ours: what it saw then, in the message)
    const saw = JSON.stringify({ box: parsed(await ev<string>(`return E.getText();`)).boxes['box-1'], ...await ev<object>(`return B.saw;`) });
    assert.equal(parsed(await ev<string>(`return E.getText();`)).boxes['box-1'].in, 'shelf', saw);
    await undo();
    const bad = await ev<{ violations: string[]; errors: string[] }>(`return { violations: B.violations, errors: B.errors };`);
    assert.deepEqual(bad, { violations: [], errors: [] });
  });
});

// 0.18.2: a switch of view fits the drawing in the new one, also after the person has zoomed or panned in the old one (it was left as it was
// built, at the top, with the old zoom's readout, until something else drew it again and it jumped: the drop above, on GitHub's runner)
test('boxes/1 in Chrome (0.18.2): a switch of view fits, whatever was done in the other; and nothing jumps after', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  const SEE = `const svg = document.querySelector('.iso-canvas svg.scene'), q = id => { const b = svg.querySelector('[data-id="' + id + '"]').getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round); }; return { mode: I.canvas.mode, zoom: Math.round(I.canvas.zoom * 1000) / 1000, said: document.querySelector('.iso-canvas .zoom, .zoom-label, [class*=zoom] output')?.textContent ?? '', view: svg.getAttribute('viewBox'), shelf: q('shelf'), c: q('c') };`;
  const moves: [string, string][] = [['nothing', ''],
    ['a zoom', `const r = I.canvas.stage.getBoundingClientRect(); I.canvas.stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, metaKey: true, clientX: r.left + 300, clientY: r.top + 300 })); await tick(150);`],
    ['a pan', `const r = I.canvas.stage.getBoundingClientRect(); I.canvas.stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 90, deltaY: 0, shiftKey: true, clientX: r.left + 300, clientY: r.top + 300 })); await tick(150);`]];
  const fitted: Record<string, unknown> = {};
  for (const [what, move] of moves) await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');
    const before = await ev<{ view: string }>(SEE);
    for (const v of ['2d', '3d', '2d']) {
      await ev(move); if (what !== 'nothing') assert.notDeepEqual((await ev<{ view: string }>(SEE)).view, v === '2d' ? before.view : (fitted['2d'] as { view: string }).view, `${what} moved it`);
      await ev(`document.querySelector('.view-seg [data-v="${v}"]').click();`);
      await until(`I.canvas.mode === '${v}' && document.querySelectorAll('.iso-canvas svg.scene').length === 1 && !document.querySelector('.dual-morph') && document.querySelector('.iso-canvas svg.scene [data-id="shelf"]') && document.querySelector('.iso-canvas svg.scene').style.visibility === ''`, `${what}: the ${v} view`);
      const now = await ev<object>(SEE); fitted[v] ??= now;
      assert.deepEqual(now, fitted[v], `${what}, then ${v}: as with nothing moved`);
    }
    // a change to the words of one thing: the rest stays where it is
    const shelf = (await ev<{ shelf: number[] }>(SEE)).shelf;
    await ev(`E.setText(${JSON.stringify(TEXT.replace('label: C', 'label: Cc'))}); await tick(700);`);
    assert.deepEqual((await ev<{ shelf: number[] }>(SEE)).shelf, shelf, `${what}: nothing jumps`);
  });
});

// 0.10.1, from the cloud editor's palette turn: a long palette scrolls (its items keep their height), and a palette add
// as the page's first action leaves the focus on the canvas once the name field is dismissed, so a real ⌘Z (on the
// focused element) undoes it.
test('boxes/1 in Chrome (0.10.1): palette items keep their height; after a palette add, the focus is the canvas\'s', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');
    assert.equal(await ev<string>(`return getComputedStyle(document.querySelector('.palette .pal-item')).flexShrink;`), '0');
    // nothing focused; the Box entry dragged onto empty canvas; the dialog cancelled by Esc
    await ev(`document.activeElement?.blur(); await tick();
      const btn = document.querySelector('.palette .pal-item[data-entry="0"]'), r0 = btn.getBoundingClientRect(), r = I.canvas.stage.getBoundingClientRect();
      const P = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 12 }));
      const to = { x: r.right - 40, y: r.bottom - 40 };
      P(btn, 'pointerdown', r0.left + 5, r0.top + 5); for (let i = 1; i <= 6; i++) { P(btn, 'pointermove', r0.left + 5 + (to.x - r0.left - 5) * i / 6, r0.top + 5 + (to.y - r0.top - 5) * i / 6); await tick(20); }
      P(btn, 'pointerup', to.x, to.y); await tick();`);
    await until(`/\\n  box-1:/.test(E.getText()) && document.querySelector('.rename-field')`, 'added, its name asked');
    await ev(`document.querySelector('.rename-field input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await tick();`);
    assert.equal(await ev(`return document.activeElement === I.canvas.stage;`), true, 'the focus is the canvas\'s');
    await ev(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));`);
    await until(`E.getText() === ${JSON.stringify(TEXT)}`, 'a real ⌘Z undoes it');
  });
});

// 0.11.0: palette sections: entries grouped under their section, in order; each header a button (aria-expanded, its
// group by aria-controls) that opens and closes it by click or keyboard; at the start every section collapsed but the one
// last added from (the host's store, canvas-palette), the first when none is stored; adding from an entry records its
// section; a store that holds nonsense is ignored.
test('boxes/1 in Chrome (0.11.0): palette sections, collapsed but the last used, remembered in the host\'s store', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  const page = (stored: Record<string, string>) => ({ html: `<!doctype html><html><head><meta charset="utf-8"><title>page</title></head><body data-sections data-stored="${JSON.stringify(stored).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" style="margin:0"><div id="app" style="height:100vh"></div><script type="module" src="page.js"></script></body></html>` });
  const state = `const p = document.querySelector('.palette');
    return { kids: [...p.children].map(c => c.className + ':' + (c.dataset.palSection ?? '')),
      heads: [...p.querySelectorAll('.pal-head')].map(b => [b.textContent.trim(), b.getAttribute('aria-expanded'), document.getElementById(b.getAttribute('aria-controls'))?.hidden]),
      items: [...p.querySelectorAll('.pal-body')].map(g => g.getAttribute('aria-label') + ':' + [...g.querySelectorAll('.pal-item')].map(b => b.textContent.trim()).join(',')),
      visible: [...p.querySelectorAll('.pal-item')].filter(b => b.offsetParent !== null).map(b => b.textContent.trim()) };`;
  // nothing stored: the first section open
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.palette .pal-head')`, 'it mounts with sections');
    assert.deepEqual(await ev(state), {
      kids: ['pal-section:Things', 'pal-section:Holders'],
      heads: [['Things', 'true', false], ['Holders', 'false', true]],
      items: ['Things:Box', 'Holders:Tray,Zone'],
      visible: ['Box'],
    });
    // a header opens by click, and by the keyboard (a button: Enter is a click); a second click closes it
    await ev(`document.querySelector('.pal-head[data-section-head="Holders"]').click(); await tick();`);
    assert.deepEqual((await ev<{ visible: string[] }>(state)).visible, ['Box', 'Tray', 'Zone']);
    await ev(`document.querySelector('.pal-head[data-section-head="Things"]').click(); await tick();`);
    assert.deepEqual((await ev<{ visible: string[] }>(state)).visible, ['Tray', 'Zone']);
    assert.equal(await ev(`return document.querySelector('.pal-head').tagName;`), 'BUTTON', 'a header is a button (Enter and space operate it)');
    assert.equal(await ev(`return B.stored['canvas-palette'] ?? null;`), null, 'opening and closing records nothing');
    // adding from Zone (Enter on its entry) records Holders as the last used
    await ev(`document.querySelector('.palette .pal-item[data-entry="2"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick(); document.querySelector('.rename-field input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await tick();`);
    await until(`/zone/.test(E.getText())`, 'a zone added');
    assert.equal(await ev(`return B.stored['canvas-palette'];`), '{"last":"Holders"}');
    const bad = await ev<{ violations: string[]; errors: string[] }>(`return { violations: B.violations, errors: B.errors };`);
    assert.deepEqual(bad, { violations: [], errors: [] });
  }, '1280,860', page({}));
  // Holders stored: only Holders open
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.palette .pal-head')`, 'it mounts with sections');
    assert.deepEqual((await ev<{ heads: unknown }>(state)).heads, [['Things', 'false', true], ['Holders', 'true', false]]);
  }, '1280,860', page({ 'canvas-palette': '{"last":"Holders"}' }));
  // nonsense stored (not JSON; a section that isn't there): the first open, nothing thrown
  for (const v of ['{', '{"last":"Gone"}']) await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.palette .pal-head')`, 'it mounts with sections');
    assert.deepEqual((await ev<{ heads: unknown }>(state)).heads, [['Things', 'true', false], ['Holders', 'false', true]], v);
    assert.deepEqual(await ev(`return B.errors;`), [], v);
  }, '1280,860', page({ 'canvas-palette': v }));
});

// 0.12.0: the palette docked: a pane of its own left of the stage (the drawing beside it, not under it), a search box
// that filters by label and section (sections with a match open while it is on, the reader's own back when it is
// cleared), Enter in it adding the first match, a drag from the pane onto the stage, a collapse control and a grip,
// both remembered in the host's store (canvas-palette-dock), nonsense in it ignored. Floating stays the default.
test('boxes/1 in Chrome (0.12.0): the palette docked, searchable, resizable and collapsible', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  const page = (stored: Record<string, string>) => ({ html: `<!doctype html><html><head><meta charset="utf-8"><title>page</title></head><body data-sections data-docked data-stored="${JSON.stringify(stored).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" style="margin:0"><div id="app" style="height:100vh"></div><script type="module" src="page.js"></script></body></html>` });
  const look = `const d = document.querySelector('.pal-dock'), s = I.canvas.stage, c = s.parentElement;
    const shown = [...d.querySelectorAll('.pal-item')].filter(b => b.offsetParent !== null).map(b => b.textContent.trim());
    return { order: [...c.children].slice(0, 3).map(x => x.className.split(' ')[0]), w: Math.round(d.getBoundingClientRect().width),
      beside: d.getBoundingClientRect().right <= s.getBoundingClientRect().left + 3, collapsed: c.classList.contains('pal-collapsed'),
      heads: [...d.querySelectorAll('.pal-head')].filter(b => b.offsetParent !== null).map(b => b.textContent.trim() + ':' + b.getAttribute('aria-expanded')),
      shown, none: d.querySelector('.pal-none').hidden ? '' : d.querySelector('.pal-none').textContent };`;
  const type = (v: string) => `const q = document.querySelector('.pal-search'); q.focus(); q.value = ${JSON.stringify(v)}; q.dispatchEvent(new Event('input', { bubbles: true })); await tick();`;
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.pal-dock .pal-head') && I.canvas.stage.querySelector('svg')`, 'it mounts, docked');
    assert.deepEqual(await ev(look), { order: ['pal-dock', 'pal-grip', 'iso-canvas'], w: 220, beside: true, collapsed: false, heads: ['Things:true', 'Holders:false'], shown: ['Box'], none: '' });
    assert.equal(await ev(`return document.querySelector('.pal-dock .palette').getAttribute('role');`), 'toolbar');
    // the search: by label, by section, nothing; Escape clears it and the sections are as the reader left them
    await ev(type('zo'));
    assert.deepEqual(await ev(look).then((x: any) => [x.heads, x.shown, x.none]), [['Holders:true'], ['Zone'], '']);
    await ev(type('things'));
    assert.deepEqual(await ev(look).then((x: any) => [x.heads, x.shown]), [['Things:true'], ['Box']]);
    await ev(type('gone'));
    assert.deepEqual(await ev(look).then((x: any) => [x.heads, x.shown, x.none]), [[], [], 'Nothing matches "gone"']);
    await ev(`document.querySelector('.pal-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await tick();`);
    assert.deepEqual(await ev(look).then((x: any) => [x.heads, x.shown, x.none]), [['Things:true', 'Holders:false'], ['Box'], '']);
    assert.equal(await ev(`return document.querySelector('.pal-search').value;`), '');
    // Enter in the search adds the first match (one undo step), and records its section
    await ev(type('tray'));
    await ev(`document.querySelector('.pal-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick();`);
    await until(`document.querySelector('.rename-field')`, 'added, its name asked');
    await ev(`document.querySelector('.rename-field input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await tick();`);
    assert.notEqual(await ev(`return E.getText();`), TEXT);
    assert.equal(await ev(`return B.stored['canvas-palette'];`), '{"last":"Holders"}');
    await ev(`I.canvas.stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true })); await tick();`);
    await until(`E.getText() === ${JSON.stringify(TEXT)}`, '⌘Z takes it out');
    // a drag from the pane onto the stage adds there
    await ev(type(''));
    const added = await ev<[number, number]>(`const b = document.querySelector('.pal-dock .pal-item[data-entry="0"]'), r = b.getBoundingClientRect(), s = I.canvas.stage.getBoundingClientRect();
      const P = (t, x, y) => b.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 7 }));
      const x0 = r.left + 10, y0 = r.top + 8, x1 = s.left + s.width * 0.8, y1 = s.top + s.height * 0.8;
      P('pointerdown', x0, y0); for (let i = 1; i <= 6; i++) { P('pointermove', x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6); await tick(20); } P('pointerup', x1, y1); await tick();
      return [x1, y1];`);
    await until(`document.querySelector('.rename-field')`, 'dropped, its name asked');
    await ev(`document.querySelector('.rename-field input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await tick(200);`);
    assert.match(await ev<string>(`return E.getText();`), /\n  box-1:/, 'a box, from the drag');
    // (0.12.1) where it was dropped: the view is the stage's, not the host's (the pane beside it), so the drawing
    // fills the stage at its own aspect and a drop lands under the pointer
    const [dx, dy] = added;
    const got = await ev<{ x: number; y: number; vb: number; st: number }>(`const p = I.canvas.pageXYOf(['boxes', 'box-1']); const vb = I.canvas.stage.querySelector('svg').viewBox.baseVal, r = I.canvas.stage.getBoundingClientRect(); return { x: p.x, y: p.y, vb: vb.width / vb.height, st: r.width / r.height };`);
    assert.ok(Math.hypot(got.x - dx, got.y - dy) < 60, `dropped at (${dx}, ${dy}), drawn at (${got.x.toFixed(1)}, ${got.y.toFixed(1)})`);
    assert.ok(Math.abs(got.vb / got.st - 1) < 0.01, `the view's aspect ${got.vb.toFixed(3)} is the stage's ${got.st.toFixed(3)}`);
    // the grip (keyboard) and the collapse control, both kept
    await ev(`const g = document.querySelector('.pal-grip'); g.focus(); g.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); await tick();`);
    assert.equal((await ev<{ w: number }>(look)).w, 236);
    assert.equal(await ev(`return B.stored['canvas-palette-dock'];`), '{"w":236}');
    await ev(`document.querySelector('.pal-collapse').click(); await tick();`);
    assert.deepEqual(await ev(look).then((x: any) => [x.collapsed, x.w, x.beside, x.shown]), [true, 36, true, []]);
    assert.equal(await ev(`return document.querySelector('.pal-collapse').getAttribute('aria-expanded');`), 'false');
    assert.equal(await ev(`return B.stored['canvas-palette-dock'];`), '{"w":236,"collapsed":true}');
    const bad = await ev<{ violations: string[]; errors: string[] }>(`return { violations: B.violations, errors: B.errors };`);
    assert.deepEqual(bad, { violations: [], errors: [] });
  }, '1280,860', page({}));
  // what was kept: collapsed, at 300; the control opens it at 300
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.pal-dock')`, 'it mounts, docked');
    assert.deepEqual(await ev(look).then((x: any) => [x.collapsed, x.w]), [true, 36]);
    await ev(`document.querySelector('.pal-collapse').click(); await tick();`);
    assert.deepEqual(await ev(look).then((x: any) => [x.collapsed, x.w, x.shown]), [false, 300, ['Box']]);
    assert.equal(await ev(`return B.stored['canvas-palette-dock'];`), '{"w":300}');
  }, '1280,860', page({ 'canvas-palette-dock': '{"w":300,"collapsed":true}' }));
  // nonsense kept: the defaults, nothing thrown
  for (const v of ['{', '{"w":"wide","collapsed":"yes"}', '{"w":99999}']) await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.pal-dock')`, 'it mounts, docked');
    const x = await ev<{ collapsed: boolean; w: number }>(look);
    assert.deepEqual([x.collapsed, x.w], [false, v === '{"w":99999}' ? 440 : 220], v);
    assert.deepEqual(await ev(`return B.errors;`), [], v);
  }, '1280,860', page({ 'canvas-palette-dock': v }));
});

// 0.12.3: a canvas too narrow for its toolbar (the palette docked, or a wide shell with a narrow canvas): the toolbar wraps
// onto rows on the stage, nothing of it clipped or under the palette, every control the one under the pointer at its
// place, and the 2D switch works; a canvas wide enough has it on one row, as before.
test('boxes/1 in Chrome (0.12.3): the canvas\'s toolbar stays on the stage, however narrow', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  const page = (attrs: string) => ({ html: `<!doctype html><html><head><meta charset="utf-8"><title>page</title></head><body ${attrs} data-stored="{}" style="margin:0"><div id="app" style="height:100vh"></div><script type="module" src="page.js"></script></body></html>` });
  const look = `const S = I.canvas.stage.getBoundingClientRect(), T = document.querySelector('.canvas-tools'), D = document.querySelector('.pal-dock')?.getBoundingClientRect();
    const bs = [...T.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => { const r = b.getBoundingClientRect(); return { b, t: b.textContent.trim() || b.getAttribute('aria-label'), r }; });
    return { stage: Math.round(S.width), n: bs.length, labels: bs.map(x => x.t), rows: new Set(bs.map(x => Math.round((x.r.top + x.r.bottom) / 2 / 8))).size,
      off: bs.filter(x => x.r.left < S.left - 0.5 || x.r.right > S.right + 0.5 || x.r.top < S.top || x.r.bottom > S.bottom + 0.5 || (D && x.r.left < D.right - 0.5)).map(x => x.t),
      covered: bs.filter(x => { const e = document.elementFromPoint((x.r.left + x.r.right) / 2, (x.r.top + x.r.bottom) / 2); return !x.b.contains(e); }).map(x => x.t) };`;
  type Look = { stage: number; n: number; labels: string[]; rows: number; off: string[]; covered: string[] };
  for (const [what, attrs, size, narrow] of [['docked, narrow', 'data-sections data-docked', '1000,700', true], ['docked, very narrow', 'data-sections data-docked', '940,700', true], ['floating, narrow', 'data-sections', '820,700', true], ['docked, wide', 'data-sections data-docked', '1500,800', false], ['floating, wide', 'data-sections', '1500,800', false]] as const) {
    await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
      await until(`document.title === 'ready' && I.canvas.stage.querySelector('svg')`, what);
      const x = await ev<Look>(look);
      assert.ok(x.labels.includes('3D') && x.labels.includes('2D') && x.labels.includes('Fit'), `${what}: ${x.labels}`);
      assert.deepEqual([x.off, x.covered], [[], []], `${what} (stage ${x.stage} px): every control on the stage, and reachable`);
      if (narrow) assert.ok(x.stage < 420 && x.rows > 1, `${what}: a ${x.stage} px stage, ${x.rows} rows`); else assert.equal(x.rows, 1, `${what}: one row`);
      // the switch that was hidden works
      await ev(`[...document.querySelectorAll('.canvas-tools button')].find(b => b.textContent.trim() === '2D').click(); await tick(900);`);
      await until(`I.canvas.mode === '2d' || document.querySelector('.view-seg [data-v="2d"][aria-pressed="true"]')`, `${what}: 2D`);
      assert.deepEqual(await ev(`return [B.errors, B.violations];`), [[], []], what);
    }, size, page(attrs));
  }
});

// 0.12.4: connections (routes that are entries of the file's own): on one within 6 px of it, a node under the pointer first,
// a node that hides it too; Tab reaches them after the objects; hovered, selected, deleted and back in one step.
test('connections (0.12.4): the routes that are entries of the file\'s own, and nothing else', () => {
  const d = drawBoxes(readBoxes(TEXT).read!, undefined, THEME), isRoute = (id: string) => Object.hasOwn(d.scene.rendered.paths, id);
  assert.deepEqual([...connectionsOf(d.pathOf, isRoute, boxesAdapter.objectOf)], [['/links/0', 'link-0'], ['/links/1', 'link-1']]);
  const of = (m: [string, string][], objects: string[] = []) => [...connectionsOf(new Map(m), id => id.startsWith('r'), p => (objects.some(o => p === o || p.startsWith(o + '/')) ? {} : undefined)).keys()];
  assert.deepEqual(of([['r1', '/links/0'], ['n', '/boxes/a']]), ['/links/0']);
  assert.deepEqual(of([['r1', '/boxes/a']], ['/boxes/a']), [], 'a route that stands for an object');
  assert.deepEqual(of([['r1', '/boxes/a/setting']], ['/boxes/a']), [], 'or for a key inside one');
  assert.deepEqual(of([['r1', '/archive']]), [], 'or for a whole section');
  assert.deepEqual(of([['r1', '/links/0'], ['r2', '/links/0']]), [], 'or is one of several for an entry');
  assert.deepEqual(of([['n1', '/links/0']]), [], 'a thing that isn\'t a route');
  const q = nearestOn('M0,0 L10,0 L10,10', 4, 3)!;
  assert.deepEqual([q.x, q.y, q.dist], [4, 0, 3]);
  assert.deepEqual(nearestOn('M0,0 L10,0 L10,10', 14, 20)!.dist, Math.hypot(4, 10));
  assert.equal(nearestOn('M0,0', 1, 1), undefined);
});
test('boxes/1 in Chrome (0.12.4): connections are easy to click, and the keyboard reaches them', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until, cdp }) => {
    await until(`document.title === 'ready' && I.canvas.stage.querySelector('svg')`, 'mounted');
    // a place on a connection with its floor, or nothing, all round it; and the way square to it there
    type At = { x: number; y: number; nx: number; ny: number; id: string };
    const spot = `const find = () => { for (const p of document.querySelectorAll('.canvas-stage svg.scene .flow, .canvas-stage svg.flat path.conn')) { const id = p.closest('[data-id]')?.dataset.id; if (!id) continue; const L = p.getTotalLength(), m = p.getScreenCTM(), at = l => { const q = p.getPointAtLength(l); return [m.a * q.x + m.c * q.y + m.e, m.b * q.x + m.d * q.y + m.f]; };
      for (let f = 0.08; f < 0.95; f += 0.01) { const [x, y] = at(L * f), [x2, y2] = at(L * f + 1), l = Math.hypot(x2 - x, y2 - y) || 1, nx = -(y2 - y) / l, ny = (x2 - x) / l;
        const free = d => { const e = document.elementFromPoint(x + nx * d, y + ny * d); return e && !e.closest('.g-blocks, .g-labels, .card, .pal, .palette, .canvas-tools'); };
        if ([-9, -6, -3, 0, 3, 6, 9].every(free) && document.elementFromPoint(x, y)?.closest('[data-id]')?.dataset.id === id) return { x, y, nx, ny, id }; } } }; return find();`;
    const mouse = async (x: number, y: number, click = true) => { for (const type of click ? ['mouseMoved', 'mousePressed', 'mouseReleased'] : ['mouseMoved']) await cdp('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }); await ev('await tick(80);'); };
    const key = async (k: string, code: string, n: number, modifiers = 0) => { await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: n, modifiers }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: n, modifiers }); await ev('await tick(120);'); };
    const sel = () => ev<string>(`return I.doc.selection.map(p => p.join('.')).join(' ');`);
    for (const zoomed of [false, true]) {
      if (zoomed) { await ev(`I.canvas.stage.focus();`); for (let i = 0; i < 8; i++) await key('-', 'Minus', 189); }
      const a = await ev<At>(spot);
      assert.ok(a, `a clear place on a connection (${zoomed ? 'zoomed out' : 'fitted'})`);
      for (const d of [-5, -3, 0, 3, 5]) { await ev(`I.doc.select([], 'canvas'); await tick(40);`); await mouse(a.x + a.nx * d, a.y + a.ny * d); assert.equal(await sel(), `links.${a.id.slice(5)}`, `${d} px off (${zoomed ? 'zoomed out' : 'fitted'})`); }
      for (const d of [-9, 9]) { await ev(`I.doc.select([], 'canvas'); await tick(40);`); await mouse(a.x + a.nx * d, a.y + a.ny * d); assert.notEqual(await sel(), `links.${a.id.slice(5)}`, `${d} px off is not on it`); }
      // hovered there, its mark
      await ev(`I.doc.select([], 'canvas'); await tick(40);`);
      await mouse(a.x + a.nx * 4, a.y + a.ny * 4, false);
      assert.equal(await ev(`return document.querySelectorAll('.overlay .route-hover').length;`), 1, 'its hover mark');
      if (!zoomed) {
        // deleted, and back, one step each
        await mouse(a.x + a.nx * 4, a.y + a.ny * 4);
        assert.equal(await ev(`return document.querySelectorAll('.overlay .route-ring').length;`), 1, 'its ring');
        await key('Backspace', 'Backspace', 8);
        assert.equal(await ev<number>(`return E.getText().split('\\n').length;`), TEXT.split('\n').length - 1, 'its entry went');
        assert.equal(await ev(`return !!document.querySelector('dialog[open]');`), false);
        await key('z', 'KeyZ', 90, 4);
        assert.equal(await ev(`return E.getText();`), TEXT);
      }
    }
    // a node under the pointer is the one meant, however near a connection's end is
    await ev(`I.canvas.fit(); await tick(200);`);
    const nodes = await ev<{ id: string; x: number; y: number }[]>(`return [...document.querySelectorAll('.canvas-stage .g-blocks [data-id="a"], .canvas-stage .g-blocks [data-id="b"], .canvas-stage .g-blocks [data-id="c"]')].flatMap(e => { const r = e.getBoundingClientRect(), out = []; for (let x = r.left; x < r.right; x += 4) for (let y = r.top; y < r.bottom; y += 4) if (document.elementFromPoint(x, y)?.closest('[data-id]')?.dataset.id === e.dataset.id) out.push({ id: e.dataset.id, x, y }); return out; });`);
    assert.ok(nodes.length > 100);
    const wrong = [];
    for (const n of nodes.filter((_, i) => i % 9 === 0)) { await mouse(n.x, n.y, false); const h = await ev<boolean>(`return document.querySelectorAll('.overlay .route-hover').length > 0;`); if (h) wrong.push(n); }
    assert.deepEqual(wrong, []);
    // the keyboard: the objects, then the connections, and round
    await ev(`I.canvas.stage.focus(); I.doc.select([], 'canvas'); await tick(60);`);
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) { await key('Tab', 'Tab', 9); seen.push(await sel()); }
    assert.deepEqual(seen, ['boxes.shelf', 'boxes.a', 'boxes.b', 'boxes.floor', 'boxes.c', 'links.0', 'links.1', 'boxes.shelf']);
    // ⌘A is the objects, as before
    await key('a', 'KeyA', 65, 4);
    assert.doesNotMatch(await sel(), /links/);
    // 2D: the same
    await ev(`[...document.querySelectorAll('.canvas-tools button')].find(b => b.textContent.trim() === '2D').click(); await tick(1200); I.doc.select([], 'canvas'); await tick(60);`);
    const b = await ev<At>(spot);
    assert.ok(b, 'a clear place on a connection in 2D');
    for (const d of [-5, 0, 5]) { await ev(`I.doc.select([], 'canvas'); await tick(40);`); await mouse(b.x + b.nx * d, b.y + b.ny * d); assert.equal(await sel(), `links.${b.id.slice(5)}`, `2D, ${d} px off`); }
    assert.deepEqual(await ev(`return [B.errors, B.violations];`), [[], []]);
  }, '1280,860');
});

// 0.12.5: the inline name field, driven with a real mouse and keyboard: right after a drop, above the thing, its name
// selected; Enter names it (the drop and the name one undo step); Esc and a press elsewhere keep the name, and the press
// does what it always does; what is wrong with a name shows under the field; it follows a zoom; F2 (the references
// too), the menu, the properties' pencil and, where the host asks, a double click use it. No <dialog> is ever made.
test('boxes/1 in Chrome (0.12.5): the inline name field, after a drop and for a rename; nothing modal', { skip: chrome ? false : 'no Chrome', timeout: 180000 }, async () => {
  for (const motion of ['no-preference', 'reduce']) await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until, cdp }) => {
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] });
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');
    await ev(`window.__dialogs = 0; new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeName === 'DIALOG' || n.querySelector?.('dialog')) window.__dialogs++; }).observe(document, { childList: true, subtree: true });`);
    const mouse = (type: string, x: number, y: number, n = 1) => cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: n });
    const KEYS: Record<string, [string, number]> = { Enter: ['\r', 13], Escape: ['', 27], F2: ['', 113] };
    const key = async (k: string) => { const [text, code] = KEYS[k]; await cdp('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code, ...(text ? { text } : {}) }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code }); };
    const type = (t: string) => cdp('Input.insertText', { text: t });
    const field = () => ev<{ value: string; sel: string; focus: boolean; x: number; bottom: number; why: string; invalid: string | null } | null>(`const i = document.querySelector('.rename-field input'); if (!i) return null; const r = i.getBoundingClientRect();
      return { value: i.value, sel: i.value.slice(i.selectionStart, i.selectionEnd), focus: document.activeElement === i, x: r.left + r.width / 2, bottom: r.bottom, why: document.querySelector('.rename-error').textContent, invalid: i.getAttribute('aria-invalid') };`);
    const view = () => ev<string>(`const s = I.canvas.stage.getBoundingClientRect(), v = I.canvas.view; return [s.left, s.top, s.width, s.height, v.x, v.y, v.w, v.h].map(n => n.toFixed(1)).join(' ');`);
    const drop = async (fx = 0.7, fy = 0.9, taken = false) => {
      // the view settled: where it is dropped is measured on it
      let before = ''; for (let k = 0, same = 0; k < 60 && same < 3; k++) { const now = await view(); same = now === before ? same + 1 : 0; before = now; await ev(`await tick(40);`); }
      const [x0, y0, x1, y1] = await ev<number[]>(`const b = document.querySelector('.palette .pal-item[data-entry="0"]').getBoundingClientRect(), s = I.canvas.stage.getBoundingClientRect(); return [b.left + 8, b.top + 8, s.left + s.width * ${fx}, s.top + s.height * ${fy}];`);
      await mouse('mousePressed', x0, y0); for (let i = 1; i <= 6; i++) await mouse('mouseMoved', x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6); await mouse('mouseReleased', x1, y1);
      await until(`document.querySelector('.rename-field') && document.querySelector('.iso-canvas svg.scene [data-id="box-1"]')`, 'dropped, drawn, its name asked');
      // it is where it was dropped, not where the layout put it (a taken spot: then the field can be at the stage's edge, and no wait helps)
      const note = await ev<string>(`return document.querySelector('#se-note')?.textContent ?? '';`);
      if (!taken) assert.doesNotMatch(note, /spot is taken/, `dropped at ${x1},${y1}; stage and view before: ${before}; after: ${await view()}; ${await ev<string>(`return E.getText();`)}`);
    };
    const undone = async (why: string) => { await ev(`I.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));`); await until(`E.getText() === ${JSON.stringify(TEXT)}`, why); };
    const boxOf = (id: string) => ev<{ x: number; top: number }>(`const rs = [...document.querySelectorAll('.iso-canvas svg.scene [data-id="${id}"]')].filter(e => !e.closest('.overlay')).map(e => e.getBoundingClientRect()).filter(r => r.width); const l = Math.min(...rs.map(r => r.left)), rr = Math.max(...rs.map(r => r.right)); return { x: (l + rr) / 2, top: Math.min(...rs.map(r => r.top)) };`);
    // (both in one look, once they agree: the drawing a drop leaves is laid out again when the file is read, and the thing's label may take another side)
    const above = async (id: string, why: string) => {
      const look = `(() => { const f = document.querySelector('.rename-field input')?.getBoundingClientRect(), rs = [...document.querySelectorAll('.iso-canvas svg.scene [data-id="${id}"]')].filter(e => !e.closest('.overlay')).map(e => e.getBoundingClientRect()).filter(r => r.width); if (!f || !rs.length) return undefined; return { dx: f.left + f.width / 2 - (Math.min(...rs.map(r => r.left)) + Math.max(...rs.map(r => r.right))) / 2, gap: Math.min(...rs.map(r => r.top)) - f.bottom }; })()`;
      const good = `(o => o && Math.abs(o.dx) < 3 && Math.abs(o.gap - 8) < 3)(${look})`;
      await ev(`await tick(120);`); await until(good, `${why}: the field above ${id}`, 4000);
      // and it stays there
      await ev(`await tick(400);`); assert.equal(await ev(`return !!${good};`), true, `${why}: ${JSON.stringify(await ev(`return ${look};`))}`);
    };

    // dropped on a taken spot: the layout places it, here half out of view: the view goes to it, and its name is asked above it
    const inside = () => ev<boolean>(`const s = I.canvas.stage.getBoundingClientRect(); return [...document.querySelectorAll('.iso-canvas svg.scene [data-id="box-1"]')].filter(e => !e.closest('.overlay')).map(e => e.getBoundingClientRect()).filter(r => r.width).every(r => r.left >= s.left && r.right <= s.right && r.top >= s.top && r.bottom <= s.bottom);`);
    const home = await view();
    await drop(0.6, 0.6, true);
    await until(`/spot is taken/.test(document.querySelector('#se-note').textContent)`, 'the layout placed it');
    await above('box-1', 'placed by the layout'); assert.equal(await inside(), true); assert.notEqual(await view(), home, 'the view went to it');
    await key('Escape'); await undone('undone, and the view fitted again');
    await ev(`I.canvas.fit(); await tick(60);`);
    // (one the layout places in view moves nothing)
    const fitted = await view();
    await drop(0.5, 0.5, true); await until(`/spot is taken/.test(document.querySelector('#se-note').textContent)`, 'placed, in view'); await above('box-1', 'placed, in view');
    assert.equal(await inside(), true); const seen = await view();
    await key('Escape'); await undone('undone again, as it was'); await ev(`I.canvas.fit(); await tick(60);`);
    assert.equal(seen, fitted, 'and one placed in view moves nothing');
    await ev(`document.querySelector('#se-note').textContent = '';`);
    // and one dropped where it was asked, at the very edge, is left there: the view never moves for it
    { const was = await view(); await drop(0.97, 0.9); await ev(`await tick(300);`); assert.equal(await inside(), false, 'half out of view'); assert.equal(await view(), was, 'a drop where it was asked moves nothing'); await key('Escape'); await undone('undone once more'); }

    // dropped: the field, focused, the generated name selected, above the box; typed, Enter: named, one undo step
    await drop();
    const f = (await field())!;
    assert.deepEqual([f.value, f.sel, f.focus], ['box-1', 'box-1', true]);
    await above('box-1', 'after the drop');
    await type('front'); await key('Enter');
    await until(`/\\n  front:/.test(E.getText())`, 'named');
    assert.equal(await field(), null);
    { const t = await ev<string>(`return E.getText();`); assert.ok(!/box-1/.test(t), 'the generated name is nowhere (its pin too): ' + t); }
    assert.equal(await ev(`return document.activeElement === I.canvas.stage;`), true, 'the focus is the canvas\'s');
    assert.match(await ev<string>(`return I.doc.undoLabel;`), /^Add box front/);
    assert.deepEqual(await ev(`return I.doc.selection.map(p => p.join('/'));`), ['boxes/front']);
    await undone('one undo takes the drop and the name');
    await ev(`I.doc.redo();`); await until(`/\\n  front:/.test(E.getText())`, 'and redo brings both'); await undone('undone again');

    // Esc keeps the generated name
    await drop(); await type('nope'); await key('Escape');
    assert.equal(await field(), null);
    assert.match(await ev<string>(`return E.getText();`), /\n  box-1:/); assert.doesNotMatch(await ev<string>(`return E.getText();`), /nope/);
    assert.equal(await ev(`return document.activeElement === I.canvas.stage;`), true);
    await undone('one step');

    // half off the canvas: the field stays on it
    await drop();
    const corner = await ev<{ x: number; y: number }>(`const r = I.canvas.stage.getBoundingClientRect(); return { x: r.left + 12, y: r.top + r.height / 2 };`);
    for (let i = 0; i < 12; i++) await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: corner.x, y: corner.y, deltaX: 0, deltaY: -120 });
    await ev(`await tick(250);`);
    const edge = await ev<{ in: number; stage: number; box: number }>(`const right = e => e.getBoundingClientRect().right; return { in: right(document.querySelector('.rename-field input')), stage: right(I.canvas.stage), box: right(document.querySelector('.iso-canvas svg.scene .g-blocks [data-id="box-1"]')) };`);
    assert.ok(edge.box > edge.stage && edge.in <= edge.stage, JSON.stringify(edge));
    await key('Escape'); await undone('one step');
    await ev(`[...document.querySelectorAll('.canvas-tools button')].find(b => b.textContent === 'Fit').click(); await tick(100);`);

    // a press elsewhere saves a good name, and is a press as ever: c is selected; one undo step still
    const press = async (id: string) => { const c = await ev<{ x: number; y: number }>(`return I.canvas.pageXYOf(['boxes', '${id}']);`); await mouse('mousePressed', c.x, c.y); await mouse('mouseReleased', c.x, c.y); };
    await drop(); await type('half'); await press('c');
    await until(`!document.querySelector('.rename-field') && /\\n  half:/.test(E.getText()) && I.doc.selection.map(p => p.join('/')).join() === 'boxes/c'`, 'saved, and c selected');
    assert.match(await ev<string>(`return E.getText();`), /layout:\n    half:/, 'its pin too');
    await undone('one step');
    // a bad one isn't saved: in use, or one the rule refuses
    for (const bad of ['c', 'Bad Name!']) {
      await drop(); await type(bad); await press('c');
      await until(`!document.querySelector('.rename-field') && I.doc.selection.map(p => p.join('/')).join() === 'boxes/c'`, 'dismissed');
      await ev(`await tick(100);`); assert.match(await ev<string>(`return E.getText();`), /\n  box-1:/, bad);
      await undone('one step');
    }
    // on the thing itself: selected under its new name
    await drop(); await type('self'); await press('box-1');
    await until(`/\\n  self:/.test(E.getText()) && I.doc.selection.map(p => p.join('/')).join() === 'boxes/self'`, 'selected by its new name');
    await undone('one step');
    // a drag of the thing itself: dragged, then named, its pin where the drag left it
    await drop(); await type('moved'); { const pin = async (n: string) => (await ev<string>(`return E.getText();`)).match(new RegExp(`${n}: \\{ at: \\[([^\\]]*)`))?.[1];
      const was = await pin('box-1'), c = await ev<{ x: number; y: number }>(`return I.canvas.pageXYOf(['boxes', 'box-1']);`);
      await mouse('mousePressed', c.x, c.y); for (let k = 1; k <= 8; k++) { await mouse('mouseMoved', c.x - k * 9, c.y - k * 3); await ev(`await tick(40);`); } await mouse('mouseReleased', c.x - 72, c.y - 24);
      await until(`/\\n  moved:/.test(E.getText())`, 'named'); await ev(`await tick(300);`);
      const now = await pin('moved'); assert.ok(now && now !== was, `moved from ${was} to ${now}`); assert.equal(await pin('box-1'), undefined, 'no pin under the old name');
      assert.doesNotMatch(await ev<string>(`return E.getText();`), /box-1/); }
    await ev(`while (I.doc.canUndo) I.doc.undo();`); await until(`E.getText() === ${JSON.stringify(TEXT)}`, 'all undone');
    // a button elsewhere (Undo): the name is saved first, so one press takes both back; ⌘S in the field saves the file with it
    await drop(); await type('gone'); { const u = await ev<{ x: number; y: number }>(`const r = [...document.querySelectorAll('button')].find(b => /^Undo/.test(b.textContent.trim())).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`); await mouse('mousePressed', u.x, u.y); await mouse('mouseReleased', u.x, u.y); }
    await until(`E.getText() === ${JSON.stringify(TEXT)}`, 'Undo took both');
    await drop(); await type('kept'); await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 4 });
    await until(`B.saved.length && /\\n  kept:/.test(B.saved.at(-1))`, 'the file saved, with the name');
    await ev(`while (I.doc.canUndo) I.doc.undo(); await tick(100);`);

    // a name in use, one the rule refuses, none: said under the field, Enter does nothing; a good one after is taken
    await drop();
    for (const [bad, why] of [['c', /already used/], ['Bad Name!', /./], ['', /needed/]] as const) {
      await ev(`document.querySelector('.rename-field input').select();`);
      if (bad) await type(bad); else await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await key('Enter');
      const g = (await field())!;
      assert.ok(g, `${bad}: still open`); assert.match(g.why, why); assert.equal(g.invalid, 'true');
      assert.match(await ev<string>(`return E.getText();`), /\n  box-1:/, 'nothing changed');
    }
    const under = await ev<{ err: number; input: number }>(`return { err: document.querySelector('.rename-error').getBoundingClientRect().top, input: document.querySelector('.rename-field input').getBoundingClientRect().bottom };`);
    assert.ok(under.err >= under.input, 'under the field');
    await ev(`document.querySelector('.rename-field input').select();`); await type('good'); await key('Enter');
    await until(`/\\n  good:/.test(E.getText())`, 'a good one'); await undone('one step');

    // it follows a zoom and a pan, the canvas live under it
    await ev(`[...document.querySelectorAll('.canvas-tools button')].find(b => b.textContent === 'Fit').click(); await tick(150);`);
    await ev(`I.doc.select([['boxes', 'b']], 'canvas'); I.canvas.stage.focus();`); await key('F2'); await above('b', 'F2');
    const at = await boxOf('b');
    for (let i = 0; i < 3; i++) await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.top + 60, deltaX: 0, deltaY: 60 });
    await ev(`await tick(200);`); assert.ok(await field(), 'the wheel leaves it open'); await above('b', 'zoomed');
    await key('Escape');

    // F2: the references follow; its own undo step
    await ev(`I.doc.select([['boxes', 'a']], 'canvas'); I.canvas.stage.focus();`); await key('F2'); await type('alpha'); await key('Enter');
    await until(`/from: alpha, to: b/.test(E.getText())`, 'renamed, the link too'); await undone('undone');
    // the menu's Rename, and the properties' pencil (the field over the properties' heading)
    await ev(`I.doc.select([['boxes', 'a']], 'canvas'); await tick(); I.canvas.stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true })); await tick(); [...document.querySelectorAll('.menu .menu-item')].find(b => /^Rename/.test(b.textContent.trim())).click(); await tick();`);
    assert.equal((await field())!.value, 'a'); await key('Escape');
    await ev(`document.querySelector('[aria-label^="Rename box a"]').click(); await tick();`);
    assert.equal((await field())!.value, 'a');
    const on = await ev<number[]>(`const q = e => e.getBoundingClientRect(), f = q(document.querySelector('.rename-field input')), t = q(document.querySelector('.sel-title')); return [Math.abs(f.top + f.height / 2 - t.top - t.height / 2), f.left - t.left];`);
    assert.ok(on[0] < 1.5 && on[1] > -10 && on[1] < 1, `on the heading: ${on}`);
    await type('omega'); await key('Enter'); await until(`/from: omega, to: b/.test(E.getText())`, 'renamed from the properties'); await undone('undone');
    // undone under it (the thing gone): the field goes too
    await drop(); await ev(`I.doc.undo(); await tick(200);`); assert.equal(await field(), null, 'the thing gone, the field gone');

    // a double click: shows it in the text (nothing to rename) unless the host asks for a rename
    const b = await ev<{ x: number; y: number }>(`return I.canvas.pageXYOf(['boxes', 'b']);`);
    for (const n of [1, 2]) { await mouse('mousePressed', b.x, b.y, n); await mouse('mouseReleased', b.x, b.y, n); }
    await ev(`await tick(150);`);
    assert.equal((await field())?.value, 'b', 'this host asks for a rename'); await key('Escape');

    assert.deepEqual(await ev(`return { dialogs: window.__dialogs, violations: B.violations, errors: B.errors };`), { dialogs: 0, violations: [], errors: [] });
  }, '1280,860', { html: '<!doctype html><html><head><meta charset="utf-8"><title>page</title></head><body data-rename style="margin:0"><div id="app" style="height:100vh"></div><script type="module" src="page.js"></script></body></html>' });
  // without the option a double click is as it was
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until, cdp }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');
    const b = await ev<{ x: number; y: number }>(`return I.canvas.pageXYOf(['boxes', 'b']);`);
    for (const n of [1, 2]) for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: n });
    await ev(`await tick(150);`);
    assert.equal(await ev(`return !!document.querySelector('.rename-field');`), false);
    assert.deepEqual(await ev(`return I.doc.selection.map(p => p.join('/'));`), ['boxes/b']);
  });
});

// 0.14.1: where the host asks for a rename, a double click takes the thing drawn there: on a group's floor beside a connection (which a click
// takes within 6 px) it is the group; on the connection itself, and beside it on nothing, it does nothing; the text is never shown. By default,
// as before: the connection beside it, shown in the text. 3D and 2D, a real mouse.
test('boxes/1 in Chrome (0.14.1): a double click to rename takes what is drawn there, and never shows the text', { skip: chrome ? false : 'no Chrome', timeout: 180000 }, async () => {
  const T = `format: boxes/1\ntitle: D\nboxes:\n  out: { size: [2, 2, 1] }\n  hall: { kind: zone, size: [20, 10] }\n  in: { in: hall, size: [2, 2, 1] }\nlinks:\n  - { from: out, to: in }\nx-editor:\n  layout:\n    out: { at: [0, 4] }\n    hall: { at: [14, 0] }\n    in: { at: [16, 4] }\n`;
  for (const asks of [true, false]) await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until, cdp }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');
    await ev(`E.setText(${JSON.stringify(T)}, { fit: true });`); await until(`I.canvas.doc?.scene.layout.byId.get('hall') && document.querySelector('.iso-canvas svg.scene [data-id^="link-"]')`, 'drawn');
    await ev(`window.__shown = []; const go = I.pane.goTo.bind(I.pane); I.pane.goTo = (p, ...a) => { window.__shown.push(p.join('/')); return go(p, ...a); };`);
    const dbl = async (p: { x: number; y: number }) => { for (const n of [1, 2]) for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: n }); await ev(`await tick(200);`);
      return ev<{ field: string | null; shown: string[] }>(`const o = { field: document.querySelector('.rename-field input')?.value ?? null, shown: window.__shown.splice(0) }; document.querySelector('.rename-field input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await tick(60); return o; `); };
    for (const mode of ['3d', '2d']) {
      if (mode === '2d') { await ev(`I.canvas.setMode('2d');`); await until(`I.canvas.mode === '2d' && document.querySelectorAll('.iso-canvas svg.scene').length === 1 && !document.querySelector('.dual-morph')`, '2d'); }
      await ev(`I.canvas.fit(); await tick(250);`);
      // along the connection's line: on it, and 4 px beside it, over the hall's floor and over nothing (clear of the things and of words)
      const places = () => ev<Record<string, { x: number; y: number } | null>>(`const path = [...document.querySelectorAll('.iso-canvas svg.scene path')].find(p => !p.closest('.overlay') && /^link-/.test(p.closest('[data-id]')?.dataset.id ?? '') && getComputedStyle(p).fill === 'none'), m = path.getScreenCTM(), w = path.getTotalLength(), out = { on: null, hall: null, nothing: null };
        const idAt = (x, y) => document.elementFromPoint(x, y)?.closest('[data-id]')?.dataset.id ?? '';
        for (let t = 6; t < w - 6; t += 1) { const a = path.getPointAtLength(t - 1).matrixTransform(m), b = path.getPointAtLength(t + 1).matrixTransform(m), q = path.getPointAtLength(t).matrixTransform(m), l = Math.hypot(b.x - a.x, b.y - a.y) || 1, n = { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
          if (!out.on && /^link-/.test(idAt(q.x, q.y)) && /^link-/.test(idAt(Math.floor(q.x), Math.floor(q.y)))) out.on = { x: Math.floor(q.x), y: Math.floor(q.y) };
          for (const s of [4, -4]) { const p = { x: q.x + n.x * s, y: q.y + n.y * s }, id = idAt(p.x, p.y), el = document.elementFromPoint(p.x, p.y); if (el?.tagName === 'text') continue; // (well inside: a double click's place is whole pixels)
            const all = v => [[2, 0], [-2, 0], [0, 2], [0, -2]].every(([dx, dy]) => idAt(p.x + dx, p.y + dy) === v); if (!out.hall && id === 'hall' && all('hall')) out.hall = p; if (!out.nothing && id === '' && all('') && el?.closest('.iso-canvas')) out.nothing = p; } }
        return out;`);
      // (where they are is asked again for each: a selection may have moved the view)
      const r: Record<string, unknown> = {};
      for (const k of ['on', 'hall', 'nothing']) { const at = (await places())[k]; assert.ok(at, `${mode}: a place ${k}`); r[k] = await dbl(at); }
      const link = { field: null, shown: ['links/0'] }, none = { field: null, shown: [] };
      assert.deepEqual(r, asks ? { on: none, hall: { field: 'hall', shown: [] }, nothing: none } : { on: link, hall: link, nothing: link }, `${mode}, ${asks ? 'rename' : 'by default'}`);
      assert.equal(await ev(`return E.getText();`), T);
    }
    assert.deepEqual(await ev(`return { violations: B.violations, errors: B.errors };`), { violations: [], errors: [] });
  }, '1280,860', { html: `<!doctype html><html><head><meta charset="utf-8"><title>page</title></head><body ${asks ? 'data-rename' : ''} style="margin:0"><div id="app" style="height:100vh"></div><script type="module" src="page.js"></script></body></html>` });
});

// 0.12.5: setText(text, { fit: true }): another document's drawing fitted once drawn, though the view had been moved (3D, 2D, and
// the same text again); without it the view stays where it is.
test('boxes/1 in Chrome (0.12.5): setText with fit', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until, cdp }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');
    const OTHER = `format: boxes/1\ntitle: Other\nboxes:\n${Array.from({ length: 9 }, (_, i) => `  q${i}: { label: Q${i} }`).join('\n')}\n`;
    const view = () => ev<string>(`const v = document.querySelector('.iso-canvas svg.scene').viewBox.baseVal; return [v.x, v.y, v.width, v.height].map(n => n.toFixed(1)).join();`);
    const away = async () => {
      const at = await ev<{ x: number; y: number }>(`const r = I.canvas.stage.getBoundingClientRect(); return { x: r.left + r.width * .4, y: r.top + r.height * .6 };`);
      for (let i = 0; i < 8; i++) await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: -120 });
      await ev(`await tick(200);`); assert.equal(await ev(`return I.canvas.moved;`), true, 'the view was moved');
    };
    const set = async (t: string, id: string, o = '') => { await ev(`E.setText(${JSON.stringify(t)}${o});`); await until(`document.querySelector('.iso-canvas svg.scene [data-id="${id}"]') && !document.querySelector('.iso-canvas svg.scene [data-id="${id === 'c' ? 'q0' : 'c'}"]')`, `${id} drawn`); await ev(`await tick(200);`); };
    const inside = () => ev<boolean>(`const s = I.canvas.stage.getBoundingClientRect(); return [...document.querySelectorAll('.iso-canvas svg.scene [data-id]')].filter(e => !e.closest('.overlay')).every(e => { const r = e.getBoundingClientRect(); return !r.width || (r.left >= s.left - 1 && r.right <= s.right + 1 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1); });`);
    for (const mode of ['3d', '2d']) {
      await ev(`I.canvas.setMode('${mode}');`); await until(`I.canvas.mode === '${mode}' && document.querySelectorAll('.iso-canvas svg.scene').length === 1 && !document.querySelector('.dual-morph') && !!document.querySelector('.iso-canvas svg.scene.flat') === ${mode === '2d'}`, mode);
      await away(); const was = await view();
      await set(OTHER, 'q0'); assert.equal(await view(), was, `${mode}: without fit the view stays`); assert.equal(await inside(), false);
      await set(TEXT, 'c', ', { fit: true }'); assert.equal(await inside(), true, `${mode}: fitted`); assert.equal(await ev(`return I.canvas.moved;`), false);
      await away(); await set(OTHER, 'q0', ', { fit: true }'); assert.equal(await inside(), true, `${mode}: another, fitted`);
      await away(); await ev(`E.setText(${JSON.stringify(OTHER)}, { fit: true }); await tick(500);`); assert.equal(await inside(), true, `${mode}: the same again, fitted`);
      // once only: an edit after doesn't fit again
      await away(); const then = await view(); await ev(`E.setText(${JSON.stringify(OTHER.replace('Q8', 'Q8 x'))}); await tick(600);`); assert.equal(await view(), then, `${mode}: once`);
      await set(TEXT, 'c', ', { fit: true }');
    }
    assert.deepEqual(await ev(`return { violations: B.violations, errors: B.errors };`), { violations: [], errors: [] });
  });
});

// 0.21.0: setText undoable: one step over the open file, which is then unsaved; undone to the byte; read-only doesn't stop the host; the
// same text is nothing. Plain setText starts anew, as before.
test('boxes/1 in Chrome (0.21.0): setText undoable', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');
    const NEW = 'format: boxes/1\ntitle: New\nboxes:\n  fresh: {}\n', was = await ev<string>(`return E.getText();`), st = (o: string) => ev<unknown>(`const r = E.setText(${JSON.stringify(NEW)}, ${o}); return { r, text: E.getText() === ${JSON.stringify(NEW)}, undo: I.doc.undoEntries.map(e => [e.label, e.origin, e.meta]), dirty: I.doc.dirty, id: I.doc.undoEntries.at(-1)?.id };`);
    const got = await st(`{ undoable: true, label: 'New', meta: { by: 'host' }, fit: true }`) as { r: { id: number; label: string }; text: boolean; undo: unknown[]; dirty: boolean; id: number };
    assert.deepEqual([got.text, got.undo, got.dirty, got.r.label, got.r.id], [true, [['New', 'api', { by: 'host' }]], true, 'New', got.id]);
    await until(`document.querySelector('.iso-canvas svg.scene [data-id="fresh"]') && !document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'the new one drawn');
    assert.equal(await ev(`return I.canvas.moved;`), false);
    assert.equal((await st(`{ undoable: true }`) as { r: unknown }).r, false, 'the same text is nothing');
    await ev(`I.doc.undo();`); assert.equal(await ev(`return E.getText();`), was); await until(`document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'undone and drawn'); assert.equal(await ev(`return I.doc.dirty;`), false);
    await ev(`E.setReadOnly(true);`); assert.equal((await st(`{ undoable: true }`) as { text: boolean }).text, true, 'the host\'s own act');
    // that once, and only that: what a view does is still refused, also from a listener of that very step
    assert.deepEqual(await ev(`const t = E.getText(), tries = () => I.doc.apply({ label: 'x', build: () => ({ steps: [[{ start: 0, end: 0, text: '# x\\n' }]] }) }, 'tree'); const a = [tries(), I.doc.undo(), E.getText() === t]; let heard; const off = I.doc.on(() => { heard ??= tries(); }); E.setText('format: boxes/1\\nboxes:\\n  y: {}\\n', { undoable: true }); off?.(); return [...a, heard, E.getText() === 'format: boxes/1\\nboxes:\\n  y: {}\\n'];`), [false, false, true, false, true], 'and nothing else');
    await ev(`E.setReadOnly(false);`);
    const plain = await ev(`const r = E.setText(${JSON.stringify('format: boxes/1\nboxes:\n  z: {}\n')}); return [r, I.doc.undoEntries.length, I.doc.dirty];`); assert.deepEqual(plain, [true, 0, false]);
    assert.deepEqual(await ev(`return { violations: B.violations, errors: B.errors };`), { violations: [], errors: [] });
  });
});

// 0.22.0 (experimental): the handle a host uses instead of `internal`: what it says, what the person is in the middle of (and only
// that), views and modes a host sets that aren't kept, drawn() that says whether it could draw, paths read as they are now, and a
// disposed editor that answers without throwing.
test('boxes/1 in Chrome (0.22.0): the host\'s handle', { skip: chrome ? false : 'no Chrome', timeout: 180000 }, async () => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>page</title></head><body data-sections data-stored="{}" style="margin:0"><div id="app" style="height:100vh"></div><input id="host-chat" aria-label="a host's own box"><div class="monaco-editor"><textarea id="host-code" aria-label="a host's own text"></textarea></div><script type="module" src="page.js"></script></body></html>`;
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until, cdp }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');
    // (headless, a page's focus fires no focus events unless it is told it has the window's focus, as a person's page has)
    await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
    // what it says
    assert.deepEqual(await ev(`return [E.element === I.root, E.model === I.doc, E.readOnly, E.view === I.state.view, E.busy, !!E.canvas, E.canvas.element === I.canvas.stage, E.canvas.mode, E.canvas.zoom === I.canvas.zoom && E.canvas.zoom > 0 && E.canvas.zoom < 5];`), [true, true, false, true, false, true, true, '3d', true]);
    await ev(`E.setReadOnly(true);`); assert.equal(await ev(`return E.readOnly;`), true); await ev(`E.setReadOnly(false);`);
    // drawn, and what it draws by path; the last drawing
    assert.equal(await ev(`return E.canvas.drawn();`), true);
    assert.deepEqual(await ev(`const svg = E.canvas.drawing(), all = I.canvas.stage.querySelectorAll(':scope > svg.scene'); const els = E.canvas.elementsOf(['boxes', 'c']), b = E.canvas.boxOf(['boxes', 'c']); return [svg === all[all.length - 1], els.length > 0 && els.every(e => svg.contains(e) && e.closest('[data-id="c"]')), b.w > 0 && b.h > 0, E.canvas.elementsOf(['boxes', 'nope']).length, E.canvas.boxOf(['boxes', 'nope']) ?? null];`), [true, true, true, 0, null]);
    // the newest drawing, where there are two (as in a switch of view)
    assert.equal(await ev(`const old = E.canvas.drawing().cloneNode(false); old.dataset.old = ''; E.canvas.element.prepend(old); const d = E.canvas.drawing(); old.remove(); return d.dataset.old === undefined;`), true);
    // a path read as it is now: after a rename the old one finds nothing
    await ev(`E.setText(E.getText().replace(/^  c:/m, '  cc:').replace(/to: c }/, 'to: cc }'), { undoable: true }); return 0;`); assert.equal(await ev(`return E.canvas.drawn();`), true);
    assert.deepEqual(await ev(`return [E.canvas.elementsOf(['boxes', 'c']).length, E.canvas.boxOf(['boxes', 'c']) ?? null, E.canvas.elementsOf(['boxes', 'cc']).length > 0];`), [0, null, true]);
    await ev(`E.model.undo(); return 0;`); assert.equal(await ev(`return E.canvas.drawn();`), true);
    // what can't be drawn: false, never a rejection; then it draws again
    await ev(`E.setText('format: boxes/1\\nboxes: [', { undoable: true }); return 0;`); assert.equal(await ev(`return E.canvas.drawn();`), false);
    await ev(`E.model.undo(); return 0;`); assert.equal(await ev(`return E.canvas.drawn();`), true, 'drawn again');
    assert.equal(await ev(`return document.querySelector('.canvas-empty').hidden;`), true, 'and the notice gone: the same drawing as before it (it was left, before 0.22.0)');
    assert.equal(await ev(`const f = I.canvas.drawnNow; I.canvas.drawnNow = () => Promise.reject(new Error('x')); try { return await E.canvas.drawn(); } finally { I.canvas.drawnNow = f; }`), false, 'never a rejection');
    // views and modes: a host's aren't kept, unless it asks; the person's are
    const kept = () => ev<Record<string, string>>(`return { ...B.stored };`);
    await ev(`E.setView('canvas'); return 0;`); assert.equal(await ev(`return E.view;`), 'canvas'); assert.equal((await kept()).view, undefined, 'a host\'s view isn\'t kept');
    assert.equal(await ev(`return E.canvas.setMode('2d');`), true); assert.equal(await ev(`return E.canvas.mode;`), '2d'); assert.equal((await kept())['canvas-view'], undefined, 'nor its mode');
    assert.equal(await ev(`return E.canvas.setMode('3d', { remember: true });`), true); assert.equal((await kept())['canvas-view'], '3d');
    await ev(`document.querySelector('.view-seg .seg[data-v="2d"]').click(); await tick(300); return 0;`); assert.equal((await kept())['canvas-view'], '2d', 'the person\'s is'); await ev(`return E.canvas.setMode('3d');`);
    await ev(`E.setView('both', { remember: true }); return 0;`); assert.equal((await kept()).view, 'both');
    // fit a box; focus
    const zAll = await ev<number>(`E.canvas.fit(); await E.canvas.drawn(); return E.canvas.zoom;`), zC = await ev<number>(`E.canvas.fit(E.canvas.boxOf(['boxes', 'c'])); await E.canvas.drawn(); return E.canvas.zoom;`);
    assert.ok(zC > zAll * 1.3, `a box fitted is closer: ${zC} against ${zAll}`); await ev(`E.canvas.fit(); await E.canvas.drawn(); return 0;`);
    await ev(`E.canvas.focus(); return 0;`); assert.equal(await ev(`return document.activeElement === E.canvas.element;`), true);
    // what the person is in the middle of, as it changes: typing in the text, never in the host's own box; a pan isn't; moving a thing is
    await ev(`window.heard = []; window.off = E.onBusy(b => heard.push(b)); return 0;`);
    await ev(`document.getElementById('host-chat').focus(); await tick(); return 0;`); assert.equal(await ev(`return E.busy;`), false, 'a host\'s own box is never busy');
    await ev(`document.getElementById('host-code').focus(); await tick(); return 0;`); assert.equal(await ev(`return E.busy;`), false, 'nor its own text');
    await ev(`E.model.select([['boxes', 'c']], 'canvas'); await tick(150); const f = document.querySelector('#se-sel-body input, #se-sel-body textarea'); if (!f) throw new Error('no field in the properties'); f.focus(); await tick(50); return 0;`); assert.equal(await ev(`return E.busy;`), 'typing', 'a field of the properties');
    await ev(`E.canvas.focus(); await tick(50); return 0;`); assert.equal(await ev(`return E.busy;`), false);
    const m = (type: string, x: number, y: number) => cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    const empty = await ev<{ x: number; y: number }>(`const r = E.canvas.element.getBoundingClientRect(); return { x: r.left + 30, y: r.bottom - 30 };`);
    await m('mousePressed', empty.x, empty.y); for (let i = 1; i <= 5; i++) await m('mouseMoved', empty.x + i * 10, empty.y - i * 6);
    assert.equal(await ev(`return E.busy;`), false, 'a pan is not'); await m('mouseReleased', empty.x + 50, empty.y - 30);
    // (the view still first: with motion, selecting it may bring it into view, smoothly)
    await ev(`E.model.select([['boxes', 'c']], 'canvas'); await tick(100); await E.canvas.drawn(); return 0;`);
    const c = await ev<{ x: number; y: number }>(`const r = E.canvas.elementsOf(['boxes', 'c'])[0].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
    await m('mousePressed', c.x, c.y); for (let i = 1; i <= 6; i++) await m('mouseMoved', c.x + i * 12, c.y + i * 4);
    assert.equal(await ev(`return E.busy;`), 'drag', 'a thing moved is');
    await m('mouseReleased', c.x + 72, c.y + 24); assert.equal(await ev(`await E.canvas.drawn(); return E.busy;`), false);
    // a rename in place
    await ev(`E.model.select([['boxes', 'c']], 'canvas'); E.canvas.focus(); I.canvas.stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true })); await tick(150); return 0;`);
    assert.equal(await ev(`return !!document.querySelector('.rename-field') && E.busy;`), 'rename');
    await ev(`document.querySelector('.rename-field input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(100); E.canvas.focus(); await tick(50); return 0;`);
    // something dragged out of the palette, before it is dropped
    const [p0, p1] = await ev<number[][]>(`const b = document.querySelector('.palette .pal-item').getBoundingClientRect(), s = E.canvas.element.getBoundingClientRect(); return [[b.left + 8, b.top + 8], [s.left + s.width * .6, s.top + s.height * .8]];`);
    await m('mousePressed', p0[0], p0[1]); await m('mouseMoved', p0[0] + 12, p0[1] + 6);
    assert.equal(await ev(`await tick(80); return E.busy;`), 'drag', 'a palette entry dragged, not yet over the canvas');
    for (let i = 1; i <= 6; i++) await m('mouseMoved', p0[0] + (p1[0] - p0[0]) * i / 6, p0[1] + (p1[1] - p0[1]) * i / 6);
    assert.equal(await ev(`return E.busy;`), 'drag', 'and over it');
    await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await m('mouseReleased', p1[0], p1[1]); assert.equal(await ev(`await tick(100); await E.canvas.drawn(); return E.busy;`), false, 'and not once it is let go');
    assert.deepEqual(await ev(`off(); return heard;`), ['typing', false, 'drag', false, 'rename', false, 'drag', false]);
    // what is stopped hears nothing more
    await ev(`document.querySelector('#se-sel-body input, #se-sel-body textarea')?.focus() ?? E.model.select([['boxes', 'c']], 'canvas'); await tick(100); return 0;`);
    assert.equal(await ev(`return heard.length;`), 8);
    // a note, a check and a save
    await ev(`E.showNote('From the host', 'warn'); return 0;`); assert.equal(await ev(`return document.querySelector('#se-note .c-body').textContent;`), 'From the host');
    assert.equal(await ev(`await E.check(); return 0;`), 0);
    assert.deepEqual(await ev(`const n = B.saved.length, r = await E.save(); return [r, B.saved.length - n, I.doc.dirty];`), [true, 1, false]);
    await ev(`E.setReadOnly(true); return 0;`); assert.equal(await ev(`return E.save();`), false); await ev(`E.setReadOnly(false); return 0;`);
    // disposed: everything answers, nothing throws
    assert.deepEqual(await ev(`const cv = E.canvas; E.dispose(); return [await cv.drawn(), await cv.setMode('2d'), await E.save(), await E.check() ?? null, E.busy, cv.elementsOf(['boxes', 'a']).length];`), [false, false, false, null, false, 0]);
    assert.deepEqual(await ev(`return { violations: B.violations, errors: B.errors };`), { violations: [], errors: [] });
  }, '1280,860', { html });
});

// 0.12.6: what Fit fits has the connectors in it: one that goes round a thing, past everything drawn, is inside the stage, in 3D and 2D.
test('boxes/1 in Chrome (0.12.6): Fit counts the connectors', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');
    // a long way round: in 3D one of these goes 140 units past everything drawn (the search that found it isn't kept); in 2D past the cards
    const ROUND = `format: boxes/1\ntitle: Round\nboxes:\n  p: { size: [5, 1, 1] }\n  q: { size: [2, 2, 1] }\n  w: { size: [5, 2, 1] }\n  x: { size: [4, 8, 1] }\n  y: { size: [6, 3, 1] }\nlinks:\n  - { from: p, to: q }\n  - { from: q, to: p }\nx-editor:\n  layout:\n    p: { at: [12, 11] }\n    q: { at: [5, 2] }\n    w: { at: [1, 5] }\n    x: { at: [5, 13] }\n    y: { at: [4, 9] }\n`;
    await ev(`E.setText(${JSON.stringify(ROUND)}, { fit: true });`);
    await until(`document.querySelector('.iso-canvas svg.scene [data-id="w"]') && !document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'drawn');
    for (const mode of ['3d', '2d']) {
      await ev(`I.canvas.setMode('${mode}');`); await until(`I.canvas.mode === '${mode}' && document.querySelectorAll('.iso-canvas svg.scene').length === 1 && !document.querySelector('.dual-morph') && !!document.querySelector('.iso-canvas svg.scene.flat') === ${mode === '2d'}`, mode);
      const r = await ev<{ routes: number; off: string[]; gap: number; things: number }>(`I.canvas.fit(); await tick(200); const svg = document.querySelector('.iso-canvas svg.scene'), st = I.canvas.stage.getBoundingClientRect();
        const paths = [...svg.querySelectorAll('path')].filter(p => !p.closest('.overlay') && /^link-/.test(p.closest('[data-id]')?.dataset.id ?? p.dataset.id ?? '')); const off = []; let gap = Infinity;
        const inside = q => Math.min(q.left - st.left, st.right - q.right, q.top - st.top, st.bottom - q.bottom);
        for (const p of paths) { const g = inside(p.getBoundingClientRect()); gap = Math.min(gap, g); if (g < 4) off.push(JSON.stringify(p.getBoundingClientRect())); }
        const things = Math.min(...[...svg.querySelectorAll('[data-id]')].filter(e => /^[pqwxy]$/.test(e.dataset.id) && !e.closest('.overlay')).map(e => inside(e.getBoundingClientRect())));
        return { routes: paths.length, off, gap, things };`);
      // and nothing that isn't seen: a step's mark on a connector, far away, changes nothing
      const same = await ev<boolean>(`const svg = document.querySelector('.iso-canvas svg.scene'), was = JSON.stringify(I.canvas.routesBox()), m = svg.querySelector('.g-marks') ?? svg.appendChild(Object.assign(document.createElementNS('http://www.w3.org/2000/svg', 'g'), {})); m.setAttribute('class', 'g-marks');
        const g = m.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'circle')); for (const [k, v] of [['cx', 9000], ['cy', 9000], ['r', 9], ['data-hl', 'link-0']]) g.setAttribute(k, v); const now = JSON.stringify(I.canvas.routesBox()); g.remove(); return was === now;`);
      assert.equal(same, true, `${mode}: a mark isn't fitted`);
      assert.ok(r.routes >= 2, `${mode}: ${r.routes} connectors`); assert.deepEqual(r.off, [], `${mode}: every connector is on the stage`); assert.ok(r.things >= 23, `${mode}: the things keep their margin (${r.things})`);
      if (mode === '3d') assert.ok(r.gap < 12, `no more than it takes: the furthest connector is ${r.gap} px inside`);
    }
    // where no connector goes past the things, the view is exactly the one without it
    await ev(`I.canvas.setMode('3d');`); await until(`I.canvas.mode === '3d' && document.querySelectorAll('.iso-canvas svg.scene').length === 1 && !document.querySelector('.dual-morph')`, '3d');
    const PLAIN = `format: boxes/1\ntitle: Plain\nboxes:\n  p: { size: [2, 2, 1] }\n  q: { size: [2, 2, 1] }\nlinks:\n  - { from: p, to: q }\nx-editor:\n  layout:\n    p: { at: [0, 0] }\n    q: { at: [9, 0] }\n`;
    const view = async (t: string) => {
      await ev(`E.setText(${JSON.stringify(t)}, { fit: true });`);
      await until(`E.getText() === ${JSON.stringify(t)} && (document.querySelectorAll('.iso-canvas svg.scene [data-id^="link-"]').length > 0) === ${t.includes('links')} && !document.querySelector('.iso-canvas svg.scene [data-id="w"]')`, 'drawn');
      await ev(`await tick(300);`);
      return ev<string>(`const v = document.querySelector('.iso-canvas svg.scene').viewBox.baseVal; return [v.x, v.y, v.width, v.height].map(n => n.toFixed(2)).join();`);
    };
    assert.equal(await view(PLAIN), await view(PLAIN.replace(/links:\n.*\n/, '')));
    assert.deepEqual(await ev(`return { violations: B.violations, errors: B.errors };`), { violations: [], errors: [] });
  });
});

test('boxes/1 in Chrome (0.28.0): a drag past a group\'s edge grows it, dashed where it was; resize handles; fit to contents', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="a"]')`, 'it mounts and draws');
    const P = `const P = (el, type, x, y, alt = false) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 5, altKey: alt }));`;
    // (0.30.0, "nothing else jumps") where the floor zone (beside the shelf) and c in it stand on screen before the drag
    const where = `const q = id => { const p = I.canvas.pageXYOf(['boxes', id]); return [Math.round(p.x), Math.round(p.y)]; }; return { floor: q('floor'), c: q('c') };`;
    const before = await ev<{ floor: number[]; c: number[] }>(where);
    // grow: a, dragged to the front past the shelf's edge (a shelf that fits what it holds; b stands beside it, to its right): no edge
    // holds it, the shelf grows, its old floor dashed
    const grow = await ev<{ dashed: boolean; hint: string; steps: number; wrong: string[]; drop: unknown }>(`${P} const c = I.canvas, at = c.pageXYOf(['boxes', 'a']); const el = document.elementFromPoint(at.x, at.y);
      // at each step: the dashed floor and the words exactly while the shelf is bigger than when the drag began, never otherwise
      const wrong = []; let steps = 0;
      const check = () => { const g = c.drag, b = g?.parent?.box, b0 = g?.parent?.box0; if (!b || !b0 || !g.move || !g.shown || g.shown[0] !== g.move.at[0] || g.shown[1] !== g.move.at[1]) return;   // (the trial drawn for where it is)
        const grown = b.x1 - b.x0 > b0.x1 - b0.x0 + 1e-6 || b.y1 - b.y0 > b0.y1 - b0.y0 + 1e-6, dashed = !!document.querySelector('.iso-canvas .overlay .grow-was'), words = /which grows with it/.test(document.querySelector('#se-st-hint')?.textContent ?? '');
        // (0.31.0) what it saw, for a run elsewhere (CI) to say: the group's box then and now, the trial's place against the drop's, the hint
        const r1 = v => Math.round(v * 1000) / 1000, bx = o => o && [o.x0, o.y0, o.x1, o.y1].map(r1);
        steps++; if (dashed !== grown || words !== grown) wrong.push(JSON.stringify({ at: g.move?.at, shown: g.shown, grown, dashed, words, box: bx(b), box0: bx(b0), pad: g.parent.pad, shift: g.shiftShown, hint: document.querySelector('#se-st-hint')?.textContent })); };
      P(el, 'pointerdown', at.x, at.y); let dashed = false, hint = '';
      for (let i = 1; i <= 14; i++) { P(c.stage, 'pointermove', at.x - i * 12, at.y + i * 7); await tick(80); check(); dashed ||= !!document.querySelector('.iso-canvas .overlay .grow-was'); hint = document.querySelector('#se-st-hint')?.textContent || hint; }
      // pulled back in and out again: the same, at every step
      for (let i = 13; i >= 0; i--) { P(c.stage, 'pointermove', at.x - i * 12, at.y + i * 7); await tick(80); check(); }
      for (let i = 1; i <= 14; i++) { P(c.stage, 'pointermove', at.x - i * 12, at.y + i * 7); await tick(80); check(); }
      const g = c.drag, drop = g && { at: g.move?.at, shown: g.shown, keep: g.keep, pinSet: g.pinSet, shift: g.shiftShown, box: g.parent?.box && [g.parent.box.x0, g.parent.box.y0, g.parent.box.x1, g.parent.box.y1] };
      P(c.stage, 'pointerup', at.x - 168, at.y + 98); return { dashed, hint, steps, wrong, drop };`);
    assert.equal(grow.dashed, true, "the shelf's floor as it was, dashed, while it grew");
    assert.match(grow.hint, /^Moving a within Shelf, which grows with it · /, 'the group named once, and what it does');
    assert.deepEqual(grow.wrong, [], 'the dashed floor and the words exactly while the shelf has grown, at every step');
    assert.ok(grow.steps >= 15, `${grow.steps} steps checked (the trial drawn for where it was)`);
    await until(`/a: \\{ at: \\[/.test(E.getText())`, 'a pinned where it was dropped');
    assert.doesNotMatch(await ev<string>(`return E.getText();`), /size:/, 'a group that fits what it holds keeps fitting: no size written');
    // nothing else jumped: the floor zone and what is in it stand where they stood (pinned there by the same step if the shelf's
    // growing would have moved them)
    await ev(`await tick(300); return 0;`);
    const after = await ev<{ floor: number[]; c: number[] }>(where);
    // (0.31.0) and, if not, what it wrote and how the drawing stands (for a run elsewhere, CI, to say)
    const saw = JSON.stringify(after) === JSON.stringify(before) ? '' : JSON.stringify({ pins: (await ev<string>(`return E.getText();`)).split('x-editor:')[1], boxes: await ev(`const L = I.canvas.doc.scene.layout.byId, b = id => { const x = L.get(id)?.box; return x && [x.x0, x.y0, x.x1, x.y1].map(v => Math.round(v * 1000) / 1000); }; return { shelf: b('shelf'), floor: b('floor'), a: b('a'), b: b('b'), c: b('c') };`), drop: grow.drop });
    assert.deepEqual(after, before, `the shelf grew; the floor and c stayed where they were ${saw}`);
    assert.match(await ev<string>(`return E.getText();`), /floor: \{ at: \[/, 'the floor pinned where it stood (the shelf grew towards it)');
    await ev(`I.doc.undo(); await tick(100); return 0;`);
    await until(`!/x-editor/.test(E.getText())`, 'one undo step');
    // a shelf with room inside it (b deeper than a): a short way to the front, nothing grows (no dashed floor, no words); further, it
    // does. Both seen, and at every step the two agree with what the shelf did
    const roomy = await ev<{ seen: boolean[]; wrong: string[] }>(`${P} E.setText(E.getText().replace('  b: { in: shelf, label: B }', '  b: { in: shelf, label: B, size: [2, 4, 1] }'), { fit: true }); await tick(300);
      const c = I.canvas, at = c.pageXYOf(['boxes', 'a']), el = document.elementFromPoint(at.x, at.y), seen = new Set(), wrong = [];
      const check = () => { const g = c.drag, b = g?.parent?.box, b0 = g?.parent?.box0; if (!b || !b0 || !g.move || !g.shown || g.shown[0] !== g.move.at[0] || g.shown[1] !== g.move.at[1]) return;   // (the trial drawn for where it is)
        const grown = b.x1 - b.x0 > b0.x1 - b0.x0 + 1e-6 || b.y1 - b.y0 > b0.y1 - b0.y0 + 1e-6, dashed = !!document.querySelector('.iso-canvas .overlay .grow-was'), words = /which grows with it/.test(document.querySelector('#se-st-hint')?.textContent ?? '');
        seen.add(grown); if (dashed !== grown || words !== grown) wrong.push(JSON.stringify({ at: g.move.at, grown, dashed, words })); };
      P(el, 'pointerdown', at.x, at.y);
      for (let i = 1; i <= 16; i++) { P(c.stage, 'pointermove', at.x - i * 6, at.y + i * 3.5); await tick(80); check(); }
      for (let i = 15; i >= 0; i--) { P(c.stage, 'pointermove', at.x - i * 6, at.y + i * 3.5); await tick(80); check(); }
      I.canvas.stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); P(c.stage, 'pointerup', at.x, at.y); await tick(100);
      return { seen: [...seen].sort(), wrong };`);
    assert.deepEqual(roomy.seen, [false, true], 'a short way, nothing grew; further, it did');
    assert.deepEqual(roomy.wrong, [], 'the dashed floor and the words exactly while it has grown');
    await ev(`E.setText(${JSON.stringify(TEXT)}, { fit: true }); await tick(300); return 0;`);

    // the handles: the shelf selected, (0.30.0) eight (its four corners and four sides: left and back on, the shelf can be pinned)
    await ev(`I.doc.select([['boxes', 'shelf']], 'canvas'); await tick(100); return 0;`);
    await until(`document.querySelectorAll('.iso-canvas .overlay .size-handle').length === 8`, 'eight handles');
    assert.deepEqual(await ev<string[]>(`return [...document.querySelectorAll('.iso-canvas .overlay .size-handle')].map(h => h.dataset.handle).sort();`), ['back', 'corner', 'corner-lb', 'corner-lf', 'corner-rb', 'front', 'left', 'right']);
    // the corner, dragged out: a size written, as one step
    await ev(`${P} const h = document.querySelector('.iso-canvas .overlay .size-handle[data-handle="corner"]').getBoundingClientRect(), x = h.x + h.width / 2, y = h.y + h.height / 2;
      P(document.querySelector('.iso-canvas .overlay .size-handle[data-handle="corner"]'), 'pointerdown', x, y);
      for (let i = 1; i <= 6; i++) { P(I.canvas.stage, 'pointermove', x + i * 10, y + i * 12); await tick(40); }
      P(I.canvas.stage, 'pointerup', x + 60, y + 72); return 0;`);
    await until(`/shelf: \\{ kind: tray, label: Shelf, size: \\[\\d+(\\.5)?, \\d+(\\.5)?\\] \\}/.test(E.getText())`, 'the size written');
    const sized = await ev<string>(`return /size: (\\[[^\\]]*\\])/.exec(E.getText())[1];`);
    assert.equal(await ev<string>(`return I.doc.undoLabel;`), 'Resize Shelf');
    // the right side, dragged far in: stopped at what it holds, never smaller
    await ev(`I.doc.select([['boxes', 'shelf']], 'canvas'); await tick(100); return 0;`);
    await until(`document.querySelector('.iso-canvas .overlay .size-handle[data-handle="right"]')`, 'the right handle');
    const held = await ev<{ hint: string; red: boolean }>(`${P} const el = document.querySelector('.iso-canvas .overlay .size-handle[data-handle="right"]'), h = el.getBoundingClientRect(), x = h.x + h.width / 2, y = h.y + h.height / 2;
      P(el, 'pointerdown', x, y); for (let i = 1; i <= 10; i++) { P(I.canvas.stage, 'pointermove', x - i * 40, y - i * 20); await tick(30); }
      const r = { hint: document.querySelector('#se-st-hint')?.textContent ?? '', red: !!document.querySelector('.iso-canvas .overlay .size-to.held') };
      P(I.canvas.stage, 'pointerup', x - 400, y - 200); return r;`);
    assert.match(held.hint, /no smaller/); assert.equal(held.red, true, 'the floor it would have, red where it is held');
    const narrow = await ev<string>(`await tick(100); return /size: (\\[[^\\]]*\\])/.exec(E.getText())?.[1] ?? '';`);
    assert.notEqual(narrow, sized, 'narrower');
    // fit to contents: in the menu while it has a size; a double click on a handle takes it away
    // (the menu key: the shelf's own menu; a right click on its middle would land on a box standing on it)
    await ev(`I.doc.select([['boxes', 'shelf']], 'canvas'); await tick(100); I.canvas.focus();
      I.canvas.stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true })); await tick(100); return 0;`);
    assert.ok((await ev<string[]>(`return [...document.querySelectorAll('.menu[role="menu"] .mi-label')].map(x => x.textContent);`)).includes('Fit to contents'), 'Fit to contents, while it has a size');
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(50); return 0;`);
    await ev(`I.doc.select([['boxes', 'shelf']], 'canvas'); await tick(100); const el = document.querySelector('.iso-canvas .overlay .size-handle[data-handle="corner"]'), h = el.getBoundingClientRect();
      I.canvas.stage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: h.x + h.width / 2, clientY: h.y + h.height / 2 })); return 0;`);
    await until(`!/size:/.test(E.getText())`, 'the size taken away: it fits again');
    assert.match(await ev<string>(`return I.doc.undoLabel;`), /^Fit Shelf to what it holds$/);

    const bad = await ev<{ violations: string[]; errors: string[] }>(`return { violations: B.violations, errors: B.errors };`);
    assert.deepEqual(bad, { violations: [], errors: [] });
  });
});

for (const mode of ['pins'] as const) test(`boxes/1 in Chrome (0.29.0; 0.30.0: on, the owner's choice): growing left, "${mode}"`, { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="a"]')`, 'it mounts and draws');
    // the shelf pinned (a group needs a pin of its own to grow left: growing moves it), then the variant on
    await ev(`E.setText(E.getText() + 'x-editor:\\n  layout:\\n    shelf: { at: [4, 2] }\\n', { fit: true }); await tick(400); B.growSides({ left: true, back: true }); return 0;`);
    await until(`/shelf: \\{ at: \\[4, 2\\] \\}/.test(E.getText()) && I.canvas.pageXYOf(['boxes', 'b'])`, 'the shelf pinned');
    const P = `const P = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 6 }));`;
    // a, dragged left (screen up and left: -x) past the shelf's left margin, and dropped: b's place on screen before and after
    const r = await ev<{ b0: { x: number; y: number }; b1: { x: number; y: number }; bIn: number[]; dashed: boolean; hint: string }>(`${P} const c = I.canvas, at = c.pageXYOf(['boxes', 'a']), b0 = c.pageXYOf(['boxes', 'b']), el = document.elementFromPoint(at.x, at.y);
      const L = c.doc.scene.layout.byId, bIn = [L.get('b').box.x0 - L.get('shelf').box.x0, L.get('b').box.y0 - L.get('shelf').box.y0];
      P(el, 'pointerdown', at.x, at.y); let dashed = false, hint = '';
      for (let i = 1; i <= 10; i++) { P(c.stage, 'pointermove', at.x - i * 9, at.y - i * 5.2); await tick(90); dashed ||= !!document.querySelector('.iso-canvas .overlay .grow-was'); hint = document.querySelector('#se-st-hint')?.textContent || hint; }
      P(c.stage, 'pointerup', at.x - 90, at.y - 52); await tick(500); await I.canvas.drawn?.();
      return { b0, b1: c.pageXYOf(['boxes', 'b']), bIn, dashed, hint };`);
    assert.equal(r.dashed, true, 'the shelf grows left, its floor as it was dashed'); assert.match(r.hint, /within Shelf, which grows with it/);
    await until(`/    a: \\{ at: \\[/.test(E.getText())`, 'the pins written');
    const t = await ev<string>(`return E.getText();`);
    const at = (n: string) => JSON.parse(new RegExp(`    ${n}: \\{ at: (\\[[^\\]]*\\])`).exec(t)?.[1] ?? 'null') as number[] | null;
    const a = at('a')!, shelf = at('shelf')!;
    assert.ok(a[0] >= 0.6 - 1e-9, `a comes in to the shelf's margin: ${a}`);
    assert.ok(shelf[0] < 4, `the shelf moved left: ${shelf}`);
    const moved = Math.hypot(r.b1.x - r.b0.x, r.b1.y - r.b0.y);
    if (mode === 'pins') { assert.ok(at('b'), 'b pinned where it stands'); assert.ok(moved < 2, `b stays where it was on screen (${moved.toFixed(1)} px)`); }
    else {
      // b keeps its place in the shelf (pinned there by the drop if the re-layout would have moved it), so it moves with the shelf
      const b = at('b'); if (b) assert.deepEqual(b.map(v => +v.toFixed(3)), r.bIn.map(v => +v.toFixed(3)), 'b, if pinned, where it stood in the shelf');
      assert.ok(moved > 10, `b moves with the shelf (${moved.toFixed(1)} px)`);
    }
    assert.match(await ev<string>(`return I.doc.undoLabel;`), mode === 'pins' ? /\(Shelf grows that way\)/ : /\(Shelf grows and moves\)/);
    await ev(`I.doc.undo(); await tick(200); return 0;`);
    await until(`!/    a: \\{ at:/.test(E.getText()) && /shelf: \\{ at: \\[4, 2\\] \\}/.test(E.getText())`, 'one undo step takes it all back');
    await ev(`B.growSides({ left: true, back: true }); return 0;`);
  });
});

test('boxes/1 in Chrome (0.29.0, off until the owner answers): the left and back resize handles keep the far edge and the contents still', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="a"]')`, 'it mounts and draws');
    await ev(`E.setText(E.getText() + 'x-editor:\\n  layout:\\n    shelf: { at: [4, 2] }\\n', { fit: true }); await tick(400); B.growSides({ left: true, back: true }); return 0;`);
    await until(`/shelf: \\{ at: \\[4, 2\\] \\}/.test(E.getText())`, 'the shelf pinned');
    await ev(`I.doc.select([['boxes', 'shelf']], 'canvas'); await tick(150); return 0;`);
    await until(`document.querySelectorAll('.iso-canvas .overlay .size-handle').length === 8`, 'eight handles');
    // the left handle, dragged out (screen left and up: -x)
    const r = await ev<{ a0: { x: number; y: number }; a1: { x: number; y: number } }>(`const P = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 7 }));
      const c = I.canvas, a0 = c.pageXYOf(['boxes', 'a']), el = document.querySelector('.iso-canvas .overlay .size-handle[data-handle="left"]'), h = el.getBoundingClientRect(), x = h.x + h.width / 2, y = h.y + h.height / 2;
      P(el, 'pointerdown', x, y); for (let i = 1; i <= 6; i++) { P(c.stage, 'pointermove', x - i * 10, y - i * 5.8); await tick(50); } P(c.stage, 'pointerup', x - 60, y - 35); await tick(500);
      return { a0, a1: c.pageXYOf(['boxes', 'a']) };`);
    await until(`/shelf: \\{ kind: tray, label: Shelf, size: \\[/.test(E.getText())`, 'the size written');
    const t = await ev<string>(`return E.getText();`);
    const at = (n: string) => JSON.parse(new RegExp(`    ${n}: \\{ at: (\\[[^\\]]*\\])`).exec(t)?.[1] ?? 'null') as number[] | null;
    assert.ok(at('shelf')![0] < 4, `the shelf's corner moved left: ${at('shelf')}`);
    assert.ok(at('a') && at('b'), 'what it holds pinned, the other way');
    assert.ok(Math.hypot(r.a1.x - r.a0.x, r.a1.y - r.a0.y) < 2, `a stays where it was on screen (${JSON.stringify(r)})`);
    assert.equal(await ev<string>(`return I.doc.undoLabel;`), 'Resize Shelf');
    await ev(`I.doc.undo(); await tick(200); return 0;`);
    await until(`!/size:/.test(E.getText()) && !/    a: \\{ at:/.test(E.getText()) && /shelf: \\{ at: \\[4, 2\\] \\}/.test(E.getText())`, 'one undo step takes it all back');
    // a group the layout places (no pin in the file): all eight too; a resize on its left pins it where it stood, less the shift
    await ev(`E.setText(E.getText().replace(/x-editor:[\\s\\S]*$/, ''), { fit: true }); await tick(400); I.doc.select([['boxes', 'shelf']], 'canvas'); await tick(150); return 0;`);
    await until(`document.querySelectorAll('.iso-canvas .overlay .size-handle').length === 8`, 'eight handles on a group the layout places');
    await ev(`const P = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 8 }));
      const c = I.canvas, el = document.querySelector('.iso-canvas .overlay .size-handle[data-handle="left"]'), h = el.getBoundingClientRect(), x = h.x + h.width / 2, y = h.y + h.height / 2;
      P(el, 'pointerdown', x, y); for (let i = 1; i <= 6; i++) { P(c.stage, 'pointermove', x - i * 10, y - i * 5.8); await tick(50); } P(c.stage, 'pointerup', x - 60, y - 35); await tick(500); return 0;`);
    await until(`/    shelf: \\{ at: \\[/.test(E.getText()) && /size: \\[/.test(E.getText())`, 'the shelf pinned and sized, in one step');
    assert.equal(await ev<string>(`return I.doc.undoLabel;`), 'Resize Shelf');
    await ev(`B.growSides({ left: true, back: true }); return 0;`);
  });
});

test('boxes/1 in Chrome (0.31.0): the owner\'s drag keys: ⇧ keeps the move on a line (dotted), Ctrl half cells, both taken with the pointer still', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');
    // c, in the floor zone (room around it): dragged off at a slant, with ⇧ and without; then Ctrl pressed and let go, the pointer still
    const r = await ev<{ free: number[]; line: number[]; on: boolean; dotted: boolean; hintLine: boolean; half: number; halfAt: number[]; whole: number; wholeAt: number[]; unSt: boolean; dottedOff: boolean }>(`
      const c = I.canvas, at = c.pageXYOf(['boxes', 'c']), el = document.elementFromPoint(at.x, at.y);
      const P = (t, x, y, m = {}) => (t === 'pointerdown' ? el : c.stage).dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 7, ...m }));
      const K = (type, key, m) => window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, ...m }));
      // a slant on screen: mostly along one grid axis, a little along the other
      const to = { x: at.x + 46, y: at.y + 6 };
      P('pointerdown', at.x, at.y);
      for (let i = 1; i <= 6; i++) { P('pointermove', at.x + (to.x - at.x) * i / 6, at.y + (to.y - at.y) * i / 6); await tick(60); }
      const g = c.drag, free = [g.move.at[0] - g.start[0], g.move.at[1] - g.start[1]];
      // ⇧ pressed, the pointer still
      K('keydown', 'Shift', { shiftKey: true }); await tick(120);
      // (0.32.0) from the start on the grid, which the line runs through
      const o = g.lineAt ?? g.start, d = [g.move.at[0] - o[0], g.move.at[1] - o[1]], line = g.line ?? [];
      const on = !!g.line && Math.abs(d[0] * g.line[1] - d[1] * g.line[0]) < 1e-6;
      const dotted = !!document.querySelector('.iso-canvas .overlay .straight'), hintLine = /in a straight line/.test(document.querySelector('#se-st-hint')?.textContent ?? '');
      // ⇧ let go, Ctrl pressed: half cells, the pointer still
      K('keyup', 'Shift', {}); await tick(120);
      const unSt = !g.line, dottedOff = !document.querySelector('.iso-canvas .overlay .straight');
      K('keydown', 'Control', { ctrlKey: true }); await tick(120);
      const half = g.step, halfAt = [...g.move.at];
      K('keyup', 'Control', {}); await tick(120);
      const whole = g.step, wholeAt = [...g.move.at];
      c.stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); P('pointerup', to.x, to.y); await tick(100);
      return { free, line, on, dotted, hintLine, half, halfAt, whole, wholeAt, unSt, dottedOff };`);
    assert.ok(r.free[0] !== 0 && r.free[1] !== 0, `off at a slant without ⇧: ${r.free}`);
    assert.equal(r.on, true, `with ⇧, on its line: ${JSON.stringify(r)}`);
    assert.deepEqual([r.dotted, r.hintLine], [true, true], 'the line dotted, and the status bar says so');
    assert.deepEqual([r.unSt, r.dottedOff], [true, true], '⇧ let go: free again, no line');
    assert.equal(r.half, 0.5, 'Ctrl, the pointer still: half cells');
    assert.equal(r.whole, 1, 'Ctrl let go: whole cells');
    assert.equal(await ev<string>(`return E.getText();`), TEXT, 'Esc: nothing written');
  });
});

test('boxes/1 in Chrome (0.31.0): ⌥ at the start of a drag drags a copy: the original stays, the copy pinned where dropped, one undo step', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');
    const r = await ev<{ during: { fresh: boolean; name: string; orig: boolean }; at: number[]; start: number[]; bad: boolean }>(`
      const c = I.canvas, at = c.pageXYOf(['boxes', 'c']), el = document.elementFromPoint(at.x, at.y);
      const P = (t, x, y, m = {}) => (t === 'pointerdown' ? el : c.stage).dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 8, ...m }));
      const c0 = c.pageXYOf(['boxes', 'c']);
      P('pointerdown', at.x, at.y, { altKey: true });
      // three cells along the grid's x (screen right and down): clear of c, two cells wide
      const k = c.scale() * 34, ux = Math.cos(Math.PI / 6) * k, uy = 0.5 * k;
      for (let i = 1; i <= 6; i++) { P('pointermove', at.x + i * ux / 2, at.y + i * uy / 2); await tick(60); }
      const g = c.drag, during = { fresh: !!g?.fresh?.copy, name: g?.name, orig: Math.abs(c.pageXYOf(['boxes', 'c']).x - c0.x) < 1 };
      const res = { during, at: [...g.move.at], start: [...g.start], bad: !!g.invalid };
      P('pointerup', at.x + 3 * ux, at.y + 3 * uy); await tick(300);
      return res;`);
    assert.deepEqual(r.during, { fresh: true, name: 'c-2', orig: true }, 'the copy, c-2, is what moves; c stands where it stood');
    assert.notDeepEqual(r.at, r.start, 'moved off the original'); assert.equal(r.bad, false, `clear of c: ${r.at}`);
    await until(`/\\n  c-2:/.test(E.getText())`, 'the copy written');
    const t = await ev<string>(`return E.getText();`);
    const data = readBoxes(t).read!.data as { boxes: Record<string, Record<string, unknown>> };
    assert.deepEqual(data.boxes['c-2'], data.boxes.c, 'a copy of c: the same values (in the floor too)');
    assert.match(t, new RegExp(`c-2: \\{ at: \\[${r.at.join(', ')}\\] \\}`), 'pinned where it was dropped');
    assert.doesNotMatch(t, /\n {4}c: \{ at:/, 'the original not pinned: it stayed');
    assert.equal(await ev<boolean>(`return !document.querySelector('.rename-field input');`), true, 'a copy has its name: none asked');
    await ev(`I.doc.undo(); await tick(100); return 0;`);
    await until(`E.getText() === ${JSON.stringify(TEXT)}`, 'one undo step');
  });
});

test('boxes/1 in Chrome (0.31.0): the move handle takes a box anywhere: into another zone (one undo step), out of any, Esc puts it back', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');
    // press on a's move handle, go to a point in steps, then up (or Esc); what the drag says at the end
    const go = (to: string, end: 'up' | 'esc') => ev<{ handle: boolean; free: boolean; label: string; into: string | null; bad: boolean; at: number[]; start: number[]; parent: string }>(`
      const c = I.canvas;
      I.doc.select([['boxes', 'a']], 'canvas'); await tick(80);
      const h = document.querySelector('.iso-canvas .move-handle');
      if (!h) return { handle: false, free: false, label: '', into: null };
      const hr = h.getBoundingClientRect(), x0 = hr.x + hr.width / 2, y0 = hr.y + hr.height / 2, to = ${to};
      const P = (t, x, y, m = {}) => (t === 'pointerdown' ? h : c.stage).dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 9, ...m }));
      P('pointerdown', x0, y0);
      // a few pixels, then straight there: the box goes where the layout gives it room in what is under the pointer
      P('pointermove', x0 + 6, y0); await tick(60); P('pointermove', to.x, to.y); await tick(120);
      // (into a container) then onto where the trial drawing has it, the room the layout gives it there, in half cells (Ctrl: the
      // layout's place is on the half-cell grid)
      const m = to.own ? { ctrlKey: true } : {};
      const k = c.scale() * 34, cx = Math.cos(Math.PI / 6) * k;
      for (let i = 0; to.own && i < 3; i++) {
        const g = c.drag, dx = g.start[0] - g.move.at[0], dy = g.start[1] - g.move.at[1];
        to.x += (dx - dy) * cx; to.y += (dx + dy) * 0.5 * k; P('pointermove', to.x, to.y, m); await tick(120);
      }
      const g = c.drag, r = { handle: true, free: !!g?.fresh?.free, label: g?.fresh?.plan.label ?? '', into: g?.fresh?.plan.into ?? null, bad: !!g?.invalid, at: g?.move?.at, start: g?.start, parent: g?.parent?.id };
      if (${JSON.stringify(end)} === 'esc') { c.stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(200); }
      else { P('pointerup', to.x, to.y, m); await tick(300); }
      return r;`);
    // into the floor (a point on it clear of c): a leaves the shelf
    const floor = `(() => { const f = c.pageXYOf(['boxes', 'floor']), k = c.scale() * 34; return { x: f.x - k, y: f.y + k * 0.3, own: true }; })()`;
    const r = await go(floor, 'up');
    assert.equal(r.handle, true, 'a selected box has a move handle');
    assert.equal(r.bad, false, `a free spot in the floor: ${JSON.stringify(r)}`);
    assert.equal(r.free, true, 'the handle drags it as a move'); assert.match(r.label, /^Move box a into zone floor/, r.label);
    await until(`/\\n  a: \\{ in: floor/.test(E.getText())`, 'a written into the floor');
    const t = await ev<string>(`return E.getText();`);
    assert.match(t, /\n {4}a: \{ at: \[/, `pinned where it was dropped, in the floor: ${t}`);
    assert.deepEqual(readBoxes(t).diags, [], 'the file reads cleanly');
    await ev(`I.doc.undo(); await tick(150); return 0;`);
    await until(`E.getText() === ${JSON.stringify(TEXT)}`, 'one undo step');
    // Esc: nothing changes
    await go(floor, 'esc');
    assert.equal(await ev<string>(`return E.getText();`), TEXT, 'Esc puts all back');
    assert.equal(await ev<boolean>(`return !I.canvas.drag;`), true, 'and ends the drag');
    // out of any: dropped on nothing (well away from what is drawn)
    const away = `(() => { const s = c.pageXYOf(['boxes', 'shelf']), f = c.pageXYOf(['boxes', 'floor']); return { x: s.x + (s.x - f.x) * 1.5, y: s.y + (s.y - f.y) * 1.5 }; })()`;
    const o = await go(away, 'up');
    assert.match(o.label, /out of any tray/, o.label);
    await until(`/\\n  a: \\{ label: A \\}/.test(E.getText())`, 'a written out of the shelf');
  });
});

test('boxes/1 in Chrome (0.31.0): a slow machine\'s grow drag (the trial laid out late): the hint and the dashed floor agree once it lands, and nothing else jumps at the drop', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="a"]')`, 'it mounts and draws');
    const where = `const q = id => { const p = I.canvas.pageXYOf(['boxes', id]); return [Math.round(p.x), Math.round(p.y)]; }; return { floor: q('floor'), c: q('c') };`;
    const before = await ev<{ floor: number[]; c: number[] }>(where);
    // a's grow drag of the 0.28.0 test, each trial held back past the next move (I.canvas.trialDelay), so the pointer is always on
    // ahead of what is drawn; at the turns it rests until the trial lands; the drop comes at once after the last move (a stale trial)
    const r = await ev<{ wrong: string[]; rests: number }>(`
      const c = I.canvas, at = c.pageXYOf(['boxes', 'a']), el = document.elementFromPoint(at.x, at.y); c.trialDelay = 150;
      const P = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 6 }));
      const wrong = []; let rests = 0;
      const rest = async () => { await tick(400); const g = c.drag; if (!g?.move) return; rests++;
        const dashed = !!document.querySelector('.iso-canvas .overlay .grow-was'), words = /which grows with it/.test(document.querySelector('#se-st-hint')?.textContent ?? '');
        if (dashed !== words) wrong.push(JSON.stringify({ at: g.move.at, shown: g.shown, dashed, words })); };
      P(el, 'pointerdown', at.x, at.y);
      for (let i = 1; i <= 14; i++) { P(c.stage, 'pointermove', at.x - i * 12, at.y + i * 7); await tick(60); if (i % 5 === 0) await rest(); }
      await rest();
      for (let i = 13; i >= 0; i--) { P(c.stage, 'pointermove', at.x - i * 12, at.y + i * 7); await tick(60); if (i % 5 === 0) await rest(); }
      for (let i = 1; i <= 14; i++) { P(c.stage, 'pointermove', at.x - i * 12, at.y + i * 7); await tick(60); if (i % 5 === 0) await rest(); }
      P(c.stage, 'pointermove', at.x - 168, at.y + 98); P(c.stage, 'pointerup', at.x - 168, at.y + 98); c.trialDelay = 0;
      return { wrong, rests };`);
    assert.ok(r.rests >= 6, `${r.rests} rests checked`);
    assert.deepEqual(r.wrong, [], 'the hint says the shelf grows exactly while its old floor is dashed, once the trial has landed');
    await until(`/a: \\{ at: \\[/.test(E.getText())`, 'a pinned where it was dropped');
    await ev(`await tick(300); return 0;`);
    assert.deepEqual(await ev<{ floor: number[]; c: number[] }>(where), before, 'the shelf grew; the floor and c stayed where they were');
  });
});


test('boxes/1 in Chrome (0.32.0): ⇧ from a start between cells: every place on the line through the start rounded, the dotted line through it too', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');
    // c pinned between cells (as a layout may put a thing), then dragged with ⇧ along the screen's horizontal (the grid's [1, -1])
    await ev(`E.setText(${JSON.stringify(TEXT + 'x-editor:\n  layout:\n    c: { at: [0.3, 0.65] }\n')}, { fit: true }); await tick(400); return 0;`);
    const r = await ev<{ start: number[]; lineAt: number[] | null; line: number[] | null; steps: number[][]; dot: boolean }>(`
      const c = I.canvas, at = c.pageXYOf(['boxes', 'c']), el = document.elementFromPoint(at.x, at.y);
      // (⇧ at the press adds to the selection: it is held from the first move on)
      const P = (t, x, y) => (t === 'pointerdown' ? el : c.stage).dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 9, shiftKey: t !== 'pointerdown' }));
      P('pointerdown', at.x, at.y); const steps = [];
      for (let i = 1; i <= 12; i++) { P('pointermove', at.x + i * 9, at.y + (i % 3) - 1); await tick(60); if (c.drag?.move) steps.push([...c.drag.move.at]); }
      const g = c.drag, res = { start: [...g.start], lineAt: g.lineAt ? [...g.lineAt] : null, line: g.line ? [...g.line] : null, steps, dot: !!document.querySelector('.iso-canvas .overlay .straight') };
      c.stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); P('pointerup', at.x, at.y); await tick(100);
      return res;`);
    assert.ok(!r.start.every(Number.isInteger), `it started between cells: ${r.start}`);
    assert.deepEqual(r.line, [1, -1], 'on the diagonal that runs along the screen');
    assert.ok(r.lineAt && r.lineAt.every(Number.isInteger) && r.lineAt.every((v, i) => Math.abs(v - r.start[i]) <= 0.5 + 1e-9), `the line through the start rounded to the grid: ${r.lineAt} from ${r.start}`);
    assert.equal(r.dot, true, 'drawn dotted');
    const off = r.steps.filter(([x, y]) => Math.abs((x - r.lineAt![0]) + (y - r.lineAt![1])) > 1e-9);
    assert.ok(r.steps.length >= 8, `${r.steps.length} steps`);
    assert.deepEqual(off, [], `every place on the line x + y = ${r.lineAt![0] + r.lineAt![1]}: ${JSON.stringify(r.steps)}`);
    assert.ok(r.steps.some(([x]) => x >= 2), `it went along it: ${JSON.stringify(r.steps)}`);
  });
});

test('boxes/1 in Chrome (0.33.0): a draft restored unsaved is shown so: the host hears onDirtyChange(true), Save is on, Undo too; undone to the saved text, clean', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await drivePage(chrome!, (await bundled()).outputFiles![0].contents, '__boxes', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="c"]')`, 'it mounts and draws');
    // an edit, its history kept; the page opened again on the edited text (as a host reopens a draft), the history given back
    const r = await ev<{ before: boolean[]; after: boolean[]; save: boolean; undo: boolean; dirty: boolean; back: boolean[]; clean: boolean }>(`
      const H = B.history, t0 = E.getText();
      I.doc.typed([{ start: t0.indexOf('Two trays'), end: t0.indexOf('Two trays') + 3, text: 'Six' }]); await tick(100);
      const log = JSON.parse(JSON.stringify(H.revisionLog(I.doc))), draft = E.getText();
      E.setText(draft); await tick(200);
      const before = [...B.dirtyChanges];
      H.restoreLog(I.doc, log, { clean: false, cleanAt: H.textHash(t0) }); await tick(100);
      const after = B.dirtyChanges.slice(before.length);
      const save = !document.querySelector('#se-save')?.disabled, undo = !document.querySelector('#se-undo')?.disabled, dirty = I.doc.dirty;
      I.doc.undo(); await tick(100);
      return { before, after, save, undo, dirty, back: B.dirtyChanges.slice(before.length + after.length), clean: !I.doc.dirty && E.getText() === t0 };`);
    assert.equal(r.dirty, true, 'the model has it unsaved');
    assert.deepEqual(r.after, [true], `the host is told, once: ${JSON.stringify(r)}`);
    assert.deepEqual([r.save, r.undo], [true, true], 'Save and Undo on');
    assert.deepEqual([r.back, r.clean], [[false], true], 'undone to the saved text: clean, and the host told');
  });
});
