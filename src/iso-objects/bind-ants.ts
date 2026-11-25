// Ants without a motion. A file of its own: a built page's script has the Timeline, and none of this.

import type { CompiledScene } from './compile.ts';
import { bindMotion, motionSource, type BindOptions, type MotionSource, type Timeline } from './timeline.ts';

/** A drawing whose own file asks for ants, and that has nothing to play: a Timeline of no length, whose connectors march on the ambient clock.
 *  None when the file doesn't ask. */
export function bindAnts(drawing: CompiledScene | MotionSource, opts: BindOptions = {}): Timeline | undefined {
  const src = 'model' in drawing ? drawing : motionSource(drawing);
  if (!src.ants) return undefined;
  const tl = bindMotion(src, { isomotion: 1, series: [{ sequence: { name: 'ants', duration: 1 } }] }, opts);
  if (!tl.ok) return tl;
  return { ...tl, duration: 0, beats: [], markers: {}, at: (ms, o) => tl.at(0, { ambient: o?.ambient ?? ms }), cues: () => undefined, beatAt: () => undefined, startOf: () => undefined };
}
