// The HTML page around the scenes: header, one section per scene, theme toggle. One file, no network.

import { bindMotion, motionOfSteps, motionSource } from '../iso-objects/timeline.ts';
import type { StepData } from '../iso-objects/steps.ts';
import { esc } from '../iso-core/kernel.ts';
import type { Compiled } from '../iso-objects/compile.ts';
import { themeCss } from '../iso-core/theme.ts';
import { baseCss, PLAYER_CSS } from '../iso-objects/css.ts';
import { regionKind } from '../iso-objects/kinds.ts';
import type { CompiledScene } from '../iso-objects/compile.ts';
import { colorRef } from '../iso-core/theme.ts';

/** the page's script tags opened as a joined string: a bundle of this module, inlined in an HTML page, then holds no
 *  "<script" (which would switch the page's parser) — a minifier folds a literal, never a join */
const SCRIPT = ['<', 'script'].join('');

/** A small Markdown subset for captions: `code`, **bold**, *em*, [text](url), paragraphs. */
export function md(s: string | undefined): string {
  if (!s) return '';
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t, u) => /^(https?:|#|\.{0,2}\/)/.test(u.replace(/&amp;/g, '&')) ? `<a href="${u}">${t}</a>` : t);
}
const paras = (s: string | undefined) => (s ?? '').split(/\n\s*\n/).filter(Boolean).map(p => `<p class="sec-sub">${md(p.trim())}</p>`).join('');

export interface PageOpts { runtime?: string; extraHead?: string; extraBody?: string }

/** a scene's own motion, where it has any that binds: what its page plays, in place of its steps */
const ownMotion = (c: Compiled, s: CompiledScene) => !!s.motion && bindMotion(s, s.motion, { kinds: c.theme!.kinds }).ok;
/** what the page steps through: the scene's steps, or the beats of its own motion */
function stepsOf(c: Compiled, s: CompiledScene): StepData[] {
  if (!ownMotion(c, s)) return s.steps.steps;
  return bindMotion(s, s.motion!, { kinds: c.theme!.kinds }).beats.map(b => ({
    n: b.index + 1, num: b.index + 1, kind: 'control', color: b.say?.color ?? colorRef(c.theme!, c.theme!.kinds.control?.color ?? 'control'),
    heading: b.say?.title ?? b.name, caption: b.say?.text ?? '', command: b.say?.code ?? '', phases: [], pulses: [], lit: [], duration: b.end - b.start,
  }));
}

/** The data the player runs on, for every scene with steps. */
export function stepData(c: Compiled): string {
  return JSON.stringify({
    scenes: c.scenes.map(s => {
      const own = ownMotion(c, s), steps = stepsOf(c, s), doc = own ? s.motion : s.steps.steps.length ? motionOfSteps(s) : undefined;
      return {
        id: s.id, loop: s.raw.loop ?? true, dim: s.raw.dim ?? 'flows', vis: s.steps.vis,
        // (where a step's view goes is its document's camera)
        steps: steps.map(({ focus: _, ...st }) => ({ ...st, caption: md(st.caption) })),
        assemble: s.assemble, grid: !!s.grid.show, source: motionSource(s), ...(doc ? { doc } : {}), ...(own ? { own } : {}),
      };
    }),
  });
}

export function legend(c: Compiled, s: CompiledScene): string {
  const t = c.theme!, spec = s.raw.legend;
  if (spec === false) return '';
  const kinds = Array.isArray(spec) ? spec : s.steps.kindsUsed.filter(k => s.routes.some(r => r.kind === k) || s.steps.steps.some(st => st.phases.some(p => p.some(tk => tk.kind === k))));
  // a region kind's own row (its kind's legend), else a route kind's from the theme
  const row = (l: { label: string; swatch: string; box: boolean }) => `<span><i${l.box ? ' class="box"' : ''} style="${l.swatch}"></i>${l.label}</span>`;
  const items = kinds.map(k => {
    const rl = regionKind(c.catalog, k)?.legend;
    if (rl) return row(rl);
    const d = t.kinds[k];
    if (!d) return '';
    const style = `border-color:${colorRef(t, d.color)}${d.dash === 'dashed' ? ';border-top-style:dashed' : d.dash === 'dotted' ? ';border-top-style:dotted' : ''}`;
    return `<span><i style="${style}"></i>${md(d.legend)}</span>`;
  });
  if (!Array.isArray(spec)) {
    const kindsOf = new Set(s.layout.items.map(p => p.region?.kind));
    for (const [name, rk] of Object.entries(c.catalog.regions)) if (rk.legend?.auto && kindsOf.has(name)) items.push(row(rk.legend));
  }
  return items.join('');
}

