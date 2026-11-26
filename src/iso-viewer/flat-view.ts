// The 2D view drawn (0.6.0): a flat layout (src/iso-objects/flat.ts) as SVG, its stylesheet, and the measure a page
// lays it out with (its own rendered text). The SVG is a string, so Node makes stills of it as a page shows it.
//
// What it carries, as the 3D drawing does: data-id on every card and panel, data-id, data-a and data-b on every
// connector (and its label: data-for), so selection and highlighting work in either view. Colours are the theme's:
// a card's or panel's role (its hue and saturation, the theme's face lightness), a link kind's colour token.

import { tag, esc } from '../iso-core/kernel.ts';
import type { FlatLayout, FlatRect, Measure, FlatFont } from '../iso-objects/flat.ts';

/** how a link kind is drawn: its ends, its dash, its colour (a theme token, e.g. "send", or any CSS colour) */
export interface FlatStyle { start?: 'arrow' | 'open' | 'diamond' | 'none'; end?: 'arrow' | 'open' | 'diamond' | 'none'; dash?: string; color?: string; width?: number }

const MARKS = {
  arrow: { d: 'M0,0 L10,5 L0,10 z', refX: 9 },
  open: { d: 'M0,0 L10,5 L0,10 L3,5 z', refX: 9 },
  diamond: { d: 'M0,5 L5,1.5 L10,5 L5,8.5 z', refX: 1 },
} as const;
const f = (v: number) => (Math.round(v * 10) / 10).toString();
const kindOf = (k: string | undefined) => (k ?? 'link').replace(/[^\w-]/g, '_');

/** the 2D drawing: panels, connectors, cards, then the connectors' labels. `id` prefixes its marker ids. */
export function flatSvg(L: FlatLayout, opts: { id: string; title?: string; styles?: Record<string, FlatStyle> }): string {
  const { id } = opts, styles = opts.styles ?? {}, o = L.options;
  const b = L.bounds;
  const used = new Map<string, Set<string>>();
  const mark = (kind: string, end: 'start' | 'end') => {
    const st = styles[kind] ?? {}, shape = end === 'start' ? (st.start ?? 'none') : (st.end ?? 'arrow');
    if (shape === 'none') return undefined;
    (used.get(kind) ?? used.set(kind, new Set()).get(kind)!).add(shape);
    return `url(#${id}-mk-${kind}-${shape})`;
  };
  let panels = '', conns = '', cards = '', labels = '';
  for (const p of [...L.panels].sort((x, y) => x.depth - y.depth)) {
    const r = p.rect;
    const title = p.label ? tag('text', { class: 'pl', x: p.titleAt[0], y: p.titleAt[1] }, esc(p.label) + (p.sub ? tag('tspan', { class: 'pls', dx: 10 }, esc(p.sub)) : '')) : '';
    panels += tag('g', { class: `panel k-${p.role ?? 'grey'}`, 'data-id': p.id },
      tag('rect', { class: 'face', x: f(r.l), y: f(r.t), width: f(r.r - r.l), height: f(r.b - r.t), rx: o.panelRx }) + title);
  }
  for (const l of L.links) {
    if (!l.points.length) continue;
    const kind = kindOf(l.kind);
    conns += tag('path', { class: `conn k-${kind}`, d: 'M' + l.points.map(p => `${f(p[0])},${f(p[1])}`).join(' L'), 'data-id': l.id, 'data-a': l.a, 'data-b': l.b, 'marker-start': mark(kind, 'start'), 'marker-end': mark(kind, 'end') });
    if (l.at) labels += tag('text', { class: `cl k-${kind}`, x: l.at.x, y: l.at.y, 'text-anchor': l.at.anchor === 'start' ? undefined : l.at.anchor, 'data-for': l.id }, esc(l.at.text));
  }
  for (const c of L.cards) {
    const r = c.rect;
    cards += tag('g', { class: `card k-${c.role ?? 'grey'}${c.ghost ? ' ghost' : ''}`, 'data-id': c.id, tabindex: 0, role: 'button', 'aria-label': c.sub ? `${c.label}: ${c.sub}` : c.label },
      tag('rect', { class: 'face', x: f(r.l), y: f(r.t), width: o.W, height: o.H, rx: o.cardRx })
      + tag('text', { class: 'lt', x: f(r.l + 14), y: f(r.t + 24) }, esc(c.label))
      + (c.sub ? tag('text', { class: 'st', x: f(r.l + 14), y: f(r.t + 42) }, esc(c.sub)) : ''));
  }
  let defs = '';
  for (const [kind, shapes] of used) for (const s of shapes) {
    const m = MARKS[s as keyof typeof MARKS];
    defs += tag('marker', { id: `${id}-mk-${kind}-${s}`, viewBox: '0 0 10 10', refX: m.refX, refY: 5, markerWidth: 5.4, markerHeight: 5.4, orient: 'auto-start-reverse' },
      tag('path', { d: m.d, class: `mk k-${kind}` }));
  }
  return tag('svg', { xmlns: 'http://www.w3.org/2000/svg', class: 'flat', viewBox: `${f(b.l)} ${f(b.t)} ${f(b.r - b.l)} ${f(b.b - b.t)}`, role: 'img', 'aria-label': opts.title ?? 'drawing, flat view', 'data-view': '2d' },
    (defs ? tag('defs', {}, defs) : '') + tag('g', { class: 'panels' }, panels) + tag('g', { class: 'conns' }, conns) + tag('g', { class: 'cards' }, cards) + tag('g', { class: 'labels' }, labels));
}

