// dist-iso/ (R1 S8, docs/editor/LAYERS.md §5): the generic engine as two bundles, built and checked, not shipped.
//   - iso-render.js: L0–L2 (export { core, objects, viewer }: each layer's public API, as its index.ts has it);
//   - iso-editor.js: L0–L3 (the same, and editor).
// Each proves that its layers bundle without a single module of P or L4 (esbuild's metafile lists every input) and
// gives a size figure for the engine. Beside them (0.5.1) is a package, @johnoscott/isometric-engine (0.6.3; first iso-engine): each bundle's declarations, L3's
// plain skin and a theme, a package.json and a README, so a project of its own can vendor a tagged build. dist-iso/ is
// not committed.
// L2's index re-exports playerScript (bundle.ts), which runs esbuild in Node: a browser bundle leaves it out.
//
// usage: node --experimental-strip-types scripts/build-iso.ts [OUT]   (default dist-iso/)

import { build, transformSync, type Metafile } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync, readdirSync, copyFileSync, rmSync, cpSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './layers.ts';
import { PLAIN_SPRITE } from '../src/iso-editor/ui/plain-icons.ts';
import { precompiledFor } from './precompile.ts';
import { LAYERS, publicOf } from './layers.ts';

/** a layer's index, as a module of the entry (the Node-only lines left out) */
const index = (dir: string, drop: RegExp[] = []) =>
  readFileSync(join(ROOT, dir, 'index.ts'), 'utf8').split('\n').filter(l => !drop.some(d => d.test(l))).join('\n');
const NODE_ONLY = [/from '\.\/bundle\.ts'/];
/** the systems pack's line the package leaves out (0.7.0): the validator (ajv's types; the compile validates all the
 *  same, with its schema precompiled). (Its brand icons left the engine in 0.9.0: a host registers its own.) */
const SYSTEMS_ONLY_HERE = [/from '\.\/validate\.ts'/];

export const BUNDLES: Record<string, { layers: string[] }> = {
  'iso-render.js': { layers: ['core', 'objects', 'viewer'] },
  'iso-editor.js': { layers: ['core', 'objects', 'viewer', 'editor'] },
  // 0.7.0: the drawing format isodiag/1 (the systems pack: its reader and compile, catalogue and stylesheets) with the
  // layers it draws with, for a page that renders YAML drawings
  'iso-systems.js': { layers: ['core', 'objects', 'viewer', 'systems'] },
};
const DIRS: Record<string, string> = { core: 'src/iso-core', objects: 'src/iso-objects', viewer: 'src/iso-viewer', editor: 'src/iso-editor', systems: 'src/iso-systems' };
const DROPS: Record<string, RegExp[]> = { viewer: NODE_ONLY, systems: SYSTEMS_ONLY_HERE };

/** what a script inlined in an HTML page may not hold (the parser's script-data states turn on them) */
export const INLINE_UNSAFE = /<!--|<\/?script/i;

export interface IsoBuild { file: string; bytes: number; gzip: number; metafile: Metafile }

