// The timeline's x axis: time to pixels, piecewise, with long empty stretches collapsed into narrow "time breaks"
// (docs/timeline/README.md §8). Pure.
//   - findGaps(): the stretches of the visible range with no activity in any row shown (activity: an event's start, a
//     span's end, a bin with events, a metric that changed), longer than a share of the range and than a floor.
//   - timeScale(): the mapping. Each gap is drawn `cut` px wide (or wider, while it is being expanded: weight 0..1),
//     the rest of the width shared out in proportion to time. x(t) is monotonic; t(x) is its inverse, except that an
//     x inside a cut gives the nearer edge, so a playhead never stops in one and a drag across one jumps it.
//   - ticks(): round times in the owner's zone, every segment on its own, none inside a gap.

import { offsetAt } from './timeline-time.ts';

export interface Gap { from: number; to: number }
export interface Cut extends Gap { x0: number; x1: number; weight: number }

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

/** The gaps of [t0, t1): activity intervals are [a, b) (a mark is [t, t]); a gap is a stretch between them (or between
 *  the range's edges and them) longer than minFrac of the range and than minMs. */
export function findGaps(activity: [number, number][], t0: number, t1: number, o: { minFrac?: number; minMs?: number } = {}): Gap[] {
  const minLen = Math.max((o.minFrac ?? 0.15) * (t1 - t0), o.minMs ?? 10 * MIN);
  const xs = activity.filter(([a, b]) => b >= t0 && a < t1).map(([a, b]) => [Math.max(t0, a), Math.min(t1, Math.max(a, b))] as [number, number]).sort((p, q) => p[0] - q[0]);
  const out: Gap[] = [];
  // an empty view has nothing to judge against: no gaps
  if (!xs.length) return out;
  let at = t0;
  for (const [a, b] of xs) { if (a - at > minLen) out.push({ from: at, to: a }); at = Math.max(at, b); }
  if (t1 - at > minLen) out.push({ from: at, to: t1 });
  return out;
}

/** "14 h", "2 d 3 h", "45 min" */
export function gapLabel(ms: number): string {
  if (ms >= DAY) { const d = Math.floor(ms / DAY), hh = Math.round((ms - d * DAY) / HOUR); return hh ? `${d} d ${hh} h` : `${d} d`; }
  if (ms >= HOUR) { const hh = Math.floor(ms / HOUR), m = Math.round((ms - hh * HOUR) / MIN); return m && hh < 10 ? `${hh} h ${m} min` : `${hh} h`; }
  return `${Math.max(1, Math.round(ms / MIN))} min`;
}

export interface TimeScale {
  t0: number; t1: number; width: number;
  cuts: Cut[];
  x(t: number): number;
  /** the time at x; inside a cut, its nearer edge */
  t(x: number): number;
  /** the cut at x, if any */
  cutAt(x: number): Cut | undefined;
  /** visible ms per px outside the cuts */
  msPerPx: number;
}

/** weights: how far each gap is expanded (0: a cut; 1: its own width in time), by gapKey */
export const gapKey = (g: Gap) => `${g.from}-${g.to}`;

