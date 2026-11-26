// A page in headless Chrome for the adapters' tests (boxes/1, compose/1): a bundled page script served with a strict
// CSP from a scratch folder, Chrome on its own profile, and ev/until over the DevTools protocol. Each run stops the
// Chrome it started (its own process only) and its server.

import { readFileSync, writeFileSync, mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, extname } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { precompiledFor } from '../../scripts/precompile.ts';
// @ts-ignore plain JS helper
import { headless } from '../../scripts/chrome.mjs';

export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:";

/** a page script, bundled for the browser (YAML and CSS as text), with its metafile; the schemas it validates with are
 *  precompiled (the CSP forbids evaluating strings; paths as scripts/precompile.ts names them) */
export const bundlePage = (entry: string, schemas: string[] = []) => build({
  entryPoints: [entry], bundle: true, format: 'esm', target: 'es2022', write: false, outfile: 'page.js', platform: 'browser',
  loader: { '.yaml': 'text', '.css': 'text' }, metafile: true, logLevel: 'silent', plugins: schemas.length ? [precompiledFor(schemas)] : [],
});

export interface Driver {
  /** run a body in the page (async; B = window[handle], E = B.editor, I = E.internal, tick(ms)) and return its value */
  ev<T>(body: string): Promise<T>;
  /** wait for a condition in the page; on a timeout, say what the page shows */
  until(cond: string, what: string, ms?: number): Promise<void>;
  /** a DevTools protocol call (screenshots, emulation) */
  cdp(method: string, params?: object): Promise<{ result?: { value?: unknown }; data?: string; [k: string]: unknown }>;
  /** (0.22.0) the browser's process, for a test of the driver itself */
  readonly pid: number | undefined;
}

/** Chrome, and its DevTools port. One that starts and never opens its port (a busy runner): another, on a profile of its own, three at most. */
export async function launch(chrome: string, size: string): Promise<{ proc: ChildProcess; port: number }> {
  for (let n = 1; n <= 3; n++) {
    const flags: string[] = headless(), profile = flags.find(f => f.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length);
    const proc = spawn(chrome, [...flags, '--remote-debugging-port=0', `--window-size=${size}`, 'about:blank'], { stdio: 'ignore' });
    let over = false, port = 0;
    proc.on('exit', () => { over = true; }); proc.on('error', () => { over = true; });
    for (let i = 0; i < 200 && !port && !over; i++) { await new Promise(r => setTimeout(r, 50)); try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { /* not yet */ } }
    if (port) return { proc, port };
    proc.kill();
    console.error(`# Chrome ${n} of 3 ${over ? 'ended' : 'gave no DevTools port in 10 s'}`);
  }
  throw new Error('Chrome gave no DevTools port, three times');
}

/** page: index.html of its own (default: one that loads page.js), and its CSP (null: none). (0.22.0) limitMs: how long any one call
 *  to the page may take (default a minute); past it Chrome is closed and the call fails, naming what it waited for, so a page that
 *  never answers is a red with a name, never a run that doesn't end */
export async function drivePage(chrome: string, js: Uint8Array, handle: string, run: (d: Driver) => Promise<void>, size = '1280,860', page: { html?: string; csp?: string | null; limitMs?: number } = {}): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'adapter-page-'));
  writeFileSync(join(dir, 'page.js'), js);
  writeFileSync(join(dir, 'index.html'), page.html ?? '<!doctype html><html><head><meta charset="utf-8"><title>page</title></head><body style="margin:0"><div id="app" style="height:100vh"></div><script type="module" src="page.js"></script></body></html>');
  const server = createServer((req, res) => {
    const f = resolve(dir, '.' + new URL(req.url!, 'http://x').pathname);
    if (!f.startsWith(dir + sep) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': extname(f) === '.js' ? 'text/javascript' : 'text/html; charset=utf-8', ...(page.csp === null ? {} : { 'content-security-policy': page.csp ?? CSP }) });
    res.end(readFileSync(f));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  let ws: WebSocket | undefined, proc: ChildProcess | undefined;
  try {
    const started = await launch(chrome, size);
    proc = started.proc;
    const port = started.port;
    const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[]).find(t => t.type === 'page')!;
    const sock = ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { sock.onopen = r; sock.onerror = j; });
    let id = 0;
    const waiting = new Map<number, (d: { result?: unknown; error?: { message: string } }) => void>();
    sock.onmessage = m => { const d = JSON.parse(String(m.data)); if (d.id && waiting.has(d.id)) { waiting.get(d.id)!(d); waiting.delete(d.id); } };
    const limit = page.limitMs ?? 60_000;
    let stuck: string | undefined;
    sock.onclose = () => { for (const [n, f] of [...waiting]) { waiting.delete(n); f({ error: { message: stuck ?? 'Chrome closed its connection' } }); } };
    const cdp = (method: string, params: Record<string, unknown> = {}, label = method) => new Promise<{ result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string } } }>((r, j) => {
      if (stuck) { j(new Error(`page-driver: ${stuck}`)); return; }
      const n = ++id;
      const t = setTimeout(() => {
        waiting.delete(n);
        stuck = `no answer in ${Math.round(limit / 1000)} s to ${label}; Chrome is closed`;
        proc?.kill('SIGKILL');
        j(new Error(`page-driver: ${stuck}`));
      }, limit);
      waiting.set(n, d => { clearTimeout(t); if (d.error) j(new Error(d.error.message)); else r(d.result as never); });
      sock.send(JSON.stringify({ id: n, method, params }));
    });
    const ev = async <T>(body: string): Promise<T> => {
      const r = await cdp('Runtime.evaluate', { expression: `(async () => { const B = window[${JSON.stringify(handle)}], E = B?.editor, I = E?.internal; const tick = (ms = 60) => new Promise(r => setTimeout(r, ms)); ${body} })()`, awaitPromise: true, returnByValue: true }, `the page: ${body.replace(/\s+/g, ' ').slice(0, 100)}`);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'in the page');
      return r.result?.value as T;
    };
    const until = async (cond: string, what: string, ms = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await ev<boolean>(`return !!(${cond});`)) return; await sleep(60); }
      const seen = await ev<unknown>(`return { text: E?.getText(), hint: document.querySelector('#se-st-hint')?.textContent, note: document.querySelector('#se-note')?.textContent, errors: B?.errors };`).catch(e => String(e));
      throw new Error(`timed out: ${what}: ${JSON.stringify(seen)}`);
    };
    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Page.navigate', { url: base + 'index.html' });
    await run({ ev, until, cdp: cdp as Driver['cdp'], pid: proc.pid });
  } finally {
    ws?.close();
    proc?.kill('SIGKILL');
    server.close();
  }
}
