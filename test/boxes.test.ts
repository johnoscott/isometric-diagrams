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
      const inp = document.querySelector('dialog.dlg .field input'); inp.value = 'alpha'; inp.dispatchEvent(new Event('input')); await tick(); document.querySelector('dialog.dlg button[value="ok"]').click();`);
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
      document.querySelector('dialog.dlg button[value="cancel"]')?.click(); await tick();
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
      document.querySelector('dialog.dlg button[value="cancel"]')?.click(); await tick();`);
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
      P(btn, 'pointerup', at.x, at.y); await tick(); document.querySelector('dialog.dlg button[value="cancel"]')?.click(); await tick();`;
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
    await ev(dropBox(`const r = document.querySelector('.iso-canvas svg.scene.flat [data-id="shelf"] rect').getBoundingClientRect(); const at = { x: r.left + 6, y: r.bottom - 6 }`));
    await until(`/\\n  box-1:/.test(E.getText())`, 'added in 2D');
    assert.equal(parsed(await ev<string>(`return E.getText();`)).boxes['box-1'].in, 'shelf');
    await undo();
    const bad = await ev<{ violations: string[]; errors: string[] }>(`return { violations: B.violations, errors: B.errors };`);
    assert.deepEqual(bad, { violations: [], errors: [] });
  });
});

// 0.10.1, from the cloud editor's palette turn: a long palette scrolls (its items keep their height), and a palette add
// as the page's first action leaves the focus on the canvas once the name dialog is cancelled, so a real ⌘Z (on the
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
    await until(`/\\n  box-1:/.test(E.getText()) && document.querySelector('dialog.dlg[open]')`, 'added, its name asked');
    await ev(`document.querySelector('dialog.dlg[open]').close('cancel'); await tick();`);
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
    await ev(`document.querySelector('.palette .pal-item[data-entry="2"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick(); document.querySelector('dialog.dlg button[value="cancel"]')?.click(); await tick();`);
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
    await until(`document.querySelector('dialog.dlg[open]')`, 'added, its name asked');
    await ev(`document.querySelector('dialog.dlg[open]').close('cancel'); await tick();`);
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
    await until(`document.querySelector('dialog.dlg[open]')`, 'dropped, its name asked');
    await ev(`document.querySelector('dialog.dlg[open]').close('cancel'); await tick(200);`);
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
