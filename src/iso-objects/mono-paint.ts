// The black and white treatment of a self-contained drawing (docs/design/MOTION.md, 5b): a paint, not a drawing. The tables
// (iso-core/mono.ts) become a theme and rules the resolver works out as it does any theme's; patterns go over a thing's faces, inside
// its own wrapper, so that motion moves them with it. Geometry, ids and wrappers are the styled drawing's. What has a hue after all of
// that (a screen's own colours, a brand mark's) becomes the grey of its lightness: nothing has a hue.

import { extendTheme, type Theme } from '../iso-core/theme.ts';
import { contrast, greyOf, MONO, monoOf, type MonoLook, type MonoPattern, type MonoTable } from '../iso-core/mono.ts';
import type { ThemeMode } from './resolve.ts';

const pct = (grey: string) => `${Math.round((parseInt(grey.slice(1, 3), 16) / 255) * 10000) / 100}%`;
/** a grey between two, by its share of the second */
const between = (a: string, b: string, f: number) => { const [x, y] = [a, b].map(c => parseInt(c.slice(1, 3), 16)), v = Math.round(x + (y - x) * f).toString(16).padStart(2, '0'); return `#${v}${v}${v}`; };

/** the roles and connector kinds a drawing uses */
export function usedIn(svg: string, theme: Theme, kinds: string[]): { roles: string[]; kinds: string[] } {
  const seen = new Set([...svg.matchAll(/\sclass="([^"]*)"/g)].flatMap(m => m[1].split(/\s+/)).filter(c => c.startsWith('k-')).map(c => c.slice(2)));
  return { roles: Object.keys(theme.roles).filter(r => seen.has(r)), kinds: [...new Set(kinds)].filter(k => k in theme.kinds) };
}

/** the theme in greys, its tokens by the same names, so that everything that names one is grey too */
export function monoTheme(theme: Theme, look: MonoLook): Theme {
  const steps = MONO[look.mode].steps, face = (role: string, step: 0 | 1) => look.roles[role] ?? steps[step];
  const tokens: Record<string, string> = {};
  // a token is ink, unless it is one of a surface's
  for (const [k, v] of Object.entries(theme.light)) tokens[k] = /%$/.test(v) ? v : look.ink;
  const slab = face('slab', 0), pad = face('pad', 0);
  Object.assign(tokens, {
    bg: look.paper, surface: look.paper, on: look.paper, ink: look.ink, muted: between(look.paper, look.ink, 0.72), line: between(look.paper, look.ink, 0.3), 'code-bg': between(look.paper, look.ink, 0.06),
    'slab-top': slab.top, 'slab-l': slab.left, 'slab-r': slab.right, 'pad-top': pad.top,
  });
  const roles = Object.fromEntries(Object.entries(theme.roles).map(([k]) => [k, { h: 0, s: 0 }]));
  const kinds = Object.fromEntries(Object.entries(theme.kinds).map(([k, v]) => [k, { ...v, color: look.ink }]));
  return extendTheme({ ...theme, light: tokens, dark: tokens, roles, kinds });
}

/** what is each role's and each kind's own: the faces' lightnesses, the connectors' rhythms */
export function monoCss(look: MonoLook): string {
  let css = '';
  for (const [name, r] of Object.entries(look.roles)) css += `.k-${name}{--s:0%;--l-top:${pct(r.top)};--l-left:${pct(r.left)};--l-right:${pct(r.right)};--l-edge:${pct(r.edge)}}\n`;
  for (const [name, k] of Object.entries(look.kinds)) css += `.flow.f-${name}{stroke-width:${k.width}${k.dash.length ? `;stroke-dasharray:${k.dash.join(' ')}` : ';stroke-dasharray:none'}}\n`;
  return css;
}

const TILE: Record<Exclude<MonoPattern, 'none'>, { size: number; draw: (ink: string, w: number) => string }> = {
  hatch: { size: 6, draw: (c, w) => `<path d="M0,6L6,0M-1.5,1.5L1.5,-1.5M4.5,7.5L7.5,4.5" stroke="${c}" stroke-width="${w}" fill="none"/>` },
  'hatch-wide': { size: 12, draw: (c, w) => `<path d="M0,0L12,12M-3,9L3,15M9,-3L15,3" stroke="${c}" stroke-width="${w}" fill="none"/>` },
  dots: { size: 8, draw: (c, w) => `<circle cx="2" cy="2" r="${w + 0.2}" fill="${c}"/><circle cx="6" cy="6" r="${w + 0.2}" fill="${c}"/>` },
};
const round = (v: number) => Math.round(v * 100) / 100;
/** a pattern's ink on a face: the mode's own ink or paper, whichever stands out */
const patternInk = (face: string, look: MonoLook) => (contrast(face, look.ink) >= contrast(face, look.paper) ? look.ink : look.paper);

/** The resolved drawing with its patterns, and no hue in it. `id`: the drawing's own (its patterns' ids begin with it). */
export function paintMono(svg: string, look: MonoLook, id: string): string {
  const need = new Map<string, string>();
  const use = (pattern: Exclude<MonoPattern, 'none'>, ink: string) => {
    const key = `${id}-mono-${pattern}-${ink.slice(1)}`, t = TILE[pattern], w = look.mode === 'dark' ? 1.2 : 0.9;
    if (!need.has(key)) need.set(key, `<pattern id="${key}" width="${t.size}" height="${t.size}" patternUnits="userSpaceOnUse">${t.draw(ink, round(w))}</pattern>`);
    return key;
  };
  // each face of a patterned role's solids, again, in its pattern, straight after it
  const depth: (string | undefined)[] = [];
  let out = '', layer = '';
  for (const m of svg.matchAll(/<\/[a-zA-Z][\w:-]*>|<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|[^<]+/g)) {
    out += m[0];
    if (m[0].startsWith('</')) { depth.pop(); continue; }
    if (m[1] === undefined) continue;
    const cls = (/\sclass="([^"]*)"/.exec(m[2])?.[1] ?? '').split(/\s+/);
    if (depth.length === 1) layer = cls.find(c => c.startsWith('g-')) ?? '';
    const role = cls.find(c => c.startsWith('k-'))?.slice(2) ?? depth.at(-1);
    if (!m[3]) depth.push(cls.includes('ghost') ? '' : role);
    if (!m[3] || (m[1] !== 'polygon' && m[1] !== 'path') || !role || !cls.some(c => c === 'top' || c === 'lft' || c === 'rgt')) continue;
    // a ground is drawn on (its top) and has its name on its front: they stay plain, and its other side tells it
    if (layer === 'g-base' && !cls.includes('rgt')) continue;
    const p = Object.hasOwn(look.roles, role) ? look.roles[role].pattern : 'none';
    const fill = /\sfill="(#[0-9a-f]{6})"/.exec(m[2])?.[1], shape = /\s(points|d)="[^"]*"/.exec(m[2])?.[0];
    if (p === 'none' || !fill || !shape) continue;
    const opacity = /\sfill-opacity="[^"]*"/.exec(m[2])?.[0] ?? '';
    out += `<${m[1]}${shape} class="mono-pattern" fill="url(#${use(p, patternInk(fill, look))})" stroke="none"${opacity}/>`;
  }
  // whatever still has a hue, in the grey of its own lightness
  out = out.replace(/#([0-9a-f]{6})\b/g, (h, x: string) => (x.slice(0, 2) === x.slice(2, 4) && x.slice(2, 4) === x.slice(4, 6) ? h : greyHex(h)));
  if (need.size) out = out.replace(/<defs\/>|<defs>/, d => (d === '<defs/>' ? `<defs>${[...need.values()].join('')}</defs>` : d + [...need.values()].join('')));
  return out;
}
/** the grey of a colour's own lightness (L*) */
function greyHex(c: string): string {
  const l = greyOf(c), y = l > 8 ? ((l + 16) / 116) ** 3 : l / (24389 / 27), s = y <= 0.0031308 ? y * 12.92 : 1.055 * y ** (1 / 2.4) - 0.055;
  const v = Math.max(0, Math.min(255, Math.round(s * 255))).toString(16).padStart(2, '0');
  return `#${v}${v}${v}`;
}

/** Everything a compile needs for the treatment: the look, its theme and its rules. */
export function monoOfDrawing(svg: string, theme: Theme, mode: ThemeMode, kinds: string[], own?: MonoTable): { look: MonoLook; theme: Theme; css: string } {
  const look = monoOf(theme, mode, usedIn(svg, theme, kinds), own);
  return { look, theme: monoTheme(theme, look), css: monoCss(look) };
}
