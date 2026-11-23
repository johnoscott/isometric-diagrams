// Measures font advance widths with the Chrome on this machine and writes src/iso-core/metrics.json.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromePath, headless } from './chrome.mjs';
const page = fileURLToPath(new URL('./measure-fonts.html', import.meta.url));
const html = execFileSync(chromePath(), [...headless(), '--dump-dom', 'file://' + page], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const json = /<pre id="out">([^<]*)<\/pre>/.exec(html)[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const data = JSON.parse(json);
writeFileSync(new URL('../src/iso-core/metrics.json', import.meta.url), JSON.stringify(data, null, 0) + '\n');
console.log('wrote src/iso-core/metrics.json:', Object.keys(data).join(', '));
