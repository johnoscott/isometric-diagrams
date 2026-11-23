// Walks a JSON Schema (draft 2020-12, as the domains' schemas are written) to the subschemas at a path: what
// keys a map there may have, what values a key may take, and the words to show on hover. Drives Monaco's completion
// and hover, and (E4) the properties panel's forms. Pure.

import type { Path } from './path.ts';

type J = Record<string, unknown>;

export interface KeyInfo {
  name: string;
  /** Markdown */
  doc?: string;
  /** the value's shape, for the text inserted after "key:" */
  shape: 'map' | 'list' | 'scalar';
  enumValues: string[];
  examples: unknown[];
}

export class SchemaNav {
  private root: J;
  private defs: Record<string, J>;
  constructor(schema: object) {
    this.root = schema as J;
    this.defs = ((schema as J).$defs ?? {}) as Record<string, J>;
  }

  /** a schema with its $ref and anyOf/allOf branches spread out (each branch is a candidate) */
  private spread(s: unknown, seen = new Set<unknown>()): J[] {
    if (!s || typeof s !== 'object' || seen.has(s)) return [];
    seen.add(s);
    const o = s as J;
    const out: J[] = [o];
    if (typeof o.$ref === 'string' && o.$ref.startsWith('#/$defs/')) out.push(...this.spread(this.defs[o.$ref.slice(8)], seen));
    for (const k of ['anyOf', 'oneOf', 'allOf']) for (const b of (o[k] ?? []) as unknown[]) out.push(...this.spread(b, seen));
    return out;
  }

  /** The candidate schemas at a path. A name in a section map matches additionalProperties; x-* keys match nothing useful. */
  at(path: Path): J[] {
    let cur = this.spread(this.root);
    for (const seg of path) {
      const next: J[] = [];
      for (const s of cur) {
        if (typeof seg === 'number') { if (s.items) next.push(...this.spread(s.items)); continue; }
        const props = (s.properties ?? {}) as J;
        if (props[seg] !== undefined) { next.push(...this.spread(props[seg])); continue; }
        const pp = Object.entries((s.patternProperties ?? {}) as J).find(([re]) => new RegExp(re).test(seg));
        if (pp) { next.push(...this.spread(pp[1])); continue; }
        if (s.additionalProperties && typeof s.additionalProperties === 'object') next.push(...this.spread(s.additionalProperties));
      }
      cur = next;
      if (!cur.length) break;
    }
    return cur;
  }

  /** The keys a map at this path may have (not counting x-*), given what the map holds now. */
  keys(path: Path, present: J = {}): KeyInfo[] {
    const cands = this.at(path);
    const forbidden = new Set<string>();
    for (const s of cands) for (const [dep, sub] of Object.entries((s.dependentSchemas ?? {}) as Record<string, J>)) {
      const banned = Object.entries((sub.properties ?? {}) as J).filter(([, v]) => v === false).map(([k]) => k);
      // external: written → none of the owned keys; owned keys written → not external:
      if (present[dep] !== undefined) banned.forEach(k => forbidden.add(k));
      else if (banned.some(k => present[k] !== undefined)) forbidden.add(dep);
    }
    // with external: the keys an external thing may have; without it, everything else
    const out = new Map<string, KeyInfo>();
    for (const s of cands) for (const [k, v] of Object.entries((s.properties ?? {}) as J)) {
      if (forbidden.has(k) || v === false) continue;
      const prev = out.get(k);
      const info = this.info(k, path, v);
      if (!prev || (!prev.doc && info.doc)) out.set(k, info);
    }
    return [...out.values()];
  }

  private info(name: string, path: Path, s: unknown): KeyInfo {
    const all = this.at([...path, name]).length ? this.at([...path, name]) : this.spread(s);
    const doc = all.map(x => (x.markdownDescription ?? x.description) as string | undefined).find(Boolean);
    const types = new Set(all.flatMap(x => (Array.isArray(x.type) ? x.type : x.type ? [x.type] : []) as string[]));
    const hasProps = all.some(x => x.properties || x.additionalProperties || x.patternProperties);
    const shape: KeyInfo['shape'] = types.has('array') && !types.has('string') ? 'list' : (types.has('object') || hasProps) && !types.has('string') && !all.some(x => x.const !== undefined || x.enum) ? 'map' : 'scalar';
    return { name, doc, shape, enumValues: this.values([...path, name], all), examples: all.flatMap(x => (x.examples ?? []) as unknown[]) };
  }

  /** The words a value at this path may be: enum values, consts, true/false. */
  values(path: Path, cands = this.at(path)): string[] {
    const out = new Set<string>();
    for (const s of cands) {
      for (const v of (s.enum ?? []) as unknown[]) out.add(String(v));
      if (s.const !== undefined && typeof s.const !== 'object') out.add(String(s.const));
      if (s.type === 'boolean') { out.add('true'); out.add('false'); }
    }
    return [...out];
  }

  /** Markdown for a path: the description of the key, plus allowed values. */
  hover(path: Path): string | undefined {
    const c = this.at(path);
    const doc = c.map(x => (x.markdownDescription ?? x.description) as string | undefined).find(Boolean);
    if (!doc) return undefined;
    const vals = this.values(path, c);
    return doc + (vals.length && vals.length <= 12 ? `\n\nOne of: ${vals.map(v => '`' + v + '`').join(', ')}` : '');
  }

  /** A value to start a new key with: the first allowed value, else an empty one of the right shape. */
  defaultFor(path: Path): unknown {
    const c = this.at(path);
    const vals = this.values(path, c);
    if (vals.length) return vals[0] === 'true' || vals[0] === 'false' ? false : vals[0];
    const ex = c.flatMap(x => (x.examples ?? []) as unknown[]).find(e => typeof e === 'string');
    const types = new Set(c.flatMap(x => (Array.isArray(x.type) ? x.type : x.type ? [x.type] : []) as string[]));
    if (types.has('array')) return [];
    if (types.has('object') || c.some(x => x.properties || x.additionalProperties)) return {};
    if (types.has('integer') || types.has('number')) return 1;
    return ex ?? '';
  }

  /** The value types a path takes (for parsing what is typed into the tree). */
  types(path: Path): Set<string> {
    return new Set(this.at(path).flatMap(x => (Array.isArray(x.type) ? x.type : x.type ? [x.type] : []) as string[]));
  }

  /** Is the path a map of names (a section of named things)? */
  isNameMap(path: Path): boolean {
    return this.at(path).some(s => s.additionalProperties && typeof s.additionalProperties === 'object' && !s.properties);
  }
}
