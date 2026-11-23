// dist-iso/ (R1 S8, docs/editor/LAYERS.md §5, §6.1): iso-render.js (L0–L2) and iso-editor.js (L0–L3), built into a
// scratch folder. Every source input is in the bundle's own layers, none of P or L4; the import boundary holds over
// the metafile's edges too (a second opinion on scripts/layers.ts's reading of the sources); the built iso-render.js
// draws a scene with a catalogue of its own; the sizes are the engine's figure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildIso, BUNDLES, type IsoBuild } from '../scripts/build-iso.ts';
import { word } from '../scripts/words.ts';
import { LAYERS, layerOf, mayImport, publicOf } from '../scripts/layers.ts';

const OUT = mkdtempSync(join(tmpdir(), 'dist-iso-'));
let built: Promise<IsoBuild[]> | undefined;
const bundles = () => (built ??= buildIso(OUT));
const DIRS: Record<string, string> = { core: 'src/iso-core', objects: 'src/iso-objects', viewer: 'src/iso-viewer', editor: 'src/iso-editor', systems: 'src/iso-systems' };

test('each dist-iso bundle is made of its own layers alone: no input from L4, nor from P but in the systems bundle', async () => {
  for (const b of await bundles()) {
    const allowed = BUNDLES[b.file].layers.map(l => DIRS[l]);
    const src = Object.keys(b.metafile.inputs).filter(i => i.startsWith('src/'));
    assert.ok(src.length > 30, `${b.file}: ${src.length} source inputs`);
    assert.deepEqual(src.filter(i => !allowed.some(d => i.startsWith(d + '/'))), [], `${b.file}: inputs outside ${allowed.join(', ')}`);
    assert.deepEqual(src.filter(i => !BUNDLES[b.file].layers.some(l => i.startsWith(`src/iso-${l}/`))), []);
  }
  const editor = (await bundles()).find(b => b.file === 'iso-editor.js')!;
  for (const m of ['src/iso-editor/ui/mount.ts', 'src/iso-editor/ui/setup.ts', 'src/iso-editor/ui/canvas.ts', 'src/iso-editor/ui/tree.ts']) assert.ok(m in editor.metafile.inputs, `iso-editor.js has ${m}`);
  assert.ok(!('src/iso-editor/ui/text.ts' in editor.metafile.inputs), 'no Monaco pane: a host gives its own');
});

