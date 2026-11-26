// The diagram as the YAML says it (Raw*), and as layout resolves it (placed boxes in grid units).

import type { Box } from '../iso-core/kernel.ts';
import type { RawRole, RawKind, Theme } from '../iso-core/theme.ts';

export type { RawRole, RawKind, Theme };

export type Side = 'n' | 'e' | 's' | 'w';
export type StepRef = string | number;

/** how one piece (and, a region's, its contents) moves when a drawing assembles or disassembles (motion.ts) */
export interface RawMotion {
  style?: 'edge' | 'drop' | 'rise' | 'fly' | 'pop' | 'scatter' | 'build' | 'fade';
  out?: 'explode' | 'lift-off' | 'sink' | 'scatter' | 'fly-out' | 'collapse' | 'fade' | 'reverse';
  easing?: 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'settle' | 'spring' | 'bounce';
  from?: 'left' | 'right' | 'top' | 'bottom';
  /** ms after its turn, and ms its own move takes */
  delay?: number; duration?: number;
}
export interface RawPlacement {
  in?: string; at?: [number, number];
  'right-of'?: string; 'left-of'?: string; below?: string; behind?: string;
  gap?: number; align?: 'start' | 'center' | 'end'; shift?: [number, number];
  appears?: StepRef; disappears?: StepRef;
}
export type RawDeco = string | { terminal?: number; icon?: string; screen?: string };
export interface RawNode extends RawPlacement {
  id: string; asset?: string; role?: string; label?: string; sub?: string;
  size?: number[]; z?: number; deco?: RawDeco[]; ghost?: boolean; face?: string; facing?: number;
  'label-at'?: { side?: 'above' | 'right' | 'left' | 'below'; dx?: number; dy?: number };
  nodes?: RawNode[]; motion?: RawMotion;
  /** other looks of it, by name, for a motion to switch to: its own keys, over what it is */
  variants?: Record<string, RawVariant>;
}
/** what a look may change: never the thing's box, so nothing else moves */
/** row: one after another along x; column: along y; (0.23.0) grid: in rows, as many to a row as makes the most square block */
export type Flow = 'row' | 'column' | 'grid';
export interface RawVariant { role?: string; ghost?: boolean; label?: string; sub?: string; face?: string; deco?: RawDeco[] }
export interface RawGate { side: Side; at?: number; width?: number; height?: number; node?: string }
export interface RawRegion extends RawPlacement {
  id: string; kind: RegionKindName; label?: string; 'label-style'?: 'face' | 'face-right' | 'floor' | 'none'; ghost?: boolean;
  role?: string; size?: number[]; padding?: number; height?: number; z?: number; flow?: Flow;
  gate?: RawGate; around?: string[]; regions?: RawRegion[]; nodes?: RawNode[]; motion?: RawMotion;
  variants?: Record<string, RawVariant>;
}
export interface RawNote {
  floor?: string; face?: string; label?: string; sub?: string; at?: number[]; on?: string; kind?: string;
  dir?: 'x' | 'y'; anchor?: 'start' | 'middle' | 'end'; dx?: number; dy?: number; appears?: StepRef; disappears?: StepRef;
}
export interface RawScene {
  id: string; title: string; caption?: string; aria?: string; gap?: number; flow?: Flow;
  /** (0.23.0) compact: every container without a flow of its own lays its children out as a grid (the most square block) */
  layout?: 'compact';
  regions?: RawRegion[]; nodes?: RawNode[]; routes?: unknown[]; notes?: RawNote[]; steps?: unknown[];
  legend?: 'auto' | false | string[]; badges?: boolean; loop?: boolean; after?: string;
  grid?: GridDef; assemble?: boolean; dim?: 'flows' | 'all';
  /** the scene's motion document (its `isomotion: 1` may be left out) */
  motion?: Record<string, unknown>;
  /** its connectors march: all that may, these, or these with a speed and a dash (ants.ts) */
  ants?: boolean | string[] | { ids?: string[]; speed?: number; dash?: [number, number] };
}
export interface GridDef { snap?: number; show?: boolean; step?: number }
export interface RawDiagram {
  isodiag: 1; title?: string; lede?: string; pills?: string[]; theme?: string;
  roles?: Record<string, RawRole>; kinds?: Record<string, RawKind>; after?: string; footer?: string;
  grid?: GridDef; assemble?: boolean;
  /** how a self-contained drawing of it is painted, where the host doesn't say */
  treatment?: 'mono';
  scenes: RawScene[];
}

/** a region kind's name in the catalogue the drawing is laid out with (src/iso-objects/kinds.ts) */
export type RegionKindName = string;

/** Something placed: a region or a node, with its absolute box after layout. */
export interface Placed {
  id: string;
  type: 'region' | 'node';
  /** JSON path into the source, for diagnostics */
  path: string;
  parent?: Placed;
  children: Placed[];
  box: Box;
  /** the z its children stand on */
  floor: number;
  appears?: StepRef; disappears?: StepRef;
  region?: RawRegion;
  node?: RawNode;
  /** set when another item (a walled region's gate) decides this item's box */
  placedBy?: string;
}

