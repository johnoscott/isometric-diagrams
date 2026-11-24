// The Remotion components mounted in a page under Remotion's own contexts, for test/remotion.test.ts to move from frame to frame.
import { createElement as h, type ComponentType, type ReactNode } from 'react';
// @ts-ignore its types are another package
import { createRoot } from 'react-dom/client';
// @ts-ignore its types are another package
import { flushSync } from 'react-dom';
import { Internals } from 'remotion';
import { parse } from 'yaml';
import { IsometricScene, useIsometricCues, type DrawingProps } from '../../src/remotion/index.ts';
import type { MotionDoc } from '../../src/iso-objects/motion-doc.ts';
import THEME from '../../themes/default.yaml';
import BUILD from '../fixtures/motion/stepped-build.yaml';
import MOTION from '../fixtures/motion/stepped-build.motion.yaml';

const I = Internals as unknown as Record<string, { Provider: ComponentType<{ value: unknown; children?: ReactNode }> }> & { VideoProvider: ComponentType<{ children?: ReactNode }> };
const P: DrawingProps = { src: BUILD, theme: THEME, motion: parse(MOTION) as MotionDoc };
const cfg = { fps: 30, width: 1920, height: 1080, durationInFrames: 100000 };
const manager = { compositions: [{ id: 'x', component: () => null, defaultProps: {}, ...cfg }], folders: [], currentCompositionMetadata: { ...cfg, props: {} }, currentAssetMetadata: null, canvasContent: { type: 'composition', compositionId: 'x' } };
const p = (name: string, value: unknown, child: ReactNode) => h(I[name].Provider, { value }, child);
const Both = (o: object) => h('div', null, h(IsometricScene, { ...P, prefix: 'q-', ...o }), h('i', null, h(Cue)));
const Cue = () => h('b', null, useIsometricCues(P)?.beat ?? 'none');
const tree = (frame: number, o: object) => p('CanUseRemotionHooks', true, p('CompositionManager', manager, p('ResolveCompositionContext', {}, h(I.VideoProvider, null,
  p('TimelineContext', { frame: { x: frame }, playing: false, rootId: 'r', playbackRate: 1, imperativePlaying: { current: false }, setPlaybackRate() {}, audioAndVideoTags: { current: [] } }, h(Both, o))))));
const errors: string[] = [];
addEventListener('error', e => errors.push(e.message));
const mount = () => { const el = document.createElement('div'); document.body.append(el); const root = createRoot(el); return { el, show: (frame: number, o: object = {}) => { flushSync(() => root.render(tree(frame, o))); return el.innerHTML; } }; };
(window as unknown as { __rem: unknown }).__rem = { errors, mount, fresh: (frame: number, o: object = {}) => mount().show(frame, o) };
document.title = 'ready';
