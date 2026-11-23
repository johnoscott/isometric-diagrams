// R1: the layer split's two source gates (docs/editor/LAYERS.md §6.1, §6.2), shared by test/layers.test.ts and
// test/layers-neutral.test.ts. They ratchet: a layer is covered as soon as its directory exists.
//   - the import boundary: a layer imports only from the layers below it, only their public modules, and never from
//     an app, test/ or examples/ (packages are fine). A layer's public modules are its index.ts, every module index.ts
//     re-exports from, and its `entries`. (Importers name the module, not the index: with code splitting, esbuild puts
//     every file a barrel reaches into the chunks of every bundle that imports it. LAYERS.md S1.)
//   - the denylist: no domain word in a generic layer (L0–L3), in prose or in identifiers (camelCase, snake_case and
//     kebab-case are split into words), in any of its word forms.
//   node --experimental-strip-types --no-warnings scripts/layers.ts   print each layer's files, imports and findings

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** rank: what a layer may import is every layer of a lower rank, plus `also` */
export interface Layer {
  name: string; dir: string; rank: number; also?: string[]; generic: boolean; entries?: string[];
  /** folders outside src/ this layer may import data files from (.json, .yaml): never code (R1 S3) */
  data?: string[];
}
/** what a domain layer may read as data: the schemas, the themes and the examples it ships */
const DOMAIN_DATA = ['schema/', 'themes/', 'examples/'];
export const LAYERS: Layer[] = [
  // compile-schema.ts makes an ajv validator when it loads, and schema-errors.ts uses it: entries of their own, never
  // in index.ts (a bundle that never validates never carries ajv)
  { name: 'iso-core', dir: 'src/iso-core', rank: 0, generic: true, entries: ['compile-schema.ts', 'schema-errors.ts'] },
  { name: 'iso-objects', dir: 'src/iso-objects', rank: 1, generic: true },
  { name: 'iso-viewer', dir: 'src/iso-viewer', rank: 2, generic: true },
  // ui/text.ts loads Monaco and sets up its thread when it loads: an entry of its own (the text feature imports it)
  { name: 'iso-editor', dir: 'src/iso-editor', rank: 3, generic: true, entries: ['ui/text.ts', 'ui/monaco-entry.ts', 'ui/skin.css', 'ui/app.css'] },
  // the kind pack sits beside the layers: it may use L0–L1, and only L4 and the apps may use it
  { name: 'iso-systems', dir: 'src/iso-systems', rank: 1.5, generic: false, data: DOMAIN_DATA },
];
/** a generic layer never imports the pack, though the pack's rank is below some of them */
export const mayImport = (from: Layer, to: Layer) =>
  from === to || (to.rank < from.rank && !(from.generic && to.name === 'iso-systems')) || (from.also ?? []).includes(to.name);

/** The apps: the programs built on the layers (the CLI, the proof sheet). They may use any layer, the generic ones
 *  (L0–L3) only through their public modules; no layer may import them. */
export const APPS = ['src/cli', 'src/proof'];
export const appOf = (rel: string) => APPS.find(d => rel.startsWith(d + '/'));
/** every source under src/ that is in neither a layer nor an app (R1 S8: none) */
export const unplaced = () => filesOf('src').filter(f => !layerOf(f) && !appOf(f));

export const layerOf = (rel: string) => LAYERS.find(l => rel === l.dir || rel.startsWith(l.dir + '/'));
const SOURCE = /\.(ts|mts|js|mjs|css|json)$/;

export function filesOf(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (SOURCE.test(f)) out.push(relative(ROOT, p).split(sep).join('/')); } };
  walk(abs);
  return out;
}

