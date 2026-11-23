// Themes are data (themes/*.yaml). This turns one into CSS custom properties for light and dark,
// following prefers-color-scheme unless the page sets data-theme, exactly as the reference pages do.

import { parse as parseYaml } from 'yaml';

/** a colour role: a hue and saturation the theme's shades are made from */
export interface RawRole { h: number; s: number; top?: string; tint?: number }
/** a route kind's look: its colour (or a role's, by like:), its dash and its legend */
export interface RawKind { legend?: string; like?: string; color?: string; dash?: 'solid' | 'dashed' | 'dotted' }
/** a theme: CSS tokens for light and dark, and the route kinds and colour roles drawings name */
export interface Theme {
  name: string;
  light: Record<string, string>;
  dark: Record<string, string>;
  kinds: Record<string, { color: string; dash: 'solid' | 'dashed' | 'dotted'; legend: string }>;
  roles: Record<string, RawRole>;
}

export function loadTheme(text: string): Theme {
  const t = parseYaml(text) as Theme;
  for (const k of ['light', 'dark', 'kinds', 'roles'] as const) if (!t || typeof t[k] !== 'object') throw new Error(`theme: missing "${k}"`);
  return t;
}

/** The theme with a file's own roles and kinds added. */
export function extendTheme(t: Theme, roles: Record<string, RawRole> = {}, kinds: Record<string, RawKind> = {}): Theme {
  const k = { ...t.kinds };
  for (const [name, def] of Object.entries(kinds)) {
    const base = k[def.like ?? name] ?? k.control;
    k[name] = { color: def.color ?? base.color, dash: def.dash ?? base.dash, legend: def.legend ?? base.legend };
  }
  return { ...t, roles: { ...t.roles, ...roles }, kinds: k };
}

const vars = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `--${k}:${v}`).join(';');

/** A colour value usable in CSS: a theme token name or a literal colour. */
export function colorRef(t: Theme, c: string): string {
  return c in t.light ? `var(--${c})` : c;
}

export function themeCss(t: Theme): string {
  const { light: L, dark: Dk, rest } = themeParts(t);
  return `:root{${L}}\n@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${Dk}}}\n:root[data-theme="dark"]{${Dk}}\n${rest}`;
}

/** The theme's CSS in pieces: the light and dark tokens (declarations), and the rules for its roles and kinds. */
export function themeParts(t: Theme): { light: string; dark: string; rest: string } {
  let css = '';
  // colour roles: hue and saturation per role; the face lightness comes from the theme
  for (const [name, r] of Object.entries(t.roles)) {
    css += `.k-${name}{--h:${r.h};--s:${r.s}%}`;
    if (r.top) css += `.k-${name} .top{fill:${r.top}}`;
    else if (r.tint) css += `.k-${name} .top{fill:color-mix(in srgb,hsl(${r.h} ${Math.min(100, r.s + 15)}% 50%) ${r.tint}%,var(--pad-top))}`;
    css += '\n';
  }
  // flow kinds
  for (const [name, k] of Object.entries(t.kinds)) {
    const c = colorRef(t, k.color);
    const dash = k.dash === 'dashed' ? ';stroke-dasharray:7 6;stroke-width:2.4' : k.dash === 'dotted' ? ';stroke-dasharray:3 6;stroke-width:2.4' : '';
    css += `.f-${name}{stroke:${c}${dash}} .t-${name}{fill:${c}} .c-${name}{--c:${c}}\n`;
  }
  return { light: vars(t.light), dark: vars(t.dark), rest: css };
}
