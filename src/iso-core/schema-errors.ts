// JSON Schema validation, with ajv's errors rewritten into plain words and tied to YAML lines: the part every format
// shares. A format registers its own words: what the things at its paths are called (registerNoun), what its version
// key must say (registerConst), what a pattern it checks means (registerPattern), and the keys it brings in by $ref.
// An entry of iso-core's of its own (beside index.ts), because it loads ajv through compile-schema.ts.

import type { ErrorObject } from 'ajv';
import { compileSchema } from './compile-schema.ts';
import { didYouMean, type Diag } from './errors.ts';
import type { Parsed } from './parse.ts';

/** What the thing at a path is called ('node "builder"', 'a scene'), as each format says; undefined: not its path. */
const nouns: ((path: string) => string | undefined)[] = [];
export function registerNoun(noun: (path: string) => string | undefined) { if (!nouns.includes(noun)) nouns.push(noun); }
function thing(path: string): string {
  for (const n of nouns) { const w = n(path); if (w !== undefined) return w; }
  return path ? 'this item' : 'the file';
}

function typeName(v: unknown): string {
  if (v === null) return 'nothing';
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'object') return 'a map';
  if (typeof v === 'string') return `the text "${v}"`;
  return `${typeof v} ${String(v)}`;
}

const typeWord: Record<string, string> = {
  string: 'text', number: 'a number', integer: 'a whole number', boolean: 'true or false', array: 'a list', object: 'a map',
};

/** Keys a schema brings in through allOf: { $ref } (each format registers its own). */
const refKeys = new Map<string, string[]>();
export function registerRefKeys(ref: string, keys: string[]) { refKeys.set(ref, keys); }
/** A format's own words for a const it checks (its version key): what it got, in words, and what it must be. */
const constWords = new Map<string, (data: unknown, allowed: unknown) => string>();
export function registerConst(path: string, words: (got: string, allowed: unknown) => string) { constWords.set(path, (d, a) => words(typeName(d), a)); }
/** A format's own words for a pattern it checks, by the pattern's start: the message and hint for a value that fails. */
const patternWords: [string, (data: unknown) => { message: string; hint?: string }][] = [];
export function registerPattern(prefix: string, words: (data: unknown) => { message: string; hint?: string }) { if (!patternWords.some(([p]) => p === prefix)) patternWords.push([prefix, words]); }

function knownKeys(e: ErrorObject): string[] {
  const ps = e.parentSchema as { properties?: object; allOf?: { $ref?: string }[]; $ref?: string } | undefined;
  const keys = Object.keys(ps?.properties ?? {});
  if (ps?.$ref && refKeys.has(ps.$ref)) keys.push(...refKeys.get(ps.$ref)!.filter(k => !keys.includes(k)));
  for (const a of ps?.allOf ?? []) if (a.$ref && refKeys.has(a.$ref)) keys.push(...refKeys.get(a.$ref)!);
  return keys;
}

