// iso-viewer (L2): looking at a drawn scene (docs/editor/LAYERS.md §2): the viewport (pan, zoom, fit, fitted until
// moved), the overlay's painters (marks, ghosts, cards over objects, by key), the cards' motion, a still render's
// machinery, the drawing's stylesheet scoped into a page, the static page with its step player, and the timeline
// (its generic contract, scope paths, search, memory source, export and component).
//
// The layer's public API. Importers name the module a name comes from (with code splitting, a barrel puts every file
// it reaches into each bundle that imports it); the Node tests may import this index.

export { MIN_ZOOM, viewport, MAX_ZOOM } from './viewport.ts';
export type { View, ViewportOpts, Viewport } from './viewport.ts';
export { CARD, P3, pts, overlayPaint } from './overlay.ts';
export type { Box, Outline, Box3, CardGeo, Glyph, Mark, Ghost, Card, OverlayCtx, OverlayPaint } from './overlay.ts';
export { APPEARS, IDLES, cardMotion } from './card-motion.ts';
export type { Appear, Idle, MotionSettings, CardNames, MotionHost, CardMotion } from './card-motion.ts';
export { n, node, rewrite, prune, cls, attr, extent, unite, fitWithOverlay } from './still.ts';
export { isoVars, scopeSelector, scope } from './view-css.ts';
export { md, stepData, legend, renderPage } from './page.ts';
export type { PageOpts } from './page.ts';
export { playerScript } from './bundle.ts';
export { transport, pageClock } from './transport.ts';
export type { Transport, TransportClock, TransportEvents, TransportOptions } from './transport.ts';
export { mountPlayer, PLAY_CSS } from './play.ts';
export type { Player, PlayerOptions } from './play.ts';
export { h } from './dom.ts';
export { TIMELINE_VERSION, SEGMENT_NAME, SEVERITIES, BINS, BIN_MS, scopePattern } from './timeline-contract.ts';
export type { TimelineTypes, AnyTimeline, Scope, Severity, AttrValue, TimelineEvent, Bin, MetricPoint, MetricRollup, EventBin, Match, AstTerm, SearchAst, Days, Retention, SeriesInfo, KindInfo, SourceInfo, EffectiveRetention, ScopeName, Catalog, Filters, Query, Row, Result, Batch, View as TimelineView, Recording, TimelineSource, TimelineCatalog } from './timeline-contract.ts';
export { scopeRules, escapeName, formatScope, join, levelOf, prefixAt, parentOf, within, hasSegment, kindOf, nameOf, crumbs } from './timeline-scope.ts';
export type { Segment } from './timeline-scope.ts';
export { BASE_FIELDS, readTime, searchFor, rangeOf, highlights, severities } from './timeline-search.ts';
export type { Field, SearchDialect, Term, ParsedSearch, Search } from './timeline-search.ts';
export { offsetAt, isZone, binStart, binNext } from './timeline-time.ts';
export { findGaps, gapLabel, gapKey, timeScale, ticks } from './timeline-scale.ts';
export type { Gap, Cut, TimeScale, Tick } from './timeline-scale.ts';
export { toJSON, toCSV } from './timeline-export.ts';
export { memorySource } from './timeline-engine.ts';
export type { MemorySourceOptions, MemorySource } from './timeline-engine.ts';
export { modeFor, activityOf, mountTimeline } from './history.ts';
export type { TimelineMountOptions, TimelineHandle } from './history.ts';
export { flatSvg, flatCss, measureIn, rectOf } from './flat-view.ts';
export type { FlatStyle } from './flat-view.ts';
export { dualView, storedMode, viewToggle, DUAL_VIEW_CSS } from './dual-view.ts';
export type { ViewMode, DualViewOptions, DualView } from './dual-view.ts';
export { morphSvgs, markConnectors, buildLayer, ease, clamp } from './morph.ts';
export type { SvgMorph, MorphLayer } from './morph.ts';
