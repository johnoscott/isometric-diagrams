// The documentation site: site/, static, for GitHub Pages under any sub-path (relative links only), a strict CSP in a
// <meta> on every page, no request outside the site. Pages: home (a live drawing, the install), the docs rendered from
// their markdown, the API reference read from the declarations, the gallery (every neutral example, live in 3D and 2D,
// its YAML beside it), a playground (Monaco, with the gallery's drawings to start from), the changelog.
// The CSP: everything from 'self'; inline styles (the drawings' and Monaco's); fonts from 'self' (Monaco's icon font,
// codicon.ttf, the playground's) and workers from 'self' (Monaco's editor thread, editor.worker.js: a file, never a
// blob:). No eval: Monaco's ESM needs none, and the schema's validator is precompiled.
//
//   node --experimental-strip-types scripts/build-site.ts [OUT]       (default: site/)
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { precompiledFor } from './precompile.ts';
import { buildIso } from './build-iso.ts';
import { leanMonaco, monacoBeside, noBlobsOrComputedImports } from './monaco-plugins.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (p: string) => join(ROOT, p);
/** the public repository's own copy of a file where this repository keeps it apart (public/), else the file */
const src = (p: string) => (existsSync(at(`public/${p}`)) ? at(`public/${p}`) : at(p));
const read = (p: string) => readFileSync(src(p), 'utf8');

export const REPO = 'https://github.com/johnoscott/isometric-diagrams';
export const NPM = 'https://www.npmjs.com/package/@johnoscott/isometric-engine';
export const CLOUD_EDITOR = 'https://johnoscott.github.io/isometric-cloud-editor/';
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'";

/** the docs, as pages: [file, page, title, what it's about] */
export const DOCS: [string, string, string, string][] = [
  ['docs/FORMAT.md', 'format', 'The format', 'isodiag/1: regions, nodes, routes, notes, steps, placement, the grid, kinds and the legend.'],
  ['docs/ASSETS.md', 'assets', 'Assets', 'Every node and region kind with a picture; colour roles; decorations.'],
  ['docs/EDITOR-GUIDE.md', 'editor-guide', 'Editor guide', 'Write an editor of your own on the engine: the adapter, the view, a page, its tests.'],
  ['docs/FLAT-VIEW.md', 'flat-view', 'The 2D view', 'The board layout, the 2D view, and the morph between 3D and 2D.'],
  ['docs/MOTION.md', 'motion', 'Motion', 'Assemble and disassemble as functions of time: plans, states, frames, and drawings that carry their own colours.'],
  ['docs/LAYERS.md', 'layers', 'The layers', 'L0 core to L3 editor and the kind pack: what may import what, and the package.'],
];
/** the gallery: every neutral drawing */
export const GALLERY = ['examples/demo.yaml', 'examples/gallery.yaml', 'examples/grid-assemble.yaml', ...readdirSync(at('examples/scenarios')).filter(f => f.endsWith('.yaml')).sort().map(f => `examples/scenarios/${f}`), ...readdirSync(at('corpus')).filter(f => f.endsWith('.yaml')).sort().map(f => `corpus/${f}`)];

// ---- markdown (the subset the docs use) ----

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

