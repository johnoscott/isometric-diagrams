// A canvas layer: what draws over the canvas's drawing without being the drawing (a domain's state, cards, marks).
// It is given what the canvas knows (CanvasCtx: the drawing, its elements and boxes, the scale, the view), and gives
// its own controls for the toolbar, marks over the stage, groups after the selection's, a paint after each of the
// canvas's, the boxes a fit takes in, a press, a menu or a key it takes first, and its own calls on what the canvas
// returns. The canvas carries none of a layer's code: the host passes the layer in.

import type { EditorModel } from '../model.ts';
import type { Path } from '../path.ts';

export interface Box { x: number; y: number; w: number; h: number }
export type Outline = { kind: 'poly'; id: string; points: [number, number][] } | { kind: 'route'; d: string };

/** what the canvas gives a layer (D: the domain's drawn document) */
export interface CanvasCtx<D> {
  host: HTMLElement;
  doc: EditorModel;
  cd(): D | undefined;
  svg(): SVGSVGElement | undefined;
  elementsFor(ptr: string): SVGGraphicsElement[];
  boxOf(e: SVGGraphicsElement): Box;
  union(bs: Box[]): Box | undefined;
  outlinesFor(ptr: string): Outline[];
  scale(): number;
  /** the whole drawing's box */
  full(): Box | undefined;
  toSvg(x: number, y: number): { x: number; y: number };
  autoFit(): void;
  /** paint the overlay again (the layer's paint() runs in it) */
  paint(): void;
  /** pan to it, if it is outside the view */
  reveal(p: Path): void;
  note(t: string, tone?: 'info' | 'warn' | 'bad'): void;
}

/** what a layer gives the canvas; A: its calls, added to what the canvas returns */
export interface CanvasLayer<A extends object> {
  tools?: HTMLElement[];
  marks?: HTMLElement[];
  /** each new drawing: the layer's groups, put after the overlay's */
  groups?(): SVGGElement[];
  /** a new drawing is on the stage */
  drawn?(): void;
  /** what a fit takes in besides the drawing */
  extent?(): Box[];
  /** the layer shows marks (the view keeps them in a fit) */
  showing?(): boolean;
  /** after the overlay's own marks */
  paint?(d: Document): void;
  /** a press the layer takes (true: the canvas does nothing more) */
  down?(e: PointerEvent): boolean;
  /** a menu the layer opens (true: the canvas's own isn't) */
  context?(e: MouseEvent, at: { x: number; y: number }): boolean;
  /** a key: handled (the canvas stops it), ignore (the canvas leaves it be), or not the layer's */
  key?(e: KeyboardEvent): 'handled' | 'ignore' | undefined;
  api: A;
}
