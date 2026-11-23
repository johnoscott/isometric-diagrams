// YAML text → validated, laid-out, rendered scenes. Pure: the caller supplies the theme text.

import { parse, type Parsed } from '../iso-core/parse.ts';
import { validateSchema } from './validate.ts';
import type { Diag } from '../iso-core/errors.ts';
import { place } from '../iso-objects/place.ts';
import { extendTheme, loadTheme } from '../iso-core/theme.ts';
import type { RawDiagram } from '../iso-objects/types.ts';
import { compileRaw, type Compiled } from '../iso-objects/compile.ts';
import { systems } from './catalog.ts';
export type { Compiled, CompiledScene } from '../iso-objects/compile.ts';

/** opts.snap overrides every scene's grid snap (the editor's snap control). */
export function compile(source: string, themeText: string, opts: { snap?: number } = {}): Compiled {
  const parsed = parse(source);
  const diags: Diag[] = [...parsed.diags];
  if (diags.some(d => d.severity === 'error')) return { ok: false, diags, catalog: systems, scenes: [] };
  const schemaDiags = validateSchema(parsed);
  diags.push(...schemaDiags);
  const doc = parsed.data as RawDiagram;
  if (schemaDiags.length) {
    // Still report the reference and layout problems, so an author sees them all in one round.
    // The data may be malformed, so this is best effort, and nothing is rendered.
    try {
      const theme = extendTheme(loadTheme(themeText), doc.roles ?? {}, doc.kinds ?? {});
      const bad = schemaDiags.map(d => d.path);
      (Array.isArray(doc.scenes) ? doc.scenes : []).forEach((raw, i) => {
        try {
          const layout = place(raw, `/scenes/${i}`, parsed, theme, systems, doc.roles ?? {});
          diags.push(...layout.diags.filter(d => !bad.some(b => d.path === b || d.path.startsWith(b + '/'))));
        } catch { /* malformed scene: the schema errors say why */ }
      });
    } catch { /* malformed roles or kinds */ }
    diags.sort((a, b) => a.line - b.line || a.col - b.col);
    return { ok: false, diags, catalog: systems, scenes: [] };
  }

  return compileRaw(doc, themeText, systems, parsed, source, opts, diags);
}
