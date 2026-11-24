// iso-systems: the kind pack for drawing software systems (docs/editor/LAYERS.md §0.2, §2), beside the layers: the
// drawing format (its schema, reader and compile), its catalogue of region and node kinds, and the
// stylesheets with its kinds in them. It may use iso-core and iso-objects; the generic layers never use it.
//
// The pack's public API. Importers name the module a name comes from, as with the layers.

export { NODE_ASSETS, getAsset } from './nodes.ts';
export { REGION_KINDS, systems } from './catalog.ts';
export { DRAWING_CSS, BASE_CSS } from './css.ts';
export { validateSchema, schemaValidator } from './validate.ts';
export { compile, CompileError } from './compile.ts';
export type { CompileOptions } from './compile.ts';
export { renderSvg } from './render.ts';
export type { RenderSvgOptions } from './render.ts';
export type { Compiled, CompiledScene } from './compile.ts';
