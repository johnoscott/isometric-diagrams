// Marching dashes on a still drawing (docs/design/MOTION.md, 5a): a loop of the drawing's own, for a page or an image that plays
// nothing else. Two ways: 'css' (a class on each connector and ANTS_CSS once on the page, which a switch can stop) and 'smil' (an
// animation inside each connector, for an SVG that goes out alone, where a page's stylesheet doesn't reach). In motion (a
// timeline's `ants`) there is no loop: a frame has the offset of its moment.

import type { CompiledScene } from './compile.ts';

export const ANT_SPEED = 32 / 1.1;
export const ANT_DASH: Record<string, [number, number]> = { solid: [9, 7], dashed: [7, 6], dotted: [3, 6] };
export const ANT_STILL = ['blocked', 'planned'];
export interface AntsOptions {
  /** how it moves (default: smil); 'none': the dashes, standing still */
  by?: 'css' | 'smil' | 'none';
  /** the connectors that march (default: every one that may) */
  ids?: string[];
  /** units a second, in the drawing's units (default: 32 in 1.1 s) */
  speed?: number;
  dash?: [number, number];
  /** the connectors' dashes, by kind: the theme's `kinds` (a dashed kind marches with its own dash) */
  kinds?: Record<string, { dash?: 'solid' | 'dashed' | 'dotted' }>;
  /** kinds whose connectors stand still (default: blocked, planned) */
  still?: string[];
}
/** for 'css': one rule and its keyframes. A page stops them, where they are, with --ants: paused. */
export const ANTS_CSS = `
.flow.iso-ants{stroke-dasharray:var(--ant-on) var(--ant-off);animation:iso-ants var(--ant-turn) linear infinite;animation-play-state:var(--ants,running)}
@keyframes iso-ants{to{stroke-dashoffset:var(--ant-to)}}
`;
/** the dash a connector marches with, or undefined when it stands still */
export function antDash(kind: string, o: Pick<AntsOptions, 'dash' | 'kinds' | 'still'> = {}): [number, number] | undefined {
  return (o.still ?? ANT_STILL).includes(kind) ? undefined : o.dash ?? ANT_DASH[o.kinds?.[kind]?.dash ?? 'solid'];
}

/** what a scene's `ants:` in the file asks for, as options; undefined: none */
export function antsOf(raw: { ants?: boolean | string[] | { ids?: string[]; speed?: number; dash?: [number, number] } } | undefined): Pick<AntsOptions, 'ids' | 'speed' | 'dash'> | undefined {
  const a = raw?.ants;
  return !a ? undefined : a === true ? {} : Array.isArray(a) ? { ids: a } : a;
}

/** The scene's still, as SVG text, with its connectors marching. */
export function withAnts(scene: Pick<CompiledScene, 'rendered' | 'routes'>, o: AntsOptions = {}): string {
  const kindOf = new Map(scene.routes.map(r => [r.id, r.kind])), wanted = o.ids && new Set(o.ids), speed = o.speed ?? ANT_SPEED;
  const n = (v: number) => String(Number(v.toFixed(3)));
  return scene.rendered.svg.replace(/(<g data-route="([^"]*)" data-part="line">(?:<g[^>]*>)*)<path ([^>]*?)\s*\/>/g, (m, before: string, id: string, attrs: string) => {
    const route = id.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const dash = wanted && !wanted.has(route) ? undefined : antDash(kindOf.get(route) ?? '', o);
    if (!dash || !/class="flow\b/.test(attrs)) return m;
    const period = dash[0] + dash[1], turn = n(period / Math.max(1e-6, Math.abs(speed)) ), to = n(speed < 0 ? period : -period);
    if (o.by === 'css') return `${before}<path ${attrs.replace(/class="flow\b/, 'class="flow iso-ants')} style="--ant-on:${n(dash[0])};--ant-off:${n(dash[1])};--ant-to:${to};--ant-turn:${turn}s"/>`;
    if (o.by === 'none') return `${before}<path ${attrs.replace(/ ?stroke-dasharray="[^"]*"/, '')} style="stroke-dasharray:${n(dash[0])} ${n(dash[1])}"/>`;
    return `${before}<path ${attrs.replace(/ ?stroke-dasharray="[^"]*"/, '')} style="stroke-dasharray:${n(dash[0])} ${n(dash[1])}"><animate attributeName="stroke-dashoffset" from="0" to="${to}" dur="${turn}s" repeatCount="indefinite"/></path>`;
  });
}
