// The timeline component (docs/timeline/README.md): a host's history, from a machine down to its smallest scope, over
// any TimelineSource<T> (a host's records, a recorded fixture, a simulation). The same flat 2D lanes, pan, zoom and
// playhead as a simulation's timeline panel, with
//   - rows by scope and depth, breadcrumbs, and drilling in;
//   - semantic zoom: single marks and spans when zoomed in, count bars and heat strips by bin when zoomed out, metric
//     rows as small area charts (counters as sums, gauges as min/max bands), quick ranges;
//   - time breaks: long empty stretches drawn as a narrow saw-tooth cut, labelled, expanded by a click;
//   - the search language (the component parses; the query carries the parse), hits stepped with next and previous,
//     facets, the view in the URL, saved views (the host stores them);
//   - a brushed range's events in a table, exported as JSON or CSV; an event's detail with the domain's actions;
//   - live at the right edge, paused when scrubbed into the past;
//   - the playhead drives a canvas where a state was recorded (stateAt), and says so where none was.
// Nothing here talks to a server: every fetch is the source's, every link the host's. What the scopes, flags, links
// and actions mean is the domain's (its catalogue, and actions()).

import type { Bin, Catalog, Filters, MetricPoint, MetricRollup, Query, Result, Row, Scope, Severity, TimelineEvent, TimelineSource, View, SourceInfo, TimelineCatalog, TimelineTypes, AnyTimeline } from './timeline-contract.ts';
import { BIN_MS, SEVERITIES } from './timeline-contract.ts';
import { highlights, searchFor } from './timeline-search.ts';
import { crumbs, levelOf, prefixAt } from './timeline-scope.ts';
import { findGaps, gapKey, gapLabel, ticks, timeScale, type Gap, type TimeScale } from './timeline-scale.ts';
import { toCSV, toJSON } from './timeline-export.ts';
import { h } from './dom.ts';

