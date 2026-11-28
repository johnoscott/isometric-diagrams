// The canvas: the file drawn by the drawing engine (the kit's draw()), editable.
//   - Selection: click, ⇧-click or ⌘-click to add or remove, a marquee drag on empty canvas (⌥: touching is enough),
//     ⌘↑ the parent, rings in the skin's accent. Shared with the tree and the text through the model.
//   - Pan and zoom: the wheel pans, a pinch or ⌘/Ctrl-wheel zooms around the pointer, space-drag or middle-drag pans;
//     + − zoom, 0 fits, 1 is 100%, ⇧2 zooms to the selection; 10%–800%.
//   - Pins: drag a selected thing to pin it to the grid; the pin is x-editor.layout.NAME.at in the file.
//   - Right-click: the menu of what is under the pointer (or of the canvas).
// The drawing is in the page itself (E9): an <svg> built with DOM calls from the renderer's output (svg-dom.ts, never
// innerHTML), styled by the host's canvas CSS, which scopes the diagram's CSS under the kit's root class and names its
// tokens --iso-*, so it never meets the page's. No frame: the pointer's coordinates are the page's.
//   - The kit (CanvasKit) is the domain: how a file is drawn, its objects and kinds, its commands and pins, what
//     the palette offers and what a drop into a container makes, and the words.

import { h, icon, type IconName } from './icons.ts';
import { openMenu, type MenuItem } from './menu.ts';
import { run, type Actions } from './actions.ts';
import { connectionsOf, nearestOn } from '../connections.ts';
import { screenToGrid, localAt, boxSilhouette, floorOf, snapMove, overlaps, paddingOf, type Move } from '../../iso-objects/geometry.ts';
import { resizeSides, minSizeFrom, growLeftBack, type ResizeSides } from '../../iso-objects/resize.ts';
import { settlePins, prunePins } from '../../iso-objects/settle.ts';
import { constrainMove, dragStep } from '../../iso-objects/drag-keys.ts';

/** (0.28.0) which sides of a group that fits what it holds grow when a thing is dragged past them, and which corners of a selected
 *  group have a resize handle. (0.30.0) Left and back on, as the owner chose (group drag, question 2): growing that way moves the
 *  others' pins so nothing else moves on screen ('pins'); the group needs a pin of its own (it moves), else those sides hold. */
export const GROW_SIDES: { readonly right: boolean; readonly front: boolean; readonly left: boolean; readonly back: boolean } =
  { right: true, front: true, left: true, back: true };
/** (0.29.0) the same sides, as the tests set them */
/** (0.29.0) a selected group's resize handles: the sides each moves, and where it stands on the floor (x0, y0, x1, y1: the floor) */
const HANDLES: [string, ResizeSides, (f: { x0: number; y0: number; x1: number; y1: number }) => [number, number]][] = [
  ['corner', { right: true, front: true }, f => [f.x1, f.y1]], ['right', { right: true }, f => [f.x1, (f.y0 + f.y1) / 2]], ['front', { front: true }, f => [(f.x0 + f.x1) / 2, f.y1]],
  ['left', { left: true }, f => [f.x0, (f.y0 + f.y1) / 2]], ['back', { back: true }, f => [(f.x0 + f.x1) / 2, f.y0]],
  ['corner-lb', { left: true, back: true }, f => [f.x0, f.y0]], ['corner-rb', { right: true, back: true }, f => [f.x1, f.y0]], ['corner-lf', { left: true, front: true }, f => [f.x0, f.y1]],
];
export const growSidesForTest = (o: Partial<typeof GROW_SIDES>) => Object.assign(GROW_SIDES as { -readonly [K in keyof typeof GROW_SIDES]: (typeof GROW_SIDES)[K] }, o);
import { regionKind, type KindCatalog } from '../../iso-objects/kinds.ts';
import type { CompiledScene } from '../../iso-objects/compile.ts';
import { iso, C, S } from '../../iso-core/kernel.ts';
import type { EditorModel, Command } from '../model.ts';
import type { Problem } from '../validate.ts';
import { applyStep } from '../splice.ts';
import { seqCmd, type Commands } from '../commands.ts';
import { makeWay, hits, DWELL_HINT, DWELL_GIVE, BACK_AFTER, GLIDE, JIGGLE, type Beside } from '../make-way.ts';
import type { ObjectKindInfo, ObjectRef, ConnectPlan, GroupPlan } from '../adapter.ts';
import { fromPointer, toPointer, type Path } from '../path.ts';
import { buildSvg } from '../../iso-core/svg-dom.ts';
import { viewport, type View } from '../../iso-viewer/viewport.ts';
import type { CanvasCtx, CanvasLayer } from './canvas-layer.ts';
import type { FlatStyle } from '../../iso-viewer/flat-view.ts';
import type { FlatOptions } from '../../iso-objects/flat.ts';
import type { SvgMorph } from '../../iso-viewer/morph.ts';

/** what the canvas draws: the domain's drawn document */
export interface CanvasDrawing {
  scene: CompiledScene;
  /** the frame: the scene's SVG */
  svg: string;
  /** data-id → the JSON pointer in the file it shows */
  pathOf: Map<string, string>;
  /** object name → the id of the element a pin moves */
  pinId: Map<string, string>;
  /** the same for parts with no object of their own: their pins' names */
  partId?: Map<string, string>;
  /** what is dragged with no object of its own: by the id under the pointer, its pin's name (in partId) and what it is called */
  parts?: Map<string, { pin: string; label: string }>;
  /** what can't be dragged by itself, by the id under the pointer, and why */
  fixed?: Map<string, string>;
  /** pins that couldn't apply, with why */
  pinNotes: string[];
  diags: string[];
}
/** a scene drawn in 2D, as the canvas uses it (flat-canvas.ts makes it) */
export interface FlatDrawn {
  svg: string;
  /** its viewBox */
  full: [number, number, number, number];
  /** the layout (for tests) */
  layout: unknown;
  /** the outlines of these drawn ids: a card's or a panel's rect, a link's path */
  outlines(ids: Set<string>, svg: SVGSVGElement): ({ kind: 'poly'; id: string; points: [number, number][] } | { kind: 'route'; d: string })[];
  /** the ids of the cards and panels in a rectangle (or touching it) */
  hits(r: { l: number; t: number; r: number; b: number }, touch: boolean): string[];
  /** the panels under a point, innermost first */
  panelsAt(x: number, y: number): string[];
}
/** the 2D view's implementation, handed to the canvas by its host */
export interface FlatCanvas {
  draw(scene: CompiledScene, stage: Element, o: { styles?: Record<string, FlatStyle>; title?: string; options?: Partial<FlatOptions> }): FlatDrawn;
  /** (0.7.5) the switch's morph, from the view on the stage to the other, both laid out in `root`: undefined when it
   *  shouldn't animate (the motion option, reduced motion); the canvas shows and hides the two drawings itself */
  morph?(root: HTMLElement, scene: CompiledScene, from: { svg: SVGSVGElement; mode: '3d' | '2d' }, to: SVGSVGElement,
    o: { duration?: number; motion?: 'auto' | 'always' | 'never' }): SvgMorph | undefined;
}
/** a drop into a container: what the new object is made as, and the words for it */
export interface DropInto { container: string; value(container: string): unknown; label(container: string): string }
/** the canvas's words and names */
export interface CanvasUi {
  /** the stage's class (the host's canvas CSS is scoped under it), and the drawing's class while the space key is down */
  rootClass: string; panKeyClass: string;
  /** the kinds the canvas's menu offers, in order */
  newOrder: string[];
  /** the palette's entries: a kind, and (0.10.0) a preset: what a new one starts as (default: the kind's template) and
   *  the base of its fresh name (default: the kind's singular) */
  palette: PaletteItem[];
  /** (0.12.0) where the palette is: 'floating' (the default: over the canvas, at its top left) or 'docked' (a pane of
   *  its own at the canvas's left, with a search box filtering by label and section, resizable and collapsible; its
   *  width and whether it is collapsed are kept in the host's store as `canvas-palette-dock`) */
  paletteLayout?: 'floating' | 'docked';
  /** (0.12.5) what a double click on an object does: shows it in the text (the default), or renames it (0.14.1: what has no
   *  name, a connection, does nothing then) */
  doubleClick?: 'text' | 'rename';
  /** (0.14.0) whether what is in a drag's way jiggles before it gives way, and glides: 'always' (the default), or
   *  'respect': not where the viewer prefers reduced motion (the outlines of where it would go still show) */
  dragMotion?: 'always' | 'respect';
  text: {
    stage: string; dragGroup: string; dragSelectTip: string; unreadable: string; palette: string;
    /** the end of a pin drag's hint */
    /** said while something that can't be moved is dragged */
    cantMove: string;
    pinHint: string; renameWhy: string; duplicateWhy: string;
  };
}
export interface PaletteItem {
  kind: string; icon: IconName; label: string; value?(): unknown; name?: string;
  /** (0.11.0) the header it is listed under: entries with one are grouped by it, in order of first use, each group under
   *  a header that collapses (all collapsed but the one last added from, remembered in the host's store as
   *  `canvas-palette`); entries without one are listed as before, where they are */
  section?: string;
}
/** what the canvas is given of the domain (M: the domain's reading of the file; D: its drawing) */
export interface CanvasKit<M, D extends CanvasDrawing> {
  draw(model: M, data: unknown, theme: string): D;
  /** the drawing a text would be (a trial: where a drop lands), or undefined */
  trial(text: string, theme: string): D | undefined;
  catalog: KindCatalog;
  objectOf(ptr: string): ObjectRef | undefined;
  kinds: ObjectKindInfo[];
  commands: Pick<Commands, 'setCmd' | 'deleteCmd' | 'insertCmd' | 'insertItemCmd' | 'pinsCmd' | 'withPinsMoved' | 'describe' | 'freshName'>
    /** (0.31.0) with it, ⌥ at the start of a drag drags a copy */ & Partial<Pick<Commands, 'duplicateCmd'>>;
  /** (0.10.0) a connection drawn from one object to another (the adapter's connect): the canvas offers the gesture (a
   *  handle on a selected object, and "Connect to…") only when it is given */
  connect?(from: ObjectRef, to: ObjectRef, data: unknown): ConnectPlan | undefined;
  /** (0.10.1) a palette drop onto an object (the adapter's dropInto): the new thing inside it, asked innermost first */
  dropOnto?(target: ObjectRef, value: unknown, kind: string, data: unknown): { value: unknown; label?: string } | undefined;
  /** (0.31.0) a thing taken by its move handle (dragged anywhere, no group's edges) and dropped onto `target`, innermost first, or onto
   *  nothing (undefined): its value there and the words ("into group b"), or undefined (it can't go there). The canvas writes the
   *  keys that changed and the pin where it drops, as one step. None: no move handle */
  moveInto?(thing: ObjectRef, value: Record<string, unknown>, target: ObjectRef | undefined, data: unknown): { value: Record<string, unknown>; label?: string } | undefined;
  /** (0.10.0) the selection made into a new container (the adapter's group): Group, ⌘G, one undo step */
  group?(members: ObjectRef[], data: unknown): GroupPlan | undefined;
  /** (0.14.0) the palette's entries as what they make, drawn small (palette-look.ts): what draws those that show and aren't
   *  drawn yet. None: the entries' icons */
  looks?(palette: HTMLElement, data: () => unknown, ui: CanvasUi, theme: string): () => void;
  actions: Actions;
  /** what an object's own menu offers, beyond rename, duplicate and delete */
  objectItems(doc: EditorModel, path: Path, origin: 'canvas' | 'menu', note?: (t: string, tone?: 'bad') => void): MenuItem[];
  pins: { key: string; legacyKey?: string; of(data: unknown): Record<string, unknown> | undefined; keyOf(data: unknown): string; legacyOnly(data: unknown): boolean };
  /** (0.26.0) the format's compact layout, kept with the pins (x-editor.compact): offered as a toggle in the canvas's menu, one
   *  undo step each way. None: no toggle */
  compact?: { on(data: unknown): boolean };
  /** (0.28.0) where a group's size is written ([w, d]), or undefined (that one isn't resized here): given it, a selected group has
   *  resize handles (GROW_SIDES), and its menu "Fit to contents" when it has a size. None: no handles */
  resize?: { at(group: Path): Path | undefined };
  /** the 2D view (0.6.4): offered as a 3D | 2D switch when given. `load` hands over its implementation (flat-canvas.ts;
   *  the canvas never names it, so a host without a 2D view bundles none of it). In 2D, selecting, the menu, renaming,
   *  deleting, adding from the palette (into a panel, or placed by the layout) and undo work as in 3D; pins (moving)
   *  are 3D only. The host's canvas CSS has the 2D view's (flatCss), scoped as the drawing's is. */
  flat?: { load(): Promise<FlatCanvas>; styles?: Record<string, FlatStyle>; title?: string; options?: Partial<FlatOptions>;
    /** (0.7.5) the switch morphs, as dualView does: 'auto' (the default) honours prefers-reduced-motion, 'always' morphs
     *  regardless, 'never' swaps at once; `duration` in ms (600) */
    motion?: 'auto' | 'always' | 'never'; duration?: number };
  /** a drop of this kind onto a container's floor (none: it is pinned where it drops) */
  dropInto?(kind: string): DropInto | undefined;
  ui: CanvasUi;
}

export interface CanvasOpts<M, D extends CanvasDrawing, A extends object = object> {
  kit: CanvasKit<M, D>;
  theme: string;
  problems(): Problem[];
  note(t: string, tone?: 'info' | 'warn' | 'bad'): void;
  showInText(p: Path): void;
  showInTree(p: Path): void;
  onZoom(pct: number): void;
  /** the navigation modes, for the status bar */
  onHint?(text: string): void;
  /** (0.22.0) told when the canvas's part of what the person is in the middle of may have changed (a drag, a drop, a link) */
  onBusy?(): void;
  /** Copy, Cut and Paste for the menu */
  clipItems?(): MenuItem[];
  /** where the navigation modes are kept between visits (the host's storage); none: for this mount only */
  store?: { get(k: string): string | null; set(k: string, v: string | null): void };
  /** a layer over the drawing (none: the drawing and its marks only) */
  layer?: (ctx: CanvasCtx<D>) => CanvasLayer<A>;
}

/** a new thing as a drag would make it: inside what (none: the canvas), by which command */
export interface FreshPlan { into?: string; label: string; add: Command }
/** (0.31.0) a thing moved by its handle: it, and where it stood and was pressed (in the container it was in) */
interface Free { ref: ObjectRef; path: Path; start: [number, number]; x0: number; y0: number }

const SVGNS = 'http://www.w3.org/2000/svg';


