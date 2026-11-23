// One drawing in two views (0.6.0): the engine's 3D scene and its 2D layout, with an animated morph between them both
// ways, and the 3D | 2D switch. Both views carry the same data-id on things and data-a / data-b on connectors, so a
// selection (and its highlighted connectors) holds in either, and through the switch.
//
// The morph (about 600 ms): the connectors fade out; each thing (matched by data-id) moves and resizes from where it
// is in one view to where it is in the other, its 3D top face becoming (or coming from) the 2D card while the rest of
// it cross-fades; the new view's connectors draw in. It runs on a layer of its own over both views; when it ends, or
// is interrupted by another switch, the layer goes and the final view is shown exactly. With prefers-reduced-motion the
// switch is instant, unless the host says `motion: 'always'` ('never': always instant).

import { parseEnd } from '../iso-objects/route.ts';
import type { CompiledScene } from '../iso-objects/compile.ts';
import { boardOf } from '../iso-objects/board.ts';
import { layoutFlat, type Board, type FlatLayout, type FlatOptions } from '../iso-objects/flat.ts';
import { flatSvg, measureIn, type FlatStyle } from './flat-view.ts';
import { buildLayer, clamp, ease, markConnectors, type ViewMode } from './morph.ts';

export type { ViewMode } from './morph.ts';
export interface DualViewOptions {
  mode?: ViewMode;
  /** the board the 2D view draws; default: boardOf(scene) */
  board?: Board;
  /** link kinds' styles in 2D */
  styles?: Record<string, FlatStyle>;
  flat?: Partial<FlatOptions>;
  /** the svg's label */
  title?: string;
  onSelect?(id: string | undefined): void;
  /** the morph's length, ms */
  duration?: number;
  /** whether a switch animates (0.7.3): 'auto' honours prefers-reduced-motion (the default), 'always' morphs
   *  regardless (a host's deliberate choice for a switch the user asked for), 'never' always swaps at once */
  motion?: 'auto' | 'always' | 'never';
}
export interface DualView {
  readonly mode: ViewMode;
  readonly layout: FlatLayout;
  readonly root: HTMLElement;
  /** switch view, animated (instant with reduced motion); resolves when the view is shown */
  morph(to: ViewMode): Promise<void>;
  select(id: string | undefined): void;
  readonly selected: string | undefined;
  /** the svg of a view */
  svgOf(mode: ViewMode): SVGSVGElement;
  destroy(): void;
}

let seq = 0;

