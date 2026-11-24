// iso-objects (L1): object kinds as data, containment, placement, routing, labels, assembly, steps and focus, and a
// scene drawn as SVG (docs/editor/LAYERS.md §2). It knows a kind by its shape and numbers in a catalogue (kinds.ts),
// never by name; the drawing format's catalogue is the systems pack's (src/iso-systems/).
//
// The layer's public API. Importers name the module a name comes from (with code splitting, a barrel puts every file
// it reaches into each bundle that imports it); the Node tests may import this index.

export type { Side, StepRef, RawPlacement, RawDeco, RawNode, RawGate, RawRegion, RawNote, RawScene, GridDef, RawDiagram, RegionKindName, Placed, RawRole, RawKind, Theme, RawMotion, RawVariant } from './types.ts';
export { regionKind, nodeKind, nodeKindOr, wallHeight, kindsCss } from './kinds.ts';
export type { RegionShape, RegionKind, KindCatalog } from './kinds.ts';
export { drawDecos, boxAsset, plate, cloudPath, drawCloud, defaultLabel, registerMarks, markCss, iconPainter, facePainter, placeholderIcon } from './assets.ts';
export type { LabelSpot, NodeAsset, IconPainter } from './assets.ts';
export { WALL_T, place, gateBox, overlap2 } from './place.ts';
export type { Located, Layout } from './place.ts';
export { parseEnd, floorAt, ROUTE_BUDGET, routeAll, openList, simplify } from './route.ts';
export type { Side as RouteSide, RawRoute, Routed, RouteResult } from './route.ts';
export { silhouette, polyBounds, polyRectArea, rectArea, lineRectArea, Obstacles, labelRect, placeNodeLabel, calloutRect, placeCallout, inConvex, convexOverlap } from './labels.ts';
export type { Rect, Poly, LabelText, PlacedLabel, CalloutSpot } from './labels.ts';
export { offscreen, assembly } from './assemble.ts';
export type { Edge, Piece, Assembly } from './assemble.ts';
export { ASSEMBLE_STYLES, DISASSEMBLE_STYLES, MOTION_ORDERS, MOTION_EASINGS, motionModel, motionOrder, planOf, assemble, disassemble, alongPath, svgAt, paint, introSvg } from './motion.ts';
export type { AssembleStyle, DisassembleStyle, MotionOrder, MotionEasing, Direction, PieceMotion, AssembleOptions, DisassembleOptions, PlanOptions, MotionPiece, MotionModel, MotionPlan, ScenePlan, SceneState, ItemState, LabelState, RouteState } from './motion.ts';
export { drawLooks } from './looks.ts';
export { withAnts, antsOf, antDash, ANTS_CSS, ANT_SPEED, ANT_DASH, ANT_STILL } from './ants.ts';
export type { AntsOptions } from './ants.ts';
export { motion, MotionBuilder, SeriesBuilder, NodesBuilder } from './motion-builder.ts';
export type { SequenceOptions, Timing, CameraVerbs, Ids as MotionIds } from './motion-builder.ts';
export { bindMotion, motionOfSteps, motionSource } from './timeline.ts';
export type { Timeline, BindOptions, BeatInfo, Cue, MotionSource } from './timeline.ts';
export { MOTION_SCHEMA } from './motion-schema.ts';
export { EASING_NAMES, EXTRAPOLATE, checkMotion, msOf, readMs, easeOf, curveAt, springAt, bezier } from './motion-doc.ts';
export type { MotionDoc, MotionNode, MotionTime, MotionEase, EasingName, Extrapolate, SpringConfig, Curve, Say as MotionSay, Focus, ReadTime, Sequence, SeriesItem, Transition, MotionDiag } from './motion-doc.ts';
export { resolveSvg, FONT_STACKS } from './resolve.ts';
export { monoOfDrawing, monoTheme, monoCss, paintMono, usedIn } from './mono-paint.ts';
export type { ResolveOptions, ThemeMode } from './resolve.ts';
export { durationFor, resolveSteps, midpoint } from './steps.ts';
export type { RawStep, Token, StepData, Say, Mark, Badge, Steps } from './steps.ts';
export { focusView } from './focus.ts';
export { regionRole, renderScene, wallsOf, LABEL_BUDGET } from './scene.ts';
export type { RenderedScene, RenderWarning, SceneInput } from './scene.ts';
export { PAGE_CSS, drawingCss, baseCss, MARKS_CSS, PLAYER_UI_CSS, GRID_CSS, PLAYER_CSS } from './css.ts';
export { noSource, compileRaw } from './compile.ts';
export { screenToGrid, localAt, boxSilhouette, floorOf, paddingOf, snapMove, overlaps } from './geometry.ts';
export type { Move } from './geometry.ts';
export type { CompiledScene, Compiled } from './compile.ts';
export { FLAT_DEFAULTS, FLAT_FONTS, metricsMeasure, boardErrors, placeBoard, layoutFlat, flatHit } from './flat.ts';
export type { Board, BoardCard, BoardPanel, BoardLink, FlatRect, FlatPoint, FlatFont, Measure, FlatOptions, FlatCard, FlatPanel, FlatLabel, FlatLink, FlatLayout } from './flat.ts';
export { boardOf, BOARD_3D, BOARD_CSS, cardAsset, boardCatalog, boardDiagram } from './board.ts';
