// Compiles a JSON Schema into a validator with ajv. In Node this is ajv.compile. In the browser (the editor's page),
// whose CSP forbids evaluating strings, the browser build swaps this module for validators that ajv wrote out as
// code at build time (ajv standalone), keyed by the schema's fingerprint. Both use these options.

import Ajv2020Mod from 'ajv/dist/2020.js';
// the class by its name: its type is the same under every moduleResolution (a default import's isn't)
import type { Ajv2020 as Ajv2020Class } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';

// ajv is CommonJS; under Node's ESM loader the class may sit on `.default`.
export const Ajv2020 = ((Ajv2020Mod as unknown as { default?: unknown }).default ?? Ajv2020Mod) as typeof Ajv2020Class;
export const AJV_OPTIONS = { allErrors: true, verbose: true, strict: false } as const;
const ajv = new Ajv2020(AJV_OPTIONS);

export function compileSchema(schema: object): ValidateFunction {
  return ajv.compile(schema);
}

/** A stable fingerprint of a schema (FNV-1a over its JSON): the browser build looks validators up by it. */
export function fingerprint(schema: object): string {
  const t = JSON.stringify(schema);
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16) + ':' + t.length;
}
