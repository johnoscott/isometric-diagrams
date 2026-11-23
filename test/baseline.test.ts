// Every output of the drawing format is byte-identical to the recorded one (scripts/baseline.ts and its manifest,
// test/baseline/manifest.json). To see a difference: scripts/baseline.ts --dump DIR, at both commits, diff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare } from '../scripts/baseline.ts';

test('every baseline output is byte-identical to the recorded one', async () => {
  const r = await compare();
  assert.ok(r.total >= 70, `${r.total} outputs`);
  assert.deepEqual({ changed: r.changed, missing: r.missing }, { changed: [], missing: [] });
  assert.deepEqual(r.added, [], 'outputs the manifest does not list (record them on review)');
});
