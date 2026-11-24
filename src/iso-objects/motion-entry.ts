// The package's /motion: plans, the motion document and its Timeline, the builder, looks and ants. All pure, no DOM but paint().

export * from './motion.ts';
export { bindMotion, motionOfSteps } from './timeline.ts';
export type { Timeline, BindOptions, BeatInfo, Cue } from './timeline.ts';
export { motion, MotionBuilder, SeriesBuilder, NodesBuilder } from './motion-builder.ts';
export type { SequenceOptions, Timing, CameraVerbs, Ids as MotionIds } from './motion-builder.ts';
export { MOTION_SCHEMA, EASING_NAMES, EXTRAPOLATE, checkMotion, msOf, readMs, easeOf, curveAt, springAt, bezier } from './motion-doc.ts';
export type { MotionDoc, MotionNode, MotionTime, MotionEase, EasingName, Extrapolate, SpringConfig, Curve, Say as MotionSay, Focus, ReadTime, Sequence, SeriesItem, Transition, MotionDiag } from './motion-doc.ts';
export { withAnts, antsOf, antDash, ANTS_CSS, ANT_SPEED, ANT_DASH, ANT_STILL } from './ants.ts';
export type { AntsOptions } from './ants.ts';
export { drawLooks } from './looks.ts';
