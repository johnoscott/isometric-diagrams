// The timeline's search language (docs/timeline/README.md §5): free text, "quoted phrases", field:value and -negation.
// Pure: parseSearch reads a query, matcher() turns it into a test of one event, rangeOf() into the range it narrows to,
// and highlights() finds the free text's hits in a line. The component parses; a query carries the parse (toAst, a
// SearchAst, times already resolved), so a host never needs a parser: matchAst() is the reference for applying it.
// The language's link fields, and how a link matches, are the domain's (searchFor(cat)).

import { SEVERITIES, type Severity, type TimelineEvent, type SearchAst, type AstTerm, type Match, type TimelineCatalog } from './timeline-contract.ts';
import { within } from './timeline-scope.ts';

/** the fields every domain's search has; its link fields follow */
export const BASE_FIELDS = ['kind', 'source', 'severity', 'scope', 'since', 'before'] as const;
export type Field = string;
export type SearchDialect = Pick<TimelineCatalog, 'links' | 'linkMatch' | 'topKinds'>;

export interface Term {
  neg: boolean;
  /** absent: free text */
  field?: Field;
  /** severity only */
  op?: '=' | '>=' | '>' | '<=' | '<';
  value: string;
  /** since and before: the time read (ms) */
  time?: number;
}
export interface ParsedSearch { terms: Term[]; warnings: string[] }

/** split into tokens: -, field:, "quoted" values and phrases kept whole */
function tokens(q: string): { neg: boolean; raw: string; quoted: boolean; field?: string }[] {
  const out: { neg: boolean; raw: string; quoted: boolean; field?: string }[] = [];
  let i = 0;
  while (i < q.length) {
    while (i < q.length && /\s/.test(q[i])) i++;
    if (i >= q.length) break;
    let neg = false;
    if (q[i] === '-' && i + 1 < q.length && !/\s/.test(q[i + 1])) { neg = true; i++; }
    // field: a known name (or attr.KEY) then ":"
    const m = /^(attr\.[a-z][a-z0-9_]*|[a-z]+):/.exec(q.slice(i));
    let field: string | undefined;
    if (m) { field = m[1]; i += m[0].length; }
    let raw = '', quoted = false;
    if (q[i] === '"') {
      const j = q.indexOf('"', i + 1);
      raw = q.slice(i + 1, j < 0 ? q.length : j); quoted = true;
      i = j < 0 ? q.length : j + 1;
    } else { const s = i; while (i < q.length && !/\s/.test(q[i])) i++; raw = q.slice(s, i); }
    out.push({ neg, raw, quoted, field });
  }
  return out;
}

const REL = /^(\d+)(s|m|h|d|w)$/;
const UNIT: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 };
/** a time: 15m, 2h, 3d, 1w back from now; or a date or date-time, local unless it has a zone */
export function readTime(v: string, now: number): number | undefined {
  const r = REL.exec(v);
  if (r) return now - Number(r[1]) * UNIT[r[2]];
  const d = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(v);
  if (!d) return undefined;
  const [, y, mo, da, hh = '0', mi = '0', ss = '0', ms = '0', zone] = d;
  if (zone) { const t = Date.parse(v.replace(' ', 'T')); return Number.isNaN(t) ? undefined : t; }
  const t = new Date(+y, +mo - 1, +da, +hh, +mi, +ss, +ms.padEnd(3, '0')).getTime();
  return Number.isNaN(t) ? undefined : t;
}

function parseWith(fields: readonly string[], q: string, now = Date.now()): ParsedSearch {
  const terms: Term[] = [], warnings: string[] = [];
  for (const t of tokens(q ?? '')) {
    const asText = (why?: string) => {
      const value = t.field ? `${t.field}:${t.raw}` : t.raw;
      if (why) warnings.push(`${JSON.stringify(value)}: ${why}; searched as text`);
      if (value) terms.push({ neg: t.neg, value });
    };
    if (!t.field) { asText(); continue; }
    const known = fields.includes(t.field) || t.field.startsWith('attr.');
    if (!known) { asText(`no field ${t.field}`); continue; }
    if (!t.raw) { asText(`${t.field}: needs a value`); continue; }
    const field = t.field as Field;
    if (field === 'severity') {
      const m = /^(>=|<=|>|<|=)?(.*)$/.exec(t.raw)!;
      if (!(SEVERITIES as readonly string[]).includes(m[2])) { asText(`no severity ${m[2]} (${SEVERITIES.join(', ')})`); continue; }
      terms.push({ neg: t.neg, field, op: (m[1] as Term['op']) ?? '=', value: m[2] });
    } else if (field === 'since' || field === 'before') {
      const time = readTime(t.raw, now);
      if (time === undefined) { asText(`can't read the time ${t.raw} (15m, 2h, 3d, 1w, or a date like 2026-11-20 or 2026-11-20T09:30)`); continue; }
      if (t.neg) { asText(`-${field} isn't allowed (use ${field === 'since' ? 'before' : 'since'})`); continue; }
      terms.push({ neg: false, field, value: t.raw, time });
    } else terms.push({ neg: t.neg, field, value: t.raw });
  }
  return { terms, warnings };
}

const sevRank = (s: string) => (SEVERITIES as readonly string[]).indexOf(s);
const OPS = { '=': 'eq', '>=': 'ge', '>': 'gt', '<=': 'le', '<': 'lt' } as const;

