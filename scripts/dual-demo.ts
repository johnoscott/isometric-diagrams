// The 2D view's demo page (0.6.0): examples/boards/demo-page.ts bundled into a folder with its index.html (strict CSP:
// no inline script). usage: node --experimental-strip-types scripts/dual-demo.ts [OUT_DIR] (default: dist-demo/)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundlePage } from '../test/adapters/page-driver.ts';

export const DEMO_PAGE = 'examples/boards/demo-page.ts';
/** the schemas the page validates with, precompiled (the CSP forbids compiling them in the page) */
export const DEMO_SCHEMAS = ['../src/iso-systems/schema.json'];
export const DEMO_HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>page</title></head><body><script type="module" src="page.js"></script></body></html>';

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] ?? 'dist-demo';
  const r = await bundlePage(DEMO_PAGE, DEMO_SCHEMAS);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'page.js'), r.outputFiles![0].contents);
  writeFileSync(join(out, 'index.html'), DEMO_HTML);
  console.log(`${out}/index.html, page.js ${(r.outputFiles![0].contents.length / 1024).toFixed(0)} KB`);
}
