// A self-contained drawing: the renderer's SVG with its stylesheets worked out and written on the elements, as plain
// presentation attributes (no <style>, no custom properties, no hsl() or color-mix()), so it looks the same with no
// page around it and in a rasteriser that knows no CSS. Pure: the stylesheets are the engine's own (the theme's, the
// drawing's, a host's marks'), read by a small reader that knows what they use and throws at what it doesn't.

import type { Theme } from './types.ts';
import { themeParts } from '../iso-core/theme.ts';

export type ThemeMode = 'light' | 'dark';

interface Part { tag?: string; classes: string[]; not: string[]; attrs: [string, string | undefined][]; child: boolean }
interface Rule { parts: Part[]; spec: number; order: number; decls: [string, string, boolean][] }
interface El { name: string; attrs: [string, string][]; children: (El | string)[]; parent?: El }

/** what a declaration becomes: the attribute of its name */
const WRITTEN = new Set(['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-weight', 'font-family',
  'letter-spacing', 'text-anchor', 'dominant-baseline', 'paint-order', 'display', 'stop-color', 'stop-opacity']);
/** what a still has no use for */
const LEFT = new Set('cursor pointer-events transition animation transform-box transform-origin user-select'.split(' '));

function readPart(s: string, child: boolean): Part {
  const p: Part = { classes: [], not: [], attrs: [], child };
  let rest = s;
  const eat = (re: RegExp) => { const m = re.exec(rest); if (m) rest = rest.slice(m[0].length); return m; };
  const t = eat(/^[a-zA-Z][\w-]*/);
  if (t) p.tag = t[0]; else eat(/^\*/);
  while (rest) {
    let m: RegExpExecArray | null;
    if ((m = eat(/^\.([\w-]+)/))) p.classes.push(m[1]);
    else if ((m = eat(/^:not\(\.([\w-]+)\)/))) p.not.push(m[1]);
    else if ((m = eat(/^\[([\w-]+)(?:="([^"]*)")?\]/))) p.attrs.push([m[1], m[2]]);
    else throw new Error(`resolve: a selector it doesn't know: ${s}`);
  }
  return p;
}
function readCss(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '').replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
  if (/@/.test(text.replace(/"[^"]*"/g, ''))) throw new Error('resolve: an at-rule it doesn\'t know');
  const rules: Rule[] = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = m[2].split(';').map(d => d.trim()).filter(Boolean).map(d => {
      const i = d.indexOf(':'), k = d.slice(0, i).trim(), v = d.slice(i + 1).trim();
      return [k, v.replace(/\s*!important$/, ''), /!important$/.test(v)] as [string, string, boolean];
    });
    for (const d of decls) if (!d[0].startsWith('--') && !WRITTEN.has(d[0]) && !LEFT.has(d[0])) throw new Error(`resolve: a property it doesn't know: ${d[0]}`);
    for (const sel of m[1].split(',').map(x => x.trim()).filter(Boolean)) {
      if (sel.includes(':root') || sel.includes('::') || /^(html|body)\b/.test(sel)) continue;
      const toks = sel.replace(/\s*>\s*/g, ' >').split(/\s+/);
      const parts = toks.map(x => readPart(x.replace(/^>/, ''), x.startsWith('>')));
      const spec = parts.reduce((n, p) => n + 10 * (p.classes.length + p.not.length + p.attrs.length) + (p.tag ? 1 : 0), 0);
      rules.push({ parts, spec, order: rules.length, decls });
    }
  }
  return rules;
}

function read(svg: string): El {
  const root: El = { name: '#root', attrs: [], children: [] };
  let top = root;
  for (const m of svg.matchAll(/<\/[a-zA-Z][\w:-]*>|<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g)) {
    if (m[4] !== undefined) { top.children.push(m[4]); continue; }
    if (m[1] === undefined) { top = top.parent!; continue; }
    const el: El = { name: m[1], attrs: [...m[2].matchAll(/([\w:-]+)="([^"]*)"/g)].map(a => [a[1], a[2]]), children: [], parent: top };
    top.children.push(el);
    if (!m[3]) top = el;
  }
  return root.children[0] as El;
}
const write = (e: El | string): string => (typeof e === 'string' ? e : `<${e.name}${e.attrs.map(([k, v]) => ` ${k}="${v}"`).join('')}${e.children.length || e.name === 'g' ? `>${e.children.map(write).join('')}</${e.name}>` : '/>'}`);
const get = (e: El, k: string) => e.attrs.find(a => a[0] === k)?.[1];
const put = (e: El, k: string, v: string) => { const a = e.attrs.find(x => x[0] === k); if (a) a[1] = v; else e.attrs.push([k, v]); };
const classesOf = (e: El) => (get(e, 'class') ?? '').split(/\s+/).filter(Boolean);

function fits(e: El, p: Part): boolean {
  if (p.tag && p.tag !== e.name) return false;
  const c = classesOf(e);
  return p.classes.every(x => c.includes(x)) && !p.not.some(x => c.includes(x)) && p.attrs.every(([k, v]) => { const g = get(e, k); return g !== undefined && (v === undefined || g === v); });
}
function matches(e: El, parts: Part[], i = parts.length - 1): boolean {
  if (!fits(e, parts[i])) return false;
  if (i === 0) return true;
  let up = e.parent;
  if (parts[i].child) return !!up && up.name !== '#root' && matches(up, parts, i - 1);
  for (; up && up.name !== '#root'; up = up.parent) if (matches(up, parts, i - 1)) return true;
  return false;
}

// ---------- colours ----------

type Rgba = [number, number, number, number];
const num = (s: string) => (s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s));
function hsl(h: number, s: number, l: number, a: number): Rgba {
  const c = (1 - Math.abs(2 * l - 1)) * s, hp = ((h % 360) + 360) % 360 / 60, x = c * (1 - Math.abs(hp % 2 - 1)), m = l - c / 2;
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255, a];
}
/** the parts of a list at its top level */
function split(s: string, sep: string): string[] {
  const out: string[] = []; let depth = 0, cur = '';
  for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === sep && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; }
  return [...out, cur.trim()].filter(Boolean);
}
const NAMED: Record<string, Rgba> = { transparent: [0, 0, 0, 0], black: [0, 0, 0, 1], white: [255, 255, 255, 1] };
function colour(v: string): Rgba | undefined {
  const s = v.trim();
  if (Object.hasOwn(NAMED, s)) return NAMED[s];
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    const x = m[1].length < 6 ? [...m[1]].map(c => c + c).join('') : m[1];
    return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16), x.length === 8 ? parseInt(x.slice(6), 16) / 255 : 1];
  }
  m = /^hsla?\((.*)\)$/.exec(s);
  if (m) {
    const [c, a] = m[1].split('/').map(x => x.trim()), [h, sat, l, a2] = c.split(/[\s,]+/);
    return hsl(parseFloat(h), num(sat), num(l), a !== undefined ? num(a) : a2 !== undefined ? num(a2) : 1);
  }
  m = /^rgba?\((.*)\)$/.exec(s);
  if (m) { const [r, g, b, a] = m[1].split(/[\s,/]+/).filter(Boolean); return [num(r), num(g), num(b), a === undefined ? 1 : num(a)]; }
  m = /^color-mix\(in srgb\s*,(.*)\)$/.exec(s);
  if (m) {
    const [x, y] = split(m[1], ',').map(p => { const q = /^(.*?)\s+([\d.]+)%$/.exec(p); return q ? { c: colour(q[1]), p: Number(q[2]) / 100 } : { c: colour(p), p: undefined as number | undefined }; });
    if (!x?.c || !y?.c) return undefined;
    const px = x.p ?? (y.p === undefined ? 0.5 : 1 - y.p), py = y.p ?? 1 - px, sum = px + py, a = (x.c[3] * px + y.c[3] * py) / sum;
    const mix = (i: 0 | 1 | 2) => (a === 0 ? 0 : (x.c![i] * x.c![3] * px + y.c![i] * y.c![3] * py) / sum / a);
    return [mix(0), mix(1), mix(2), a * Math.min(1, sum)];
  }
  return undefined;
}
const hex = (c: Rgba) => '#' + [c[0], c[1], c[2]].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const short = (v: number) => String(Math.round(v * 10000) / 10000);