export function canvasView<M, D extends CanvasDrawing, A extends object = object>(host: HTMLElement, doc: EditorModel, opts: CanvasOpts<M, D, A>) {
  const K = opts.kit, ui = K.ui, T = ui.text;
  const { setCmd, deleteCmd, insertCmd, insertItemCmd, pinsCmd, withPinsMoved, freshName, describe } = K.commands;
  const { deletePaths, duplicate, connected } = K.actions;
  const resourceOf = (ptr: string) => K.objectOf(ptr);
  const kindOf = (k: string) => K.kinds.find(x => x.kind === k)!;
  const PINS_KEY = K.pins.key;
  /** (0.10.0) a connection being drawn: from what, the pointer (in the drawing's coordinates), what it is over; `pick`:
   *  started from the menu, so the next click ends it */
  let linking: { from: ObjectRef; x?: number; y?: number; over?: string; pick?: boolean } | undefined;
  /** (0.28.0) a resize handle being dragged: the group, which handle, where the press was, and the size it started at, may go to, and has */
  let sizing: { path: Path; at: Path; label: string; handle: string; sides: ResizeSides; x0: number; y0: number; size0: [number, number]; min: [number, number]; size: [number, number]; held: boolean; shift: [number, number]; floor: { x0: number; y0: number; z: number } } | undefined;
  host.classList.add('canvas');
  // the stage holds the drawing, and takes the focus, the keys and the pointer
  const stage = h('div', { class: `${ui.rootClass} canvas-stage`, tabindex: '0', role: 'application', 'aria-label': T.stage });
  const tools = h('div', { class: 'canvas-tools', role: 'toolbar', 'aria-label': 'Canvas' });
  const zoomOut = h('button', { type: 'button', class: 'btn sm quiet icon-only', 'aria-label': 'Zoom out (−)', title: 'Zoom out (−)' }, '−');
  const zoomLabel = h('button', { type: 'button', class: 'btn sm quiet zoom-label', title: 'Fit (0) · 100% (1)' }, '100%');
  const zoomIn = h('button', { type: 'button', class: 'btn sm quiet icon-only', 'aria-label': 'Zoom in (+)', title: 'Zoom in (+)' }, '+');
  const fitBtn = h('button', { type: 'button', class: 'btn sm quiet', title: 'Fit (0)' }, 'Fit');
  // navigation: what the wheel does, and what a drag on nothing does (remembered by this browser)
  const seg = (label: string, key: string, values: [string, string, string][]) => {
    const g = h('div', { class: 'segmented', role: 'group', 'aria-label': label, title: label });
    for (const [v, text, tip] of values) {
      const b = h('button', { type: 'button', class: 'seg', 'data-v': v, title: tip }, text);
      b.addEventListener('click', () => { nav[key as 'wheel' | 'drag'] = v as never; saveNav(); paintNav(); });
      g.append(b);
    }
    return g;
  };
  const wheelSeg = seg('The wheel', 'wheel', [['zoom', 'Zoom', 'The wheel zooms around the pointer; ⇧-wheel pans sideways'], ['scroll', 'Scroll', 'The wheel pans; ⇧-wheel pans sideways; a pinch zooms']]);
  const dragSeg = seg(T.dragGroup, 'drag', [['pan', 'Pan', 'Drag pans; ⇧- or ⌘-drag draws a selection'], ['select', 'Select', T.dragSelectTip]]);
  // the view: 3D (the drawing, pins and all) or 2D (its flat layout); offered when the kit has a 2D view
  let mode: '3d' | '2d' = '3d';
  let flat: FlatDrawn | undefined, flatImpl: FlatCanvas | undefined;
  /** the 2D view's implementation, once (the host's to hand over) */
  const loadFlat = async () => (flatImpl ??= await K.flat!.load());
  const viewSeg = h('div', { class: 'segmented view-seg', role: 'group', 'aria-label': 'The view' });
  for (const [v, text, tip] of [['3d', '3D', '3D: the drawing; drag a selected thing to move it'], ['2d', '2D', '2D: select, rename, delete, add from the palette and edit here; moving is in 3D']] as const) {
    const b = h('button', { type: 'button', class: 'seg', 'data-v': v, title: tip }, text);
    b.addEventListener('click', () => setMode(v));
    viewSeg.append(b);
  }
  // what a layer is given (its calls run later, once the drawing and the view are made)
  const ctx: CanvasCtx<D> = {
    host, doc, cd: () => cd, svg: () => svg, elementsFor: p => elementsFor(p), boxOf: e => boxOf(e), union: bs => union(bs), outlinesFor: p => outlinesFor(p),
    scale: () => scale(), full: () => V.full, toSvg: (x, y) => toSvg(x, y), autoFit: () => autoFit(), paint: () => paintOverlay(), reveal: p => zoomIfOutside(p), note: (m, tone) => opts.note(m, tone),
  };
  // the layer's controls first, then the canvas's own
  const layer = opts.layer?.(ctx);
  tools.append(...(layer?.tools ?? []), ...(K.flat ? [viewSeg] : []), wheelSeg, dragSeg, zoomOut, zoomLabel, zoomIn, fitBtn);
  const empty = h('div', { class: 'canvas-empty', hidden: true });
  host.append(stage, tools, empty, ...(layer?.marks ?? []));
  const nav = { wheel: 'zoom' as 'zoom' | 'scroll', drag: 'pan' as 'pan' | 'select' };
  try { Object.assign(nav, JSON.parse(opts.store?.get('canvas-nav') ?? '{}')); } catch { /* defaults */ }
  if (K.flat && opts.store?.get('canvas-view') === '2d') mode = '2d';
  /** switch the view: the drawing again in the other one, fitted (a 2D layout and a 3D one share no coordinates) */
  // (0.22.0) remember: the person's own choice, kept for next time; a host's isn't
  function setMode(m: '3d' | '2d', remember = true) {
    if (!K.flat || m === mode) return;
    endMorph();
    const was = mode;
    mode = m;
    if (remember) opts.store?.set('canvas-view', m);
    paintNav();
    // the drawing on the stage stays there, under the new one, to morph from (0.7.5)
    if (svg && cd && svg.parentNode === stage) morphFrom = { svg, mode: was };
    if (lastS3 !== undefined) { V.view = undefined; lastKey = ''; void render(lastS3, lastData); }
  }
  const saveNav = () => opts.store?.set('canvas-nav', JSON.stringify(nav));
  /** the toolbar, the cursor and the status bar's hint show the current modes */
  function paintNav() {
    for (const [g, v] of [[wheelSeg, nav.wheel], [dragSeg, nav.drag], [viewSeg, mode]] as const) for (const b of g.querySelectorAll<HTMLButtonElement>('.seg')) b.setAttribute('aria-pressed', String(b.dataset.v === v));
    svg?.classList.toggle('mode-pan', nav.drag === 'pan');
    svg?.classList.toggle('mode-select', nav.drag === 'select');
    if (drag?.kind === 'pin' && drag.moved) { svg?.classList.add('dragging'); svg?.classList.toggle('drag-bad', !!drag.invalid); return; }   // the drag's own hint stays
    opts.onHint?.(`${nav.drag === 'pan' ? 'Drag: pan · ⇧-drag: select' : 'Drag: select · space-drag: pan'} · Wheel: ${nav.wheel === 'zoom' ? 'zoom' : 'scroll'}`);
  }
  let cd: D | undefined;
  let svg: SVGSVGElement | undefined;
  let overlay: SVGGElement | undefined;
  let lastKey = '';
  let hoverId: string | undefined;
  const fdoc = () => document;

  /** Draw the file (after each change the reader accepted). */
  let disposed = false;
  // (0.22.0) how many drawings are on their way, for drawn()
  let renders = 0;
  async function render(s3: M | undefined, data: unknown) {
    renders++;
    try { await renderOnce(s3, data); } finally { renders--; }
  }
  async function renderOnce(s3: M | undefined, data: unknown) {
    if (disposed) return;
    if (!s3) { showEmpty(T.unreadable); return; }
    const key = JSON.stringify(data);
    // nothing new to draw: repaint the marks, unless a drag is showing its grid (it repaints when it ends)
    // (0.22.0: the same drawing again, after a text that couldn't be drawn, takes that notice away too)
    if (key === lastKey && svg) { empty.hidden = true; if (!pinDrag()) paintOverlay(); if (toFit) { toFit = false; fitItems(); } return; }
    if (mode === '2d' && !flatImpl) {
      try { await loadFlat(); } catch (e) { mode = '3d'; paintNav(); opts.note(`The 2D view couldn't load: ${(e as Error).message}`, 'warn'); }
    }
    let next: D;
    try { next = K.draw(s3, data, opts.theme); } catch (e) { showEmpty(`The canvas couldn't draw this: ${(e as Error).message}`); return; }
    if (next.diags.length) { showEmpty(`The canvas couldn't draw this: ${next.diags[0]}`); return; }
    lastKey = key;
    lastS3 = s3; lastData = data;
    drawLooks();
    if (pinDrag() || dropping) { pendingAfterDrag = true; return; }      // a model change mid-drag (or while its drop fades): drawn when the drag ends
    await draw(next);
    if (cd!.pinNotes.length) opts.note(`Pins: ${cd!.pinNotes.join('; ')}`, 'warn');
  }
  let toFit = false;     // (0.12.5) the next drawing is another document's: fitted
  let lastS3: M | undefined, lastData: unknown, pendingAfterDrag = false;
  // ---------- the switch's morph (0.7.5): the 2D view's implementation runs it, over the stage ----------
  let morphFrom: { svg: SVGSVGElement; mode: '3d' | '2d' } | undefined;
  let morphing: { m: SvgMorph; from: SVGSVGElement; to: SVGSVGElement } | undefined;
  /** end a morph now: the layer and the old drawing gone, the new one shown */
  function endMorph() {
    if (!morphing) return;
    const r = morphing; morphing = undefined;
    r.m.finish();
    r.from.remove();
    r.to.style.visibility = '';
  }
  /** after a switch draws the new view: the morph from the old one, both on the stage (the old under the new) */
  function startMorph(from: { svg: SVGSVGElement; mode: '3d' | '2d' }, to: SVGSVGElement) {
    const m = flatImpl?.morph?.(stage, cd!.scene, from, to, { motion: K.flat?.motion, duration: K.flat?.duration });
    if (!m) { from.svg.remove(); return; }
    from.svg.style.visibility = 'hidden'; to.style.visibility = 'hidden';
    const me = { m, from: from.svg, to };
    morphing = me;
    stage.classList.add('morphing');
    void m.done.then(() => { if (morphing === me) endMorph(); stage.classList.remove('morphing'); });
  }
  /** put a drawing on the stage (the file's, or a drag's trial layout): built with DOM calls, never from markup */
  async function draw(next: D) {
    endMorph();
    let s: SVGSVGElement;
    let full = next.scene.rendered.viewBox as unknown as number[];
    try {
      if (mode === '2d' && flatImpl) {
        // the 2D view: the host's implementation draws the drawing's board, laid out flat
        flat = flatImpl.draw(next.scene, stage, { styles: K.flat?.styles, title: K.flat?.title, options: K.flat?.options });
        full = flat.full;
        s = buildSvg(flat.svg);
        // the stage takes the keys: the cards aren't stops of their own here
        for (const e of s.querySelectorAll('[tabindex]')) { e.removeAttribute('tabindex'); e.removeAttribute('role'); }
      } else { flat = undefined; s = buildSvg(next.svg); }
    } catch (e) { showEmpty(`The canvas couldn't draw this: ${(e as Error).message}`); return; }
    cd = next;
    s.classList.add('scene');
    s.removeAttribute('width'); s.removeAttribute('height');
    s.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    s.setAttribute('aria-hidden', 'true');            // the stage says it in words; the tree and text say the rest
    overlay = document.createElementNS(SVGNS, 'g') as SVGGElement;
    overlay.setAttribute('class', 'overlay');
    // 0.7.4: safe without any stylesheet: the marks inherit no fill, a thin accent-less stroke, and never take the pointer
    // (a hover mark over its thing would take it, and the hover would flicker); a host's CSS (assets/marks.css) styles them
    overlay.setAttribute('fill', 'none'); overlay.setAttribute('stroke', 'currentColor'); overlay.setAttribute('pointer-events', 'none');
    s.append(overlay, ...(layer?.groups?.() ?? []));
    const from = morphFrom; morphFrom = undefined;
    if (from && svg === from.svg && svg.parentNode === stage) {
      // a switch: the old view stays under the new one until the morph has read both
      from.svg.querySelector('.overlay')?.replaceChildren();
      from.svg.style.position = 'absolute'; from.svg.style.inset = '0';
      stage.append(s);
    } else if (svg?.parentNode === stage) svg.replaceWith(s); else stage.append(s);
    svg = s;
    const [x, y, w, hh] = full;
    V.full = { x, y, w, h: hh };
    if (toFit) { toFit = false; V.view = { ...V.full }; fitItems(); } else if (!V.view) { V.view = { ...V.full }; autoFit(); } else quietly(applyView);
    empty.hidden = true;
    layer?.drawn?.();
    if (pendingReveal && reveal(pendingReveal)) pendingReveal = undefined;
    // once, on the first drawing after its own drop; another drag forgets it (its drawings are trials, and the pointer is on them)
    if (pendingNudge) { if (!drag) nudge(pendingNudge); pendingNudge = undefined; }
    paintNav();
    paintOverlay();
    if (from && from.svg !== s) {
      if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';
      startMorph(from, s);
    }
  }
  function showEmpty(t: string) {
    morphFrom = undefined;
    empty.textContent = t;
    empty.hidden = false;
  }

  // light and dark: the canvas CSS maps the drawing's tokens onto the skin's, which follow the page's colour scheme
  function setTheme(_t: 'light' | 'dark') { paintOverlay(); }

  // ---------- view: pan and zoom (the viewport, src/iso-viewer/viewport.ts) ----------
  function itemsBox() {
    if (!cd || !svg) return undefined;
    const ptrs = [...new Set([...cd.pathOf.values()].filter(p => { const r = resourceOf(p); return r && r.path === p; }))];
    // what a layer draws is fitted too
    const live = layer?.extent?.() ?? [];
    return union([...ptrs.flatMap(p => elementsFor(p)).filter(e => e.getBBox().width || e.getBBox().height).map(boxOf), ...live]);
  }
  /** (0.12.6) the connectors and their labels (not a step's marks on them, which a still doesn't show): Fit keeps them on the stage */
  function routesBox() {
    if (!cd || !svg) return undefined;
    const els = Object.keys(cd.scene.rendered.paths).flatMap(id => [...svg!.querySelectorAll<SVGGraphicsElement>(`[data-id="${CSS.escape(id)}"], [data-hl="${CSS.escape(id)}"], [data-for="${CSS.escape(id)}"]`)]).filter(e => !e.closest('.pre, .overlay, .g-marks, .g-badges, .g-anim'));
    return union(els.filter(e => e.getBBox().width || e.getBBox().height).map(boxOf));
  }
  // (0.12.1) the view is the stage's: docked, the palette's pane shares the host, so the host is wider than what is
  // drawn (the scale, the pointer's place, a resize); floating, the stage is the host's whole area
  const docked = ui.paletteLayout === 'docked';
  const viewEl = docked ? stage : host;
  const V = viewport(viewEl, {
    svg: () => svg,
    onApply: k => {
      svg!.classList.toggle('zoom-near', k >= 1);          // a layer's detail shows from 100% up
      const pct = Math.round(k * 100);
      zoomLabel.textContent = `${pct}%`;
      opts.onZoom(pct);
    },
    onRezoom: () => paintOverlay(),
    itemsBox: () => itemsBox(),
    alsoBox: () => routesBox(),
    marksShowing: () => !!layer?.showing?.(),
  });
  const { size, scale, quietly, applyView, toSvg, zoomAt, fit, fitItems, autoFit, actual, settled } = V;
  function zoomToSelection() { const b = unionBox(doc.selection); if (b) fit({ x: b.x - 20, y: b.y - 20, w: b.w + 40, h: b.h + 40 }); }
  zoomIn.addEventListener('click', () => zoomAt(1.25));
  zoomOut.addEventListener('click', () => zoomAt(0.8));
  zoomLabel.addEventListener('click', () => fitItems());
  fitBtn.addEventListener('click', () => fitItems());

  // ---------- what is where ----------
  const elementsFor = (ptr: string): SVGGraphicsElement[] => {
    if (!svg || !cd) return [];
    const ids = [...cd.pathOf.entries()].filter(([, p]) => p === ptr || (ptr && p.startsWith(ptr + '/') && false)).map(([id]) => id);
    return ids.flatMap(id => [...svg!.querySelectorAll<SVGGraphicsElement>(`[data-id="${CSS.escape(id)}"]`)]).filter(e => !e.closest('.pre') && !e.classList.contains('pre'));
  };
  /** an element's box in the scene's (root) coordinates */
  const boxOf = (e: SVGGraphicsElement) => {
    const b = e.getBBox();
    const m = e.getCTM(), root = svg!.getCTM();
    if (!m || !root) return { x: b.x, y: b.y, w: b.width, h: b.height };
    const t = root.inverse().multiply(m);
    const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => ({ x: t.a * x + t.c * y + t.e, y: t.b * x + t.d * y + t.f }));
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const union = (bs: { x: number; y: number; w: number; h: number }[]) => {
    if (!bs.length) return undefined;
    const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y)), x1 = Math.max(...bs.map(b => b.x + b.w)), y1 = Math.max(...bs.map(b => b.y + b.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  /** a path's drawn box: its own elements, else its resource's */
  const boxFor = (p: Path) => {
    // the path's own drawing, else (a key inside a resource) its resource's; never the whole file for something else
    const own = toPointer(p);
    let els = elementsFor(own);
    const r = resourceOf(own);
    if (!els.length && r && r.path !== own) els = elementsFor(r.path);
    return els.length ? union(els.filter(e => e.getBBox().width || e.getBBox().height).map(boxOf)) : undefined;
  };
  const unionBox = (ps: Path[]) => union(ps.map(boxFor).filter((b): b is NonNullable<typeof b> => !!b));
  const pathAtEvent = (target: EventTarget | null): string | undefined => {
    const el = (target as Element | null)?.closest?.('[data-id]') as Element | null;
    if (!el || !cd) return undefined;
    // the innermost element that maps
    let e: Element | null = el;
    while (e) { const id = e.getAttribute('data-id'); if (id && cd.pathOf.has(id)) return cd.pathOf.get(id); e = e.parentElement?.closest('[data-id]') ?? null; }
    return undefined;
  };

  /** the innermost drawn thing under the pointer that is the file's, a part or fixed */
  const idAtEvent = (target: EventTarget | null): string | undefined => {
    let e = (target as Element | null)?.closest?.('[data-id]') as Element | null;
    while (e && cd) { const id = e.getAttribute('data-id'); if (id && (cd.parts?.has(id) || cd.fixed?.has(id) || cd.pathOf.has(id))) return id; e = e.parentElement?.closest('[data-id]') ?? null; }
    return undefined;
  };
  /** the part it is, if it is one */
  const partAtEvent = (target: EventTarget | null) => { const id = idAtEvent(target); return id === undefined ? undefined : cd?.parts?.get(id); };

  // (0.12.4) connections: the routes that are entries of the file's own (src/iso-editor/connections.ts)
  const isRouteId = (id: string) => !!cd && Object.hasOwn(cd.scene.rendered.paths, id);
  const connections = () => (cd ? connectionsOf(cd.pathOf, isRouteId, K.objectOf) : new Map<string, string>());
  /** how near a connection, in the page's pixels, is on it */
  const NEAR = 6;
  /** the drawn thing under a place on the page: a connection within NEAR of it, unless a node is there (a node's always the
   *  one meant; a region's floor, or nothing, gives way) or a node hides that part of the connection */
  const pathAt = (target: EventTarget | null, px: number, py: number): string | undefined => {
    const direct = pathAtEvent(target);
    const isNode = (el: Element | null): boolean => {
      const id = el?.closest?.('[data-id]')?.getAttribute('data-id');
      if (!id || !cd || isRouteId(id)) return false;
      if (flat) { const q = toSvg(px, py); return !flat.panelsAt(q.x, q.y).includes(id) && cd.scene.layout.byId.has(id); }
      return cd.scene.layout.byId.get(id)?.type === 'node';
    };
    const el = target as Element | null;
    if (!cd || !svg || !el?.closest || (el !== svg && !svg.contains(el) && el !== stage) || isNode(el)) return direct;
    const conns = connections();
    if (!conns.size || (direct !== undefined && conns.has(direct))) return direct;
    const at = toSvg(px, py), k = scale(), r = viewEl.getBoundingClientRect();
    let best: { ptr: string; dist: number } | undefined;
    for (const ptr of conns.keys()) for (const sh of outlinesFor(ptr)) {
      if (sh.kind !== 'route') continue;
      const q = nearestOn(sh.d, at.x, at.y);
      if (!q || q.dist * k > NEAR || (best && q.dist >= best.dist)) continue;
      if (isNode(fdoc().elementFromPoint(r.left + (q.x - V.view!.x) * k, r.top + (q.y - V.view!.y) * k))) continue;
      best = { ptr, dist: q.dist };
    }
    return best ? best.ptr : direct;
  };

  // ---------- the overlay: selection rings, hover, problem badges ----------
  /**
   * A resource's drawn shapes, isometric: a node (or a slab, a VM, a platform) is the silhouette of its box (the hexagon
   * its eight projected corners make); any other region is its floor parallelogram; a route is its own path.
   */
  function outlinesFor(ptr: string): ({ kind: 'poly'; id: string; points: [number, number][] } | { kind: 'route'; d: string })[] {
    if (!cd) return [];
    const out: ({ kind: 'poly'; id: string; points: [number, number][] } | { kind: 'route'; d: string })[] = [];
    const mine = new Set([...cd.pathOf].filter(([, p]) => p === ptr).map(([id]) => id));
    // 2D: a card's or a panel's rect; a link's own path
    if (flat && svg) return flat.outlines(mine, svg);
    for (const [id, p] of cd.pathOf) {
      if (p !== ptr) continue;
      const item = cd.scene.layout.byId.get(id);
      // a thing drawn inside another drawing of the same resource (a VM's /workspace and disk) has no outline of its own
      let up = item?.parent;
      while (up && !mine.has(up.id)) up = up.parent;
      if (up) continue;
      if (item) {
        if (svg?.querySelector(`[data-id="${CSS.escape(id)}"].pre`)) continue;
        const shape = regionKind(K.catalog, item.region?.kind)?.shape;
        const solid = item.type === 'node' || shape === 'slab' || shape === 'block';
        out.push({ kind: 'poly', id, points: solid ? boxSilhouette(item.box) : floorOf(item.box) });
      } else if (cd.scene.rendered.paths[id] && !svg?.querySelector(`[data-id="${CSS.escape(id)}"].pre`)) {
        out.push({ kind: 'route', d: cd.scene.rendered.paths[id] });
      }
    }
    return out;
  }

  /** (0.28.0) the one selected thing, when it is a drawn group the format can resize: its path, box, floor height, label, size and what it holds */
  function sizableGroup() {
    if (!K.resize || !cd || !doc.doc.ok || doc.selection.length !== 1) return undefined;
    const ptr = toPointer(doc.selection[0]);
    const id = [...cd.pathOf].find(([i, p]) => p === ptr && cd!.scene.layout.byId.get(i)?.region)?.[0];
    const item = id === undefined ? undefined : cd.scene.layout.byId.get(id);
    const at = item?.region ? K.resize.at(doc.selection[0]) : undefined;
    if (!item?.region || !at) return undefined;
    const pad = paddingOf(K.catalog, item.region), pin = groupPin(cd, id!), named = new Map([...pinIds(cd)].map(([n, i]) => [i, n]));
    return { path: doc.selection[0], at, box: item.box, z: item.box.z0, label: item.region.label ?? id!, size: item.region.size as number[] | undefined, pin,
      min: (sides: ResizeSides, step: number) => minSizeFrom(item.box, item.children.map(c => c.box), pad, sides, step),
      /** what it holds that can be pinned, where it stands in it (a left or back resize moves these, so they stay put on screen) */
      held: () => item.children.flatMap(c => { const n = named.get(c.id), w = localAt(cd!.scene, c.id); return n && w ? [{ name: n, at: w }] : []; }),
      /** the handles it has: right and front always (GROW_SIDES); left and back when they are on, and it can be pinned (they move it) */
      handles: () => HANDLES.filter(([, sd]) => (!sd.right || GROW_SIDES.right) && (!sd.front || GROW_SIDES.front) && (!sd.left || (GROW_SIDES.left && !!pin)) && (!sd.back || (GROW_SIDES.back && !!pin))) };
  }
  /** (0.28.0) a group's size written, or taken away (back to fitting what it holds), as one step */
  // (0.31.0) a size kept with the pins (a format's drawing only): written as a pin is, and its entry gone with it when that was all
  const sizeCmd = (g: { at: Path }, size: [number, number] | undefined, label: string): Command => {
    const pin = g.at[0] === PINS_KEY;
    if (size) return pin ? withPinsMoved(setCmd(g.at, size, label)) : setCmd(g.at, size, label);
    // taken away: with it, each map above it (to the pins key) that held nothing else, so the file is as it was before
    let at = g.at;
    while (pin && at.length > 1) { const up = at.slice(0, -1), m = up.reduce<any>((x, k) => x?.[k], doc.goodDoc.data); if (!m || typeof m !== 'object' || Object.keys(m).length !== 1) break; at = up; }
    return { ...deleteCmd(at), label };
  };
  function paintOverlay() {
    V.painted(V.view ? scale() : 0);
    if (!overlay || !svg) return;
    const d = fdoc();
    overlay.replaceChildren();
    const ring = (b: { x: number; y: number; w: number; h: number }, cls: string, pad = 4) => {
      const r = d.createElementNS(SVGNS, 'rect');
      r.setAttribute('class', cls);
      r.setAttribute('x', String(b.x - pad)); r.setAttribute('y', String(b.y - pad));
      r.setAttribute('width', String(b.w + pad * 2)); r.setAttribute('height', String(b.h + pad * 2));
      r.setAttribute('rx', '6');
      overlay!.append(r);
    };
    const draw = (ptr: string, cls: 'ring' | 'hover') => {
      // a key inside a resource is shown by its resource's outline
      const r = resourceOf(ptr);
      let shapes = outlinesFor(ptr);
      if (!shapes.length && r && r.path !== ptr) shapes = outlinesFor(r.path);
      if (!shapes.length) { const b = boxFor(fromPointer(ptr)); if (b) ring(b, cls, cls === 'hover' ? 3 : 4); return; }
      for (const sh of shapes) {
        if (sh.kind === 'route') {
          const r = d.createElementNS(SVGNS, 'path');
          r.setAttribute('class', cls === 'ring' ? 'route-ring' : 'route-hover');
          r.setAttribute('d', sh.d);
          overlay!.append(r);
        } else {
          const r = d.createElementNS(SVGNS, 'polygon');
          r.setAttribute('class', cls);
          r.setAttribute('points', sh.points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
          r.setAttribute('data-for', sh.id);
          overlay!.append(r);
        }
      }
    };
    if (hoverId !== undefined && !doc.selection.some(p => toPointer(p) === hoverId)) draw(hoverId, 'hover');
    for (const p of doc.selection) draw(toPointer(p), 'ring');
    // (0.28.0) resizing: handles on the one selected group (GROW_SIDES), and while one is dragged, the floor it would have
    const grp = sizableGroup();
    if (grp && !linking) {
      const k = scale(), { box: b, z } = grp, P = (x: number, y: number) => iso(x, y, z);
      // the floor it has, or (resizing) would have: a left or back side moves its corner by the shift
      const x0 = b.x0 - (sizing?.shift[0] ?? 0), y0 = b.y0 - (sizing?.shift[1] ?? 0);
      const f = { x0, y0, x1: x0 + (sizing ? sizing.size[0] : b.x1 - b.x0), y1: y0 + (sizing ? sizing.size[1] : b.y1 - b.y0) };
      if (sizing) {
        const t = d.createElementNS(SVGNS, 'polygon');
        t.setAttribute('class', `size-to${sizing.held ? ' held' : ''}`);
        t.setAttribute('points', [P(f.x0, f.y0), P(f.x1, f.y0), P(f.x1, f.y1), P(f.x0, f.y1)].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
        overlay.append(t);
      }
      const at: [string, number, number][] = grp.handles().map(([h, , pos]) => [h, ...pos(f)] as [string, number, number]);
      const half = (matchMedia('(pointer: coarse)').matches ? 22 : 6) / k;
      for (const [h, gx, gy] of at) {
        const [px, py] = P(gx, gy), r = d.createElementNS(SVGNS, 'rect');
        r.setAttribute('class', `size-handle${sizing?.handle === h ? ' on' : ''}`); r.dataset.handle = h;
        r.setAttribute('x', String(px - half)); r.setAttribute('y', String(py - half)); r.setAttribute('width', String(half * 2)); r.setAttribute('height', String(half * 2)); r.setAttribute('rx', String(half / 3));
        r.style.pointerEvents = 'all'; r.style.cursor = h.startsWith('corner') ? 'nwse-resize' : h === 'right' || h === 'left' ? 'ew-resize' : 'ns-resize';
        const t = d.createElementNS(SVGNS, 'title');
        t.textContent = `Drag to resize ${grp.label}${h.startsWith('corner') ? '' : h === 'right' || h === 'left' ? ' (its width)' : ' (its depth)'} · double click: fit to what it holds`;
        r.append(t); overlay.append(r);
      }
    }
    // (0.10.0) connecting: a handle on the one selected object, and while a connection is drawn, its line and its target
    const one = connectable();
    const from = linking?.from ?? one;
    const fb = from ? boxFor(fromPointer(from.path)) : undefined;
    if (fb && K.connect) {
      const k = scale(), hx = fb.x + fb.w + 10 / k, hy = fb.y + fb.h / 2;
      if (linking && linking.x !== undefined && linking.y !== undefined) {
        if (linking.over) draw(linking.over, 'hover');
        const l = d.createElementNS(SVGNS, 'line');
        l.setAttribute('class', `connect-line${linking.over ? ' ok' : ''}`);
        l.setAttribute('x1', String(hx)); l.setAttribute('y1', String(hy)); l.setAttribute('x2', String(linking.x)); l.setAttribute('y2', String(linking.y));
        overlay.append(l);
      }
      if (!linking) {
        const c = d.createElementNS(SVGNS, 'circle');
        c.setAttribute('class', 'connect-handle');
        c.setAttribute('cx', String(hx)); c.setAttribute('cy', String(hy)); c.setAttribute('r', String(7 / k));
        // the one mark that takes the pointer (through the CSSOM: a host's marks CSS may say none for the overlay)
        c.style.pointerEvents = 'all'; c.style.cursor = 'crosshair';
        const t = d.createElementNS(SVGNS, 'title');
        t.textContent = `Drag to what ${from!.name} connects to`;
        c.append(t);
        overlay.append(c);
      }
    }
    // (0.31.0) the move handle: a drag from it takes the one selected thing anywhere, into whatever is under the drop
    const mv = movable(), mb = mv && !linking && !pinDrag() ? boxFor(fromPointer(mv.path)) : undefined;
    if (mb) {
      const k = scale(), hx = mb.x - 10 / k, hy = mb.y + mb.h / 2, r = 7 / k;
      const m = d.createElementNS(SVGNS, 'polygon');
      m.setAttribute('class', 'move-handle');
      m.setAttribute('points', `${hx},${hy - r} ${hx + r},${hy} ${hx},${hy + r} ${hx - r},${hy}`);
      m.style.pointerEvents = 'all'; m.style.cursor = 'move';
      const t = d.createElementNS(SVGNS, 'title');
      t.textContent = `Drag ${mv!.name} anywhere: into what it is dropped on, or out (Esc cancels)`;
      m.append(t); overlay.append(m);
    }
    // a badge on each drawn resource with problems
    const counts = new Map<string, { e: number; w: number }>();
    for (const pr of opts.problems()) {
      if (pr.file) continue;
      const r = resourceOf(pr.path);
      if (!r) continue;
      const c = counts.get(r.path) ?? { e: 0, w: 0 };
      if (pr.severity === 'error') c.e++; else c.w++;
      counts.set(r.path, c);
    }
    for (const [ptr, c] of counts) {
      // on the thing itself (its nodes and regions), not on the routes that reach out from it
      const els = elementsFor(ptr).filter(e => cd!.scene.layout.byId.has(e.getAttribute('data-id') ?? ''));
      const b = union(els.map(boxOf));
      if (!b) continue;
      const g = d.createElementNS(SVGNS, 'g');
      g.setAttribute('class', `badge${c.e ? '' : ' warn'}`);
      const k = scale();
      const cx = b.x + b.w, cy = b.y, rr = 9 / k;
      const circle = d.createElementNS(SVGNS, 'circle');
      circle.setAttribute('cx', String(cx)); circle.setAttribute('cy', String(cy)); circle.setAttribute('r', String(rr));
      const t = d.createElementNS(SVGNS, 'text');
      t.setAttribute('x', String(cx)); t.setAttribute('y', String(cy));
      t.style.fontSize = `${(11 / k).toFixed(2)}px`;   // through the CSSOM (it must beat the drawing's badge rule)
      t.textContent = String(c.e || c.w);
      g.append(circle, t);
      overlay.append(g);
    }
    layer?.paint?.(d);
  }

  // ---------- pointer: select, marquee, pan, pin ----------
  let drag: {
    kind: 'pan' | 'marquee' | 'pin' | 'click'; x0: number; y0: number; v0?: View; emptyClick?: boolean;
    // a pin drag: where it started and what it is shown at, its size and floor, its parent and siblings, the move so far
    start?: [number, number]; shown?: [number, number]; z0?: number; size?: [number, number];
    parent?: { id: string; w: number; d: number; pad: number; box: { x0: number; y0: number; x1: number; y1: number }; label: string;
      /** (0.28.0) a group that fits what it holds: the sides it grows on, how far the thing has been (snapMove), and its box when the drag began */
      grow?: { right?: boolean; front?: boolean; left?: boolean; back?: boolean; reach?: [number, number]; reachLo?: [number, number] }; box0?: { x0: number; y0: number; x1: number; y1: number };
      /** (0.29.0) the group's own pin (its name, and where it stands in its parent): what growing left or back moves */
      pin?: { name: string; at: [number, number] } };
    /** (0.29.0) growing left or back: the shift (in cells) of the trial drawn and of the one being made, and the pins the drop writes */
    shiftShown?: [number, number]; shiftNext?: [number, number]; pinSet?: [string, [number, number]][]; pinFix?: Map<string, [number, number]>;
    /** (0.14.0) how far the view was moved to keep the container still on screen (a trial may lay it out elsewhere) */
    shifted?: [number, number];
    move?: Move; invalid?: boolean; step?: number; origCd?: D; gridShown?: boolean;
    /** what stands beside it in its container, where it stood when the drag began */
    beside?: Beside[];
    /** (0.14.0) what gave way to it, by how many cells; what would, while the drop waits; the last cell it could drop on */
    given?: Map<string, [number, number]>; way?: Map<string, [number, number]>; clearAt?: [number, number];
    /** (0.14.0) a new thing, from the palette (origCd: the drawing without it): the drawing with it, and what it is made as */
    fresh?: { base: D; name: string; path: Path; plan: FreshPlan; text: string; copy?: boolean; free?: Free };
    /** (0.31.0) ⌥ at the press: what a drag copies (the copy is dragged as a new thing, from where the original stands) */
    copyOf?: Path;
    /** (0.31.0) a press on the move handle: the thing goes wherever it is dropped, into what is under it (moveInto) */
    freeOf?: ObjectRef;
    /** siblings that flow after the dragged item, pinned where they stand so the drag doesn't push them */
    keep?: [string, [number, number]][]; sel0?: Path[]; add?: boolean; touch?: boolean; name?: string; label?: string; why?: string; id?: string; box?: { x: number; y: number; w: number; h: number }; moved?: boolean; ptr?: string; narrow?: string; line?: [number, number]; lineAt?: [number, number] } | undefined;
  let spaceKeyDown = false;
  const ifEvents = () => {
    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', e => { if (pinDrag()) void endPin(false); else up(e); });
    stage.addEventListener('wheel', wheel, { passive: false });
    stage.addEventListener('contextmenu', context);
    stage.addEventListener('dblclick', e => {
      // (0.12.5) what is under the pointer: the presses were captured, so a real double click's target is the stage
      const t = e.target === stage ? fdoc().elementFromPoint(e.clientX, e.clientY) : e.target;
      // (0.28.0) on a resize handle: back to fitting what it holds
      if ((t as Element | null)?.closest?.('.size-handle')) { const g = sizableGroup(); if (g?.size) run(doc, sizeCmd(g, undefined, `Fit ${g.label} to what it holds`), 'canvas', opts.note); return; }
      // (0.14.1) to rename: the thing drawn there (not a connection near it); what has no name, nothing
      if (ui.doubleClick === 'rename') { const p = pathAtEvent(t), r = p === undefined ? p : resourceOf(p); if (r && doc.doc.ok) rename(fromPointer(r.path)); return; }
      const p = pathAt(t, e.clientX, e.clientY);
      if (p !== undefined) opts.showInText(fromPointer(p));
    });
  };
  // in the page, a pointer's coordinates are already the page's
  const pageXY = (e: PointerEvent | MouseEvent) => ({ x: e.clientX, y: e.clientY });
  /** a drag keeps its pointer's events when the pointer leaves the stage (a synthetic pointer can't be captured) */
  const capture = (e: PointerEvent) => { try { stage.setPointerCapture(e.pointerId); } catch { /* not a real pointer */ } };

  function down(e: PointerEvent) {
    stage.focus({ preventScroll: true });
    if (layer?.down?.(e)) return;
    const { x, y } = pageXY(e);
    // (0.10.0) a press on the connect handle starts a connection; a click while one is picked ends it
    if (e.button === 0 && linking?.pick) { e.preventDefault(); endConnect(pathAtEvent(e.target)); return; }
    // (0.28.0) a press on a resize handle starts a resize (Esc cancels it, as a drag)
    const hd = e.button === 0 ? (e.target as Element | null)?.closest?.('.size-handle') as SVGElement | null : null, grp = hd ? sizableGroup() : undefined;
    if (hd && grp) {
      capture(e); e.preventDefault();
      const size0: [number, number] = [grp.box.x1 - grp.box.x0, grp.box.y1 - grp.box.y0];
      const h = hd.dataset.handle!, sides = HANDLES.find(([n]) => n === h)![1];
      sizing = { path: grp.path, at: grp.at, label: grp.label, handle: h, sides, x0: x, y0: y, size0, min: grp.min(sides, dragStep(e)), size: size0, held: false, shift: [0, 0], floor: { x0: grp.box.x0, y0: grp.box.y0, z: grp.z } };
      paintOverlay();
      return;
    }
    if (e.button === 0 && (e.target as Element | null)?.closest?.('.connect-handle')) {
      const one = connectable();
      if (one) { capture(e); e.preventDefault(); const p = toSvg(x, y); linking = { from: one, x: p.x, y: p.y }; paintOverlay(); return; }
    }
    if (e.button === 0 || e.button === 1) capture(e);
    // (0.31.0) a press on the move handle: a drag of the selected thing that, once it moves, goes anywhere (dragFresh)
    const free = e.button === 0 && (e.target as Element | null)?.closest?.('.move-handle') ? movable() : undefined;
    const pan = () => { drag = { kind: 'pan', x0: x, y0: y, v0: { ...V.view! } }; svg?.classList.add('panning'); e.preventDefault(); };
    if (e.button === 1 || spaceKeyDown) { pan(); return; }
    if (e.button !== 0) return;
    const ptr = free ? free.path : pathAt(e.target, x, y);
    if (ptr === undefined) {
      // nothing under the pointer: Pan mode pans (⇧ or ⌘ draws a selection instead); Select mode draws a selection (the space key pans)
      const mod = e.shiftKey || e.metaKey || e.ctrlKey;
      if (nav.drag === 'pan' && !mod) { drag = { kind: 'pan', x0: x, y0: y, v0: { ...V.view! }, emptyClick: true }; svg?.classList.add('panning'); return; }
      const add = nav.drag === 'select' && mod;
      drag = { kind: 'marquee', x0: x, y0: y, sel0: add ? doc.selection : [], add, touch: e.altKey };
      return;
    }
    const p = fromPointer(ptr);
    const sel = doc.selection.map(toPointer);
    if (!free && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      doc.select(sel.includes(ptr) ? doc.selection.filter(q => toPointer(q) !== ptr) : [...doc.selection, p], 'canvas');
      return;
    }
    if (!sel.includes(ptr)) doc.select([p], 'canvas');
    // a plain click on one of several selected things selects just it, once the button comes up without a drag
    const narrow = sel.includes(ptr) && sel.length > 1 ? ptr : undefined;
    const at = ptr === pathAtEvent(e.target) ? idAtEvent(e.target) : undefined;
    drag = { kind: 'click', x0: x, y0: y, ptr: narrow, why: at === undefined ? undefined : cd?.fixed?.get(at) };
    if (drag.why && mode === '3d') return;
    // a press on a resource that can be pinned: a drag pins it
    const r = resourceOf(ptr);
    // (0.20.0) a part with no object of its own: its pin has a name too
    const part = mode === '3d' && ptr === pathAtEvent(e.target) ? partAtEvent(e.target) : undefined;
    const name = part?.pin ?? (r && r.path === ptr ? r.name : undefined);
    const id = name && mode === '3d' && cd ? pinIds(cd).get(name) : undefined;
    if (id && cd) {
      const item = cd.scene.layout.byId.get(id);
      const start = localAt(cd.scene, id);
      if (item && start) {
        const b = item.box, par = item.parent;
        drag = {
          kind: 'pin', x0: x, y0: y, name, label: part?.label, id, ptr, narrow, start, shown: start, z0: b.z0, size: [b.x1 - b.x0, b.y1 - b.y0], beside: besideOf(cd, id),
          parent: par ? { id: par.id, w: par.box.x1 - par.box.x0, d: par.box.y1 - par.box.y0, pad: paddingOf(K.catalog, par.region), box: par.box, label: par.region?.label ?? par.id, ...growOf(par.region, par.box, groupPin(cd, par.id)) } : undefined,
          origCd: cd,
          // (0.31.0) ⌥ at the press, on a thing of the file's own (not a part): the drag drags a copy of it
          ...(free ? { freeOf: free } : e.altKey && K.commands.duplicateCmd && !part && r && r.path === ptr ? { copyOf: p } : {}),
        };
      }
    }
  }
  function move(e: PointerEvent) {
    const { x, y } = pageXY(e);
    if (sizing) {
      const k = scale(), step = dragStep(e);
      const m = resizeSides(sizing.size0, screenToGrid((x - sizing.x0) / k, (y - sizing.y0) / k), sizing.sides, step, sizing.min);
      sizing = { ...sizing, size: m.size, held: m.held, shift: m.shift };
      opts.onHint?.(`Resizing ${sizing.label} to ${m.size[0]} × ${m.size[1]} · ${step === 1 ? 'whole cells (Ctrl: half cells)' : 'half cells'}${m.held ? ` · it holds what it holds: no smaller` : ''} · Esc cancels`);
      paintOverlay();
      return;
    }
    if (linking) {
      const p = toSvg(x, y), under = pathAtEvent(document.elementFromPoint(x, y));
      const r = under === undefined ? undefined : resourceOf(under);
      linking = { ...linking, x: p.x, y: p.y, over: r && r.path !== linking.from.path ? r.path : undefined };
      paintOverlay();
      return;
    }
    if (!drag) {
      const p = pathAt(e.target, x, y);
      if (p !== hoverId) { hoverId = p; paintOverlay(); }
      return;
    }
    const k = scale();
    if (drag.kind === 'click' && mode === '2d' && !drag.moved && Math.hypot(x - drag.x0, y - drag.y0) > 4) {
      drag.moved = true;
      opts.onHint?.('Moving is in 3D: switch to 3D to drag it where it goes');
      return;
    }
    // (0.20.0) what can't be moved says so, for as long as it is dragged
    if (drag.kind === 'click' && mode === '3d' && !drag.moved && Math.hypot(x - drag.x0, y - drag.y0) > 4) {
      drag.moved = true;
      svg?.classList.add('cant-move');
      opts.onHint?.(drag.why ?? T.cantMove);
      return;
    }
    if (drag.kind === 'pan') {
      if (Math.hypot(x - drag.x0, y - drag.y0) > 3) drag.emptyClick = false;
      V.view = { ...drag.v0!, x: drag.v0!.x - (x - drag.x0) / k, y: drag.v0!.y - (y - drag.y0) / k };
      applyView();
    } else if (drag.kind === 'marquee') {
      // the marquee is a rectangle on the floor (grid units), drawn as the parallelogram it projects to
      if (Math.hypot(x - drag.x0, y - drag.y0) < 3) return;
      drag.moved = true;
      const a = toSvg(drag.x0, drag.y0), b = toSvg(x, y);
      if (flat) { marquee2d(a, b); return; }
      const [ax, ay] = screenToGrid(a.x, a.y), [bx, by] = screenToGrid(b.x, b.y);
      const g = { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
      const hits = new Map<string, Path>();
      for (const [ptr, foot] of footprints()) {
        // a thing at height z shows where a thing on the floor at (x − z, y − z) would: compare it there
        const f = foot;
        const inside = f.x0 >= g.x0 && f.y0 >= g.y0 && f.x1 <= g.x1 && f.y1 <= g.y1;
        const touches = f.x0 < g.x1 && f.x1 > g.x0 && f.y0 < g.y1 && f.y1 > g.y0;
        if (drag.touch ? touches : inside) hits.set(ptr, fromPointer(ptr));
      }
      const base = new Map((drag.sel0 ?? []).map(p => [toPointer(p), p]));
      for (const [k2, p] of hits) base.set(k2, p);
      doc.select([...base.values()], 'canvas');
      paintOverlay();
      const poly = fdoc().createElementNS(SVGNS, 'polygon');
      poly.setAttribute('class', 'marquee');
      poly.setAttribute('points', [[g.x0, g.y0], [g.x1, g.y0], [g.x1, g.y1], [g.x0, g.y1]].map(([gx, gy]) => iso(gx, gy, 0).map(v => v.toFixed(1)).join(',')).join(' '));
      overlay!.append(poly);
      lastMarquee = g;
    } else if (drag.kind === 'pin') {
      if (!drag.moved && Math.hypot(x - drag.x0, y - drag.y0) < 4) return;
      if (drag.copyOf && !drag.moved) {
        // (0.31.0) ⌥: the copy, made in a trial where the original stands, is what moves; the original stays
        const c = drag.copyOf, d0 = drag;
        drag = undefined;
        if (!dragFresh('', undefined, { x, y, half: e.ctrlKey, straight: e.shiftKey }, { path: c, start: d0.start!, x0: d0.x0, y0: d0.y0 })) { drag = { ...d0, copyOf: undefined }; opts.note(`${describe(c)} can't be copied by dragging here`, 'warn'); }
        return;
      }
      // (0.31.0) the move handle: the thing, in a trial where it is in what is under the pointer, at each move
      const d0 = drag, fo = d0.fresh?.free ?? (d0.freeOf && { ref: d0.freeOf, path: fromPointer(d0.freeOf.path), start: d0.start!, x0: d0.x0, y0: d0.y0 });
      if (fo) {
        if (d0.freeOf) drag = undefined;
        if (!dragFresh('', undefined, { x, y, half: e.ctrlKey, straight: e.shiftKey }, undefined, fo) && d0.freeOf) { drag = { ...d0, freeOf: undefined }; opts.note(`${fo.ref.name} can't be moved by dragging here`, 'warn'); }
        return;
      }
      drag.moved = true;
      lastPin = { x, y, half: e.ctrlKey, straight: e.shiftKey };
      // throttled to animation frames (with a timer for a page that draws none)
      if (!pinFrame) { pinFrame = true; const go = () => { if (pinFrame) { pinFrame = false; pinStep(); } }; requestAnimationFrame(go); setTimeout(go, 32); }
    }
  }
  /** the marquee in 2D: a rectangle, what lies in it (or touches it, with ⌥) */
  function marquee2d(a: { x: number; y: number }, b: { x: number; y: number }) {
    if (!drag || !flat || !cd) return;
    const g = { l: Math.min(a.x, b.x), t: Math.min(a.y, b.y), r: Math.max(a.x, b.x), b: Math.max(a.y, b.y) };
    const hits = new Map<string, Path>();
    for (const id of flat.hits(g, !!drag.touch)) {
      const ptr = cd.pathOf.get(id);
      if (ptr !== undefined && resourceOf(ptr)?.path === ptr) hits.set(ptr, fromPointer(ptr));
    }
    const base = new Map((drag.sel0 ?? []).map(p => [toPointer(p), p]));
    for (const [k2, p] of hits) base.set(k2, p);
    doc.select([...base.values()], 'canvas');
    paintOverlay();
    const r = fdoc().createElementNS(SVGNS, 'rect');
    r.setAttribute('class', 'marquee');
    r.setAttribute('x', String(g.l)); r.setAttribute('y', String(g.t)); r.setAttribute('width', String(g.r - g.l)); r.setAttribute('height', String(g.b - g.t));
    overlay!.append(r);
  }
  /** (0.28.0) the thing dragged is past the edge its group had when the drag began (its inner edge: less its margin), on a side that
   *  grows: only then has the group grown with it (a re-layout alone, a pin in a flow, may make the group a little bigger: not that) */
  const grownBy = (g: NonNullable<typeof drag>, foot: { x0: number; y0: number; x1: number; y1: number }) => {
    const p = g.parent, b0 = p?.box0;
    return !!(p?.grow && b0 && ((p.grow.right && foot.x1 > b0.x1 - p.pad + 1e-6) || (p.grow.front && foot.y1 > b0.y1 - p.pad + 1e-6)
      || (p.grow.left && foot.x0 < b0.x0 + p.pad - 1e-6) || (p.grow.back && foot.y0 < b0.y0 + p.pad - 1e-6)));
  };
  /** (0.28.0) a container that fits what it holds (no size of its own) grows on GROW_SIDES; one with a size is held at its edges */
  const growOf = (r: { size?: unknown } | undefined, box: { x0: number; y0: number; x1: number; y1: number }, pin?: { name: string; at: [number, number] }) => {
    // (0.29.0) left and back only for a group that can be pinned: growing that way moves it (pinned where it stands, less the shift)
    const left = GROW_SIDES.left && !!pin, back = GROW_SIDES.back && !!pin;
    return r && !r.size && (GROW_SIDES.right || GROW_SIDES.front || left || back) ? { grow: { right: GROW_SIDES.right, front: GROW_SIDES.front, left, back }, box0: { ...box }, ...(pin ? { pin } : {}) } : {};
  };
  /** (0.29.0) a group's own pin: its name, and where it stands in its parent's frame (undefined: it can't be pinned) */
  const groupPin = (d: D, id: string): { name: string; at: [number, number] } | undefined => {
    const name = [...pinIds(d)].find(([, i]) => i === id)?.[0], at = localAt(d.scene, id);
    return name && at ? { name, at } : undefined;
  };
  // (0.31.0) the owner's keys during a drag: Ctrl half cells (⌥ before), ⇧ on one of eight lines from where it started
  let pinFrame = false, lastPin: { x: number; y: number; half: boolean; straight: boolean } | undefined, relayout = 0;
  const pinDrag = () => (drag?.kind === 'pin' && drag.moved ? drag : undefined);
  /** every pin's name, and the id of the element it moves */
  const pinIds = (d: D): Map<string, string> => (d.partId?.size ? new Map([...d.pinId, ...d.partId]) : d.pinId);
  /** what stands beside a drawn thing, in its container (or on the canvas), and whether each can be pinned elsewhere */
  function besideOf(d: D, id: string, inside = d.scene.layout.byId.get(id)?.parent): Beside[] {
    const pinned = new Set(pinIds(d).values());
    return (inside ? inside.children : d.scene.layout.items.filter(i => !i.parent)).filter(i => i.id !== id)
      .map(i => ({ id: i.id, x0: i.box.x0, y0: i.box.y0, x1: i.box.x1, y1: i.box.y1, movable: pinned.has(i.id) && !!localAt(d.scene, i.id) }));
  }
  /** where those are now: where they stood, or where they gave way to */
  const besideNow = (g: NonNullable<typeof drag>) => g.beside!.map(b => { const [dx, dy] = g.given?.get(b.id) ?? [0, 0]; return { ...b, x0: b.x0 + dx, x1: b.x1 + dx, y0: b.y0 + dy, y1: b.y1 + dy }; });
  const footAt = (g: NonNullable<typeof drag>, [x, y]: [number, number]) => { const sh = g.shiftShown ?? [0, 0], ox = g.parent ? g.parent.box.x0 + sh[0] : 0, oy = g.parent ? g.parent.box.y0 + sh[1] : 0; return { x0: ox + x, y0: oy + y, x1: ox + x + g.size![0], y1: oy + y + g.size![1] }; };
  const motionOn = () => ui.dragMotion !== 'respect' || !matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** one step of a pin drag: snap, clamp, check, move the drawing, and lay it out again when the cell changes */
  function pinStep() {
    const g = pinDrag();
    if (!g || !lastPin || !cd) return;
    const k = scale();
    const step = lastPin.half ? 0.5 : 1;
    g.step = step;
    // (a copy is held where it was pressed, as the original would be)
    const p = g.fresh && !g.fresh.copy ? toSvg(lastPin.x, lastPin.y) : undefined;
    // a new thing is held by its floor's middle
    const f0 = footAt(g, g.start!), grip = iso((f0.x0 + f0.x1) / 2, (f0.y0 + f0.y1) / 2, g.z0!);
    const d0 = p ? screenToGrid(p.x - grip[0], p.y - grip[1]) : screenToGrid((lastPin.x - g.x0) / k, (lastPin.y - g.y0) / k);
    const cm = lastPin.straight ? constrainMove(d0) : undefined;
    g.line = cm?.line;
    // (0.32.0) ⇧: from where it stands on the grid (a start the layout put between cells, rounded), by whole steps along the line, so
    // every place it takes is on the line, and the dotted line is drawn through that same start
    const s0 = cm ? snapMove(g.start!, [0, 0], step, g.size!, g.parent).at : g.start!, [ux, uy] = cm?.line ?? [1, 0];
    const t = cm ? Math.round((ux ? cm.d[0] / ux : cm.d[1] / uy) / step) * step : 0, d = cm ? [ux * t, uy * t] as [number, number] : d0;
    g.lineAt = cm ? s0 : undefined;
    const m = snapMove(s0, d, step, g.size!, g.parent);
    if (g.parent?.grow) { const r = g.parent.grow.reach, l = g.parent.grow.reachLo; g.parent.grow.reach = [Math.max(r?.[0] ?? m.at[0], m.at[0]), Math.max(r?.[1] ?? m.at[1], m.at[1])]; g.parent.grow.reachLo = [Math.min(l?.[0] ?? m.at[0], m.at[0]), Math.min(l?.[1] ?? m.at[1], m.at[1])]; }
    const foot = footAt(g, m.at);
    const changed = !g.move || g.move.at[0] !== m.at[0] || g.move.at[1] !== m.at[1];
    g.move = m;
    g.invalid = overlaps(foot, besideNow(g));
    if (changed) dwell(g);
    if (!g.invalid) g.clearAt = m.at;
    svg?.classList.add('dragging');
    svg?.classList.toggle('drag-bad', g.invalid);
    // at once: the drawn item (and what stands on it) moved by transform, from where the drawing has it
    shiftDragged(g.id!, [m.at[0] - g.shown![0], m.at[1] - g.shown![1]]);
    paintDrag(foot);
    sayDrag(g);
    // then the real layout, with its routes and labels, once per cell (and only where it may drop)
    if (changed && !g.invalid) relayoutSoon(g);
  }
  function sayDrag(g: NonNullable<typeof drag>) {
    // (0.28.0) held at a group's edge that has a size of its own; or grown past where it was: said of the group, once
    const c = g.move?.clamped, grew = !!g.move && grownBy(g, footAt(g, g.move.at));
    const of = g.parent && !g.parent.grow && c && (c.left || c.right || c.top || c.bottom) ? ', which has a fixed size: resize it to fit more' : grew ? ', which grows with it' : '';
    const within = g.parent ? `${g.fresh ? 'in' : 'within'} ${g.parent.label}${of}` : 'on the canvas';
    const n = g.given?.size ?? 0;
    opts.onHint?.(`${g.fresh ? 'Adding' : 'Moving'} ${g.label ?? g.name} ${within} · ${g.step === 1 ? 'whole cells (Ctrl: half cells · ⇧: in a straight line)' : 'half cells'}${g.line ? ' · in a straight line' : ''} · ${g.invalid ? (g.way ? 'hold still: it makes way' : g.fresh ? 'taken: the layout places it' : 'overlaps: it won\'t drop here') : n ? `${n} made way · Esc cancels` : 'Esc cancels'}${T.pinHint}`);
  }
  /** (0.31.0) for a test: how long a trial's layout waits after the pointer stops (a slow machine's, made certain) */
  let trialDelay = 0;
  function relayoutSoon(g: NonNullable<typeof drag>, glide = false) {
    if (!g.fresh && !lastS3) return;
    clearTimeout(relayout);
    const go = () => {
      const now = pinDrag();
      if (!now || now !== g || now.invalid || !now.move) return;
      let next: D;
      try { ({ next, keep: now.keep } = trialLayout(now)); } catch { return; }
      showTrial(now, next, now.move.at, glide);
    };
    if (glide) go(); else relayout = window.setTimeout(go, trialDelay);
  }
  /** a trial drawing on the stage, the dragged thing at `at` in it; what moved since the last one glides there, if asked */
  function showTrial(g: NonNullable<typeof drag>, next: D, at: [number, number], glide: boolean) {
    const was = cd!;
    stillOn(g, next);
    void draw(next);
    if (pinDrag() !== g) return;
    g.shown = at;
    shiftDragged(g.id!, [g.move!.at[0] - at[0], g.move!.at[1] - at[1]]);
    // (0.31.0) the trial may have moved the group (stillOn): the dashed floor and the words, both again, so they agree
    paintDrag(footAt(g, g.move!.at)); sayDrag(g);
    if (!glide || !motionOn()) return;
    const from = new Map<string, [number, number]>();
    for (const b of g.beside!) { const a = was.scene.layout.byId.get(b.id)?.box, z = next.scene.layout.byId.get(b.id)?.box; if (a && z && (Math.abs(a.x0 - z.x0) > 1e-6 || Math.abs(a.y0 - z.y0) > 1e-6)) from.set(b.id, [a.x0 - z.x0, a.y0 - z.y0]); }
    glideFrom(from);
  }
  /** a trial lays the container out at another place (it fits what it holds): the view moved with it, so it stands still on
   *  screen, and what the drag knows of the container with it */
  function stillOn(g: NonNullable<typeof drag>, next: D) {
    const now = g.parent && next.scene.layout.byId.get(g.parent.id)?.box;
    if (!g.parent || !now || !V.view) return;
    // (0.29.0) growing left or back moves the group by the shift on purpose: only the rest is drift, which the view takes up so the
    // container stands still on screen, its other contents where they were
    const prev = g.shiftShown ?? [0, 0], nxt = g.shiftNext ?? prev, ds = [nxt[0] - prev[0], nxt[1] - prev[1]];
    const was = g.parent.box, dx = now.x0 - was.x0 + ds[0], dy = now.y0 - was.y0 + ds[1], bx = dx, by = dy;
    const b0 = g.parent.box0;
    g.shiftShown = nxt;
    g.parent = { ...g.parent, box: now, w: Math.max(g.parent.w, now.x1 - now.x0), d: Math.max(g.parent.d, now.y1 - now.y0), ...(b0 ? { box0: { x0: b0.x0 + dx, y0: b0.y0 + dy, x1: b0.x1 + dx, y1: b0.y1 + dy } } : {}) };
    if (Math.abs(bx) > 1e-9 || Math.abs(by) > 1e-9) g.beside = g.beside!.map(b => ({ ...b, x0: b.x0 + bx, x1: b.x1 + bx, y0: b.y0 + by, y1: b.y1 + by }));
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;
    shiftView(g, (dx - dy) * C * S, (dx + dy) * 0.5 * S);
  }
  function shiftView(g: NonNullable<typeof drag>, x: number, y: number) {
    if (!V.view) return;
    V.view = { ...V.view, x: V.view.x + x, y: V.view.y + y };
    g.shifted = [(g.shifted?.[0] ?? 0) + x, (g.shifted?.[1] ?? 0) + y];
  }
  /** the view as it would be without that (the drag put back) */
  function unshift(g: NonNullable<typeof drag>) { if (g.shifted) { shiftView(g, -g.shifted[0], -g.shifted[1]); g.shifted = undefined; } }
  // ---------- (0.14.0) making way: a drop that waits on a taken cell (make-way.ts has the numbers and the arithmetic) ----------
  let hintTimer = 0, giveTimer = 0, backTimer = 0, wayFrame = 0, jiggling: string[] = [];
  /** the jiggle and the glide, off; what they moved, back where the drawing has it */
  function stillWay() {
    cancelAnimationFrame(wayFrame); wayFrame = 0;
    for (const id of jiggling) shiftDragged(id, [0, 0]);
    jiggling = [];
  }
  function restart() { clearTimeout(hintTimer); clearTimeout(giveTimer); stillWay(); }
  function endWay() { clearTimeout(backTimer); backTimer = 0; restart(); }
  /** does what gave way still have to, with the dragged thing here */
  const needed = (g: NonNullable<typeof drag>, foot: Beside | { x0: number; y0: number; x1: number; y1: number }) => g.beside!.some(b => g.given?.has(b.id) && hits(b, foot));
  /** the dragged thing is on another cell: the clock starts again; what gave way and is no longer needed goes back */
  function dwell(g: NonNullable<typeof drag>) {
    restart();
    g.way = undefined;
    const foot = footAt(g, g.move!.at);
    // what gave way: kept while this cell needs it, else back after a moment (so a wobble doesn't flicker)
    if (!g.given?.size || needed(g, foot)) { clearTimeout(backTimer); backTimer = 0; }
    else if (!backTimer) backTimer = window.setTimeout(() => { backTimer = 0; if (pinDrag() === g) putBack(g); }, BACK_AFTER);
    if (!g.invalid || !g.beside!.some(b => hits(b, foot))) return;
    hintTimer = window.setTimeout(() => {
      if (pinDrag() !== g) return;
      const from = g.clearAt ?? g.start!, par = g.parent, pad = par?.pad ?? 0;
      const way = makeWay({
        foot, others: g.beside!, going: [g.move!.at[0] - from[0], g.move!.at[1] - from[1]],
        bounds: par ? { x0: par.box.x0 + pad, y0: par.box.y0 + pad, x1: par.box.x1 - pad, y1: par.box.y1 - pad } : undefined,
      });
      if (!way?.size) return;
      g.way = way;
      paintDrag(foot); sayDrag(g); jiggle(g);
      giveTimer = window.setTimeout(() => { if (pinDrag() === g && g.way === way) give(g, way); }, DWELL_GIVE - DWELL_HINT);
    }, DWELL_HINT);
  }
  function give(g: NonNullable<typeof drag>, way: Map<string, [number, number]>) {
    stillWay();
    g.given = way; g.way = undefined; g.invalid = false; g.clearAt = g.move!.at;
    relayoutSoon(g, true);
    sayDrag(g);
  }
  function putBack(g: NonNullable<typeof drag>) {
    stillWay();
    g.given = undefined;
    g.invalid = overlaps(footAt(g, g.move!.at), besideNow(g));
    sayDrag(g);
    if (!g.invalid) { relayoutSoon(g, true); return; }
    // over something else: as the drag began, the dragged thing shown where it is held
    showTrial(g, g.fresh?.base ?? g.origCd!, g.start!, true);
    dwell(g);
  }
  function jiggle(g: NonNullable<typeof drag>) {
    if (!motionOn()) return;
    const t0 = performance.now(), ids = [...g.way!.keys()];
    jiggling = ids;
    const frame = (now: number) => {
      if (pinDrag() !== g || !g.way) return;
      const t = now - t0, a = (JIGGLE.px * Math.min(1, 0.25 + 0.75 * t / (DWELL_GIVE - DWELL_HINT))) / scale();
      ids.forEach((id, i) => shiftScreen(id, a * Math.sin((t / 1000) * JIGGLE.hz * 2 * Math.PI + i * 1.7)));
      wayFrame = requestAnimationFrame(frame);
    };
    wayFrame = requestAnimationFrame(frame);
  }
  function glideFrom(from: Map<string, [number, number]>) {
    if (!from.size) return;
    const t0 = performance.now(), on = svg;
    jiggling = [...from.keys()];
    const frame = (now: number) => {
      if (svg !== on) { jiggling = []; return; }
      const f = Math.min(1, Math.max(0, (now - t0) / GLIDE)), left = Math.pow(1 - f, 3);
      for (const [id, [dx, dy]] of from) shiftDragged(id, [dx * left, dy * left]);
      if (f < 1) wayFrame = requestAnimationFrame(frame); else jiggling = [];
    };
    frame(t0);
  }
  /**
   * The drawing with the dragged item pinned at its move. Siblings placed after it (in the flow, or beside it) would move
   * with it; any that did, and can be pinned, are kept where they stood, and the drop pins them too.
   */
  function trialLayout(g: NonNullable<typeof drag>, at = g.move!.at): { next: D; keep: [string, [number, number]][] } {
    const orig = g.origCd!, nameOf = new Map([...pinIds(orig)].map(([n, id]) => [id, n]));
    // what gave way, where it gave way to (a pin each)
    const gave: [string, [number, number]][] = [];
    for (const [id, [dx, dy]] of g.given ?? []) { const was = localAt(orig.scene, id)!; gave.push([nameOf.get(id)!, [was[0] + dx, was[1] + dy]]); }
    // (0.29.0) past the left or back margin of a group that grows that way: the pins that make it (growLeftBack)
    const p = g.parent, lo = p ? Math.ceil(p.pad / (g.step ?? 1) - 1e-9) * (g.step ?? 1) : 0;
    const lb = p?.grow && (p.grow.left || p.grow.back) ? growLeftBack({ name: g.name!, at: [p.grow.left ? at[0] : Math.max(at[0], lo), p.grow.back ? at[1] : Math.max(at[1], lo)], lo, pad: p.pad, step: g.step ?? 1, group: p.pin,
      others: g.beside!.flatMap(b => { const n = nameOf.get(b.id), w = localAt(orig.scene, b.id); return n && w && n !== p.pin?.name ? [{ name: n, at: w }] : []; }) }) : undefined;
    g.shiftNext = lb?.shift ?? [0, 0]; g.pinSet = lb?.pins;
    const set: [string, [number, number]][] = [...(lb?.pins ?? [[g.name!, at]]), ...gave];
    const lay = layWith(g);
    let next = lay(set);
    const have = new Set([...Object.keys(K.pins.of(lastData) ?? {}), ...set.map(([n]) => n)]);
    const keep: [string, [number, number]][] = [];
    // (0.30.0, the owner's "nothing else jumps") not only what stands beside it: anything the drop would move in its own container
    // (a group it grows, pushing what stands beside the group, or a compact grid re-tidying) is kept where it stood, outermost first
    // (one that is kept carries what is in it), until nothing else moves
    // the containers it is in (as drawn now, or as the trial has it) are not "else": they grow with it, and the view keeps them still
    for (let q = next.scene.layout.byId.get(g.id!)?.parent; q; q = q.parent) have.add(nameOf.get(q.id)!);
    const moved = (d: D) => [...nameOf].filter(([id, n]) => {
      if (have.has(n)) return false;
      const was = localAt(orig.scene, id), now = localAt(d.scene, id);
      return !!was && !!now && Math.hypot(now[0] - was[0], now[1] - was[1]) > 1e-6;
    });
    // (0.30.0) a pin is where a thing is laid out from, which needn't be where it then stands (a container that shifts what it holds
    // to fit it, a box rounded to the grid): each pin corrected (settlePins) until its thing stands where it is meant to; then what
    // those pins moved in turn is kept too, and all corrected again (the drop writes the corrected ones, g.pinFix)
    const fix = new Map<string, [number, number]>();
    const standAt = (d: D, n: string) => { const id = pinIds(d).get(n); return id ? localAt(d.scene, id) : undefined; };
    for (let round = 0; round < 5; round++) {
      const st = settlePins([...set, ...keep], lay, standAt, round ? undefined : next);
      next = st.drawn;
      for (const [n, c] of st.pins) fix.set(n, c);
      // what moved, kept (the drop then keeps only those it needs: prunePins); a new thing from the palette: the layout gives it a
      // place, others shifting along, as before (the owner's answer, 28 Nov)
      const more = moved(next);
      if (!more.length || g.fresh) break;
      for (const [id, n] of more) keep.push([n, localAt(orig.scene, id)!]), have.add(n);
    }
    g.pinFix = fix;
    return { next, keep: [...gave, ...keep].map(([n, a]) => [n, fix.get(n) ?? a]) };
  }
  /** the drawing with these pins: of the file's data, or (a new thing) of the text it would make */
  function layWith(g: NonNullable<typeof drag>): (pins: [string, [number, number]][]) => D {
    if (g.fresh) {
      const text = g.fresh.text;
      return list => { const t = K.trial(pinsCmd(list, '').build(text).steps.reduce((u, st) => applyStep(u, st), text), opts.theme); if (!t) throw new Error('not drawn'); return t; };
    }
    return list => {
      const base = JSON.parse(JSON.stringify(lastData ?? {})) as Record<string, Record<string, Record<string, unknown>>>;
      // pins kept under the legacy key are read there; the trial puts them where the drop will (x-editor)
      if (K.pins.legacyOnly(base)) { base[PINS_KEY] = base[K.pins.legacyKey!]; delete base[K.pins.legacyKey!]; }
      base[PINS_KEY] ??= {}; base[PINS_KEY].layout ??= {};
      for (const [n, at] of list) base[PINS_KEY].layout[n] = { at };
      return K.draw(lastS3!, base, opts.theme);
    };
  }
  /** move a drawn item, and everything standing on it, by a grid offset (a transform: the next layout replaces it) */
  function shiftDragged(id: string, [gx, gy]: [number, number]) {
    if (!svg || !cd) return;
    shiftBy(id, (gx - gy) * C * S, (gx + gy) * 0.5 * S);
  }
  /** the same, sideways on screen */
  const shiftScreen = (id: string, dx: number) => shiftBy(id, dx, 0);
  function shiftBy(id: string, sx: number, sy: number) {
    if (!svg || !cd) return;
    const ids = new Set([id]);
    for (const it of cd.scene.layout.items) { let p = it.parent; while (p) { if (p.id === id) { ids.add(it.id); break; } p = p.parent; } }
    for (const el of svg.querySelectorAll<SVGElement>('[data-id]')) {
      if (!ids.has(el.getAttribute('data-id') ?? '')) continue;
      if (el.parentElement?.closest(`[data-id="${CSS.escape(el.getAttribute('data-id')!)}"]`)) continue;
      el.setAttribute('transform', sx || sy ? `translate(${sx.toFixed(2)} ${sy.toFixed(2)})` : '');
    }
  }
  /** the drag's overlay: the grid on the parent's floor (half cells too, with Ctrl), (0.31.0) the ⇧ line, the drop target, the clamped edges */
  function paintDrag(foot: { x0: number; y0: number; x1: number; y1: number }) {
    const g = pinDrag();
    if (!g || !overlay) return;
    paintOverlay();
    const d = fdoc();
    const wrap = d.createElementNS(SVGNS, 'g');
    wrap.setAttribute('class', g.gridShown ? 'gridwrap' : 'gridwrap fresh');   // fades in once per drag, not per re-layout
    g.gridShown = true;
    const z = g.z0!;
    const P = (x: number, y: number) => iso(x, y, z).map(v => v.toFixed(1)).join(',');
    const area = g.parent ? g.parent.box : { x0: Math.floor(foot.x0) - 8, y0: Math.floor(foot.y0) - 8, x1: Math.ceil(foot.x1) + 8, y1: Math.ceil(foot.y1) + 8 };
    const line = (x1: number, y1: number, x2: number, y2: number, cls: string) => {
      const l = d.createElementNS(SVGNS, 'polyline');
      l.setAttribute('class', cls);
      l.setAttribute('points', `${P(x1, y1)} ${P(x2, y2)}`);
      wrap.append(l);
    };
    // the grid's lines, in the parent's frame: whole cells from its origin, and half cells while Ctrl is held
    const ox = g.parent ? g.parent.box.x0 : 0, oy = g.parent ? g.parent.box.y0 : 0;
    const st = g.step ?? 1;
    for (let v = Math.ceil((area.x0 - ox) / st) * st; ox + v <= area.x1 + 1e-9; v += st) line(ox + v, area.y0, ox + v, area.y1, Number.isInteger(v) ? 'dgrid' : 'dgrid sub');
    for (let v = Math.ceil((area.y0 - oy) / st) * st; oy + v <= area.y1 + 1e-9; v += st) line(area.x0, oy + v, area.x1, oy + v, Number.isInteger(v) ? 'dgrid' : 'dgrid sub');
    overlay.append(wrap);
    // (0.31.0) ⇧: the line the move is kept on, dotted, through where it started, across the floor it moves on
    if (g.line) {
      const f0 = footAt(g, g.lineAt ?? g.start!), cx = (f0.x0 + f0.x1) / 2, cy = (f0.y0 + f0.y1) / 2, [ux, uy] = g.line;
      const span = Math.max(area.x1 - area.x0, area.y1 - area.y0) + 4;
      const l = d.createElementNS(SVGNS, 'polyline');
      l.setAttribute('class', 'straight');
      l.setAttribute('points', `${P(cx - ux * span, cy - uy * span)} ${P(cx + ux * span, cy + uy * span)}`);
      overlay.append(l);
    }
    // the drop target: the footprint, accent where it may drop, red where it can't
    const poly = (b: { x0: number; y0: number; x1: number; y1: number }, cls: string) => {
      const t = d.createElementNS(SVGNS, 'polygon');
      t.setAttribute('class', cls);
      t.setAttribute('points', [P(b.x0, b.y0), P(b.x1, b.y0), P(b.x1, b.y1), P(b.x0, b.y1)].join(' '));
      overlay!.append(t);
      return t;
    };
    poly(foot, `drop${g.invalid ? ' bad' : ''}`);
    // (0.28.0) a group that grew with the drag: its floor as it was, dashed ("this much bigger if you drop here")
    if (grownBy(g, foot)) poly(g.parent!.box0!, 'grow-was');
    // what would make way, outlined where it would go
    for (const b of g.way ? besideNow({ ...g, given: g.way }) : []) {
      if (!g.way!.has(b.id)) continue;
      const w = poly(b, 'drop way');
      w.setAttribute('stroke-dasharray', '5 4');
      w.dataset.way = b.id;
    }
    // the parent's edges the move is held at
    if (g.parent && g.move) {
      const pb = g.parent.box, c = g.move.clamped, pad = g.parent.pad;
      const e = (x1: number, y1: number, x2: number, y2: number) => { const l = d.createElementNS(SVGNS, 'polyline'); l.setAttribute('class', 'edge'); l.setAttribute('points', `${P(x1, y1)} ${P(x2, y2)}`); overlay!.append(l); };
      if (c.left) e(pb.x0 + pad, pb.y0, pb.x0 + pad, pb.y1);
      if (c.right) e(pb.x1 - pad, pb.y0, pb.x1 - pad, pb.y1);
      if (c.top) e(pb.x0, pb.y0 + pad, pb.x1, pb.y0 + pad);
      if (c.bottom) e(pb.x0, pb.y1 - pad, pb.x1, pb.y1 - pad);
    }
  }
  /** end a pin drag: the drop commits one command; an overlap, a cancel or no move puts the drawing back */
  /** drops whose pin isn't written yet (the grid fading out first) */
  let dropping = 0;
  /** (0.22.0) palette entries being dragged out */
  let palDragging = 0;
  async function endPin(commit: boolean) {
    if (!pinDrag()) return;
    dropping++;
    try { await endDrop(commit); } finally { dropping--; opts.onBusy?.(); }
  }
  async function endDrop(commit: boolean) {
    const g = pinDrag();
    if (!g) return;
    drag = undefined;
    clearTimeout(relayout);
    endWay();
    // dropped where what gave way isn't needed, before it went back: it stays where it was
    let stale = false;
    if (commit && g.given?.size && g.move) {
      const foot = footAt(g, g.move.at);
      if (!needed(g, foot)) { g.given = undefined; g.invalid = overlaps(foot, besideNow(g)); stale = true; }
    }
    // the grid and the drop target fade out, then the drop
    const shown = overlay ? [...overlay.querySelectorAll('.gridwrap, .drop, .edge')] : [];
    if (shown.length) {
      for (const e of shown) e.classList.add('out');
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) await new Promise(r => setTimeout(r, 160));
    }
    lastKey = '';                                          // the frame may hold a trial layout: the next render redraws
    svg?.classList.remove('dragging', 'drag-bad');
    paintNav();
    const m = g.move;
    if (g.fresh) { await endFresh(g, commit, stale); return; }
    const moved = m && (m.at[0] !== g.start![0] || m.at[1] !== g.start![1]);
    if (commit && m && moved && !g.invalid) {
      // the item, and the neighbours the move would have pushed, kept where they stand: one command, one undo step
      let keep = g.keep ?? [];
      if (stale || !g.shown || g.shown[0] !== m.at[0] || g.shown[1] !== m.at[1]) try { keep = trialLayout(g).keep; } catch { /* drop it as it is */ }
      // (0.29.0) grown left or back: the trial's pins (the thing, its group, and with 'pins' the rest), with the thing's own as its words
      const pins = (g.pinSet ?? [[g.name!, m.at] as [string, [number, number]]]).map(([n, a]) => [n, g.pinFix?.get(n) ?? a] as [string, [number, number]]);
      // (0.30.0) only the kept pins the drawing needs: each tried without (one layout each, at the drop only)
      try { keep = prunePins(pins, keep, layWith(g), d => [...pinIds(d).values()].map(id => localAt(d.scene, id)) + ''); } catch { /* as it is */ }
      const label = `Pin ${g.label ?? describe(fromPointer(g.ptr!))} at [${pins[0][1].join(', ')}]${g.pinSet ? ` (${g.parent?.label} grows that way)` : ''}`;
      run(doc, keep.length || g.pinSet ? pinsCmd([...pins, ...keep], `${label}${wayWords(g, keep)}`) : withPinsMoved(setCmd([PINS_KEY, 'layout', g.name!], { at: pins[0][1] }, label)), 'canvas', opts.note);
      pendingAfterDrag = false;                            // the drop's own reading draws what came meanwhile too
      return;
    }
    if (commit && g.invalid) opts.note(`${g.label ?? g.name} can't go there: it would overlap`, 'warn');
    unshift(g);
    await draw(g.origCd!);
    redrawPending();
  }

  /** a reading that came during a drag that changed nothing: drawn now it is over */
  function redrawPending() { if (pendingAfterDrag) { pendingAfterDrag = false; lastKey = ''; setTimeout(() => { if (lastS3 && !pinDrag()) void render(lastS3, lastData); }, 0); } }
  /** what a drop's command says of the things it pins beside the dragged one */
  function wayWords(g: NonNullable<typeof drag>, keep: [string, [number, number]][]): string {
    const nameOf = new Map([...pinIds(g.origCd!)].map(([n, id]) => [id, n])), gave = new Set([...g.given?.keys() ?? []].map(id => nameOf.get(id)));
    const says = (n: string) => [...g.origCd!.parts?.values() ?? []].find(p => p.pin === n)?.label ?? n;
    const a = keep.filter(([n]) => gave.has(n)).map(([n]) => says(n)), b = keep.filter(([n]) => !gave.has(n)).map(([n]) => says(n));
    const words = [...(a.length ? [`${a.join(', ')} made way`] : []), ...(b.length ? [`${b.join(', ')} kept in place`] : [])].join('; ');
    return words && ` (${words})`;
  }
  // ---------- (0.14.0) a new thing dragged from the palette: the real one, in a trial drawing, by the drag above ----------
  /** what it would be made as at a point: the container (or the object that holds it) under the point, as the drawing
   *  was before it, so what it does to the drawing never changes the answer */
  function freshPlan(sec: string, item: PaletteItem | undefined, name: string, p: Path, at: { x: number; y: number } | undefined, home: D | undefined): FreshPlan {
    const k = kindOf(sec), preset = item?.value?.() as Record<string, unknown> | undefined;
    const what = item && preset !== undefined ? item.label.toLowerCase() : k.singular;
    const under = at && home ? outlinesAt(home, at) : [], drop = K.dropInto?.(sec);
    let value = (preset ?? k.template()) as Record<string, unknown>, into: string | undefined, words = '';
    const c = drop ? under.find(u => u.kind === drop.container) : undefined;
    if (drop && c) { into = c.name; value = { ...(drop.value(c.name) as Record<string, unknown>), ...(preset ?? {}) }; words = drop.label(c.name); }
    if (!into && K.dropOnto) for (const t of under) {
      const plan = K.dropOnto(t, value, sec, doc.goodDoc.data);
      if (plan) { into = t.name; value = plan.value as Record<string, unknown>; words = plan.label ? ` ${plan.label}` : ` in ${t.name}`; break; }
    }
    const label = `Add ${what} ${name}${words}`;
    return { into, label, add: insertCmd(p.slice(0, -1), name, value, { label }) };
  }
  /** (0.31.0) where a thing taken by its move handle goes at a point: into the innermost thing under it that takes it (the domain's
   *  moveInto; never itself or what it holds), else onto nothing; the keys of it that change. `into` is undefined where it stays */
  function freePlan(f: Free, at: { x: number; y: number }, home: D): FreshPlan {
    const v0 = f.path.reduce<any>((x, k) => x?.[k], doc.goodDoc.data) ?? {}, id = pinIds(home).get(f.ref.name), L = home.scene.layout.byId;
    const inIt = (r: ObjectRef) => { for (let it = L.get(pinIds(home).get(r.name) ?? ''); it; it = it.parent) if (it.id === id) return true; return false; };
    for (const t of [...outlinesAt(home, at).filter(r => r.path !== f.ref.path && !inIt(r)), undefined]) {
      const m = K.moveInto!(f.ref, v0, t, doc.goodDoc.data);
      if (!m) continue;
      const keys = [...new Set([...Object.keys(v0), ...Object.keys(m.value)])].filter(k => JSON.stringify(v0[k]) !== JSON.stringify(m.value[k]));
      const label = `Move ${describe(f.path)}${m.label ?? (t ? ` into ${t.name}` : '')}`;
      return { into: keys.length ? JSON.stringify(m.value) : undefined, label, add: seqCmd(label, keys.map(k => k in m.value ? setCmd([...f.path, k], m.value[k]) : deleteCmd([...f.path, k]))) };
    }
    return { label: `Move ${describe(f.path)}`, add: seqCmd('', []) };
  }
  /** the objects whose outline a point of the drawing is in, innermost first */
  function outlinesAt(d: D, q: { x: number; y: number }): ObjectRef[] {
    // 2D: the panels under it
    if (flat) return flat.panelsAt(q.x, q.y).map(id => { const ptr = d.pathOf.get(id), ref = ptr === undefined ? undefined : resourceOf(ptr); return ref && ref.path === ptr ? ref : undefined; }).filter((x): x is ObjectRef => !!x);
    // on its drawn outline counts too: 2 px more each way
    const e = 2 / scale() / S;
    const inside = (poly: [number, number][]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > q.y) !== (yj > q.y) && q.x < (xj - xi) * (q.y - yi) / (yj - yi) + xi) c = !c; } return c; };
    const out: { r: ObjectRef; depth: number; area: number }[] = [];
    for (const [id, ptr] of d.pathOf) {
      const it = d.scene.layout.byId.get(id), ref = resourceOf(ptr);
      if (!it || !ref || ref.path !== ptr) continue;
      const b = it.box;
      if (!inside(boxSilhouette({ ...b, x0: b.x0 - e, y0: b.y0 - e, x1: b.x1 + e, y1: b.y1 + e }))) continue;
      let depth = 0; for (let up = it.parent; up; up = up.parent) depth++;
      out.push({ r: ref, depth, area: (b.x1 - b.x0) * (b.y1 - b.y0) });
    }
    return out.sort((a, b) => b.depth - a.depth || a.area - b.area).map(x => x.r);
  }
  /** begin, or go on, dragging a new thing at a point (client px); false: it can't be drawn (the label is dragged) */
  function dragFresh(sec: string, item: PaletteItem | undefined, at: { x: number; y: number; half: boolean; straight: boolean },
    copy?: { path: Path; start: [number, number]; x0: number; y0: number }, free?: Free): boolean {
    if (mode !== '3d' || !cd || !svg || !doc.doc.ok || !lastS3) return false;
    const was = pinDrag()?.fresh ? pinDrag() : undefined, home = was?.origCd ?? cd;
    let name: string, path: Path, plan: FreshPlan;
    if (copy) {
      // (0.31.0) a copy: the original's duplicate (its name the next free one), in the same container, held where the press was
      const dup = K.commands.duplicateCmd!(copy.path);
      dup.build(doc.text);
      const made = dup.select?.[0];
      if (!made) return false;
      path = made; name = String(made[made.length - 1]);
      plan = { into: undefined, label: `Copy ${describe(copy.path)} as ${name}`, add: K.commands.duplicateCmd!(copy.path) };
    } else if (free) {
      path = free.path; name = free.ref.name;
      const sv = toSvg(at.x, at.y), off = was?.shifted ?? [0, 0];
      plan = freePlan(free, { x: sv.x - off[0], y: sv.y - off[1] }, home);
    } else {
      const k = kindOf(sec);
      name = was?.fresh!.name ?? freshName(doc.text, item?.name ?? k.singular); path = [...k.section, name] as Path;
      const sv = toSvg(at.x, at.y), off = was?.shifted ?? [0, 0];
      plan = freshPlan(sec, item, name, path, { x: sv.x - off[0], y: sv.y - off[1] }, home);
    }
    if (!was || was.fresh!.plan.into !== plan.into) {
      const text = plan.add.build(doc.text).steps.reduce((t, st) => applyStep(t, st), doc.text);
      let trial: D | undefined;
      try { trial = K.trial(text, opts.theme); } catch { /* not drawn */ }
      const id = trial?.pinId.get(name), it = id ? trial!.scene.layout.byId.get(id) : undefined, stays = free && !plan.into, start = copy ? copy.start : stays ? free.start : id ? localAt(trial!.scene, id) : undefined;
      if (!trial || trial.diags.length || !id || !it || !start) return false;
      const b = it.box, par = it.parent, inHome = par ? home.scene.layout.byId.get(par.id) : undefined;
      // drawn in a container of its own, made with it: it could only be moved inside that
      if (par && !inHome) return false;
      endWay(); clearTimeout(relayout);
      const g: NonNullable<typeof drag> = {
        kind: 'pin', x0: copy?.x0 ?? (stays ? free.x0 : at.x), y0: copy?.y0 ?? (stays ? free.y0 : at.y), moved: true, name, id, start, shown: start, z0: b.z0, size: [b.x1 - b.x0, b.y1 - b.y0], origCd: home,
        // its container, as it was: what is drawn is moved to it (stillOn)
        parent: par && inHome ? { id: par.id, w: par.box.x1 - par.box.x0, d: par.box.y1 - par.box.y0, pad: paddingOf(K.catalog, par.region), box: inHome.box, label: par.region?.label ?? par.id, ...growOf(par.region, inHome.box, groupPin(home, par.id)) } : undefined,
        // (0.31.0) beside what made way for it, where the trial has them (in the frame of the container as it was): not where they stood
        // before it came, or the layout's own place for it would be "taken"
        beside: besideOf(trial, id).map(o => { const dx = inHome && par ? inHome.box.x0 - par.box.x0 : 0, dy = inHome && par ? inHome.box.y0 - par.box.y0 : 0; return { ...o, x0: o.x0 + dx, x1: o.x1 + dx, y0: o.y0 + dy, y1: o.y1 + dy }; }), shifted: was?.shifted,
        fresh: { base: trial, name, path, plan, text, ...(copy ? { copy: true } : {}), ...(free ? { free } : {}) },
        gridShown: was?.gridShown,
      };
      drag = g;
      // out of one container and into another: the view as it was, then the new one still
      unshift(g);
      try { g.fresh!.base = trialLayout(g, start).next; } catch { /* as the layout has it */ }
      stillOn(g, g.fresh!.base);
      void draw(g.fresh!.base);
      if (pinDrag() !== g) return false;
    }
    lastPin = { x: at.x, y: at.y, half: at.half, straight: at.straight };
    pinStep();
    return true;
  }
  /** the new thing off the canvas again: the drawing without it, the drag not over */
  function hideFresh() {
    const g = pinDrag();
    if (!g?.fresh) return;
    endWay(); clearTimeout(relayout);
    drag = undefined;
    lastKey = '';
    unshift(g);
    void draw(g.origCd!);
    paintNav();
  }
  async function endFresh(g: NonNullable<typeof drag>, commit: boolean, stale: boolean) {
    const f = g.fresh!, m = g.move;
    if (!commit || !m) {
      unshift(g);
      await draw(g.origCd!);
      redrawPending();
      return;
    }
    pendingAfterDrag = false;
    // where it is dropped, unless that is where the layout puts it anyway; on a taken cell, where the layout puts it
    let keep = g.keep ?? [];
    if (!g.invalid && (stale || !g.shown || g.shown[0] !== m.at[0] || g.shown[1] !== m.at[1] || g.keep === undefined)) try { keep = trialLayout(g).keep; } catch { keep = []; }
    // (the layout's own place needn't be on the grid: the same cell is the same place)
    const own = snapMove(g.start!, [0, 0], g.step ?? 1, g.size!, g.parent).at, its = m.at[0] !== own[0] || m.at[1] !== own[1];
    const pins: [string, [number, number]][] = g.invalid ? [] : [...(its || keep.length || f.free ? [[f.name, g.pinFix?.get(f.name) ?? m.at] as [string, [number, number]]] : []), ...keep];
    // (0.31.0) moved by its handle onto a taken spot: its old pin (in what it left) goes, and the layout places it
    const data = doc.goodDoc.data, old = f.free && !pins.length && K.pins.of(data)?.[f.name] ? [deleteCmd([K.pins.keyOf(data), 'layout', f.name])] : [];
    const cmd = pins.length ? seqCmd(`${f.plan.label} at [${m.at.join(', ')}]${wayWords(g, keep)}`, [f.plan.add, pinsCmd(pins, '')]) : old.length ? seqCmd(f.plan.label, [f.plan.add, ...old]) : f.plan.add;
    if (g.invalid) unshift(g);
    if (!run(doc, { ...cmd, select: [f.path] }, 'canvas', opts.note)) { lastKey = ''; unshift(g); await draw(g.origCd!); return; }
    // the layout may have placed it out of view: shown, once it is drawn there, so that its name is asked above it
    if (g.invalid) { opts.note(`${f.name} ${f.free ? 'moved' : 'added'}; that spot is taken, so the layout placed it`); pendingNudge = f.path; }
    doc.select([f.path], 'canvas');
    // its name, in the inline field above it; the drop and the name are one undo step ((0.31.0) a copy has its name: not asked)
    if (!f.copy && !f.free) rename(f.path, { joins: doc.undoId, at: lastPin });
  }

  function up(e: PointerEvent) {
    if (sizing) {
      const z = sizing; sizing = undefined;
      if (z.size[0] !== z.size0[0] || z.size[1] !== z.size0[1]) {
        const label = `Resize ${z.label}`, grp = sizableGroup(), sh = z.shift;
        // (0.29.0) a left or back side: the group's own pin moves the other way, and what it holds with it, so the far edge and the
        // contents stay where they are on screen
        const q = (v: number) => Math.round(v * 1000) / 1000;   // (the layout's numbers, as the file writes them: 0.6, not 0.6000000000000001)
        const pins: [string, [number, number]][] = (sh[0] || sh[1]) && grp?.pin ? [[grp.pin.name, [q(grp.pin.at[0] - sh[0]), q(grp.pin.at[1] - sh[1])]], ...grp.held().map(c => [c.name, [q(c.at[0] + sh[0]), q(c.at[1] + sh[1])]] as [string, [number, number]])] : [];
        run(doc, pins.length ? seqCmd(label, [sizeCmd(z, z.size, label), pinsCmd(pins, label)]) : sizeCmd(z, z.size, label), 'canvas', opts.note);
      }
      else paintOverlay();
      opts.onHint?.('');
      return;
    }
    if (linking && !linking.pick) { const { x, y } = pageXY(e); endConnect(pathAtEvent(document.elementFromPoint(x, y))); return; }
    const d0 = drag;
    drag = undefined;
    svg?.classList.remove('panning');
    if (svg?.classList.contains('cant-move')) { svg.classList.remove('cant-move'); paintNav(); }
    if (!d0) return;
    const { x, y } = pageXY(e);
    if ((d0.kind === 'marquee' && !d0.moved && !d0.add) || (d0.kind === 'pan' && d0.emptyClick)) doc.select([], 'canvas');
    const narrow = d0.kind === 'click' ? d0.ptr : d0.kind === 'pin' && !d0.moved ? d0.narrow : undefined;
    if (narrow) doc.select([fromPointer(narrow)], 'canvas');
    if (d0.kind === 'pin' && d0.moved) {
      // the last position the pointer reached, then the drop
      drag = d0;
      lastPin = { x, y, half: e.ctrlKey, straight: e.shiftKey };
      pinFrame = false;
      pinStep();
      endPin(true);
      return;
    }
    paintOverlay();
  }
  let lastMarquee: { x0: number; y0: number; x1: number; y1: number } | undefined;
  /** each drawn resource's footprint on the floor, its own height folded in (see the marquee) */
  function footprints(): Map<string, { x0: number; y0: number; x1: number; y1: number }> {
    const out = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
    if (!cd) return out;
    for (const [id, ptr] of cd.pathOf) {
      const r = resourceOf(ptr);
      if (!r || r.path !== ptr) continue;
      const item = cd.scene.layout.byId.get(id);
      if (!item || svg?.querySelector(`[data-id="${CSS.escape(id)}"].pre`)) continue;
      const b = item.box, z = b.z0;
      const f = { x0: b.x0 - z, y0: b.y0 - z, x1: b.x1 - z, y1: b.y1 - z };
      const prev = out.get(ptr);
      // a resource drawn as several things (one inside another): the union
      out.set(ptr, prev ? { x0: Math.min(prev.x0, f.x0), y0: Math.min(prev.y0, f.y0), x1: Math.max(prev.x1, f.x1), y1: Math.max(prev.y1, f.y1) } : f);
    }
    return out;
  }
  function wheel(e: WheelEvent) {
    e.preventDefault();
    const { x, y } = pageXY(e);
    const k = scale();
    // a pinch (ctrlKey on a wheel event) or ⌘-wheel always zooms; ⇧-wheel always pans sideways
    if (e.ctrlKey || e.metaKey) { zoomAt(Math.exp(-e.deltaY * 0.01), x, y); return; }
    if (e.shiftKey) { V.view = { ...V.view!, x: V.view!.x + (e.deltaX || e.deltaY) / k }; applyView(); return; }
    if (nav.wheel === 'zoom') zoomAt(Math.exp(-e.deltaY * 0.0025), x, y);
    else { V.view = { ...V.view!, x: V.view!.x + e.deltaX / k, y: V.view!.y + e.deltaY / k }; applyView(); }
  }

  // ---------- the menu ----------
  function context(e: MouseEvent) {
    e.preventDefault();
    const { x, y } = pageXY(e);
    if (layer?.context?.(e, { x, y })) return;
    const ptr = pathAt(e.target, x, y);
    if (ptr !== undefined && !doc.selection.some(p => toPointer(p) === ptr)) doc.select([fromPointer(ptr)], 'canvas');
    openMenu(menuItems(ptr, ptr === pathAtEvent(e.target) ? partAtEvent(e.target) : undefined), { x, y }, 'Canvas');
  }
  function menuItems(ptr: string | undefined, part?: { pin: string; label: string }): MenuItem[] {
    const sel = doc.selection;
    const items: MenuItem[] = [];
    const ro = !doc.doc.ok;
    if (ptr === undefined || !sel.length) {
      for (const s of ui.newOrder) items.push({ label: `New ${kindOf(s).singular}`, icon: 'plus', disabled: ro, onSelect: () => addResource(s) });
      if (opts.clipItems) items.push({ sep: true }, ...opts.clipItems().filter(i => 'label' in i && i.label === 'Paste'));
      items.push({ sep: true }, { label: 'Fit', keys: '0', onSelect: () => fitItems() }, { label: 'Fit the whole drawing', onSelect: () => fit() }, { label: 'Zoom 100%', keys: '1', onSelect: () => actual() });
      const hasPins = !!K.pins.of(doc.goodDoc.data);
      items.push({ label: 'Reset layout', icon: 'rotate-ccw', desc: 'Remove every pin (x-editor.layout)', disabled: ro || !hasPins, why: 'Nothing is pinned', onSelect: resetLayout });
      if (K.compact) {
        const on = K.compact.on(doc.goodDoc.data);
        items.push(on
          ? { label: 'Turn compact layout off', desc: 'Draw it as written (x-editor.compact)', disabled: ro, onSelect: () => setCompact(false) }
          : { label: 'Turn compact layout on', desc: 'Things in rows, so it reads larger when fitted (x-editor.compact)', disabled: ro, onSelect: () => setCompact(true) });
      }
      return items;
    }
    const one = sel.length === 1 ? sel[0] : undefined;
    const isRes = one && resourceOf(toPointer(one))?.path === toPointer(one);
    if (one) {
      items.push(...K.objectItems(doc, one, 'canvas', opts.note));
      // (0.28.0) a group with a size: back to fitting what it holds
      const sg = sizableGroup();
      if (sg?.size && K.resize) items.push({ label: 'Fit to contents', desc: `Take ${sg.label}'s size away: it fits what it holds`, disabled: ro, onSelect: () => run(doc, sizeCmd(sg, undefined, `Fit ${sg.label} to what it holds`), 'canvas', opts.note) });
      if (items.length) items.push({ sep: true });
      items.push({ label: 'Rename…', icon: 'pencil', keys: 'F2', disabled: ro || !isRes, why: T.renameWhy, onSelect: () => rename(one) });
      items.push({ label: 'Duplicate', icon: 'copy', keys: '⌘D', disabled: ro || !isRes, why: T.duplicateWhy, onSelect: () => duplicate(doc, one, 'canvas', opts.note) });
      const name = part?.pin ?? (isRes ? resourceOf(toPointer(one))!.name : '');
      const pinned = !!K.pins.of(doc.goodDoc.data)?.[name];
      if (pinned) items.push({ label: 'Unpin', icon: 'rotate-ccw', desc: 'Let the layout place it again', onSelect: () => run(doc, withPinsMoved({ ...deleteCmd([PINS_KEY, 'layout', name]), label: `Unpin ${part?.label ?? describe(one)}` }), 'canvas', opts.note) });
      items.push({ sep: true });
      items.push({ label: 'Show in text', icon: 'code-xml', onSelect: () => opts.showInText(one) });
      items.push({ label: 'Show in tree', icon: 'list-tree', onSelect: () => opts.showInTree(one) });
    }
    // (0.10.0) connect and group, where the domain says how
    if (K.connect && one && isRes) items.push({ label: 'Connect to…', icon: 'link', desc: 'Then click what it connects to (Esc cancels)', disabled: ro, onSelect: () => startPick() });
    if (K.group) items.push({ label: sel.length > 1 ? `Group ${sel.length} items` : 'Group', icon: 'box', keys: '⌘G', desc: 'Into a new container, as one step', disabled: ro || !members().length, why: 'Only objects are grouped', onSelect: groupSelection });
    items.push({ label: 'Select parent', icon: 'arrow-up-right', keys: '⌘↑', onSelect: selectParent });
    items.push({ label: 'Select connected', icon: 'link', desc: 'What refers to it, and what it refers to', onSelect: () => doc.select(connected(doc, sel), 'canvas') });
    items.push({ label: 'Zoom to selection', keys: '⇧2', onSelect: zoomToSelection });
    if (opts.clipItems) items.push({ sep: true }, ...opts.clipItems());
    items.push({ sep: true }, { label: sel.length > 1 ? `Delete ${sel.length} items` : 'Delete', icon: 'trash-2', keys: '⌫', danger: true, disabled: ro, onSelect: () => deletePaths(doc, sel, 'canvas', opts.note) });
    return items;
  }
  // ---------- (0.10.0) connect and group, by the domain's plans ----------
  /** the one selected object, if the domain connects and the file reads */
  /** (0.31.0) the one selected thing of the file's own, in 3D, when the domain says where things may be moved to */
  function movable(): ObjectRef | undefined {
    if (!K.moveInto || mode !== '3d' || !doc.doc.ok || doc.selection.length !== 1) return undefined;
    const ptr = toPointer(doc.selection[0]), r = resourceOf(ptr);
    if (!r || r.path !== ptr || !cd || !pinIds(cd).has(r.name)) return undefined;
    // (0.32.0) only what the domain moves somewhere: one it takes nowhere has no handle
    const v = doc.selection[0].reduce<any>((x, k) => x?.[k], doc.goodDoc.data);
    return v && typeof v === 'object' && K.moveInto(r, v, undefined, doc.goodDoc.data) ? r : undefined;
  }
  function connectable(): ObjectRef | undefined {
    if (!K.connect || !doc.doc.ok || doc.selection.length !== 1) return undefined;
    const ptr = toPointer(doc.selection[0]), r = resourceOf(ptr);
    return r && r.path === ptr ? r : undefined;
  }
  function startPick() {
    const from = connectable();
    if (!from) return;
    linking = { from, pick: true };
    opts.note(`Click what ${from.name} connects to (Esc cancels)`);
    paintOverlay();
  }
  /** end a connection on what is under the pointer: the domain's plan, written as one step */
  function endConnect(ptr: string | undefined) {
    const from = linking?.from;
    linking = undefined;
    paintOverlay();
    if (!from || ptr === undefined) return;
    const to = resourceOf(ptr);
    if (!to || to.path === from.path) { opts.note('Not connected: drop it on another object', 'warn'); return; }
    const data = doc.goodDoc.data;
    const plan = K.connect?.(from, to, data);
    if (!plan) { opts.note(`${from.name} and ${to.name} can't be connected`, 'warn'); return; }
    const label = plan.label ?? `Connect ${from.name} to ${to.name}`;
    let cmd: Command, path: Path;
    if (plan.name !== undefined) {
      const name = freshName(doc.text, plan.name);
      cmd = insertCmd(plan.at, name, plan.value, { label });
      path = [...plan.at, name];
    } else {
      const list = plan.at.reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k as string] : undefined), data);
      path = [...plan.at, Array.isArray(list) ? list.length : 0];
      cmd = insertItemCmd(plan.at, plan.value, undefined, label);
    }
    if (run(doc, { ...cmd, select: [path] }, 'canvas', opts.note)) doc.select([path], 'canvas');
  }
  /** the selection's objects (a key inside one counts as its object), once each */
  function members(): ObjectRef[] {
    const out = new Map<string, ObjectRef>();
    for (const p of doc.selection) { const r = resourceOf(toPointer(p)); if (r) out.set(r.path, r); }
    return [...out.values()];
  }
  /** the selection into a new container: the container, each member's change and its pin dropped (the layout places it
   *  in its new frame), as one command, one undo step */
  function groupSelection() {
    if (!K.group || !doc.doc.ok) return;
    const ms = members();
    if (!ms.length) { opts.note('Only objects are grouped', 'warn'); return; }
    const plan = K.group(ms, doc.goodDoc.data);
    if (!plan) { opts.note(ms.length > 1 ? `These ${ms.length} can't be grouped` : `${ms[0].name} can't be grouped`, 'warn'); return; }
    const name = freshName(doc.text, plan.name);
    const pins = K.pins.of(doc.goodDoc.data) ?? {};
    const unpin = ms.filter(m => pins[m.name] !== undefined).map(m => withPinsMoved(deleteCmd([PINS_KEY, 'layout', m.name])));
    const label = plan.label ?? `Group ${ms.length > 1 ? `${ms.length} items` : ms[0].name} into ${name}`;
    const p = [...plan.at, name] as Path;
    const cmd = seqCmd(label, [insertCmd(plan.at, name, plan.value, { label }), ...plan.members(name).map(m => setCmd(m.path, m.value)), ...unpin]);
    if (run(doc, { ...cmd, select: [p] }, 'canvas', opts.note)) doc.select([p], 'canvas');
  }
  function addResource(s: string) {
    const k = kindOf(s);
    const name = freshName(doc.text, k.singular);
    const p = [...k.section, name];
    if (run(doc, insertCmd(p.slice(0, -1), name, k.template(), { label: `Add ${k.singular} ${name}` }), 'canvas', opts.note)) {
      doc.select([p], 'canvas');
      rename(p, { joins: doc.undoId });
    }
  }
  // ---------- E11: the palette: add a resource by a click, or by a drag onto the canvas ----------
  /** Add an object from the palette, by a click or (where it isn't dragged itself: 2D, a container of its own) by a drop at
   *  a point: into what holds it there, else the layout places it. One command (one undo step); then it is selected and named. */
  function addFromPalette(sec: string, at?: { x: number; y: number }, item?: PaletteItem): Path | undefined {
    if (!doc.doc.ok) { opts.note('Fix the YAML first', 'warn'); return undefined; }
    const k = kindOf(sec), name = freshName(doc.text, item?.name ?? k.singular), p = [...k.section, name] as Path;
    const plan = freshPlan(sec, item, name, p, at && toSvg(at.x, at.y), cd);
    if (!run(doc, { ...plan.add, select: [p] }, 'canvas', opts.note)) return undefined;
    if (at && !plan.into) opts.note(`${k.singular} ${name} added; the layout placed it${mode === '2d' ? ' (in 3D a drop pins it where it lands)' : ''}`);
    doc.select([p], 'canvas');
    // (0.12.5) its name, in the inline field above it; the drop and the name are one undo step
    rename(p, { joins: doc.undoId, at });
    return p;
  }
  const palette = h('div', { class: 'palette', role: 'toolbar', 'aria-label': T.palette, 'aria-orientation': 'vertical' });
  const drawLooks = K.looks?.(palette, () => (disposed ? undefined : doc.goodDoc.data), ui, opts.theme) ?? (() => {});
  // (0.11.0) sections: a header (a button, aria-expanded) over its entries; open: the section last added from (the
  // first, before any); the reader opens and closes the others as they like. The host's store may be off: guarded.
  const sections = new Map<string, { head: HTMLButtonElement; body: HTMLElement }>();
  const PAL_KEY = 'canvas-palette';
  let lastSection: string | undefined;
  try { const v = JSON.parse(opts.store?.get(PAL_KEY) ?? '{}') as { last?: unknown }; if (typeof v.last === 'string') lastSection = v.last; } catch { /* none */ }
  const named = [...new Set(ui.palette.map(i => i.section).filter((x): x is string => x !== undefined))];
  const openAtStart = lastSection !== undefined && named.includes(lastSection) ? lastSection : named[0];
  const setOpen = (sec: string, open: boolean) => { const g = sections.get(sec); if (!g) return; g.head.setAttribute('aria-expanded', String(open)); g.body.hidden = !open; if (open) drawLooks(); };
  function sectionBody(sec: string): HTMLElement {
    const have = sections.get(sec);
    if (have) return have.body;
    const id = `pal-sec-${sections.size}-${Math.random().toString(36).slice(2, 8)}`;
    const head = h('button', { type: 'button', class: 'pal-head', 'aria-expanded': 'false', 'aria-controls': id, 'data-section-head': sec }, icon('chevron-right', 'pal-chev'), h('span', { class: 'pal-head-label' }, sec)) as HTMLButtonElement;
    const body = h('div', { class: 'pal-body', id, role: 'group', 'aria-label': sec, 'data-section-body': sec });
    head.addEventListener('click', () => setOpen(sec, head.getAttribute('aria-expanded') !== 'true'));
    palette.append(h('div', { class: 'pal-section', 'data-pal-section': sec }, head, body));
    sections.set(sec, { head, body });
    setOpen(sec, sec === openAtStart);
    return body;
  }
  // (0.12.0) docked: a pane of its own at the canvas's left (the stage beside it): a search box over the list, a
  // control that collapses it to a strip, and a grip that resizes it; its width and state in the host's store
  const DOCK_KEY = 'canvas-palette-dock';
  const dockPref: { w?: number; collapsed?: boolean } = {};
  try { const v = JSON.parse(opts.store?.get(DOCK_KEY) ?? '{}') as { w?: unknown; collapsed?: unknown }; if (typeof v.w === 'number' && Number.isFinite(v.w)) dockPref.w = v.w; if (v.collapsed === true) dockPref.collapsed = true; } catch { /* none */ }
  const saveDock = () => { try { opts.store?.set(DOCK_KEY, JSON.stringify(dockPref)); } catch { /* storage may be off */ } };
  const DOCK_MIN = 160, DOCK_MAX = 440;
  const palHome: HTMLElement = docked ? h('aside', { class: 'pal-dock', 'aria-label': 'Palette' }) : palette;
  const palGrip = h('div', { class: 'pal-grip', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize the palette', tabindex: '0' });
  const search = h('input', { type: 'search', class: 'pal-search', placeholder: 'Search', 'aria-label': 'Search the palette', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const none = h('p', { class: 'pal-none', role: 'status', hidden: '' });
  const collapseBtn = h('button', { type: 'button', class: 'btn sm quiet icon-only pal-collapse', 'aria-expanded': 'true', 'aria-label': 'Collapse the palette', title: 'Collapse the palette' }, icon('chevron-left')) as HTMLButtonElement;
  const visibleItems = () => [...palette.querySelectorAll<HTMLButtonElement>('.pal-item')].filter(b => !b.hidden && !b.closest('[hidden]'));
  /** the search: every word in the entry's label or its section; sections with a match open while it is on, and the
   *  reader's own open and closed come back when it is cleared */
  let before: Map<string, boolean> | undefined;
  function filter() {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length && !before) before = new Map([...sections].map(([k, g]) => [k, g.head.getAttribute('aria-expanded') === 'true']));
    let shown = 0;
    for (const b of palette.querySelectorAll<HTMLButtonElement>('.pal-item')) {
      const item = ui.palette[Number(b.dataset.entry)];
      const hay = `${item.label} ${item.section ?? ''}`.toLowerCase();
      b.hidden = !words.every(w => hay.includes(w));
      if (!b.hidden) shown++;
    }
    for (const [sec, g] of sections) {
      const any = [...g.body.querySelectorAll<HTMLButtonElement>('.pal-item')].some(b => !b.hidden);
      (g.head.parentElement as HTMLElement).hidden = words.length > 0 && !any;
      if (words.length) setOpen(sec, any);
    }
    if (!words.length && before) { for (const [sec, open] of before) setOpen(sec, open); before = undefined; }
    none.hidden = shown > 0;
    drawLooks();
    none.textContent = shown ? '' : `Nothing matches "${search.value.trim()}"`;
  }
  const setDockW = (w: number, keep = true) => { const v = Math.round(Math.min(DOCK_MAX, Math.max(DOCK_MIN, w))); host.style.setProperty('--pal-w', `${v}px`); palGrip.setAttribute('aria-valuenow', String(v)); if (keep) { dockPref.w = v; saveDock(); } };
  const setCollapsed = (c: boolean, keep = true) => {
    host.classList.toggle('pal-collapsed', c);
    collapseBtn.setAttribute('aria-expanded', String(!c));
    const say = c ? 'Show the palette' : 'Collapse the palette';
    collapseBtn.setAttribute('aria-label', say); collapseBtn.title = say;
    collapseBtn.replaceChildren(icon(c ? 'chevron-right' : 'chevron-left'));
    if (keep) { if (c) dockPref.collapsed = true; else delete dockPref.collapsed; saveDock(); }
  };
  if (docked) {
    host.classList.add('pal-docked');
    palette.classList.add('pal-list');
    palHome.append(h('div', { class: 'pal-dock-head' }, collapseBtn, h('label', { class: 'pal-search-wrap' }, icon('search'), search)), palette, none);
    palGrip.setAttribute('aria-valuemin', String(DOCK_MIN)); palGrip.setAttribute('aria-valuemax', String(DOCK_MAX));
    setDockW(dockPref.w ?? 220, false);
    setCollapsed(!!dockPref.collapsed, false);
    collapseBtn.addEventListener('click', () => { setCollapsed(!host.classList.contains('pal-collapsed')); if (!host.classList.contains('pal-collapsed')) search.focus(); });
    search.addEventListener('input', filter);
    search.addEventListener('keydown', e => {
      if (e.key === 'Escape' && search.value) { e.preventDefault(); e.stopPropagation(); search.value = ''; filter(); }
      else if (e.key === 'ArrowDown') { const first = visibleItems()[0]; if (first) { e.preventDefault(); first.focus(); } }
      else if (e.key === 'Enter') { const first = visibleItems()[0]; if (first) { e.preventDefault(); first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); } }
    });
    // the list's arrow keys: up and down through what is shown (up from the first: back to the search)
    palette.addEventListener('keydown', e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const all = [...palette.querySelectorAll<HTMLButtonElement>('.pal-head, .pal-item')].filter(b => !b.hidden && !b.parentElement?.closest('[hidden]') && (b.classList.contains('pal-head') || !b.closest('.pal-body[hidden]')));
      const i = all.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0) return;
      e.preventDefault();
      if (e.key === 'ArrowUp' && i === 0) search.focus(); else all[Math.min(all.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
    });
    palGrip.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      try { palGrip.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      const x0 = e.clientX, w0 = palHome.getBoundingClientRect().width;
      const mv = (ev: PointerEvent) => setDockW(w0 + ev.clientX - x0, false);
      const up = (ev: PointerEvent) => { palGrip.removeEventListener('pointermove', mv); palGrip.removeEventListener('pointerup', up); setDockW(w0 + ev.clientX - x0); };
      palGrip.addEventListener('pointermove', mv); palGrip.addEventListener('pointerup', up);
    });
    palGrip.addEventListener('keydown', e => {
      const d = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
      if (d) { e.preventDefault(); setDockW(palHome.getBoundingClientRect().width + d); }
    });
  }
  const usedSection = (item: PaletteItem) => {
    if (item.section === undefined || item.section === lastSection) return;
    lastSection = item.section;
    try { opts.store?.set(PAL_KEY, JSON.stringify({ last: lastSection })); } catch { /* storage may be off */ }
  };
  ui.palette.forEach((item, idx) => {
    const { kind: sec, icon: ic, label } = item;
    const b = h('button', { type: 'button', class: 'pal-item', 'data-section': sec, 'data-entry': String(idx), title: `Add ${label.toLowerCase()} (click), or drag it where it goes` }, icon(ic), h('span', { class: 'pal-label' }, label));
    b.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer: the events come to the button anyway */ }
      const x0 = e.clientX, y0 = e.clientY;
      let ghost: HTMLElement | undefined, dragged = false, real = false, frame = 0, last: PointerEvent | undefined;
      const over = (ev: PointerEvent) => { const r = stage.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom && !palHome.contains(document.elementFromPoint(ev.clientX, ev.clientY)); };
      // the thing itself on the canvas (0.14.0: 3D), else its label
      const step = (ev: PointerEvent) => {
        const on = over(ev);
        real = on && dragFresh(sec, item, { x: ev.clientX, y: ev.clientY, half: ev.ctrlKey, straight: ev.shiftKey });
        if (!on || !real) hideFresh();
        if (!real) {
          if (!ghost) { ghost = h('div', { class: 'pal-ghost', 'aria-hidden': 'true' }, icon(ic), label); host.append(ghost); }
          const hr = host.getBoundingClientRect();
          ghost.style.left = `${ev.clientX - hr.left + 8}px`; ghost.style.top = `${ev.clientY - hr.top + 8}px`;
          ghost.classList.toggle('bad', !on);
        } else { ghost?.remove(); ghost = undefined; }
      };
      const mv = (ev: PointerEvent) => {
        if (!dragged && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
        if (!dragged) { dragged = true; palDragging++; opts.onBusy?.(); }
        last = ev;
        if (frame) return;
        const go = () => { if (!frame) return; cancelAnimationFrame(frame); frame = 0; if (last) step(last); };
        frame = requestAnimationFrame(go); setTimeout(go, 32);
      };
      const done = (ev: PointerEvent, drop: boolean) => {
        if (dragged) { palDragging--; queueMicrotask(() => opts.onBusy?.()); }
        b.removeEventListener('pointermove', mv); b.removeEventListener('pointerup', upH); b.removeEventListener('pointercancel', cancelH); removeEventListener('keydown', esc, true);
        cancelAnimationFrame(frame); frame = 0;
        if (drop && dragged) step(ev);
        ghost?.remove();
        if (real && pinDrag()?.fresh) { if (drop) usedSection(item); void endPin(drop); return; }
        hideFresh();
        if (!drop) return;
        if (!dragged) { usedSection(item); addFromPalette(sec, undefined, item); }
        else if (over(ev)) { usedSection(item); addFromPalette(sec, { x: ev.clientX, y: ev.clientY }, item); }
      };
      const upH = (ev: PointerEvent) => done(ev, true), cancelH = (ev: PointerEvent) => done(ev, false);
      const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); done(e, false); } };
      b.addEventListener('pointermove', mv); b.addEventListener('pointerup', upH); b.addEventListener('pointercancel', cancelH); addEventListener('keydown', esc, true);
    });
    // the keyboard: Enter or the space key adds (the layout places it)
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); usedSection(item); addFromPalette(sec, undefined, item); } });
    (item.section === undefined ? palette : sectionBody(item.section)).append(b);
  });
  if (docked) host.prepend(palHome, palGrip); else host.append(palette);

  /** (0.26.0) compact layout on or off: x-editor.compact, one undo step; off takes x-editor away too when that was all it held */
  function setCompact(on: boolean) {
    const key = K.pins.key, x = (doc.goodDoc.data as Record<string, Record<string, unknown>> | undefined)?.[key];
    if (on) { run(doc, setCmd([key, 'compact'], true, 'Turn compact layout on'), 'canvas', opts.note); return; }
    const only = x && Object.keys(x).every(k => k === 'compact');
    run(doc, { ...deleteCmd(only ? [key] : [key, 'compact']), label: 'Turn compact layout off' }, 'canvas', opts.note);
  }
  function resetLayout() {
    // wherever the pins are (x-editor, or the legacy key): removed, and their key too if it holds nothing else
    const key = K.pins.keyOf(doc.goodDoc.data);
    const x = (doc.goodDoc.data as Record<string, Record<string, unknown>> | undefined)?.[key];
    const only = x && Object.keys(x).length === 1;
    run(doc, { ...deleteCmd(only ? [key] : [key, 'layout']), label: 'Reset the layout' }, 'canvas', opts.note);
  }
  /** (0.12.5) name it, in the inline field above its drawing; Enter and Esc give the canvas the focus back (⌘Z works at once) */
  function rename(p: Path, o: { joins?: number; at?: { x: number; y: number } } = {}) {
    let path: Path | null = p;
    const off = doc.on(c => { if (path && c.remap) path = c.remap(path); });
    void K.actions.rename(doc, p, 'canvas', opts.note, {
      ...o, back: stage, late: stage, busy: () => !!drag || dropping > 0, bounds: () => stage.getBoundingClientRect(),
      place: () => {
        const b = path && V.view ? boxFor(path) : undefined;
        if (!b) return undefined;
        const r = viewEl.getBoundingClientRect(), k = scale();
        return { left: r.left + (b.x - V.view!.x) * k, top: r.top + (b.y - V.view!.y) * k, width: b.w * k, height: b.h * k };
      },
    }).finally(off);
  }
  function selectParent() {
    const up = new Map<string, Path>();
    for (const p of doc.selection) {
      const r = resourceOf(toPointer(p));
      // a property → its object; an object → its kind's section; a section → the root
      const q = r && r.path !== toPointer(p) ? fromPointer(r.path) : r ? kindOf(r.kind).section : [];
      up.set(toPointer(q), q);
    }
    doc.select([...up.values()], 'canvas');
  }

  // ---------- keys ----------
  function key(e: KeyboardEvent) {
    if (e.type === 'keyup' && e.key !== ' ') return;
    if (e.key === ' ') { spaceKeyDown = e.type === 'keydown'; svg?.classList.toggle(ui.panKeyClass, spaceKeyDown); e.preventDefault(); return; }
    const lk = layer?.key?.(e);
    if (lk === 'ignore') return;
    if (lk === 'handled') { e.preventDefault(); e.stopPropagation(); return; }
    const mod = e.metaKey || e.ctrlKey;
    const sel = doc.selection;
    const drawn = [...new Set([...(cd?.pathOf.values() ?? [])].filter(p => resourceOf(p)?.path === p))];
    const ro = !doc.doc.ok;
    switch (e.key) {
      case '+': case '=': zoomAt(1.25); break;
      case '-': case '_': zoomAt(0.8); break;
      case '0': fitItems(); break;
      case '1': actual(); break;
      case '@': case '2': if (e.shiftKey || e.key === '@') zoomToSelection(); else return; break;
      case 'Escape': if (sizing) { sizing = undefined; paintOverlay(); opts.onHint?.(''); opts.note('Not resized'); break; } if (linking) { linking = undefined; paintOverlay(); opts.note('Not connected'); break; } if (pinDrag()) { endPin(false); break; } doc.select([], 'canvas'); break;
      case 'Delete': case 'Backspace': if (sel.length && !ro) deletePaths(doc, sel, 'canvas', opts.note); break;
      case 'F2': if (sel.length === 1 && !ro) rename(sel[0]); break;
      case 'ArrowUp': if (mod) { selectParent(); break; } return;
      case 'Tab': case 'ArrowRight': case 'ArrowLeft': case 'ArrowDown': {
        // move through what is drawn, in the file's order: the objects, then (0.12.4) the connections
        drawn.push(...connections().keys());
        if (!drawn.length) return;
        const i = sel.length ? drawn.indexOf(toPointer(sel[0])) : -1;
        const back = e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey);
        const j = i < 0 ? 0 : (i + (back ? -1 : 1) + drawn.length) % drawn.length;
        doc.select([fromPointer(drawn[j])], 'canvas');
        zoomIfOutside(fromPointer(drawn[j]));
        break;
      }
      case 'ContextMenu': case 'F10':
        if (e.key === 'F10' && !e.shiftKey) return;
        { const b = unionBox(sel); const r = viewEl.getBoundingClientRect(); const k = scale(); openMenu(menuItems(sel.length ? toPointer(sel[0]) : undefined), b ? { x: r.left + (b.x + b.w - V.view!.x) * k, y: r.top + (b.y - V.view!.y) * k } : { x: r.left + 40, y: r.top + 40 }, 'Canvas'); }
        break;
      default:
        if (mod && e.key.toLowerCase() === 'd' && sel.length === 1 && !ro) { duplicate(doc, sel[0], 'canvas', opts.note); break; }
        if (mod && e.key.toLowerCase() === 'a') { doc.select(drawn.map(fromPointer), 'canvas'); break; }
        if (mod && e.key.toLowerCase() === 'g' && K.group && sel.length && !ro) { groupSelection(); break; }
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }
  stage.addEventListener('keydown', key);
  stage.addEventListener('keyup', key);
  // (0.31.0) ⇧ and Ctrl pressed or let go during a drag, the pointer still: the drag takes them at once (window-wide: the keys may
  // reach the page, not the stage)
  const dragKeys = (e: KeyboardEvent) => {
    if ((e.key !== 'Shift' && e.key !== 'Control') || !pinDrag() || !lastPin) return;
    const half = e.ctrlKey, straight = e.shiftKey;
    if (half === lastPin.half && straight === lastPin.straight) return;
    lastPin = { ...lastPin, half, straight };
    if (!pinFrame) { pinFrame = true; const go = () => { if (pinFrame) { pinFrame = false; pinStep(); } }; requestAnimationFrame(go); setTimeout(go, 32); }
  };
  const win = host.ownerDocument.defaultView ?? window;
  win.addEventListener('keydown', dragKeys, true); win.addEventListener('keyup', dragKeys, true);
  const focusMark = (on: boolean) => host.classList.toggle('has-focus', on);
  stage.addEventListener('focus', () => focusMark(true));
  stage.addEventListener('blur', () => focusMark(false));
  paintNav();
  function zoomIfOutside(p: Path) {
    const b = boxFor(p);
    if (!b || !V.view) return;
    if (b.x < V.view.x || b.y < V.view.y || b.x + b.w > V.view.x + V.view.w || b.y + b.h > V.view.y + V.view.h) { V.view = { ...V.view, x: b.x + b.w / 2 - V.view.w / 2, y: b.y + b.h / 2 - V.view.h / 2 }; applyView(); }
  }

  /** bring these into view: pan to them, and zoom out if they don't fit (never in) */
  function reveal(paths: Path[]): boolean {
    if (!V.view || !paths.length) return true;
    const bs = paths.map(boxFor);
    if (bs.some(b => !b)) return false;                 // not drawn yet (just pasted): after the next render
    const b = union(bs as { x: number; y: number; w: number; h: number }[])!;
    const m = 24 / scale();
    if (b.x - m >= V.view.x && b.y - m >= V.view.y && b.x + b.w + m <= V.view.x + V.view.w && b.y + b.h + m <= V.view.y + V.view.h) return true;
    if (b.w + 2 * m > V.view.w || b.h + 2 * m > V.view.h) { fit({ x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m }); return true; }
    V.view = { ...V.view, x: b.x + b.w / 2 - V.view.w / 2, y: b.y + b.h / 2 - V.view.h / 2 };
    applyView();
    return true;
  }
  let pendingReveal: Path[] | undefined;
  /** what is cut off by the canvas's edge, just into view: as far as it takes, and nothing when none of it is cut off */
  function nudge(p: Path) {
    const b = boxFor(p), v = V.view;
    if (!v || !b) return;
    if (b.w > v.w || b.h > v.h) { reveal([p]); return; }
    const m = 12 / scale(), by = (a: number, n: number, va: number, vn: number) => (a < va ? a - va - m : a + n > va + vn ? a + n - va - vn + m : 0);
    const dx = by(b.x, b.w, v.x, v.w), dy = by(b.y, b.h, v.y, v.h);
    if (dx || dy) { V.view = { ...v, x: v.x + dx, y: v.y + dy }; applyView(); }
  }
  let pendingNudge: Path | undefined;
  ifEvents();
  doc.onSelect(c => {
    paintOverlay();
    if (c.origin === 'canvas' || !c.paths.length) return;
    // a selection made elsewhere (the tree, a paste): shown here, once it is drawn
    pendingReveal = reveal(c.paths) ? undefined : c.paths;
  });

  const base = {
    addFromPalette, palette, groupSelection, startPick, get linking() { return linking; },
    render, setTheme, paintOverlay, fit: fitItems, fitNext() { toFit = true; }, fitAll: fit, actual, zoomAt, itemsBox, routesBox, get moved() { return V.moved; }, settled, get zoom() { return V.zoom; },
    dispose() { endMorph(); endWay(); clearTimeout(relayout); V.dispose(); win.removeEventListener('keydown', dragKeys, true); win.removeEventListener('keyup', dragKeys, true); disposed = true; },
    focus: () => stage.focus(),
    /** (0.22.0) the canvas's part of what the person is in the middle of: a thing moved, or dropped from the palette; a connection drawn */
    get busy(): 'drag' | 'link' | undefined { return pinDrag() || dropping || palDragging ? 'drag' : linking ? 'link' : undefined; },
    /** (0.22.0) once what was given to render is drawn and the view still (after a drag, when it ends): whether it is drawn */
    async drawnNow(): Promise<boolean> {
      while (!disposed && (renders || pendingAfterDrag || pinDrag() || dropping)) await new Promise(r => setTimeout(r, 16));
      await settled();
      return !disposed && !!svg && empty.hidden === true;
    },
    /** for the tests */
    get view() { return V.view; },
    get doc() { return cd; },
    /** the view (3D or 2D), and the 2D layout while it shows */
    get mode() { return mode; }, setMode, get flat() { return flat?.layout; },
    stage, key, scale: () => scale(), nav, paintNav, outlinesFor, footprints, get drag() { return pinDrag(); }, set trialDelay(ms: number) { trialDelay = ms; }, get lastMarquee() { return lastMarquee; },
    boxFor, /** (0.22.0) a path's own drawn elements, on the drawing as it stands */ elementsOf: (p: Path) => (svg && cd ? elementsFor(toPointer(p)) : []), pageXYOf: (p: Path) => { const b = boxFor(p); const r = viewEl.getBoundingClientRect(); const k = scale(); return b && V.view ? { x: r.left + (b.x + b.w / 2 - V.view.x) * k, y: r.top + (b.y + b.h / 2 - V.view.y) * k } : undefined; },
  };
  // the layer's calls, as they are (its getters stay getters)
  if (layer) Object.defineProperties(base, Object.getOwnPropertyDescriptors(layer.api));
  return base as typeof base & A;
}
