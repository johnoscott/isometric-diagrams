// Screenshot an HTML file with headless Chrome. usage: node scripts/shot.mjs IN.html OUT.png [light|dark] [WxH] [#hash]
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chromePath, headless } from './chrome.mjs';
export function shot(input, out, theme = 'light', size = '1240x900', hash = '') {
  const url = 'file://' + resolve(input) + '#theme=' + theme + (hash ? '&' + hash.replace(/^#/, '') : '');
  // virtual time: the picture is taken once the page has loaded and its timers and frames have run, however busy
  // the machine is (a plain --screenshot is taken at load, which under load can be before the player has drawn)
  execFileSync(chromePath(), [...headless(), '--hide-scrollbars', '--force-device-scale-factor=1', '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=4000', `--window-size=${size.replace('x', ',')}`, `--screenshot=${resolve(out)}`, url], { stdio: 'ignore' });
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [i, o, t, s, h] = process.argv.slice(2);
  shot(i, o, t, s, h); console.log('wrote', o);
}
