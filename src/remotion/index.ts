// The drawing as Remotion components (docs/design/MOTION.md, 6.1): a thin mapping over frames.ts. React and Remotion are the host's own
// (peers), and Remotion needs its own licence. No clock, no state, no effect: a frame is drawn in render, from its number, so frames can
// be asked for in any order, in parallel. Nothing of Remotion's easing or interpolation is used: a document looks the same on every host.

import { createElement, useId, useMemo, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { BeatInfo, Cue } from '../iso-objects/timeline.ts';
import { cueAt, drawingOf, frameSvg, framesOf, type Drawing, type DrawingProps } from './frames.ts';

export { cueAt, drawingOf, frameSvg, framesOf, isometricFonts, isometricMetadata, isometricTiming, timeOf } from './frames.ts';
export type { Drawing, DrawingProps } from './frames.ts';

export interface IsometricSceneProps extends DrawingProps {
  width?: number | string; height?: number | string; className?: string; style?: CSSProperties;
  /** what its ids begin with (default: this instance's own): a transition mounts two copies at once */
  prefix?: string;
}
/** the drawing, compiled once for what it is made of */
function useDrawing(p: DrawingProps): Drawing {
  const { src, theme, motion, scene, mode, treatment, font } = p;
  return useMemo(() => drawingOf({ src, theme, motion, scene, mode, treatment, font }), [src, theme, motion, scene, mode, treatment, font]);
}

/** the props a presentation's component is given by Remotion's transitions */
interface PresentationProps { children?: ReactNode; presentationDirection: 'entering' | 'exiting'; presentationProgress: number; presentationDurationInFrames?: number; passedProps: IsometricPresentationProps }
export interface IsometricPresentationProps extends Record<string, unknown> {
  /** what the scene going out does: fades too (default: a drawing has no ground of its own, so it would show through), or stays */
  exiting?: 'fade' | 'stay';
}
function Fade(p: PresentationProps): ReactElement {
  const f = Math.max(0, Math.min(1, p.presentationProgress));
  const opacity = p.presentationDirection === 'entering' ? f : p.passedProps.exiting === 'stay' ? 1 : 1 - f;
  return createElement('div', { style: { position: 'absolute', inset: 0, opacity } }, p.children);
}
/** The document's 'fade', between two scenes of a TransitionSeries: `presentation={isometricPresentation()}`. */
export function isometricPresentation(props: IsometricPresentationProps = {}): { component: (p: PresentationProps) => ReactElement; props: IsometricPresentationProps } {
  if (props.exiting !== undefined && props.exiting !== 'fade' && props.exiting !== 'stay') throw new Error(`isometricPresentation: exiting is "fade" or "stay", not ${JSON.stringify(props.exiting)}`);
  return { component: Fade, props };
}

/** The drawing at the current frame (a Sequence's own, inside one). */
export function IsometricScene(p: IsometricSceneProps): ReactElement {
  const frame = useCurrentFrame(), { fps } = useVideoConfig(), id = useId(), d = useDrawing(p);
  const prefix = p.prefix ?? `iso${id.replace(/[^\w-]/g, '')}-`;
  // the SVG fills the box: its own viewBox keeps its proportions
  const svg = useMemo(() => frameSvg(d, frame, fps, { prefix, ambient: p.ambient }).replace('<svg ', '<svg width="100%" height="100%" '), [d, frame, fps, prefix, p.ambient]);
  return createElement('div', { className: p.className, style: { width: p.width ?? '100%', height: p.height ?? '100%', ...p.style }, dangerouslySetInnerHTML: { __html: svg } });
}
/** The commentary now: for a caption of the host's own. */
export function useIsometricCues(p: DrawingProps): Cue | undefined {
  const frame = useCurrentFrame(), { fps } = useVideoConfig(), d = useDrawing(p);
  return useMemo(() => cueAt(d, frame, fps), [d, frame, fps]);
}
export interface IsometricSequencesProps extends DrawingProps { children: (beat: BeatInfo) => ReactNode }
/** A Remotion Sequence for each beat, by its name (so Studio's timeline shows them), with what the host puts in it. */
export function IsometricSequences(p: IsometricSequencesProps): ReactElement {
  const { fps } = useVideoConfig(), d = useDrawing(p);
  return createElement('div', { style: { display: 'contents' } }, ...d.timeline.beats.map(b => {
    // the frames that show the beat: from the first at or after its start, to the next beat's first
    const from = Math.ceil((b.start / 1000) * fps - 1e-9), to = Math.max(from + 1, framesOf(b.end, fps));
    return createElement(Sequence, { key: b.name, name: b.say?.title ?? b.name, from, durationInFrames: to - from, layout: 'none' }, p.children(b));
  }));
}
