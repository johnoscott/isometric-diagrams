// Bundles the player to one minified script string, to inline into pages. Node only (uses esbuild, a dev dependency).

import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

let cached: string | undefined;
export function playerScript(): string {
  if (cached) return cached;
  const r = buildSync({
    entryPoints: [fileURLToPath(new URL('./player.ts', import.meta.url))],
    bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none',
  });
  cached = r.outputFiles[0].text;
  return cached;
}
