// Finds a Chrome or Chromium binary for headless screenshots and measurements. Override with CHROME=/path.
import { existsSync, mkdtempSync } from 'node:fs';
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
