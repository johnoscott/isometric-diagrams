// Measures font advance widths with the Chrome on this machine and writes src/iso-core/metrics.json.
// With a font's name and its file (measure-fonts.mjs Arimo FILE.ttf): that font's, in src/iso-core/arimo.json (its name, lower case).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { chromePath, headless } from './chrome.mjs';
const page = fileURLToPath(new URL('./measure-fonts.html', import.meta.url));
const [family, file] = process.argv.slice(2), to = family ? `src/iso-core/${family.toLowerCase()}.json` : 'src/iso-core/metrics.json';
const at = 'file://' + page + (family ? '#' + encodeURIComponent(`${family},${pathToFileURL(resolve(file)).href}`) : '');
const html = execFileSync(chromePath(), [...headless(), ...(family ? ['--allow-file-access-from-files', '--virtual-time-budget=5000'] : []), '--dump-dom', at], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const json = /<pre id="out">([^<]*)<\/pre>/.exec(html)[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const data = JSON.parse(json);
writeFileSync(new URL('../' + to, import.meta.url), JSON.stringify(data, null, 0) + '\n');
console.log(`wrote ${to}:`, Object.keys(data).join(', '));