export async function buildIso(out = join(ROOT, 'dist-iso'), registry: Registry = 'npmjs'): Promise<IsoBuild[]> {
  mkdirSync(out, { recursive: true });
  const res: IsoBuild[] = [];
  for (const [file, b] of Object.entries(BUNDLES)) {
    // each layer's index in a virtual module beside its own (so its relative paths resolve), exported as a namespace
    const virtual: Record<string, string> = Object.fromEntries(b.layers.map(l => [l, index(DIRS[l], DROPS[l] ?? NODE_ONLY)]));
    const r = await build({
      stdin: { contents: b.layers.map(l => `export * as ${l} from 'iso-layer:${l}';`).join('\n'), resolveDir: ROOT, sourcefile: file.replace('.js', '-entry.ts'), loader: 'ts' },
      bundle: true, format: 'esm', target: 'es2022', platform: 'browser', minify: true, write: false, outfile: join(out, file),
      metafile: true, logLevel: 'error', legalComments: 'none', loader: { '.yaml': 'text', '.css': 'text' },
      // the systems pack's schema compiled to code at build time (ajv standalone): no evaluated strings in a page
      plugins: [...(b.layers.includes('systems') ? [precompiledFor(['../src/iso-systems/schema.json'])] : []), {
        name: 'iso-layer',
        setup(p) {
          p.onResolve({ filter: /^iso-layer:/ }, a => ({ path: join(ROOT, DIRS[a.path.slice(10)], 'index.ts'), namespace: 'iso-layer', pluginData: a.path.slice(10) }));
          p.onLoad({ filter: /.*/, namespace: 'iso-layer' }, a => ({ contents: virtual[a.pluginData as string], loader: 'ts', resolveDir: resolve(a.path, '..') }));
        },
      }],
    });
    const js = r.outputFiles[0].contents;
    // inline-safe (0.7.1): a page may inline a bundle in <script type="module">…</script>; any of these in it switches
    // the page's parser out of the script and the page is silently blank
    const unsafe = INLINE_UNSAFE.exec(Buffer.from(js).toString('utf8'));
    if (unsafe) throw new Error(`${file} holds "${unsafe[0]}" at ${unsafe.index}: not safe to inline in an HTML page`);
    writeFileSync(join(out, file), js);
    writeFileSync(join(out, file.replace('.js', '.meta.json')), JSON.stringify(r.metafile, null, 1));
    res.push({ file, bytes: js.length, gzip: gzipSync(js, { level: 9 }).length, metafile: r.metafile });
  }
  await playerIso(out);
  packageIso(out, registry);
  return res;
}

/** (0.16.0) isometric-diagram.js: <isometric-diagram>, defined by loading it (src/player, an app on L0–L2 and the systems pack),
 *  the theme in it and the schema as code: one script, for any page */
export const PLAYER_FILE = 'isometric-diagram.js';
export async function playerIso(out: string): Promise<IsoBuild> {
  const r = await build({
    entryPoints: [join(ROOT, 'src/player/isometric-diagram.ts')], absWorkingDir: ROOT, bundle: true, format: 'esm', target: 'es2022', platform: 'browser', minify: true, write: false,
    outfile: join(out, PLAYER_FILE), metafile: true, logLevel: 'error', legalComments: 'none', loader: { '.yaml': 'text' }, plugins: [precompiledFor(['../src/iso-systems/schema.json'])],
  });
  const js = r.outputFiles[0].contents, unsafe = INLINE_UNSAFE.exec(Buffer.from(js).toString('utf8'));
  if (unsafe) throw new Error(`${PLAYER_FILE} holds "${unsafe[0]}" at ${unsafe.index}: not safe to inline in an HTML page`);
  writeFileSync(join(out, PLAYER_FILE), js);
  return { file: PLAYER_FILE, bytes: js.length, gzip: gzipSync(js, { level: 9 }).length, metafile: r.metafile };
}

// ---- the package (0.5.1): types, assets and a package.json, so a project outside this repo can depend on dist-iso ----

/** the files a host needs beside the code: L3's plain skin and its shell's layout, and a theme to draw with */
export const ASSETS: Record<string, string | string[]> = {
  'assets/skin.css': 'src/iso-editor/ui/skin.css',
  // the shell's layout, then the canvas's marks (0.7.4: a host had none, so selection drew black and hover flickered)
  'assets/app.css': ['src/iso-editor/ui/app.css', 'src/iso-editor/ui/marks.css'],
  'assets/marks.css': 'src/iso-editor/ui/marks.css',
  'assets/default-theme.yaml': 'themes/default.yaml',
};
export const PACKAGE = '@johnoscott/isometric-engine';
/** what the package holds (its package.json "files"): the bundles, their declarations, the assets, the notices */
export const PACKAGE_FILES = ['LICENSE', 'iso-render.js', 'iso-render.d.ts', 'iso-editor.js', 'iso-editor.d.ts', 'iso-systems.js', 'iso-systems.d.ts', 'isometric-diagram.js', 'types/', 'assets/', 'LICENSES/', 'README.md', 'EDITOR-GUIDE.md', 'src/', 'js/'];
/** the third-party code the bundles carry, and its licence (MIT and ISC want their notice kept with the code) */
const NOTICES: Record<string, string> = {
  'LICENSES/yaml.txt': 'LICENSES/yaml.txt', 'LICENSES/lucide-static.txt': 'LICENSES/lucide-static.txt',
  // 0.7.0: the systems bundle's schema validator is code ajv wrote at build time
  'LICENSES/ajv.txt': 'LICENSES/ajv.txt',
};

