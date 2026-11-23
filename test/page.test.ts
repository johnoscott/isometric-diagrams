// The built page is one standalone file: no network, no external scripts, styles or fonts; the step list and an
// aria-label per scene are there; the step data parses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../src/iso-systems/compile.ts';
import { renderPage } from '../src/iso-viewer/page.ts';
import { playerScript } from '../src/iso-viewer/bundle.ts';

const THEME = readFileSync(new URL('../themes/default.yaml', import.meta.url), 'utf8');

for (const f of ['corpus/relay-hub.yaml', 'corpus/fenced-worker.yaml', 'examples/demo.yaml']) {
  test(`${f}: the page is standalone and accessible`, () => {
    const c = compile(readFileSync(new URL('../' + f, import.meta.url), 'utf8'), THEME);
    const html = renderPage(c, { runtime: playerScript() });
    const urls = [...html.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map(m => m[0]).filter(u => u !== 'http://www.w3.org/2000/svg');
    assert.deepEqual(urls, [], 'no URLs other than the SVG namespace');
    assert.ok(!/<script[^>]+src=|<link[^>]+href=|@import|url\((?!#)/.test(html), 'no external scripts, styles, fonts or images');
    for (const s of c.scenes) {
      assert.match(html, new RegExp(`data-scene="${s.id}"`));
      assert.ok(/<svg[^>]+role="img"[^>]+aria-label="[^"]{10,}"/.test(html), 'each scene has an aria-label');
      if (s.steps.steps.length) assert.ok(html.includes(`All ${s.steps.steps.length} steps as text`), 'the text list of steps');
    }
    const data = JSON.parse(/<script type="application\/json" id="diagram-steps">([\s\S]*?)<\/script>/.exec(html)![1]);
    assert.equal(data.scenes.length, c.scenes.filter(s => s.steps.steps.length).length);
  });
}
