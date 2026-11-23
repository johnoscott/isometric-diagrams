// Object kinds as data (docs/editor/LAYERS.md §2): what a region kind is, and the catalogue a drawing is laid out and
// drawn with. Layout and drawing ask a kind's shape and numbers here, never its name, so a kind pack can name its
// kinds as it likes (src/iso-systems/catalog.ts is the drawing format's).

import type { NodeAsset } from './assets.ts';

/** How a region is drawn, and how it takes part in layout and routing. */
export type RegionShape =
  /** a thick base slab: a skirt below its floor (none on another slab), its name large on its front face */
  | 'slab'
  /** a plain block children stand on */
  | 'block'
  /** a cloud lying on the floor, its name in the middle */
  | 'cloud'
  /** a flat tint on the floor: overlays other things on purpose */
  | 'zone'
  /** a cage of thin walls with a gate in one: routes go round its walls (or through its gate) */
  | 'walled'
  /** a translucent tube over other things: overlays them on purpose */
  | 'tunnel';

export interface RegionKind {
  shape: RegionShape;
  /** inner margin, grid units */
  pad: number;
  /** [z0 offset below the floor it stands on, default height above it] */
  z: [number, number];
  /** children stand on its top, and routes find a floor on it */
  floor: boolean;
  /** the colour role it is drawn in, unless the region says its own */
  role: string;
  /** where its name goes, unless the region says */
  labelStyle: 'face' | 'face-right' | 'floor' | 'none';
  /** its row in a page's legend: a swatch (a box, or a line) and its words; auto: shown whenever the kind is drawn */
  legend?: { label: string; swatch: string; box: boolean; auto: boolean };
  /** the kind's own drawing CSS, in the drawing's stylesheet */
  css?: string;
}

export interface KindCatalog {
  regions: Record<string, RegionKind>;
  nodes: Record<string, NodeAsset>;
  /** the node kind a node without one (or with an unknown one) is drawn as */
  defaultNode: string;
}

/** a region kind's data; undefined for a name the catalogue doesn't have */
export const regionKind = (cat: KindCatalog, name: string | undefined): RegionKind | undefined => (name !== undefined && Object.hasOwn(cat.regions, name) ? cat.regions[name] : undefined);
/** a node kind by name (none: the default); undefined for a name the catalogue doesn't have */
export const nodeKind = (cat: KindCatalog, name: string | undefined): NodeAsset | undefined => cat.nodes[name ?? cat.defaultNode];
/** a node kind by name, or the default one */
export const nodeKindOr = (cat: KindCatalog, name: string | undefined): NodeAsset => nodeKind(cat, name) ?? cat.nodes[cat.defaultNode];
/** a walled kind's default height: a gate's height follows it */
export const wallHeight = (cat: KindCatalog): number => Object.values(cat.regions).find(r => r.shape === 'walled')?.z[1] ?? 0.8;
/** the kinds' CSS, in the catalogue's order */
export const kindsCss = (cat: KindCatalog): string => Object.values(cat.regions).map(r => r.css ?? '').join('');
