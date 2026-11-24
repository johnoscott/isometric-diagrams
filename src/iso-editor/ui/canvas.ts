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
import { regionKind, type KindCatalog } from '../../iso-objects/kinds.ts';
import type { CompiledScene } from '../../iso-objects/compile.ts';
import { iso, C, S } from '../../iso-core/kernel.ts';
import type { EditorModel, Command } from '../model.ts';
import type { Problem } from '../validate.ts';
import { applyStep } from '../splice.ts';
import { seqCmd, type Commands } from '../commands.ts';
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
  /** (0.12.5) what a double click on an object does: shows it in the text (the default), or renames it */
  doubleClick?: 'text' | 'rename';
  text: {
    stage: string; dragGroup: string; dragSelectTip: string; unreadable: string; palette: string;
    /** the end of a pin drag's hint */
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
  commands: Pick<Commands, 'setCmd' | 'deleteCmd' | 'insertCmd' | 'insertItemCmd' | 'pinsCmd' | 'withPinsMoved' | 'describe' | 'freshName'>;
  /** (0.10.0) a connection drawn from one object to another (the adapter's connect): the canvas offers the gesture (a
   *  handle on a selected object, and "Connect to…") only when it is given */
  connect?(from: ObjectRef, to: ObjectRef, data: unknown): ConnectPlan | undefined;
  /** (0.10.1) a palette drop onto an object (the adapter's dropInto): the new thing inside it, asked innermost first */
  dropOnto?(target: ObjectRef, value: unknown, kind: string, data: unknown): { value: unknown; label?: string } | undefined;
  /** (0.10.0) the selection made into a new container (the adapter's group): Group, ⌘G, one undo step */
  group?(members: ObjectRef[], data: unknown): GroupPlan | undefined;
  actions: Actions;
  /** what an object's own menu offers, beyond rename, duplicate and delete */
  objectItems(doc: EditorModel, path: Path, origin: 'canvas' | 'menu', note?: (t: string, tone?: 'bad') => void): MenuItem[];
  pins: { key: string; legacyKey?: string; of(data: unknown): Record<string, unknown> | undefined; keyOf(data: unknown): string; legacyOnly(data: unknown): boolean };
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
  /** Copy, Cut and Paste for the menu */
  clipItems?(): MenuItem[];
  /** where the navigation modes are kept between visits (the host's storage); none: for this mount only */
  store?: { get(k: string): string | null; set(k: string, v: string | null): void };
  /** a layer over the drawing (none: the drawing and its marks only) */
  layer?: (ctx: CanvasCtx<D>) => CanvasLayer<A>;
}

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
  function setMode(m: '3d' | '2d') {
    if (!K.flat || m === mode) return;
    endMorph();
    const was = mode;
    mode = m;
    opts.store?.set('canvas-view', m);
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
  async function render(s3: M | undefined, data: unknown) {
    if (disposed) return;
    if (!s3) { showEmpty(T.unreadable); return; }
    const key = JSON.stringify(data);
    // nothing new to draw: repaint the marks, unless a drag is showing its grid (it repaints when it ends)
    if (key === lastKey && svg) { if (!pinDrag()) paintOverlay(); if (toFit) { toFit = false; fitItems(); } return; }
    if (mode === '2d' && !flatImpl) {
      try { await loadFlat(); } catch (e) { mode = '3d'; paintNav(); opts.note(`The 2D view couldn't load: ${(e as Error).message}`, 'warn'); }
    }
    let next: D;
    try { next = K.draw(s3, data, opts.theme); } catch (e) { showEmpty(`The canvas couldn't draw this: ${(e as Error).message}`); return; }
    if (next.diags.length) { showEmpty(`The canvas couldn't draw this: ${next.diags[0]}`); return; }
    lastKey = key;
    lastS3 = s3; lastData = data;
    if (pinDrag()) { pendingAfterDrag = true; return; }      // a model change mid-drag: drawn when the drag ends
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
    parent?: { w: number; d: number; pad: number; box: { x0: number; y0: number; x1: number; y1: number }; label: string };
    siblings?: { x0: number; y0: number; x1: number; y1: number }[]; move?: Move; invalid?: boolean; step?: number; origCd?: D; gridShown?: boolean;
    /** siblings that flow after the dragged item, pinned where they stand so the drag doesn't push them */
    keep?: [string, [number, number]][]; sel0?: Path[]; add?: boolean; touch?: boolean; name?: string; id?: string; box?: { x: number; y: number; w: number; h: number }; moved?: boolean; ptr?: string; narrow?: string } | undefined;
  let spaceKeyDown = false;
  const ifEvents = () => {
    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', wheel, { passive: false });
    stage.addEventListener('contextmenu', context);
    stage.addEventListener('dblclick', e => {
      // (0.12.5) what is under the pointer: the presses were captured, so a real double click's target is the stage
      const p = pathAt(e.target === stage ? fdoc().elementFromPoint(e.clientX, e.clientY) : e.target, e.clientX, e.clientY);
      if (p === undefined) return;
      if (ui.doubleClick === 'rename' && doc.doc.ok && resourceOf(p)?.path === p) rename(fromPointer(p));
      else opts.showInText(fromPointer(p));
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
    if (e.button === 0 && (e.target as Element | null)?.closest?.('.connect-handle')) {
      const one = connectable();
      if (one) { capture(e); e.preventDefault(); const p = toSvg(x, y); linking = { from: one, x: p.x, y: p.y }; paintOverlay(); return; }
    }
    if (e.button === 0 || e.button === 1) capture(e);
    const pan = () => { drag = { kind: 'pan', x0: x, y0: y, v0: { ...V.view! } }; svg?.classList.add('panning'); e.preventDefault(); };
    if (e.button === 1 || spaceKeyDown) { pan(); return; }
    if (e.button !== 0) return;
    const ptr = pathAt(e.target, x, y);
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
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      doc.select(sel.includes(ptr) ? doc.selection.filter(q => toPointer(q) !== ptr) : [...doc.selection, p], 'canvas');
      return;
    }
    if (!sel.includes(ptr)) doc.select([p], 'canvas');
    // a plain click on one of several selected things selects just it, once the button comes up without a drag
    const narrow = sel.includes(ptr) && sel.length > 1 ? ptr : undefined;
    drag = { kind: 'click', x0: x, y0: y, ptr: narrow };
    // a press on a resource that can be pinned: a drag pins it
    const r = resourceOf(ptr);
    const name = r && r.path === ptr ? r.name : undefined;
    const id = name && mode === '3d' ? cd?.pinId.get(name) : undefined;
    if (id && cd) {
      const item = cd.scene.layout.byId.get(id);
      const start = localAt(cd.scene, id);
      if (item && start) {
        const b = item.box, par = item.parent;
        const siblings = (par ? par.children : cd.scene.layout.items.filter(i => !i.parent)).filter(i => i !== item).map(i => ({ x0: i.box.x0, y0: i.box.y0, x1: i.box.x1, y1: i.box.y1 }));
        drag = {
          kind: 'pin', x0: x, y0: y, name, id, ptr, narrow, start, shown: start, z0: b.z0, size: [b.x1 - b.x0, b.y1 - b.y0], siblings,
          parent: par ? { w: par.box.x1 - par.box.x0, d: par.box.y1 - par.box.y0, pad: paddingOf(K.catalog, par.region), box: par.box, label: par.region?.label ?? par.id } : undefined,
          origCd: cd,
        };
      }
    }
  }
  function move(e: PointerEvent) {
    const { x, y } = pageXY(e);
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
      drag.moved = true;
      lastPin = { x, y, alt: e.altKey };
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
  let pinFrame = false, lastPin: { x: number; y: number; alt: boolean } | undefined, relayout = 0;
  const pinDrag = () => (drag?.kind === 'pin' && drag.moved ? drag : undefined);
  /** one step of a pin drag: snap, clamp, check, move the drawing, and lay it out again when the cell changes */
  function pinStep() {
    const g = pinDrag();
    if (!g || !lastPin || !cd) return;
    const k = scale();
    const step = lastPin.alt ? 0.5 : 1;
    g.step = step;
    const m = snapMove(g.start!, screenToGrid((lastPin.x - g.x0) / k, (lastPin.y - g.y0) / k), step, g.size!, g.parent);
    const ox = g.parent ? g.parent.box.x0 : 0, oy = g.parent ? g.parent.box.y0 : 0;
    const foot = { x0: ox + m.at[0], y0: oy + m.at[1], x1: ox + m.at[0] + g.size![0], y1: oy + m.at[1] + g.size![1] };
    const changed = !g.move || g.move.at[0] !== m.at[0] || g.move.at[1] !== m.at[1];
    g.move = m;
    g.invalid = overlaps(foot, g.siblings!);
    svg?.classList.add('dragging');
    svg?.classList.toggle('drag-bad', g.invalid);
    // at once: the drawn item (and what stands on it) moved by transform, from where the drawing has it
    shiftDragged(g.id!, [m.at[0] - g.shown![0], m.at[1] - g.shown![1]]);
    paintDrag(foot);
    const within = g.parent ? `within ${g.parent.label}` : 'on the canvas';
    opts.onHint?.(`Moving ${g.name} ${within} · ${step === 1 ? 'whole cells (⌥: half cells)' : 'half cells'} · ${g.invalid ? 'overlaps: it won\'t drop here' : 'Esc cancels'}${T.pinHint}`);
    // then the real layout, with its routes and labels, once per cell (and only where it may drop)
    if (changed && !g.invalid && lastS3) {
      clearTimeout(relayout);
      relayout = window.setTimeout(async () => {
        const now = pinDrag();
        if (!now || now.invalid || !now.move) return;
        let next: D;
        try { ({ next, keep: now.keep } = trialLayout(now)); } catch { return; }
        if (pinDrag() !== now) return;                     // the drag ended meanwhile: don't draw a stale trial
        await draw(next);
        if (pinDrag() !== now) return;
        now.shown = now.move.at;
        shiftDragged(now.id!, [0, 0]);
        paintDrag(now.parent ? { x0: now.parent.box.x0 + now.move.at[0], y0: now.parent.box.y0 + now.move.at[1], x1: now.parent.box.x0 + now.move.at[0] + now.size![0], y1: now.parent.box.y0 + now.move.at[1] + now.size![1] } : foot);
      }, 0);
    }
  }
  /**
   * The drawing with the dragged item pinned at its move. Siblings placed after it (in the flow, or beside it) would move
   * with it; any that did, and can be pinned, are kept where they stood, and the drop pins them too.
   */
  function trialLayout(g: NonNullable<typeof drag>): { next: D; keep: [string, [number, number]][] } {
    const base = JSON.parse(JSON.stringify(lastData ?? {})) as Record<string, Record<string, Record<string, unknown>>>;
    // pins kept under the legacy key are read there; the trial puts them where the drop will (x-editor)
    if (K.pins.legacyOnly(base)) { base[PINS_KEY] = base[K.pins.legacyKey!]; delete base[K.pins.legacyKey!]; }
    base[PINS_KEY] ??= {}; base[PINS_KEY].layout ??= {};
    const pins = base[PINS_KEY].layout;
    pins[g.name!] = { at: g.move!.at };
    let next = K.draw(lastS3!, base, opts.theme);
    const orig = g.origCd!, nameOf = new Map([...orig.pinId].map(([n, id]) => [id, n]));
    const me = orig.scene.layout.byId.get(g.id!)!;
    const sibs = me.parent ? me.parent.children : orig.scene.layout.items.filter(i => !i.parent);
    const keep: [string, [number, number]][] = [];
    for (const sb of sibs) {
      if (sb === me) continue;
      const n = nameOf.get(sb.id), was = localAt(orig.scene, sb.id), now = next.scene.layout.byId.get(sb.id)?.box;
      if (!n || !was || !now || n in pins) continue;
      if (Math.abs(now.x0 - sb.box.x0) > 1e-6 || Math.abs(now.y0 - sb.box.y0) > 1e-6) keep.push([n, was]);
    }
    if (keep.length) { for (const [n, at] of keep) pins[n] = { at }; next = K.draw(lastS3!, base, opts.theme); }
    return { next, keep };
  }
  /** move a drawn item, and everything standing on it, by a grid offset (a transform: the next layout replaces it) */
  function shiftDragged(id: string, [gx, gy]: [number, number]) {
    if (!svg || !cd) return;
    const [sx, sy] = [(gx - gy) * C * S, (gx + gy) * 0.5 * S];
    const ids = new Set([id]);
    for (const it of cd.scene.layout.items) { let p = it.parent; while (p) { if (p.id === id) { ids.add(it.id); break; } p = p.parent; } }
    for (const el of svg.querySelectorAll<SVGElement>('[data-id]')) {
      if (!ids.has(el.getAttribute('data-id') ?? '')) continue;
      if (el.parentElement?.closest(`[data-id="${CSS.escape(el.getAttribute('data-id')!)}"]`)) continue;
      el.setAttribute('transform', gx || gy ? `translate(${sx.toFixed(1)} ${sy.toFixed(1)})` : '');
    }
  }
  /** the drag's overlay: the grid on the parent's floor (half cells too, with ⌥), the drop target, the clamped edges */
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
    // the grid's lines, in the parent's frame: whole cells from its origin, and half cells while ⌥ is held
    const ox = g.parent ? g.parent.box.x0 : 0, oy = g.parent ? g.parent.box.y0 : 0;
    const st = g.step ?? 1;
    for (let v = Math.ceil((area.x0 - ox) / st) * st; ox + v <= area.x1 + 1e-9; v += st) line(ox + v, area.y0, ox + v, area.y1, Number.isInteger(v) ? 'dgrid' : 'dgrid sub');
    for (let v = Math.ceil((area.y0 - oy) / st) * st; oy + v <= area.y1 + 1e-9; v += st) line(area.x0, oy + v, area.x1, oy + v, Number.isInteger(v) ? 'dgrid' : 'dgrid sub');
    overlay.append(wrap);
    // the drop target: the footprint, accent where it may drop, red where it can't
    const t = d.createElementNS(SVGNS, 'polygon');
    t.setAttribute('class', `drop${g.invalid ? ' bad' : ''}`);
    t.setAttribute('points', [[foot.x0, foot.y0], [foot.x1, foot.y0], [foot.x1, foot.y1], [foot.x0, foot.y1]].map(([x, y]) => P(x, y)).join(' '));
    overlay.append(t);
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
  async function endPin(commit: boolean) {
    if (!pinDrag()) return;
    dropping++;
    try { await endDrop(commit); } finally { dropping--; }
  }
  async function endDrop(commit: boolean) {
    const g = pinDrag();
    if (!g) return;
    drag = undefined;
    clearTimeout(relayout);
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
    const moved = m && (m.at[0] !== g.start![0] || m.at[1] !== g.start![1]);
    if (commit && m && moved && !g.invalid) {
      // the item, and the neighbours the move would have pushed, kept where they stand: one command, one undo step
      const label = `Pin ${describe(fromPointer(g.ptr!))} at [${m.at.join(', ')}]`;
      let keep = g.keep ?? [];
      if (!g.shown || g.shown[0] !== m.at[0] || g.shown[1] !== m.at[1]) try { keep = trialLayout(g).keep; } catch { /* drop it as it is */ }
      run(doc, keep.length ? pinsCmd([[g.name!, m.at], ...keep], `${label} (${keep.map(([n]) => n).join(', ')} kept in place)`) : withPinsMoved(setCmd([PINS_KEY, 'layout', g.name!], { at: m.at }, label)), 'canvas', opts.note);
      if (pendingAfterDrag && lastS3) { pendingAfterDrag = false; lastKey = ''; render(lastS3, lastData); }
      return;
    }
    if (commit && g.invalid) opts.note(`${g.name} can't go there: it would overlap`, 'warn');
    await draw(g.origCd!);
    if (pendingAfterDrag && lastS3) { pendingAfterDrag = false; lastKey = ''; render(lastS3, lastData); }
  }

  function up(e: PointerEvent) {
    if (linking && !linking.pick) { const { x, y } = pageXY(e); endConnect(pathAtEvent(document.elementFromPoint(x, y))); return; }
    const d0 = drag;
    drag = undefined;
    svg?.classList.remove('panning');
    if (!d0) return;
    const { x, y } = pageXY(e);
    if ((d0.kind === 'marquee' && !d0.moved && !d0.add) || (d0.kind === 'pan' && d0.emptyClick)) doc.select([], 'canvas');
    const narrow = d0.kind === 'click' ? d0.ptr : d0.kind === 'pin' && !d0.moved ? d0.narrow : undefined;
    if (narrow) doc.select([fromPointer(narrow)], 'canvas');
    if (d0.kind === 'pin' && d0.moved) {
      // the last position the pointer reached, then the drop
      drag = d0;
      lastPin = { x, y, alt: e.altKey };
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
  const round = (v: number) => Math.round(v * 2) / 2;
  const snap = ([x, y]: [number, number]): [number, number] => [round(x), round(y)];
  const gridToScreen = (gx: number, gy: number): [number, number] => { const [ux, uy] = screenToGrid(1, 0), [vx, vy] = screenToGrid(0, 1); const det = ux * vy - uy * vx; return [(gx * vy - gy * vx) / det, (gy * ux - gx * uy) / det]; };

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
    openMenu(menuItems(ptr), { x, y }, 'Canvas');
  }
  function menuItems(ptr: string | undefined): MenuItem[] {
    const sel = doc.selection;
    const items: MenuItem[] = [];
    const ro = !doc.doc.ok;
    if (ptr === undefined || !sel.length) {
      for (const s of ui.newOrder) items.push({ label: `New ${kindOf(s).singular}`, icon: 'plus', disabled: ro, onSelect: () => addResource(s) });
      if (opts.clipItems) items.push({ sep: true }, ...opts.clipItems().filter(i => 'label' in i && i.label === 'Paste'));
      items.push({ sep: true }, { label: 'Fit', keys: '0', onSelect: () => fitItems() }, { label: 'Fit the whole drawing', onSelect: () => fit() }, { label: 'Zoom 100%', keys: '1', onSelect: () => actual() });
      const hasPins = !!K.pins.of(doc.goodDoc.data);
      items.push({ label: 'Reset layout', icon: 'rotate-ccw', desc: 'Remove every pin (x-editor.layout)', disabled: ro || !hasPins, why: 'Nothing is pinned', onSelect: resetLayout });
      return items;
    }
    const one = sel.length === 1 ? sel[0] : undefined;
    const isRes = one && resourceOf(toPointer(one))?.path === toPointer(one);
    if (one) {
      items.push(...K.objectItems(doc, one, 'canvas', opts.note));
      if (items.length) items.push({ sep: true });
      items.push({ label: 'Rename…', icon: 'pencil', keys: 'F2', disabled: ro || !isRes, why: T.renameWhy, onSelect: () => rename(one) });
      items.push({ label: 'Duplicate', icon: 'copy', keys: '⌘D', disabled: ro || !isRes, why: T.duplicateWhy, onSelect: () => duplicate(doc, one, 'canvas', opts.note) });
      const name = isRes ? resourceOf(toPointer(one))!.name : '';
      const pinned = !!K.pins.of(doc.goodDoc.data)?.[name];
      if (pinned) items.push({ label: 'Unpin', icon: 'rotate-ccw', desc: 'Let the layout place it again', onSelect: () => run(doc, withPinsMoved({ ...deleteCmd([PINS_KEY, 'layout', name]), label: `Unpin ${describe(one)}` }), 'canvas', opts.note) });
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
  /** Where a drop lands, as a pin: the new thing laid out once (a trial), then moved from where the layout put it to
   *  the point, in its parent's frame and on the grid. Undefined: the spot is taken, or it can't be placed. */
  function placeAt(name: string, add: Command, at: { x: number; y: number }): [number, number] | undefined {
    if (!cd || !svg) return undefined;
    const text = add.build(doc.text).steps.reduce((t, st) => applyStep(t, st), doc.text);
    let trial: D | undefined;
    try { trial = K.trial(text, opts.theme); } catch { return undefined; }
    if (!trial) return undefined;
    const id = trial.pinId.get(name), item = id ? trial.scene.layout.byId.get(id) : undefined, start = id ? localAt(trial.scene, id) : undefined;
    if (!item || !start) return undefined;
    const b = item.box, par = item.parent;
    // the drawing's coordinates are the projection's: the trial's centre and the drop point, in the same units
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const centre = [(cx - cy) * C * S, (cx + cy) * 0.5 * S - b.z0 * S], drop = toSvg(at.x, at.y);
    const m = snapMove(start, screenToGrid(drop.x - centre[0], drop.y - centre[1]), 1, [b.x1 - b.x0, b.y1 - b.y0],
      par ? { w: par.box.x1 - par.box.x0, d: par.box.y1 - par.box.y0, pad: paddingOf(K.catalog, par.region) } : undefined);
    const dx = m.at[0] - start[0], dy = m.at[1] - start[1];
    const moved = { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy };
    const siblings = (par ? par.children : trial.scene.layout.items.filter(i => !i.parent)).filter(i => i !== item).map(i => i.box);
    return overlaps(moved, siblings) ? undefined : m.at;
  }
  /** The container (of the kind given) whose floor a point is on (its footprint, as drawn), if any. */
  function containerAt(kind: string, at: { x: number; y: number }): string | undefined {
    if (!cd) return undefined;
    const p = toSvg(at.x, at.y);
    if (flat) {
      // 2D: the innermost panel of that kind under the point
      for (const id of flat.panelsAt(p.x, p.y)) {
        const name = [...cd.pinId].find(([, pid]) => pid === id)?.[0];
        if (name && resourceOf(cd.pathOf.get(id) ?? '')?.kind === kind) return name;
      }
      return undefined;
    }
    const inside = (poly: [number, number][]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > p.y) !== (yj > p.y) && p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi) c = !c; } return c; };
    for (const [name, id] of cd.pinId) {
      if (resourceOf(cd.pathOf.get(id) ?? '')?.kind !== kind) continue;
      const item = cd.scene.layout.byId.get(id);
      if (item && inside(floorOf(item.box))) return name;
    }
    return undefined;
  }
  /** (0.10.1) the objects whose drawn floor a point is on, innermost first: in 2D the panels under it; in 3D every placed
   *  thing whose floor holds the point, the deepest (then the smallest) first */
  function objectsUnder(at: { x: number; y: number }): ObjectRef[] {
    if (!cd) return [];
    const p = toSvg(at.x, at.y);
    const refOf = (id: string) => { const ptr = cd!.pathOf.get(id); const r = ptr === undefined ? undefined : resourceOf(ptr); return r && r.path === ptr ? r : undefined; };
    if (flat) return flat.panelsAt(p.x, p.y).map(refOf).filter((r): r is ObjectRef => !!r);
    const inside = (poly: [number, number][]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > p.y) !== (yj > p.y) && p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi) c = !c; } return c; };
    const depth = (i: { parent?: unknown }) => { let n = 0; for (let q = i.parent as { parent?: unknown } | undefined; q; q = q.parent as { parent?: unknown } | undefined) n++; return n; };
    // what is drawn under the point, topmost (innermost) first, as the eye sees it; then any whose floor holds the point
    const seen = new Map<string, ObjectRef>();
    for (const e of fdoc().elementsFromPoint(at.x, at.y)) {
      if (!svg?.contains(e)) continue;
      for (let el = e.closest('[data-id]'); el; el = el.parentElement?.closest('[data-id]') ?? null) {
        const r = refOf(el.getAttribute('data-id') ?? '');
        if (r && !seen.has(r.path)) seen.set(r.path, r);
      }
    }
    const hits: { r: ObjectRef; d: number; a: number }[] = [];
    for (const [, id] of cd.pinId) {
      const item = cd.scene.layout.byId.get(id), r = refOf(id);
      if (item && r && !seen.has(r.path) && inside(floorOf(item.box))) hits.push({ r, d: depth(item), a: (item.box.x1 - item.box.x0) * (item.box.y1 - item.box.y0) });
    }
    return [...seen.values(), ...hits.sort((x, y) => y.d - x.d || x.a - y.a).map(h => h.r)];
  }
  /** Add an object from the palette: dropped at a point, it is pinned there; dropped on a container the kit names, it
   *  is made inside it; else the layout places it. One command (one undo step); then it is selected and named. */
  function addFromPalette(sec: string, at?: { x: number; y: number }, item?: PaletteItem): Path | undefined {
    if (!doc.doc.ok) { opts.note('Fix the YAML first', 'warn'); return undefined; }
    const k = kindOf(sec);
    // (0.10.0) a palette entry's preset: what it starts as, and the base of its name
    const preset = item?.value?.() as Record<string, unknown> | undefined;
    const what = item && preset !== undefined ? item.label.toLowerCase() : k.singular;
    const name = freshName(doc.text, item?.name ?? k.singular);
    const p = [...k.section, name] as Path;
    let value = (preset ?? k.template()) as Record<string, unknown>;
    let into: string | undefined;
    const drop = at ? K.dropInto?.(sec) : undefined;
    if (at && drop) {
      const c = containerAt(drop.container, at);
      // dropped into a container: what puts it there, and the preset's own keys over it
      if (c) { into = c; value = { ...(drop.value(c) as Record<string, unknown>), ...(preset ?? {}) }; }
    }
    let intoLabel = into ? drop!.label(into) : '';
    // (0.10.1) the domain's rule: the innermost object under the drop that holds it
    if (at && !into && K.dropOnto) {
      for (const t of objectsUnder(at)) {
        const plan = K.dropOnto(t, value, sec, doc.goodDoc.data);
        if (plan) { into = t.name; value = plan.value as Record<string, unknown>; intoLabel = plan.label ? ` ${plan.label}` : ` in ${t.name}`; break; }
      }
    }
    const label = `Add ${what} ${name}${intoLabel}`;
    const add = insertCmd(p.slice(0, -1), name, value, { label });
    const pin = at && !into && mode === '3d' ? placeAt(name, add, at) : undefined;
    const cmd = pin ? seqCmd(`${label} at [${pin.join(', ')}]`, [add, withPinsMoved(setCmd([PINS_KEY, 'layout', name], { at: pin }))]) : add;
    if (!run(doc, { ...cmd, select: [p] }, 'canvas', opts.note)) return undefined;
    if (at && !into && !pin) opts.note(mode === '2d' ? `${k.singular} ${name} added; the layout placed it (in 3D a drop pins it where it lands)` : `${k.singular} ${name} added; that spot is taken, so the layout placed it`);
    doc.select([p], 'canvas');
    // (0.12.5) its name, in the inline field above it; the drop and the name are one undo step
    rename(p, { joins: doc.undoId, at });
    return p;
  }
  const palette = h('div', { class: 'palette', role: 'toolbar', 'aria-label': T.palette, 'aria-orientation': 'vertical' });
  // (0.11.0) sections: a header (a button, aria-expanded) over its entries; open: the section last added from (the
  // first, before any); the reader opens and closes the others as they like. The host's store may be off: guarded.
  const sections = new Map<string, { head: HTMLButtonElement; body: HTMLElement }>();
  const PAL_KEY = 'canvas-palette';
  let lastSection: string | undefined;
  try { const v = JSON.parse(opts.store?.get(PAL_KEY) ?? '{}') as { last?: unknown }; if (typeof v.last === 'string') lastSection = v.last; } catch { /* none */ }
  const named = [...new Set(ui.palette.map(i => i.section).filter((x): x is string => x !== undefined))];
  const openAtStart = lastSection !== undefined && named.includes(lastSection) ? lastSection : named[0];
  const setOpen = (sec: string, open: boolean) => { const g = sections.get(sec); if (!g) return; g.head.setAttribute('aria-expanded', String(open)); g.body.hidden = !open; };
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
      let ghost: HTMLElement | undefined;
      const over = (ev: PointerEvent) => { const r = stage.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom && !palHome.contains(document.elementFromPoint(ev.clientX, ev.clientY)); };
      const mv = (ev: PointerEvent) => {
        if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
        if (!ghost) { ghost = h('div', { class: 'pal-ghost', 'aria-hidden': 'true' }, icon(ic), label); host.append(ghost); }
        const hr = host.getBoundingClientRect();
        ghost.style.left = `${ev.clientX - hr.left + 8}px`; ghost.style.top = `${ev.clientY - hr.top + 8}px`;
        ghost.classList.toggle('bad', !over(ev));
      };
      const done = (ev: PointerEvent, drop: boolean) => {
        b.removeEventListener('pointermove', mv); b.removeEventListener('pointerup', upH); b.removeEventListener('pointercancel', cancelH); removeEventListener('keydown', esc, true);
        const dragged = !!ghost;
        ghost?.remove();
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
      case 'Escape': if (linking) { linking = undefined; paintOverlay(); opts.note('Not connected'); break; } if (pinDrag()) { endPin(false); break; } doc.select([], 'canvas'); break;
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
  ifEvents();
  doc.onSelect(c => {
    paintOverlay();
    if (c.origin === 'canvas' || !c.paths.length) return;
    // a selection made elsewhere (the tree, a paste): shown here, once it is drawn
    pendingReveal = reveal(c.paths) ? undefined : c.paths;
  });

  const base = {
    addFromPalette, palette, groupSelection, startPick, objectsUnder, get linking() { return linking; },
    render, setTheme, paintOverlay, fit: fitItems, fitNext() { toFit = true; }, fitAll: fit, actual, zoomAt, itemsBox, routesBox, get moved() { return V.moved; }, settled, get zoom() { return V.zoom; },
    dispose() { endMorph(); clearTimeout(relayout); V.dispose(); disposed = true; },
    focus: () => stage.focus(),
    /** for the tests */
    get view() { return V.view; },
    get doc() { return cd; },
    /** the view (3D or 2D), and the 2D layout while it shows */
    get mode() { return mode; }, setMode, get flat() { return flat?.layout; },
    stage, key, scale: () => scale(), nav, paintNav, outlinesFor, footprints, get drag() { return pinDrag(); }, get lastMarquee() { return lastMarquee; },
    boxFor, pageXYOf: (p: Path) => { const b = boxFor(p); const r = viewEl.getBoundingClientRect(); const k = scale(); return b && V.view ? { x: r.left + (b.x + b.w / 2 - V.view.x) * k, y: r.top + (b.y + b.h / 2 - V.view.y) * k } : undefined; },
  };
  // the layer's calls, as they are (its getters stay getters)
  if (layer) Object.defineProperties(base, Object.getOwnPropertyDescriptors(layer.api));
  return base as typeof base & A;
}