test('the import boundary holds over the bundles\' metafiles: down, to public modules only', async () => {
  const pub = new Map(LAYERS.map(l => [l.name, publicOf(l)]));
  const bad: string[] = [];
  for (const b of await bundles()) for (const [file, inp] of Object.entries(b.metafile.inputs)) {
    const from = layerOf(file);
    if (!from) continue;
    for (const { path } of inp.imports) {
      const to = layerOf(path);
      if (!to || to === from) continue;
      if (!mayImport(from, to)) bad.push(`${file} → ${path}: ${from.name} may not import ${to.name}`);
      else if (!pub.get(to.name)!.has(path.slice(to.dir.length + 1))) bad.push(`${file} → ${path}: not public in ${to.name}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the built iso-render.js draws a scene with a catalogue of its own; the sizes', async () => {
  const bs = await bundles();
  const R = await import(pathToFileURL(join(OUT, 'iso-render.js')).href);
  assert.deepEqual(Object.keys(R).sort(), ['core', 'objects', 'viewer']);
  const cat = { regions: { tray: { shape: 'block', pad: 0.6, z: [0, 0.3], floor: true, role: 'server', labelStyle: 'floor' } }, nodes: { box: R.objects.boxAsset('box', 'A box', [2, 2, 1], 'lead') }, defaultNode: 'box' };
  const doc = { isodiag: 1, scenes: [{ id: 's', title: 'S', regions: [{ id: 't', kind: 'tray', nodes: [{ id: 'a' }, { id: 'b', 'right-of': 'a' }] }], routes: [{ id: 'r', from: 'a', to: 'b', kind: 'send' }] }] };
  const c = R.objects.compileRaw(doc, readFileSync(new URL('../themes/default.yaml', import.meta.url), 'utf8'), cat);
  assert.deepEqual(c.diags.filter((d: { severity: string }) => d.severity === 'error'), []);
  for (const id of ['t', 'a', 'b', 'r']) assert.match(c.scenes[0].rendered.svg, new RegExp(`data-id="${id}"`));
  const E = await import(pathToFileURL(join(OUT, 'iso-editor.js')).href);
  for (const f of ['mountEditor', 'setupFor', 'commandsFor', 'canvasView', 'treeView']) assert.equal(typeof E.editor[f], 'function', f);
  for (const b of bs) console.log(`# ${b.file}: ${b.bytes} bytes, ${b.gzip} gzipped`);
});

// ---- the package (0.5.1): a project of its own depends on dist-iso as @johnoscott/isometric-engine ----
import { existsSync, mkdirSync, symlinkSync, writeFileSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ASSETS, PACKAGE, PACKAGE_FILES, INLINE_UNSAFE } from '../scripts/build-iso.ts';
import { bundlePage, drivePage } from './adapters/page-driver.ts';
import { build } from 'esbuild';
// @ts-ignore plain JS helper
import { chromePath } from '../scripts/chrome.mjs';
let chrome: string | undefined;
try { chrome = chromePath(); } catch { chrome = undefined; }

test('dist-iso is a package: its exports exist, its assets are there, and no Node-only name is declared', async () => {
  await bundles();
  const pkg = JSON.parse(readFileSync(join(OUT, 'package.json'), 'utf8'));
  assert.equal(pkg.name, PACKAGE);
  assert.equal(PACKAGE, '@johnoscott/isometric-engine');
  assert.equal(pkg.version, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  for (const e of ['./render', './editor', './systems']) for (const f of Object.values(pkg.exports[e]) as string[]) assert.ok(existsSync(join(OUT, f)), `${e}: ${f}`);
  for (const a of Object.keys(ASSETS)) assert.ok(existsSync(join(OUT, a)), a);
  const sprite = readFileSync(join(OUT, 'assets/icons.svg'), 'utf8');
  assert.equal((sprite.match(/<symbol id="se-i-/g) ?? []).length, 23, 'L3\'s icons, as a file');
  const viewer = readFileSync(join(OUT, 'types/iso-viewer/index.d.ts'), 'utf8');
  assert.doesNotMatch(viewer, /playerScript|bundle\./, 'the code leaves playerScript out; so do its types');
  // 0.9.0: MIT (the repository's LICENSE, in the package), published to npmjs, public
  assert.equal(pkg.license, 'MIT');
  assert.equal(readFileSync(join(OUT, 'LICENSE'), 'utf8'), readFileSync(new URL('../LICENSE', import.meta.url), 'utf8'));
  assert.match(readFileSync(join(OUT, 'LICENSE'), 'utf8'), /^MIT License\n/);
  assert.equal(pkg.private, undefined, 'a private package can\'t be published');
  assert.deepEqual(pkg.publishConfig, { registry: 'https://registry.npmjs.org/', access: 'public' });
  // 0.10.0: the public repository and its site (never the private one)
  assert.deepEqual(pkg.repository, { type: 'git', url: 'git+https://github.com/johnoscott/isometric-diagrams.git' });
  assert.equal(pkg.homepage, 'https://johnoscott.github.io/isometric-diagrams/');
  assert.deepEqual(pkg.bugs, { url: 'https://github.com/johnoscott/isometric-diagrams/issues' });
  assert.deepEqual(pkg.files, PACKAGE_FILES);
  for (const f of ['LICENSES/yaml.txt', 'LICENSES/lucide-static.txt']) assert.ok(existsSync(join(OUT, f)), f);
  assert.match(readFileSync(join(OUT, 'README.md'), 'utf8'), /npm i @johnoscott\/isometric-engine/);
  assert.match(readFileSync(join(OUT, 'README.md'), 'utf8'), /EDITOR-GUIDE\.md/);
  assert.equal(readFileSync(join(OUT, 'EDITOR-GUIDE.md'), 'utf8'), readFileSync(new URL('../docs/EDITOR-GUIDE.md', import.meta.url), 'utf8'));
});

test('the package\'s tarball holds the bundles, their declarations, the assets, the notices and the README: nothing else', { timeout: 60000 }, async () => {
  await bundles();
  const [r] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: OUT, encoding: 'utf8' })) as { files: { path: string }[] }[];
  const paths = r.files.map(f => f.path).sort();
  const allowed = (p: string) => p === 'package.json' || PACKAGE_FILES.some(f => (f.endsWith('/') ? p.startsWith(f) : p === f));
  assert.deepEqual(paths.filter(p => !allowed(p)), []);
  for (const f of PACKAGE_FILES) assert.ok(paths.some(p => (f.endsWith('/') ? p.startsWith(f) : p === f)), f);
  assert.ok(!paths.some(p => p.endsWith('.map') || p.includes('meta')), 'no source maps or metafiles');
});

// 0.9.0 (D(b)): the package carries no one else's marks. Packed for real, every file of the tarball is read: no brand
// name, and no painter, class or schema value of one (cursor only as a name: the CSS property and the word are fine).
export const BRANDS: [string, RegExp][] = [
  // by their sha256 (scripts/words.ts), so the gate names none of them: six makers' names, and the two names a painter
  // or class of the cursor brand had (the word alone is the CSS property)
  ['brand names', word('c857d09db23e6822e3600bc06ad8d58f92ed62bc8efd81c753f77048662cb97d', 'c70eca6b0f88f44d81a41311647e50fda1ac454ec04ffd442b0eb4743a993131',
    'add92b9cde2bdbf3daaf65a0db79e9b1a7fa428b71b4d6ce38c742eb6dca0c1c', '7d3194f79e645c42e4396dda38be04766810ec6a00d00aced3ffc2a0a1f1a9ef',
    '5d72436256ada53828b51895a94bb8489e9f1ac4fe937a8024ef1594e7045ff6', '3ea125d0bff386e6754b3782b300016fc79a9cf8f8669c0a5c3db64467ddb681')],
  ['the cursor brand, as a name', word('e20a076147da0146b8c9eb8cec506c98dd99536561e9ceac04d6902b4d0720ff', '70815454441c0420a104b2b74ad2a1192e2fb96e8165f82545ab22b0d0ca4d8e')],
];
/** the repository's own words: none in any file of the package (its npm page shows README.md and package.json) */
export const INTERNAL: [string, RegExp][] = [
  ['the private repository\'s name', word('65ab691b51a90c58cff0984c74086984605b082e79cd92cc6f4cfbaa45d23b77')], ['the layer above\'s name', word('5fdff287404b2bfd0c1907d56ddac9e29badda7d0e09c5408301f36e47f42da2', '00c5d38bf900180869b6b335905483e93bf2363afa55b61d7f7b8dff9ea8d908')], ['the build script', /build-iso/gi], ['the layer above (L4)', /\bL4\b/g],
];
/** and on the page: the engine's term for a catalogue of kinds, which its sources may use */
const PAGE_ONLY: [string, RegExp][] = [['the kind pack', /kind pack/gi]];
test('the packed tarball holds no brand marks and none of the repository\'s own words: no brand name, painter, class or schema value, in any file', { timeout: 60000 }, async () => {
  await bundles();
  const dir = mkdtempSync(join(tmpdir(), 'iso-pack-'));
  try {
    const [r] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', dir], { cwd: OUT, encoding: 'utf8' })) as { filename: string }[];
    execFileSync('tar', ['xzf', join(dir, r.filename), '-C', dir]);
    const files: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
    walk(join(dir, 'package'));
    assert.ok(files.length > 100, `${files.length} files`);
    const bad = files.flatMap(f => {
      const t = `${relative(dir, f)}\n${readFileSync(f, 'latin1')}`, at = relative(join(dir, 'package'), f);
      const checks = [...BRANDS, ...INTERNAL, ...(['README.md', 'package.json'].includes(at) ? PAGE_ONLY : [])];
      return checks.flatMap(([l, re]) => (t.match(re) ?? []).map(m => `${at}: ${l}: ${m}`));
    });
    assert.deepEqual(bad, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a consumer outside the repo type-checks against the package (no skipLibCheck), and every runtime export is declared', { timeout: 120000 }, async () => {
  await bundles();
  // a copy, as a project vendors it: the package's own imports resolve from the consumer's node_modules
  const app = mkdtempSync(join(tmpdir(), 'iso-consumer-'));
  mkdirSync(join(app, 'node_modules'), { recursive: true });
  cpSync(OUT, join(app, 'node_modules', PACKAGE), { recursive: true });
  for (const dep of ['yaml', 'monaco-editor']) symlinkSync(new URL(`../node_modules/${dep}`, import.meta.url).pathname, join(app, 'node_modules', dep));
  const E = await import(pathToFileURL(join(OUT, 'iso-editor.js')).href), Y = await import(pathToFileURL(join(OUT, 'iso-systems.js')).href);
  // every runtime name of every namespace, used through the declarations: a name the types lack is an error
  const uses = [...Object.entries(E as Record<string, object>).flatMap(([ns, m]) => Object.keys(m).map(k => `void L.${ns}.${k};`)),
    ...Object.entries(Y as Record<string, object>).flatMap(([ns, m]) => Object.keys(m).map(k => `void Y.${ns}.${k};`))];
  writeFileSync(join(app, 'main.ts'), [
    `import * as L from '${PACKAGE}/editor';`,
    `type Adapter = L.editor.DomainAdapter;`,
    `export const mount = (el: HTMLElement, a: Adapter, v: L.editor.DomainView<unknown, L.editor.CanvasDrawing>) => L.editor.mountEditor(el, { text: '' }, L.editor.setupFor(a, v));`,
    `import * as R from '${PACKAGE}/render';`,
    `export const theme = (t: string) => R.core.loadTheme(t);`,
    `import * as Y from '${PACKAGE}/systems';`,
    `export const drawing = (yaml: string, theme: string): Y.systems.Compiled => Y.systems.compile(yaml, theme);`,
    ...uses,
  ].join('\n'));
  writeFileSync(join(app, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true, lib: ['ES2022', 'DOM'], types: [] }, files: ['main.ts'] }));
  let out = '';
  try { execFileSync(new URL('../node_modules/.bin/tsc', import.meta.url).pathname, ['-p', app], { cwd: app, encoding: 'utf8' }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
  assert.equal(out, '', 'tsc over the consumer');
  assert.ok(uses.length > 300, `${uses.length} runtime names checked`);
});

/** a host's page (as a host's diagram pages make it): the package in its node_modules, a YAML drawing, an entry
 *  that imports only the package's entry points and assets; its folder */
function hostApp(): string {
  const app = mkdtempSync(join(tmpdir(), 'iso-host-'));
  cpSync(OUT, join(app, 'node_modules', PACKAGE), { recursive: true });
  cpSync(new URL('./fixtures/flat/arch.yaml', import.meta.url), join(app, 'drawing.yaml'));
  // what a host's page does: no deep paths, the package's entry points and assets only
  writeFileSync(join(app, 'entry.ts'), `
import { core, viewer, systems } from '${PACKAGE}/systems';
// @ts-ignore text
import THEME from '${PACKAGE}/assets/default-theme.yaml';
// @ts-ignore text
import SRC from './drawing.yaml';
const H: any = (window as any).__host = { errors: [], violations: [] };
addEventListener('error', e => H.errors.push(String(e.message)));
addEventListener('securitypolicyviolation', e => H.violations.push(e.violatedDirective));
const STYLES: any = { user: { color: 'user' }, send: { color: 'send' }, reply: { color: 'reply' }, event: { color: 'event' }, control: { color: 'control' } };
const d = systems.compile(String(SRC), String(THEME));
H.diags = d.diags.filter((x: any) => x.severity === 'error').map((x: any) => x.message);
const style = document.createElement('style');
style.textContent = [core.themeCss(d.theme!), systems.DRAWING_CSS, viewer.flatCss(STYLES), viewer.DUAL_VIEW_CSS].join('\\n');
document.head.append(style);
const fig = document.createElement('figure'); document.body.append(fig);
H.view = viewer.dualView(fig, d.scenes[0], { mode: viewer.storedMode() ?? '3d', styles: STYLES, title: 'a drawing', duration: 0 });
H.toggle = viewer.viewToggle(document.body, [H.view]);
document.title = 'ready';
`);
  return app;
}

test('a page made as a host makes it (a YAML drawing compiled, in 3D and 2D, with the switch), importing only the package: in Chrome, under a strict CSP', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await bundles();
  const app = hostApp();
  const b = await bundlePage(join(app, 'entry.ts'));
  const inputs = Object.keys(b.metafile!.inputs);
  assert.deepEqual(inputs.filter(i => !i.includes(`node_modules/${PACKAGE}/`) && !/(entry\.ts|drawing\.yaml)$/.test(i)), [], 'the package and the page alone');
  await drivePage(chrome!, b.outputFiles![0].contents, '__host', async ({ ev, until }) => {
    await until(`document.title === 'ready'`, 'the page');
    const three = await ev<{ diags: string[]; ids: number; mode: string }>(`return { diags: B.diags, ids: B.view.svgOf('3d').querySelectorAll('[data-id]').length, mode: B.view.mode };`);
    assert.deepEqual(three.diags, []);
    assert.ok(three.ids > 20, `${three.ids} things drawn in 3D`);
    await ev(`B.toggle.querySelector('[data-mode="2d"]').click(); await tick(100);`);
    await until(`B.view.root.dataset.mode === '2d'`, 'the 2D view');
    const two = await ev<{ cards: number; panels: number; links: number }>(`const s = B.view.svgOf('2d'); return { cards: s.querySelectorAll('g.card').length, panels: s.querySelectorAll('g.panel').length, links: s.querySelectorAll('path.conn').length };`);
    assert.deepEqual(two, { cards: 12, panels: 8, links: 9 });
    assert.deepEqual(await ev(`return { errors: B.errors, violations: B.violations };`), { errors: [], violations: [] });
  });
});

test('every bundle is safe to inline in an HTML page: no "<!--", "<script" or "</script" in any (0.7.1)', async () => {
  for (const b of await bundles()) {
    const js = readFileSync(join(OUT, b.file), 'utf8');
    assert.equal(INLINE_UNSAFE.exec(js)?.[0], undefined, b.file);
  }
});

test('a host\'s own bundle of the package is safe to inline too (minified or not), and renders inlined in a page: in Chrome', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  await bundles();
  const app = hostApp();
  // a host bundles the package again (esbuild prints every string anew): what it prints must be safe as well
  for (const minify of [false, true]) {
    const r = await build({ entryPoints: [join(app, 'entry.ts')], bundle: true, format: 'esm', target: 'es2022', platform: 'browser', write: false, minify, loader: { '.yaml': 'text' }, logLevel: 'silent' });
    assert.equal(INLINE_UNSAFE.exec(r.outputFiles[0].text)?.[0], undefined, `minify: ${minify}`);
  }
  const r = await build({ entryPoints: [join(app, 'entry.ts')], bundle: true, format: 'esm', target: 'es2022', platform: 'browser', write: false, minify: true, loader: { '.yaml': 'text' }, logLevel: 'silent' });
  // the page as one file: the script inline, no CSP (as a page opened from disk)
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>page</title></head><body><script type="module">${r.outputFiles[0].text}</script></body></html>`;
  await drivePage(chrome!, new Uint8Array(), '__host', async ({ ev, until }) => {
    await until(`document.title === 'ready'`, 'the inlined page runs');
    const got = await ev<{ diags: string[]; ids: number; after: string }>(`return { diags: B.diags, ids: B.view.svgOf('3d').querySelectorAll('[data-id]').length, after: document.body.lastElementChild.tagName };`);
    assert.deepEqual(got.diags, []);
    assert.ok(got.ids > 20, `${got.ids} things drawn`);
    await ev(`B.view.morph('2d');`);
    await until(`B.view.root.dataset.mode === '2d' && B.view.svgOf('2d').querySelectorAll('g.card').length === 12`, 'its 2D view');
    assert.deepEqual(await ev(`return B.errors;`), []);
  }, '1280,860', { html, csp: null });
});

test('a host that only renders installs the package and nothing else, and type-checks against /render and /systems with nothing else installed (0.7.1)', { timeout: 180000 }, async () => {
  await bundles();
  const pkg = JSON.parse(readFileSync(join(OUT, 'package.json'), 'utf8'));
  for (const k of ['dependencies', 'peerDependencies', 'peerDependenciesMeta', 'optionalDependencies']) assert.equal(pkg[k], undefined, `no ${k}`);
  const app = mkdtempSync(join(tmpdir(), 'iso-render-only-'));
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', app], { cwd: OUT, encoding: 'utf8' })) as { filename: string }[];
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'host', private: true, type: 'module' }));
  execFileSync('npm', ['i', '--offline', '--no-audit', '--no-fund', '--ignore-scripts', `./${packed.filename}`], { cwd: app, encoding: 'utf8' });
  const tree = JSON.parse(execFileSync('npm', ['ls', '--all', '--json'], { cwd: app, encoding: 'utf8' })) as { dependencies: Record<string, { dependencies?: object }> };
  assert.deepEqual(Object.keys(tree.dependencies), [PACKAGE]);
  assert.equal(tree.dependencies[PACKAGE].dependencies, undefined, 'it brings nothing');
  const R = await import(pathToFileURL(join(OUT, 'iso-render.js')).href), Y = await import(pathToFileURL(join(OUT, 'iso-systems.js')).href);
  const uses = [...Object.entries(R as Record<string, object>).flatMap(([ns, m]) => Object.keys(m).map(k => `void R.${ns}.${k};`)),
    ...Object.entries(Y as Record<string, object>).flatMap(([ns, m]) => Object.keys(m).map(k => `void Y.${ns}.${k};`))];
  writeFileSync(join(app, 'main.ts'), [`import * as R from '${PACKAGE}/render';`, `import * as Y from '${PACKAGE}/systems';`, ...uses].join('\n'));
  writeFileSync(join(app, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true, lib: ['ES2022', 'DOM'], types: [] }, files: ['main.ts'] }));
  let out = '';
  try { execFileSync(new URL('../node_modules/.bin/tsc', import.meta.url).pathname, ['-p', app], { cwd: app, encoding: 'utf8' }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
  assert.equal(out, '', 'tsc, with neither yaml nor monaco-editor installed');
});

test('the package\'s modules (0.9.0): its sources and their JavaScript, and exactly the layers\' public modules as subpaths; a host imports per module, type-checks, bundles (either) and runs in Node', { timeout: 180000 }, async () => {
  await bundles();
  const { moduleExports, SOURCE_LAYERS } = await import('../scripts/build-iso.ts');
  const pkg = JSON.parse(readFileSync(join(OUT, 'package.json'), 'utf8')) as { exports: Record<string, unknown> };
  const mods = Object.entries(pkg.exports).filter(([k]) => k.startsWith('./modules/'));
  const want = SOURCE_LAYERS.flatMap(l => [...publicOf(l)].map(m => `./modules/${l.dir.slice(4)}/${m.replace(/\.ts$/, '')}`)).sort();
  assert.deepEqual(mods.map(([k]) => k).sort(), want);
  assert.deepEqual(Object.fromEntries(mods), moduleExports());
  // each subpath: its declarations (a .d.ts), its source (the "source" condition) and its JavaScript (the default), or a file
  const targets = (v: unknown) => typeof v === 'string' ? [v] : Object.values(v as Record<string, string>);
  for (const [, v] of mods) for (const f of targets(v)) assert.ok(existsSync(join(OUT, f)), f);
  assert.deepEqual(readdirSync(join(OUT, 'src')).sort(), ['iso-core', 'iso-editor', 'iso-objects', 'iso-systems', 'iso-viewer'], 'the layers\' sources and nothing else');
  for (const k of ['./modules/iso-editor/ui/text', './modules/iso-editor/ui/monaco-entry', './modules/iso-core/schema-errors']) assert.ok(k in pkg.exports, k);
  // a host bundling per module: two modules, by subpath, type-checked and bundled
  const app = mkdtempSync(join(tmpdir(), 'iso-modules-'));
  cpSync(OUT, join(app, 'node_modules', PACKAGE), { recursive: true });
  for (const dep of ['yaml', 'ajv', 'monaco-editor', 'esbuild']) symlinkSync(new URL(`../node_modules/${dep}`, import.meta.url).pathname, join(app, 'node_modules', dep));
  writeFileSync(join(app, 'main.ts'), [
    `import { parse } from '${PACKAGE}/modules/iso-core/parse';`,
    `import { toPointer } from '${PACKAGE}/modules/iso-editor/path';`,
    `import type { ClipboardAdapter } from '${PACKAGE}/modules/iso-editor/adapter';`,
    `export const a: ClipboardAdapter | undefined = undefined;`,
    `export const p = toPointer(['boxes', 'a']), d = parse('a: 1').data;`,
  ].join('\n'));
  writeFileSync(join(app, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true, allowImportingTsExtensions: true, skipLibCheck: true, lib: ['ES2022', 'DOM'], types: [] }, files: ['main.ts'] }));
  let out = '';
  try { execFileSync(new URL('../node_modules/.bin/tsc', import.meta.url).pathname, ['-p', app], { cwd: app, encoding: 'utf8' }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
  assert.equal(out, '');
  const inputsOf = async (conditions?: string[]) => Object.keys((await build({ entryPoints: [join(app, 'main.ts')], bundle: true, format: 'esm', write: false, logLevel: 'silent', metafile: true, ...(conditions ? { conditions } : {}) })).metafile!.inputs);
  const js = await inputsOf(), ts = await inputsOf(['source']);
  assert.ok(js.some(i => i.endsWith('js/iso-core/parse.js')) && js.some(i => i.endsWith('js/iso-editor/path.js')), 'bundled from the package\'s JavaScript by default');
  assert.ok(ts.some(i => i.endsWith('src/iso-core/parse.ts')) && ts.some(i => i.endsWith('src/iso-editor/path.ts')), 'bundled from its sources under the "source" condition');
  for (const inputs of [js, ts]) assert.ok(!inputs.some(i => i.includes('iso-editor.js')), 'not from the barrel bundle');
  // Node, which won't strip types under node_modules, runs the JavaScript (a module that loads JSON, too)
  writeFileSync(join(app, 'run.mjs'), `import { parse } from '${PACKAGE}/modules/iso-core/parse'; import { toPointer } from '${PACKAGE}/modules/iso-editor/path'; import * as k from '${PACKAGE}/modules/iso-core/kernel'; console.log(JSON.stringify([toPointer(['boxes', 'a']), parse('a: 1').data, typeof k]));`);
  assert.equal(execFileSync(process.execPath, ['run.mjs'], { cwd: app, encoding: 'utf8' }).trim(), JSON.stringify(['/boxes/a', { a: 1 }, 'object']));
});

// 0.12.2: a fresh TypeScript host with nothing but the package: an import of every subpath type-checks, strict, under
// bundler and NodeNext resolution (before, the modules' types were .ts sources, checked as the host's own code: 41
// errors inside the package). With the packages the declarations name installed, it needs no skipLibCheck either.
test('a fresh host type-checks an import of every subpath, strict, with nothing else installed; and without skipLibCheck given yaml, ajv and monaco-editor (0.12.2)', { timeout: 180000 }, async () => {
  await bundles();
  const pkg = JSON.parse(readFileSync(join(OUT, 'package.json'), 'utf8')) as { exports: Record<string, unknown> };
  const typed = Object.entries(pkg.exports).filter(([, v]) => typeof v === 'object') as [string, { types?: string; source?: string; default: string }][];
  assert.ok(typed.length > 90, `${typed.length} subpaths`);
  for (const [k, v] of typed) {
    assert.match(v.types ?? '', /\.d\.ts$/, `${k}: its types are declarations`);
    assert.equal(Object.keys(v)[0], 'types', `${k}: types first`);
    for (const [c, f] of Object.entries(v)) if (c !== 'source') assert.doesNotMatch(f, /(?<!\.d)\.ts$/, `${k}: TypeScript source only under "source"`);
  }
  const app = mkdtempSync(join(tmpdir(), 'iso-fresh-'));
  cpSync(OUT, join(app, 'node_modules', PACKAGE), { recursive: true });
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'host', private: true, type: 'module' }));
  writeFileSync(join(app, 'main.ts'), [
    ...typed.map(([k], i) => `import * as m${i} from '${PACKAGE}${k.slice(1)}';\nexport const u${i}: object = m${i};`),
    `import { viewer } from '${PACKAGE}/render';`,
    `const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');`,
    `export const layer: viewer.MorphLayer = viewer.buildLayer(document.body, svg, svg, '3d');`,
    `layer.at(viewer.ease(viewer.clamp(0.5)));`,
  ].join('\n'));
  const check = (moduleResolution: string, module: string, skipLibCheck: boolean) => {
    writeFileSync(join(app, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module, moduleResolution, strict: true, noEmit: true, skipLibCheck, lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: [] }, files: ['main.ts'] }));
    try { execFileSync(new URL('../node_modules/.bin/tsc', import.meta.url).pathname, ['-p', app], { cwd: app, encoding: 'utf8' }); return ''; }
    catch (e) { return String((e as { stdout?: string }).stdout ?? e); }
  };
  assert.equal(check('bundler', 'ESNext', true), '', 'bundler, nothing else installed');
  assert.equal(check('nodenext', 'NodeNext', true), '', 'nodenext, nothing else installed');
  for (const dep of ['yaml', 'ajv', 'monaco-editor']) symlinkSync(new URL(`../node_modules/${dep}`, import.meta.url).pathname, join(app, 'node_modules', dep));
  assert.equal(check('bundler', 'ESNext', false), '', 'bundler, without skipLibCheck');
});
