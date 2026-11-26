// The 2D view as a self-contained drawing: its layout (src/iso-objects/flat.ts) with the colours and text styles of a theme's mode, or
// black and white, written on its elements, as a compiled scene's are with resolveVars. Pure: no page, no stylesheet, texts measured with
// the engine's own metrics, so the same scene gives the same bytes anywhere. What a page adds (the pointer, the focus) isn't in it.

import { contrast, type MonoLook } from '../iso-core/mono.ts';
import { esc, tag } from '../iso-core/kernel.ts';
import type { Theme } from '../iso-core/theme.ts';
import { boardOf } from '../iso-objects/board.ts';
import type { CompiledScene } from '../iso-objects/compile.ts';
import { layoutFlat, metricsMeasure, type Board, type FlatLayout, type FlatOptions } from '../iso-objects/flat.ts';
import { monoCss, monoTheme, paintMono } from '../iso-objects/mono-paint.ts';
import { resolveSvg, type ThemeMode } from '../iso-objects/resolve.ts';
import { flatCss, flatSvg, type FlatStyle } from './flat-view.ts';

export interface FlatStillOptions {
  /** the theme it was compiled with (Compiled's), and which of its modes */
  theme: Theme; mode: ThemeMode;
  /** what it draws (default: the scene's own board), laid out so */
  board?: Board; flat?: Partial<FlatOptions>;
  /** link kinds' styles, over the theme's own */
  styles?: Record<string, FlatStyle>;
  /** what its ids begin with (default: the scene's id and `-flat`) */
  id?: string;
  title?: string;
}
export interface FlatStill { svg: string; layout: FlatLayout; viewBox: [number, number, number, number] }

const DASHES = { solid: undefined, dashed: '7 6', dotted: '3 6' } as const;
/** a card's strip of its role's pattern, in black and white: its words are on its face, and stay clear of it */
const STRIP = 9;
/** a connector in 2D is drawn lighter than in 3D (1.5 to 3) */
const LIGHTER = 0.6;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** each kind of connector as the theme, or the black and white table, has it */
function stylesOf(theme: Theme, look: MonoLook | undefined): Record<string, FlatStyle> {
  return Object.fromEntries(Object.entries(theme.kinds).map(([k, v]): [string, FlatStyle] => {
    const m = look?.kinds[k];
    if (look) return [k, { color: look.ink, ...(m?.dash.length ? { dash: m.dash.map(d => r2(d * LIGHTER)).join(' ') } : {}), width: r2((m?.width ?? 2.6) * LIGHTER) }];
    const dash = DASHES[v.dash];
    return [k, { color: v.color, ...(dash ? { dash } : {}) }];
  }));
}
/** black and white: words in what stands out from their own card, and the cards whose role has a pattern with a strip of it */
function monoRules(look: MonoLook): string {
  let css = '.flat .card .strip{fill:hsl(var(--h) var(--s) var(--l-left));stroke:none}\n.flat .card .st{opacity:1}\n';
  for (const [role, r] of Object.entries(look.roles)) css += `.flat .card.k-${role} .lt,.flat .card.k-${role} .st{fill:${contrast(r.top, look.ink) >= contrast(r.top, look.paper) ? look.ink : look.paper}}\n`;
  return css;
}
function withStrips(svg: string, L: FlatLayout, look: MonoLook): string {
  for (const c of L.cards) {
    if (c.ghost || (look.roles[c.role ?? 'grey']?.pattern ?? 'none') === 'none') continue;
    const { l, t, b } = c.rect, rx = L.options.cardRx, w = Math.max(STRIP, rx);
    // after its face, under its words
    const card = svg.indexOf(` data-id="${esc(c.id)}"`, svg.indexOf('<g class="cards">')), at = svg.indexOf('/>', svg.indexOf('<rect class="face"', card)) + 2;
    const d = `M${r2(l + w)},${r2(t)} L${r2(l + rx)},${r2(t)} A${rx},${rx} 0 0 0 ${r2(l)},${r2(t + rx)} L${r2(l)},${r2(b - rx)} A${rx},${rx} 0 0 0 ${r2(l + rx)},${r2(b)} L${r2(l + w)},${r2(b)} z`;
    svg = svg.slice(0, at) + tag('path', { class: 'lft strip', d }) + svg.slice(at);
  }
  return svg;
}

/** A scene's 2D view, self-contained, in the mode and (where the scene is drawn in it) the black and white of its 3D one. */
export function flatStill(scene: CompiledScene, o: FlatStillOptions): FlatStill {
  const look = scene.rendered.mono, id = o.id ?? `${scene.id}-flat`;
  if (look && look.mode !== o.mode) throw new Error(`flatStill: the scene is in black and white for ${look.mode}, not ${o.mode}`);
  const layout = layoutFlat(o.board ?? boardOf(scene), metricsMeasure, o.flat), styles = { ...stylesOf(o.theme, look), ...o.styles };
  // (a still has nothing to press)
  let svg = flatSvg(layout, { id, title: o.title ?? scene.raw.aria ?? scene.raw.title, styles }).replace(/ tabindex="0" role="button" aria-label="[^"]*"/g, '');
  if (!/<defs[ />]/.test(svg)) svg = svg.replace(/^<svg[^>]*>/, m => `${m}<defs></defs>`);
  const css = flatCss(styles, { page: false });
  svg = look ? paintMono(resolveSvg(withStrips(svg, layout, look), { mode: o.mode, theme: monoTheme(o.theme, look), css: css + monoCss(look) + monoRules(look) }), look, id)
    : resolveSvg(svg, { mode: o.mode, theme: o.theme, css });
  return { svg, layout, viewBox: /^<svg[^>]* viewBox="([^"]*)"/.exec(svg)![1].split(' ').map(Number) as [number, number, number, number] };
}
