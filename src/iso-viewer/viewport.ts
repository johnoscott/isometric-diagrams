// The view of a drawn scene (docs/editor/LAYERS.md §2): pan and zoom (10%–800%), fit, the page ↔ drawing coordinates,
// and v0.4.2's rule: the view is fitted until the person moves it (a zoom, a pan, 100%, a reveal); after that it is
// theirs. Fit fits again and gives it back. Changes the view makes itself go through quietly(). A resize keeps a moved
// view's zoom and re-centres it; a fitted view is fitted again. The overlay's marks keep their size on screen, so a
// new zoom (past 2%) asks for them to be drawn again (onRezoom), and a fit with marks showing repeats until it holds.
// Moved here from the editor canvas (R1 S4); the canvas owns the drawing, the overlay and the pointer.

export type View = { x: number; y: number; w: number; h: number };
/** (0.12.6) how far inside the stage what must be on it is, px */
const INSET = 6;
/** What a fit makes of a stage (px) and what it frames, `box` PAD px inside it, and what must be on it too, `also` INSET px inside:
 *  the zoom and the middle. Pure. */
export function fitted(s: { w: number; h: number }, box: View, also?: View): { k: number; cx: number; cy: number } {
  const pad = 24;
  // along one axis: the most zoom that `box`, and `also`, and the one's end and the other's together, allow
  const most = (len: number, a0: number, a1: number, b0?: number, b1?: number) => Math.min((len - pad * 2) / (a1 - a0), ...(b0 === undefined || b1 === undefined ? [] : [[b1 - b0, INSET * 2], [b1 - a0, pad + INSET], [a1 - b0, pad + INSET]].map(([d, edges]) => (d > 0 ? (len - edges) / d : Infinity))));
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(most(s.w, box.x, box.x + box.w, also?.x, also && also.x + also.w), most(s.h, box.y, box.y + box.h, also?.y, also && also.y + also.h))));
  // the middle of `box`, moved only as far as `also` needs
  const middle = (len: number, a0: number, a1: number, b0?: number, b1?: number) => {
    const c = (a0 + a1) / 2;
    if (b0 === undefined || b1 === undefined) return c;
    const lo = b1 - (len / 2 - INSET) / k, hi = b0 + (len / 2 - INSET) / k;
    return lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, c));
  };
  return { k, cx: middle(s.w, box.x, box.x + box.w, also?.x, also && also.x + also.w), cy: middle(s.h, box.y, box.y + box.h, also?.y, also && also.y + also.h) };
}
export const MIN_ZOOM = 0.1, MAX_ZOOM = 8;

export interface ViewportOpts {
  /** the drawing on the stage (its viewBox is the view), if any */
  svg(): SVGSVGElement | undefined;
  /** after each change of the view, at its zoom (pixels per unit): the host's zoom readout */
  onApply(k: number): void;
  /** the marks drawn at another zoom: draw them again */
  onRezoom(): void;
  /** what a fit frames (the drawing's own things, the overlay's shown marks), if not the whole scene */
  itemsBox(): View | undefined;
  /** (0.12.6) what must be on the stage too when the things are fitted (the connectors), a few px from its edges */
  alsoBox?(): View | undefined;
  /** the overlay has marks that keep their size on screen (a fit repeats while they are showing) */
  marksShowing(): boolean;
}

