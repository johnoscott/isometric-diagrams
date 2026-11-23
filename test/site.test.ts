// The documentation site (scripts/build-site.ts): built into a folder of the test's own and served from a sub-path
// with no headers, as GitHub Pages serves it, so only each page's <meta> CSP applies. Every page, light and dark,
// loads with no error, no CSP violation and no request outside the site; the hero switches to 2D; the playground's
// editor is Monaco (the engine's text pane): an edit is drawn, a problem is marked on its line and listed, ⌘Z takes it
// back, completion offers the schema's keys inside a list item, an example from the drop-down loads and draws; the
// theme control (Light, Dark, System) is kept and Monaco follows it; the cloud editor is linked from the home page
// and the playground; the gallery's filter filters. And the pages themselves: the CSP on
// each, relative paths only, links out only to the project's own places. SITE_SHOTS=DIR also writes the home page's
// picture there (the public README's docs/img/site-home.png).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { buildSite, CSP, REPO, NPM, CLOUD_EDITOR, GALLERY } from '../scripts/build-site.ts';
import { ISODIAG_SERVICES } from '../site-src/isodiag-services.ts';
// @ts-ignore plain JS helper
import { chromePath, headless } from '../scripts/chrome.mjs';

let chrome: string | undefined;
try { chrome = chromePath(); } catch { /* no Chrome: the browser part skips */ }
const PAGES = ['index.html', 'docs/index.html', 'docs/format.html', 'docs/assets.html', 'docs/editor-guide.html', 'docs/flat-view.html', 'docs/layers.html', 'api.html', 'gallery.html', 'playground.html', 'changelog.html'];
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const dir = mkdtempSync(join(tmpdir(), 'site-'));
const built = buildSite(dir);

