// The drawing format's JSON Schema validation (src/iso-systems/schema.json), in plain words tied to YAML lines; the
// shared machinery is in src/iso-core/schema-errors.ts, and this registers the format's own words with it.

import { compileSchema } from '../iso-core/compile-schema.ts';
import schema from './schema.json' with { type: 'json' };
import type { Diag } from '../iso-core/errors.ts';
import type { Parsed } from '../iso-core/parse.ts';
import { prune, registerConst, registerNoun, registerPattern, registerRefKeys } from '../iso-core/schema-errors.ts';
export { schemaValidator } from '../iso-core/schema-errors.ts';

const check = compileSchema(schema);
const placementKeys = Object.keys((schema.$defs.placement as { properties: object }).properties);
registerRefKeys('#/$defs/placement', placementKeys);
registerConst('/isodiag', got => `"isodiag" must be 1 (the format version), got ${got}`);
const what: Record<string, string> = {
  scene: 'a scene', region: 'a region', node: 'a node', route: 'a route', note: 'a note', step: 'a step',
};
registerNoun(path => {
  const m = /\/(scenes|regions|nodes|routes|notes|steps)\/\d+$/.exec(path);
  return m ? what[m[1].replace(/s$/, '')] ?? 'this item' : undefined;
});
registerPattern('^[A-Za-z][A-Za-z0-9_-]*(', data => ({
  message: `"${data}" is not a node reference`,
  hint: 'write an id, optionally with a side: worker, worker.e (sides: n, e, s, w, top)',
}));

export function validateSchema(parsed: Parsed): Diag[] {
  if (parsed.data == null || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    return [{ severity: 'error', message: 'the file must be a YAML map with "isodiag: 1" and "scenes:"', line: 1, col: 1, path: '' }];
  }
  if (check(parsed.data)) return [];
  return prune(check.errors ?? [], parsed);
}

