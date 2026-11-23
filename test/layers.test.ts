// R1 §6.1: the import boundary between the layers (scripts/layers.ts), hard over all of src/ since S8 (every layer, every app). It covered each layer once its directory existed
// (the split's stages create them); the checker itself is proven on made-up files first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAYERS, APPS, ROOT, filesOf, importsOf, checkImports, unplaced } from '../scripts/layers.ts';

test('importsOf: static, type-only, re-exported, side-effect, multi-line, dynamic and CSS imports', () => {
  const t = `import a from './a.ts';\nimport type { B } from "./b.ts";\nexport { c } from './c.ts';\nexport * from './d.ts';\nimport './e.css';\nimport {\n  f,\n  type G,\n} from '../f.ts';\nconst h = await import('./h.ts');\n@import url("./i.css");\nconst s = "import x from 'not-code'"; obj.import('./no.ts');`;
  assert.deepEqual(importsOf(t), ['./a.ts', './b.ts', './c.ts', './d.ts', './e.css', '../f.ts', './h.ts', './i.css', 'not-code']);
});

test('the rules, on made-up files: down, to public modules only; no upward, sideways-into-the-pack, app or test import; a domain layer may read schema/, themes/ and examples/ data, never code', () => {
  const index = (p: string) => (p === 'src/iso-core/index.ts' ? `export { iso } from './kernel.ts';\nexport type { Box } from './kernel.ts';\nexport * from './glyphs.ts';` : '');
  const v = checkImports([
    { file: 'src/iso-objects/place.ts', text: `import { iso } from '../iso-core/index.ts'; import { x } from './route.ts'; import { parse } from 'yaml';` },
    { file: 'src/iso-core/kernel.ts', text: `import { place } from '../iso-objects/index.ts';` },
    { file: 'src/iso-viewer/view.ts', text: `import { iso } from '../iso-core/kernel.ts'; import { g } from '../iso-core/glyphs.ts'; import { compileSchema } from '../iso-core/compile-schema.ts'; import { h } from '../iso-core/inner.ts';` },
    { file: 'src/iso-editor/mount.ts', text: `import { systems } from '../iso-systems/index.ts';` },
    { file: 'src/iso-editor/files.ts', text: `import ex from '../../examples/space3/a.yaml'; import f from '../../test/fixtures/x.json'; import { c } from '../cli/isodiag.ts';` },
    { file: 'src/iso-systems/catalog.ts', text: `import { factories } from '../iso-objects/index.ts'; import { v } from '../iso-viewer/index.ts';` },
    { file: 'src/iso-editor/data.ts', text: `import s from '../../schema/space-3.schema.json';` },
  ], index);
  assert.deepEqual(v.map(x => `${x.file} ${x.spec}`), [
    'src/iso-core/kernel.ts ../iso-objects/index.ts',
    'src/iso-viewer/view.ts ../iso-core/inner.ts',
    'src/iso-editor/mount.ts ../iso-systems/index.ts',
    'src/iso-editor/files.ts ../../examples/space3/a.yaml',
    'src/iso-editor/files.ts ../../test/fixtures/x.json',
    'src/iso-editor/files.ts ../cli/isodiag.ts',
    'src/iso-systems/catalog.ts ../iso-viewer/index.ts',
    'src/iso-editor/data.ts ../../schema/space-3.schema.json',
  ]);
  assert.match(v[0].why, /iso-core may not import iso-objects/);
  assert.match(v[1].why, /src\/iso-core\/inner\.ts is not public in iso-core/);
});

test('every layer keeps the boundary, and so does every app: all of src/ (R1 S8: hard, no layer may be missing)', () => {
  for (const l of LAYERS) assert.ok(filesOf(l.dir).length, `${l.name} (${l.dir}) exists and has files`);
  const files = [...LAYERS.flatMap(l => filesOf(l.dir)), ...APPS.flatMap(d => filesOf(d))];
  const v = checkImports(files.map(file => ({ file, text: readFileSync(join(ROOT, file), 'utf8') })));
  assert.deepEqual(v.map(x => `${x.file}: '${x.spec}': ${x.why}`), []);
  console.log(`# layers covered: ${LAYERS.map(l => l.name).join(', ')}; apps: ${APPS.join(', ')} (${files.length} files)`);
});

test('every source in src/ is in a layer or an app', () => {
  assert.deepEqual(unplaced(), []);
});

test('an app uses the generic layers through their public modules only; P as it likes', () => {
  const v = checkImports([
    { file: 'src/cli/ok.ts', text: `import { parse } from '../iso-core/parse.ts'; import { systems } from '../iso-systems/catalog.ts';` },
    { file: 'src/cli/bad.ts', text: `import { x } from '../iso-core/inner.ts'; import { y } from '../stray/thing.ts';` },
  ], p => (p === 'src/iso-core/index.ts' ? `export { parse } from './parse.ts';` : ''));
  assert.deepEqual(v.map(x => `${x.file} ${x.spec}`), ['src/cli/bad.ts ../iso-core/inner.ts', 'src/cli/bad.ts ../stray/thing.ts']);
});
