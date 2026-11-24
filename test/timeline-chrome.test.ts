// A timeline's moments painted in Chrome: exactly the DOM svgAt() writes, in any order, one after another and the still back: the
// stepped build (ants, rings, fades) and looks crossfading, with a move on them. Skipped without Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { compile } from '../src/iso-systems/compile.ts';
import { bindMotion } from '../src/iso-objects/timeline.ts';
import type { MotionDoc } from '../src/iso-objects/motion-doc.ts';
import { svgAt } from '../src/iso-objects/motion.ts';
import { bundlePage, drivePage } from './adapters/page-driver.ts';
// @ts-ignore plain JS helper
import { chromePath } from '../scripts/chrome.mjs';

let chrome: string | undefined;
try { chrome = chromePath(); } catch { chrome = undefined; }
const read = (f: string) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const THEME = read('themes/default.yaml');
const LOOKS_DOC = { isomotion: 1, series: [
  { sequence: { duration: 1000, ants: true } },
  { sequence: { duration: 1500, enter: { fade: 500 }, variants: { vm: 'asleep', root: 'asleep', agent: 'asleep' }, levels: { r1: 0.25 }, children: [{ lift: ['root'], by: 30 }, { highlight: ['agent'] }, { type: ['agent'], from: 200 }] } },
  { sequence: { duration: 1000, enter: { fade: 500 }, variants: { vm: 'deleted', root: 'off' }, levels: { agent: 0.06 } } },
  { sequence: { duration: 1000, enter: { fade: 500 }, variants: { vm: '', root: '', agent: '' } } },
] } as MotionDoc;

test('in Chrome: a timeline painted is what svgAt writes, node for node, in any order; and the still back', { skip: chrome ? false : 'no Chrome', timeout: 180000 }, async () => {
  const js = (await bundlePage('test/adapters/motion-page.ts')).outputFiles![0].contents;
  for (const [file, doc] of [['test/fixtures/motion/stepped-build.yaml', parse(read('test/fixtures/motion/stepped-build.motion.yaml')) as MotionDoc], ['test/fixtures/motion/looks.yaml', LOOKS_DOC]] as const) {
    const c = compile(read(file), THEME), s = c.scenes[0], tl = bindMotion(s, doc, { kinds: c.theme!.kinds });
    assert.deepEqual(tl.diags, []);
    const cases = Array.from({ length: 40 }, (_, i) => ((i * 7919.37) % tl.duration)).map(t => ({ t, state: tl.at(t), svg: svgAt(s, tl.at(t)) }));
    cases.push({ t: -1, state: {}, svg: s.rendered.svg });
    await drivePage(chrome!, js, '__motion', async ({ ev, until }) => {
      await until(`document.title === 'ready'`, 'the page');
      const bad = await ev<number[]>(`const out = [], r = ${JSON.stringify({ svg: s.rendered.svg, variants: s.rendered.variants, looks: s.rendered.looks }).replace(/</g, '\\u003c')}, g = B.live(r.svg); document.body.append(g);
        for (const c of ${JSON.stringify(cases).replace(/</g, '\\u003c')}) { B.paint(g, c.state, r); B.paint(g, c.state, r); if (!g.isEqualNode(B.live(c.svg))) out.push(c.t); } return out;`);
      assert.deepEqual(bad, [], file);
    }, '800,600');
  }
});