/** a link in a doc: another doc becomes its page; a repository path, the file on GitHub; a heading, as is */
function href(u: string, from: string, base: string): string {
  if (/^(https?:|mailto:|#)/.test(u)) return u;
  const [p, hash] = u.split('#');
  const full = join(dirname(from), p).replace(/\\/g, '/');
  const doc = DOCS.find(d => d[0] === full || (full === 'README.md' && false));
  if (doc) return `${base}docs/${doc[1]}.html${hash ? '#' + hash : ''}`;
  if (full === 'CHANGELOG.md') return `${base}changelog.html`;
  if (/^docs\/img\//.test(full)) return `${base}img/${full.slice('docs/img/'.length)}`;
  return `${REPO}/blob/main/${full}${hash ? '#' + hash : ''}`;
}
function inline(s: string, from: string, base: string): string {
  const codes: string[] = [];
  let t = s.replace(/``\s?(.+?)\s?``|`([^`]+)`/g, (_, a, b) => `\u0000${codes.push(`<code>${esc(a ?? b)}</code>`) - 1}\u0000`);
  t = esc(t);
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, a, u) => `<img alt="${a}" src="${esc(href(u.replace(/&amp;/g, '&'), from, base))}" loading="lazy">`);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, a, u) => { const h = href(u.replace(/&amp;/g, '&'), from, base); return `<a href="${esc(h)}"${/^https?:/.test(h) ? ' rel="noopener"' : ''}>${a}</a>`; });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}
export function markdown(md: string, from: string, base: string): { html: string; toc: [number, string, string][] } {
  const lines = md.replace(/\r/g, '').split('\n'), out: string[] = [], toc: [number, string, string][] = [];
  let i = 0;
  const para: string[] = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '), from, base)}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      flush();
      const lang = l.slice(3).trim(), body: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      out.push(`<div class="code"><button class="copy" type="button" aria-label="Copy">Copy</button><pre${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(body.join('\n'))}</code></pre></div>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) {
      flush();
      const n = h[1].length, text = inline(h[2], from, base), id = slug(h[2]);
      if (n > 1 && n < 4) toc.push([n, id, text.replace(/<[^>]+>/g, '')]);
      out.push(`<h${n} id="${id}">${text}${n > 1 ? `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>` : ''}</h${n}>`);
      i++; continue;
    }
    if (/^\|/.test(l) && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1] ?? '')) {
      flush();
      const cells = (r: string) => r.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
      const head = cells(l);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && /^\|/.test(lines[i]); i++) rows.push(cells(lines[i]));
      out.push(`<div class="table"><table><thead><tr>${head.map(c => `<th>${inline(c, from, base)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c, from, base)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(l);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]), items: string[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (m && m[1].length === li[1].length) { items.push(m[3]); i++; continue; }
        if (lines[i].trim() && /^\s+/.test(lines[i]) && !/^\s*```/.test(lines[i])) { items[items.length - 1] += ' ' + lines[i].trim(); i++; continue; }
        break;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(x => `<li>${inline(x, from, base)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^>\s?/.test(l)) { flush(); const q: string[] = []; for (; i < lines.length && /^>\s?/.test(lines[i]); i++) q.push(lines[i].replace(/^>\s?/, '')); out.push(`<blockquote>${inline(q.join(' '), from, base)}</blockquote>`); continue; }
    if (!l.trim()) { flush(); i++; continue; }
    para.push(l.trim()); i++;
  }
  flush();
  return { html: out.join('\n'), toc };
}

// ---- the API, from the declarations ----