export interface TimelineMountOptions<T extends TimelineTypes = AnyTimeline> {
  source: TimelineSource<T>;
  /** the domain's scopes, flags and search links */
  catalog: TimelineCatalog;
  /** classes on the component's root beside its own (the stylesheet it is styled by is scoped to one) */
  rootClass?: string[];
  /** where to start (else the URL's view, else the first host, 1 level down, the last day) */
  view?: Partial<View>;
  /** the owner's time zone (default: the viewer's) */
  tz?: string;
  /** light, dark, or the viewer's (default) */
  theme?: 'light' | 'dark' | 'system';
  /** keep the view in location.hash (#timeline=…) */
  urlState?: boolean;
  /** collapse long empty stretches into time breaks (default true; remembered per view) */
  collapseGaps?: boolean;
  /** animate a time break opening (default: unless the viewer prefers reduced motion) */
  motion?: boolean;
  /** an event's actions, in its detail: a label, and what it does (none: not shown) */
  actions?(e: TimelineEvent<T>): [string, (() => void) | undefined][];
  /** saved views: the host stores them */
  saveView?(v: View): void | Promise<void>;
  views?(): View[] | Promise<View[]>;
  /** the playhead moved: the state recorded there, if any (draw it on a canvas) */
  onPlayhead?(t: number, state: T['state'] | undefined): void;
  /** a recorded state, in words for the canvas's note: when it was observed, and what it belongs to */
  stamp?(state: T['state']): { at?: string; tag?: string };
  onViewChange?(v: View): void;
  /** an export: the host saves it (else the browser downloads it) */
  onExport?(name: string, text: string, type: string): void;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const ROW = 22, MROW = 38, AXIS = 26, LABELS = 210, CUT = 24;
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const QUICK = { '15m': 15 * MIN, '1h': HOUR, '1d': DAY, '1w': 7 * DAY } as const;
const SEV_RANK = (s: string) => (SEVERITIES as readonly string[]).indexOf(s);
/** the marks' shapes: never colour alone */
const SHAPE: Record<Severity, string> = { debug: 'dot', info: 'circle', notice: 'square', warning: 'triangle', error: 'diamond' };
type Mode = { kind: 'single' } | { kind: 'binned'; bin: Bin };
type Line<T extends TimelineTypes = AnyTimeline> = { kind: 'row'; row: Row<T> } | { kind: 'metric'; series: string; unit: string; type: 'counter' | 'gauge'; title: string };

const svgEl = (name: string, attrs: Record<string, string | number | undefined>, title?: string) => {
  const e = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) e.setAttribute(k, String(v));
  if (title) { const tt = document.createElementNS(SVGNS, 'title'); tt.textContent = title; e.append(tt); }
  return e;
};
const fmtTime = (t: number, tz?: string) => {
  try { return new Intl.DateTimeFormat(undefined, { timeZone: tz, dateStyle: 'medium', timeStyle: 'medium' }).format(t); } catch { return new Date(t).toISOString(); }
};
const fmtDur = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : ms < MIN ? `${(ms / 1000).toFixed(1)} s` : gapLabel(ms));
const fmtNum = (n: number, unit: string) => unit === 'bytes' ? (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} kB` : `${Math.round(n)} B`) : `${Math.round(n * 10) / 10}${unit === 'count' ? '' : ` ${unit}`}`;

/** which zoom level a visible span reads at: single events up to a few hours, then minute, hour and day bins */
export function modeFor(span: number, px: number): Mode {
  if (span <= 3 * HOUR) return { kind: 'single' };
  for (const b of ['1m', '1h', '1d'] as Bin[]) if (span / BIN_MS[b] <= px / 2) return { kind: 'binned', bin: b };
  return { kind: 'binned', bin: '1d' };
}

/** the activity a result shows (for time breaks): marks, span ends, bins with events, metrics that moved */
export function activityOf<T extends TimelineTypes = AnyTimeline>(r: Result<T>, mode: Mode, series?: Map<string, 'counter' | 'gauge'>): [number, number][] {
  const out: [number, number][] = [];
  for (const e of r.events ?? []) { out.push([e.t, e.t]); if (e.dur !== undefined && !e.open) out.push([e.t + e.dur, e.t + e.dur]); }
  for (const e of r.spans ?? []) { out.push([e.t, e.t]); if (e.dur !== undefined && !e.open) out.push([e.t + e.dur, e.t + e.dur]); }
  const w = mode.kind === 'binned' ? BIN_MS[mode.bin] : MIN;
  for (const b of r.bins ?? []) if (b.count) out.push([b.t, b.t + BIN_MS[b.bin]]);
  const last = new Map<string, number>();
  for (const m of r.metrics) {
    const v = 'value' in m ? m.value : m.sum, k = `${m.series}|${m.scope}`;
    const moved = (series?.get(m.series) ?? 'counter') === 'counter' ? v !== 0 : last.get(k) !== v;
    last.set(k, v);
    if (moved) out.push([m.t, m.t + w]);
  }
  return out;
}

export function mountTimeline<T extends TimelineTypes = AnyTimeline>(el: HTMLElement, o: TimelineMountOptions<T>) {
  const tz = o.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motion = o.motion ?? !reduced;
  // a stylesheet scoped to a root class: the component sits in one
  el.classList.add(...(o.rootClass ?? []), 'tlx');
  const { parseSearch, compileSearch } = searchFor(o.catalog);
  const setTheme = (t: 'light' | 'dark' | 'system' = 'system') => { el.style.colorScheme = t === 'system' ? 'light dark' : t; if (t === 'system') delete el.dataset.theme; else el.dataset.theme = t; };
  setTheme(o.theme);
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Timeline');

  // ---------- state ----------
  let catalog: Catalog<T> | undefined;
  let scope: Scope = '', depth = 1, q = '', filters: Filters = {}, live = false, collapse = o.collapseGaps ?? true;
  let view = { t0: 0, t1: DAY };
  let result: Result<T> | undefined, resultKey = '', loaded = { from: 0, to: 0, mode: { kind: 'single' } as Mode, key: '' };
  let playhead: number | undefined, playState: T['state'] | undefined, selected: TimelineEvent<T> | undefined;
  let brush: { from: number; to: number } | undefined;
  let follow = true, frame = 0, fetching = 0, pending = false, unsub: (() => void) | undefined, warnings: string[] = [];
  let hits: TimelineEvent<T>[] = [], hitAt = -1;
  const expanded = new Set<string>(), weights = new Map<string, number>();
  let gaps: Gap[] = [], scale: TimeScale = timeScale(0, DAY, 800);
  const seriesInfo = new Map<string, { unit: string; type: 'counter' | 'gauge'; title: string; source: string }>();
  let sensitive: string[] = [];

  // ---------- the DOM ----------
  const crumbsEl = h('nav', { class: 'tlx-crumbs', 'aria-label': 'Scope' });
  const quick = h('div', { class: 'segmented tlx-quick', role: 'group', 'aria-label': 'Range' });
  for (const k of ['15m', '1h', '1d', '1w', 'run'] as const) {
    const b = h('button', { type: 'button', class: 'seg', 'data-v': k, title: k === 'run' ? 'The latest run' : `The last ${k}` }, k === 'run' ? 'this run' : k);
    b.addEventListener('click', () => setQuick(k));
    quick.append(b);
  }
  const liveBtn = h('button', { type: 'button', class: 'btn sm tlx-live', 'aria-pressed': 'false', title: 'Follow what happens now' }, 'Live');
  const nowBtn = h('button', { type: 'button', class: 'btn sm quiet tlx-now', hidden: true, title: 'Back to the live edge' }, 'Back to now');
  const fitBtn = h('button', { type: 'button', class: 'btn sm quiet tlx-fit', title: 'Everything in this scope' }, 'Fit');
  const gapsBox = h('input', { type: 'checkbox', class: 'tlx-gaps' }) as HTMLInputElement;
  gapsBox.checked = collapse;
  let hideQuiet = true;
  const quietBox = h('input', { type: 'checkbox', class: 'tlx-quiet' }) as HTMLInputElement;
  quietBox.checked = hideQuiet;
  const search = h('input', { type: 'search', class: 'input tlx-q', placeholder: 'Search: words, kind:…, source:…, severity:>=warning, -kind:…', 'aria-label': 'Search the timeline', spellcheck: 'false' }) as HTMLInputElement;
  const hitsEl = h('span', { class: 'tlx-hits', role: 'status', 'aria-live': 'polite' });
  const prevBtn = h('button', { type: 'button', class: 'btn sm quiet tlx-prev', title: 'Previous hit (⇧N)', 'aria-label': 'Previous hit' }, '‹');
  const nextBtn = h('button', { type: 'button', class: 'btn sm quiet tlx-next', title: 'Next hit (N)', 'aria-label': 'Next hit' }, '›');
  const facets = h('div', { class: 'tlx-facets', role: 'group', 'aria-label': 'Sources' });
  const sevSel = h('select', { class: 'input tlx-sev', 'aria-label': 'Severity' },
    h('option', { value: '' }, 'every severity'), ...SEVERITIES.slice(1).map(s => h('option', { value: s }, `${s} and above`))) as HTMLSelectElement;
  const viewsSel = h('select', { class: 'input tlx-views', 'aria-label': 'Saved views', hidden: !o.views }, h('option', { value: '' }, 'Saved views…')) as HTMLSelectElement;
  const saveBtn = h('button', { type: 'button', class: 'btn sm quiet tlx-save', hidden: !o.saveView, title: 'Save this view' }, 'Save view');
  const warnEl = h('div', { class: 'tlx-warn', role: 'status', hidden: true });
  const status = h('div', { class: 'tlx-status', role: 'status' });
  const canvasNote = h('span', { class: 'tlx-canvas-note' });
  const labels = h('div', { class: 'tlx-labels' });
  const lanes = h('div', { class: 'tlx-lanes', tabindex: '0', role: 'application', 'aria-label': 'Timeline lanes: drag to pan, wheel to zoom, drag the axis to choose a range, click it to move the playhead. Keys: ← → pan, + − zoom, N next hit' });
  const svg = svgEl('svg', { class: 'tlx-svg' }) as SVGSVGElement;
  lanes.append(svg);
  const scroller = h('div', { class: 'tlx-scroll' }, h('div', { class: 'tlx-grid' }, labels, lanes));
  const table = h('section', { class: 'tlx-table', hidden: true, 'aria-label': 'The events in the chosen range' });
  const detail = h('aside', { class: 'tlx-detail', hidden: true, 'aria-label': 'The event' });
  el.replaceChildren(
    h('div', { class: 'tlx-bar' }, crumbsEl, h('span', { class: 'spacer' }), quick, liveBtn, nowBtn, fitBtn, h('label', { class: 'tlx-gaps-label', title: 'Draw long empty stretches as narrow breaks' }, gapsBox, 'Collapse gaps'),
      h('label', { class: 'tlx-gaps-label', title: 'Hide the rows with nothing in this range' }, quietBox, 'Hide quiet rows')),
    h('div', { class: 'tlx-bar' }, search, hitsEl, prevBtn, nextBtn, sevSel, viewsSel, saveBtn),
    facets, warnEl,
    h('div', { class: 'tlx-body' }, scroller, detail),
    h('div', { class: 'tlx-foot' }, status, h('span', { class: 'spacer' }), canvasNote),
    table);

  const width = () => Math.max(200, lanes.clientWidth || 800);
  const lines = (): Line<T>[] => {
    // the scope's own row first, then the rest in a natural order (bash~3 before bash~24); quiet ones hidden if asked
    const collate = (a: Row<T>, b: Row<T>) => (a.own ? -1 : 0) - (b.own ? -1 : 0) || a.scope.localeCompare(b.scope, undefined, { numeric: true });
    const shown = (result?.rows ?? []).filter(r => !hideQuiet || r.count > 0 || r.own || (result?.rows.length ?? 0) <= 1).sort(collate);
    const rs: Line<T>[] = shown.map(row => ({ kind: 'row', row }));
    const present = new Set(result?.metrics.map(m => m.series) ?? []);
    for (const s of [...present].sort()) { const i = seriesInfo.get(s); rs.push({ kind: 'metric', series: s, unit: i?.unit ?? 'count', type: i?.type ?? 'counter', title: i?.title ?? s }); }
    return rs;
  };
  /** a scope's label: the catalogue's, else its last segment's */
  const labelOf = (s: Scope, fallback: string) => catalog?.names?.find(n => n.scope === s)?.label ?? fallback;
  const lineH = (l: Line<T>) => (l.kind === 'metric' ? MROW : ROW);
  const mode = () => modeFor(view.t1 - view.t0, width());
  const nowT = () => catalog?.now ?? Date.now();

  // ---------- the view, the URL, saved views ----------
  function currentView(): View {
    return { timeline: 1, type: 'view', name: '', scope, depth, range: { from: Math.round(view.t0), to: Math.round(view.t1) }, ...(q ? { q } : {}), ...(Object.keys(filters).length ? { filters } : {}), ...(live ? { live } : {}), ...(collapse ? {} : { collapseGaps: false }), ...(hideQuiet ? {} : { quietRows: true }) } as View;
  }
  function applyView(v: Partial<View> & { collapseGaps?: boolean; quietRows?: boolean }) {
    if (v.scope !== undefined) scope = v.scope;
    if (v.depth !== undefined) depth = v.depth;
    q = v.q ?? ''; search.value = q;
    filters = v.filters ?? {};
    sevSel.value = filters.severity?.length ? filters.severity[0] : '';
    collapse = v.collapseGaps ?? (o.collapseGaps ?? true); gapsBox.checked = collapse;
    hideQuiet = !(v as { quietRows?: boolean }).quietRows; quietBox.checked = hideQuiet;
    expanded.clear(); weights.clear();
    const r = v.range;
    if (r && 'last' in r) setQuick(r.last, false);
    else if (r) view = { t0: r.from, t1: r.to };
    setLive(!!v.live, false);
  }
  const writeUrl = () => {
    const v = currentView();
    o.onViewChange?.(v);
    if (!o.urlState) return;
    try { history.replaceState(null, '', `#timeline=${encodeURIComponent(JSON.stringify(v))}`); } catch { /* a frame that may not */ }
  };
  const readUrl = (): Partial<View> | undefined => {
    if (!o.urlState) return undefined;
    const m = /#timeline=(.+)$/.exec(location.hash);
    if (!m) return undefined;
    try { return JSON.parse(decodeURIComponent(m[1])); } catch { return undefined; }
  };

  // ---------- fetching ----------
  function query(from: number, to: number, md: Mode, extra: Partial<Query<T>> = {}): Query<T> {
    const c = compileSearch(q, nowT(), from, to);
    warnings = c.warnings;
    // metrics follow what is shown: none while searching (a search is of events), and only the faceted sources'
    const series = q ? [] : filters.source ? [...seriesInfo].filter(([, i]) => filters.source!.includes(i.source)).map(([n]) => n) : undefined;
    return { timeline: 1, type: 'query', scope, depth, from: c.from, to: c.to, tz, ...(md.kind === 'binned' ? { bin: md.bin } : {}), ...(q ? { q, where: c.where as unknown as Query<T>['where'] } : {}), ...(Object.keys(filters).length ? { filters } : {}), ...(series ? { series } : {}), ...extra };
  }
  const keyOf = () => JSON.stringify([scope, depth, q, filters, mode()]);
  /** fetch what the view needs: the visible range padded by half a span each side, again when it leaves that or the mode changes */
  async function refresh(force = false) {
    const md = mode(), key = keyOf(), span = view.t1 - view.t0;
    if (!force && result && key === loaded.key && view.t0 >= loaded.from && view.t1 <= loaded.to) { later(); return; }
    if (fetching) { pending = true; return; }
    fetching++;
    const from = view.t0 - span / 2, to = Math.min(view.t1 + span / 2, Math.max(view.t1, nowT() + span * 0.1));
    try {
      let r = await o.source.query(query(from, to, md, md.kind === 'single' ? { limit: 10000 } : {}));
      // too many single events to draw: the minute bins instead
      if (md.kind === 'single' && r.next) r = await o.source.query(query(from, to, { kind: 'binned', bin: '1m' }));
      result = r; resultKey = key;
      loaded = { from, to, mode: md, key };
    } catch (err) {
      status.textContent = `The history couldn't be read: ${String((err as Error)?.message ?? err)}`;
    } finally {
      fetching--;
    }
    later();
    writeUrl();
    if (pending) { pending = false; void refresh(); }
  }

  // ---------- the scale and time breaks ----------
  function makeScale() {
    const W = width(), md = mode();
    gaps = [];
    if (collapse && result) {
      const types = new Map([...seriesInfo].map(([k, v]) => [k, v.type] as const));
      gaps = findGaps(activityOf(result, md, types), view.t0, Math.min(view.t1, Math.max(view.t0, nowT())), { minFrac: 0.15, minMs: 10 * MIN });
      if (md.kind === 'binned') gaps = gaps.filter(g => g.to - g.from >= 2 * BIN_MS[md.bin]);
      gaps = gaps.filter(g => !(expanded.has(gapKey(g)) && (weights.get(gapKey(g)) ?? 1) >= 1));
    }
    scale = timeScale(view.t0, view.t1, W, gaps, { cut: CUT, weights });
  }

  // ---------- painting ----------
  const later = () => { if (!frame) frame = requestAnimationFrame(paint); };
  function paint() {
    frame = 0;
    makeScale();
    const W = width(), L = lines(), md = loaded.mode;
    const ys: number[] = []; let y = AXIS;
    for (const l of L) { ys.push(y); y += lineH(l); }
    const H = Math.max(y, AXIS + ROW);
    svg.setAttribute('width', String(W)); svg.setAttribute('height', String(H)); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    // only the rows in view are drawn (the scroller's window), with a margin
    const top = scroller.scrollTop - 200, bottom = scroller.scrollTop + (scroller.clientHeight || 600) + 200;
    const kids: Element[] = [];
    const x = scale.x;
    kids.push(svgEl('rect', { class: 'tlx-axis', x: 0, y: 0, width: W, height: AXIS }));
    // what isn't kept: grey before the earliest time any shown source still holds (each source's own in the title),
    // and the future after now
    const kept = (result?.retention ?? []).map(r => ({ r, from: md.kind === 'binned' ? r.keptFrom.rollups[md.bin] ?? r.keptFrom.events : r.keptFrom.events, days: md.kind === 'binned' ? r.rollups[md.bin] : r.events }));
    const held = kept.filter(k => k.from !== undefined) as { r: (typeof kept)[number]['r']; from: number; days: number | null }[];
    if (held.length) {
      const first = Math.min(...held.map(k => k.from));
      if (first > view.t0) kids.push(svgEl('rect', { class: 'tlx-notkept', x: Math.max(0, x(view.t0)), y: AXIS, width: Math.max(0, x(first) - Math.max(0, x(view.t0))), height: H - AXIS },
        `Nothing kept before ${fmtTime(first, tz)}: ${held.map(k => `${k.r.source} ${k.days === null ? 'kept until deleted' : `kept ${k.days} days`}`).join(', ')}`));
    }
    const now = nowT();
    if (now < view.t1) kids.push(svgEl('rect', { class: 'tlx-future', x: x(now), y: AXIS, width: W - x(now), height: H - AXIS }));
    for (const tk of ticks(scale, tz, 90)) {
      kids.push(svgEl('line', { class: `tlx-tick${tk.major ? ' major' : ''}`, x1: tk.x, x2: tk.x, y1: AXIS - 6, y2: H }));
      const lab = svgEl('text', { class: 'tlx-ticklabel', x: tk.x + 3, y: 16 }); lab.textContent = tk.label; kids.push(lab);
    }
    if (brush) kids.push(svgEl('rect', { class: 'tlx-brush', x: x(brush.from), y: 0, width: Math.max(1, x(brush.to) - x(brush.from)), height: H }));
    // the lanes
    const spans = md.kind === 'single' ? (result?.events ?? []).filter(e => e.dur !== undefined || e.open) : result?.spans ?? [];
    const marks = md.kind === 'single' ? (result?.events ?? []).filter(e => e.dur === undefined && !e.open) : [];
    const rowIndex = new Map<string, number>();
    L.forEach((l, i) => { if (l.kind === 'row') rowIndex.set(l.row.scope, i); });
    const rowOfScope = (s: Scope) => { const lvl = levelOf(scope) + depth; const r = levelOf(s) >= lvl ? prefixAt(s, lvl) : s; return rowIndex.get(r); };
    const visible = (i: number) => ys[i] + lineH(L[i]) >= top && ys[i] <= bottom;
    L.forEach((l, i) => { if (visible(i)) kids.push(svgEl('rect', { class: `tlx-lane${i % 2 ? ' odd' : ''}${l.kind === 'metric' ? ' metric' : ''}`, x: 0, y: ys[i], width: W, height: lineH(l) })); });
    // binned: count bars (height by count, on a row's own scale) and a heat strip (the worst severity)
    if (md.kind === 'binned') {
      const max = new Map<number, number>();
      for (const b of result?.bins ?? []) { const i = rowOfScope(b.scope); if (i !== undefined) max.set(i, Math.max(max.get(i) ?? 0, b.count)); }
      for (const b of result?.bins ?? []) {
        const i = rowOfScope(b.scope);
        if (i === undefined || !visible(i)) continue;
        const a = x(b.t), z = x(b.t + BIN_MS[b.bin]);
        if (z < 0 || a > W) continue;
        const worst = [...SEVERITIES].reverse().find(s => (b.severity[s] ?? 0) > 0) ?? 'info';
        const hgt = Math.max(2, ((ROW - 8) * Math.sqrt(b.count)) / Math.sqrt(max.get(i) || 1));
        kids.push(svgEl('rect', { class: 'tlx-countbar', x: a, y: ys[i] + ROW - 3 - hgt, width: Math.max(1, z - a - 0.5), height: hgt, 'data-t': b.t },
          `${fmtTime(b.t, tz)}: ${b.count} event${b.count === 1 ? '' : 's'}${worst !== 'info' && worst !== 'debug' ? `, the worst ${worst}` : ''}`));
        // the heat strip: warnings and errors only, under the bar (and a glyph's worth of height, not colour alone)
        if (worst === 'warning' || worst === 'error') kids.push(svgEl('rect', { class: `tlx-heat sev-${worst}`, x: a, y: ys[i] + ROW - (worst === 'error' ? 4 : 3), width: Math.max(1, z - a - 0.5), height: worst === 'error' ? 3 : 2 }));
      }
    }
    // spans (sessions, actions, runs): a bar, broken at a time break they last through
    for (const e of spans) {
      const i = rowOfScope(e.scope);
      if (i === undefined || !visible(i)) continue;
      const end = e.open ? now : e.t + (e.dur ?? 0);
      const a = x(e.t), z = x(end);
      if (z < -2 || a > W + 2) continue;
      const cls = `tlx-span sev-${e.severity}${e.open ? ' open' : ''}${selected?.id === e.id ? ' selected' : ''}`;
      const label = `${e.summary} · ${fmtTime(e.t, tz)}${e.open ? ', still going' : `, ${fmtDur(end - e.t)}`}`;
      const sy = ys[i] + 5, sh = md.kind === 'binned' ? 4 : 8;
      // the pieces between the cuts it crosses
      let pa = a;
      for (const c of scale.cuts) {
        if (c.weight >= 1 || c.x1 <= a || c.x0 >= z) continue;
        if (c.x0 > pa) kids.push(svgEl('rect', { class: cls, x: pa, y: sy, width: Math.max(1, c.x0 - pa), height: sh, rx: 2, 'data-id': e.id }, label));
        kids.push(svgEl('path', { class: `${cls} through`, d: `M${c.x0} ${sy + sh / 2} H${c.x1}`, 'data-id': e.id }, `${label} (lasted through the break)`));
        pa = c.x1;
      }
      if (z > pa) kids.push(svgEl('rect', { class: cls, x: Math.max(-2, pa), y: sy, width: Math.max(2, Math.min(W + 2, z) - Math.max(-2, pa)), height: sh, rx: 2, 'data-id': e.id }, label));
    }
    // marks: a shape per severity; dense ones within 3 px of the last on their row aren't drawn again
    const lastX = new Map<number, number>();
    for (const e of marks) {
      const i = rowOfScope(e.scope);
      if (i === undefined || !visible(i)) continue;
      const px = x(e.t);
      if (px < -6 || px > W + 6 || px - (lastX.get(i) ?? -Infinity) < 3) continue;
      lastX.set(i, px);
      const cy = ys[i] + ROW / 2 + 2, r = 4;
      const shape = SHAPE[e.severity];
      const d = shape === 'diamond' ? `M${px} ${cy - r - 1} l${r + 1} ${r + 1} l${-r - 1} ${r + 1} l${-r - 1} ${-r - 1} z` : shape === 'triangle' ? `M${px} ${cy - r - 1} l${r + 1} ${2 * r + 1} h${-2 * r - 2} z` : shape === 'square' ? `M${px - r + 0.5} ${cy - r + 0.5} h${2 * r - 1} v${2 * r - 1} h${-2 * r + 1} z` : '';
      const title = `${fmtTime(e.t, tz)} · ${e.summary}`;
      const cls = `tlx-mark sev-${e.severity}${selected?.id === e.id ? ' selected' : ''}${hitAt >= 0 && hits[hitAt]?.id === e.id ? ' hit' : ''}`;
      kids.push(d ? svgEl('path', { class: cls, d, 'data-id': e.id }, title) : svgEl('circle', { class: cls, cx: px, cy, r: shape === 'dot' ? 2.5 : r, 'data-id': e.id }, title));
    }
    // metric rows: small area charts (counters as sums; gauges as a min/max band and the mean)
    L.forEach((l, i) => {
      if (l.kind !== 'metric' || !visible(i)) return;
      const pts = new Map<number, { min: number; max: number; sum: number; count: number }>();
      for (const m of result?.metrics ?? []) {
        if (m.series !== l.series) continue;
        const f = 'value' in m ? { min: m.value, max: m.value, sum: m.value, count: 1 } : { min: m.min, max: m.max, sum: m.sum, count: m.count };
        const p = pts.get(m.t);
        if (p) { p.min = Math.min(p.min, f.min); p.max = Math.max(p.max, f.max); p.sum += f.sum; p.count += f.count; } else pts.set(m.t, { ...f });
      }
      const series = [...pts].sort((a, b) => a[0] - b[0]);
      if (!series.length) return;
      const w = md.kind === 'binned' ? BIN_MS[md.bin] : MIN;
      const val = (p: { sum: number; count: number }) => (l.type === 'gauge' ? p.sum / Math.max(1, p.count) : p.sum);
      const peak = Math.max(1e-9, ...series.map(([, p]) => (l.type === 'gauge' ? p.max : val(p))));
      const base = ys[i] + MROW - 4, hh = MROW - 10, yv = (v: number) => base - (v / peak) * hh;
      if (l.type === 'gauge') {
        const band = series.map(([t, p]) => `${x(t)},${yv(p.max)}`).join(' ') + ' ' + [...series].reverse().map(([t, p]) => `${x(t)},${yv(p.min)}`).join(' ');
        kids.push(svgEl('polygon', { class: 'tlx-band', points: band }));
        kids.push(svgEl('polyline', { class: 'tlx-line', points: series.map(([t, p]) => `${x(t + w / 2)},${yv(val(p))}`).join(' ') }));
      } else {
        // an area of steps, dropping to zero across gaps in the samples
        let d = '', prevEnd = -Infinity;
        for (const [t, p] of series) {
          const a = x(t), z = x(t + w), v = yv(val(p));
          d += t > prevEnd ? `M${a} ${base} V${v} H${z}` : ` V${v} H${z}`;
          prevEnd = t + w;
          const nxt = series.find(([t2]) => t2 > t);
          if (!nxt || nxt[0] > prevEnd) d += ` V${base} Z`;
        }
        kids.push(svgEl('path', { class: 'tlx-area', d }));
      }
      const lab = svgEl('text', { class: 'tlx-peak', x: 4, y: ys[i] + 11 }); lab.textContent = `peak ${fmtNum(peak, l.unit)}${l.type === 'counter' ? ` per ${md.kind === 'binned' ? md.bin : '1m'}` : ''}`; kids.push(lab);
    });
    // the time breaks: a saw-tooth cut across the axis and every row, its length on it
    for (const c of scale.cuts) {
      if (c.weight >= 1) continue;
      const teeth = (xx: number) => { let d = `M${xx} 0`; for (let yy = 0; yy < H; yy += 8) d += ` L${xx + (((yy / 8) % 2) ? -3 : 3)} ${yy + 8}`; return d; };
      const g = svgEl('g', { class: 'tlx-cut', tabindex: 0, role: 'button', 'data-from': c.from, 'data-to': c.to, 'aria-label': `A break of ${gapLabel(c.to - c.from)} with nothing shown, from ${fmtTime(c.from, tz)} to ${fmtTime(c.to, tz)}: press to open it` },
        `${gapLabel(c.to - c.from)} with nothing here: ${fmtTime(c.from, tz)} to ${fmtTime(c.to, tz)} (click to open)`);
      g.append(svgEl('rect', { class: 'tlx-cut-bg', x: c.x0, y: 0, width: c.x1 - c.x0, height: H }));
      g.append(svgEl('path', { class: 'tlx-cut-edge', d: teeth(c.x0 + 3) }), svgEl('path', { class: 'tlx-cut-edge', d: teeth(c.x1 - 3) }));
      const t = svgEl('text', { class: 'tlx-cut-label', x: (c.x0 + c.x1) / 2, y: 15, 'text-anchor': 'middle' }); t.textContent = gapLabel(c.to - c.from);
      g.append(t);
      kids.push(g);
    }
    if (playhead !== undefined) {
      const px = x(playhead);
      kids.push(svgEl('line', { class: 'tlx-playhead', x1: px, x2: px, y1: 0, y2: H }));
      kids.push(svgEl('path', { class: 'tlx-handle', d: `M${px - 6} 0 h12 v8 l-6 7 l-6 -7 z` }, `the playhead: ${fmtTime(playhead, tz)}`));
    }
    svg.replaceChildren(...kids);
    // labels, beside their lanes
    labels.replaceChildren(h('div', { class: 'tlx-labelhead', style: `height:${AXIS}px` }, mode().kind === 'single' ? 'single events' : `per ${mode().kind === 'binned' ? (mode() as { bin: Bin }).bin : ''}`),
      ...L.map(l => {
        if (l.kind === 'metric') return h('div', { class: 'tlx-rowlabel metric', style: `height:${MROW}px`, title: `${l.title} (${l.type === 'counter' ? 'sums' : 'min, max and mean'})` }, l.title);
        const r = l.row;
        const lab = h('div', { class: `tlx-rowlabel${r.own ? ' own' : ''}`, style: `height:${ROW}px`, 'data-scope': r.scope, title: `${r.scope || 'all hosts'} · ${r.count} event${r.count === 1 ? '' : 's'}` },
          h('span', { class: 'tlx-kind' }, o.catalog.flags.find(f => (r as Record<string, unknown>)[f]) ?? r.kind), h('span', { class: 'tlx-name' }, r.own ? `${r.label} (itself)` : r.label), h('span', { class: 'tlx-count' }, String(r.count)));
        if (!r.own && r.scope !== scope) {
          const b = h('button', { type: 'button', class: 'tlx-drill', title: r.children ? `Into ${r.label}: its ${r.children} part${r.children === 1 ? '' : 's'}` : `Into ${r.label}`, 'aria-label': `Into ${r.label}` }, '›');
          b.addEventListener('click', () => drill(r.scope));
          lab.append(b);
        }
        return lab;
      }));
    labels.style.width = `${LABELS}px`;
    paintChrome();
  }

  function paintChrome() {
    crumbsEl.replaceChildren(...crumbs(scope).flatMap((c, i, all) => {
      const b = h('button', { type: 'button', class: `tlx-crumb${i === all.length - 1 ? ' current' : ''}`, 'aria-current': i === all.length - 1 ? 'location' : undefined }, labelOf(c.scope, c.label));
      b.addEventListener('click', () => { if (c.scope !== scope) { scope = c.scope; depth = 1; void refresh(true); } });
      return i ? [h('span', { class: 'tlx-sep', 'aria-hidden': 'true' }, '/'), b] : [b];
    }));
    liveBtn.setAttribute('aria-pressed', String(live));
    liveBtn.classList.toggle('on', live);
    nowBtn.hidden = !live || follow;
    const md = mode();
    const total = result?.total ?? 0;
    const kept = (result?.retention ?? []).filter(r => r.events !== null).map(r => `${r.source} kept ${r.events} d`);
    status.textContent = `${fmtTime(view.t0, tz)} – ${fmtTime(view.t1, tz)} · ${md.kind === 'single' ? 'single events' : `bins of ${md.bin}`} · ${total} event${total === 1 ? '' : 's'}${gaps.length ? ` · ${gaps.length} break${gaps.length === 1 ? '' : 's'}` : ''}${kept.length ? ` · ${kept.slice(0, 3).join(', ')}` : ''}`;
    warnEl.hidden = !warnings.length;
    warnEl.textContent = warnings.join(' · ');
    hitsEl.textContent = q ? (hits.length ? `${hitAt + 1 > 0 ? `${hitAt + 1} of ` : ''}${hits.length}${hits.length >= 2000 ? '+' : ''} hit${hits.length === 1 ? '' : 's'}` : `${total ? `${total} hit${total === 1 ? '' : 's'}` : 'no hits'}`) : '';
    for (const b of quick.querySelectorAll<HTMLButtonElement>('.seg')) b.classList.remove('on');
    canvasNote.textContent = playhead === undefined ? '' : playState ? (() => { const st = o.stamp?.(playState) ?? {}; return `Canvas: the state recorded at ${fmtTime(Date.parse(st.at ?? '') || playhead, tz)}${st.tag ? ` (${st.tag})` : ''}`; })() : 'No state recorded here';
    canvasNote.classList.toggle('none', playhead !== undefined && !playState);
  }

  // ---------- facets ----------
  function paintFacets() {
    facets.replaceChildren();
    for (const s of catalog?.sources ?? []) {
      const on = !filters.source?.length || filters.source.includes(s.name);
      const b = h('button', { type: 'button', class: `tlx-chip${on ? ' on' : ''}${s.status === 'not-yet' ? ' notyet' : ''}`, 'aria-pressed': String(on && s.status !== 'not-yet'), disabled: s.status === 'not-yet',
        title: s.status === 'not-yet' ? `${s.title}: not kept yet` : `${s.title}${retentionText(s)}` }, s.name);
      if (s.status !== 'not-yet') b.addEventListener('click', () => toggleSource(s.name));
      facets.append(b);
    }
  }
  const retentionText = (s: SourceInfo<T>) => { const r = catalog?.retention.find(x => x.source === s.name); return r ? ` (kept ${r.events === null ? 'until deleted' : `${r.events} days`})` : ''; };
  function toggleSource(name: string) {
    const all = (catalog?.sources ?? []).filter(s => s.status === 'kept').map(s => s.name);
    let cur = filters.source?.length ? [...filters.source] : [...all];
    cur = cur.includes(name) ? cur.filter(x => x !== name) : [...cur, name];
    filters = { ...filters, ...(cur.length === all.length ? { source: undefined } : { source: cur }) };
    if (!filters.source) delete filters.source;
    paintFacets(); void refresh(true); void findHits();
  }

  // ---------- search and hits ----------
  let typing = 0;
  search.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => { q = search.value.trim(); hitAt = -1; void refresh(true); void findHits(); }, 250) as unknown as number; });
  search.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(typing); q = search.value.trim(); void refresh(true).then(() => findHits()).then(() => stepHit(e.shiftKey ? -1 : 1)); } });
  async function findHits() {
    if (!q) { hits = []; hitAt = -1; paintChrome(); return; }
    const span = view.t1 - view.t0;
    const r = await o.source.query(query(view.t0 - span * 4, Math.max(view.t1 + span * 4, nowT()), { kind: 'single' }, { limit: 2000 }));
    hits = r.events ?? []; hitAt = Math.min(hitAt, hits.length - 1);
    paintChrome();
  }
  function stepHit(dir: 1 | -1) {
    if (!hits.length) return;
    const center = (view.t0 + view.t1) / 2;
    if (hitAt < 0) hitAt = dir > 0 ? Math.max(0, hits.findIndex(e => e.t >= center)) : Math.max(0, hits.length - 1 - [...hits].reverse().findIndex(e => e.t <= center));
    else hitAt = (hitAt + dir + hits.length) % hits.length;
    const e = hits[hitAt];
    const span = Math.min(view.t1 - view.t0, 2 * HOUR);
    view = { t0: e.t - span / 2, t1: e.t + span / 2 }; follow = false;
    select(e);
    void refresh();
  }
  prevBtn.addEventListener('click', () => stepHit(-1));
  nextBtn.addEventListener('click', () => stepHit(1));
  sevSel.addEventListener('change', () => {
    const v = sevSel.value as Severity | '';
    filters = { ...filters, ...(v ? { severity: SEVERITIES.filter(s => SEV_RANK(s) >= SEV_RANK(v)) } : {}) };
    if (!v) delete filters.severity;
    void refresh(true); void findHits();
  });

  // ---------- ranges, live, drilling ----------
  async function setQuick(k: keyof typeof QUICK | 'run', go = true) {
    const now = nowT();
    if (k === 'run') {
      const r = await o.source.query({ timeline: 1, type: 'query', scope, depth: 0, from: now - 30 * DAY, to: now + 1, filters: { kind: ['run'] }, limit: 10000 }).catch(() => undefined);
      const run = r?.events?.[r.events.length - 1];
      view = run ? { t0: run.t - (run.dur ?? HOUR) * 0.02, t1: (run.open ? now : run.t + (run.dur ?? HOUR)) + (run.dur ?? HOUR) * 0.04 } : { t0: now - DAY, t1: now + DAY * 0.02 };
    } else view = { t0: now - QUICK[k], t1: now + QUICK[k] * 0.02 };
    follow = true; expanded.clear(); weights.clear();
    if (go) void refresh();
  }
  function setLive(on: boolean, go = true) {
    live = on;
    unsub?.(); unsub = undefined;
    if (on && o.source.subscribe) {
      let last = 0, wait = 0;
      unsub = o.source.subscribe(query(nowT() - HOUR, nowT() + 365 * DAY, { kind: 'single' }), b => {
        if (catalog) catalog.now = Math.max(catalog.now, b.now);
        if (follow) { const span = view.t1 - view.t0; view = { t0: b.now - span * 0.98, t1: b.now + span * 0.02 }; }
        // re-read at most twice a second (the host bins; a burst is one read)
        const t = Date.now();
        if (t - last > 500) { last = t; void refresh(true); } else if (!wait) wait = setTimeout(() => { wait = 0; last = Date.now(); void refresh(true); }, 500) as unknown as number;
      });
      follow = true;
    }
    if (go) { paintChrome(); writeUrl(); }
  }
  liveBtn.addEventListener('click', () => setLive(!live));
  nowBtn.addEventListener('click', () => { follow = true; const span = view.t1 - view.t0, now = nowT(); view = { t0: now - span * 0.98, t1: now + span * 0.02 }; void refresh(); });
  fitBtn.addEventListener('click', () => void fit());
  gapsBox.addEventListener('change', () => { collapse = gapsBox.checked; expanded.clear(); weights.clear(); later(); writeUrl(); });
  quietBox.addEventListener('change', () => { hideQuiet = quietBox.checked; later(); writeUrl(); });
  /** into a scope: its parts as rows (a scope with none, a session: itself, one row) */
  function drill(s: Scope) {
    const row = result?.rows.find(r => r.scope === s);
    scope = s; depth = row && row.children === 0 ? 0 : 1; brush = undefined; table.hidden = true;
    void refresh(true);
  }
  async function fit() {
    const now = nowT();
    const r = await o.source.query({ timeline: 1, type: 'query', scope, depth: 0, from: now - 400 * DAY, to: now + 1, bin: '1d', tz }).catch(() => undefined);
    const ts = (r?.bins ?? []).map(b => b.t);
    const t0 = ts.length ? Math.min(...ts) : now - 7 * DAY;
    view = { t0, t1: now + (now - t0) * 0.02 }; follow = true;
    void refresh();
  }

  // ---------- the playhead and the canvas ----------
  let stateReq = 0;
  async function setPlayhead(t: number | undefined) {
    playhead = t;
    later();
    if (t === undefined) { playState = undefined; return; }
    const mine = ++stateReq;
    const s = o.source.stateAt ? await o.source.stateAt(scope, t).catch(() => undefined) : undefined;
    if (mine !== stateReq) return;
    playState = s;
    o.onPlayhead?.(t, s);
    paintChrome();
  }

  // ---------- the brushed table and export ----------
  async function showTable(from: number, to: number) {
    brush = { from: Math.min(from, to), to: Math.max(from, to) };
    later();
    const page = await o.source.query(query(brush.from, brush.to, { kind: 'single' }, { limit: 500 }));
    const p = parseSearch(q);
    const mark = (s: string) => { const out: (string | Node)[] = []; let at = 0; for (const [a, b] of highlights(p, s)) { out.push(s.slice(at, a), h('mark', null, s.slice(a, b))); at = b; } out.push(s.slice(at)); return out; };
    const rows = (page.events ?? []).map(e => {
      const tr = h('tr', { 'data-id': e.id, tabindex: '0' }, h('td', null, fmtTime(e.t, tz)), h('td', null, e.dur !== undefined ? fmtDur(e.dur) : e.open ? 'still going' : ''), h('td', null, e.source), h('td', null, e.kind), h('td', { class: `sev-${e.severity}` }, e.severity), h('td', { class: 'tlx-sum' }, ...mark(e.summary)), h('td', { class: 'tlx-scope' }, e.scope));
      tr.addEventListener('click', () => select(e));
      tr.addEventListener('keydown', ev => { if (ev.key === 'Enter') select(e); });
      return tr;
    });
    const close = h('button', { type: 'button', class: 'btn sm quiet', 'aria-label': 'Close the table' }, 'Close');
    close.addEventListener('click', () => { brush = undefined; table.hidden = true; later(); });
    const exp = (kind: 'json' | 'csv') => {
      const b = h('button', { type: 'button', class: 'btn sm', 'data-export': kind }, kind.toUpperCase());
      b.addEventListener('click', () => void exportRange(kind));
      return b;
    };
    table.replaceChildren(
      h('div', { class: 'tlx-table-head' }, h('strong', null, `${page.total} event${page.total === 1 ? '' : 's'}`), h('span', null, ` ${fmtTime(brush.from, tz)} – ${fmtTime(brush.to, tz)}${page.total > 500 ? ' (the first 500 shown; the export has them all)' : ''}`), h('span', { class: 'spacer' }), h('span', null, 'Export: '), exp('json'), exp('csv'), close),
      h('div', { class: 'tlx-table-wrap' }, h('table', null, h('thead', null, h('tr', null, ...['When', 'Long', 'Source', 'Kind', 'Severity', 'What', 'Scope'].map(c => h('th', { scope: 'col' }, c)))), h('tbody', null, ...rows))));
    table.hidden = false;
  }
  /** every event in the brushed range (all pages), sensitive attrs left out */
  async function rangeEvents(): Promise<TimelineEvent<T>[]> {
    if (!brush) return [];
    const out: TimelineEvent<T>[] = [];
    let cursor: string | undefined;
    do {
      const r = await o.source.query(query(brush.from, brush.to, { kind: 'single' }, { limit: 10000, ...(cursor ? { cursor } : {}) }));
      out.push(...(r.events ?? [])); cursor = r.next;
    } while (cursor && out.length < 200_000);
    return out;
  }
  async function exportRange(kind: 'json' | 'csv') {
    const es = await rangeEvents();
    const text = kind === 'json' ? toJSON(es, sensitive) : toCSV(es, sensitive);
    const name = `timeline-${new Date(brush!.from).toISOString().slice(0, 16).replace(/:/g, '')}.${kind}`;
    const type = kind === 'json' ? 'application/json' : 'text/csv';
    if (o.onExport) { o.onExport(name, text, type); return; }
    // no host to save it: a download link with the text in it (never a blob: URL, which a host's asset rules forbid)
    const a = h('a', { href: `data:${type};charset=utf-8,${encodeURIComponent(text)}`, download: name });
    document.body.append(a); a.click(); a.remove();
  }

  // ---------- the detail panel ----------
  function select(e: TimelineEvent<T> | undefined) {
    selected = e;
    later();
    if (!e) { detail.hidden = true; return; }
    const src = catalog?.sources.find(s => s.name === e.source);
    const sens = new Set(src?.sensitive ?? []);
    const p = parseSearch(q);
    const mark = (s: string) => { const out: (string | Node)[] = []; let at = 0; for (const [a, b] of highlights(p, s)) { out.push(s.slice(at, a), h('mark', null, s.slice(a, b))); at = b; } out.push(s.slice(at)); return out; };
    const link = (label: string, fn: (() => void) | undefined) => { if (!fn) return null; const b = h('button', { type: 'button', class: 'btn sm' }, label); b.addEventListener('click', fn); return b; };
    const attrRows = Object.entries(e.attrs).map(([k, v]) => {
      if (!sens.has(k)) return h('tr', null, h('th', { scope: 'row' }, k), h('td', null, ...mark(String(v))));
      const show = h('button', { type: 'button', class: 'btn sm quiet', title: 'This can name a remote host, a folder or free text' }, 'Show');
      const td = h('td', { class: 'tlx-sensitive' }, 'hidden ', show);
      show.addEventListener('click', () => td.replaceChildren(String(v)));
      return h('tr', null, h('th', { scope: 'row' }, k), td);
    });
    const close = h('button', { type: 'button', class: 'btn sm quiet tlx-close', 'aria-label': 'Close' }, '×');
    close.addEventListener('click', () => select(undefined));
    const scopeCrumbs = crumbs(e.scope).slice(1).map(c => { const b = h('button', { type: 'button', class: 'tlx-crumb' }, labelOf(c.scope, c.label)); b.addEventListener('click', () => drill(c.scope)); return b; });
    detail.replaceChildren(
      h('div', { class: 'tlx-detail-head' }, h('strong', null, e.kind), close),
      h('p', { class: `tlx-sev sev-${e.severity}` }, `${e.severity} · ${src?.title ?? e.source}`),
      h('p', { class: 'tlx-sum' }, ...mark(e.summary)),
      h('p', null, fmtTime(e.t, tz), e.dur !== undefined ? ` · ${fmtDur(e.dur)}${e.open ? ' so far' : ''}` : e.open ? ' · still going' : ''),
      h('p', { class: 'tlx-crumbs small' }, ...scopeCrumbs),
      ...(attrRows.length ? [h('table', { class: 'tlx-attrs' }, h('tbody', null, ...attrRows))] : []),
      h('div', { class: 'tlx-links' }, ...(o.actions?.(e) ?? []).map(([label, fn]) => link(label, fn))),
    );
    detail.hidden = false;
  }

  // ---------- time breaks: open one ----------
  function openCut(from: number, to: number) {
    const key = gapKey({ from, to });
    const g = gaps.find(x => x.from === from && x.to === to);
    if (!g) return;
    expanded.add(key);
    if (!motion) { weights.set(key, 1); later(); return; }
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 260);
      weights.set(key, 1 - (1 - k) ** 3);
      paint();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- the pointer ----------
  let drag: { kind: 'pan' | 'brush' | 'scrub'; x0: number; t0: number; v0: typeof view; moved: boolean } | undefined;
  const pxOf = (e: PointerEvent | WheelEvent | MouseEvent) => e.clientX - svg.getBoundingClientRect().left;
  svg.addEventListener('pointerdown', e => {
    const px = pxOf(e), py = e.clientY - svg.getBoundingClientRect().top;
    const cut = (e.target as Element).closest?.('.tlx-cut');
    if (cut) { e.preventDefault(); openCut(Number(cut.getAttribute('data-from')), Number(cut.getAttribute('data-to'))); return; }
    svg.setPointerCapture(e.pointerId);
    const kind = py < AXIS ? 'brush' : e.shiftKey ? 'brush' : (e.target as Element).classList.contains('tlx-handle') ? 'scrub' : 'pan';
    drag = { kind, x0: px, t0: scale.t(px), v0: view, moved: false };
    e.preventDefault();
    lanes.focus({ preventScroll: true });
  });
  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const px = pxOf(e);
    if (Math.abs(px - drag.x0) > 3) drag.moved = true;
    if (!drag.moved) return;
    if (drag.kind === 'pan') {
      // pan by time under the pointer (a cut moves as one piece)
      const dt = (drag.x0 - px) * scale.msPerPx;
      view = { t0: drag.v0.t0 + dt, t1: drag.v0.t1 + dt };
      follow = false;
      void refresh();
    } else if (drag.kind === 'scrub') void setPlayhead(scale.t(px));
    else { brush = { from: Math.min(drag.t0, scale.t(px)), to: Math.max(drag.t0, scale.t(px)) }; later(); }
  });
  svg.addEventListener('pointerup', e => {
    const d = drag; drag = undefined;
    if (!d) return;
    const px = pxOf(e);
    if (d.kind === 'brush' && d.moved) { void showTable(d.t0, scale.t(px)); return; }
    if (d.kind === 'brush' && !d.moved) { void setPlayhead(scale.t(px)); return; }
    if (d.kind === 'pan' && !d.moved) {
      const id = (e.target as Element).closest?.('[data-id]')?.getAttribute('data-id');
      const ev = id ? [...(result?.events ?? []), ...(result?.spans ?? [])].find(x => x.id === id) : undefined;
      if (ev) { select(ev); void setPlayhead(ev.t); } else void setPlayhead(scale.t(px));
    }
  });
  svg.addEventListener('keydown', e => {
    const cut = (e.target as Element).closest?.('.tlx-cut');
    if (cut && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCut(Number(cut.getAttribute('data-from')), Number(cut.getAttribute('data-to'))); }
  });
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const px = pxOf(e);
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const dt = (e.shiftKey ? e.deltaY : e.deltaX) * scale.msPerPx;
      view = { t0: view.t0 + dt, t1: view.t1 + dt }; follow = false;
    } else zoomAt(scale.t(px), Math.exp(e.deltaY * 0.0015), px / width());
    void refresh();
  }, { passive: false });
  function zoomAt(at: number, f: number, frac = 0.5) {
    const span = Math.min(400 * DAY, Math.max(10_000, (view.t1 - view.t0) * f));
    view = { t0: at - frac * span, t1: at + (1 - frac) * span };
    expanded.clear(); weights.clear();
    if (f < 1) follow = live && view.t1 >= nowT();
  }
  lanes.addEventListener('keydown', e => {
    const span = view.t1 - view.t0;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const dt = span * 0.15 * (e.key === 'ArrowLeft' ? -1 : 1); view = { t0: view.t0 + dt, t1: view.t1 + dt }; follow = false; }
    else if (e.key === '+' || e.key === '=') zoomAt((view.t0 + view.t1) / 2, 0.6);
    else if (e.key === '-' || e.key === '_') zoomAt((view.t0 + view.t1) / 2, 1 / 0.6);
    else if (e.key === 'n' || e.key === 'N') { stepHit(e.shiftKey ? -1 : 1); e.preventDefault(); return; }
    else if (e.key === 'Escape') { select(undefined); brush = undefined; table.hidden = true; }
    else return;
    e.preventDefault();
    void refresh();
  });
  el.addEventListener('keydown', e => { if (e.key === '/' && document.activeElement !== search && !(e.target as HTMLElement).closest('input, select, textarea')) { e.preventDefault(); search.focus(); } });
  scroller.addEventListener('scroll', () => later(), { passive: true });

  // ---------- saved views ----------
  saveBtn.addEventListener('click', async () => {
    const name = `${crumbs(scope).slice(-1)[0].label}${q ? `: ${q}` : ''}`.slice(0, 80);
    await o.saveView?.({ ...currentView(), name });
    await loadViews();
  });
  let saved: View[] = [];
  async function loadViews() {
    if (!o.views) return;
    saved = await o.views();
    viewsSel.replaceChildren(h('option', { value: '' }, 'Saved views…'), ...saved.map((v, i) => h('option', { value: String(i) }, v.name)));
  }
  viewsSel.addEventListener('change', () => { const v = saved[Number(viewsSel.value)]; if (v) { applyView(v); paintFacets(); void refresh(true); } viewsSel.value = ''; });

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => later()) : undefined;
  ro?.observe(lanes);

  // ---------- start ----------
  const ready = (async () => {
    catalog = await o.source.catalog();
    sensitive = catalog.sources.flatMap(s => (s.sensitive ?? []).map(a => `${s.name}.${a}`));
    for (const s of catalog.sources) for (const x of s.series) seriesInfo.set(x.name, { unit: x.unit, type: x.type, title: x.title, source: s.name });
    const firstHost = catalog.hosts.length === 1 ? `host:${catalog.hosts[0].replace(/[%/:\s]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)}` : '';
    scope = firstHost;
    const now = catalog.now;
    view = { t0: now - DAY, t1: now + DAY * 0.02 };
    const v = readUrl() ?? o.view;
    if (v) applyView(v);
    paintFacets();
    await loadViews();
    await refresh(true);
    if (q) await findHits();
  })();

  return {
    el,
    ready,
    get view() { return currentView(); },
    setView(v: Partial<View>) { applyView(v); paintFacets(); return refresh(true); },
    setRange(t0: number, t1: number) { view = { t0, t1 }; follow = false; return refresh(); },
    setPlayhead,
    setLive,
    setTheme,
    refresh: () => refresh(true),
    /** for tests and hosts: what is drawn, and the mapping */
    internal: {
      get result() { return result; }, get mode() { return mode(); }, get scale() { return scale; }, get gaps() { return gaps; },
      get playState() { return playState; }, get hits() { return hits; }, get selected() { return selected; }, get follow() { return follow; },
      openCut, showTable, rangeEvents, exportRange, select, stepHit, drill, findHits, paint, lines,
    },
    dispose() { unsub?.(); ro?.disconnect(); if (frame) cancelAnimationFrame(frame); el.replaceChildren(); },
  };
}
export type TimelineHandle = ReturnType<typeof mountTimeline>;
export type { MetricPoint, MetricRollup, Row, Query, Result };
