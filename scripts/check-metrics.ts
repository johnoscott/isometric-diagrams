// Compares isodiag's text widths (from src/iso-core/metrics.json) with what headless Chrome draws.
// usage: node --experimental-strip-types scripts/check-metrics.ts FILE.yaml [OUT.png]
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileFile } from '../src/cli/isodiag.ts';
import { renderPage } from '../src/iso-viewer/page.ts';
// @ts-ignore plain JS helper
import { chromePath, headless } from './chrome.mjs';

const file = process.argv[2] ?? 'examples/demo.yaml';
const { c } = compileFile(file);
const ours = c.scenes.flatMap(s => s.rendered.texts.map(t => ({ text: t.text, w: t.w })));
const probe = `<script>addEventListener('load',()=>{const out=[];document.querySelectorAll('svg text:not([transform])').forEach(t=>out.push({text:t.textContent,w:t.getComputedTextLength()}));
const p=document.createElement('pre');p.id='metrics';p.textContent=JSON.stringify(out);document.body.appendChild(p);});</script>`;
const dir = mkdtempSync(join(tmpdir(), 'isodiag-metrics-'));
const html = join(dir, 'page.html');
writeFileSync(html, renderPage(c, { extraBody: probe }));
const dom = execFileSync(chromePath(), [...headless(), '--virtual-time-budget=2000', '--dump-dom', 'file://' + html], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const raw = /<pre id="metrics">([^<]*)<\/pre>/.exec(dom)![1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const real: { text: string; w: number }[] = JSON.parse(raw);
let worst = 0, n = 0, sum = 0;
const rows: string[] = [];
for (const r of real) {
  const o = ours.find(x => x.text === r.text);
  if (!o) continue;
  const d = o.w - r.w, rel = d / r.w;
  worst = Math.max(worst, Math.abs(rel)); sum += Math.abs(rel); n++;
  rows.push(`${r.w.toFixed(1).padStart(7)} ${o.w.toFixed(1).padStart(7)} ${(rel * 100).toFixed(1).padStart(6)}%  ${r.text}`);
}
console.log('  chrome  isodiag   diff  text\n' + rows.join('\n'));
console.log(`\n${n} labels: mean |diff| ${(sum / n * 100).toFixed(2)}%, worst ${(worst * 100).toFixed(2)}%`);
if (worst > 0.03) process.exitCode = 1;
