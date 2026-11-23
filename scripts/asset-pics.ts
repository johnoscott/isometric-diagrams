// One picture per asset and region kind for docs/ASSETS.md: light on the left, dark on the right.
// usage: node --experimental-strip-types scripts/asset-pics.ts [OUT_DIR]   (default docs/img/assets)
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compile } from '../src/iso-systems/compile.ts';
import { NODE_ASSETS } from '../src/iso-systems/nodes.ts';
import { themeCss } from '../src/iso-core/theme.ts';
import { PLAYER_CSS } from '../src/iso-objects/css.ts';
import { BASE_CSS } from '../src/iso-systems/css.ts';
// @ts-ignore plain JS helper
import { shot } from './shot.mjs';

const out = resolve(process.argv[2] ?? 'docs/img/assets');
mkdirSync(out, { recursive: true });
const THEME = readFileSync('themes/default.yaml', 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'isodiag-assets-'));

const extra: Record<string, string> = { screen: 'face: chat', monitor: 'face: terminal' };
const cases: { name: string; yaml: string }[] = Object.keys(NODE_ASSETS).map(a => ({
  name: a,
  yaml: `    regions:\n      - id: p\n        kind: pad\n        padding: 0.8\n        nodes:\n          - { id: n, asset: ${a}, label: ${a} ${extra[a] ? ', ' + extra[a] : ''} }\n`,
}));
const n = (id: string) => `[{ id: ${id}, size: [1.4, 1.4, 0.8] }]`;
for (const [kind, more] of [['slab', 'label: SLAB'], ['pad', 'label: pad'], ['vm', 'label: SANDBOX VM'], ['platform', 'label: SERVER'],
  ['fence', 'label: FENCE, gate: { side: w, width: 1.2 }'], ['cloud', 'label: the internet, size: [5, 3.4]'], ['zone', 'label: zone']] as const) {
  cases.push({ name: 'region-' + kind, yaml: `    regions:\n      - { id: r, kind: ${kind}, ${more}${kind === 'cloud' ? '' : ', nodes: ' + n('x')} }\n` });
}
cases.push({ name: 'region-tunnel', yaml: `    regions:\n      - { id: t, kind: tunnel, label: TUNNEL, at: [0, 0], size: [6, 1.4], height: 0.8, z: 0.2 }\n` });

for (const c of cases) {
  const comp = compile(`isodiag: 1\nscenes:\n  - id: s\n    title: T\n${c.yaml}`, THEME);
  if (!comp.ok) { console.error(c.name, comp.diags); continue; }
  const r = comp.scenes[0].rendered, [, , w, h] = r.viewBox;
  const pane = (t: string) => `<div data-theme="${t}" class="pane" style="width:${w}px;height:${h}px">${r.svg.replace('<svg ', `<svg width="${w}" height="${h}" `)}</div>`;
  const css = themeCss(comp.theme!).replace(/:root\[data-theme="dark"\]/g, '[data-theme="dark"]').replace(/:root\{/, '[data-theme="light"]{');
  const html = `<!doctype html><meta charset="utf-8"><style>${css}${BASE_CSS}${PLAYER_CSS}
    body{margin:0;display:flex;background:none}.pane{background:var(--surface);flex:none}</style>${pane('light')}${pane('dark')}`;
  const f = join(tmp, c.name + '.html');
  writeFileSync(f, html);
  shot(f, join(out, c.name + '.png'), 'light', `${w * 2}x${h}`);
  console.log('wrote', c.name);
}
