// What a change must pass before it is committed, stopping at the first red: types, the layers and their words, the docs, the recorded
// outputs, the public export's scan (where there is one); then the tests that drive Chrome for what the change touches, with motion and with
// Reduce Motion. Not the full suite, which a release still runs. A script to call, not a hook.
//   node --experimental-strip-types --no-warnings scripts/check-change.ts [--since REF] [--list] [--no-chrome] [--commit MESSAGE_FILE]
//   --since REF: what changed since it (default: HEAD, with what isn't committed); --list: only say which tests; --no-chrome: where there is none
//   --commit FILE: when all of it passes, commit what changed, exactly as it was checked (by content), with that message, and say which files.
//   It refuses with --no-chrome, with --since, at any red, or when anything changed meanwhile.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// @ts-ignore plain JS helper
import { chromePath } from './chrome.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
/** run for every change, where they are here (this script's own among them: it never passes a change while that is red) */
export const ALWAYS = ['check-change', 'layers-neutral', 'layers', 'public-scan', 'docs', 'baseline', 'transport'];
/** what a changed path asks for: tests that drive Chrome, or build the package ('*': every test that drives Chrome). Paths from the root. */
export const TOUCHES: [RegExp, string[]][] = [
  [/^src\/iso-editor\//, ['*']],
  [/^src\/iso-viewer\/(viewport|overlay|card-motion|view-css)/, ['boxes', 'drag-feel', 'make-way', 'dual-view']],
  [/^src\/iso-viewer\/(dual-view|morph|flat-view)/, ['dual-view', 'flat-perf', 'boxes']],
  // the foundation: layout, drawing and reading are there, and a narrow guess misses what stands on it
  [/^src\/(iso-core|iso-objects)\//, ['*']],
  [/^src\/iso-systems\//, ['motion', 'player', 'page-player', 'isometric-diagram', 'render', 'grid-assemble', 'focus', 'ants-chrome', 'timeline-chrome', 'boxes', 'dual-view']],
  [/^src\/iso-viewer\/(page|player|bundle|transport|play|dom)/, ['player', 'page-player', 'isometric-diagram', 'render', 'grid-assemble', 'focus']],
  [/^src\/remotion\//, ['frames', 'remotion', 'remotion-mapping']],
  [/^src\/player\//, ['player', 'isometric-diagram', 'dist-iso']],
  [/^(themes|examples|corpus)\//, ['render', 'grid-assemble', 'focus']],
  [/^scripts\/(build-iso|precompile|layers)\./, ['dist-iso']],
  [/^(site-src\/|scripts\/(build-site|monaco-plugins)\.|docs\/(?!design\/|editor\/|ops\/))/, ['site']],
  [/^(test\/adapters\/page-driver|scripts\/chrome)\./, ['boxes', 'player', 'page-player', 'isometric-diagram', 'motion', 'site']],
  [/^test\/adapters\/boxes/, ['boxes', 'drag-feel', 'dual-view']],
  [/^test\/adapters\/player-page/, ['player']],
  [/^test\/adapters\/remotion-page/, ['remotion']],
  [/^test\/adapters\/motion-page/, ['motion']],
];
/** every test that drives Chrome, by what it is made of */
export const chromeTests = () => readdirSync(join(ROOT, 'test')).filter(f => f.endsWith('.test.ts') && /\bchromePath\b/.test(readFileSync(join(ROOT, 'test', f), 'utf8'))).map(f => f.slice(0, -'.test.ts'.length));
/** The tests a change asks for, in order: those its paths touch, and any test that changed itself. */
export function testsFor(changed: string[]): string[] {
  const out = new Set<string>();
  for (const f of changed) {
    const asked = TOUCHES.filter(([re]) => re.test(f)).flatMap(x => x[1]);
    // a source nobody placed in the map might touch anything
    if (!asked.length && /^(src|space-editor)\//.test(f)) asked.push('*');
    for (const t of asked) for (const x of t === '*' ? chromeTests() : [t]) out.add(x);
    const own = /^test\/([\w-]+)\.test\.ts$/.exec(f)?.[1];
    if (own) out.add(own);
  }
  return [...out].filter(t => !ALWAYS.includes(t)).sort();
}

const git = (...a: string[]) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
export function changedSince(ref: string): string[] {
  return [...new Set([...git('diff', '--name-only', '--no-renames', ref).split('\n'), ...git('diff', '--cached', '--name-only', '--no-renames', ref).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')])].filter(Boolean).sort();
}
/** each file's content, by git's own hash; 'gone' for one that isn't there */
export const contents = (files: string[]): Record<string, string> => Object.fromEntries(files.map(f => [f, existsSync(join(ROOT, f)) ? git('hash-object', '--', f).trim() : 'gone']));
const same = (a: Record<string, string>, b: Record<string, string>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(f => a[f] !== b[f]);
const here = (tests: string[]) => tests.map(t => `test/${t}.test.ts`).filter(f => existsSync(join(ROOT, f)));

function main(argv: string[]): number {
  const opt = (k: string) => { const i = argv.indexOf(k); return i < 0 ? undefined : argv[i + 1]; };
  const message = opt('--commit'), noChrome = argv.includes('--no-chrome');
  const known = ['--since', '--list', '--no-chrome', '--commit'], odd = argv.find((a, i) => a.startsWith('--') ? !known.includes(a) : !['--since', '--commit'].includes(argv[i - 1] ?? ''));
  if (odd) { console.error(`check-change: no option ${odd}`); return 2; }
  if (argv.includes('--commit') && (!message || !existsSync(message) || !statSync(message).size)) { console.error('check-change: --commit wants a file with a message in it'); return 2; }
  if (message && noChrome) { console.error('check-change: nothing is committed on half the checks (--no-chrome)'); return 2; }
  if (message && opt('--since')) { console.error('check-change: --commit is of what is not committed yet, so no --since'); return 2; }
  const changed = changedSince(opt('--since') ?? 'HEAD'), was = contents(changed), head = git('rev-parse', 'HEAD'), tests = here(testsFor(changed));
  if (argv.includes('--list')) { console.log(`${changed.length} changed\n${tests.join('\n')}`); return 0; }
  if (message && !changed.length) { console.error('check-change: nothing to commit'); return 2; }
  // a red's whole output is kept, and said where: its few lines here don't say why
  const red = (what: string, out = '') => {
    const kept = out ? join(mkdtempSync(join(tmpdir(), 'check-red-')), 'output.txt') : undefined;
    if (kept) writeFileSync(kept, out);
    console.error(`${out.split('\n').filter(l => /^not ok|^# (pass|fail)|error TS|NOT|found/.test(l)).slice(0, 12).join('\n')}\nRED: ${what}${message ? '. Not committed.' : ''}${kept ? `\nall of it: ${kept}` : ''}`);
    return 1;
  };
  const node = (args: string[], env = {}) => spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, ...env } });
  const tsc = spawnSync(join(ROOT, 'node_modules/.bin/tsc'), ['--noEmit'], { cwd: ROOT, encoding: 'utf8' });
  if (tsc.status !== 0) return red('types', tsc.stdout);
  const base = node(['--test', ...here(ALWAYS)]);
  if (base.status !== 0) return red('layers, words, docs or recorded outputs', `${base.stdout}\n${base.stderr}`);
  if (existsSync(join(ROOT, 'scripts/public-export.ts'))) {
    const dir = mkdtempSync(join(tmpdir(), 'check-export-'));
    const r = node(['scripts/public-export.ts', join(dir, 'out')]);
    rmSync(dir, { recursive: true, force: true });
    if (r.status !== 0 || !/public scan: 0 found/.test(r.stdout + r.stderr)) return red('the public export', r.stdout + r.stderr);
  }
  console.log(`pass: types, ${here(ALWAYS).map(f => f.slice(5, -8)).join(', ')}${existsSync(join(ROOT, 'scripts/public-export.ts')) ? ', the public export and its scan' : ''}`);
  if (tests.length && !noChrome) {
    const dir = mkdtempSync(join(tmpdir(), 'check-chrome-')), calm = join(dir, 'chrome');
    writeFileSync(calm, `#!/bin/sh\nexec "${chromePath()}" --force-prefers-reduced-motion "$@"\n`, { mode: 0o755 });
    try {
      for (const [how, env] of [['with motion', {}], ['with Reduce Motion', { CHROME: calm }]] as const) {
        const r = node(['--test', '--test-concurrency=1', ...tests], env);
        if (r.status !== 0) return red(`${how}: ${tests.join(' ')}`, `${r.stdout}\n${r.stderr}`);
        console.log(`${how}: ${/^# pass \d+/m.exec(r.stdout)?.[0].slice(2)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  console.log(tests.length ? `${noChrome ? 'NOT run (--no-chrome)' : 'run'}: ${tests.join(' ')}` : 'no Chrome tests for this change');
  if (message) {
    // what was checked is what is committed, by content: nothing changed meanwhile, here or in the index
    const other = same(was, contents(changedSince('HEAD')));
    if (other.length || git('rev-parse', 'HEAD') !== head) return red(`changed while it was checked: ${other.join(' ') || 'HEAD'}`);
    // (add refuses a deleted file that an earlier run had staged)
    git('update-index', '--add', '--remove', '--', ...changed);
    const staged = Object.fromEntries(git('diff', '--cached', '--raw', '--no-renames', '--abbrev=40', 'HEAD').split('\n').filter(Boolean).map(l => { const [meta, f] = l.split('\t'); return [f, meta.split(' ')[3]]; }));
    const off = same(was, Object.fromEntries(Object.entries(staged).map(([f, h]) => [f, /^0+$/.test(h) ? 'gone' : h])));
    if (off.length) return red(`what is staged isn't what was checked: ${off.join(' ')}`);
    console.log(`committing ${changed.length}:\n${changed.map(f => `  ${was[f] === 'gone' ? 'gone ' : ''}${f}`).join('\n')}`);
    execFileSync('git', ['commit', '-q', '-F', resolve(message)], { cwd: ROOT, stdio: 'inherit' });
    console.log(git('log', '-1', '--format=%h %s').trim());
  }
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));
