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
import { screenToGrid, localAt, boxSilhouette, floorOf, snapMove, overlaps, paddingOf, type Move } from '../../iso-objects/geometry.ts';
import { regionKind, type KindCatalog } from '../../iso-objects/kinds.ts';
import type { CompiledScene } from '../../iso-objects/compile.ts';
import { iso, C, S } from '../../iso-core/kernel.ts';
import type { EditorModel, Command } from '../model.ts';
import type { Problem } from '../validate.ts';
import { applyStep } from '../splice.ts';
import { seqCmd, type Commands } from '../commands.ts';
import type { ObjectKindInfo, ObjectRef } from '../adapter.ts';
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
  palette: { kind: string; icon: IconName; label: string }[];
  text: {
    stage: string; dragGroup: string; dragSelectTip: string; unreadable: string; palette: string;
    /** the end of a pin drag's hint */
    pinHint: string; renameWhy: string; duplicateWhy: string;
  };
}
/** what the canvas is given of the domain (M: the domain's reading of the file; D: its drawing) */
export interface CanvasKit<M, D extends CanvasDrawing> {
  draw(model: M, data: unknown, theme: string): D;
  /** the drawing a text would be (a trial: where a drop lands), or undefined */
  trial(text: string, theme: string): D | undefined;
  catalog: KindCatalog;
  objectOf(ptr: string): ObjectRef | undefined;
  kinds: ObjectKindInfo[];
  commands: Pick<Commands, 'setCmd' | 'deleteCmd' | 'insertCmd' | 'pinsCmd' | 'withPinsMoved' | 'describe' | 'freshName'>;
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
  const { setCmd, deleteCmd, insertCmd, pinsCmd, withPinsMoved, freshName, describe } = K.commands;
  const { deletePaths, renameDialog, duplicate, connected } = K.actions;
  const resourceOf = (ptr: string) => K.objectOf(ptr);
  const kindOf = (k: string) => K.kinds.find(x => x.kind === k)!;
  const PINS_KEY = K.pins.key;
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
    if (key === lastKey && svg) { if (!pinDrag()) paintOverlay(); return; }
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
    if (!V.view) { V.view = { ...V.full }; autoFit(); } else quietly(applyView);
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
  const V = viewport(host, {
    svg: () => svg,
    onApply: k => {
      svg!.classList.toggle('zoom-near', k >= 1);          // a layer's detail shows from 100% up
      const pct = Math.round(k * 100);
      zoomLabel.textContent = `${pct}%`;
      opts.onZoom(pct);
    },
    onRezoom: () => paintOverlay(),
    itemsBox: () => itemsBox(),
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
    stage.addEventListener('dblclick', e => { const p = pathAtEvent(e.target); if (p !== undefined) opts.showInText(fromPointer(p)); });
  };
  // in the page, a pointer's coordinates are already the page's
  const pageXY = (e: PointerEvent | MouseEvent) => ({ x: e.clientX, y: e.clientY });
  /** a drag keeps its pointer's events when the pointer leaves the stage (a synthetic pointer can't be captured) */
  const capture = (e: PointerEvent) => { try { stage.setPointerCapture(e.pointerId); } catch { /* not a real pointer */ } };

  function down(e: PointerEvent) {
    stage.focus({ preventScroll: true });
    if (layer?.down?.(e)) return;
    const { x, y } = pageXY(e);
    if (e.button === 0 || e.button === 1) capture(e);
    const pan = () => { drag = { kind: 'pan', x0: x, y0: y, v0: { ...V.view! } }; svg?.classList.add('panning'); e.preventDefault(); };
    if (e.button === 1 || spaceKeyDown) { pan(); return; }
    if (e.button !== 0) return;
    const ptr = pathAtEvent(e.target);
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
    if (!drag) {
      const p = pathAtEvent(e.target);
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
  async function endPin(commit: boolean) {
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
    const ptr = pathAtEvent(e.target);
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
      items.push({ label: 'Rename…', icon: 'pencil', keys: 'F2', disabled: ro || !isRes, why: T.renameWhy, onSelect: () => renameDialog(doc, one, 'canvas', opts.note) });
      items.push({ label: 'Duplicate', icon: 'copy', keys: '⌘D', disabled: ro || !isRes, why: T.duplicateWhy, onSelect: () => duplicate(doc, one, 'canvas', opts.note) });
      const name = isRes ? resourceOf(toPointer(one))!.name : '';
      const pinned = !!K.pins.of(doc.goodDoc.data)?.[name];
      if (pinned) items.push({ label: 'Unpin', icon: 'rotate-ccw', desc: 'Let the layout place it again', onSelect: () => run(doc, withPinsMoved({ ...deleteCmd([PINS_KEY, 'layout', name]), label: `Unpin ${describe(one)}` }), 'canvas', opts.note) });
      items.push({ sep: true });
      items.push({ label: 'Show in text', icon: 'code-xml', onSelect: () => opts.showInText(one) });
      items.push({ label: 'Show in tree', icon: 'list-tree', onSelect: () => opts.showInTree(one) });
    }
    items.push({ label: 'Select parent', icon: 'arrow-up-right', keys: '⌘↑', onSelect: selectParent });
    items.push({ label: 'Select connected', icon: 'link', desc: 'What refers to it, and what it refers to', onSelect: () => doc.select(connected(doc, sel), 'canvas') });
    items.push({ label: 'Zoom to selection', keys: '⇧2', onSelect: zoomToSelection });
    if (opts.clipItems) items.push({ sep: true }, ...opts.clipItems());
    items.push({ sep: true }, { label: sel.length > 1 ? `Delete ${sel.length} items` : 'Delete', icon: 'trash-2', keys: '⌫', danger: true, disabled: ro, onSelect: () => deletePaths(doc, sel, 'canvas', opts.note) });
    return items;
  }
  function addResource(s: string) {
    const k = kindOf(s);
    const name = freshName(doc.text, k.singular);
    const p = [...k.section, name];
    if (run(doc, insertCmd(p.slice(0, -1), name, k.template(), { label: `Add ${k.singular} ${name}` }), 'canvas', opts.note)) {
      doc.select([p], 'canvas');
      renameDialog(doc, p, 'canvas', opts.note);
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
  /** Add an object from the palette: dropped at a point, it is pinned there; dropped on a container the kit names, it
   *  is made inside it; else the layout places it. One command (one undo step); then it is selected and named. */
  function addFromPalette(sec: string, at?: { x: number; y: number }): Path | undefined {
    if (!doc.doc.ok) { opts.note('Fix the YAML first', 'warn'); return undefined; }
    const k = kindOf(sec);
    const name = freshName(doc.text, k.singular);
    const p = [...k.section, name] as Path;
    let value = k.template() as Record<string, unknown>;
    let into: string | undefined;
    const drop = at ? K.dropInto?.(sec) : undefined;
    if (at && drop) {
      const c = containerAt(drop.container, at);
      if (c) { into = c; value = drop.value(c) as Record<string, unknown>; }
    }
    const label = `Add ${k.singular} ${name}${into ? drop!.label(into) : ''}`;
    const add = insertCmd(p.slice(0, -1), name, value, { label });
    const pin = at && !into && mode === '3d' ? placeAt(name, add, at) : undefined;
    const cmd = pin ? seqCmd(`${label} at [${pin.join(', ')}]`, [add, withPinsMoved(setCmd([PINS_KEY, 'layout', name], { at: pin }))]) : add;
    if (!run(doc, { ...cmd, select: [p] }, 'canvas', opts.note)) return undefined;
    if (at && !into && !pin) opts.note(mode === '2d' ? `${k.singular} ${name} added; the layout placed it (in 3D a drop pins it where it lands)` : `${k.singular} ${name} added; that spot is taken, so the layout placed it`);
    doc.select([p], 'canvas');
    renameDialog(doc, p, 'canvas', opts.note);
    return p;
  }
  const palette = h('div', { class: 'palette', role: 'toolbar', 'aria-label': T.palette, 'aria-orientation': 'vertical' });
  for (const { kind: sec, icon: ic, label } of ui.palette) {
    const b = h('button', { type: 'button', class: 'pal-item', 'data-section': sec, title: `Add ${label.toLowerCase()} (click), or drag it where it goes` }, icon(ic), h('span', { class: 'pal-label' }, label));
    b.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer: the events come to the button anyway */ }
      const x0 = e.clientX, y0 = e.clientY;
      let ghost: HTMLElement | undefined;
      const over = (ev: PointerEvent) => { const r = stage.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom && !palette.contains(document.elementFromPoint(ev.clientX, ev.clientY)); };
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
        if (!dragged) addFromPalette(sec);
        else if (over(ev)) addFromPalette(sec, { x: ev.clientX, y: ev.clientY });
      };
      const upH = (ev: PointerEvent) => done(ev, true), cancelH = (ev: PointerEvent) => done(ev, false);
      const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); done(e, false); } };
      b.addEventListener('pointermove', mv); b.addEventListener('pointerup', upH); b.addEventListener('pointercancel', cancelH); addEventListener('keydown', esc, true);
    });
    // the keyboard: Enter or the space key adds (the layout places it)
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addFromPalette(sec); } });
    palette.append(b);
  }
  host.append(palette);

  function resetLayout() {
    // wherever the pins are (x-editor, or the legacy key): removed, and their key too if it holds nothing else
    const key = K.pins.keyOf(doc.goodDoc.data);
    const x = (doc.goodDoc.data as Record<string, Record<string, unknown>> | undefined)?.[key];
    const only = x && Object.keys(x).length === 1;
    run(doc, { ...deleteCmd(only ? [key] : [key, 'layout']), label: 'Reset the layout' }, 'canvas', opts.note);
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
      case 'Escape': if (pinDrag()) { endPin(false); break; } doc.select([], 'canvas'); break;
      case 'Delete': case 'Backspace': if (sel.length && !ro) deletePaths(doc, sel, 'canvas', opts.note); break;
      case 'F2': if (sel.length === 1 && !ro) renameDialog(doc, sel[0], 'canvas', opts.note); break;
      case 'ArrowUp': if (mod) { selectParent(); break; } return;
      case 'Tab': case 'ArrowRight': case 'ArrowLeft': case 'ArrowDown': {
        // move through what is drawn, in the file's order
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
        { const b = unionBox(sel); const r = host.getBoundingClientRect(); const k = scale(); openMenu(menuItems(sel.length ? toPointer(sel[0]) : undefined), b ? { x: r.left + (b.x + b.w - V.view!.x) * k, y: r.top + (b.y - V.view!.y) * k } : { x: r.left + 40, y: r.top + 40 }, 'Canvas'); }
        break;
      default:
        if (mod && e.key.toLowerCase() === 'd' && sel.length === 1 && !ro) { duplicate(doc, sel[0], 'canvas', opts.note); break; }
        if (mod && e.key.toLowerCase() === 'a') { doc.select(drawn.map(fromPointer), 'canvas'); break; }
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
    addFromPalette, palette,
    render, setTheme, paintOverlay, fit: fitItems, fitAll: fit, actual, zoomAt, itemsBox, get moved() { return V.moved; }, settled, get zoom() { return V.zoom; },
    dispose() { endMorph(); clearTimeout(relayout); V.dispose(); disposed = true; },
    focus: () => stage.focus(),
    /** for the tests */
    get view() { return V.view; },
    get doc() { return cd; },
    /** the view (3D or 2D), and the 2D layout while it shows */
    get mode() { return mode; }, setMode, get flat() { return flat?.layout; },
    stage, key, scale: () => scale(), nav, paintNav, outlinesFor, footprints, get drag() { return pinDrag(); }, get lastMarquee() { return lastMarquee; },
    boxFor, pageXYOf: (p: Path) => { const b = boxFor(p); const r = host.getBoundingClientRect(); const k = scale(); return b && V.view ? { x: r.left + (b.x + b.w / 2 - V.view.x) * k, y: r.top + (b.y + b.h / 2 - V.view.y) * k } : undefined; },
  };
  // the layer's calls, as they are (its getters stay getters)
  if (layer) Object.defineProperties(base, Object.getOwnPropertyDescriptors(layer.api));
  return base as typeof base & A;
}
