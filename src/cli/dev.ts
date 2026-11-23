// isodiag dev: a local page that renders a YAML file and reloads it on save. Errors show over the last good
// diagram, with their lines, and go away when the file is fixed. Node's http and fs.watch only; 127.0.0.1 only.

import { createServer, type ServerResponse } from 'node:http';
import { watch, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { compileFile } from './isodiag.ts';
import { formatDiags } from '../iso-core/errors.ts';
import { renderPage } from '../iso-viewer/page.ts';
import { playerScript } from '../iso-viewer/bundle.ts';
import { esc } from '../iso-core/kernel.ts';

const CLIENT = `<style>
#isodiag-dev{position:fixed;inset:auto 12px 12px 12px;max-height:60vh;overflow:auto;z-index:99;background:#1c1c20;color:#ececf0;
  border:2px solid #ff7a6e;border-radius:12px;padding:12px 16px;font:12.5px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;box-shadow:0 8px 30px #0006}
#isodiag-dev.warn{border-color:#f2b33d}#isodiag-dev b{font-family:system-ui}#isodiag-dev button{float:right;font:inherit;background:none;color:inherit;border:1px solid #fff4;border-radius:6px;cursor:pointer}
</style><script>(function(){
  try{var y=sessionStorage.getItem('isodiag-dev-y'); if(y) scrollTo(0,+y);}catch(e){}
  var box=null;
  function show(kind,text){ if(!box){box=document.createElement('div');box.id='isodiag-dev';document.body.appendChild(box);}
    box.className=kind; box.innerHTML='<button type="button">×</button><b>'+(kind==='warn'?'isodiag: warnings':'isodiag: not rebuilt, the file has errors')+'</b>\\n\\n';
    box.appendChild(document.createTextNode(text)); box.querySelector('button').onclick=function(){box.remove();box=null;}; }
  var es=new EventSource('/events');
  es.addEventListener('reload',function(){ try{sessionStorage.setItem('isodiag-dev-y',String(scrollY));}catch(e){} location.reload(); });
  es.addEventListener('problems',function(e){ var d=JSON.parse(e.data); show(d.kind,d.text); });
})();</script>`;

export function dev(file: string, port = 4173) {
  file = resolve(file);
  if (!existsSync(file)) { console.error(`no such file: ${file}`); process.exit(2); }
  let html = '', problems: { kind: 'error' | 'warn'; text: string } | null = null;
  const clients = new Set<ServerResponse>();
  const send = (event: string, data: unknown) => { for (const c of clients) c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };

  function build(first = false) {
    let out;
    try { out = compileFile(file); } catch (e) { problems = { kind: 'error', text: String((e as Error).stack ?? e) }; send('problems', problems); return; }
    const { c, src } = out;
    const text = c.diags.length ? formatDiags(c.diags, basename(file), src) : '';
    if (!c.ok) {
      problems = { kind: 'error', text };
      console.error(`\n${new Date().toLocaleTimeString()}  ${text}`);
      if (!html) html = `<!doctype html><meta charset="utf-8"><title>isodiag dev</title><body style="background:#131316">${CLIENT}<script>addEventListener('load',()=>{})</script>`;
      send('problems', problems);
      return;
    }
    problems = text ? { kind: 'warn', text } : null;
    html = renderPage(c, { runtime: playerScript(), extraBody: CLIENT });
    console.error(`${new Date().toLocaleTimeString()}  built ${basename(file)}: ${c.scenes.length} scene(s)` + (text ? `, warnings:\n${text}` : ''));
    if (!first) send('reload', {});
  }
  build(true);

  let timer: NodeJS.Timeout | undefined;
  const again = () => { clearTimeout(timer); timer = setTimeout(() => build(), 60); };
  // watch the folder, not the file: editors often replace a file on save
  watch(dirname(file), (_ev, name) => { if (!name || name === basename(file) || /\.ya?ml$/.test(String(name))) again(); });

  createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': hello\n\n');
      clients.add(res);
      if (problems) res.write(`event: problems\ndata: ${JSON.stringify(problems)}\n\n`);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.url === '/' || req.url?.startsWith('/#') || req.url?.startsWith('/?')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found: ' + esc(req.url ?? ''));
  }).listen(port, '127.0.0.1', () => console.error(`isodiag dev: http://127.0.0.1:${port}/  (watching ${basename(file)}; Ctrl-C to stop)`));
}
