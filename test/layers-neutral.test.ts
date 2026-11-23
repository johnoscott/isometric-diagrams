// R1 §6.2: no domain word in the generic layers (L0–L3: src/iso-core, -objects, -viewer, -editor; the kind pack is a
// domain). Prose, comments, CSS and identifiers, every word form. The matcher is proven first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAYERS, ROOT, filesOf, denyHits, EXCEPTIONS } from '../scripts/layers.ts';

const words = (t: string) => denyHits(t).map(h => h.word);

test('the denied words in their forms, in prose and inside identifiers of every case', () => {
  assert.deepEqual(words('the rooms are fenced; persisted; a brief; managers'), ['rooms', 'fenced', 'persisted', 'brief', 'managers']);
  assert.deepEqual(words('spaceDown SANDBOXES ask_card ask-card AskAttention agentKind room_id x-sandbox-gate'), ['space', 'SANDBOXES', 'ask', 'ask', 'Ask', 'agent', 'room', 'sandbox']);
  assert.deepEqual(words('/* the hub: a bot, a worker */'), ['bot', 'worker']);
});

test('not denied: other words that contain them, and ask in plain prose', () => {
  assert.deepEqual(words('robot bottom briefly roomy agentive spacer a search asks for the floor; ask the host'), []);
});

test('the two exceptions, and nothing else around them', () => {
  assert.equal(EXCEPTIONS.length, 2);
  assert.deepEqual(words(`white-space:nowrap;justify-content:space-between;gap:space-around;space-evenly; a space-drag pans; the space key; spaceKeyDown; e.code === 'Space'`), []);
  assert.deepEqual(words(`new Worker(url); getWorkerUrl(); getWorker(); 'monaco-editor/editor/editor.worker.js'`), []);
  assert.deepEqual(words('the space is drawn; a worker session'), ['space', 'worker']);
});

test('every generic layer holds no denied word (R1 S8: hard, every one of them present)', () => {
  for (const l of LAYERS.filter(x => x.generic)) assert.ok(filesOf(l.dir).length, `${l.name} exists and has files`);
  const files = LAYERS.filter(l => l.generic).flatMap(l => filesOf(l.dir));
  const hits = files.flatMap(f => denyHits(readFileSync(join(ROOT, f), 'utf8')).map(h => `${f}:${h.line}: "${h.word}"  ${h.text.slice(0, 90)}`));
  assert.deepEqual(hits, []);
  console.log(`# generic files checked: ${files.length}`);
});
