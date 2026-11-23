// iso-core (L0): the isometric drawing core, with no domain in it (docs/editor/LAYERS.md §2). The projection and boxes,
// the SVG string builder and the block faces (kernel), the glyph painters, painter's order (depth), fonts and text
// metrics, theme tokens, YAML with source locations and diagnostics, the safe SVG DOM and the virtual document, and
// the browser's small sha-256.
//
// This is the layer's public API. Its other public entry is compile-schema.ts (ajv): it is kept out of this index
// because it makes a validator when it loads, and the portable build swaps it for precompiled validators, so a bundle
// that never validates never carries ajv. shims/ are the browser's node:path and node:crypto, which the build aliases.

// Named, not export *: with code splitting, esbuild keeps every module an export * reaches.
export { S, C, iso, n1, pt, esc, tag, FONTS, textWidth, apply, matStr, faceFrame, Bounds, Kernel, center } from './kernel.ts';
export type { P2, P3, Box, Attrs, FontKey, Font, Mat, Face, TextRect } from './kernel.ts';
export { termLines, envelope, bubble, fileLines, keyGlyph, socketGlyph, screenFaces, screenGlass, placeholderFace } from './glyphs.ts';
export type { FacePainter } from './glyphs.ts';
export { depthSort } from './depth.ts';
export type { Drawable } from './depth.ts';
export { loadTheme, extendTheme, colorRef, themeCss, themeParts } from './theme.ts';
export type { RawRole, RawKind, Theme } from './theme.ts';
export { DiagError, distance, didYouMean, formatDiag, formatDiags } from './errors.ts';
export type { Severity, Diag } from './errors.ts';
export { parse } from './parse.ts';
export type { Parsed } from './parse.ts';
export { allowed, parseSvg, buildSvg } from './svg-dom.ts';
export type { SvgNode } from './svg-dom.ts';
export { VEl, vdoc, serialize } from './vdom.ts';
export type { VNode } from './vdom.ts';
export { createHash, sha256Hex } from './shims/crypto.ts';
