// scripts/check-change.ts: which tests a change asks for, and what it refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALWAYS, TOUCHES, chromeTests, testsFor } from '../scripts/check-change.ts';

const at = (f: string) => new URL('../' + f, import.meta.url);
const list = (d: string): string[] => readdirSync(at(d)).flatMap(f => (statSync(at(`${d}/${f}`)).isDirectory() ? list(`${d}/${f}`) : [`${d}/${f}`]));

test('every source of the engine asks for a test that drives Chrome, and every test it names is here', () => {
  const none: string[] = [];
  for (const f of list('src')) if (/\.(ts|css|json)$/.test(f) && !testsFor([f]).length) none.push(f);
  assert.deepEqual(none, []);
  for (const t of [...ALWAYS.filter(x => x !== 'public-scan'), ...TOUCHES.flatMap(x => x[1]).filter(x => x !== '*')]) assert.ok(existsSync(at(`test/${t}.test.ts`)), t);
});

test('a change asks for what it touches, and a changed test for itself; none for a change of words alone', () => {
  assert.deepEqual(testsFor(['src/iso-editor/ui/canvas.ts']), chromeTests().sort()); assert.deepEqual(testsFor(['src/iso-viewer/history.ts']), chromeTests().sort(), 'a source nobody placed');
  for (const t of ['boxes', 'drag-feel', 'player', 'render', 'site']) assert.ok(chromeTests().includes(t), t);
  for (const f of ['src/iso-objects/ants.ts', 'src/iso-core/mono.ts']) assert.deepEqual(testsFor([f]), chromeTests().sort(), `${f}: the foundation`);
  assert.ok(testsFor(['src/iso-viewer/player.ts']).includes('grid-assemble'));
  assert.deepEqual(testsFor(['test/mono.test.ts']), ['mono']); assert.deepEqual(testsFor(['CHANGELOG.md', 'docs/design/MOTION.md']), []);
  assert.deepEqual(testsFor(['test/layers.test.ts', 'test/check-change.test.ts']), [], 'run for every change'); assert.ok(ALWAYS.includes('check-change'));
  const two = testsFor(['src/iso-editor/ui/rename.ts', 'src/player/isometric-diagram.ts']); assert.deepEqual(two, [...new Set(two)].sort());
});

// a repository of its own, with the script in it; its type checker is ours to write, and it runs while the change is being checked
const make = (tsc: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'check-change-')), put = (f: string, t: string, mode = 0o644) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), t, { mode }); };
  for (const f of ['scripts/check-change.ts', 'scripts/chrome.mjs']) put(f, readFileSync(at(f), 'utf8'));
  put('test/layers.test.ts', "import { test } from 'node:test';\ntest('x', () => {});\n"); put('package.json', '{"type":"module"}'); put('a.txt', 'one\n'); put('b.txt', 'one\n'); put('gone.txt', 'x\n'); put('.gitignore', 'node_modules/\n');
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.name', 't'); git('config', 'user.email', 't@t'); git('add', '-A'); git('commit', '-qm', 'first');
  put('node_modules/.bin/tsc', `#!/bin/sh\n${tsc}\n`, 0o755); put('a.txt', 'two\n'); put('new file.txt', 'n\n'); rmSync(join(dir, 'gone.txt'));
  const msg = join(mkdtempSync(join(tmpdir(), 'check-msg-')), 'm'); writeFileSync(msg, 'second\n');
  return { dir, git, put, msg, run: () => { const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'scripts/check-change.ts', '--commit', msg], { cwd: dir, encoding: 'utf8' }); return { ...r, log: git('log', '--format=%s').trim().split('\n') }; } };
};

test('it refuses a commit with no message, on half the checks, or of what is committed already; and an option it doesn\'t know', () => {
  // (in a repository of its own: a script that stopped refusing would commit)
  const r0 = make('true'), run = (...a: string[]) => spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'scripts/check-change.ts', ...a], { cwd: r0.dir, encoding: 'utf8' });
  for (const [a, why] of [[['--commit'], /message/], [['--commit', '/nowhere'], /message/], [['--commit', r0.msg, '--no-chrome'], /half/], [['--commit', r0.msg, '--since', 'HEAD'], /--since/], [['--quick'], /--quick/], [['x'], /no option x/]] as [string[], RegExp][]) {
    const r = run(...a); assert.equal(r.status, 2, a.join(' ')); assert.match(r.stderr, why);
  }
  assert.equal(r0.git('log', '--format=%s').trim(), 'first', 'and nothing was committed');
  // it commits in one place only, after every check
  const src = readFileSync(at('scripts/check-change.ts'), 'utf8');
  assert.equal(src.split("'commit', '-q'").length, 2); assert.ok(src.indexOf("'commit', '-q'") > src.lastIndexOf('return red('));
});

test('what is committed is what was checked, by content: an edit meanwhile, a file more, the index or HEAD moved, and it refuses', () => {
  const ok = make('true'), r = ok.run();
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.log, ['second', 'first']);
  assert.match(r.stdout, /committing 3:\n {2}a\.txt\n {2}gone gone\.txt\n {2}new file\.txt/);
  assert.deepEqual(ok.git('show', '--name-status', '--format=', '--no-renames', 'HEAD').trim().split('\n').sort(), ['A\tnew file.txt', 'D\tgone.txt', 'M\ta.txt']); assert.equal(ok.git('status', '--short'), '');
  for (const [what, tsc, named] of [
    ['a changed file edited again', 'echo three > a.txt', /a\.txt/], ['one more file', 'echo x > stray.txt', /stray\.txt/], ['another tracked file', 'echo two > b.txt', /b\.txt/],
    ['a new file edited', 'echo m > "new file.txt"', /new file\.txt/], ['a deleted one back', 'echo y > gone.txt', /gone\.txt/], ['HEAD moved', 'git commit -q --allow-empty -m between', /HEAD/],
  ] as [string, string, RegExp][]) {
    const x = make(tsc).run();
    assert.equal(x.status, 1, what); assert.match(x.stderr, /RED: .*Not committed/s, what); assert.match(x.stderr, named, what); assert.ok(!x.log.includes('second'), what);
  }
  // staged and then put back: the index holds what nobody checked
  const s = make('true'); s.put('b.txt', 'staged\n'); s.git('add', 'b.txt'); s.put('b.txt', 'one\n');
  const y = s.run();
  assert.equal(y.status, 1); assert.match(y.stderr, /staged.*b\.txt/); assert.ok(!y.log.includes('second'));
  assert.equal(s.run().status, 0, 'the index is the tree\'s now'); assert.equal(s.git('show', 'HEAD:b.txt'), 'one\n');
});

test('a red run\'s whole output is kept, and said where', () => {
  const r = make('printf "quiet one\\nerror TS1: no\\nthe reason why\\n"; exit 1').run();
  assert.equal(r.status, 1); assert.match(r.stderr, /RED: types\. Not committed\./); assert.doesNotMatch(r.stderr, /the reason why/, 'a few lines here');
  const kept = /^all of it: (.+)$/m.exec(r.stderr)?.[1]; assert.ok(kept, r.stderr); assert.equal(readFileSync(kept, 'utf8'), 'quiet one\nerror TS1: no\nthe reason why\n');
});
