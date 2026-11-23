// A timeline source held in memory (docs/timeline/README.md §8): a Recording's events and metrics, answered as a host
// would answer query() and subscribe(): rows by scope and depth, the parsed search and filters, binning in the owner's
// time zone, rollups, pages, retention, renames, and live batches as records are appended (a record given again
// replaces the first). A fixture source and a simulation's source are this; a host with its own store does the same
// work there. Pure (no DOM, no clock: now is given). The scope rules, the search's links and the rows' flags are the
// domain's catalogue's.

import {
  BIN_MS, SEVERITIES, type Batch, type Bin, type Catalog, type Days, type EffectiveRetention, type EventBin, type MetricPoint,
  type MetricRollup, type Query, type Recording, type Result, type Retention, type Row, type Scope,
  type TimelineEvent, type TimelineSource,
  type TimelineCatalog,
} from './timeline-contract.ts';
import { levelOf, prefixAt, within, kindOf, nameOf, scopeRules } from './timeline-scope.ts';
import { searchFor, rangeOf } from './timeline-search.ts';
import { binStart, offsetAt } from './timeline-time.ts';

const DAY = 86_400_000, HOUR = 3_600_000;
/** an hour's events on one scope from one source: what a binned query without a search reads instead of every event */
interface HourBin { t: number; count: number; severity: Record<string, number>; kinds: Record<string, number>; first: number; last: number }
/** a stored metric sample: a point is {v, v, v, 1} */
interface Fine { t: number; min: number; max: number; sum: number; count: number }
interface SeriesStore { series: string; scope: Scope; fine: Fine[]; cache: Map<string, Fine[]> }

const byTimeId = (a: TimelineEvent, b: TimelineEvent) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** the first index with e.t >= t */
function lower(es: { t: number }[], t: number): number {
  let lo = 0, hi = es.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (es[m].t < t) lo = m + 1; else hi = m; }
  return lo;
}
const combine = (into: Fine, f: Fine) => { into.min = Math.min(into.min, f.min); into.max = Math.max(into.max, f.max); into.sum += f.sum; into.count += f.count; };
/** fine samples into bins (each bin the min of mins, max of maxes, sums of sums and counts) */
function rollUp(fine: Fine[], bin: Bin, tz?: string): Fine[] {
  const out: Fine[] = [];
  for (const f of fine) {
    const t = binStart(f.t, bin, tz), last = out[out.length - 1];
    if (last && last.t === t) combine(last, f); else out.push({ t, min: f.min, max: f.max, sum: f.sum, count: f.count });
  }
  return out;
}
/** a sorted array: replace the item same() finds at x.t, or insert x in order */
function place<T extends { t: number }>(xs: T[], x: T, same: (a: T) => boolean, order: (a: T, b: T) => number) {
  for (let i = lower(xs, x.t); i < xs.length && xs[i].t === x.t; i++) if (same(xs[i])) { xs[i] = x; return; }
  const last = xs[xs.length - 1];
  if (!last || order(last, x) <= 0) { xs.push(x); return; }
  let i = lower(xs, x.t);
  while (i < xs.length && order(xs[i], x) < 0) i++;
  xs.splice(i, 0, x);
}
function remove<T extends { t: number }>(xs: T[], t: number, same: (a: T) => boolean) {
  for (let i = lower(xs, t); i < xs.length && xs[i].t === t; i++) if (same(xs[i])) { xs.splice(i, 1); return; }
}
export interface MemorySourceOptions {
  /** the host's now (default: the recording's catalog.now) */
  now?: number;
  /** the state at t, where one was recorded (frames), as the timeline may show it */
  stateAt?(scope: Scope, t: number): Promise<unknown>;
}

export interface MemorySource extends TimelineSource {
  /** new or changed records, and the host's now: subscribers get them as a batch (an id, or a series, scope and t,
   *  given again replaces the first) */
  append(events: TimelineEvent[], metrics?: (MetricPoint | MetricRollup)[], now?: number): void;
  /** the user's retention for a source (what the host's settings would do) */
  setRetention(source: string, r: Retention): void;
  readonly now: number;
  readonly size: { events: number; samples: number };
}