function one(e: ErrorObject, parsed: Parsed): Diag {
  // a key in a map that breaks the map's propertyNames rule: say so at the key
  const pn = (e as ErrorObject & { propertyName?: string }).propertyName ?? (e.keyword === 'propertyNames' ? (e.params as { propertyName?: string }).propertyName : undefined);
  if (pn !== undefined) {
    const kp = `${e.instancePath}/${pn.replace(/~/g, '~0').replace(/\//g, '~1')}`;
    const at = parsed.locate(kp, { key: true });
    return { severity: 'error', message: `"${pn}" can't be a name`, line: at.line, col: at.col, path: kp, hint: 'names are a lower-case letter, then lower-case letters, digits and -' };
  }
  const path = e.instancePath;
  let message = e.message ?? 'is not valid';
  let hint: string | undefined;
  let at = parsed.locate(path);
  const p = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case 'required':
      message = `${thing(path)} is missing "${p.missingProperty}"`;
      break;
    case 'additionalProperties':
    case 'unevaluatedProperties': {
      const key = String(p.additionalProperty ?? p.unevaluatedProperty);
      const keys = knownKeys(e);
      const dym = didYouMean(key, keys);
      message = `unknown key "${key}" in ${thing(path)}` + (dym ? ` (did you mean "${dym}"?)` : '');
      if (!dym && keys.length) hint = `known keys: ${keys.join(', ')}`;
      if (/\s/.test(key)) hint = 'inside { … } a comma starts a new key: put text with commas in quotes, e.g. label: "read once, at launch"';
      at = parsed.locate(`${path}/${key}`, { key: true });
      return { severity: 'error', message, line: at.line, col: at.col, path: `${path}/${key}`, hint };
    }
    case 'enum': {
      const allowed = (p.allowedValues as unknown[]).map(String);
      const dym = typeof e.data === 'string' ? didYouMean(e.data, allowed) : undefined;
      const key = path.split('/').pop();
      message = `${typeName(e.data)} is not a valid ${key && !/^\d+$/.test(key) ? `"${key}"` : 'value'}` + (dym ? ` (did you mean "${dym}"?)` : '');
      hint = `expected one of: ${allowed.join(', ')}`;
      break;
    }
    case 'const':
      message = constWords.has(path) ? constWords.get(path)!(e.data, p.allowedValue) : `must be ${JSON.stringify(p.allowedValue)}`;
      break;
    case 'type':
      message = `expected ${typeWord[String(p.type)] ?? p.type}, got ${typeName(e.data)}`;
      break;
    case 'pattern':
      const pw = patternWords.find(([prefix]) => String(p.pattern).startsWith(prefix));
      if (pw) ({ message, hint } = pw[1](e.data));
      else {
        message = `"${e.data}" is not a valid id`;
        hint = 'ids start with a letter and use only letters, digits, - and _';
      }
      break;
    case 'minItems':
    case 'maxItems':
      if (e.schema === 2 || (e.parentSchema as { minItems?: number })?.minItems === 2) {
        message = `expected a list of ${(e.parentSchema as { minItems: number }).minItems === (e.parentSchema as { maxItems?: number }).maxItems ? (e.parentSchema as { minItems: number }).minItems : `${(e.parentSchema as { minItems: number }).minItems} to ${(e.parentSchema as { maxItems?: number }).maxItems}`} numbers, got ${(e.data as unknown[]).length}`;
      } else message = `list ${e.message}`;
      break;
    case 'false schema': {
      // a key a schema forbids where it is (a key that can't sit beside another one)
      const key = path.split('/').pop() ?? '';
      const owner = path.split('/').slice(0, -1).join('/');
      message = `"${key.replace(/~1/g, '/').replace(/~0/g, '~')}" can't be set on ${thing(owner)}`;
      at = parsed.locate(path, { key: true });
      break;
    }
    case 'minimum': case 'maximum': case 'exclusiveMinimum': case 'exclusiveMaximum':
      message = `${e.data} is out of range: ${e.message}`;
      break;
  }
  return { severity: 'error', message, line: at.line, col: at.col, path, hint };
}

/** Collapse the noise ajv makes for anyOf: keep the one explanation most likely to help. */
export function prune(errors: ErrorObject[], parsed: Parsed): Diag[] {
  const anyOfs = errors.filter(e => e.keyword === 'anyOf');
  const consumed = new Set<ErrorObject>();
  const out: Diag[] = [];
  for (const a of anyOfs) {
    const base = a.schemaPath.replace(/\/anyOf$/, '/anyOf/');
    const subs = errors.filter(e => e !== a && e.schemaPath.startsWith(base) && e.instancePath.startsWith(a.instancePath));
    subs.forEach(s => consumed.add(s));
    consumed.add(a);
    if (anyOfs.some(o => o !== a && a.schemaPath.startsWith(o.schemaPath.replace(/\/anyOf$/, '/anyOf/')) && o.instancePath === a.instancePath)) continue;
    const deeper = subs.filter(s => s.instancePath.length > a.instancePath.length && s.keyword !== 'anyOf');
    const enumHit = subs.find(s => s.keyword === 'enum' && s.instancePath === a.instancePath && typeof a.data === 'string');
    if (enumHit) out.push(one(enumHit, parsed));
    else if (deeper.length) out.push(...deeper.map(s => one(s, parsed)));
    else {
      const sameLevel = subs.filter(s => s.instancePath === a.instancePath && s.keyword !== 'type' && s.keyword !== 'anyOf');
      if (sameLevel.length && typeof a.data === 'object' && a.data !== null) out.push(...sameLevel.map(s => one(s, parsed)));
      else {
        const types = [...new Set(subs.filter(s => s.keyword === 'type').map(s => typeWord[String((s.params as { type: string }).type)] ?? ''))].filter(Boolean);
        const at = parsed.locate(a.instancePath);
        out.push({ severity: 'error', message: `${typeName(a.data)} is not allowed here` + (types.length ? `; expected ${types.join(' or ')}` : ''), line: at.line, col: at.col, path: a.instancePath });
      }
    }
  }
  for (const e of errors) if (!consumed.has(e)) out.push(one(e, parsed));
  // one message per place and text
  const seen = new Set<string>();
  return out.filter(d => { const k = `${d.path}|${d.message}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((x, y) => x.line - y.line || x.col - y.col);
}

/** The same plain-words validation against another JSON Schema (a format's own). */
export function schemaValidator(other: object, what: string, keysOf: Record<string, string[]> = {}): (parsed: Parsed) => Diag[] {
  for (const [ref, keys] of Object.entries(keysOf)) registerRefKeys(ref, keys);
  const fn = compileSchema(other);
  return parsed => {
    if (parsed.data == null || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
      return [{ severity: 'error', message: `the file must be a YAML map: ${what}`, line: 1, col: 1, path: '' }];
    }
    if (fn(parsed.data)) return [];
    return prune(fn.errors ?? [], parsed);
  };
}
