// The proof sheet: a contact sheet of a diagram. A catalog of every actor and object with all its copy, the page's own
// copy, then one still frame per step, each with its heading, caption, command and the step's YAML as written, with
// line numbers. Pure: frames are the step's state drawn in Node from the rendered SVG, so it is deterministic and
// the editor can build it in the browser too.

import { esc, iso, Kernel, tag } from '../iso-core/kernel.ts';
import { getAsset, NODE_ASSETS } from '../iso-systems/nodes.ts';
import { regionKind } from '../iso-objects/kinds.ts';
import type { Compiled, CompiledScene } from '../iso-systems/compile.ts';
import { focusView } from '../iso-objects/focus.ts';
import { alongPath, introSvg } from '../iso-objects/motion.ts';
export { alongPath };
import type { StepData } from '../iso-objects/steps.ts';
import type { Placed, RawNote } from '../iso-objects/types.ts';
import { PLAYER_CSS } from '../iso-objects/css.ts';
import { baseCss } from '../iso-objects/css.ts';
import { systems } from '../iso-systems/catalog.ts';
import { legend, md } from '../iso-viewer/page.ts';
import { regionRole } from '../iso-objects/scene.ts';
import { themeCss } from '../iso-core/theme.ts';

export interface ProofOpts {
  /** the live page the frames link to (e.g. NAME.live.html); none: no links */
  liveHref?: string;
  /** a few frames of the assemble intro before each scene's steps */
  withIntro?: boolean;
  /** the source file's name, shown with the YAML excerpts */
  fileName?: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

// ---- a frame: the rendered SVG with one step's state applied ----

/** Rewrite every start tag: `extra` returns classes to add and attributes to set for a tag's attributes. */
function retag(svg: string, extra: (a: Record<string, string>, name: string) => { cls?: string[]; set?: Record<string, string> } | null): string {
  return svg.replace(/<([a-zA-Z]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g, (m, name: string, attrs: string, selfClose: string) => {
    const a: Record<string, string> = {};
    for (const [, k, v] of attrs.matchAll(/([\w:-]+)="([^"]*)"/g)) a[k] = v;
    const x = extra(a, name);
    if (!x || (!x.cls?.length && !x.set)) return m;
    if (x.cls?.length) a.class = [a.class, ...x.cls].filter(Boolean).join(' ');
    Object.assign(a, x.set ?? {});
    return `<${name}${Object.entries(a).map(([k, v]) => ` ${k}="${v}"`).join('')}${selfClose ? '/' : ''}>`;
  });
}

const TOKEN_AT = 0.75;

/** The scene at step i (0-based), as a static SVG. */
export function frameSvg(s: CompiledScene, i: number, idPrefix: string): string {
  const st = s.steps.steps[i], n = st.n, lit = new Set(st.lit), vis = s.steps.vis;
  const dimAll = s.raw.dim === 'all';
  let svg = retag(s.rendered.svg, (a, name) => {
    const cls: string[] = [];
    if (name === 'svg') { cls.push('focus'); if (dimAll) cls.push('dim-all'); }
    if (a['data-hl'] && a['data-hl'].split(' ').some(x => lit.has(x))) cls.push('hl');
    if (dimAll && a['data-dim'] !== undefined && a['data-id'] && lit.has(a['data-id'])) cls.push('hl');
    if (a['data-step'] === String(n) || a['data-badge'] === String(n)) cls.push('on');
    const vid = a['data-id'] ?? a['data-hl'];
    if (vid && vis[vid] && !vis[vid][i]) cls.push('pre');
    return { cls };
  });
  // pulses and tokens, drawn where the player would show them
  let anim = st.pulses.map(([x, y, rx, ry]) => tag('ellipse', { cx: x, cy: y, rx, ry, class: 'pulse', style: `stroke:${st.color}` })).join('');
  for (const ph of st.phases) for (const tk of ph) {
    const d = s.rendered.paths[tk.route];
    if (!d) continue;
    const [x, y] = alongPath(d, TOKEN_AT);
    anim += tag('circle', { cx: x, cy: y, r: 7, class: 'tok', style: `fill:${tk.color}` });
  }
  svg = svg.replace('<g class="g-anim"></g>', `<g class="g-anim">${anim}</g>`);
  return framed(svg, s, st, idPrefix);
}

/** The view (focus) and unique ids for a frame among many on one page. */
function framed(svg: string, s: CompiledScene, st: StepData | undefined, idPrefix: string): string {
  const full = s.rendered.viewBox as unknown as number[];
  const v = focusView(full, st?.focus).map(x => Math.round(x * 10) / 10);
  svg = svg.replace(/viewBox="[^"]*"/, `viewBox="${v.join(' ')}"`);
  // ids in <defs> (arrowheads, the orb's gradient) must be unique on a page of many frames
  return svg.replace(/id="([^"]+)"/g, `id="${idPrefix}-$1"`).replace(/url\(#([^)]+)\)/g, `url(#${idPrefix}-$1)`);
}

/** A frame of the assemble intro at time t (ms): the motion core's, as a static SVG. */
const introFrame = (s: CompiledScene, t: number, idPrefix: string) => framed(introSvg(s, t), s, undefined, idPrefix);

// ---- thumbnails ----

function thumbSvg(p: Placed): string {
  const k = new Kernel();
  let inner = '';
  if (p.type === 'node') {
    const n = p.node!, a = getAsset(n.asset) ?? NODE_ASSETS.block;
    const ghost = n.ghost || (n.deco ?? []).includes('ghost');
    inner = tag('g', { class: ['blk', `k-${n.role ?? a.role}`, a.cls, ghost ? 'ghost' : ''].filter(Boolean).join(' ') }, a.draw(k, p.box, n));
  } else {
    const r = p.region!, role = regionRole(systems, r), shape = regionKind(systems, r.kind)?.shape;
    const b = shape === 'zone' ? { ...p.box, z1: p.box.z0 + 0.05 } : p.box;
    inner = tag('g', { class: `blk k-${role}${shape === 'walled' ? ' wall' : ''}${r.ghost ? ' ghost' : ''}${shape === 'tunnel' ? ' tunnel' : ''}` }, k.blockFaces(b));
  }
  const bb = k.bounds, pad = 4;
  const vb = [bb.x0 - pad, bb.y0 - pad, bb.x1 - bb.x0 + 2 * pad, bb.y1 - bb.y0 + 2 * pad].map(v => Math.round(v));
  const defs = [...k.defs.values()].join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="thumb" viewBox="${vb.join(' ')}" role="img" aria-label="${esc(p.id)}">${defs ? `<defs>${defs}</defs>` : ''}${inner}</svg>`;
}
const routeThumb = (kind: string) => `<svg class="thumb" viewBox="0 0 60 14" role="img" aria-label="${esc(kind)} route"><path d="M4,7 L50,7" class="flow f-${esc(kind)}"/><path d="M48,2 L57,7 L48,12 z" class="t-${esc(kind)}"/></svg>`;
const noteThumb = `<svg class="thumb" viewBox="0 0 30 30" role="img" aria-label="text"><text x="15" y="21" text-anchor="middle" class="lbl" style="font-size:16px">T</text></svg>`;

// ---- the catalog ----

interface Entry { id: string; what: string; where: string; thumb: string; copy: [string, string][]; steps: number[]; appears?: string }

function catalog(s: CompiledScene): Entry[] {
  const steps = s.steps.steps;
  const inSteps = (id: string) => steps.filter(st => st.lit.includes(id) || st.phases.some(p => p.some(t => t.route === id))).map(st => st.n);
  const parentOf = (p: Placed) => p.parent ? p.parent.id : 'the scene';
  const out: Entry[] = [];
  const notesOn = new Map<string, RawNote[]>();
  for (const nt of s.raw.notes ?? []) if (nt.on) notesOn.set(nt.on, [...(notesOn.get(nt.on) ?? []), nt]);
  const saysAt = new Map<string, { step: number; text: string }[]>();
  ((s.raw.steps ?? []) as { say?: { at: string | number[]; text: string }[] }[]).forEach((st, i) => {
    for (const c of st.say ?? []) if (typeof c.at === 'string') saysAt.set(c.at, [...(saysAt.get(c.at) ?? []), { step: steps[i].n, text: c.text }]);
  });
  const appears = (x: { appears?: unknown; disappears?: unknown }) => [x.appears !== undefined ? `appears at ${x.appears}` : '', x.disappears !== undefined ? `gone at ${x.disappears}` : ''].filter(Boolean).join(', ') || undefined;
  const extraCopy = (id: string): [string, string][] => [
    ...(notesOn.get(id) ?? []).flatMap(nt => [nt.floor ? ['floor text', nt.floor] : null, nt.face ? ['face text', nt.face] : null, nt.label ? ['note', nt.label] : null, nt.sub ? ['note sub', nt.sub] : null].filter(Boolean) as [string, string][]),
    ...(saysAt.get(id) ?? []).map(c => [`callout, step ${pad2(c.step)}`, c.text] as [string, string]),
  ];
  for (const p of s.layout.items.filter(x => x.type === 'region')) {
    const r = p.region!;
    out.push({ id: p.id, what: `region · ${r.kind}${r.role ? ` · ${r.role}` : ''}${r.ghost ? ' · ghost' : ''}`, where: parentOf(p), thumb: thumbSvg(p),
      copy: [...(r.label ? [['label', r.label] as [string, string]] : []), ...extraCopy(p.id)], steps: inSteps(p.id), appears: appears(r) });
  }
  for (const p of s.layout.items.filter(x => x.type === 'node')) {
    const nd = p.node!, a = getAsset(nd.asset) ?? NODE_ASSETS.block;
    out.push({ id: p.id, what: `node · ${a.name} · ${nd.role ?? a.role}${nd.ghost ? ' · ghost' : ''}${nd.face ? ` · face ${nd.face}` : ''}`, where: parentOf(p), thumb: thumbSvg(p),
      copy: [...(nd.label ? [['label', nd.label] as [string, string]] : []), ...(nd.sub ? [['sublabel', nd.sub] as [string, string]] : []), ...extraCopy(p.id)],
      steps: inSteps(p.id), appears: appears(nd) });
  }
  for (const r of s.routes) {
    const L = r.raw.label, text = typeof L === 'string' ? L : L?.text;
    out.push({ id: r.id, what: `route · ${r.kind}`, where: `${r.raw.from} → ${r.raw.to}`, thumb: routeThumb(r.kind),
      copy: [...(text ? [['route label', text] as [string, string]] : []), ...extraCopy(r.id)], steps: inSteps(r.id), appears: appears(r.raw) });
  }
  (s.raw.notes ?? []).forEach((nt, i) => {
    if (nt.on) return;   // listed with what it is on
    out.push({ id: `note ${i + 1}`, what: `note · ${nt.floor ? 'floor' : nt.face ? 'face' : 'label'}`, where: nt.at ? `at [${nt.at.join(', ')}]` : 'the scene', thumb: noteThumb,
      copy: [nt.floor ? ['floor text', nt.floor] : null, nt.face ? ['face text', nt.face] : null, nt.label ? ['label', nt.label] : null, nt.sub ? ['sublabel', nt.sub] : null].filter(Boolean) as [string, string][], steps: [] });
  });
  // point callouts (at a grid point, not a node) go with their step
  ((s.raw.steps ?? []) as { say?: { at: string | number[]; text: string }[] }[]).forEach((st, i) => {
    for (const c of st.say ?? []) if (Array.isArray(c.at)) out.push({ id: `callout, step ${pad2(steps[i].n)}`, what: 'callout', where: `at [${c.at.join(', ')}]`, thumb: noteThumb, copy: [['callout', c.text]], steps: [steps[i].n] });
  });
  return out;
}

// ---- the YAML of a step, as written ----

export function stepYaml(c: Compiled, sceneIndex: number, stepIndex: number): { start: number; end: number; lines: string[] } | undefined {
  const sp = c.parsed?.span(`/scenes/${sceneIndex}/steps/${stepIndex}`);
  if (!sp || !c.source) return undefined;
  const lines = c.source.split(/\r?\n/).slice(sp.start - 1, sp.end);
  return { ...sp, lines };
}

// ---- the page ----

export function renderProof(c: Compiled, opts: ProofOpts = {}): string {
  const doc = c.doc!, title = doc.title ?? doc.scenes[0]?.title ?? 'Diagram';
  const frames: string[] = [];
  const sections = c.scenes.map((s, si) => {
    const sid = s.id;
    const cat = catalog(s);
    const stepLinks = (ns: number[]) => [...new Set(ns)].map(n => `<a href="#f-${esc(sid)}-${pad2(n)}">${pad2(n)}</a>`).join(' ');
    const catRows = cat.map(e => `<tr id="c-${esc(sid)}-${esc(e.id)}"><td class="th">${e.thumb}</td><td><code>${esc(e.id)}</code><div class="what">${esc(e.what)}</div><div class="where">in ${esc(e.where)}${e.appears ? ` · ${esc(e.appears)}` : ''}</div></td>
      <td class="copy">${e.copy.length ? e.copy.map(([k, v]) => `<div><span class="k">${esc(k)}</span> ${esc(v)}</div>`).join('') : '<span class="none">no copy</span>'}</td>
      <td class="steps">${e.steps.length ? stepLinks(e.steps) : '<span class="none">—</span>'}</td></tr>`).join('\n');
    const intro = opts.withIntro && s.raw.assemble !== false && s.rendered.assembly.pieces.length
      ? [0.2, 0.45, 0.75].map((f, k) => {
        const t = Math.round(s.rendered.assembly.total * f);
        return frameCard(`${sid}·i${k + 1}`, `f-${sid}-i${k + 1}`, introFrame(s, t, `${sid}-i${k + 1}`), `Assemble intro, ${t} ms`, 'The pieces come in from their nearest edge.', '', undefined, undefined);
      }).join('') : '';
    const cards = s.steps.steps.map((st, i) => {
      const y = stepYaml(c, si, i);
      const live = opts.liveHref ? `${opts.liveHref}#scene=${encodeURIComponent(sid)}&step=${i + 1}` : undefined;
      return frameCard(`${sid}·${pad2(i + 1)}`, `f-${sid}-${pad2(st.n)}${s.steps.steps.findIndex(x => x.n === st.n) === i ? '' : `-${i + 1}`}`,
        frameSvg(s, i, `${sid}-${i + 1}`), `${st.num}. ${st.heading}`, md(st.caption), st.command, y, live, st.color);
    }).join('');
    frames.push(sid);
    return `<section class="scene" id="scene-${esc(sid)}">
  <h2>${esc(s.raw.title)} <span class="sid">scene ${esc(sid)} · ${s.steps.steps.length} steps</span></h2>
  ${s.raw.caption ? `<p class="sec-sub">${md(s.raw.caption)}</p>` : ''}
  <h3>Catalog</h3>
  <div class="tablewrap"><table class="cat"><thead><tr><th></th><th>Id and kind</th><th>Copy</th><th>Steps</th></tr></thead><tbody>
${catRows}
  </tbody></table></div>
  <h3>Frames</h3>
  <div class="sheet">${intro}${cards}</div>
</section>`;
  }).join('\n');

  const pageCopy: [string, string][] = [
    ['title', title], ...(doc.lede ? [['lede', doc.lede] as [string, string]] : []), ...(doc.pills ?? []).map(p => ['pill', p] as [string, string]),
    ...c.scenes.flatMap(s => [[`scene ${s.id} · title`, s.raw.title], ...(s.raw.caption ? [[`scene ${s.id} · caption`, s.raw.caption]] : []), ...(s.raw.aria ? [[`scene ${s.id} · aria`, s.raw.aria]] : []), ...(s.raw.after ? [[`scene ${s.id} · after`, s.raw.after]] : [])] as [string, string][]),
    ...(doc.after ? [['after', doc.after] as [string, string]] : []), ...(doc.footer ? [['footer', doc.footer] as [string, string]] : []),
  ];
  const legends = c.scenes.map(s => `<div><span class="k">scene ${esc(s.id)}</span><div class="legend inline">${legend(c, s)}</div></div>`).join('');
  const lightVars = Object.entries(c.theme!.light).map(([k, v]) => `--${k}:${v}`).join(';');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · proof sheet</title>