/** custom properties put in, the nearest first */
function vars(v: string, env: Map<string, string>, seen = 0): string {
  if (seen > 20) throw new Error(`resolve: a custom property in a loop: ${v}`);
  const i = v.indexOf('var(');
  if (i < 0) return v;
  let depth = 0, j = i + 3;
  do { if (v[j] === '(') depth++; if (v[j] === ')') depth--; j++; } while (depth > 0 && j < v.length);
  const [name, ...fall] = split(v.slice(i + 4, j - 1), ',');
  const val = env.get(name) ?? (fall.length ? fall.join(',') : undefined);
  if (val === undefined) throw new Error(`resolve: no value for ${name}`);
  return vars(v.slice(0, i) + val + v.slice(j), env, seen + 1);
}

const tokens = (decls: string) => new Map(decls.split(';').filter(Boolean).map(d => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()] as [string, string]; }));

export interface ResolveOptions {
  mode: ThemeMode;
  theme: Theme;
  /** the drawing's stylesheets, in order, after the theme's */
  css: string;
  /** the fonts the texts ask for (a stack each) */
  fonts?: { sans: string; mono: string };
}
export const FONT_STACKS = { sans: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' };

/** The drawing, self-contained, in one of its theme's modes. What its stylesheets hide is left out of the paint (display
 *  none); ids, classes and data- attributes stay. */
export function resolveSvg(svg: string, o: ResolveOptions): string {
  const t = themeParts(o.theme), fonts = o.fonts ?? FONT_STACKS;
  const rules = readCss(`.mono{font-family:${fonts.mono.replace(/"/g, '')}}\n${t.rest}\n${o.css}`);
  const root = read(svg);
  put(root, 'font-family', fonts.sans.replace(/"/g, ''));
  const walk = (e: El, env0: Map<string, string>) => {
    let env = env0;
    // the winning declaration of each property: !important, then specificity, then order; a style attribute over all but !important
    const won = new Map<string, { v: string; rank: [number, number, number] }>();
    const offer = (k: string, v: string, rank: [number, number, number]) => { const w = won.get(k); if (!w || rank[0] > w.rank[0] || (rank[0] === w.rank[0] && (rank[1] > w.rank[1] || (rank[1] === w.rank[1] && rank[2] >= w.rank[2])))) won.set(k, { v, rank }); };
    for (const r of rules) if (matches(e, r.parts)) for (const [k, v, imp] of r.decls) offer(k, v, [imp ? 1 : 0, r.spec, r.order]);
    const style = get(e, 'style');
    if (style) {
      for (const d of style.split(';').map(x => x.trim()).filter(Boolean)) { const i = d.indexOf(':'); offer(d.slice(0, i).trim(), d.slice(i + 1).trim(), [0, 1e6, 0]); }
      e.attrs = e.attrs.filter(a => a[0] !== 'style');
    }
    for (const [k, w] of won) if (k.startsWith('--')) { if (env === env0) env = new Map(env0); env.set(k, w.v); }
    const alpha: Record<string, number> = {};
    for (const [k, w] of won) {
      if (!WRITTEN.has(k)) continue;
      const v = vars(w.v, env).trim();
      if (k === 'fill' || k === 'stroke' || k === 'stop-color') {
        if (v === 'none' || v === 'currentColor' || v === 'inherit' || v.startsWith('url(')) { put(e, k, v); continue; }
        const c = colour(v);
        if (!c) throw new Error(`resolve: a colour it doesn't know: ${v}`);
        put(e, k, hex(c));
        if (c[3] !== 1) alpha[k === 'stop-color' ? 'stop' : k] = c[3];
      } else put(e, k, k === 'letter-spacing' || k === 'font-size' || k === 'stroke-width' ? v : v.replace(/"/g, ''));
    }
    for (const [k, a] of Object.entries(alpha)) put(e, `${k}-opacity`, short(a * Number(get(e, `${k}-opacity`) ?? 1)));
    if (get(e, 'opacity') === '0') { put(e, 'display', 'none'); e.attrs = e.attrs.filter(a => a[0] !== 'opacity'); }
    // a presentation attribute as the renderer wrote it (a marker's fill) may name a token too
    for (const a of e.attrs) if (/var\(|hsl\(|color-mix/.test(a[1])) { const v = vars(a[1], env), c = colour(v); a[1] = c ? hex(c) : v; }
    for (const c of e.children) if (typeof c !== 'string') walk(c, env);
  };
  walk(root, tokens(o.mode === 'dark' ? `${t.light};${t.dark}` : t.light));
  return write(root);
}
