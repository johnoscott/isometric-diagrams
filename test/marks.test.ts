// 0.9.0: the engine draws only its own marks. The icons and screen faces a drawing names beyond the engine's own are a
// host's to register (iso-objects' registerMarks); a name nothing registered draws a neutral placeholder, and the
// compile warns. This file runs in a process of its own, so it sees the engine before and after registering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../src/iso-systems/compile.ts';
import { drawingCss } from '../src/iso-objects/css.ts';
import { registerMarks, type IconPainter } from '../src/iso-objects/assets.ts';
import { systems } from '../src/iso-systems/catalog.ts';
import { NODE_ASSETS } from '../src/iso-systems/nodes.ts';
import { screenFaces } from '../src/iso-core/glyphs.ts';

const THEME = readFileSync(new URL('../themes/default.yaml', import.meta.url), 'utf8');
const drawing = (nodes: string) => `isodiag: 1\nscenes:\n  - id: s\n    title: T\n    nodes:\n${nodes}`;
const svgOf = (src: string) => { const c = compile(src, THEME); assert.equal(c.ok, true, JSON.stringify(c.diags)); return { svg: c.scenes[0].rendered.svg, warnings: c.diags.filter(d => d.severity === 'warning') }; };
const NAMED = drawing('      - { id: a, asset: session }\n      - { id: b, asset: block, deco: [{ icon: rocket }], right-of: a, gap: 2 }\n      - { id: c, asset: screen, face: radar, right-of: b, gap: 2 }\n');

test('unregistered: the engine has only its own marks', () => {
  assert.deepEqual(Object.keys(screenFaces).sort(), ['chat', 'desktop', 'terminal', 'tiles']);
  assert.deepEqual(NODE_ASSETS.session.deco, [{ terminal: 4 }]);
  assert.deepEqual([...new Set(drawingCss(systems).match(/\.ico-[\w-]+/g))].sort(), ['.ico-unknown', '.ico-unknown-q']);
});

test('unregistered: a named icon or face draws the placeholder, with a warning at its line', () => {
  const { svg, warnings } = svgOf(NAMED);
  assert.match(svg, /class="ico-unknown"/);
  assert.match(svg, /class="unk"/);
  assert.deepEqual(warnings.map(w => [w.line, w.message]), [
    [7, 'node "b": no icon "rocket" is registered here, so it is drawn as a placeholder'],
    [8, 'node "c": no screen face "radar" is registered here, so it is drawn as a placeholder'],
  ]);
  // the session's own default draws no icon, so it warns of nothing
  assert.equal(svgOf(drawing('      - { id: a, asset: session }\n')).warnings.length, 0);
});

test('registered: a host\'s marks draw, their CSS joins drawingCss() once, and the warnings go', () => {
  const before = drawingCss(systems);
  const css = '.blk .my-rocket{stroke:#c33;stroke-width:2}\n.scr .my-radar{fill:#3c3}\n';
  const marks = {
    icons: { rocket: ((k, b) => k.line3([b.x0, b.y0, b.z1], [b.x1, b.y1, b.z1], 'my-rocket')) as IconPainter },
    faces: { radar: (w: number, h: number) => `<circle class="my-radar" cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}"/>` },
    css,
  };
  registerMarks(marks);
  registerMarks(marks);   // again: nothing more
  assert.equal(drawingCss(systems), before + css);
  const { svg, warnings } = svgOf(NAMED);
  assert.deepEqual(warnings, []);
  assert.match(svg, /class="my-rocket"/);
  assert.match(svg, /class="my-radar"/);
  assert.doesNotMatch(svg, /ico-unknown|class="unk"/);
});
