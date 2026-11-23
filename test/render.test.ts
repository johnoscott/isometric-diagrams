// Rendering snapshots: each reproduction at a fixed step, tokens frozen, in light and dark, drawn by headless Chrome
// and compared pixel by pixel (in Chrome too, so there is no image library). Skipped when no Chrome is found.
// UPDATE_SNAPSHOTS=1 npm test writes new pictures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/iso-systems/compile.ts';
import { renderPage } from '../src/iso-viewer/page.ts';
import { playerScript } from '../src/iso-viewer/bundle.ts';
// @ts-ignore plain JS helpers
import { chromePath, headless } from '../scripts/chrome.mjs';
// @ts-ignore plain JS helpers
import { shot } from '../scripts/shot.mjs';

const THEME = readFileSync(new URL('../themes/default.yaml', import.meta.url), 'utf8');
const SNAP = fileURLToPath(new URL('./snapshots/png/', import.meta.url));
const CASES = [
  { file: 'corpus/relay-hub.yaml', step: 4 },
  { file: 'corpus/fenced-worker.yaml', step: 6 },
];
/** a pixel differs when a channel moves by more than this; the picture fails past this share of pixels */
const TOL = 40, MAX_SHARE = 0.003;

let chrome: string | undefined;
try { chrome = chromePath(); } catch { chrome = undefined; }
const tmp = mkdtempSync(join(tmpdir(), 'isodiag-render-'));

function diffShare(a: string, b: string): number {
  const page = join(tmp, `diff-${Math.random().toString(36).slice(2)}.html`);
  const uri = (f: string) => 'data:image/png;base64,' + readFileSync(f).toString('base64');
  writeFileSync(page, `<!doctype html><body><pre id="out">…</pre><script>
    const load=s=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src=s;});
    Promise.all([load(${JSON.stringify(uri(a))}),load(${JSON.stringify(uri(b))})]).then(([x,y])=>{
      if(x.width!==y.width||x.height!==y.height){document.getElementById('out').textContent='size';return;}
      const px=i=>{const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const g=c.getContext('2d');g.drawImage(i,0,0);return g.getImageData(0,0,i.width,i.height).data;};
      const p=px(x),q=px(y);let n=0;
      for(let k=0;k<p.length;k+=4){if(Math.abs(p[k]-q[k])>${TOL}||Math.abs(p[k+1]-q[k+1])>${TOL}||Math.abs(p[k+2]-q[k+2])>${TOL})n++;}
      document.getElementById('out').textContent=String(n/(p.length/4));
    });</script>`);
  const dom = execFileSync(chrome!, [...headless(), '--virtual-time-budget=5000', '--dump-dom', 'file://' + page], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 });
  const v = /<pre id="out">([^<]*)<\/pre>/.exec(dom)?.[1];
  if (v === 'size') return 1;
  return Number(v);
}

for (const c of CASES) for (const theme of ['light', 'dark']) {
  test(`${c.file} step ${c.step}, ${theme}: rendering matches its snapshot`, { skip: chrome ? false : 'no Chrome found' }, () => {
    const comp = compile(readFileSync(new URL('../' + c.file, import.meta.url), 'utf8'), THEME);
    const html = join(tmp, c.file.replace(/\W/g, '_') + '.html');
    writeFileSync(html, renderPage(comp, { runtime: playerScript() }));
    const name = `${c.file.split('/').pop()!.replace(/\.ya?ml$/, '')}-step${c.step}-${theme}.png`;
    const now = join(tmp, name);
    shot(html, now, theme, '1240x1300', `still&step=${c.step}&t=0.6`);
    mkdirSync(SNAP, { recursive: true });
    const want = join(SNAP, name);
    if (process.env.UPDATE_SNAPSHOTS || !existsSync(want)) { copyFileSync(now, want); return; }
    const share = diffShare(want, now);
    assert.ok(share <= MAX_SHARE, `${(share * 100).toFixed(2)}% of pixels differ from test/snapshots/png/${name} (new picture: ${now})`);
  });
}
