// YAML text → validated, laid-out, rendered scenes. Pure: the caller supplies the theme text.

import { parse, type Parsed } from '../iso-core/parse.ts';
import { validateSchema } from './validate.ts';
import type { Diag } from '../iso-core/errors.ts';
import { place } from '../iso-objects/place.ts';
import { extendTheme, loadTheme } from '../iso-core/theme.ts';
import type { RawDiagram } from '../iso-objects/types.ts';
import { compileRaw, type Compiled } from '../iso-objects/compile.ts';
import { resolveSvg, type ThemeMode } from '../iso-objects/resolve.ts';
import { bindMotion } from '../iso-objects/timeline.ts';
import type { MotionDoc } from '../iso-objects/motion-doc.ts';
import { antsOf } from '../iso-objects/ants.ts';
import { drawLooks } from '../iso-objects/looks.ts';
import { drawingCss, GRID_CSS, MARKS_CSS } from '../iso-objects/css.ts';
import { systems } from './catalog.ts';
export type { Compiled, CompiledScene } from '../iso-objects/compile.ts';

export interface CompileOptions {
  /** overrides every scene's grid snap (the editor's snap control) */
  snap?: number;
  /** which of the theme's modes a self-contained drawing is in (default: light) */
  mode?: ThemeMode;
  /** (0.15.0) self-contained drawings: each scene's SVG has its colours and text styles on its elements, in `mode`: no
   *  stylesheet, no custom properties, no hsl() or color-mix() (svgAt's frames too) */
  resolveVars?: boolean;
  /** a file with an error draws nothing: `scenes` is empty (true), or it throws ('throw'). Default: what could be laid
   *  out is in `scenes` all the same, with `ok` false */
  strict?: boolean | 'throw';
  /** ms each step lasts, for a video (default: by the length of its words) */
  stepMs?: number;
}
export class CompileError extends Error {
  diags: Diag[];
  constructor(diags: Diag[]) { super(diags.filter(d => d.severity === 'error').map(d => `line ${d.line}: ${d.message}`).join('\n')); this.name = 'CompileError'; this.diags = diags; }
}

export function compile(source: string, themeText: string, opts: CompileOptions = {}): Compiled {
  const c = compileAll(source, themeText, opts);
  if (!c.ok && opts.strict === 'throw') throw new CompileError(c.diags);
  if (!c.ok && opts.strict) c.scenes = [];
  if (opts.stepMs !== undefined) for (const s of c.scenes) for (const st of s.steps.steps) st.duration = opts.stepMs;
  if (opts.resolveVars) for (const s of c.scenes) {
    const o = { mode: opts.mode ?? 'light', theme: c.theme!, css: drawingCss(systems) + MARKS_CSS + GRID_CSS } as const;
    s.rendered.svg = resolveSvg(s.rendered.svg, o);
    if (s.rendered.variants) s.rendered.variants = Object.fromEntries(Object.entries(s.rendered.variants).map(([k, v]) => [k, resolveSvg(v, o)]));
    s.rendered.inks = { surface: c.theme![o.mode].surface ?? c.theme!.light.surface, control: c.theme![o.mode].control ?? c.theme!.light.control,
      kinds: Object.fromEntries(Object.entries(c.theme!.kinds).map(([k, v]) => [k, c.theme![o.mode][v.color] ?? v.color])) };
  }
  return c;
}

function compileAll(source: string, themeText: string, opts: { snap?: number }): Compiled {
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

  const c = compileRaw(doc, themeText, systems, parsed, source, { snap: opts.snap }, diags);
  // a scene's own motion document: checked here, so that its faults are said where they are in the file
  let faults = 0;
  const say = (path: string, message: string, hint?: string) => { const at = parsed.locate(path); c.diags.push({ severity: 'error', message, line: at.line, col: at.col, path, ...(hint ? { hint } : {}) }); faults++; };
  c.scenes.forEach((s, i) => {
    drawLooks(s, c.theme!);
    const ants = s.raw.ants, ids = antsOf(s.raw)?.ids, known = s.routes.map(r => r.id);
    (ids ?? []).forEach((id, k) => { if (!known.includes(id)) say(`/scenes/${i}/ants${Array.isArray(ants) ? '' : '/ids'}/${k}`, `no connector "${id}" in this scene`, known.length ? `its connectors: ${known.slice(0, 8).join(', ')}${known.length > 8 ? ', …' : ''}` : undefined); });
    if (!s.raw.motion) return;
    const motion = { isomotion: 1, ...s.raw.motion } as MotionDoc, path = `/scenes/${i}/motion`;
    const said = bindMotion(s, motion, { kinds: c.theme!.kinds }).diags;
    for (const d of said) { const at = parsed.locate(path + d.path); c.diags.push({ severity: d.severity, message: d.message, line: at.line, col: at.col, path: path + d.path, ...(d.hint ? { hint: d.hint } : {}) }); }
    faults += said.length;
    if (!said.length) s.motion = motion;
  });
  if (faults) { c.ok = false; c.diags.sort((a, b) => a.line - b.line || a.col - b.col); }
  return c;
}