function player(c: Compiled, s: CompiledScene): string {
  const st = stepsOf(c, s);
  const tools = `<div class="tools">
        <button class="pbtn small" type="button" data-a="grid" aria-pressed="${s.grid.show ? 'true' : 'false'}" title="Show the floor grid">Grid</button>
        <button class="pbtn small" type="button" data-a="assemble" title="Draw the diagram again, piece by piece">Assemble</button>
      </div>`;
  if (!st.length) return `<div class="player">${tools}</div>`;
  const f = st[0];
  return `<div class="player">
      <div class="ctrls">
        <button class="pbtn icon" type="button" data-a="prev" aria-label="Previous step">‹</button>
        <button class="pbtn primary" type="button" data-a="play" aria-label="Play">▶ Play</button>
        <button class="pbtn icon" type="button" data-a="next" aria-label="Next step">›</button>
      </div>
      ${tools}
      <div class="cap" aria-live="polite">
        <div class="cap-h"><span class="num" style="background:${f.color}">${f.num}</span><span class="h">${esc(f.heading)}</span><span class="cnt">1 / ${st.length}</span></div>
        <p class="cap-t">${md(f.caption)}</p>
        <pre class="cap-c">${esc(f.command)}</pre>
        <div class="prog"><i></i></div>
      </div>
      <div class="dots"></div>
    </div>`;
}

function stepList(c: Compiled, s: CompiledScene): string {
  const st = stepsOf(c, s);
  if (!st.length) return '';
  return `<details class="steps"><summary>All ${st.length} steps as text</summary><ol>${st.map(x =>
    `<li value="${x.num}"><b>${esc(x.heading)}.</b> ${md(x.caption)}${x.command ? `<br><code>${esc(x.command)}</code>` : ''}</li>`).join('')}</ol></details>`;
}

export function renderPage(c: Compiled, opts: PageOpts = {}): string {
  const doc = c.doc!, title = doc.title ?? doc.scenes[0]?.title ?? 'Diagram';
  const pills = (doc.pills ?? []).map(p => `<span class="pill">${md(p)}</span>`).join('');
  const sections = c.scenes.map(s => `
<section class="scene" id="scene-${esc(s.id)}">
  <h2>${esc(s.raw.title)}</h2>
  ${paras(s.raw.caption)}
  <div class="figure" tabindex="-1">
    <div class="scroller">${s.grid.show ? s.rendered.svg.replace('<svg ', '<svg class="show-grid" ') : s.rendered.svg}</div>
    ${player(c, s)}
    <div class="legend">${legend(c, s)}</div>
  </div>
  ${stepList(c, s)}
  ${s.raw.after ? `<div class="after">${paras(s.raw.after)}</div>` : ''}
</section>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${doc.lede ? `<meta name="description" content="${esc(doc.lede)}">` : ''}
<style>
${themeCss(c.theme!)}${baseCss(c.catalog)}${PLAYER_CSS}
</style>
${opts.extraHead ?? ''}
</head>
<body>
<div class="wrap">
  <header class="page">
    <div>
      <h1>${esc(title)}</h1>
      ${doc.lede ? `<p class="lede">${md(doc.lede)}</p>` : ''}
    </div>
    <div class="pills">${pills}<button class="theme" id="themeBtn" type="button">Theme</button></div>
  </header>
${sections}
  ${doc.after ? paras(doc.after) : ''}
  ${doc.footer ? `<footer>${md(doc.footer)}</footer>` : ''}
</div>
${SCRIPT} type="application/json" id="diagram-steps">${stepData(c).replace(/</g, '\\u003c')}</script>
${SCRIPT}>
(function(){
  var root=document.documentElement, m=/theme=(light|dark)/.exec(location.hash);
  try{var t=localStorage.getItem('diagram-theme'); if(t) root.dataset.theme=t;}catch(e){}
  if(m) root.dataset.theme=m[1];
  document.getElementById('themeBtn').addEventListener('click',function(){
    var dark=root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme=dark?'light':'dark';
    try{localStorage.setItem('diagram-theme',root.dataset.theme);}catch(e){}
  });
})();
</script>
${opts.runtime ? `${SCRIPT}>${opts.runtime}</script>` : ''}
${opts.extraBody ?? ''}
</body>
</html>
`;
}
