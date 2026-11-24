// A still inside each <isometric-diagram> (src/cli/stills.ts, `isodiag build PAGE.html`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stillsIn } from '../src/cli/stills.ts';
import { renderSvg } from '../src/iso-systems/render.ts';

const THEME = readFileSync(new URL('../themes/default.yaml', import.meta.url), 'utf8');
const Y = (title: string) => `isodiag: 1\nscenes:\n  - id: s\n    title: "${title}"\n    nodes:\n      - { id: a, asset: server }\n      - { id: b, asset: server, right-of: a, gap: 3 }\n    routes:\n      - { id: r, from: a, to: b, kind: send }\n`;
const inScript = (y: string) => `<script type="text/yaml">\n${y.split('\n').map(l => (l ? '      ' + l : l)).join('\n')}</script>`;
const PAGE = `<!doctype html>\n<title>t</title>\n<!-- <isometric-diagram>${inScript(Y('in a comment'))}</isometric-diagram> -->\n<p>é &amp; “quotes”</p>\n<isometric-diagram controls loop>${inScript(Y('One'))}\n</isometric-diagram>\n<isometric-diagram mode='dark' treatment="mono" label="a > b">${inScript(Y('Two'))}</isometric-diagram>\n<textarea><isometric-diagram></isometric-diagram></textarea>\n`;

test('each element gets its drawing\'s still, by its mode and treatment; the page is otherwise kept, byte for byte; run again, the same', () => {
  const r = stillsIn(PAGE, THEME);
  assert.deepEqual(r.problems, []); assert.equal(r.drawn, 2);
  const svgs = [...r.html.matchAll(/<svg data-isometric-still="" [\s\S]*?<\/svg>/g)].map(m => m[0]);
  assert.equal(svgs.length, 2);
  const plain = (svg: string, p: string) => svg.replace('data-isometric-still="" ', '').split(p).join('');
  assert.equal(plain(svgs[0], 'still1-'), renderSvg(Y('One'), { theme: THEME }));
  assert.equal(plain(svgs[1], 'still2-'), renderSvg(Y('Two'), { theme: THEME, mode: 'dark', treatment: 'mono' }));
  assert.equal(r.html.replace(/\n<svg data-isometric-still[\s\S]*?<\/svg>\n/g, '').replace(/\s*<\/isometric-diagram>/g, '</isometric-diagram>'), PAGE.replace(/\s*<\/isometric-diagram>/g, '</isometric-diagram>'));
  const again = stillsIn(r.html, THEME);
  assert.equal(again.html, r.html); assert.equal(again.drawn, 2);
  // no two ids alike, and each used one is there
  const ids = [...r.html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length); assert.ok(ids.length);
  for (const m of r.html.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(m[1]), m[1]);
  assert.doesNotMatch(svgs.join(''), /<script|<style|style=/);
});

test('an edited drawing\'s still is replaced; what cannot be drawn is said with its line, and left as it was', () => {
  const once = stillsIn(PAGE, THEME).html, edited = stillsIn(once.replace('title: "One"', 'title: "Uno"'), THEME);
  assert.match(edited.html, /aria-label="Uno"/); assert.doesNotMatch(edited.html, /aria-label="One"/);
  const bad = `<p>\n<isometric-diagram>${inScript(Y('x').replace('right-of: a', 'right-of: nope'))}</isometric-diagram>\n<isometric-diagram>isodiag: 1</isometric-diagram>\n<isometric-diagram scene="no">${inScript(Y('y'))}</isometric-diagram>\n<isometric-diagram treatment=sepia>${inScript(Y('z'))}</isometric-diagram>\n<isometric-diagram><script type="text/yaml"></script></isometric-diagram>`;
  const r = stillsIn(bad, THEME);
  assert.equal(r.html, bad); assert.equal(r.drawn, 0);
  assert.equal(r.problems.length, 5);
  assert.match(r.problems[0], /^the diagram at line 2: line 7: .*nope/); assert.match(r.problems[1], /not in a <script/); assert.match(r.problems[2], /no scene "no"/); assert.match(r.problems[3], /sepia/); assert.match(r.problems[4], /no drawing/);
  // a word in the drawing is text
  assert.match(stillsIn(`<isometric-diagram>${inScript(Y('<b> & $1 $&'))}</isometric-diagram>`, THEME).html, /aria-label="&lt;b&gt; &amp; \$1 \$&amp;"/);
});

test('isodiag build PAGE.html writes it beside, or where asked; with a fault it writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iso-stills-')), bin = fileURLToPath(new URL('../bin/isodiag.mjs', import.meta.url));
  const run = (...a: string[]) => { try { execFileSync(process.execPath, [bin, ...a], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }); return { ok: true, err: '' }; } catch (e) { return { ok: false, err: String((e as { stderr?: string }).stderr) }; } };
  writeFileSync(join(dir, 'p.html'), PAGE); writeFileSync(join(dir, 'bad.html'), '<isometric-diagram>x</isometric-diagram>');
  assert.equal(run('build', 'p.html').ok, true); assert.equal(readFileSync(join(dir, 'p.built.html'), 'utf8'), stillsIn(PAGE, THEME).html); assert.equal(readFileSync(join(dir, 'p.html'), 'utf8'), PAGE);
  assert.equal(run('build', 'p.html', '-o', 'q.html').ok, true); assert.ok(existsSync(join(dir, 'q.html')));
  const r = run('build', 'bad.html'); assert.equal(r.ok, false); assert.match(r.err, /line 1/); assert.equal(existsSync(join(dir, 'bad.built.html')), false);
});
