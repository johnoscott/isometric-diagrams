// Every complete YAML example in the docs (one that starts with "isodiag: 1") compiles with no errors or warnings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { compile } from '../src/iso-systems/compile.ts';

const THEME = readFileSync(new URL('../themes/default.yaml', import.meta.url), 'utf8');
for (const doc of ['docs/FORMAT.md', 'README.md']) {
  const md = readFileSync(new URL('../' + doc, import.meta.url), 'utf8');
  const blocks = [...md.matchAll(/```yaml\n([\s\S]*?)```/g)].map(m => m[1]).filter(b => /^isodiag: 1/m.test(b));
  blocks.forEach((b, i) => test(`${doc}: example ${i + 1} compiles cleanly`, () => {
    assert.deepEqual(compile(b, THEME).diags.map(d => `${d.line}:${d.col} ${d.message}`), []);
  }));
}

// R1 S8: every src/ path a doc names is there. Records of a moment name files as they were, and are left as written:
// the plan (LAYERS.md, against v0.4.2), the brief, the Monaco/CodeMirror evaluation, and the changelog. A glob
// (src/iso-*/) isn't a path.
const RECORDS: Record<string, string> = {
  'CHANGELOG.md': 'each entry names the files as they were',
};
// (git says which files are the repository's own: an unpacked copy has no list)
test('every src/ path the docs name exists (records of a moment excepted)', { skip: existsSync(new URL('../.git', import.meta.url)) ? false : 'not a git checkout' }, async () => {
  const { execFileSync } = await import('node:child_process');
  const root = new URL('..', import.meta.url).pathname;
  const docs = execFileSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8' }).split('\n').filter(f => f && !f.startsWith('vendor/') && !(f in RECORDS));
  assert.ok(docs.length >= 5, `${docs.length} docs`);
  const missing: string[] = [];
  for (const f of docs) {
    readFileSync(new URL('../' + f, import.meta.url), 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/(?<![\w/.-])src\/[A-Za-z0-9_./-]*[A-Za-z0-9_](?![*\w])/g)) if (!existsSync(root + m[0])) missing.push(`${f}:${i + 1}: ${m[0]}`);
    });
  }
  assert.deepEqual(missing, []);
  for (const r of Object.keys(RECORDS)) assert.ok(existsSync(root + r), `${r} (a record) is still there`);
});
