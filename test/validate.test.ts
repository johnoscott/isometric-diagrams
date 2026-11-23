// Validation: every error names the right line and column, in plain words, with a suggestion where one fits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../src/iso-systems/compile.ts';
import { didYouMean, distance } from '../src/iso-core/errors.ts';

const THEME = readFileSync(new URL('../themes/default.yaml', import.meta.url), 'utf8');
const run = (src: string) => compile(src, THEME);
const errs = (src: string) => run(src).diags.filter(d => d.severity === 'error');
const warns = (src: string) => run(src).diags.filter(d => d.severity === 'warning');
/** A one-scene file with the given lines (already indented 4) under the scene. */
const scene = (body: string) => `isodiag: 1\nscenes:\n  - id: s\n    title: T\n${body}`;

test('a valid file has no diagnostics', () => {
  const c = run(scene(`    nodes:\n      - { id: a, label: A }\n      - { id: b, right-of: a }\n`));
  assert.deepEqual(c.diags, []);
  assert.equal(c.ok, true);
});

test('YAML syntax errors carry their position', () => {
  const d = errs('isodiag: 1\nscenes:\n  - id: s\n    title: [unclosed\n');
  assert.ok(d.length >= 1);
  assert.match(d[0].message, /^YAML:/);
  assert.ok(d[0].line >= 4);
});

test('wrong version', () => {
  const d = errs('isodiag: 2\nscenes:\n  - { id: s, title: T }\n');
  assert.equal(d[0].line, 1);
  assert.match(d[0].message, /"isodiag" must be 1/);
});

test('unknown key, with did-you-mean, at the key', () => {
  const d = errs(scene(`    nodes:\n      - id: a\n        lable: A\n`));
  assert.equal(d.length, 1);
  assert.equal(d[0].line, 7);
  assert.equal(d[0].col, 9);
  assert.match(d[0].message, /unknown key "lable" in a node \(did you mean "label"\?\)/);
});

test('bad enum value suggests the closest one', () => {
  const d = errs(scene(`    regions:\n      - id: r\n        kind: slob\n`));
  assert.equal(d[0].line, 7);
  assert.equal(d[0].col, 15);
  assert.match(d[0].message, /did you mean "slab"/);
  assert.match(d[0].hint!, /expected one of: slab, pad/);
});

test('decorations: a misspelt word is an error; an icon nothing registered is a warning (0.9.0: drawn as a placeholder)', () => {
  const r = run(scene(`    nodes:\n      - id: a\n        deco: [terminl, {icon: rocket}]\n`));
  const d = r.diags.filter(x => x.severity === 'error');
  assert.equal(d.length, 1);
  assert.match(d[0].message, /"terminl".*did you mean "terminal"/);
  const ok = run(scene(`    nodes:\n      - id: a\n        deco: [terminal, {icon: rocket}]\n`));
  assert.equal(ok.ok, true);
  const w = ok.diags.filter(x => x.severity === 'warning');
  assert.equal(w.length, 1);
  assert.match(w[0].message, /node "a": no icon "rocket" is registered here, so it is drawn as a placeholder/);
  assert.equal(w[0].line, 7);
});

test('wrong type and wrong length', () => {
  const d = errs(scene(`    nodes:\n      - { id: a, size: [2, "x"] }\n      - { id: b, at: [1] }\n`));
  assert.match(d[0].message, /expected a number, got the text "x"/);
  assert.equal(d[0].line, 6);
  assert.match(d[1].message, /expected a list of 2 numbers, got 1/);
  assert.equal(d[1].line, 7);
});

test('missing required key', () => {
  const d = errs('isodiag: 1\nscenes:\n  - id: s\n');
  assert.match(d[0].message, /a scene is missing "title"/);
  assert.equal(d[0].line, 3);
});

test('bad id', () => {
  const d = errs(scene(`    nodes:\n      - id: 9bad\n`));
  assert.match(d[0].message, /"9bad" is not a valid id/);
  assert.equal(d[0].col, 13);
});

test('unknown asset and role, with suggestions', () => {
  const d = errs(scene(`    nodes:\n      - { id: a, asset: sesion }\n      - { id: b, role: laed }\n`));
  assert.match(d[0].message, /unknown asset "sesion" \(did you mean "session"\?\)/);
  assert.equal(d[0].line, 6);
  assert.match(d[1].message, /unknown colour role "laed" \(did you mean "lead"\?\)/);
  assert.equal(d[1].line, 7);
});

test('a file may add a role', () => {
  const src = `isodiag: 1\nroles:\n  brand: { h: 10, s: 60 }\nscenes:\n  - id: s\n    title: T\n    nodes:\n      - { id: a, role: brand }\n`;
  assert.deepEqual(errs(src), []);
});

test('unknown relative target suggests an id', () => {
  const d = errs(scene(`    nodes:\n      - { id: worker }\n      - { id: b, right-of: workr }\n`));
  assert.match(d[0].message, /unknown id "workr" \(did you mean "worker"\?\)/);
  assert.equal(d[0].line, 7);
});

test('relative placement across regions is explained', () => {
  const d = errs(scene(`    regions:\n      - id: mac\n        kind: slab\n        nodes: [{ id: a }]\n    nodes:\n      - { id: b, right-of: a }\n`));
  assert.match(d[0].message, /"a" is in "mac" but "b" is in the scene/);
});

test('duplicate ids point at the second one and name the first line', () => {
  const d = errs(scene(`    nodes:\n      - { id: a }\n      - { id: a }\n`));
  assert.match(d[0].message, /duplicate id "a" \(first used on line 6\)/);
  assert.equal(d[0].line, 7);
});

test('placement loops are errors', () => {
  const d = errs(scene(`    nodes:\n      - { id: a, right-of: b }\n      - { id: b, right-of: a }\n`));
  assert.ok(d.some(x => /placement loop/.test(x.message)));
});

test('unknown "in" region', () => {
  const d = errs(scene(`    regions:\n      - { id: mac, kind: slab }\n    nodes:\n      - { id: a, in: mak }\n`));
  assert.match(d[0].message, /unknown region "mak" \(did you mean "mac"\?\)/);
});

test('overlapping nodes are a warning at the second node', () => {
  const w = warns(scene(`    nodes:\n      - { id: a, at: [0, 0] }\n      - { id: b, at: [1, 1] }\n`));
  assert.equal(w.length, 1);
  assert.match(w[0].message, /"b" overlaps "a"/);
  assert.equal(w[0].line, 7);
});

test('a node sticking out of a sized region is a warning', () => {
  const w = warns(scene(`    regions:\n      - id: mac\n        kind: slab\n        size: [4, 4]\n        nodes: [{ id: a, at: [3, 3] }]\n`));
  assert.ok(w.some(x => /"a" sticks out of region "mac"/.test(x.message)));
});

test('did-you-mean counts a swap of two letters as one edit, and refuses wild guesses', () => {
  assert.equal(distance('lable', 'label'), 1);
  assert.equal(didYouMean('lable', ['label', 'sub']), 'label');
  assert.equal(didYouMean('zzzzzz', ['label', 'sub']), undefined);
});

test('schema and reference errors are reported together, in line order', () => {
  const d = errs(scene(`    nodes:\n      - { id: worker, asset: sesion }\n      - { id: john, lable: John, right-of: workr }\n`));
  assert.deepEqual(d.map(x => x.line), [6, 7, 7]);
  assert.match(d[0].message, /unknown asset "sesion"/);
  assert.match(d[1].message, /unknown key "lable"/);
  assert.match(d[2].message, /unknown id "workr"/);
});
