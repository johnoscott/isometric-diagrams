// Bins in the owner's time zone (docs/timeline/README.md §3): a 1d bin starts at local midnight (so a day isn't split
// in UTC, and run ids' local days line up); a 1h bin starts on the local hour, which is the UTC hour unless the offset
// isn't whole hours (+05:30, +05:45); a 1m bin is the UTC minute (every offset is whole minutes). A local day may be 23
// or 25 hours. Pure (Intl only).

import type { Bin } from './timeline-contract.ts';

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const formats = new Map<string, Intl.DateTimeFormat>();
const offsets = new Map<string, number>();

/** the zone's offset from UTC at t, in ms (UTC, or an unknown zone: 0) */
export function offsetAt(tz: string | undefined, t: number): number {
  if (!tz || tz === 'UTC') return 0;
  const key = `${tz}|${Math.floor(t / (15 * MIN))}`;
  const hit = offsets.get(key);
  if (hit !== undefined) return hit;
  let f = formats.get(tz);
  if (!f) {
    try { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); }
    catch { return 0; }
    formats.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(t))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  const local = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  const off = Math.round((local - Math.floor(t / 1000) * 1000) / MIN) * MIN;
  if (offsets.size > 50_000) offsets.clear();
  offsets.set(key, off);
  return off;
}

export const isZone = (tz: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };

/** the start of the bin t falls in */
export function binStart(t: number, bin: Bin, tz?: string): number {
  if (bin === '1m') return Math.floor(t / MIN) * MIN;
  const off = offsetAt(tz, t);
  if (bin === '1h') return off % HOUR === 0 ? Math.floor(t / HOUR) * HOUR : Math.floor((t + off) / HOUR) * HOUR - off;
  // local midnight: the local day's start, at the offset in force then
  const day = Math.floor((t + off) / DAY) * DAY;
  let s = day - offsetAt(tz, day - off);
  if (s > t) s = day - DAY - offsetAt(tz, day - DAY - off);
  else if (binNext(s, tz) <= t) s = binNext(s, tz);
  return s;
}

/** the start of the next bin after a bin starting at s */
export function binNext(s: number, tz?: string, bin: Bin = '1d'): number {
  if (bin === '1m') return s + MIN;
  if (bin === '1h') return s + HOUR;
  const off = offsetAt(tz, s), day = Math.floor((s + off) / DAY) * DAY + DAY;
  return day - offsetAt(tz, day - off);
}