export function viewport(host: HTMLElement, o: ViewportOpts) {
  let view: View | undefined, full: View | undefined;
  let moved = false, quiet = 0, keptK = 0;
  let paintedK = 0, rezoom = 0, resizeFrame = 0, disposed = false;

  const size = () => { const r = host.getBoundingClientRect(); return { w: Math.max(1, r.width), h: Math.max(1, r.height) }; };
  /** pixels per SVG unit (the scale preserveAspectRatio meet gives) */
  const scale = (v = view!) => { const s = size(); return Math.min(s.w / v.w, s.h / v.h); };
  const quietly = (f: () => void) => { quiet++; try { f(); } finally { quiet--; } };
  function applyView() {
    const svg = o.svg();
    if (!svg || !view) return;
    if (!quiet) moved = true;
    // keep the view's aspect the host's, so the readout's zoom is exact
    const s = size(), k = scale();
    const vw = s.w / k, vh = s.h / k;
    view = { x: view.x + (view.w - vw) / 2, y: view.y + (view.h - vh) / 2, w: vw, h: vh };
    svg.setAttribute('viewBox', `${view.x.toFixed(2)} ${view.y.toFixed(2)} ${view.w.toFixed(2)} ${view.h.toFixed(2)}`);
    keptK = k;
    o.onApply(k);
    // the overlay's marks keep their size on screen: drawn again once the zoom has settled at a new scale
    if (paintedK && Math.abs(k / paintedK - 1) > 0.02) { cancelAnimationFrame(rezoom); rezoom = requestAnimationFrame(() => { rezoom = 0; o.onRezoom(); }); }
  }
  /** client (page) point → SVG point */
  const toSvg = (cx: number, cy: number) => {
    const r = host.getBoundingClientRect(), k = scale();
    return { x: view!.x + (cx - r.left) / k, y: view!.y + (cy - r.top) / k };
  };
  function zoomAt(f: number, cx?: number, cy?: number) {
    if (!view) return;
    const k = scale(), nk = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k * f));
    const r = host.getBoundingClientRect();
    const px = cx ?? r.left + r.width / 2, py = cy ?? r.top + r.height / 2;
    const p = toSvg(px, py);
    const s = size();
    view = { x: p.x - (px - r.left) / nk, y: p.y - (py - r.top) / nk, w: s.w / nk, h: s.h / nk };
    applyView();
  }
  /** `also` (0.12.6): what must be on the stage too, INSET px from its edges, and nothing more: the zoom and the middle change only as
   *  much as that takes (not at all where it is inside already) */
  function fit(box = full, also?: View) {
    if (!box) return;
    const s = size(), { k, cx, cy } = fitted(s, box, also);
    const next = { x: cx - s.w / k / 2, y: cy - s.h / k / 2, w: s.w / k, h: s.h / k };
    // v0.4.2: a fit that lands where the view already is (a refit after a resize that changed nothing it fits) leaves
    // it alone: no new zoom by a rounding error, so nothing on the overlay is redrawn
    if (view && Math.abs(next.w / view.w - 1) < 1e-3 && Math.abs(next.h / view.h - 1) < 1e-3 && Math.abs(next.x - view.x) < next.w * 1e-3 && Math.abs(next.y - view.y) < next.h * 1e-3) { applyView(); return; }
    view = next;
    applyView();
  }
  /** Fit the drawing's things with a margin. */
  function fitItems() {
    // the overlay's marks keep their size on screen, so in the drawing's units they grow as the view zooms out: fit,
    // draw the marks at the new zoom, and fit again until the box holds still (a few rounds at most)
    for (let round = 0, last = ''; round < 4; round++) {
      const b = o.itemsBox() ?? full;
      if (!b) return;
      const key = [b.x, b.y, b.w, b.h].map(n => Math.round(n)).join();
      if (key === last) break;
      last = key;
      const m = Math.max(24, Math.min(b.w, b.h) * 0.06);
      quietly(() => fit({ x: b.x - m, y: b.y - m, w: b.w + m * 2, h: b.h + m * 2 }, o.alsoBox?.()));
      // the marks are redrawn for a new zoom only past the same 2% the zoom itself uses (applyView's rezoom)
      if (!o.marksShowing() || !paintedK || Math.abs(scale() / paintedK - 1) <= 0.02) break;
      cancelAnimationFrame(rezoom); rezoom = 0;
      o.onRezoom();
    }
    moved = false;
  }
  /** v0.4.2: fit, unless the person has moved the view; not before the stage has a size (a hidden or unlaid-out host) */
  function autoFit() {
    if (moved || !o.svg() || !view) return;
    const r = host.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    fitItems();
  }
  function actual() { if (!view) return; const k = scale(); zoomAt(1 / k); }
  /** v0.4.2: resolves once the view has settled: no refit or overlay repaint waiting, and the zoom unchanged, for two
   *  frames in a row. The overlay's marks keep their size on screen, so a new zoom redraws them; a test (or a host)
   *  that measures the overlay waits for this first. */
  function settled(): Promise<void> {
    return new Promise(res => {
      let calm = 0, k0 = keptK;
      const tick = () => {
        if (disposed) { res(); return; }
        const busy = !!(rezoom || resizeFrame) || keptK !== k0;
        k0 = keptK; calm = busy ? 0 : calm + 1;
        if (calm >= 2) res(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  // a resize: until the person has moved the view it stays fitted (the host's layout settling, narrow ↔ wide); after,
  // their zoom is kept, and the view is only re-centred to the new size
  const resizes = new ResizeObserver(() => {
    if (!view || disposed) return;
    // their zoom kept: the view re-centred at the same scale for the new size
    if (moved && keptK) { const sz = size(), cx = view.x + view.w / 2, cy = view.y + view.h / 2; view = { x: cx - sz.w / keptK / 2, y: cy - sz.h / keptK / 2, w: sz.w / keptK, h: sz.h / keptK }; }
    if (!moved) { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; if (!disposed) autoFit(); }); }
    quietly(applyView);
  });
  resizes.observe(host);

  return {
    /** the view (the drawing's units): set by a pan or a reveal, then applyView() */
    get view() { return view; }, set view(v: View | undefined) { view = v; },
    /** the scene's whole frame */
    get full() { return full; }, set full(v: View | undefined) { full = v; },
    /** the person has moved the view since the last fit */
    get moved() { return moved; },
    /** the zoom the view was last applied at */
    get zoom() { return keptK; },
    /** the marks were drawn at this zoom (0: none drawn) */
    painted(k: number) { paintedK = k; },
    size, scale, quietly, applyView, toSvg, zoomAt, fit, fitItems, autoFit, actual, settled,
    dispose() { cancelAnimationFrame(resizeFrame); cancelAnimationFrame(rezoom); resizes.disconnect(); disposed = true; },
  };
}
export type Viewport = ReturnType<typeof viewport>;
