// The editor's stylesheet, scoped to its root element (the setup's root class), so it can live in a host's page: every rule sits
// under the root class; html, body and :root become the root itself; @layer, @media, @container and @supports keep their
// rules, scoped; @keyframes are renamed se-*. Nothing styles the host's page. Used at build time (pure; tested in Node).


/** Split CSS into its top-level blocks: [prelude, body], or [statement, ''] for an at-rule without a block. */
function blocks(css: string): [string, string | null][] {
  const out: [string, string | null][] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i), semi = text.indexOf(';', i);
    if (open < 0 && semi < 0) break;
    if (semi >= 0 && (open < 0 || semi < open)) {           // a statement: @layer a, b; @import …;
      const st = text.slice(i, semi).trim();
      if (st) out.push([st, null]);
      i = semi + 1;
      continue;
    }
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

/** One selector under the root: html, body and :root (with any state they name) become the root itself; * is the
 *  root and everything in it. */
export function scopeOne(sel: string, root: string): string {
  const r = `.${root}`;
  const m = /^(?:html|body|:root)((?:\[[^\]]*\]|\.[\w-]+|:not\([^)]*\))*)(.*)$/.exec(sel);
  if (m && /^(html|body|:root)(?![\w-])/.test(sel)) return `${r}${m[1]}${m[2].trim() ? ' ' + m[2].trim() : ''}`;
  if (sel === '*') return `${r}, ${r} *`;
  return `${r} ${sel}`;
}

/** Scope a stylesheet to the root class. */
export function scopeCss(css: string, root: string): string {
  let out = '';
  for (const [pre, body] of blocks(css)) {
    if (body === null) { if (pre.startsWith('@layer') || pre.startsWith('@import')) out += `${pre};\n`; continue; }
    if (pre.startsWith('@keyframes')) { out += `@keyframes se-${pre.slice('@keyframes'.length).trim()}{${body}}\n`; continue; }
    if (/^@(layer|media|container|supports)\b/.test(pre)) { out += `${pre}{\n${scopeCss(body, root)}}\n`; continue; }
    if (pre.startsWith('@font-face')) { out += `${pre}{${body}}\n`; continue; }
    if (pre.startsWith('@')) throw new Error(`the editor's CSS has an at-rule it can't scope: ${pre}`);
    const scoped = [...new Set(selectors(pre).flatMap(s => scopeOne(s, root).split(', ')))].join(',');
    out += `${scoped}{${body.replace(/\banimation(-name)?:\s*([a-z][\w-]*)/g, (m0, n, k) => (k === 'none' ? m0 : `animation${n ?? ''}:se-${k}`))}}\n`;
  }
  return out;
}