/** one term as a match (since and before have none: they narrow the range) */
function matchOf(t: Term, d: SearchDialect): Match | undefined {
  switch (t.field) {
    case undefined: return { field: 'text', value: t.value };
    case 'kind': case 'source': return t.value.endsWith('*') ? { field: t.field, value: t.value.slice(0, -1), prefix: true } : { field: t.field, value: t.value };
    case 'severity': return { field: 'severity', op: OPS[t.op ?? '='], value: t.value as Severity };
    case 'scope': return { field: 'scope', value: t.value, from: d.topKinds.some(k => t.value.startsWith(`${k}:`)) ? 'top' : 'segments' };
    case 'since': case 'before': return undefined;
    default:
      if (d.links.includes(t.field)) return { field: 'link', link: t.field, value: t.value };
      return { field: 'attr', key: t.field.slice(5), value: t.value };
  }
}

/** The parse as the query carries it: the same field twice (positive) is one term of either; free text, severity and
 *  each negation are terms of their own. */
function toAstWith(d: SearchDialect, p: ParsedSearch): SearchAst {
  const all: AstTerm[] = [], groups = new Map<string, AstTerm>();
  for (const t of p.terms) {
    const m = matchOf(t, d);
    if (!m) continue;
    if (t.neg) { all.push({ not: true, any: [m] }); continue; }
    if (m.field === 'text' || m.field === 'severity') { all.push({ any: [m] }); continue; }
    const key = m.field === 'link' ? `link.${m.link}` : m.field === 'attr' ? `attr.${m.key}` : m.field;
    const g = groups.get(key);
    if (g) g.any.push(m); else { const n = { any: [m] }; groups.set(key, n); all.push(n); }
  }
  return { all };
}

/** one match against one event */
function test1(d: SearchDialect, m: Match, e: TimelineEvent, sensitive: Set<string>): boolean {
  switch (m.field) {
    case 'text': {
      const v = m.value.toLowerCase();
      if (e.summary.toLowerCase().includes(v) || e.kind.toLowerCase().includes(v) || e.source.toLowerCase().includes(v) || e.scope.toLowerCase().includes(v)) return true;
      for (const [k, a] of Object.entries(e.attrs)) if (typeof a === 'string' && !sensitive.has(`${e.source}.${k}`) && a.toLowerCase().includes(v)) return true;
      return false;
    }
    case 'kind': case 'source': { const v = e[m.field]; return m.prefix ? v.startsWith(m.value) : v === m.value; }
    case 'severity': {
      const a = sevRank(e.severity), b = sevRank(m.value);
      return m.op === 'ge' ? a >= b : m.op === 'gt' ? a > b : m.op === 'le' ? a <= b : m.op === 'lt' ? a < b : a === b;
    }
    case 'scope': return m.from === 'top' ? within(e.scope, m.value) : `/${e.scope}/`.includes(`/${m.value}/`);
    case 'link': {
      const own = d.linkMatch?.(String(m.link), m.value, e);
      return own ?? (e.links as Record<string, unknown>)[m.link as string] === m.value;
    }
    case 'attr': { const a = e.attrs[m.key]; return a !== undefined && a !== null && String(a).toLowerCase() === m.value.toLowerCase(); }
  }
}

/** The search language of one domain: its fields (the base ones, then its links), and
 *  - parseSearch: the query, read;
 *  - toAst: the parse, as a query carries it;
 *  - compileSearch: what the component sends: the parse, the range narrowed by since: and before:, and what couldn't
 *    be read;
 *  - matchAst: the parsed search (as a query carries it) as a test of one event (sensitive: "source.attr" names free
 *    text never looks in);
 *  - matcher: the search as typed, as a test of one event. */
export function searchFor(d: SearchDialect) {
  const FIELDS = [...BASE_FIELDS, ...d.links];
  const parseSearch = (q: string, now = Date.now()): ParsedSearch => parseWith(FIELDS, q, now);
  const toAst = (p: ParsedSearch): SearchAst => toAstWith(d, p);
  function compileSearch(q: string, now: number, from: number, to: number): { where: SearchAst; from: number; to: number; warnings: string[] } {
    const p = parseSearch(q, now);
    return { where: toAst(p), ...rangeOf(p, from, to), warnings: p.warnings };
  }
  function matchAst(ast: SearchAst | undefined, sensitive: Iterable<string> = []): (e: TimelineEvent) => boolean {
    const sens = new Set(sensitive), all = ast?.all ?? [];
    if (!all.length) return () => true;
    return e => all.every(t => t.any.some(m => test1(d, m, e, sens)) !== !!t.not);
  }
  const matcher = (p: ParsedSearch, sensitive: Iterable<string> = []) => matchAst(toAst(p), sensitive);
  return { FIELDS, parseSearch, toAst, compileSearch, matchAst, matcher };
}
export type Search = ReturnType<typeof searchFor>;

/** the range since: and before: narrow [from, to) to (never wider) */
export function rangeOf(p: ParsedSearch, from: number, to: number): { from: number; to: number } {
  for (const t of p.terms) {
    if (t.field === 'since') from = Math.max(from, t.time!);
    if (t.field === 'before') to = Math.min(to, t.time!);
  }
  return { from, to: Math.max(from, to) };
}

/** where the free text (positive terms) hits a line: [start, end) ranges, merged, in order */
export function highlights(p: ParsedSearch, line: string): [number, number][] {
  const low = line.toLowerCase(), out: [number, number][] = [];
  for (const t of p.terms) {
    if (t.neg || t.field || !t.value) continue;
    const v = t.value.toLowerCase();
    for (let i = low.indexOf(v); i >= 0; i = low.indexOf(v, i + v.length)) out.push([i, i + v.length]);
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of out) { const l = merged[merged.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push([...r]); }
  return merged;
}

/** a severity filter as a set (for facets) */
export const severities = (min: Severity) => SEVERITIES.filter(s => sevRank(s) >= sevRank(min));