test('the pages: the CSP on each, relative paths, links out only to the project\'s own places', async () => {
  const files = await built;
  for (const p of PAGES) assert.ok(files.includes(p), p);
  const out = new Set<string>();
  for (const p of files.filter(f => f.endsWith('.html'))) {
    const html = readFileSync(join(dir, p), 'utf8');
    assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`), `${p}: its CSP`);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/, `${p}: no inline script`);
    for (const m of html.matchAll(/\s(src|href)="([^"]+)"/g)) {
      const u = m[2];
      assert.ok(!u.startsWith('/'), `${p}: a root-absolute path: ${u}`);
      if (/^https?:/.test(u)) { assert.equal(m[1], 'href', `${p}: something loaded from outside: ${u}`); out.add(new URL(u).origin + new URL(u).pathname.split('/').slice(0, 3).join('/')); }
      else if (!u.startsWith('#') && !u.startsWith('data:')) assert.ok(existsSync(join(dir, p, '..', u.split('#')[0])), `${p}: ${u} is there`);
    }
  }
  const allowed = [REPO, NPM, CLOUD_EDITOR].map(u => new URL(u).origin + new URL(u).pathname.split('/').slice(0, 3).join('/'));
  assert.deepEqual([...out].filter(o => !allowed.some(a => o.startsWith(a.replace(/\/$/, '')))), []);
});

test('the playground\'s services: isodiag/1\'s keys where the caret is (in list items too), its words on hover', () => {
  const S = ISODIAG_SERVICES;
  const keys = (before: string, after = '\n') => { const t = before + after; return S.completionAt(S.docFor(t), before.length).items.map(i => i.label); };
  assert.ok(keys('isodiag: 1\n').includes('scenes'), 'top level');
  const scene = keys('isodiag: 1\nscenes:\n  - id: s\n    ');
  for (const k of ['title', 'regions', 'nodes', 'routes', 'steps']) assert.ok(scene.includes(k), `a scene's ${k}: ${scene}`);
  assert.ok(!scene.includes('id'), 'id is written already');
  const node = keys('isodiag: 1\nscenes:\n  - id: s\n    nodes:\n      - id: a\n        ');
  for (const k of ['asset', 'role', 'right-of', 'label']) assert.ok(node.includes(k), `a node's ${k}: ${node}`);
  const t = 'isodiag: 1\ntitle: x\n';
  assert.match(S.hoverAt(S.docFor(t), 2)!.parts.join(' '), /Format version/);
});

test('in Chrome, from a sub-path with no headers: every page light and dark clean, the switch, the playground, the filter', { skip: chrome ? false : 'no Chrome', timeout: 180000 }, async () => {
  await built;
  const server = createServer((req, res) => {
    const u = new URL(req.url!, 'http://x');
    if (!u.pathname.startsWith('/isometric-diagrams/')) { res.writeHead(404); res.end(); return; }
    const f = resolve(dir, '.' + decodeURIComponent(u.pathname.slice('/isometric-diagrams'.length)).replace(/\/$/, '/index.html'));
    if (!f.startsWith(dir + sep) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
    res.end(readFileSync(f));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/isometric-diagrams/`;
  const flags: string[] = headless();
  const profile = flags.find(f => f.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length);
  const proc = spawn(chrome!, [...flags, '--remote-debugging-port=0', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  let ws: WebSocket | undefined;
  try {
    let port = 0;
    for (let i = 0; i < 200 && !port; i++) { await sleep(50); try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { /* not yet */ } }
    assert.ok(port, 'Chrome gave a DevTools port');
    const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[]).find(t => t.type === 'page')!;
    const sock = ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { sock.onopen = r; sock.onerror = j; });
    let id = 0;
    const waiting = new Map<number, (d: { result?: unknown; error?: { message: string } }) => void>();
    const errors: string[] = [], outside: string[] = [];
    sock.onmessage = m => {
      const d = JSON.parse(String(m.data));
      if (d.id && waiting.has(d.id)) { waiting.get(d.id)!(d); waiting.delete(d.id); return; }
      if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text);
      else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((a: { value?: string }) => a.value).join(' '));
      else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errors.push(`${d.params.entry.text} ${d.params.entry.url ?? ''}`);
      else if (d.method === 'Network.requestWillBeSent') { const u: string = d.params.request.url; if (!u.startsWith(base) && !u.startsWith('data:')) outside.push(u); }
    };
    const cdp = (method: string, params = {}) => new Promise<{ result?: { value?: unknown } }>((r, j) => { const n = ++id; waiting.set(n, d => (d.error ? j(new Error(d.error.message)) : r(d.result as never))); sock.send(JSON.stringify({ id: n, method, params })); });
    const ev = async <T>(expr: string) => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value as T;
    const until = async (cond: string, what: string) => { for (let i = 0; i < 150; i++) { if (await ev<boolean>(`!!(${cond})`)) return; await sleep(60); } assert.fail(`timed out: ${what}`); };
    for (const m of ['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable']) await cdp(m);
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `window.__csp = []; addEventListener('securitypolicyviolation', e => __csp.push(e.violatedDirective + ' ' + e.blockedURI));` });
    for (const scheme of ['light', 'dark']) {
      await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      for (const p of PAGES) {
        await cdp('Page.navigate', { url: base + p });
        await until(`document.documentElement.dataset.ready === 'true'`, `${p} (${scheme}) runs its script`);
        // the drawings on screen are drawn
        if (/index\.html$|gallery|playground/.test(p) && !p.startsWith('docs/')) await until(`document.querySelector('.view svg')`, `${p}: a drawing`);
        assert.deepEqual(await ev('__csp'), [], `${p} (${scheme}): CSP violations`);
      }
    }
    // SITE_SHOTS=DIR: the home page, light, as the README shows it (docs/img/site-home.png)
    if (process.env.SITE_SHOTS) {
      await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
      await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await cdp('Page.navigate', { url: base + 'index.html' });
      await until(`document.querySelector('.view svg')`, 'the hero drawn');
      await sleep(400);
      const shot = await cdp('Page.captureScreenshot', { format: 'png' }) as unknown as { data: string };
      mkdirSync(process.env.SITE_SHOTS, { recursive: true });
      writeFileSync(join(process.env.SITE_SHOTS, 'site-home.png'), Buffer.from(shot.data, 'base64'));
      await cdp('Emulation.clearDeviceMetricsOverride');
    }
    // the hero: 3D, then 2D by its switch
    await cdp('Page.navigate', { url: base + 'index.html' });
    await until(`document.querySelector('.view-switch [data-mode="2d"]')`, 'the hero\'s switch');
    await ev(`document.querySelector('.view-switch [data-mode="2d"]').click()`);
    await until(`document.querySelector('.dual-view')?.dataset.mode === '2d'`, 'the hero in 2D');
    // the playground: Monaco, the engine's text pane, in place of the plain textarea
    await cdp('Page.navigate', { url: base + 'playground.html' });
    await until(`document.querySelector('[data-playground][data-editor="monaco"]') && document.querySelector('#yaml-editor .monaco-editor') && document.querySelector('[data-playground] .view svg')`, 'Monaco and the drawing');
    assert.equal(await ev(`document.querySelector('#yaml').hidden && !document.querySelector('#yaml-editor').hidden`), true, 'the editor in place of the textarea');
    // a mistake: marked on its line and listed; ⌘Z (the model's undo) takes it back and it draws again
    await ev(`(() => { const m = __playground.pane.model; m.setValue(m.getValue().replace('kind: slab', 'kind: slob')); })()`);
    await until(`document.querySelector('.diags li.error')`, 'the mistake shown');
    assert.match(await ev<string>(`document.querySelector('.diags li.error').textContent`), /^line \d+: .*slob/);
    assert.equal(await ev('document.querySelectorAll("[data-playground] .view svg").length'), 0, 'no drawing while it has an error');
    const marker = await ev<{ line: number; sev: number } | null>(`(() => { const m = __playground.pane.monaco.editor.getModelMarkers({ owner: 'problems' }).find(x => /slob/.test(x.message)); return m ? { line: m.startLineNumber, sev: m.severity } : null; })()`);
    assert.deepEqual(marker, { line: 8, sev: 8 }, 'an error marker on the line that has it');
    await ev(`__playground.doc.undo()`);
    await until(`document.querySelector('[data-playground] .view svg') && !document.querySelector('.diags li') && !__playground.pane.monaco.editor.getModelMarkers({ owner: 'problems' }).length`, 'drawn again, unmarked');
    // completion in the editor: a new line in the region (a list item) offers a region's keys
    await ev(`(() => { const e = __playground.pane.editor; e.focus(); e.setPosition({ lineNumber: 9, column: 26 }); e.trigger('test', 'type', { text: '\\n' }); e.executeEdits('test', [{ range: e.getModel().getFullModelRange().setStartPosition(e.getPosition().lineNumber, 1).setEndPosition(e.getPosition().lineNumber, e.getModel().getLineMaxColumn(e.getPosition().lineNumber)), text: '        ' }]); e.setPosition({ lineNumber: 10, column: 9 }); e.trigger('test', 'editor.action.triggerSuggest', {}); })()`);
    await until(`[...document.querySelectorAll('.suggest-widget .monaco-list-row')].some(r => /padding/.test(r.getAttribute('aria-label') ?? r.textContent))`, 'the suggestions');
    const offered = await ev<string[]>(`[...document.querySelectorAll('.suggest-widget .monaco-list-row')].map(r => (r.getAttribute('aria-label') ?? r.textContent).split(',')[0].trim())`);
    assert.ok(!offered.some(o => /^(kind|label|id)$/.test(o)), `what is written is not offered again: ${offered}`);
    await ev(`__playground.pane.editor.trigger('test', 'hideSuggestWidget', {}); __playground.doc.undo()`);
    // the examples: the drop-down holds the gallery's drawings; one loads and draws
    const opts = await ev<string[]>(`[...document.querySelectorAll('#example option')].map(o => o.value)`);
    assert.equal(opts.length, GALLERY.length + 1, 'Hello and every gallery drawing');
    await ev(`(() => { const s = document.querySelector('#example'); s.value = 'demo'; s.dispatchEvent(new Event('change')); })()`);
    await until(`__playground.doc.text === document.querySelector('#examples textarea[data-example="demo"]').value && document.querySelector('[data-playground] .view svg')`, 'the demo loaded and drawn');
    assert.equal(await ev(`__playground.pane.model.getValue() === __playground.doc.text`), true, 'Monaco shows it');
    // the theme control: Dark kept, Monaco dark; System forgets it; Light kept
    const bg = `getComputedStyle(document.querySelector('#yaml-editor .monaco-editor-background')).backgroundColor`;
    await ev(`document.querySelector('.theme-pick [data-theme="dark"]').click()`);
    await until(`document.documentElement.dataset.theme === 'dark' && localStorage.getItem('site-theme') === 'dark'`, 'dark, kept');
    const darkBg = await ev<string>(bg);
    await ev(`document.querySelector('.theme-pick [data-theme="light"]').click()`);
    await until(`document.documentElement.dataset.theme === 'light' && localStorage.getItem('site-theme') === 'light'`, 'light, kept');
    assert.notEqual(await ev<string>(bg), darkBg, 'Monaco follows the theme');
    assert.deepEqual(await ev(`[...document.querySelectorAll('.theme-pick button')].map(b => b.textContent + ':' + b.getAttribute('aria-pressed'))`), ['Light:true', 'Dark:false', 'System:false']);
    await ev(`document.querySelector('.theme-pick [data-theme="system"]').click()`);
    await until(`!document.documentElement.dataset.theme && localStorage.getItem('site-theme') === null`, 'system: nothing kept');
    // the cloud editor, linked prominently from the home page and the playground
    for (const p of ['playground.html', 'index.html']) {
      await cdp('Page.navigate', { url: base + p });
      await until(`document.documentElement.dataset.ready === 'true'`, p);
      assert.equal(await ev(`document.querySelector('main .cta a.btn')?.getAttribute('href')`), CLOUD_EDITOR, `${p}: the call to the cloud editor`);
      assert.equal(await ev(`document.querySelector('.top .nav-cta')?.getAttribute('href')`), CLOUD_EDITOR, `${p}: in the header`);
    }
    // the gallery: a feature chip hides what lacks it
    await cdp('Page.navigate', { url: base + 'gallery.html' });
    await until(`document.documentElement.dataset.ready === 'true'`, 'the gallery');
    const shown = await ev<[number, number]>(`(() => { const all = document.querySelectorAll('.gallery .item').length; document.querySelector('.chip[data-feature="nesting"]').click(); return [all, document.querySelectorAll('.gallery .item:not([hidden])').length]; })()`);
    assert.ok(shown[1] > 0 && shown[1] < shown[0], `nesting: ${shown[1]} of ${shown[0]}`);
    assert.deepEqual(errors, [], 'no errors');
    // the CSP is the meta's, and it holds: an inline script is refused (Chrome logs the refusal as an error)
    assert.equal(await ev(`(async () => { const s = document.createElement('script'); s.textContent = 'window.__ran = 1'; document.head.append(s); await new Promise(r => setTimeout(r, 50)); return !window.__ran && __csp.some(v => v.startsWith('script-src')); })()`), true);
    assert.deepEqual(outside, [], 'no request outside the site');
  } finally {
    ws?.close();
    proc.kill();
    server.close();
  }
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
