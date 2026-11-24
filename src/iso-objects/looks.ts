// The looks things declare (`variants:`): the same drawing with each thing's in it, for a motion to take that thing's parts from. A format
// that offers looks draws them after it compiles; one that doesn't bundles none of this.

import type { CompiledScene } from './compile.ts';
import { renderScene } from './scene.ts';
import type { Theme } from './types.ts';

/** Draw a scene's looks into its `rendered` (none declared: nothing). */
export function drawLooks(s: CompiledScene, theme: Theme): void {
  const looks: Record<string, string[]> = {};
  for (const p of s.layout.items) { const v = (p.region ?? p.node)?.variants; if (v) looks[p.id] = Object.keys(v); }
  if (!Object.keys(looks).length) return;
  s.rendered.looks = looks;
  s.rendered.variants = Object.fromEntries([...new Set(Object.values(looks).flat())].map(name => [name, renderScene({
    scene: s.raw, routes: s.routes, steps: s.steps, theme, id: s.raw.id, gridStep: s.grid.step ?? s.grid.snap ?? 1,
    layout: { ...s.layout, items: s.layout.items.map(p => {
      const v = (p.region ?? p.node)?.variants?.[name];
      return !v ? p : p.region ? { ...p, region: { ...p.region, ...v, deco: undefined } as typeof p.region } : { ...p, node: { ...p.node!, ...v } };
    }) },
  }).svg]));
}
