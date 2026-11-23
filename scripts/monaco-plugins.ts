// Monaco, built for a page with a strict CSP: esbuild plugins shared by the portable editor's build
// (space-editor/build.ts) and the documentation site's playground (scripts/build-site.ts).
import type { Plugin } from 'esbuild';

/** Monaco's editor.main also loads the TypeScript, CSS, HTML and JSON services and ~80 grammars: keep the editor. */
export const leanMonaco: Plugin = {
  name: 'lean-monaco',
  setup(b) {
    b.onLoad({ filter: /monaco-editor[\\/]esm[\\/]vs[\\/]editor[\\/]editor\.main\.js$/ }, async args => {
      const { readFile } = await import('node:fs/promises');
      const src = await readFile(args.path, 'utf8');
      const kept = src.split('\n').filter(l => !/languages\/(definitions|features)\/|monaco-lsp-client|^export \{ __src_languages|^export \{ index as lsp/.test(l));
      return { contents: kept.join('\n'), loader: 'js', resolveDir: args.path.replace(/[\\/][^\\/]+$/, '') };
    });
  },
};

/** P3: no computed import and no blob: worker in what we ship (a host's asset compiler hashes and serves every file).
 *  Monaco has two, both unreached here: its fallback worker, made from a blob: when no getWorker is given (text.ts
 *  always gives one: a file, new URL(…, import.meta.url)); and an optional external diff module loaded by a computed
 *  URL (the editor never asks for that algorithm). Each is replaced by an error that says so. */
export const noBlobsOrComputedImports: Plugin = {
  name: 'no-blobs-or-computed-imports',
  setup(b) {
    b.onLoad({ filter: /monaco-editor[\\/]esm[\\/]vs[\\/]platform[\\/]webWorker[\\/]browser[\\/]webWorkerServiceImpl\.js$/ }, async args => {
      const { readFile } = await import('node:fs/promises');
      const src = await readFile(args.path, 'utf8');
      const a = src.indexOf('function getWorkerBootstrapUrl('), z = src.indexOf('\nfunction whenESMWorkerReady(', a);
      if (a < 0 || z < 0) throw new Error('webWorkerServiceImpl.js changed: no getWorkerBootstrapUrl to replace');
      const stub = "function getWorkerBootstrapUrl() {\n    throw new Error('this build makes no blob: workers: give MonacoEnvironment.getWorker');\n}";
      return { contents: src.slice(0, a) + stub + src.slice(z), loader: 'js', resolveDir: args.path.replace(/[\\/][^\\/]+$/, '') };
    });
    b.onLoad({ filter: /monaco-editor[\\/]esm[\\/]vs[\\/]editor[\\/]common[\\/]diff[\\/]externalLinesDiffComputer\.js$/ }, async args => {
      const { readFile } = await import('node:fs/promises');
      const src = await readFile(args.path, 'utf8');
      const out = src.replace(/externalModulePromise = import\([^;]*;/, "externalModulePromise = Promise.reject(new Error('this build ships no external diff module'));");
      if (out === src) throw new Error('externalLinesDiffComputer.js changed: no computed import to replace');
      return { contents: out, loader: 'js', resolveDir: args.path.replace(/[\\/][^\\/]+$/, '') };
    });
  },
};

/** Monaco is a module beside the bundle (the path as the bundle imports it), not bundled in. */
export const monacoBeside = (path: string): Plugin => ({
  name: 'monaco-beside',
  setup(b) {
    b.onResolve({ filter: /^monaco-editor\/(editor\/editor\.main\.js|languages\/definitions\/yaml\/register\.js)$/ }, () => ({ path, external: true }));
  },
});