export interface ApiEntry { name: string; kind: string; sig: string; doc: string; module: string }
/** each layer's exports: the declarations build-iso emits, read statement by statement */
export function apiOf(types: string): Record<string, ApiEntry[]> {
  const layers: Record<string, ApiEntry[]> = {};
  for (const layer of ['iso-core', 'iso-objects', 'iso-viewer', 'iso-editor', 'iso-systems']) {
    const index = join(types, layer, 'index.d.ts');
    const names = new Map<string, string>();   // name → module file
    for (const m of readFileSync(index, 'utf8').matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g)) {
      for (const part of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
        const name = (part.split(/\s+as\s+/)[1] ?? part).replace(/^type\s+/, '').trim();
        names.set(name, join(dirname(index), m[2].replace(/\.js$/, '.d.ts')));
      }
    }
    const entries: ApiEntry[] = [];
    const byFile = new Map<string, Map<string, { kind: string; sig: string; doc: string }>>();
    for (const file of new Set(names.values())) byFile.set(file, existsSync(file) ? declarations(readFileSync(file, 'utf8')) : new Map());
    for (const [name, file] of names) {
      const d = byFile.get(file)!.get(name);
      if (d) entries.push({ name, ...d, module: relative(join(types, layer), file).replace(/\.d\.ts$/, '') });
    }
    layers[layer] = entries.sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name));
  }
  return layers;
}
/** the top-level declarations of a .d.ts: their name, kind, text (bodies of more than a few lines cut) and JSDoc */
function declarations(t: string): Map<string, { kind: string; sig: string; doc: string }> {
  const out = new Map<string, { kind: string; sig: string; doc: string }>();
  let i = 0, doc = '';
  while (i < t.length) {
    const ws = /^\s+/.exec(t.slice(i)); if (ws) { i += ws[0].length; continue; }
    if (t.startsWith('/**', i)) { const e = t.indexOf('*/', i); doc = t.slice(i + 3, e).split('\n').map(l => l.replace(/^\s*\*\s?/, '')).join('\n').trim(); i = e + 2; continue; }
    if (t.startsWith('//', i)) { i = t.indexOf('\n', i) + 1 || t.length; continue; }
    if (t.startsWith('/*', i)) { i = t.indexOf('*/', i) + 2; continue; }
    // one statement: to the ; or the closing } at depth 0
    let j = i, depth = 0, sawBrace = false;
    for (; j < t.length; j++) {
      const c = t[j];
      if (c === '{' || c === '(' || c === '[' || c === '<') { depth++; if (c === '{') sawBrace = true; }
      else if (c === '}' || c === ')' || c === ']' || (c === '>' && t[j - 1] !== '=')) { depth--; if (depth === 0 && c === '}' && sawBrace && /^\s*(export|declare|\/\/|\/\*|$)/.test(t.slice(j + 1, j + 40)) && !/^\s*[|&;]/.test(t.slice(j + 1))) { j++; break; } }
      else if (c === ';' && depth === 0) { j++; break; }
    }
    const stmt = t.slice(i, j).trim();
    i = j;
    const m = /^export\s+(?:declare\s+)?(?:abstract\s+)?(function|const|let|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/.exec(stmt);
    if (m) {
      const lines = stmt.split('\n');
      const sig = lines.length > 14 ? [...lines.slice(0, 12), '    …', lines[lines.length - 1]].join('\n') : stmt;
      const prev = out.get(m[2]);
      out.set(m[2], { kind: m[1], sig: prev && m[1] === 'function' ? `${prev.sig}\n${sig}` : sig.replace(/^export\s+(declare\s+)?/, ''), doc: prev?.doc || doc });
    }
    doc = '';
  }
  return out;
}

// ---- the gallery's features ----

export const FEATURES = ['regions', 'nesting', 'routes', 'steps', 'decorations', 'notes', 'grid'] as const;
export function featuresOf(text: string): string[] {
  const d = YAML.parse(text) as { scenes: Record<string, unknown>[]; grid?: unknown; assemble?: unknown };
  const f = new Set<string>();
  const walk = (o: Record<string, unknown>, depth: number) => {
    for (const r of (o.regions as Record<string, unknown>[] | undefined) ?? []) { f.add('regions'); if (depth > 0) f.add('nesting'); walk(r, depth + 1); }
    for (const n of (o.nodes as Record<string, unknown>[] | undefined) ?? []) if (n.deco || n.face) f.add('decorations');
  };
  if (d.grid || d.assemble) f.add('grid');
  for (const s of d.scenes) {
    walk(s, 0);
    if ((s.routes as unknown[] | undefined)?.length) f.add('routes');
    if ((s.steps as unknown[] | undefined)?.length) f.add('steps');
    if ((s.notes as unknown[] | undefined)?.length) f.add('notes');
    if (s.grid || s.assemble) f.add('grid');
  }
  return FEATURES.filter(x => f.has(x));
}

// ---- the pages ----

const NAV: [string, string][] = [['index.html', 'Home'], ['docs/index.html', 'Docs'], ['api.html', 'API'], ['gallery.html', 'Gallery'], ['playground.html', 'Playground'], ['changelog.html', 'Changelog']];
/** the theme control: Light, Dark or System, labelled (site.ts paints and keeps the choice) */
const THEME_PICK = `<div class="theme-pick" role="group" aria-label="Theme"><span class="theme-label" aria-hidden="true">Theme</span>${(['light', 'dark', 'system'] as const).map(t => `<button type="button" data-theme="${t}" aria-pressed="${t === 'system'}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>`;
/** the call to the cloud editor: an app built on the engine */
const CLOUD_CTA = (lead: string) => `<aside class="cta" aria-label="The full editor"><div><strong>${lead}</strong><span>The isometric cloud editor: a full editor built on this engine, with a palette, a canvas in 3D and 2D, a tree and properties.</span></div><a class="btn" href="${CLOUD_EDITOR}" rel="noopener">Open the cloud editor <span aria-hidden="true">→</span></a></aside>`;
function page(o: { path: string; title: string; body: string; description?: string; wide?: boolean; module?: string }): string {
  const base = '../'.repeat(o.path.split('/').length - 1);
  const here = (p: string) => o.path === p || (p === 'docs/index.html' && o.path.startsWith('docs/'));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<meta name="description" content="${esc(o.description ?? 'A generic isometric diagram engine: drawings in 3D and 2D from YAML, and an editor for your own formats.')}">
<title>${esc(o.title)}</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="${base}site.css">
</head>
<body>
<header class="top">
  <a class="brand" href="${base}index.html"><span class="mark" aria-hidden="true"></span>isometric-diagrams</a>
  <nav aria-label="Site">${NAV.map(([p, t]) => `<a href="${base}${p}"${here(p) ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
  <div class="ext"><a href="${REPO}" rel="noopener">GitHub</a><a href="${NPM}" rel="noopener">npm</a><a class="nav-cta" href="${CLOUD_EDITOR}" rel="noopener">Cloud editor ↗</a>${THEME_PICK}</div>
</header>
<main class="${o.wide ? 'wide' : 'narrow'}">
${o.body}
</main>
<footer class="foot">
  <span>MIT · <a href="${REPO}/blob/main/LICENSE" rel="noopener">LICENSE</a> · third-party notices in <a href="${REPO}/tree/main/LICENSES" rel="noopener">LICENSES/</a></span>
  <span>An app built on it: <a href="${CLOUD_EDITOR}" rel="noopener">the isometric cloud editor</a></span>
</footer>
<script src="${base}site.js"></script>${o.module ? `\n<script type="module" src="${base}${o.module}"></script>` : ''}
</body>
</html>
`;
}
const drawing = (text: string, opts: { id: string; mode?: string; controls?: boolean; scene?: string }) =>
  `<figure class="drawing" data-drawing="${opts.id}"${opts.scene ? ` data-scene="${esc(opts.scene)}"` : ''}><div class="stage" aria-busy="true"></div><textarea class="src" hidden aria-hidden="true">${esc(text)}</textarea></figure>`;

export async function buildSite(out = at('site')): Promise<string[]> {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const write = (p: string, s: string) => { mkdirSync(dirname(join(out, p)), { recursive: true }); writeFileSync(join(out, p), s); };

  // the page script: the engine from its sources, the schema precompiled (no evaluated strings under the CSP)
  const js = await build({
    absWorkingDir: ROOT, entryPoints: ['site-src/site.ts'], bundle: true, format: 'iife', platform: 'browser', target: 'es2022',
    minify: true, legalComments: 'none', write: false, loader: { '.yaml': 'text', '.css': 'text' },
    plugins: [precompiledFor(['../src/iso-systems/schema.json'])], logLevel: 'silent',
  });
  write('site.js', js.outputFiles[0].text);
  write('site.css', readFileSync(at('site-src/site.css'), 'utf8'));
  // the pictures the docs show
  const img = at('docs/img');
  const copyDir = (from: string, to: string) => { for (const f of readdirSync(from)) { const p = join(from, f); if (statSync(p).isDirectory()) copyDir(p, join(to, f)); else { mkdirSync(join(out, to), { recursive: true }); copyFileSync(p, join(out, to, f)); } } };
  copyDir(join(img, 'assets'), 'img/assets');
  for (const f of ['demo-light.png', 'demo-dark.png']) copyFileSync(join(img, f), join(out, 'img', f));
  writeFileSync(join(out, '.nojekyll'), '');

  const version = JSON.parse(readFileSync(at('package.json'), 'utf8')).version;
  const demo = readFileSync(at('examples/demo.yaml'), 'utf8');
  const hello = readFileSync(at('site-src/hello.yaml'), 'utf8');

  // home
  write('index.html', page({
    path: 'index.html', title: 'isometric-diagrams', wide: true, body: `
<section class="hero">
  <div class="pitch">
    <h1>Isometric diagrams, from YAML</h1>
    <p class="lede">A generic engine for drawings of systems: regions, nodes, routes and steps, laid out for you, drawn in 3D isometric or as a flat 2D board, with a morph between the two. And the layers to build an editor for a format of your own.</p>
    <div class="code install"><button class="copy" type="button" aria-label="Copy">Copy</button><pre><code>npm i @johnoscott/isometric-engine</code></pre></div>
    <p class="links"><a class="btn" href="docs/format.html">Read the format</a><a class="btn ghost" href="playground.html">Try it</a><a class="btn ghost" href="${CLOUD_EDITOR}" rel="noopener">The cloud editor ↗</a><span class="ver">v${version} · MIT</span></p>
  </div>
  ${drawing(demo, { id: 'hero', controls: true })}
</section>
${CLOUD_CTA('See it in an app')}
<section class="cards">
  <a class="card" href="docs/format.html"><h2>The format</h2><p>Things placed next to each other, regions that grow to fit, routes that find their own path, labels that find a clear spot: a file rarely holds a coordinate.</p></a>
  <a class="card" href="docs/flat-view.html"><h2>3D and 2D</h2><p>The same drawing as an isometric scene or a flat board of cards and panels, and an animated morph between them.</p></a>
  <a class="card" href="docs/editor-guide.html"><h2>An editor of your own</h2><p>A tree, a properties panel and a canvas over one undoable model: give the editor an adapter and a view for your format.</p></a>
  <a class="card" href="api.html"><h2>Layers</h2><p>Core, objects, viewer and editor, each importing only those below it; three bundles, and every public module as a subpath.</p></a>
</section>
<section class="usage">
  <h2>Render a drawing</h2>
  <div class="code"><button class="copy" type="button" aria-label="Copy">Copy</button><pre><code>${esc(`import { core, viewer, systems } from '@johnoscott/isometric-engine/systems';

const d = systems.compile(yamlText, themeText);   // diagnostics with lines and columns in d.diags
const style = document.createElement('style');
style.textContent = [core.themeCss(d.theme), systems.DRAWING_CSS, viewer.flatCss(), viewer.DUAL_VIEW_CSS].join('\\n');
document.head.append(style);
const view = viewer.dualView(figure, d.scenes[0], { mode: '3d' });
viewer.viewToggle(document.body, [view]);        // the 3D | 2D switch`)}</code></pre></div>
</section>` }));

  // docs
  write('docs/index.html', page({
    path: 'docs/index.html', title: 'Docs · isometric-diagrams', body: `<h1>Docs</h1>
<ul class="doclist">${DOCS.map(([, p, t, what]) => `<li><a href="${p}.html">${t}</a><span>${what}</span></li>`).join('')}
<li><a href="../api.html">API reference</a><span>Every layer's exports, with their declarations.</span></li></ul>` }));
  const pager = (p: string) => {
    const i = DOCS.findIndex(d => d[1] === p), prev = DOCS[i - 1], next = DOCS[i + 1];
    return `<nav class="pager" aria-label="Docs">${prev ? `<a href="${prev[1]}.html">← ${esc(prev[2])}</a>` : '<span></span>'}${next ? `<a href="${next[1]}.html">${esc(next[2])} →</a>` : '<a href="../api.html">API reference →</a>'}</nav>`;
  };
  for (const [file, p, title, what] of DOCS) {
    const { html, toc } = markdown(read(file), file, '../');
    write(`docs/${p}.html`, page({
      path: `docs/${p}.html`, title: `${title} · isometric-diagrams`, description: what, wide: true,
      body: `<div class="doc"><nav class="toc" aria-label="On this page"><strong>${esc(title)}</strong>${toc.map(([n, id, t]) => `<a class="l${n}" href="#${id}">${esc(t)}</a>`).join('')}</nav><article class="prose">${html}${pager(p)}</article></div>`,
    }));
  }

  // the API, from the declarations of a package build
  const tmp = mkdtempSync(join(tmpdir(), 'site-api-'));
  try {
    await buildIso(tmp);
    const api = apiOf(join(tmp, 'types'));
    const LAYER: Record<string, string> = { 'iso-core': 'core', 'iso-objects': 'objects', 'iso-viewer': 'viewer', 'iso-editor': 'editor', 'iso-systems': 'systems' };
    const P = '@johnoscott/isometric-engine';
    const IMPORT: Record<string, string> = {
      'iso-core': `import { core } from '${P}/render';      // also in /editor and /systems\nimport { … } from '${P}/modules/iso-core/MODULE';`,
      'iso-objects': `import { objects } from '${P}/render';   // also in /editor and /systems\nimport { … } from '${P}/modules/iso-objects/MODULE';`,
      'iso-viewer': `import { viewer } from '${P}/render';    // also in /editor and /systems\nimport { … } from '${P}/modules/iso-viewer/MODULE';`,
      'iso-editor': `import { editor } from '${P}/editor';\nimport { … } from '${P}/modules/iso-editor/MODULE';`,
      'iso-systems': `import { systems } from '${P}/systems';\nimport { … } from '${P}/modules/iso-systems/MODULE';`,
    };
    write('api.html', page({
      path: 'api.html', title: 'API · isometric-diagrams', wide: true, body: `<div class="doc"><nav class="toc" aria-label="Layers"><strong>API</strong>${Object.keys(api).map(l => `<a class="l2" href="#${l}">${LAYER[l]}</a>`).join('')}<input class="filter" type="search" placeholder="Filter" aria-label="Filter the API"></nav>
<article class="prose api"><h1>API reference</h1>
<p>Each bundle exports one namespace per layer: <code>import { core, objects, viewer, editor } from '@johnoscott/isometric-engine/editor'</code>, <code>/render</code> without <code>editor</code>, <code>/systems</code> with <code>systems</code>. Every public module is also a subpath, <code>@johnoscott/isometric-engine/modules/LAYER/MODULE</code>. Read from the package's declarations (v${version}).</p>
${Object.entries(api).map(([l, es]) => `<section id="${l}"><h2>${LAYER[l]} <small>src/${l}</small></h2><div class="code"><button class="copy" type="button" aria-label="Copy">Copy</button><pre><code>${esc(IMPORT[l])}</code></pre></div>${es.map(e => `<div class="api-entry" data-name="${esc(e.name.toLowerCase())}" id="${l}-${esc(e.name)}"><h3><code>${esc(e.name)}</code> <span class="kind">${e.kind}</span> <span class="mod">${esc(e.module)}</span></h3>${e.doc ? `<p>${inline(e.doc.replace(/\n/g, ' '), 'docs/x.md', '')}</p>` : ''}<pre><code>${esc(e.sig)}</code></pre></div>`).join('')}</section>`).join('\n')}
</article></div>` }));
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  // gallery
  const items = GALLERY.map(f => { const text = readFileSync(at(f), 'utf8'); const d = YAML.parse(text) as { title?: string; scenes: { id: string; title?: string }[] }; return { f, text, title: String(d.title ?? d.scenes[0].title), scenes: d.scenes, features: featuresOf(text) }; });
  write('gallery.html', page({
    path: 'gallery.html', title: 'Gallery · isometric-diagrams', wide: true, body: `<h1>Gallery</h1>
<p class="lede">Every example drawing, live: switch it between 3D and 2D, and copy its YAML. They are the engine's test corpus, so their words are placeholders.</p>
<div class="chips" role="group" aria-label="Filter by feature"><button type="button" class="chip" aria-pressed="true" data-feature="">All</button>${FEATURES.map(x => `<button type="button" class="chip" aria-pressed="false" data-feature="${x}">${x}</button>`).join('')}</div>
<div class="gallery">${items.map((it, i) => `<article class="item" data-features="${it.features.join(' ')}"><header><h2>${esc(it.f.split('/').pop()!.replace(/\.yaml$/, ''))}</h2><span class="meta">${it.scenes.length} scene${it.scenes.length > 1 ? 's' : ''} · ${it.features.join(', ')}</span>${it.scenes.length > 1 ? `<label class="pick"><span class="vh">Scene of ${esc(it.f)}</span><select class="scene">${it.scenes.map(s => `<option value="${esc(s.id)}">${esc(String(s.title ?? s.id))}</option>`).join('')}</select></label>` : ''}</header>${drawing(it.text, { id: `g${i}` })}<details><summary>YAML <span class="meta">${esc(it.f)}</span></summary><div class="code"><button class="copy" type="button" aria-label="Copy">Copy</button><pre><code>${esc(it.text)}</code></pre></div></details></article>`).join('\n')}</div>` }));

  // playground: its examples are the gallery's drawings; its editor (Monaco) a module of its own, with its thread, its
  // styles and its icon font as files beside it, and Monaco's licence and notices
  const examples = items.map(it => ({ id: it.f.split('/').pop()!.replace(/\.yaml$/, ''), label: `${it.f.split('/').pop()!.replace(/\.yaml$/, '')}: ${it.title}`, text: it.text }));
  await Promise.all([
    // ours: the playground; Monaco is the module beside it (monaco.js), not bundled in
    build({
      absWorkingDir: ROOT, entryPoints: { playground: 'site-src/playground.ts' }, outdir: out, bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
      minify: true, legalComments: 'none', loader: { '.yaml': 'text' }, logLevel: 'silent',
      plugins: [monacoBeside('./monaco.js'), precompiledFor(['../src/iso-systems/schema.json'])],
      define: { __SE_EDITOR_THREAD__: '"editor.worker.js"', __SE_MONACO_CSS__: '"monaco.css"' },
    }),
    // Monaco alone: the editor, its styles (monaco.css) and its icon font (codicon.ttf); and its thread
    build({
      absWorkingDir: ROOT, entryPoints: { monaco: 'src/iso-editor/ui/monaco-entry.ts' }, outdir: out, bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
      minify: true, legalComments: 'none', loader: { '.ttf': 'file' }, assetNames: '[name]', logLevel: 'silent', plugins: [leanMonaco, noBlobsOrComputedImports],
    }),
    build({
      absWorkingDir: ROOT, entryPoints: { 'editor.worker': 'monaco-editor/editor/editor.worker.js' }, outdir: out, bundle: true,
      format: 'iife', target: 'es2022', minify: true, legalComments: 'none', logLevel: 'silent', plugins: [noBlobsOrComputedImports],
    }),
  ]);
  const monacoDir = at('node_modules/monaco-editor');
  mkdirSync(join(out, 'licenses'), { recursive: true });
  writeFileSync(join(out, 'licenses/monaco-editor.txt'), [readFileSync(join(monacoDir, 'LICENSE'), 'utf8'), readFileSync(join(monacoDir, 'ThirdPartyNotices.txt'), 'utf8')].join('\n\n'));
  write('playground.html', page({
    path: 'playground.html', title: 'Playground · isometric-diagrams', wide: true, body: `<h1>Playground</h1>
<p class="lede">Edit the YAML; the drawing follows. Completion and hover come from the format's schema (type, or press ⌃Space), and problems are marked on their line. Start from an example. Nothing leaves this page.</p>
${CLOUD_CTA('Want the whole editor?')}
<div class="play"><div class="editor"><div class="pg-head"><label for="example">Example</label><select id="example"><option value="hello">Hello: a request and its answer</option>${examples.map(e => `<option value="${esc(e.id)}">${esc(e.label)}</option>`).join('')}</select></div><div id="yaml-editor" class="monaco-host" role="group" aria-label="The YAML" hidden></div><textarea id="yaml" aria-label="The YAML" spellcheck="false">${esc(hello)}</textarea><ul class="diags" aria-live="polite"></ul></div><div class="out" data-playground><div class="stage"></div></div></div>
<div id="examples" hidden><textarea data-example="hello" hidden aria-hidden="true">${esc(hello)}</textarea>${examples.map(e => `<textarea data-example="${esc(e.id)}" hidden aria-hidden="true">${esc(e.text)}</textarea>`).join('')}</div>
<p class="fine">The editor is <a href="licenses/monaco-editor.txt">Monaco</a> (MIT, Microsoft), served from this site.</p>`, module: 'playground.js' }));

  // changelog
  const cl = markdown(read('CHANGELOG.md'), 'CHANGELOG.md', '');
  write('changelog.html', page({ path: 'changelog.html', title: 'Changelog · isometric-diagrams', body: `<article class="prose">${cl.html}</article>` }));

  return walkFiles(out);
}

function walkFiles(dir: string): string[] {
  const o: string[] = [];
  const w = (d: string) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (statSync(p).isDirectory()) w(p); else o.push(relative(dir, p)); } };
  w(dir);
  return o;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] ? resolve(process.argv[2]) : undefined;
  const files = await buildSite(out);
  console.log(`site: ${files.length} files (${basename(out ?? 'site')}/)`);
}
