// docs/EDITOR-GUIDE.md works as written (0.7.2): its code blocks (each "// file: NAME") are a project of their own,
// against the packed package installed from its tarball; it type-checks (strict, no skipLibCheck), its tests pass, and
// its page mounts the editor in Chrome.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { buildIso, PACKAGE } from '../scripts/build-iso.ts';
import { drivePage } from './adapters/page-driver.ts';
// @ts-ignore plain JS helper
import { chromePath } from '../scripts/chrome.mjs';

let chrome: string | undefined;
try { chrome = chromePath(); } catch { chrome = undefined; }
const ROOT = new URL('..', import.meta.url).pathname;
const GUIDE = readFileSync(join(ROOT, 'docs/EDITOR-GUIDE.md'), 'utf8');

/** the guide's files: its ```ts blocks whose first line is "// file: NAME" */
export const guideFiles = (md: string) => [...md.matchAll(/```ts\n\/\/ file: (\S+)\n([\s\S]*?)```/g)].map(m => ({ name: m[1], text: m[2] }));

let project: Promise<string> | undefined;
/** a host project: the guide's files, the package installed from its packed tarball, the types /editor names */
const host = () => (project ??= (async () => {
  const out = mkdtempSync(join(tmpdir(), 'guide-pkg-'));
  await buildIso(out);
  const app = mkdtempSync(join(tmpdir(), 'guide-host-'));
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', app], { cwd: out, encoding: 'utf8' })) as { filename: string }[];
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'boxes-editor', private: true, type: 'module' }));
  execFileSync('npm', ['i', '--offline', '--no-audit', '--no-fund', '--ignore-scripts', `./${packed.filename}`], { cwd: app, encoding: 'utf8' });
  // what section 4 says a host type-checking against /editor installs (here: this repo's copies)
  mkdirSync(join(app, 'node_modules', '@types'), { recursive: true });
  for (const dep of ['yaml', 'monaco-editor', '@types/node']) symlinkSync(join(ROOT, 'node_modules', dep), join(app, 'node_modules', dep));
  for (const f of guideFiles(GUIDE)) writeFileSync(join(app, f.name), f.text);
  return app;
})());

test('the guide has its three files: the adapter and view, the page, the adapter\'s tests', () => {
  assert.deepEqual(guideFiles(GUIDE).map(f => f.name), ['boxes.ts', 'page.ts', 'boxes.test.ts']);
});

test('the guide\'s code type-checks against the packed package (strict, no skipLibCheck)', { timeout: 180000 }, async () => {
  const app = await host();
  writeFileSync(join(app, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true, allowImportingTsExtensions: true, lib: ['ES2022', 'DOM'], types: ['node'] }, files: guideFiles(GUIDE).map(f => f.name) }));
  let out = '';
  try { execFileSync(join(ROOT, 'node_modules/.bin/tsc'), ['-p', app], { cwd: app, encoding: 'utf8' }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
  assert.equal(out, '');
});

test('the guide\'s adapter tests pass', { timeout: 180000 }, async () => {
  const app = await host();
  // a test run of its own (not a child of this one: without the runner's context, and reporting as TAP)
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const r = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--test', '--test-reporter=tap', 'boxes.test.ts'], { cwd: app, encoding: 'utf8', env });
  assert.match(r, /# pass 3\n# fail 0/);
});

test('the guide\'s page mounts the editor in Chrome: the drawing, the tree, the 3D | 2D switch, under a strict CSP', { skip: chrome ? false : 'no Chrome', timeout: 180000 }, async () => {
  const app = await host();
  // the guide's build command, as esbuild's API
  const r = await build({ entryPoints: [join(app, 'page.ts')], bundle: true, format: 'esm', write: false, outfile: join(app, 'dist/page.js'), loader: { '.css': 'text', '.yaml': 'text' }, logLevel: 'silent' });
  await drivePage(chrome!, r.outputFiles[0].contents, 'editorHandle', async ({ ev, until }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="a"]')`, 'it mounts and draws');
    const got = await ev<{ rows: string[]; drawn: string[]; views: string[]; problems: string }>(`return {
      rows: [...document.querySelectorAll('.trow')].map(r => r.dataset.id).filter(Boolean),
      drawn: [...new Set([...document.querySelectorAll('.iso-canvas svg.scene [data-id]')].map(e => e.dataset.id))].sort(),
      views: [...document.querySelectorAll('.view-seg .seg')].map(b => b.textContent),
      problems: document.querySelector('#se-problems, .problems')?.textContent ?? '' };`);
    for (const p of ['/boxes/a', '/boxes/shelf', '/links']) assert.ok(got.rows.includes(p), `the tree has ${p}`);
    for (const id of ['a', 'b', 'shelf', 'link-0']) assert.ok(got.drawn.includes(id), `drawn: ${id}`);
    assert.deepEqual(got.views, ['3D', '2D'], 'the 2D view is offered');
    // the switch to 2D draws the board
    await ev(`document.querySelector('.view-seg [data-v="2d"]').click();`);
    await until(`document.querySelector('.iso-canvas svg.scene.flat [data-id="a"]')`, 'the 2D view');
  });
});