export function timeScale(t0: number, t1: number, width: number, gaps: Gap[] = [], o: { cut?: number; weights?: Map<string, number> } = {}): TimeScale {
  const cutPx = o.cut ?? 24, W = Math.max(1, width), span = Math.max(1, t1 - t0);
  const gs = gaps.filter(g => g.to > t0 && g.from < t1).map(g => ({ from: Math.max(t0, g.from), to: Math.min(t1, g.to), w: o.weights?.get(gapKey(g)) ?? 0 })).sort((a, b) => a.from - b.from);
  // a fully expanded gap is just time; a collapsed one costs cutPx. Solve for k (px per ms outside the cuts):
  //   W = k * (span - Σ len) + Σ ((1 - w) * cutPx + w * k * len)
  const lenC = gs.reduce((n, g) => n + (g.to - g.from) * (1 - g.w), 0);
  const fixed = gs.reduce((n, g) => n + (1 - g.w) * cutPx, 0);
  let k = (W - fixed) / Math.max(1, span - lenC);
  if (!(k > 0) || fixed > W * 0.6) { // too many cuts for the width: draw them as plain time
    return timeScale(t0, t1, width, [], o);
  }
  // the breakpoints: (t, x) at every gap's edges
  const pts: [number, number][] = [[t0, 0]];
  let x = 0, t = t0;
  const cuts: Cut[] = [];
  for (const g of gs) {
    x += (g.from - t) * k; pts.push([g.from, x]);
    const wpx = (1 - g.w) * cutPx + g.w * k * (g.to - g.from);
    cuts.push({ from: g.from, to: g.to, x0: x, x1: x + wpx, weight: g.w });
    x += wpx; pts.push([g.to, x]); t = g.to;
  }
  pts.push([t1, x + (t1 - t) * k]);
  const xOf = (tt: number) => {
    if (tt <= t0) return (tt - t0) * k;
    if (tt >= t1) return pts[pts.length - 1][1] + (tt - t1) * k;
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][0] <= tt) lo = m; else hi = m; }
    const [ta, xa] = pts[lo], [tb, xb] = pts[hi];
    return tb === ta ? xa : xa + ((tt - ta) / (tb - ta)) * (xb - xa);
  };
  const cutAt = (px: number) => cuts.find(c => c.weight < 1 && px > c.x0 && px < c.x1);
  const tOf = (px: number) => {
    const c = cutAt(px);
    if (c) return px - c.x0 < c.x1 - px ? c.from : c.to;
    if (px <= 0) return t0 + px / k;
    let lo = 0, hi = pts.length - 1;
    if (px >= pts[hi][1]) return t1 + (px - pts[hi][1]) / k;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][1] <= px) lo = m; else hi = m; }
    const [ta, xa] = pts[lo], [tb, xb] = pts[hi];
    return xb === xa ? ta : ta + ((px - xa) / (xb - xa)) * (tb - ta);
  };
  return { t0, t1, width: W, cuts, x: xOf, t: tOf, cutAt, msPerPx: 1 / k };
}

const STEPS = [1000, 5000, 15000, 30000, MIN, 5 * MIN, 15 * MIN, 30 * MIN, HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 28 * DAY];
export interface Tick { t: number; x: number; label: string; major: boolean }

/** round times at least minPx apart, in the owner's zone (local hours and days), skipping the cuts */
export function ticks(s: TimeScale, tz?: string, minPx = 80): Tick[] {
  const step = STEPS.find(st => st / s.msPerPx >= minPx) ?? STEPS[STEPS.length - 1];
  const out: Tick[] = [];
  const fmt = (t: number) => {
    const local = new Date(t + offsetAt(tz, t));
    const hh = String(local.getUTCHours()).padStart(2, '0'), mm = String(local.getUTCMinutes()).padStart(2, '0'), ss = String(local.getUTCSeconds()).padStart(2, '0');
    const day = `${local.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][local.getUTCMonth()]}`;
    const midnight = hh === '00' && mm === '00' && ss === '00';
    if (step >= DAY || midnight) return { label: day, major: true };
    return { label: step < MIN ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`, major: false };
  };
  // each stretch between cuts on its own, so a tick never sits in a gap and resumes just after one
  const segs: [number, number][] = [];
  let a = s.t0;
  for (const c of s.cuts) if (c.weight < 1) { segs.push([a, c.from]); a = c.to; }
  segs.push([a, s.t1]);
  for (const [from, to] of segs) {
    // round local times (lt), each turned back to UTC at the offset in force then
    const utc = (lt: number) => lt - offsetAt(tz, lt - offsetAt(tz, lt));
    let lt = Math.ceil((from + offsetAt(tz, from)) / step) * step;
    if (step >= 7 * DAY) lt = Math.ceil((from + offsetAt(tz, from)) / DAY) * DAY;
    for (let guard = 0, t = utc(lt); t < to && guard < 2000; guard++, lt += step, t = utc(lt)) {
      if (t < from) continue;
      const x = s.x(t), prev = out[out.length - 1];
      if (!prev || x - prev.x >= minPx * 0.6) out.push({ t, x, ...fmt(t) });
    }
  }
  return out;
}
