// Finds a Chrome or Chromium binary for headless screenshots and measurements. Override with CHROME=/path.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function chromePath() {
  const c = [process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  const p = c.find(x => existsSync(x));
  if (!p) throw new Error('No Chrome found. Set CHROME=/path/to/chrome.');
  return p;
}

/**
 * The flags every headless run starts with. Each run gets its own throwaway profile, so runs that overlap (tests in
 * parallel, a screenshot while the editor is open) never share or lock a profile.
 */
export function headless() {
  return ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'isodiag-chrome-'))}`];
}

/**
 * A headless run that ended with an error after it had done its work: on a very busy Mac, Chrome writes the whole page and then fails its
 * own shutdown ("Teardown watchdog expired", exit 2). What it wrote is what is judged: a whole page, to its last tag, counts; anything less,
 * a run that was stopped, or one that never started, is the error it was.
 */
export function printed(e) {
  const code = e?.status ?? e?.code, out = typeof e?.stdout === 'string' ? e.stdout : '';
  if (e?.signal || e?.killed || typeof code !== 'number' || !/<\/html>\s*$/.test(out)) throw e;
  console.error(`# Chrome ended with ${code} after it had printed the page`);
  return out;
}
/** a picture that is whole: to its last chunk */
export function wholePng(file) {
  if (!existsSync(file)) return false;
  const b = readFileSync(file);
  return b.length > 57 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && b.subarray(-8, -4).toString('latin1') === 'IEND';
}