/** every module specifier in a source: static, re-exported, side-effect and dynamic imports */
export function importsOf(text: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[^\w$.])(?:import|export)\s*(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]|(?:^|[^\w$.])import\(\s*['"]([^'"]+)['"]\s*\)|@import\s+(?:url\()?['"]([^'"]+)['"]/gm;
  for (const m of text.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export interface Violation { file: string; spec: string; why: string }

/** a layer's public modules (paths inside its directory): index.ts, what index.ts re-exports from, and its entries */
export function publicOf(l: Layer, readIndex = (p: string) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : '')): Set<string> {
  const idx = readIndex(`${l.dir}/index.ts`);
  const out = new Set(['index.ts', ...(l.entries ?? [])]);
  for (const m of idx.matchAll(/^export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"]\.\/([^'"]+)['"]/gm)) out.add(m[1]);
  return out;
}

/** the boundary findings for some files (paths relative to the root; text given, for the tests' own cases) */
/** Folders held to a narrower rule inside their layer (LAYERS.md §6.3): compose/1's adapter is the second domain over
 *  L0–L3, so it may use its own folder and L4's shared top-level modules, never the space editor's folders. */
export const SCOPES: { dir: string; may(target: string): boolean; why: string }[] = [
];

export function checkImports(files: { file: string; text: string }[], readIndex?: (p: string) => string): Violation[] {
  const out: Violation[] = [];
  const pub = new Map(LAYERS.map(l => [l.name, publicOf(l, readIndex)]));
  for (const { file, text } of files) {
    const from = layerOf(file);
    if (!from) {
      // an app: the generic layers only through their public modules
      if (!appOf(file)) continue;
      for (const spec of importsOf(text)) {
        if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
        const target = relative(ROOT, resolve(ROOT, dirname(file), spec)).split(sep).join('/');
        const to = layerOf(target);
        if (to?.generic && !pub.get(to.name)!.has(target.slice(to.dir.length + 1))) out.push({ file, spec, why: `${target} is not public in ${to.name} (index.ts, what it re-exports, or an entry)` });
        else if (!to && target.startsWith('src/') && !appOf(target)) out.push({ file, spec, why: `${target} is in no layer and no app` });
      }
      continue;
    }
    for (const spec of importsOf(text)) {
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue;   // a package
      const target = relative(ROOT, resolve(ROOT, dirname(file), spec)).split(sep).join('/');
      const to = layerOf(target);
      if (!to && from.data?.some(d => target.startsWith(d)) && /\.(json|ya?ml)$/.test(target)) continue;
      if (!to) { out.push({ file, spec, why: `${target} is in no layer (an app, test/, examples/ or an unmoved file): a layer imports only layers` }); continue; }
      const scope = SCOPES.find(s => file.startsWith(s.dir + '/'));
      if (scope && !scope.may(target)) { out.push({ file, spec, why: scope.why }); continue; }
      if (!mayImport(from, to)) { out.push({ file, spec, why: `${from.name} may not import ${to.name}` }); continue; }
      if (to !== from && !pub.get(to.name)!.has(target.slice(to.dir.length + 1))) out.push({ file, spec, why: `${target} is not public in ${to.name} (index.ts, what it re-exports, or an entry)` });
    }
  }
  return out;
}

// ---------- the denylist ----------

/** the domain's words, as stems; each also matches its plural and verb forms (rooms, fenced, persisted, sandboxes) */
export const DENIED = ['agent', 'sandbox', 'fence', 'room', 'manager', 'worker', 'persist', 'space', 'bot', 'brief'];
/** Ask is ordinary English in prose ("a search asks for"): it is denied capitalised, and inside any identifier */
export const DENIED_PROSE_CAPITAL = ['ask'];
/** The two exceptions (LAYERS.md §6.2). A new one needs a review. Each is removed from the text before it is read. */
export const EXCEPTIONS: { re: RegExp; why: string }[] = [
  { re: /white-space|space-(?:between|around|evenly)|\bspace[- ](?:key|drag)\b|\bspaceKey\w*|(['"])Space\1/gi, why: 'CSS keywords, and the Space key (the canvas pans with it)' },
  { re: /\bgetWorker\w*|\beditor\.worker\b|\bWorker\b/g, why: 'the Monaco web worker (the Worker API)' },
];

const FORMS = (stem: string) => new RegExp(`^${stem}(?:s|es|d|ed|ing)?$`, 'i');
const DENIED_RE = DENIED.map(w => [w, FORMS(w)] as const);
const ASK_RE = FORMS('ask');

export interface Hit { line: number; word: string; text: string }

/** the denied words in a text, by line: words are split at anything not a letter, and at camelCase humps */
export function denyHits(text: string): Hit[] {
  const out: Hit[] = [];
  let t = text;
  for (const e of EXCEPTIONS) t = t.replace(e.re, m => ' '.repeat(m.length));
  const lines = t.split('\n'), orig = text.split('\n');
  lines.forEach((line, i) => {
    // identifiers: runs of letters, digits, _ and -, which may be compounds
    for (const m of line.matchAll(/[A-Za-z][A-Za-z0-9_-]*/g)) {
      const parts = m[0].split(/[_-]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).filter(Boolean);
      const compound = parts.length > 1;
      for (const p of parts) {
        const hit = DENIED_RE.find(([, re]) => re.test(p));
        if (hit) { out.push({ line: i + 1, word: p, text: orig[i].trim() }); continue; }
        if (ASK_RE.test(p) && (compound || /^[A-Z]/.test(p))) out.push({ line: i + 1, word: p, text: orig[i].trim() });
      }
    }
  });
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const l of LAYERS) {
    const files = filesOf(l.dir);
    console.log(`${l.name} (${l.dir}): ${files.length ? files.length + ' files' : 'MISSING'}`);
    const v = checkImports(files.map(file => ({ file, text: readFileSync(join(ROOT, file), 'utf8') })));
    for (const x of v) console.log(`  import  ${x.file}: '${x.spec}': ${x.why}`);
    if (l.generic) for (const f of files) for (const h of denyHits(readFileSync(join(ROOT, f), 'utf8'))) console.log(`  word    ${f}:${h.line}: "${h.word}"  ${h.text.slice(0, 100)}`);
  }
  for (const d of APPS) {
    const files = filesOf(d);
    console.log(`app ${d}: ${files.length} files`);
    for (const x of checkImports(files.map(file => ({ file, text: readFileSync(join(ROOT, file), 'utf8') })))) console.log(`  import  ${x.file}: '${x.spec}': ${x.why}`);
  }
  for (const f of unplaced()) console.log(`  place   ${f}: in no layer and no app`);
}