// 0.7.4: a host's canvas marks. The overlay was unstyled outside the space editor, so a selection drew as a black
// shape over what it selected, and the hover mark took the pointer from its thing (and the hover flickered). Checked
// with the package's CSS (assets/app.css, which carries assets/marks.css) and with none at all (the overlay's defaults).
test('the guide\'s page: hover is stable and a selection is a tint, with the package\'s CSS and with none', { skip: chrome ? false : 'no Chrome', timeout: 180000 }, async () => {
  const app = await host();
  const r = await build({ entryPoints: [join(app, 'page.ts')], bundle: true, format: 'esm', write: false, outfile: join(app, 'dist/page.js'), loader: { '.css': 'text', '.yaml': 'text' }, logLevel: 'silent' });
  await drivePage(chrome!, r.outputFiles[0].contents, 'editorHandle', async ({ ev, until, cdp }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="a"]')`, 'it mounts and draws');
    for (const css of ['the package\'s', 'none']) {
      // (none for the marks: every rule that names the overlay taken out of the page's sheets, the layout kept)
      if (css === 'none') assert.ok(await ev<number>(`let n = 0; const drop = list => { for (let i = list.length - 1; i >= 0; i--) { const r = list[i]; if (r.selectorText !== undefined) { if (r.selectorText.includes('overlay')) { (r.parentRule ?? r.parentStyleSheet).deleteRule(i); n++; } } else if (r.cssRules) drop(r.cssRules); } }; for (const sh of document.styleSheets) drop(sh.cssRules); return n;`) > 10, 'the marks\' rules taken out');
      const c = await ev<{ x: number; y: number }>(`const b = document.querySelector('.iso-canvas svg.scene [data-id="a"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };`);
      // 40 small moves over the box: the hover mark stays drawn, and what is under the pointer is always the box
      const seen: { marks: number; under: string }[] = [];
      for (let i = 0; i < 40; i++) {
        const x = c.x + (i % 5) - 2, y = c.y + (i % 3) - 1;
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await ev(`await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));`);
        seen.push(await ev<{ marks: number; under: string }>(`const e = document.elementFromPoint(${x}, ${y}); return { marks: document.querySelectorAll('.iso-canvas .overlay .hover').length, under: e?.closest('.overlay') ? 'overlay' : (e?.closest('[data-id]')?.dataset.id ?? String(e?.tagName)) };`));
      }
      assert.ok(seen.every(s => s.under === 'a'), `${css} CSS: under the pointer, always the box: ${[...new Set(seen.map(s => s.under))]}`);
      assert.equal(new Set(seen.map(s => s.marks)).size, 1, `${css} CSS: the hover mark is stable: ${seen.map(s => s.marks).join('')}`);
      assert.ok(seen[0].marks >= 1, `${css} CSS: the hover is drawn`);
      // a click selects it: its ring is a tint (or nothing), never an opaque fill, and takes no pointer
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
      await until(`document.querySelector('.iso-canvas .overlay .ring')`, `${css} CSS: the selection ring`);
      const ring = await ev<{ fill: string; pe: string; under: string }>(`const r = document.querySelector('.iso-canvas .overlay .ring'), s = getComputedStyle(r); return { fill: s.fill, pe: s.pointerEvents, under: document.elementFromPoint(${c.x}, ${c.y})?.closest('[data-id]')?.dataset.id ?? '' };`);
      const alpha = ring.fill === 'none' ? 0 : Number(/\/\s*([\d.]+)\s*\)$/.exec(ring.fill)?.[1] ?? /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/.exec(ring.fill)?.[1] ?? 1);   // rgb(), rgba(), color(srgb … / a)
      assert.ok(alpha < 0.3, `${css} CSS: the ring's fill is a tint, not ${ring.fill}`);
      assert.equal(ring.pe, 'none', `${css} CSS: the ring takes no pointer`);
      assert.equal(ring.under, 'a', `${css} CSS: the box is still what is under the pointer`);
      await ev(`document.querySelector('.iso-canvas').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
    }
  });
});

// 0.7.5: the canvas's 3D | 2D switch morphs, as dualView does (view.flat.motion: 'auto' by default, 'always', 'never')
test('the guide\'s page: the switch morphs (a layer, then the new view alone), keeps the selection, survives an interrupt, and honours reduced motion', { skip: chrome ? false : 'no Chrome', timeout: 180000 }, async () => {
  const app = await host();
  const page = (motion: string | undefined) => {
    const name = `boxes-${motion ?? 'default'}`;
    const boxes = readFileSync(join(app, 'boxes.ts'), 'utf8').replace("flat: { load: async () => editor.flatCanvas,", `flat: { load: async () => editor.flatCanvas,${motion ? ` motion: '${motion}',` : ''}`);
    assert.ok(!motion || boxes.includes(`motion: '${motion}'`), 'the variant has its motion');
    writeFileSync(join(app, `${name}.ts`), boxes);
    writeFileSync(join(app, `page-${name}.ts`), readFileSync(join(app, 'page.ts'), 'utf8').replace("from './boxes.ts'", `from './${name}.ts'`));
    return build({ entryPoints: [join(app, `page-${name}.ts`)], bundle: true, format: 'esm', write: false, outfile: join(app, 'dist/page.js'), loader: { '.css': 'text', '.yaml': 'text' }, logLevel: 'silent' }).then(r => r.outputFiles[0].contents);
  };
  const state = `const st = document.querySelector('.canvas-stage'); return {
    layer: !!st.querySelector('svg.dual-morph'), scenes: [...st.querySelectorAll('svg.scene')].map(s => (s.classList.contains('flat') ? '2d' : '3d') + (s.style.visibility === 'hidden' ? ':hidden' : '')),
    ring: !!st.querySelector('svg.scene:not([style*="hidden"]) .overlay .ring') };`;
  // 'always' (even under reduced motion): the layer runs, then the new view alone, the selection still drawn
  await drivePage(chrome!, await page('always'), 'editorHandle', async ({ ev, until, cdp }) => {
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="a"]')`, 'it mounts');
    await ev(`document.querySelector('.trow[data-id="/boxes/a"]').click();`);
    await until(`document.querySelector('.iso-canvas .overlay .ring')`, 'a selected');
    await ev(`document.querySelector('.view-seg [data-v="2d"]').click();`);
    await until(`(() => { ${state} })().layer`, 'the morph layer');
    const during = await ev<{ scenes: string[] }>(state);
    assert.deepEqual([...during.scenes].sort(), ['2d:hidden', '3d:hidden'], 'both views laid out, hidden under the layer');
    await until(`(() => { ${state} })().layer === false`, 'the morph ends');
    const after = await ev<{ layer: boolean; scenes: string[]; ring: boolean }>(state);
    assert.deepEqual(after, { layer: false, scenes: ['2d'], ring: true }, 'the 2D view alone, its selection drawn');
    // an interrupt: back to 3D, and to 2D again mid-morph: it ends in 2D, exact
    await ev(`document.querySelector('.view-seg [data-v="3d"]').click();`);
    await until(`(() => { ${state} })().layer`, 'the morph back');
    await ev(`document.querySelector('.view-seg [data-v="2d"]').click();`);
    await until(`(() => { const s = (() => { ${state} })(); return !s.layer && s.scenes.length === 1 && s.scenes[0] === '2d'; })()`, 'interrupted: 2D, exact');
    assert.equal(await ev<boolean>(`return !!document.querySelector('.canvas-stage svg.scene .overlay .ring');`), true, 'still selected');
  });
  // the default ('auto') under reduced motion: no layer, the new view at once
  await drivePage(chrome!, await page(undefined), 'editorHandle', async ({ ev, until, cdp }) => {
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="a"]')`, 'it mounts');
    await ev(`window.__seen = false; new MutationObserver(() => { if (document.querySelector('svg.dual-morph')) window.__seen = true; }).observe(document.body, { subtree: true, childList: true });
      document.querySelector('.view-seg [data-v="2d"]').click();`);
    await until(`document.querySelector('.iso-canvas svg.scene.flat')`, 'the 2D view');
    assert.equal(await ev<boolean>(`await new Promise(r => setTimeout(r, 300)); return window.__seen;`), false, 'no morph under reduced motion');
    assert.equal(await ev<number>(`return document.querySelectorAll('.canvas-stage svg.scene').length;`), 1);
  });
});

