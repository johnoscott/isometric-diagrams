// A brushed range's events, exported (docs/timeline/README.md §4): JSON (a recording's events, as they are) or CSV (one
// row per event, attrs and links as columns). A sensitive attr is left out unless asked for.

import type { TimelineEvent, TimelineTypes, AnyTimeline } from './timeline-contract.ts';

const BASE = ['id', 'time', 't', 'dur', 'scope', 'source', 'kind', 'severity', 'summary'] as const;
const cell = (v: unknown) => {
  if (v === undefined || v === null) return '';
  // a string a spreadsheet would run as a formula starts with a quote mark
  const s = typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const drop = <E extends { source: string; attrs: Record<string, unknown> }>(e: E, sensitive: Set<string>): E => (sensitive.size ? { ...e, attrs: Object.fromEntries(Object.entries(e.attrs).filter(([k]) => !sensitive.has(`${e.source}.${k}`))) } : e);

/** sensitive: "source.attr" names to leave out */
export function toJSON<T extends TimelineTypes = AnyTimeline>(events: TimelineEvent<T>[], sensitive: Iterable<string> = []): string {
  const s = new Set(sensitive);
  return JSON.stringify(events.map(e => drop(e, s)), null, 2) + '\n';
}

/** CSV: the base columns, then attr.* and link.* columns for every key present (spreadsheet formulas defused) */
export function toCSV<T extends TimelineTypes = AnyTimeline>(events: TimelineEvent<T>[], sensitive: Iterable<string> = []): string {
  const s = new Set(sensitive);
  const es = events.map(e => drop(e, s));
  const attrs = [...new Set(es.flatMap(e => Object.keys(e.attrs)))].sort();
  const links = [...new Set(es.flatMap(e => Object.keys(e.links)))].sort();
  const head = [...BASE, ...attrs.map(a => `attr.${a}`), ...links.map(l => `link.${l}`)];
  const rows = es.map(e => [e.id, new Date(e.t).toISOString(), e.t, e.dur, e.scope, e.source, e.kind, e.severity, e.summary,
    ...attrs.map(a => e.attrs[a]), ...links.map(l => (e.links as Record<string, string | undefined>)[l])].map(cell).join(','));
  return [head.join(','), ...rows].join('\r\n') + '\r\n';
}