/** the scene in both views, in `host`: the 3D drawing as the engine rendered it, the 2D one laid out from its board */
export function dualView(host: HTMLElement, scene: CompiledScene, opts: DualViewOptions = {}): DualView {
  const uid = `dv${++seq}`;
  const root = document.createElement('div');
  root.className = 'dual-view';
  root.style.position = 'relative';
  host.appendChild(root);
  const wrap3 = document.createElement('div'), wrap2 = document.createElement('div');
  wrap3.className = 'dual-3d'; wrap2.className = 'dual-2d';
  root.append(wrap3, wrap2);
  wrap3.innerHTML = scene.rendered.svg;
  const svg3 = wrap3.querySelector('svg') as SVGSVGElement;
  svg3.setAttribute('data-view', '3d');
  const board = opts.board ?? boardOf(scene);
  markConnectors(svg3, scene, board);
  const routeIds = new Set(scene.routes.map(r => r.id));
  // 3D things are reachable by keyboard, as the 2D cards are
  for (const g of svg3.querySelectorAll('g[data-id]')) {
    const id = g.getAttribute('data-id')!;
    if (routeIds.has(id) || g.hasAttribute('tabindex') || !g.querySelector('polygon')) continue;
    g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button'); g.setAttribute('aria-label', id);
  }
  const measure = measureIn(wrap2);
  const layout = layoutFlat(board, measure, opts.flat);
  measure.dispose();
  wrap2.innerHTML = flatSvg(layout, { id: uid, title: opts.title, styles: opts.styles });
  const svg2 = wrap2.querySelector('svg') as SVGSVGElement;
  for (const s of [svg3, svg2]) { s.style.display = 'block'; s.style.width = '100%'; s.style.height = 'auto'; }
  if (opts.title) svg3.setAttribute('aria-label', opts.title);

  let mode: ViewMode = opts.mode ?? '3d', sel: string | undefined;
  const wrapOf = (m: ViewMode) => (m === '3d' ? wrap3 : wrap2);
  const svgOf = (m: ViewMode) => (m === '3d' ? svg3 : svg2);
  const show = (m: ViewMode) => {
    wrap3.hidden = m !== '3d'; wrap2.hidden = m !== '2d';
    for (const w of [wrap3, wrap2]) w.style.cssText = '';
    root.style.height = '';
    root.dataset.mode = m;
  };
  show(mode);

  const paint = () => {
    for (const s of [svg3, svg2]) {
      for (const e of s.querySelectorAll('[data-id]')) e.classList.toggle('sel', !!sel && e.getAttribute('data-id') === sel);
      for (const e of s.querySelectorAll('[data-a]')) {
        const on = !!sel && (e.getAttribute('data-a') === sel || e.getAttribute('data-b') === sel);
        e.classList.toggle('hot', on); e.classList.toggle('dim', !!sel && !on);
        const lab = s.querySelector(`[data-for="${CSS.escape(e.getAttribute('data-id') ?? '')}"]`);
        lab?.classList.toggle('dim', !!sel && !on);
      }
    }
  };
  const select = (id: string | undefined) => { sel = id; paint(); };
  const onClick = (e: Event) => {
    const g = (e.target as Element).closest?.('[data-id]');
    if (!g || !root.contains(g) || g.hasAttribute('data-a')) return;
    const id = g.getAttribute('data-id')!;
    select(id); opts.onSelect?.(id);
  };
  const onKey = (e: KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && (e.target as Element).matches?.('[data-id][tabindex]')) { e.preventDefault(); onClick(e); } };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);

  // ---- the morph ----
  let run: { frame: number; layer: SVGSVGElement; to: ViewMode; done: () => void } | undefined;
  const finish = () => {
    if (!run) return;
    cancelAnimationFrame(run.frame);
    run.layer.remove();
    const r = run; run = undefined;
    mode = r.to; show(mode); paint();
    r.done();
  };
  const focusSelected = (had: boolean) => {
    if (!had || !sel) return;
    (svgOf(mode).querySelector(`[data-id="${CSS.escape(sel)}"][tabindex]`) as SVGElement | null)?.focus({ preventScroll: true });
  };
  const morph = (to: ViewMode): Promise<void> => {
    const hadFocus = root.contains(document.activeElement);
    if (run) finish();
    if (to === mode) { focusSelected(hadFocus); return Promise.resolve(); }
    const motion = opts.motion ?? 'auto';
    const reduced = motion === 'never' || (motion === 'auto' && typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (reduced || !(opts.duration ?? 600)) { mode = to; show(mode); paint(); focusSelected(hadFocus); return Promise.resolve(); }
    return new Promise<void>(resolve => {
      const from = mode;
      // both views laid out, stacked; the layer draws everything while it runs
      const h0 = root.getBoundingClientRect().height;
      wrap3.hidden = false; wrap2.hidden = false;
      for (const w of [wrap3, wrap2]) w.style.cssText = 'position:absolute;left:0;top:0;right:0;visibility:hidden';
      const h1 = wrapOf(to).getBoundingClientRect().height;
      root.style.height = `${h0}px`;
      const layer = buildLayer(root, svgOf(from), svgOf(to), from);
      root.appendChild(layer.svg);
      const T = opts.duration ?? 600, t0 = performance.now();
      // each frame is this run's: a frame left over from a run already finished does nothing
      const me = { frame: 0, layer: layer.svg, to, done: () => { focusSelected(hadFocus); resolve(); } };
      const step = (now: number) => {
        if (run !== me) return;
        const t = Math.min(1, (now - t0) / T);
        layer.at(t);
        root.style.height = `${h0 + (h1 - h0) * ease(clamp((t - 0.2) / 0.6))}px`;
        if (t < 1) me.frame = requestAnimationFrame(step);
        else finish();
      };
      run = me;
      me.frame = requestAnimationFrame(step);
    });
  };

  return {
    get mode() { return run ? run.to : mode; },
    layout, root,
    morph, select,
    get selected() { return sel; },
    svgOf,
    destroy() { if (run) finish(); root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKey); root.remove(); },
  };
}

// ---- the switch ----

/** the view a page last showed (localStorage), if any */
export function storedMode(key = 'iso-view'): ViewMode | undefined {
  try { const v = localStorage.getItem(key); return v === '2d' || v === '3d' ? v : undefined; } catch { return undefined; }
}

/** the 3D | 2D switch: two buttons (aria-pressed), the choice remembered in localStorage; it switches every view given */
export function viewToggle(host: HTMLElement, views: DualView | DualView[], opts: { storageKey?: string; labels?: [string, string] } = {}): HTMLElement {
  const key = opts.storageKey ?? 'iso-view', list = Array.isArray(views) ? views : [views];
  const box = document.createElement('div');
  box.className = 'view-switch';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Drawing view');
  const btns = (['3d', '2d'] as ViewMode[]).map((m, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.mode = m; b.textContent = (opts.labels ?? ['3D', '2D'])[i];
    b.addEventListener('click', () => {
      try { localStorage.setItem(key, m); } catch { /* storage may be off */ }
      paint(m);
      for (const v of list) void v.morph(m);
    });
    box.appendChild(b);
    return b;
  });
  const paint = (m: ViewMode) => btns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  paint(list[0]?.mode ?? '3d');
  host.appendChild(box);
  return box;
}

/** the switch's and the views' own CSS (unscoped) */
export const DUAL_VIEW_CSS = `
.view-switch{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface);font:600 12px/1 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.12)}
.view-switch button{font:inherit;border:0;background:none;color:var(--ink);padding:6px 10px;cursor:pointer}
.view-switch button+button{border-left:1px solid var(--line)}
.view-switch button[aria-pressed=true]{background:var(--accent,#2f6fd6);color:#fff}
.view-switch button:focus-visible{outline:2px solid var(--accent,#2f6fd6);outline-offset:-2px}
.dual-view [data-id][tabindex]:focus-visible{outline:none}
.dual-view .blk.sel polygon{stroke:var(--accent,#2f6fd6);stroke-width:2.4}
.dual-view [data-a].dim{opacity:.3}
.dual-view [data-a].hot path{stroke-width:3.4}
`;
