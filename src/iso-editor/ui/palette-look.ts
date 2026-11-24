// The palette's entries as what they make (0.14.0): each thing drawn alone, small, in the drawing's own style. The canvas takes it as
// its kit's `looks`; a host that doesn't ask for it bundles none of it.

import { buildSvg } from '../../iso-core/svg-dom.ts';
import { boxSilhouette } from '../../iso-objects/geometry.ts';
import { applyStep } from '../splice.ts';
import type { Path } from '../path.ts';
import { h } from './icons.ts';
import type { CanvasDrawing, CanvasKit, CanvasUi, PaletteItem } from './canvas.ts';

type Kit<M, D extends CanvasDrawing> = Pick<CanvasKit<M, D>, 'kinds' | 'commands' | 'trial'>;
/** The kit's `looks`: the entries that show, one at a time, each once; an entry that can't be drawn alone keeps its icon. */
export const paletteLooks = <M, D extends CanvasDrawing>(K: Kit<M, D>): NonNullable<CanvasKit<M, D>['looks']> => (palette, data, ui: CanvasUi, theme) => {
  palette.classList.add('looks');
  let soon = 0;
  return function draw() {
    if (soon) return;
    soon = window.setTimeout(() => {
      soon = 0;
      const b = [...palette.querySelectorAll<HTMLButtonElement>('.pal-item:not([data-look])')].find(q => !q.hidden && !q.closest('[hidden]')), d = data();
      if (!b || !d) return;
      const s = lookOf(K, ui.palette[Number(b.dataset.entry)], d, theme);
      b.dataset.look = s ? 'object' : 'icon';
      if (s) b.querySelector('.icon')?.replaceWith(h('span', { class: `${ui.rootClass} pal-look` }, s as unknown as HTMLElement));
      draw();
    }, 0);
  };
};
/** the thing an entry makes: the file with nothing in it but its plain values, and one of it; its own elements, without labels,
 *  framed by its outline. Undefined where that can't be drawn. */
function lookOf<M, D extends CanvasDrawing>(K: Kit<M, D>, item: PaletteItem, data: unknown, theme: string): SVGSVGElement | undefined {
  const k = K.kinds.find(x => x.kind === item.kind);
  if (!k) return undefined;
  const name = K.commands.freshName('', item.name ?? k.singular), path = [...k.section, name] as Path;
  const bare = Object.entries((data ?? {}) as Record<string, unknown>).filter(([, v]) => v === null || typeof v !== 'object').map(([n, v]) => `${JSON.stringify(n)}: ${JSON.stringify(v)}\n`).join('');
  let d: D | undefined;
  try { d = K.trial(K.commands.insertCmd(path.slice(0, -1), name, (item.value?.() ?? k.template()) as Record<string, unknown>).build(bare).steps.reduce((t, st) => applyStep(t, st), bare), theme); } catch { /* it needs more around it */ }
  const id = d?.pinId.get(name), it = id ? d!.scene.layout.byId.get(id) : undefined;
  if (!d || d.diags.length || !id || !it) return undefined;
  const s = buildSvg(d.svg), all = [...s.querySelectorAll<SVGElement>('[data-id]')];
  if (!all.some(e => e.getAttribute('data-id') === id)) return undefined;
  for (const e of all) if (e.getAttribute('data-id') !== id) e.remove();
  for (const e of s.querySelectorAll('text, title, desc, .g-labels, .g-floor')) e.remove();
  const pts = boxSilhouette(it.box), xs = pts.map(q => q[0]), ys = pts.map(q => q[1]), m = 3;
  s.setAttribute('viewBox', [Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) - Math.min(...xs) + 2 * m, Math.max(...ys) - Math.min(...ys) + 2 * m].map(v => v.toFixed(1)).join(' '));
  for (const a of ['width', 'height', 'role', 'tabindex', 'aria-label']) s.removeAttribute(a);
  for (const e of s.querySelectorAll('[tabindex]')) { e.removeAttribute('tabindex'); e.removeAttribute('role'); }
  s.setAttribute('preserveAspectRatio', 'xMidYMid meet'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
  s.classList.add('pal-scene');
  return s;
}