<style>
${themeCss(c.theme!)}${baseCss(systems)}${PLAYER_CSS}
${PROOF_CSS}
@media print{:root,:root[data-theme="dark"]{${lightVars}}}
</style>
</head>
<body class="proof">
<div class="wrap">
  <header class="page">
    <div><h1>${esc(title)}</h1><p class="lede">Proof sheet: every actor and object with its copy, then every step as a still frame with the YAML that makes it.${opts.fileName ? ` Source: <code>${esc(opts.fileName)}</code>.` : ''}</p></div>
    <div class="pills"><span class="pill">${c.scenes.length} scene${c.scenes.length === 1 ? '' : 's'} · ${c.scenes.reduce((n, s) => n + s.steps.steps.length, 0)} frames</span><button class="theme" id="themeBtn" type="button">Theme</button></div>
  </header>
  <nav class="toc">${c.scenes.map(s => `<a href="#scene-${esc(s.id)}">${esc(s.raw.title)}</a>`).join(' · ')}</nav>
  <section class="copy-all"><h2>Page copy</h2>
    <div class="tablewrap"><table class="cat"><tbody>${pageCopy.map(([k, v]) => `<tr><td class="key">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>
    <h3>Legend</h3>${legends}
  </section>
${sections}
</div>
<dialog id="big"><button type="button" class="close" aria-label="Close">×</button><div id="bigBody"></div></dialog>
<script>
(function(){
  var root=document.documentElement, m=/theme=(light|dark)/.exec(location.hash);
  try{var t=localStorage.getItem('diagram-theme'); if(t) root.dataset.theme=t;}catch(e){}
  if(m) root.dataset.theme=m[1];
  document.getElementById('themeBtn').addEventListener('click',function(){
    var dark=root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme=dark?'light':'dark'; try{localStorage.setItem('diagram-theme',root.dataset.theme);}catch(e){}
  });
  var dlg=document.getElementById('big'), body=document.getElementById('bigBody');
  document.querySelectorAll('.frame .shot').forEach(function(s){
    s.addEventListener('click',function(){ body.innerHTML=''; body.appendChild(s.querySelector('svg').cloneNode(true));
      var h=s.closest('.frame').querySelector('h4').cloneNode(true); body.appendChild(h); dlg.showModal(); });
  });
  dlg.querySelector('.close').addEventListener('click',function(){dlg.close();});
  dlg.addEventListener('click',function(e){ if(e.target===dlg) dlg.close(); });
})();
</script>
</body>
</html>
`;
}

function frameCard(num: string, id: string, svg: string, heading: string, caption: string, command: string, y: ReturnType<typeof stepYaml>, live: string | undefined, color?: string): string {
  const yaml = y ? `<pre class="yaml" aria-label="YAML, lines ${y.start} to ${y.end}">${y.lines.map((l, k) => `<span class="ln">${y.start + k}</span>${esc(l)}`).join('\n')}</pre>` : '';
  return `<article class="frame" id="${esc(id)}">
    <div class="neg"><span class="no" style="${color ? `background:${color}` : ''}">${esc(num)}</span>${live ? `<a class="live" href="${esc(live)}">open live ↗</a>` : ''}</div>
    <button class="shot" type="button" aria-label="Open ${esc(heading)} large">${svg}</button>
    <h4>${esc(heading)}</h4>
    ${caption ? `<p>${caption}</p>` : ''}
    ${command ? `<pre class="cmd">${esc(command)}</pre>` : ''}
    ${yaml}
  </article>`;
}

const PROOF_CSS = `
.proof .wrap{max-width:1400px}
.toc{font-size:13px;color:var(--muted);margin:8px 0 0}.toc a{color:var(--send)}
.sid{font-size:13px;font-weight:500;color:var(--muted);margin-left:8px}
h3{font-size:15px;margin:22px 0 8px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.tablewrap{overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:12px}
table.cat{border-collapse:collapse;width:100%;font-size:13px}
.cat td,.cat th{text-align:left;vertical-align:top;padding:7px 10px;border-bottom:1px solid var(--line)}
.cat th{font-size:12px;color:var(--muted);font-weight:700}
.cat tr:last-child td{border-bottom:0}
.cat td.th{width:72px}.cat .thumb{width:64px;height:48px;display:block}
.cat .what{color:var(--muted);font-size:12px}.cat .where{color:var(--muted);font-size:11.5px}
.cat .copy div{margin:2px 0}.cat .k{display:inline-block;min-width:92px;color:var(--muted);font-size:11.5px}
.cat .steps a{color:var(--send);font-variant-numeric:tabular-nums;margin-right:4px}
.none{color:var(--muted)}
.cat td.key{width:150px;color:var(--muted);font-size:12px;white-space:nowrap}
.legend.inline{border:0;padding:4px 0 10px}
.sheet{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px}
.frame{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 12px;min-width:0;break-inside:avoid}
.frame .neg{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.frame .no{font:800 12px ui-monospace,Menlo,monospace;color:var(--on);background:var(--control);border-radius:6px;padding:2px 7px;letter-spacing:.04em}
.frame .live{margin-left:auto;font-size:12px;color:var(--send)}
.frame .shot{display:block;width:100%;padding:0;border:1px solid var(--line);border-radius:8px;background:var(--bg);cursor:zoom-in}
.frame .shot svg{display:block;width:100%;height:auto}
.frame h4{margin:8px 0 2px;font-size:14px}
.frame p{margin:2px 0;font-size:12.5px;color:var(--muted)}
.frame pre{margin:6px 0 0;background:var(--code-bg);border-radius:8px;padding:6px 8px;font-size:11px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}
.frame pre.yaml{color:var(--ink)}
.frame .ln{display:inline-block;min-width:3.2em;color:var(--muted);user-select:none}
.proof .pulse{animation:none;opacity:.85}
.proof [data-hl],.proof [data-id],.proof [data-step]{transition:none}
dialog#big{width:min(96vw,1400px);max-height:94vh;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--ink);padding:14px}
dialog#big svg{width:100%;height:auto;display:block}
dialog#big .close{float:right;font-size:20px;border:0;background:none;color:var(--ink);cursor:pointer}
dialog::backdrop{background:#0008}
@media (max-width:560px){.sheet{grid-template-columns:1fr}}
@media print{
  .theme,.toc,.live,dialog{display:none!important}
  body{background:#fff}
  section.scene{break-before:page}
  .frame{break-inside:avoid;page-break-inside:avoid}
  .sheet{grid-template-columns:repeat(2,1fr)}
  .frame .shot{border-color:#ccc}
}
`;
