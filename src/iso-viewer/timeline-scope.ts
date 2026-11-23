// Scope paths (docs/timeline/README.md §1): kind:name segments from the fleet ("") down, joined by "/". Pure. What
// a path may say (its kinds and their nesting) is the domain's catalogue's: scopeRules(cat).

import { scopePattern, type Scope, type TimelineCatalog } from './timeline-contract.ts';

export interface Segment { kind: string; name: string }

/** what a path of this catalogue may say: isScope, parseScope (its segments, names unescaped; throws on a path that
 *  isn't one), and wellNested (each segment may sit in its parent's kind) */
export function scopeRules(cat: Pick<TimelineCatalog, 'kinds' | 'parents'>) {
  const RE = new RegExp(scopePattern(cat));
  const isScope = (s: string) => RE.test(s);
  function parseScope(s: Scope): Segment[] {
    if (!RE.test(s)) throw new Error(`not a scope path: ${JSON.stringify(s)}`);
    if (s === '') return [];
    return s.split('/').map(seg => {
      const i = seg.indexOf(':');
      return { kind: seg.slice(0, i), name: decodeURIComponent(seg.slice(i + 1)) };
    });
  }
  function wellNested(s: Scope): boolean {
    let parent = '';
    for (const seg of parseScope(s)) { if (!cat.parents[seg.kind].includes(parent)) return false; parent = seg.kind; }
    return true;
  }
  return { isScope, parseScope, wellNested };
}

/** a name, escaped for a segment */
export const escapeName = (n: string) => n.replace(/[%/:\s]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
export const formatScope = (segs: Segment[]): Scope => segs.map(s => `${s.kind}:${escapeName(s.name)}`).join('/');
export const join = (parent: Scope, kind: string, name: string): Scope => (parent ? `${parent}/` : '') + `${kind}:${escapeName(name)}`;

/** levels below the fleet */
export const levelOf = (s: Scope) => (s === '' ? 0 : s.split('/').length);
/** the scope's prefix at a level (itself when it is shallower) */
export function prefixAt(s: Scope, level: number): Scope {
  if (level <= 0) return '';
  const parts = s === '' ? [] : s.split('/');
  return parts.slice(0, level).join('/');
}
export const parentOf = (s: Scope): Scope => prefixAt(s, levelOf(s) - 1);
/** segment by segment: a prefix matches itself and everything under it */
export const within = (s: Scope, prefix: Scope) => prefix === '' || s === prefix || s.startsWith(`${prefix}/`);
/** any segment equal to seg ("kind:name") */
export const hasSegment = (s: Scope, seg: string) => s !== '' && s.split('/').includes(seg);
export const kindOf = (s: Scope): string => (s === '' ? 'fleet' : s.slice(s.lastIndexOf('/') + 1).split(':')[0]);
export const nameOf = (s: Scope) => (s === '' ? 'all hosts' : decodeURIComponent(s.slice(s.lastIndexOf('/') + 1).split(':').slice(1).join(':')));

/** breadcrumbs: the fleet, then each prefix */
export function crumbs(s: Scope): { scope: Scope; label: string; kind: string }[] {
  const out: { scope: Scope; label: string; kind: string }[] = [{ scope: '', label: 'all hosts', kind: 'fleet' }];
  for (let l = 1; l <= levelOf(s); l++) { const p = prefixAt(s, l); out.push({ scope: p, label: nameOf(p), kind: kindOf(p) }); }
  return out;
}

