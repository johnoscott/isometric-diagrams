// A drawing's stylesheet, scoped so it can live in a host's page beside the host's own (no frame): every rule under one
// root class (nothing styles html, body, * or a bare element), keyframes renamed iso-*, and the drawing's custom
// properties renamed --iso-* so they never meet the page's. Pure: used at build time and by a still render.

/** --name → --iso-name, in declarations and in var() alike */
export const isoVars = (css: string) => css.replace(/--([a-zA-Z][\w-]*)/g, '--iso-$1');

/** Split CSS into its top-level blocks: [prelude, body] (a rule's selectors, or an at-rule and what it holds). */
function blocks(css: string): [string, string][] {
  const out: [string, string][] = [];
  let i = 0;
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    let depth = 1, j = open + 1;
    while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
    out.push([text.slice(i, open).trim(), text.slice(open + 1, j - 1)]);
    i = j;
  }
  return out;
}

/** a selector list split at its top-level commas */
function selectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0, cut = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && !depth) { out.push(list.slice(cut, i).trim()); cut = i + 1; }
  }
  out.push(list.slice(cut).trim());
  return out.filter(Boolean);
}

/** One selector under the root class. :root (the theme's tokens) becomes the root class itself; any state it names
 *  (data-theme: light or dark) is stateRoot's (the element the theme is set on), not the page's. */
export function scopeSelector(sel: string, root: string, stateRoot: string): string {
  const m = /^:root((?:\[[^\]]*\]|:not\([^)]*\))*)(.*)$/.exec(sel);
  // the state root as a class name, given with its dot (as root is) or without (0.7.1: both read the same)
  const st = stateRoot.replace(/^\./, '');
  if (m) { const state = m[1], rest = m[2].trim(); return `${state ? `.${st}${state} ` : ''}${root}${rest ? ' ' + rest : ''}`; }
  if (/^(html|body|\*)\b/.test(sel) || /^[a-z]+$/.test(sel) && !/^(svg|g|text|path|polygon|rect|circle|line)$/.test(sel)) throw new Error(`the canvas's CSS can't style the page: "${sel}"`);
  return `${root} ${sel}`;
}

/** Scope a stylesheet: every rule under the root class; keyframes renamed iso-*; at-rules kept with their rules scoped. */
export function scope(css: string, root: string, stateRoot: string): string {
  let out = '';
  for (const [pre, body] of blocks(css)) {
    if (pre.startsWith('@keyframes')) { out += `@keyframes iso-${pre.slice('@keyframes'.length).trim()}{${body}}\n`; continue; }
    if (pre.startsWith('@media') || pre.startsWith('@supports')) { out += `${pre}{${scope(body, root, stateRoot)}}\n`; continue; }
    if (pre.startsWith('@')) throw new Error(`the canvas's CSS has an at-rule it can't scope: ${pre}`);
    out += `${selectors(pre).map(x => scopeSelector(x, root, stateRoot)).join(',')}{${body.replace(/\banimation:\s*([a-z][\w-]*)/g, 'animation:iso-$1')}}\n`;
  }
  return out;
}