/** the 2D view's stylesheet: its fonts (the ones flat.ts's FLAT_FONTS measures), its faces in the theme's role colours,
 *  and each link kind's colour and dash. Unscoped: a page scopes it as it scopes the drawing's (view-css.ts).
 *  `page: false`: without what only a page has a use for (the pointer, the keyboard's focus, the page's own font): a still's */
export function flatCss(styles: Record<string, FlatStyle> = {}, o: { page?: boolean } = {}): string {
  const page = (rule: string) => (o.page === false ? '' : rule);
  // a theme token by name ("send"), or a colour as CSS writes it ("#2a64d6", "hsl(…)", "var(--x)")
  const col = (c: string | undefined) => (!c ? 'var(--ink)' : c.startsWith('#') || c.includes('(') ? c : `var(--${c})`);
  let css = `
${page('.flat{font-family:inherit}\n.flat .card{cursor:pointer;outline:none}\n')}.flat .card .face{fill:hsl(var(--h) var(--s) var(--l-top));stroke:hsl(var(--h) var(--s) var(--l-edge) / .55);stroke-width:1}
${page('.flat .card:hover .face,.flat .card:focus-visible .face{fill:hsl(var(--h) var(--s) calc(var(--l-top) + 6%))}\n')}.flat .card.ghost{opacity:.4}
.flat .card .lt{font-size:13px;font-weight:600;fill:var(--ink)}
.flat .card .st{font-size:10px;fill:var(--ink);opacity:.8}
.flat .panel .face{fill:color-mix(in srgb,hsl(var(--h) var(--s) var(--l-top)) 22%,var(--surface));stroke:color-mix(in srgb,hsl(var(--h) var(--s) var(--l-top)) 40%,var(--line));stroke-width:1}
.flat .pl{font-size:12px;font-weight:700;letter-spacing:.02em;fill:var(--ink)}
.flat .pls{font-size:10.5px;font-weight:400;letter-spacing:0;fill:var(--muted)}
.flat .conn{fill:none;stroke:var(--ink);stroke-width:1.5}
.flat .mk{fill:var(--ink)}
.flat .cl{font-size:10.5px;font-weight:600;fill:var(--ink);paint-order:stroke;stroke:var(--surface);stroke-width:4px;stroke-linejoin:round}
.flat .card.sel .face{stroke:var(--accent,#2f6fd6);stroke-width:2.4}
.flat .panel.sel .face{stroke:var(--accent,#2f6fd6);stroke-width:2}
.flat .conn.hot{stroke-width:3}
.flat .conn.dim,.flat .cl.dim{opacity:.3}
`;
  for (const [kind, st] of Object.entries(styles)) {
    const k = kindOf(kind), c = col(st.color);
    css += `.flat .conn.k-${k}{stroke:${c}${st.dash ? `;stroke-dasharray:${st.dash}` : ''}${st.width ? `;stroke-width:${st.width}` : ''}} .flat .mk.k-${k}{fill:${c}} .flat .cl.k-${k}{fill:${c}}\n`;
  }
  return css;
}

/** what each measured font's text is drawn as (class, and the element it sits in) */
const FONT_CLASS: Record<FlatFont, [string, string]> = { name: ['card', 'lt'], sub: ['card', 'st'], title: ['panel', 'pl'], titleSub: ['panel', 'pls'], label: ['', 'cl'] };

/** a measure from a page's own rendered text: a hidden 2D svg in `host` (so the view's stylesheet applies), each text
 *  measured by getComputedTextLength, remembered */
export function measureIn(host: Element): Measure & { dispose(): void } {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'flat');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;left:-10000px;top:0;width:10px;height:10px;visibility:hidden';
  host.appendChild(svg);
  const els = {} as Record<FlatFont, SVGTextElement>;
  for (const [font, [g, cls]] of Object.entries(FONT_CLASS) as [FlatFont, [string, string]][]) {
    const wrap = document.createElementNS(NS, 'g');
    if (g) wrap.setAttribute('class', g);
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('class', cls);
    wrap.appendChild(t); svg.appendChild(wrap);
    els[font] = t;
  }
  const memo = new Map<string, number>();
  const m = ((text: string, font: FlatFont) => {
    const key = font + '\u0000' + text;
    let w = memo.get(key);
    if (w === undefined) { els[font].textContent = text; w = els[font].getComputedTextLength(); memo.set(key, w); }
    return w;
  }) as Measure & { dispose(): void };
  m.dispose = () => svg.remove();
  return m;
}

/** the rect of a card or panel in a layout */
export const rectOf = (L: FlatLayout, id: string): FlatRect | undefined => L.cards.find(c => c.id === id)?.rect ?? L.panels.find(p => p.id === id)?.rect;
