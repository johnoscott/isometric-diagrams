// The engine's baseline: every output of the drawing format, by a stable name, and its sha256 in
// test/baseline/manifest.json. A change to any of them is deliberate: re-record with --write, and say why.
//   node --experimental-strip-types scripts/baseline.ts            compare
//   … --write                                                      re-record the manifest
//   … --dump DIR                                                   write every output to DIR, to diff
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from '../src/iso-systems/compile.ts';
import { renderPage } from '../src/iso-viewer/page.ts';
import { playerScript } from '../src/iso-viewer/bundle.ts';
import { renderProof } from '../src/proof/proof.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (p: string) => join(ROOT, p);
const read = (p: string) => readFileSync(at(p), 'utf8');
const list = (dir: string, re: RegExp) => readdirSync(at(dir)).filter(f => re.test(f)).sort().map(f => `${dir}/${f}`);
export const MANIFEST = at('test/baseline/manifest.json');
const THEME = read('themes/default.yaml');
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (x instanceof Map ? Object.fromEntries(x) : x), 1);

/** every output: each drawing as `isodiag build` writes it, its diagnostics and each scene's SVG; the proof sheet */
export async function outputs(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const f of [...list('corpus', /\.yaml$/), ...list('examples', /\.yaml$/), ...list('examples/scenarios', /\.yaml$/)]) {
    const c = compile(read(f), THEME);
    out.set(`build:${f}`, renderPage(c, { runtime: playerScript() }));
    out.set(`diags:${f}`, json(c.diags));
    for (const s of c.scenes) out.set(`scene:${f}#${s.id}`, s.rendered.svg);
  }
  const proofSrc = 'corpus/messaging.yaml';
  out.set(`proof:${proofSrc}`, renderProof(compile(read(proofSrc), THEME), { liveHref: 'messaging.live.html', withIntro: true, fileName: 'messaging.yaml' }));
  return out;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function compare(): Promise<{ changed: string[]; missing: string[]; added: string[]; total: number }> {
  const want = JSON.parse(readFileSync(MANIFEST, 'utf8')).outputs as Record<string, string>;
  const got = await outputs();
  const changed: string[] = [], missing: string[] = [], added: string[] = [];
  for (const [k, h] of Object.entries(want)) { const g = got.get(k); if (g === undefined) missing.push(k); else if (sha(g) !== h) changed.push(k); }
  for (const k of got.keys()) if (!(k in want)) added.push(k);
  return { changed, missing, added, total: Object.keys(want).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--write')) {
    const got = await outputs();
    mkdirSync(dirname(MANIFEST), { recursive: true });
    writeFileSync(MANIFEST, JSON.stringify({ note: 'sha256 of every output of the drawing format (scripts/baseline.ts)', outputs: Object.fromEntries([...got].map(([k, v]) => [k, sha(v)])) }, null, 1) + '\n');
    console.error(`wrote ${MANIFEST}: ${got.size} outputs`);
  } else if (args.includes('--dump')) {
    const dir = args[args.indexOf('--dump') + 1];
    mkdirSync(dir, { recursive: true });
    for (const [k, v] of await outputs()) writeFileSync(join(dir, k.replace(/[^\w.-]+/g, '_')), v);
    console.error(`wrote the outputs into ${dir}`);
  } else {
    if (!existsSync(MANIFEST)) { console.error('no manifest: --write it first'); process.exit(2); }
    const r = await compare();
    for (const k of r.changed) console.error(`changed  ${k}`);
    for (const k of r.missing) console.error(`missing  ${k}`);
    for (const k of r.added) console.error(`new      ${k}`);
    console.error(`${r.total - r.changed.length - r.missing.length} of ${r.total} outputs identical`);
    process.exit(r.changed.length || r.missing.length || r.added.length ? 1 : 0);
  }
}
