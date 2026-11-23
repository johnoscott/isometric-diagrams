// R1 S7.3k: L3's plain skin (src/iso-editor/ui/skin.css) is enough for L3's editor on its own: every token the
// editor's CSS reads without a fallback is defined in it, every block of the domain skin that L3's own code names has a
// plain rule, and it scopes under a root class like the domain's skin does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scopeCss } from '../src/iso-editor/ui/scope-css.ts';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SKIN = read('src/iso-editor/ui/skin.css'), APP = read('src/iso-editor/ui/app.css');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const defined = new Set([...strip(SKIN).matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
/** var(--x) with no fallback */
const bare = (css: string) => [...strip(css).matchAll(/var\((--[\w-]+)\s*\)/g)].map(m => m[1]);
const classes = (css: string) => new Set([...strip(css).replace(/\{[^{}]*\}/g, '{}').matchAll(/\.([a-z][\w-]*)/g)].map(m => m[1]));

test('the plain skin defines every token the editor and the skin read without a fallback', () => {
  const missing = [...new Set([...bare(APP), ...bare(SKIN)])].filter(v => !defined.has(v));
  assert.deepEqual(missing, []);
});

test('it scopes under a root class: nothing left on the page itself', () => {
  const css = scopeCss(SKIN + '\n' + APP, 'iso-ed');
  /** a selector list's parts, split at its top-level commas */
  const parts = (sel: string) => { const out: string[] = []; let d = 0, at = 0; for (let i = 0; i < sel.length; i++) { const c = sel[i]; if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--; else if (c === ',' && !d) { out.push(sel.slice(at, i)); at = i + 1; } } out.push(sel.slice(at)); return out.map(s => s.trim()).filter(Boolean); };
  let n = 0;
  for (const m of css.matchAll(/([^{};]+)\{/g)) {
    const sel = m[1].trim();
    if (!sel || sel.startsWith('@') || /^(from|to|\d+%)/.test(sel)) continue;
    for (const s of parts(sel)) { assert.match(s, /^\.iso-ed\b/, `unscoped: ${s}`); n++; }
  }
  assert.ok(n > 100, `${n} selectors checked`);
});

// ---- L3's own icons (0.5.2): every name it uses has a symbol in its sprite, and setupFor gives that sprite ----
import { PLAIN_ICONS, PLAIN_SPRITE } from '../src/iso-editor/ui/plain-icons.ts';
import { plainIconsModule, PLAIN_ICON_NAMES } from '../scripts/plain-icons.ts';

/** every icon name L3's code asks for: icon('…'), icon: '…', …Icon: '…', '…' as IconName, href="#se-i-…", the tree's fallbacks */
function iconNamesInL3(): Set<string> {
  const names = new Set<string>();
  const walk = (d: string): string[] => readdirSync(d).flatMap(f => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  const dir = new URL('../src/iso-editor/', import.meta.url).pathname;
  for (const f of walk(dir).filter(f => f.endsWith('.ts') && !f.endsWith('plain-icons.ts'))) {
    const src = readFileSync(f, 'utf8');
    // icon(first, cls): only the first argument names an icon, and a comparison's word (=== 'error') is not one
    for (const m of src.matchAll(/\bicon\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)) {
      const first = m[1].replace(/\([^()]*\)/g, '()').split(',')[0].replace(/[!=]==\s*'[^']*'/g, '');
      for (const q of first.matchAll(/'([a-z][a-z0-9-]*)'/g)) names.add(q[1]);
    }
    for (const m of src.matchAll(/\b(?:icon|\w+Icon)\s*:\s*(?:\(\)\s*=>\s*)?'([a-z][a-z0-9-]*)'/g)) names.add(m[1]);
    for (const m of src.matchAll(/'([a-z][a-z0-9-]*)' as IconName/g)) names.add(m[1]);
    for (const m of src.matchAll(/se-i-([a-z][a-z0-9-]*)/g)) names.add(m[1]);
    for (const m of src.matchAll(/return n\.shape[^;]*;/g)) for (const q of m[0].matchAll(/'([a-z][a-z0-9-]*)'/g)) if (!['list', 'map'].includes(q[1]) || q[0] === "'list'") names.add(q[1]);
  }
  names.delete('map');
  return names;
}

test('L3\'s icons: the module is what scripts/plain-icons.ts writes, from the vendored Lucide set, with its licence', () => {
  assert.equal(read('src/iso-editor/ui/plain-icons.ts'), plainIconsModule(), 'run: node --experimental-strip-types scripts/plain-icons.ts');
  assert.match(read('src/iso-editor/ui/plain-icons.ts'), /ISC License/);
  assert.deepEqual([...PLAIN_ICONS], [...PLAIN_ICON_NAMES]);
});

test('every icon name L3 uses has a symbol in its sprite, and the sprite has none it doesn\'t use', () => {
  const used = iconNamesInL3();
  assert.ok(used.size >= 15, `found ${[...used]}`);
  assert.deepEqual([...used].filter(n => !PLAIN_ICONS.includes(n)).sort(), [], 'used by L3, missing from PLAIN_ICONS');
  assert.deepEqual(PLAIN_ICONS.filter(n => !used.has(n)).sort(), [], 'in PLAIN_ICONS, used nowhere in L3');
  for (const n of PLAIN_ICONS) assert.match(PLAIN_SPRITE, new RegExp(`<symbol id="se-i-${n}" viewBox="0 0 24 24">`), n);
});

test('setupFor gives L3\'s sprite, with the view\'s own icons added', async () => {
  const { setupFor } = await import('../src/iso-editor/ui/setup.ts');
  const { boxesAdapter, boxesView } = await import('./adapters/boxes.ts');
  const view = { ...boxesView(read('themes/default.yaml')), icons: { crate: '<rect x="4" y="4" width="16" height="16"/>' } };
  const s = setupFor(boxesAdapter, view);
  for (const n of PLAIN_ICONS) assert.ok(s.sprite!.includes(`id="se-i-${n}"`), n);
  assert.ok(s.sprite!.includes('<symbol id="se-i-crate" viewBox="0 0 24 24"><rect'), 'the view\'s icon');
  assert.ok(setupFor(boxesAdapter, boxesView(read('themes/default.yaml'))).sprite === PLAIN_SPRITE, 'no icons of its own: L3\'s sprite as it is');
});
