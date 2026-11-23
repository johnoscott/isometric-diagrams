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
    await until(`I.canvas.mode === '2d' && document.querySelector('.iso-canvas svg.scene.flat [data-id="a"]')`, 'the 2D view');
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