// 0.8.2: in 2D the cards' text is readable in light and dark (it was a fixed dark colour); after an inline rename in the
// tree the focus stays in the tree, so ⌘Z undoes it at once
test('the guide\'s page: 2D cards\' text contrasts with their faces in light and dark; after a tree rename ⌘Z works at once', { skip: chrome ? false : 'no Chrome', timeout: 180000 }, async () => {
  const app = await host();
  const r = await build({ entryPoints: [join(app, 'page.ts')], bundle: true, format: 'esm', write: false, outfile: join(app, 'dist/page.js'), loader: { '.css': 'text', '.yaml': 'text' }, logLevel: 'silent' });
  await drivePage(chrome!, r.outputFiles[0].contents, 'editorHandle', async ({ ev, until, cdp }) => {
    await until(`document.title === 'ready' && document.querySelector('.iso-canvas svg.scene [data-id="a"]')`, 'it mounts');
    // ---- the rename: F2, a new name, Enter; the focus stays on its row; ⌘Z (a real key) undoes it ----
    const before = await ev<string>('return window.editorHandle.getText();');
    await ev(`document.querySelector('.trow[data-id="/boxes/a"]').focus();`);
    const key = async (k: string, code: string, vk: number, modifiers = 0) => {
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
    };
    await key('F2', 'F2', 113);
    await until(`document.activeElement?.classList.contains('tedit')`, 'the rename field');
    await ev(`document.activeElement.select();`);
    await cdp('Input.insertText', { text: 'apple' });
    await key('Enter', 'Enter', 13);
    await until(`window.editorHandle.getText().includes('apple:')`, 'renamed');
    await ev('await tick(600);');   // the reader's problems arrive and the tree repaints
    const focus = await ev<string>(`const a = document.activeElement; return a?.classList.contains('trow') ? a.dataset.id : a?.tagName ?? 'none';`);
    assert.equal(focus, '/boxes/apple', 'the focus stays on the renamed row');
    await key('z', 'KeyZ', 90, 4);
    await until(`window.editorHandle.getText() === ${JSON.stringify(before)}`, '⌘Z undoes the rename at once');
    // ---- 2D: each card's name against its face, light and dark ----
    await ev(`document.querySelector('.view-seg [data-v="2d"]').click();`);
    await until(`document.querySelector('.iso-canvas svg.scene.flat .card .lt') && !document.querySelector('svg.dual-morph')`, 'the 2D view');
    for (const scheme of ['light', 'dark']) {
      await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await ev('await tick(100);');
      const pairs = await ev<{ id: string; text: string; face: string }[]>(`return [...document.querySelectorAll('.iso-canvas svg.scene.flat .card')].map(c => ({ id: c.dataset.id, text: getComputedStyle(c.querySelector('.lt')).fill, face: getComputedStyle(c.querySelector('.face')).fill }));`);
      assert.ok(pairs.length >= 2, `${scheme}: cards`);
      const lum = (c: string) => { const v = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(x => x / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      for (const p of pairs) {
        const [a, b] = [lum(p.text), lum(p.face)].sort((x, y) => y - x);
        const ratio = (a + 0.05) / (b + 0.05);
        assert.ok(ratio >= 4.5, `${scheme}: ${p.id}'s name ${p.text} on ${p.face}: contrast ${ratio.toFixed(2)}`);
      }
    }
  });
});
