// A picture of one scene of a diagram file, at a step: builds a page holding only that scene and shoots it.
// usage: node --experimental-strip-types scripts/shot-scene.ts FILE.yaml SCENE STEP OUT.png [light|dark] [WxH]
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { compile } from '../src/iso-systems/compile.ts';
import { renderPage } from '../src/iso-viewer/page.ts';
import { playerScript } from '../src/iso-viewer/bundle.ts';
// @ts-ignore plain JS helper
import { shot } from './shot.mjs';

const [file, scene, step, out, theme = 'light', size = '1240x1000'] = process.argv.slice(2);
const doc = parseDocument(readFileSync(file, 'utf8'));
const scenes = doc.get('scenes') as { items: { get(k: string): unknown }[] };
scenes.items = scenes.items.filter(s => s.get('id') === scene);
if (!scenes.items.length) { console.error(`no scene "${scene}" in ${file}`); process.exit(1); }
const c = compile(String(doc), readFileSync(new URL('../themes/default.yaml', import.meta.url), 'utf8'));
if (!c.ok) { console.error(c.diags.map(d => `${d.line}:${d.col} ${d.message}`).join('\n')); process.exit(1); }
const html = join(mkdtempSync(join(tmpdir(), 'isodiag-scene-')), 'scene.html');
writeFileSync(html, renderPage(c, { runtime: playerScript() }));
shot(html, out, theme, size, `still&step=${step}&t=0.5`);
console.log('wrote', out);
