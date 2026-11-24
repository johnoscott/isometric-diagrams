// A video's frames of a drawing (docs/design/MOTION.md, 6.1), with no React and no Remotion: what a frame shows, and how long it all is.
// The components (a peer's, React's) are a mapping over this. An app on the layers.

import { compile, type Compiled, type CompiledScene } from '../iso-systems/compile.ts';
import { bindMotion, motionOfSteps, transitionAt, transitionMs, type Cue, type Timeline } from '../iso-objects/timeline.ts';
import { ARIMO } from '../iso-core/arimo.ts';
import { msOf, type MotionDoc, type Transition } from '../iso-objects/motion-doc.ts';
import { svgAt } from '../iso-objects/motion.ts';

export interface DrawingProps {
  /** the drawing's text */
  src: string;
  /** the theme's text */
  theme: string;
  /** default: the scene's own motion, else its steps */
  motion?: MotionDoc;
  /** the scene's id (default: the first) */
  scene?: string;
  mode?: 'light' | 'dark';
  treatment?: 'mono' | 'none';
  /** lay the text out with Arimo's widths, and ask for it (default: the system's). The video loads the font itself: isometricFonts */
  font?: 'arimo';
  /** the ambient clock: with the video (default), or 'off' */
  ambient?: 'off';
}
export interface Drawing { compiled: Compiled; scene: CompiledScene; timeline: Timeline }

/** Throws, with every fault, when the drawing or its motion has one: a video of half a drawing is worse than none. */
export function drawingOf(p: DrawingProps): Drawing {
  if (p.font !== undefined && p.font !== 'arimo') throw new Error(`font: there is "arimo" (or none said: the system's), and no ${JSON.stringify(p.font)}`);
  const compiled = compile(p.src, p.theme, { mode: p.mode ?? 'light', resolveVars: true, strict: 'throw', ...(p.treatment ? { treatment: p.treatment } : {}), ...(p.font ? { font: ARIMO } : {}) });
  const scene = p.scene === undefined ? compiled.scenes[0] : compiled.scenes.find(s => s.id === p.scene);
  if (!scene) throw new Error(`no scene ${JSON.stringify(p.scene)} (there ${compiled.scenes.length === 1 ? 'is' : 'are'} ${compiled.scenes.map(s => s.id).join(', ')})`);
  const doc = p.motion ?? scene.motion ?? (scene.steps.steps.length ? motionOfSteps(scene) : undefined);
  if (!doc) throw new Error('this drawing has no motion: no motion of its own, no steps, and none given');
  const timeline = bindMotion(scene, doc, { kinds: compiled.theme!.kinds });
  if (!timeline.ok) throw new Error(timeline.diags.map(d => `${d.path}: ${d.message}${d.hint ? ` (${d.hint})` : ''}`).join('\n'));
  return { compiled, scene, timeline };
}
/** a frame's moment, ms: its start. Fractional frames too (a playback rate gives them). */
export const timeOf = (frame: number, fps: number) => (frame / fps) * 1000;
/** how many frames show all of it: the last one is at its end or past it */
export const framesOf = (ms: number, fps: number) => Math.max(1, Math.ceil((ms / 1000) * fps - 1e-9));
/** A frame's SVG, its ids with a prefix of this instance's own (a transition mounts two at once). */
export function frameSvg(d: Drawing, frame: number, fps: number, o: { prefix?: string; ambient?: 'off' } = {}): string {
  const svg = svgAt(d.scene, d.timeline.at(timeOf(frame, fps), o.ambient ? { ambient: o.ambient } : {}));
  return o.prefix ? prefixed(svg, o.prefix) : svg;
}
export const cueAt = (d: Drawing, frame: number, fps: number): Cue | undefined => d.timeline.cues(timeOf(frame, fps));
const prefixed = (svg: string, p: string) => svg.replace(/(\sid=")([^"]+)"/g, `$1${p}$2"`).replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`).replace(/(\shref="#)([^"]+)"/g, `$1${p}$2"`);

/** Remotion's calculateMetadata: the video is as long as the drawing's motion. */
export const isometricMetadata = (o: { fps: number; width: number; height: number }) => {
  for (const k of ['fps', 'width', 'height'] as const) if (!(Number.isFinite(o[k]) && o[k] > 0)) throw new Error(`isometricMetadata: ${k} is a number over 0`);
  return ({ props }: { props: DrawingProps }) => ({ ...o, durationInFrames: framesOf(drawingOf(props).timeline.duration, o.fps) });
};

/** What loadFont of Remotion's fonts package takes, for a font file of the host's own: `loadFont(isometricFonts({ url: staticFile('Arimo-wght.ttf') }))`.
 *  The package has no font file. */
export function isometricFonts(o: { url: string; format?: 'woff2' | 'woff' | 'opentype' | 'truetype' }): { family: string; url: string; weight: string; format?: 'woff2' | 'woff' | 'opentype' | 'truetype' } {
  if (typeof o?.url !== 'string' || !o.url) throw new Error('isometricFonts: url is where your Arimo file is (the package has none)');
  // the variable file's weights: the drawing's 800 is drawn as 700, the heaviest there is
  return { family: 'Arimo', url: o.url, weight: '400 700', ...(o.format ? { format: o.format } : {}) };
}

// ---------- for TransitionSeries: the document's own transition, in the shapes Remotion's transitions take (structural: nothing imported) ----------

/** A timing as the document's transitions have it: `{ linear: 400 }`, `{ linear: '12f' }`, `{ spring: { damping: 200 } }`. */
export function isometricTiming(timing: Transition['timing']): { getDurationInFrames(o: { fps: number }): number; getProgress(o: { frame: number; fps: number }): number } {
  const bad = () => new Error("isometricTiming: { linear: TIME } or { spring: { mass, damping, stiffness, duration } }, a time being ms, '1.2s' or '30f'");
  if (!timing || typeof timing !== 'object' || (('linear' in timing) === ('spring' in timing))) throw bad();
  const given = 'linear' in timing ? timing.linear : timing.spring?.duration;
  if (('linear' in timing || given !== undefined) && !(msOf(given, 30)! > 0)) throw bad();
  if ('spring' in timing) for (const k of ['mass', 'damping', 'stiffness'] as const) { const v = timing.spring?.[k]; if (v !== undefined && !(Number.isFinite(v) && v > 0)) throw bad(); }
  const length = (fps: number) => transitionMs(timing, fps);
  return { getDurationInFrames: ({ fps }) => framesOf(length(fps), fps), getProgress: ({ frame, fps }) => transitionAt(timing, Math.max(0, timeOf(frame, fps)), length(fps)) };
}
