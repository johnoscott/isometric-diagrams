// The schemas' validators as code, for a page whose CSP forbids evaluating strings (an esbuild plugin): used by the
// package's build (scripts/build-iso.ts) and by any page bundled from the sources.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'esbuild';
import standaloneMod from 'ajv/dist/standalone/index.js';
import { Ajv2020, AJV_OPTIONS, fingerprint } from '../src/iso-core/compile-schema.ts';

/** a path relative to this folder (scripts/): schemas are named as '../src/…' */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The page's CSP forbids evaluating strings, and ajv.compile builds each validator with new Function. So the build
 * asks ajv for each validator as code (ajv standalone) and swaps src/iso-core/compile-schema.ts for a module that looks
 * the schema up by its fingerprint. A schema that wasn't precompiled throws, naming itself, rather than evaluating.
 */
export const precompiledFor = (SCHEMAS: string[]): Plugin => ({
  name: 'precompiled-schemas',
  setup(b) {
    const standaloneCode = ((standaloneMod as unknown as { default?: unknown }).default ?? standaloneMod) as typeof standaloneMod.default;
    const code = (i: number) => {
      const ajv = new Ajv2020({ ...AJV_OPTIONS, code: { source: true, esm: true } });
      return standaloneCode(ajv, ajv.compile(JSON.parse(readFileSync(here(SCHEMAS[i]), 'utf8'))));
    };
    b.onResolve({ filter: /^ajv-standalone:\d+$/ }, a => ({ path: a.path, namespace: 'ajv-standalone' }));
    b.onLoad({ filter: /.*/, namespace: 'ajv-standalone' }, a => ({ contents: code(Number(a.path.split(':')[1])), loader: 'js', resolveDir: here('..') }));
    b.onLoad({ filter: /src[\\/]iso-core[\\/]compile-schema\.ts$/ }, () => {
      const table = SCHEMAS.map((f, i) => `[${JSON.stringify(fingerprint(JSON.parse(readFileSync(here(f), 'utf8'))))}, v${i}]`);
      return {
        loader: 'ts', resolveDir: here('..'),
        contents: [
          ...SCHEMAS.map((f, i) => `import v${i} from 'ajv-standalone:${i}';   // ${f.replace('../', '')}`),
          `export ${fingerprint.toString().replace(/^function fingerprint\(schema\)/, 'function fingerprint(schema: object): string')}`,
          `const table = new Map<string, unknown>([${table.join(', ')}]);`,
          'export function compileSchema(schema: { $id?: string; title?: string }) {',
          '  const v = table.get(fingerprint(schema));',
          '  if (!v) throw new Error(`schema not precompiled into the page: ${schema.$id ?? schema.title ?? "?"}`);',
          '  return v;',
          '}',
        ].join('\n'),
      };
    });
  },
});
