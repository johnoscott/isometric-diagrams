// One call for a pipeline (a static site, Markdown): a diagram's text to one SVG, as text, that needs nothing else: its colours
// and text styles on its elements, no stylesheet, no script. Node or a browser; no DOM.

import { antsOf, withAnts, type AntsOptions } from '../iso-objects/ants.ts';
import { svgAt } from '../iso-objects/motion.ts';
import { bindMotion } from '../iso-objects/timeline.ts';
import type { MotionDoc } from '../iso-objects/motion-doc.ts';
import { compile } from './compile.ts';
import type { MonoTable } from '../iso-core/mono.ts';
import type { ThemeMode } from '../iso-objects/resolve.ts';

export interface RenderSvgOptions {
  /** the theme's text */
  theme: string;
  mode?: ThemeMode;
  /** black and white, in either mode, and a host's own table for it */
  treatment?: 'mono' | 'none';
  mono?: MonoTable;
  /** which scene: its id or its place (default: the first) */
  scene?: string | number;
  /** a moment of its motion, ms: the still without it */
  t?: number;
  /** the motion (default: the scene's own in the file) */
  motion?: MotionDoc;
  /** the ambient clock at that moment (default: t), or 'off': what loops stands at its start (a still's ants too) */
  ambient?: number | 'off';
  /** the still's connectors march, by an animation in the SVG itself (default: as the scene's `ants:` in the file says; a
   *  frame's are its motion's, and where that says nothing, the file's) */
  ants?: boolean | Omit<AntsOptions, 'by' | 'kinds'>;
}

/** Throws, with every fault and its line, when the file or its motion has one. */
export function renderSvg(source: string, o: RenderSvgOptions): string {
  const c = compile(source, o.theme, { mode: o.mode ?? 'light', resolveVars: true, strict: 'throw', treatment: o.treatment, mono: o.mono }), kinds = c.theme!.kinds;
  const s = o.scene === undefined ? c.scenes[0] : typeof o.scene === 'number' ? c.scenes[o.scene] : c.scenes.find(x => x.id === o.scene);
  if (!s) throw new Error(`no scene ${JSON.stringify(o.scene)} (there ${c.scenes.length === 1 ? 'is' : 'are'} ${c.scenes.map(x => x.id).join(', ')})`);
  const ants = o.ants === undefined ? antsOf(s.raw) : o.ants === true ? antsOf(s.raw) ?? {} : o.ants || undefined;
  if (o.t === undefined) return ants ? withAnts(s, { ...ants, by: o.ambient === 'off' ? 'none' : 'smil', kinds }) : s.rendered.svg;
  if (o.ants) throw new Error('ants: at a moment they are its motion document\'s');
  const doc = o.motion ?? s.motion;
  if (!doc) throw new Error('t: this scene has no motion');
  const tl = bindMotion(s, doc, { kinds });
  if (!tl.ok) throw new Error(tl.diags.map(d => `${d.path}: ${d.message}${d.hint ? ` (${d.hint})` : ''}`).join('\n'));
  return svgAt(s, tl.at(o.t, o.ambient === undefined ? {} : { ambient: o.ambient }));
}