/** each layer's declarations (tsc), as the bundles have them: relative imports name .js, the Node-only lines are left
 *  out as they are from the code, and the JSON a declaration imports is copied beside it */
function typesIso(out: string) {
  const types = join(out, 'types');
  rmSync(types, { recursive: true, force: true });
  execFileSync(join(ROOT, 'node_modules', '.bin', 'tsc'), ['--ignoreConfig', '--declaration', '--emitDeclarationOnly', '--rootDir', 'src', '--outDir', types,
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--strict', '--allowImportingTsExtensions', '--verbatimModuleSyntax',
    '--erasableSyntaxOnly', '--resolveJsonModule', '--lib', 'ES2022,DOM', '--types', 'node', '--skipLibCheck', ...Object.values(DIRS).map(d => `${d}/index.ts`),
    // 0.12.2: every public module's declarations (its subpath's types), not only what an index reaches
    ...SOURCE_LAYERS.flatMap(l => [...publicOf(l)].filter(m => m.endsWith('.ts') && m !== 'index.ts').sort().map(m => `${l.dir}/${m}`)),
    // (0.15.0) /motion's
    'src/iso-objects/motion-entry.ts',
    // (0.16.0) /player's
    'src/player/isometric-diagram.ts', 'src/player/text.d.ts'],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
  const DROP = NODE_ONLY.map(r => new RegExp(r.source.replace('\\.ts', '\\.(ts|js)')));
  for (const f of files(types).filter(f => f.endsWith('.d.ts'))) {
    const src = readFileSync(f, 'utf8');
    const SDROP = SYSTEMS_ONLY_HERE.map(r => new RegExp(r.source.replace('\\.ts', '\\.(ts|js)')));
    const lines = src.split('\n').filter(l => !(f.endsWith(join('iso-viewer', 'index.d.ts')) && DROP.some(d => d.test(l))) && !(f.endsWith(join('iso-systems', 'index.d.ts')) && SDROP.some(d => d.test(l))));
    writeFileSync(f, lines.join('\n').replace(/((?:from|import)\s*\(?\s*['"]\.{1,2}\/[^'"]*?)\.ts(['"])/g, '$1.js$2'));
    for (const m of src.matchAll(/from '(\.{1,2}\/[^']+\.json)'/g)) {
      const rel = relative(types, resolve(f, '..', m[1]));
      copyFileSync(join(ROOT, 'src', rel), join(types, rel));
    }
  }
  // Monaco declares its API at editor.api, not at the full editor the code imports
  const entry = join(types, 'iso-editor', 'ui', 'monaco-entry.d.ts');
  writeFileSync(entry, readFileSync(entry, 'utf8').replace('monaco-editor/editor/editor.main.js', 'monaco-editor/editor/editor.api.js'));
  for (const [file, b] of Object.entries(BUNDLES)) {
    writeFileSync(join(out, file.replace('.js', '.d.ts')), b.layers.map(l => `export * as ${l} from './types/${DIRS[l].slice(4)}/index.js';`).join('\n') + '\n');
  }
}

/** 0.9.0: the layers' sources (L0–L3 and the systems pack), and their public modules as the package's subpaths
 *  (`@johnoscott/isometric-engine/modules/iso-editor/ui/canvas`): for a host that bundles per module (code splitting
 *  keeps each chunk to what it uses; a namespace pulls in everything its barrel reaches) */
export const SOURCE_LAYERS = LAYERS.filter(l => l.generic || l.name === 'iso-systems');
/** each public module: its declarations (0.12.2: a .d.ts; a .ts there is checked as the host's own code, under the host's
 *  options, and skipLibCheck doesn't pass it over), its bundler source (the TypeScript, under the "source" condition,
 *  which a host's bundler opts into), and JavaScript (Node won't strip the types of a package's .ts) */
export function moduleExports(): Record<string, string | Record<string, string>> {
  const out: Record<string, string | Record<string, string>> = {};
  for (const l of SOURCE_LAYERS) for (const m of [...publicOf(l)].sort()) {
    const key = `./modules/${l.dir.slice(4)}/${m.replace(/\.ts$/, '')}`;
    out[key] = m.endsWith('.ts') ? { types: `./types/${l.dir.slice(4)}/${m.replace(/\.ts$/, '.d.ts')}`, source: `./${l.dir}/${m}`, default: `./js/${l.dir.slice(4)}/${m.replace(/\.ts$/, '.js')}` } : `./${l.dir}/${m}`;
  }
  return out;
}
function sourcesIso(out: string) {
  for (const d of ['src', 'js']) rmSync(join(out, d), { recursive: true, force: true });
  for (const l of SOURCE_LAYERS) cpSync(join(ROOT, l.dir), join(out, l.dir), { recursive: true });
  // the same modules as JavaScript, one file each, their relative .ts imports as .js (JSON beside them, as imported)
  const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
  for (const l of SOURCE_LAYERS) for (const f of files(join(ROOT, l.dir))) {
    const rel = relative(join(ROOT, 'src'), f), to = join(out, 'js', rel);
    mkdirSync(join(to, '..'), { recursive: true });
    if (f.endsWith('.ts')) {
      const js = transformSync(readFileSync(f, 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022', supported: { 'import-attributes': true }, sourcefile: rel }).code;
      // a module that names a source file at run time (new URL('./x.ts', import.meta.url), e.g. the player esbuild
      // bundles) names the shipped source: it is under src/, beside the same folder in js/
      const fromJs = (spec: string) => relative(join(to, '..'), join(out, 'src', rel, '..', spec)).split('\\').join('/');
      writeFileSync(to.replace(/\.ts$/, '.js'), js.replace(/((?:from|import)\s*\(?\s*['"]\.{1,2}\/[^'"]*?)\.ts(['"])/g, '$1.js$2')
        .replace(/new URL\((['"])(\.{1,2}\/[^'"]*?\.ts)\1, import\.meta\.url\)/g, (_m, q: string, spec: string) => `new URL(${q}${fromJs(spec)}${q}, import.meta.url)`));
    } else if (f.endsWith('.json')) copyFileSync(f, to);
  }
}

function packageIso(out: string, registry: Registry) {
  typesIso(out);
  sourcesIso(out);
  for (const [to, from] of Object.entries(ASSETS)) {
    mkdirSync(join(out, to, '..'), { recursive: true });
    if (typeof from === 'string') copyFileSync(join(ROOT, from), join(out, to));
    else writeFileSync(join(out, to), from.map(f => readFileSync(join(ROOT, f), 'utf8').replace(/\n*$/, '\n')).join('\n'));
  }
  // L3's icons as a file too (0.5.2), for a host that builds its own sprite; setupFor already gives them
  writeFileSync(join(out, 'assets/icons.svg'), PLAIN_SPRITE + '\n');
  for (const [to, from] of Object.entries(NOTICES)) { mkdirSync(join(out, to, '..'), { recursive: true }); copyFileSync(join(ROOT, from), join(out, to)); }
  const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const exp = (f: string) => ({ types: `./${f.replace('.js', '.d.ts')}`, default: `./${f}` });
  writeFileSync(join(out, 'package.json'), JSON.stringify({
    name: PACKAGE, version: root.version, description: 'A generic isometric diagram engine: render (L0–L2) and editor (L0–L3), with a 2D view and a YAML diagram format.',
    // 0.9.0: MIT (LICENSE, the repository's own); the code it bundles keeps its own licences (LICENSES/)
    license: 'MIT', type: 'module',
    // the bundles have no side effects; the modules (src/, js/) are bundled by a host as this repo bundles its own sources
    sideEffects: ['./src/**', './js/**', './isometric-diagram.js'],
    // 0.10.0: the public repository and its site
    repository: { type: 'git', url: 'git+https://github.com/johnoscott/isometric-diagrams.git' },
    homepage: 'https://johnoscott.github.io/isometric-diagrams/',
    bugs: { url: 'https://github.com/johnoscott/isometric-diagrams/issues' },
    publishConfig: PUBLISH[registry],
    files: PACKAGE_FILES,
    exports: { './render': exp('iso-render.js'), './editor': exp('iso-editor.js'), './systems': exp('iso-systems.js'),
      // 0.15.0: motion (plans, documents, the Timeline, svgAt, paint): the modules and what they need, not a bundle of their own
      './motion': { types: './types/iso-objects/motion-entry.d.ts', source: './src/iso-objects/motion-entry.ts', default: './js/iso-objects/motion-entry.js' },
      // 0.16.0: the transport (one module), and the player: <isometric-diagram>, as a module and as a script's own name
      './transport': { types: './types/iso-viewer/transport.d.ts', source: './src/iso-viewer/transport.ts', default: './js/iso-viewer/transport.js' },
      './player': { types: './types/player/isometric-diagram.d.ts', default: `./${PLAYER_FILE}` }, [`./${PLAYER_FILE}`]: `./${PLAYER_FILE}`, ...moduleExports(), './assets/*': './assets/*', './package.json': './package.json' },
    // no dependencies of any kind: the code bundles what it runs (yaml). Only /editor's declarations name other packages'
    // types (yaml's, and Monaco's for the optional text pane); a host type-checking against /editor installs them itself.
    // (0.7.1: as optional peers they were installed anyway from the registry, which drops peerDependenciesMeta, and
    // monaco-editor brought dompurify's advisories into hosts that only render.)
  }, null, 2) + '\n');
  writeFileSync(join(out, 'README.md'), PACKAGE_README.replaceAll('VERSION', root.version));
  // 0.7.2: the how-to, for a host with only the package (test/editor-guide.test.ts runs its code)
  copyFileSync(join(ROOT, 'docs/EDITOR-GUIDE.md'), join(out, 'EDITOR-GUIDE.md'));
  copyFileSync(join(ROOT, 'LICENSE'), join(out, 'LICENSE'));
}

/** where `npm publish` sends it (0.9.0): npmjs, public, by default; build-iso --registry github for GitHub Packages */
export const PUBLISH = {
  npmjs: { registry: 'https://registry.npmjs.org/', access: 'public' },
  github: { registry: 'https://npm.pkg.github.com' },
} as const;
export type Registry = keyof typeof PUBLISH;

const PACKAGE_README = `# @johnoscott/isometric-engine VERSION

A generic isometric diagram engine: \`@johnoscott/isometric-engine/render\` (L0 core, L1 objects, L2 viewer)
and \`@johnoscott/isometric-engine/editor\` (the same, and L3 editor). Each exports one namespace per layer:
\`{ core, objects, viewer, editor }\`. It has no product-specific content; hosts register their own marks with
\`objects.registerMarks\`. MIT (\`LICENSE\`); the code it bundles keeps its own licences (\`LICENSES/\`).

**Writing an editor of your own?** Start with \`EDITOR-GUIDE.md\` in this package: the adapter and view for a small
format, a page that mounts the editor, and how to test it, all worked from one example.

Install:

    npm i @johnoscott/isometric-engine

Use:

    import { core, objects, viewer, editor } from '@johnoscott/isometric-engine/editor';
    import SKIN from '@johnoscott/isometric-engine/assets/skin.css';             // L3's plain skin (as text, with your bundler's loader)
    import APP from '@johnoscott/isometric-engine/assets/app.css';               // the editor shell's layout
    import THEME from '@johnoscott/isometric-engine/assets/default-theme.yaml';  // a theme to draw with

- Mount with \`editor.mountEditor(el, options, editor.setupFor(adapter, view))\`, \`adapter\` being your own \`DomainAdapter\`.
- Scope the CSS to the shell: \`editor.scopeCss(SKIN + APP, editor.PLAIN_WORDS.rootClass)\`.
- Icons: \`setupFor\` gives the editor L3's own (Lucide, ISC; the names are \`editor.PLAIN_ICONS\`). Add your kinds' icons
  with the view's \`icons\` (24 × 24 SVG bodies by name). \`assets/icons.svg\` is the same sprite as a file.
- No dependencies: the bundles carry what they run. \`/editor\`'s declarations name \`yaml\`'s types and, for the optional
  Monaco text pane, \`monaco-editor\`'s: a host type-checking against \`/editor\` installs those itself (needed for /editor
  only), or uses \`skipLibCheck\`. \`/render\` and \`/systems\` need nothing else installed.
- Inline-safe: no bundle holds \`<!--\`, \`<script\` or \`</script\`, so a page may inline one (or its own bundle of them)
  in \`<script type="module">…</script>\`, as a page opened from disk does.
- Schemas: \`core\` compiles JSON Schemas with ajv at run time, which needs a CSP that allows it (or precompile them).

## Per module

\`@johnoscott/isometric-engine/modules/<layer>/<module>\` (e.g. \`…/modules/iso-editor/ui/canvas\`) is a layer's public module
as TypeScript source, for a host that bundles per module: with code splitting, each chunk then holds only what it
uses, where a namespace pulls in everything its layer's barrel reaches. It needs a bundler that reads TypeScript
(esbuild does), and the packages those modules import (\`yaml\`, and \`ajv\`, \`monaco-editor\` or \`esbuild\` for the
modules that use them). The subpaths are exactly the public modules: what each layer's index re-exports from, and its
declared entries (\`iso-editor/ui/text\`, the Monaco text pane; \`iso-editor/ui/monaco-entry\`; \`iso-core/schema-errors\`).

## Rendering isodiag/1 YAML

\`@johnoscott/isometric-engine/systems\` is the drawing format isodiag/1 (its reader, compile, kind catalogue and
stylesheets: \`systems\`) with the layers it draws with (\`core\`, \`objects\`, \`viewer\`). Its schema is compiled to code at
build time, so a page under a strict CSP (\`script-src 'self'\`) renders YAML drawings. A page showing one in 3D and 2D:

    import { core, viewer, systems } from '@johnoscott/isometric-engine/systems';
    import THEME from '@johnoscott/isometric-engine/assets/default-theme.yaml';   // text
    import SRC from './drawing.yaml';                                              // text

    const d = systems.compile(SRC, THEME);                // d.diags: problems, each with its line
    const styles = { send: { color: 'send' }, reply: { color: 'reply' } };   // a link kind's 2D style
    const css = [core.themeCss(d.theme), systems.DRAWING_CSS, viewer.flatCss(styles), viewer.DUAL_VIEW_CSS].join('\\n');
    const view = viewer.dualView(figure, d.scenes[0], { mode: viewer.storedMode() ?? '3d', styles, title: 'A drawing' });
    viewer.viewToggle(document.body, [view]);             // the 3D | 2D switch; view.morph('2d' | '3d') animates

The engine draws only its own marks. Icons (\`deco: [{ icon: NAME }]\`) and screen faces (\`face: NAME\`) beyond
terminal, chat, desktop and tiles are the host's: register them once with \`objects.registerMarks({ icons, faces, css })\`
before drawing. A name nothing registered draws a neutral placeholder, and the compile warns.

Bundle the YAML files as text (esbuild: \`loader: { '.yaml': 'text' }\`). \`layoutFlat\`'s options (\`flat: { wrap: { aspect } }\`)
and the board API are in \`objects\`, declared in \`types/\`.
`;

if (import.meta.url === `file://${process.argv[1]}`) {
  // build-iso [OUT] [--registry npmjs|github]
  const args = process.argv.slice(2), at = args.indexOf('--registry');
  const registry = (at >= 0 ? args.splice(at, 2)[1] : 'npmjs') as Registry;
  if (!Object.hasOwn(PUBLISH, registry)) throw new Error(`--registry: npmjs or github, not "${registry}"`);
  const out = args[0] ? resolve(args[0]) : undefined;
  for (const b of await buildIso(out, registry)) console.log(`${b.file}: ${b.bytes} bytes, ${b.gzip} gzipped, ${Object.keys(b.metafile.inputs).length} inputs`);
}
