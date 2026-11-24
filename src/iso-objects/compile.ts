// A drawing document (already a RawDiagram, valid by construction) → laid-out, rendered scenes: compile()'s second half,
// without parsing YAML or checking the drawing schema. The editor's canvas uses it on the document it generates.

import type { Parsed } from '../iso-core/parse.ts';
import type { Diag } from '../iso-core/errors.ts';
import { place, type Layout } from './place.ts';
import { renderScene, type RenderedScene } from './scene.ts';
import { routeAll, type Routed } from './route.ts';
import { resolveSteps, type Steps } from './steps.ts';
import { extendTheme, loadTheme } from '../iso-core/theme.ts';
import { type KindCatalog, nodeKindOr } from './kinds.ts';
import type { MotionDoc } from './motion-doc.ts';
import type { GridDef, RawDiagram, RawNode, RawRegion, RawScene, Theme } from './types.ts';
import { facePainter, iconPainter } from './assets.ts';

export interface CompiledScene { id: string; raw: RawDiagram['scenes'][number]; layout: Layout; routes: Routed[]; steps: Steps; rendered: RenderedScene; grid: GridDef; assemble: boolean;
  /** the file's `motion:` on this scene, checked against the drawing (a file with errors in it has none) */
  motion?: MotionDoc }
export interface Compiled {
  ok: boolean;
  /** the parsed source: positions and spans of every value, for the proof sheet */
  parsed?: Parsed;
  source?: string;
  diags: Diag[];
  doc?: RawDiagram;
  theme?: Theme;
  /** the kinds it was drawn with (a page's legend and stylesheet ask them) */
  catalog: KindCatalog;
  scenes: CompiledScene[];
}

/** Places for a document that has no source text: every place is unknown (line 0). */
export const noSource = (data: unknown): Parsed => ({ data, locate: () => ({ line: 0, col: 0 }), span: () => undefined, diags: [] });

export function compileRaw(doc: RawDiagram, themeText: string, catalog: KindCatalog, parsed: Parsed = noSource(doc), source?: string, opts: { snap?: number } = {}, diags: Diag[] = []): Compiled {
  const theme = extendTheme(loadTheme(themeText), doc.roles, doc.kinds);
  const scenes: CompiledScene[] = [];
  const sceneIds = new Map<string, number>();
  doc.scenes.forEach((raw, i) => {
    const path = `/scenes/${i}`;
    if (sceneIds.has(raw.id)) {
      const p = parsed.locate(path + '/id');
      diags.push({ severity: 'error', message: `duplicate scene id "${raw.id}"`, line: p.line, col: p.col, path: path + '/id' });
    }
    sceneIds.set(raw.id, i);
    const grid = { ...doc.grid, ...raw.grid, ...(opts.snap ? { snap: opts.snap } : {}) };
    const layout = place(raw, path, parsed, theme, catalog, doc.roles, grid.snap);
    diags.push(...layout.diags);
    const routed = routeAll(raw, path, layout, parsed, new Set(Object.keys(theme.kinds)), grid.snap);
    diags.push(...routed.diags);
    const steps = resolveSteps(raw, path, layout, routed.routes, parsed, theme);
    diags.push(...steps.diags);
    diags.push(...unknownMarks(raw, path, catalog, parsed));
    const rendered = renderScene({ scene: raw, layout, routes: routed.routes, steps, theme, id: raw.id, gridStep: grid.step ?? grid.snap ?? 1 });
    for (const w of rendered.warnings) { const p = parsed.locate(w.path); diags.push({ severity: 'warning', message: w.message, line: p.line, col: p.col, path: w.path }); }
    scenes.push({ id: raw.id, raw, layout, routes: routed.routes, steps, rendered, grid, assemble: raw.assemble ?? doc.assemble ?? false });
  });
  diags.sort((a, b) => a.line - b.line || a.col - b.col);
  return { ok: !diags.some(d => d.severity === 'error'), diags, doc, theme, catalog, scenes, parsed, source };
}

/** icons and screen faces the scene names that nothing has registered (registerMarks): drawn as a placeholder, and warned */
function unknownMarks(scene: RawScene, path: string, catalog: KindCatalog, parsed: Parsed): Diag[] {
  const out: Diag[] = [];
  const warn = (at: string, message: string) => { const p = parsed.locate(at); out.push({ severity: 'warning', message, line: p.line, col: p.col, path: at }); };
  const walk = (holder: { nodes?: RawNode[]; regions?: RawRegion[] }, at: string) => {
    holder.nodes?.forEach((n, j) => {
      const np = `${at}/nodes/${j}`;
      (n.deco ?? nodeKindOr(catalog, n.asset).deco ?? []).forEach((d, i) => {
        if (typeof d === 'object' && d.icon && !iconPainter(d.icon)) warn(n.deco ? `${np}/deco/${i}/icon` : np, `node "${n.id}": no icon "${d.icon}" is registered here, so it is drawn as a placeholder`);
      });
      if (n.face !== undefined && !facePainter(n.face)) warn(`${np}/face`, `node "${n.id}": no screen face "${n.face}" is registered here, so it is drawn as a placeholder`);
    });
    holder.regions?.forEach((r, i) => walk(r, `${at}/regions/${i}`));
  };
  walk(scene, path);
  return out;
}

