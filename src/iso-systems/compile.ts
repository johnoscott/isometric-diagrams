// YAML text → validated, laid-out, rendered scenes. Pure: the caller supplies the theme text.

import { parse, type Parsed } from '../iso-core/parse.ts';
import { validateSchema } from './validate.ts';
import type { Diag } from '../iso-core/errors.ts';
import { place } from '../iso-objects/place.ts';
import { extendTheme, loadTheme, type Theme } from '../iso-core/theme.ts';
import type { RawDiagram } from '../iso-objects/types.ts';
import { compileRaw, type Compiled } from '../iso-objects/compile.ts';
import { FONT_STACKS, resolveSvg, type ThemeMode } from '../iso-objects/resolve.ts';
import { monoOfDrawing, paintMono } from '../iso-objects/mono-paint.ts';
import type { MonoTable } from '../iso-core/mono.ts';
import type { CompiledScene } from '../iso-objects/compile.ts';
import { withFont, type FontTable } from '../iso-core/kernel.ts';
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
  /** (0.16.0) a self-contained drawing in black and white, in either mode: greys, patterns and line rhythms, and no hue */
  treatment?: 'mono' | 'none';
  /** a host's own table, over the treatment's */
  mono?: MonoTable;
  /** (0.17.0) a self-contained drawing laid out with another font's widths (Arimo's: modules/iso-core/arimo), and asking for it. The host loads the font */
  font?: FontTable;
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
  if (opts.font && !opts.resolveVars) throw new Error('font: a self-contained drawing\'s (resolveVars)');
  const c = withFont(opts.font, () => compileAll(source, themeText, opts)), fonts = opts.font && { sans: opts.font.sans, mono: opts.font.mono ?? FONT_STACKS.mono };
  if (!c.ok && opts.strict === 'throw') throw new CompileError(c.diags);
  if (!c.ok && opts.strict) c.scenes = [];
  if (opts.stepMs !== undefined) for (const s of c.scenes) for (const st of s.steps.steps) st.duration = opts.stepMs;
  if (opts.treatment !== undefined && opts.treatment !== 'mono' && opts.treatment !== 'none') throw new Error(`treatment: there is "mono" (and "none"), and no ${JSON.stringify(opts.treatment)}`);
  const treatment = (opts.treatment ?? c.doc?.treatment) === 'mono';
  if (opts.treatment === 'mono' && !opts.resolveVars) throw new Error('treatment: a self-contained drawing\'s (resolveVars)');
  const theme = c.theme;
  if (opts.resolveVars) for (const s of c.scenes) {
    const mode = opts.mode ?? 'light', css = drawingCss(systems) + MARKS_CSS + GRID_CSS;
    if (treatment) { toMono(s, theme!, mode, css, opts.mono, fonts); continue; }
    const o = { mode, theme: c.theme!, css, fonts } as const;
    s.rendered.svg = resolveSvg(s.rendered.svg, o);
    if (s.rendered.variants) s.rendered.variants = Object.fromEntries(Object.entries(s.rendered.variants).map(([k, v]) => [k, resolveSvg(v, o)]));
    s.rendered.inks = { surface: c.theme![o.mode].surface ?? c.theme!.light.surface, control: c.theme![o.mode].control ?? c.theme!.light.control,
      kinds: Object.fromEntries(Object.entries(c.theme!.kinds).map(([k, v]) => [k, c.theme![o.mode][v.color] ?? v.color])) };
  }
  // it says which font it was laid out with (nothing: the default)
  if (opts.font) for (const s of c.scenes) { const name = opts.font.name, mark = (svg: string) => svg.replace('<svg ', `<svg data-font="${name.replace(/[^\w-]/g, '')}" `); s.rendered.svg = mark(s.rendered.svg); if (s.rendered.variants) s.rendered.variants = Object.fromEntries(Object.entries(s.rendered.variants).map(([k, v]) => [k, mark(v)])); }
  // its connectors march in their own rhythms
  if (opts.resolveVars && treatment && theme) c.theme = { ...theme, kinds: Object.fromEntries(Object.entries(theme.kinds).map(([k, v]) => { const d = c.scenes.map(s => s.rendered.mono?.kinds[k]?.dash).find(x => x && x.length > 1); return [k, d ? { ...v, ants: [d[0], d[1]] as [number, number] } : v]; })) };
  return c;
}

/** a scene in black and white: its drawing and its looks alike, by one table */
function toMono(s: CompiledScene, theme: Theme, mode: ThemeMode, css: string, own?: MonoTable, fonts?: { sans: string; mono: string }) {
  const all = [s.rendered.svg, ...Object.values(s.rendered.variants ?? {})];
  const m = monoOfDrawing(all.join(''), theme, mode, [...s.routes.map(r => r.kind), ...s.steps.kindsUsed], own);
  const draw = (svg: string) => paintMono(resolveSvg(svg, { mode, theme: m.theme, css: css + m.css, fonts }), m.look, s.id);
  s.rendered.svg = draw(s.rendered.svg);
  if (s.rendered.variants) s.rendered.variants = Object.fromEntries(Object.entries(s.rendered.variants).map(([k, v]) => [k, draw(v)]));
  s.rendered.inks = { surface: m.look.paper, control: m.look.ink, kinds: Object.fromEntries(Object.keys(theme.kinds).map(k => [k, m.look.ink])) };
  s.rendered.mono = m.look;
  for (const w of m.look.warnings) s.rendered.warnings.push({ path: '', message: `black and white: ${w}` });
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