export function memorySource(rec: Recording, cat: TimelineCatalog, o: MemorySourceOptions = {}): MemorySource {
  const catalog = rec.catalog;
  const { isScope } = scopeRules(cat), { parseSearch, matchAst, toAst } = searchFor(cat);
  /** a name's flags, on its row */
  const flagsOf = (n: object | undefined): object => Object.fromEntries(cat.flags.filter(f => (n as Record<string, unknown> | undefined)?.[f]).map(f => [f, true]));
  let now = o.now ?? catalog.now;
  // renames: an old scope's history shows under the new one
  const aliases = (catalog.names ?? []).flatMap(n => (n.aliases ?? []).map(a => [a, n.scope] as const)).sort((a, b) => b[0].length - a[0].length);
  const canonical = new Map<Scope, Scope>();
  const canon = (s: Scope): Scope => {
    if (!aliases.length) return s;
    let c = canonical.get(s);
    if (c === undefined) { const a = aliases.find(([from]) => within(s, from)); c = a ? a[1] + s.slice(a[0].length) : s; canonical.set(s, c); }
    return c;
  };
  const names = new Map((catalog.names ?? []).map(n => [n.scope, n]));
  const fix = (e: TimelineEvent) => (aliases.length ? { ...e, scope: canon(e.scope) } : e);
  const keyOf = (e: TimelineEvent) => `${e.source}\u0000${e.id}`;

  const events: TimelineEvent[] = rec.events.map(fix).sort(byTimeId);
  const byId = new Map<string, TimelineEvent>();
  for (const e of events) byId.set(keyOf(e), e);
  /** closed spans by start, and the longest, so a range finds those that began before it; open spans apart */
  const spans: TimelineEvent[] = events.filter(e => e.dur !== undefined && !e.open);
  let maxDur = spans.reduce((m, e) => Math.max(m, e.dur!), 0);
  const open = new Map<string, TimelineEvent>();
  for (const e of events) if (e.open) open.set(keyOf(e), e);
  const stores = new Map<string, SeriesStore>();
  const scopes = new Set<Scope>();
  const noteScope = (s: Scope) => { for (let l = levelOf(s); l >= 1; l--) { const p = prefixAt(s, l); if (scopes.has(p)) break; scopes.add(p); } };
  const seriesType = new Map<string, 'counter' | 'gauge'>();
  for (const s of catalog.sources) for (const x of s.series) seriesType.set(x.name, x.type);
  const sensitive = catalog.sources.flatMap(s => (s.sensitive ?? []).map(a => `${s.name}.${a}`));
  const retention = new Map<string, Omit<EffectiveRetention, 'keptFrom' | 'source'>>();
  for (const s of catalog.sources) retention.set(s.name, { events: s.defaultRetention.events, rollups: { ...s.defaultRetention.rollups }, setBy: 'default' });
  for (const r of catalog.retention) retention.set(r.source, { events: r.events, rollups: { ...r.rollups }, setBy: r.setBy });
  const seriesSource = new Map<string, string>();
  for (const s of catalog.sources) for (const x of s.series) seriesSource.set(x.name, s.name);

  function addMetric(m: MetricPoint | MetricRollup) {
    const scope = canon(m.scope), key = `${m.series}\u0000${scope}`;
    let st = stores.get(key);
    if (!st) { st = { series: m.series, scope, fine: [], cache: new Map() }; stores.set(key, st); noteScope(scope); }
    const f: Fine = 'value' in m ? { t: m.t, min: m.value, max: m.value, sum: m.value, count: 1 } : { t: m.t, min: m.min, max: m.max, sum: m.sum, count: m.count };
    place(st.fine, f, a => a.t === f.t, (a, b) => a.t - b.t);
    st.cache.clear();
  }
  for (const e of events) noteScope(e.scope);
  for (const m of rec.metrics) addMetric(m);
  // the hour bins, kept as events come and go (scope → source → hour start → bin)
  const hours = new Map<Scope, Map<string, Map<number, HourBin>>>();
  /** the sources with events */
  const present = new Set<string>();
  const tally = (e: TimelineEvent, by: 1 | -1) => {
    present.add(e.source);
    let bySrc = hours.get(e.scope); if (!bySrc) hours.set(e.scope, bySrc = new Map());
    let byT = bySrc.get(e.source); if (!byT) bySrc.set(e.source, byT = new Map());
    const t = Math.floor(e.t / HOUR) * HOUR;
    let b = byT.get(t); if (!b) byT.set(t, b = { t, count: 0, severity: {}, kinds: {}, first: Infinity, last: -Infinity });
    b.count += by;
    if (by > 0) { b.first = Math.min(b.first, e.t); b.last = Math.max(b.last, e.t); }
    else if (e.t === b.first || e.t === b.last) {
      // (called after the event left the list) the hour's others, again
      b.first = Infinity; b.last = -Infinity;
      for (let i = lower(events, t); i < events.length && events[i].t < t + HOUR; i++) { const x = events[i]; if (x.scope === e.scope && x.source === e.source) { b.first = Math.min(b.first, x.t); b.last = Math.max(b.last, x.t); } }
    } b.severity[e.severity] = (b.severity[e.severity] ?? 0) + by; b.kinds[e.kind] = (b.kinds[e.kind] ?? 0) + by;
    if (b.severity[e.severity] === 0) delete b.severity[e.severity];
    if (b.kinds[e.kind] === 0) delete b.kinds[e.kind];
    if (!b.count) byT.delete(t);
  };
  for (const e of events) tally(e, 1);
  const binned = (st: SeriesStore, bin: Bin, tz?: string): Fine[] => {
    const key = `${bin}|${tz ?? ''}`;
    let c = st.cache.get(key);
    if (!c) { c = bin === '1d' ? rollUp(binned(st, '1h', tz), '1d', tz) : rollUp(st.fine, bin, tz); st.cache.set(key, c); }
    return c;
  };

  /** a cut-off: before it, nothing of that kind is kept */
  const cutoff = (d: Days) => (d === null ? -Infinity : now - d * DAY);
  const eventCut = (source: string) => cutoff(retention.get(source)?.events ?? null);
  const binCut = (source: string, bin?: Bin) => { const r = retention.get(source); return cutoff(r ? (bin ? r.rollups[bin] : r.events) : null); };

  function effective(srcNames: Iterable<string>): EffectiveRetention[] {
    const out: EffectiveRetention[] = [];
    for (const name of new Set(srcNames)) {
      const r = retention.get(name);
      if (!r) continue;
      const first = events.find(e => e.source === name && e.t >= eventCut(name))?.t;
      const firstSample = (bin?: Bin) => {
        let m = Infinity;
        for (const st of stores.values()) if (seriesSource.get(st.series) === name) { const f = (bin ? binned(st, bin) : st.fine).find(x => x.t >= binCut(name, bin)); if (f && f.t < m) m = f.t; }
        return m === Infinity ? undefined : m;
      };
      const ev = [first, firstSample()].filter((x): x is number => x !== undefined);
      const rollups: Partial<Record<Bin, number>> = {};
      for (const b of ['1m', '1h', '1d'] as Bin[]) {
        const f = firstSample(b) ?? (first !== undefined && first >= binCut(name, b) ? first : undefined);
        if (f !== undefined) rollups[b] = Math.max(f, binCut(name, b));
      }
      out.push({ source: name, events: r.events, rollups: { ...r.rollups }, setBy: r.setBy, keptFrom: { ...(ev.length ? { events: Math.min(...ev) } : {}), rollups } });
    }
    return out;
  }

  /** what a query keeps of an event: scope, filters, the parsed search, retention. A query with q and no where (a
   *  convenience for tests and fixtures) is parsed here, as the component would. */
  function predicate(q: Query) {
    let where = q.where, range = { from: q.from, to: q.to }, warnings: string[] = [];
    if (!where && q.q) { const p = parseSearch(q.q, now); where = toAst(p); range = rangeOf(p, q.from, q.to); warnings = p.warnings; }
    const m = matchAst(where, sensitive);
    const f = q.filters ?? {};
    const src = f.source?.length ? new Set(f.source) : undefined, kind = f.kind?.length ? new Set(f.kind) : undefined;
    const sev = f.severity?.length ? new Set<string>(f.severity) : undefined, sc = f.scope?.length ? f.scope : undefined;
    const test = (e: TimelineEvent) => within(e.scope, q.scope) && (!src || src.has(e.source)) && (!kind || kind.has(e.kind)) && (!sev || sev.has(e.severity))
      && (!sc || sc.some(s => within(e.scope, s))) && e.t >= eventCut(e.source) && m(e);
    return { test, range, warnings };
  }

  /** the rows of a query, and each scope's row (or undefined: not under the query's scope) */
  function rowsOf(q: Query) {
    const base = levelOf(q.scope), level = base + q.depth;
    const rowOf = new Map<Scope, Scope | undefined>();
    const at = (s: Scope): Scope | undefined => {
      let r = rowOf.get(s);
      if (r === undefined && !rowOf.has(s)) { r = within(s, q.scope) ? (levelOf(s) >= level ? prefixAt(s, level) : s) : undefined; rowOf.set(s, r); }
      return r;
    };
    const children = (s: Scope) => { let n = 0; const l = levelOf(s) + 1; for (const x of scopes) if (levelOf(x) === l && within(x, s)) n++; return n; };
    const rows = new Map<Scope, Row>();
    const add = (s: Scope) => {
      let r = rows.get(s);
      if (!r) {
        const d = levelOf(s) - base, n = names.get(s);
        r = { scope: s, label: n?.label ?? nameOf(s), kind: kindOf(s), ...flagsOf(n), depth: d, ...(d < q.depth ? { own: true } : {}), children: children(s), count: 0 };
        rows.set(s, r);
      }
      return r;
    };
    // every known scope at the rows' level is a row, with events in range or not
    for (const s of scopes) if (levelOf(s) === level && within(s, q.scope)) add(s);
    if (level === 0) add('');
    return { at, add, rows };
  }
  const sortRows = (rows: Map<Scope, Row>) => [...rows.values()].sort((a, b) => (a.scope === b.scope ? 0 : a.scope < b.scope ? -1 : 1));

  function inRange(from: number, to: number): TimelineEvent[] {
    // spans that began before from and last into it (open ones last to now), then everything that starts in [from, to)
    const out: TimelineEvent[] = [];
    for (let i = lower(spans, from - maxDur); i < spans.length && spans[i].t < from; i++) if (spans[i].t + spans[i].dur! > from) out.push(spans[i]);
    for (const e of open.values()) if (e.t < from && now > from) out.push(e);
    for (let i = lower(events, from); i < events.length && events[i].t < to; i++) out.push(events[i]);
    return out;
  }

  function metricsFor(q: Query, at: (s: Scope) => Scope | undefined, from: number, to: number): (MetricPoint | MetricRollup)[] {
    const want = q.series ? new Set(q.series) : undefined;
    const acc = new Map<string, MetricRollup>();
    for (const st of stores.values()) {
      if (want && !want.has(st.series)) continue;
      const row = at(st.scope);
      if (row === undefined) continue;
      const src = seriesSource.get(st.series) ?? '';
      const cut = binCut(src, q.bin);
      const list = q.bin ? binned(st, q.bin, q.tz) : st.fine;
      for (let i = lower(list, q.bin ? binStart(from, q.bin, q.tz) : from); i < list.length && list[i].t < to; i++) {
        const f = list[i];
        if (f.t < cut) continue;
        const key = `${st.series}\u0000${row}\u0000${f.t}`;
        const a = acc.get(key);
        if (a) combine(a as unknown as Fine, f);
        else acc.set(key, { series: st.series, scope: row, t: f.t, bin: q.bin ?? '1m', min: f.min, max: f.max, sum: f.sum, count: f.count });
      }
    }
    const out = [...acc.values()].sort((a, b) => a.t - b.t || (a.series < b.series ? -1 : 1) || (a.scope < b.scope ? -1 : 1));
    if (q.bin) return out;
    // unbinned: points, a row's samples at one time combined (counters add; a gauge's mean)
    return out.map(r => ({ series: r.series, scope: r.scope, t: r.t, value: r.count === 1 || seriesType.get(r.series) !== 'gauge' ? r.sum : r.sum / r.count }));
  }

  const encode = (e: TimelineEvent) => `${e.t}:${e.id}`;
  const after = (e: TimelineEvent, c: string) => { const i = c.indexOf(':'), t = Number(c.slice(0, i)), id = c.slice(i + 1); return e.t > t || (e.t === t && e.id > id); };

  /** A binned query (1h or 1d) without a search, kind, severity or scope filter, in whole-hour time, with nothing in
   *  its range cut by retention, is answered from the hour bins: the same answer, without reading every event. */
  function fastBinned(q: Query): Result | undefined {
    if (q.bin !== '1h' && q.bin !== '1d') return undefined;
    if ((q.where?.all.length ?? 0) || q.q || q.filters?.kind?.length || q.filters?.severity?.length || q.filters?.scope?.length) return undefined;
    if (offsetAt(q.tz, q.from) % HOUR || offsetAt(q.tz, q.to) % HOUR) return undefined;
    const srcs = q.filters?.source?.length ? new Set(q.filters.source) : undefined;
    // each source from its own start: the query's, or later where retention has cut it
    const fromOf = (src: string) => Math.max(q.from, eventCut(src));
    const { at, add, rows } = rowsOf(q);
    const sources = new Set<string>();
    const bins = new Map<string, EventBin>();
    let total = 0;
    const binOf = (row: Scope, t: number) => {
      const bt = binStart(t, q.bin!, q.tz), key = `${row}\u0000${bt}`;
      let b = bins.get(key);
      if (!b) { b = { scope: row, t: bt, bin: q.bin!, count: 0, severity: {}, kinds: {} }; bins.set(key, b); }
      return b;
    };
    const count = (row: Scope, t: number, n: number) => { const r = add(row); r.count += n; total += n; if (r.first === undefined || t < r.first) r.first = t; if (r.last === undefined || t > r.last) r.last = t; };
    // whole hours from the bins; the part-hours at each source's edges, and spans that began before, by their events
    const inner1 = Math.floor(q.to / HOUR) * HOUR;
    for (const [scope, bySrc] of hours) {
      const row = at(scope);
      if (row === undefined) continue;
      for (const [source, byT] of bySrc) {
        if (srcs && !srcs.has(source)) continue;
        const inner0 = Math.ceil(fromOf(source) / HOUR) * HOUR;
        for (const [t, hb] of byT) {
          if (t < inner0 || t >= inner1) continue;
          count(row, hb.first, hb.count);
          if (hb.last > (rows.get(row)!.last ?? -Infinity)) rows.get(row)!.last = hb.last;
          sources.add(source);
          const b = binOf(row, t);
          b.count += hb.count;
          for (const [k, n] of Object.entries(hb.severity)) b.severity[k as keyof typeof b.severity] = (b.severity[k as keyof typeof b.severity] ?? 0) + n;
          for (const [k, n] of Object.entries(hb.kinds)) b.kinds![k] = (b.kinds![k] ?? 0) + n;
        }
      }
    }
    const take = (e: TimelineEvent) => within(e.scope, q.scope) && (!srcs || srcs.has(e.source)) && e.t >= eventCut(e.source) && at(e.scope) !== undefined;
    const one = (e: TimelineEvent) => { const row = at(e.scope)!; count(row, e.t, 1); sources.add(e.source); const b = binOf(row, e.t); b.count++; b.severity[e.severity] = (b.severity[e.severity] ?? 0) + 1; b.kinds![e.kind] = (b.kinds![e.kind] ?? 0) + 1; };
    for (const src of present) {
      if (srcs && !srcs.has(src)) continue;
      const a0 = fromOf(src), inner0 = Math.ceil(a0 / HOUR) * HOUR;
      const edges: [number, number][] = inner0 >= inner1 ? [[a0, q.to]] : [[a0, inner0], [inner1, q.to]];
      for (const [a, z] of edges) for (let i = lower(events, a); i < events.length && events[i].t < z; i++) { const e = events[i]; if (e.source === src && take(e)) one(e); }
    }
    const w = BIN_MS[q.bin], long: TimelineEvent[] = [];
    // spans that began before the range and last into it: in the total and on their row (not in a bin), as a scan has them
    for (let i = lower(spans, q.from - maxDur); i < spans.length && spans[i].t < q.from; i++) {
      const e = spans[i];
      if (e.t + e.dur! > q.from && take(e)) { count(at(e.scope)!, e.t, 1); sources.add(e.source); if (e.dur! >= w && long.length < 5000) long.push(e); }
    }
    for (const e of open.values()) if (e.t < q.from && now > q.from && take(e)) { count(at(e.scope)!, e.t, 1); sources.add(e.source); if (long.length < 5000) long.push(e); }
    for (let i = lower(spans, q.from); i < spans.length && spans[i].t < q.to && long.length < 5000; i++) if (spans[i].dur! >= w && take(spans[i])) long.push(spans[i]);
    for (const e of open.values()) if (e.t >= q.from && e.t < q.to && long.length < 5000 && take(e)) long.push(e);
    const metrics = metricsFor(q, at, q.from, q.to);
    for (const m of metrics) { const s2 = seriesSource.get(m.series); if (s2) sources.add(s2); }
    const out = [...bins.values()].sort((a, b) => a.t - b.t || (a.scope < b.scope ? -1 : 1));
    return { timeline: 1, type: 'result', rows: sortRows(rows), bins: out, spans: long, metrics, total, retention: effective(sources) };
  }

  async function query(q: Query): Promise<Result> {
    if (!isScope(q.scope)) throw new Error(`not a scope path: ${JSON.stringify(q.scope)}`);
    const fast = fastBinned(q);
    if (fast) return fast;
    const { test, range, warnings } = predicate(q);
    const { at, add, rows } = rowsOf(q);
    const sources = new Set<string>();
    const hits: TimelineEvent[] = [];
    for (const e of inRange(range.from, range.to)) {
      if (!test(e)) continue;
      const row = at(e.scope);
      if (row === undefined) continue;
      const r = add(row);
      r.count++;
      if (r.first === undefined || e.t < r.first) r.first = e.t;
      if (r.last === undefined || e.t > r.last) r.last = e.t;
      sources.add(e.source);
      hits.push(e);
    }
    hits.sort(byTimeId);
    const metrics = metricsFor(q, at, range.from, range.to);
    for (const m of metrics) { const s = seriesSource.get(m.series); if (s) sources.add(s); }
    const base = { timeline: 1 as const, type: 'result' as const, total: hits.length, ...(warnings.length ? { warnings } : {}) };
    if (q.bin) {
      const w = BIN_MS[q.bin], bins = new Map<string, EventBin>(), long: TimelineEvent[] = [];
      for (const e of hits) {
        if ((e.open || (e.dur !== undefined && e.dur >= w)) && long.length < 5000) long.push(e);
        if (e.t < range.from) continue; // a span that began before the range: counted in its own bin, elsewhere
        const row = at(e.scope)!, t = binStart(e.t, q.bin, q.tz), key = `${row}\u0000${t}`;
        let b = bins.get(key);
        if (!b) { b = { scope: row, t, bin: q.bin, count: 0, severity: {}, kinds: {} }; bins.set(key, b); }
        b.count++;
        b.severity[e.severity] = (b.severity[e.severity] ?? 0) + 1;
        b.kinds![e.kind] = (b.kinds![e.kind] ?? 0) + 1;
      }
      const out = [...bins.values()].sort((a, b) => a.t - b.t || (a.scope < b.scope ? -1 : 1));
      return { ...base, rows: sortRows(rows), bins: out, spans: long, metrics, retention: effective(sources) };
    }
    const limit = Math.min(10000, Math.max(1, q.limit ?? 2000));
    const start = q.cursor ? hits.findIndex(e => after(e, q.cursor!)) : 0;
    const page = start < 0 ? [] : hits.slice(start, start + limit);
    const more = start >= 0 && start + limit < hits.length;
    return { ...base, rows: sortRows(rows), events: page, metrics, retention: effective(sources), ...(more ? { next: encode(page[page.length - 1]) } : {}) };
  }

  const subs = new Set<{ q: Query; on: (b: Batch) => void }>();
  const severityOk = (s: string) => (SEVERITIES as readonly string[]).includes(s);
  let seq = 0;

  /** an event, new or replacing the one with its id */
  function put(e: TimelineEvent) {
    const key = keyOf(e), old = byId.get(key);
    if (old) {
      remove(events, old.t, x => x === old);
      tally(old, -1);
      if (old.dur !== undefined && !old.open) remove(spans, old.t, x => x === old);
      open.delete(key);
    }
    byId.set(key, e);
    tally(e, 1);
    place(events, e, () => false, byTimeId);
    if (e.open) open.set(key, e);
    else if (e.dur !== undefined) { place(spans, e, () => false, byTimeId); maxDur = Math.max(maxDur, e.dur); }
    noteScope(e.scope);
  }

  return {
    async catalog(): Promise<Catalog> {
      return { ...catalog, now, retention: effective(catalog.sources.map(s => s.name)) };
    },
    query,
    subscribe(q, on) {
      const sub = { q, on };
      subs.add(sub);
      return () => { subs.delete(sub); };
    },
    ...(o.stateAt ? { stateAt: (scope: Scope, t: number) => o.stateAt!(scope, t) } : {}),
    append(es, ms = [], t) {
      if (t !== undefined) now = Math.max(now, t);
      const known = new Set(scopes);
      const fixed = es.map(fix);
      for (const e of fixed) {
        if (!severityOk(e.severity)) throw new Error(`not a severity: ${e.severity}`);
        put(e);
      }
      for (const m of ms) addMetric(m);
      seq++;
      for (const s of subs) {
        const { test } = predicate(s.q);
        const { at } = rowsOf(s.q);
        const evs = fixed.filter(e => test(e) && at(e.scope) !== undefined);
        const want = s.q.series ? new Set(s.q.series) : undefined;
        const mets = ms.filter(m => within(canon(m.scope), s.q.scope) && (!want || want.has(m.series))).map(m => ({ ...m, scope: at(canon(m.scope))! }));
        const fresh = [...scopes].filter(x => !known.has(x));
        const level = levelOf(s.q.scope) + s.q.depth;
        const rows = fresh.filter(x => levelOf(x) === level && within(x, s.q.scope)).map(x => ({ scope: x, label: names.get(x)?.label ?? nameOf(x), kind: kindOf(x), depth: s.q.depth, children: 0, count: 0 }) as Row);
        s.on({ timeline: 1, type: 'batch', events: evs, metrics: mets, ...(rows.length ? { rows } : {}), now, resume: String(seq) });
      }
    },
    setRetention(source, r) { retention.set(source, { events: r.events, rollups: { ...r.rollups }, setBy: 'user' }); },
    get now() { return now; },
    get size() { let n = 0; for (const st of stores.values()) n += st.fine.length; return { events: events.length, samples: n }; },
  };
}
