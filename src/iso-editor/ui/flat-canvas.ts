// The canvas's 2D view (0.6.4): what the canvas asks of it, done with the flat layout. The canvas never imports this
// module: a host that wants the 2D view hands it over (DomainView.flat.load, e.g. `() => import(…).then(m => m.flatCanvas)`),
// so a host that gives no 2D view bundles none of it.

import { boardOf } from '../../iso-objects/board.ts';
import { layoutFlat } from '../../iso-objects/flat.ts';
import { flatSvg, measureIn } from '../../iso-viewer/flat-view.ts';
import { markConnectors, morphSvgs } from '../../iso-viewer/morph.ts';
import type { FlatCanvas, FlatDrawn } from './canvas.ts';

export const flatCanvas: FlatCanvas = {
  draw(scene, stage, o) {
    // laid out with the stage's own text measured (the host's canvas CSS has the 2D view's stylesheet)
    const m = measureIn(stage);
    let L;
    try { L = layoutFlat(boardOf(scene), m, o.options); } finally { m.dispose(); }
    const b = L.bounds;
    const rectOf = (id: string) => L.cards.find(c => c.id === id)?.rect ?? L.panels.find(p => p.id === id)?.rect;
    const drawn: FlatDrawn = {
      svg: flatSvg(L, { id: 'canvas-2d', title: o.title, styles: o.styles }),
      full: [b.l, b.t, b.r - b.l, b.b - b.t],
      layout: L,
      outlines(ids, svg) {
        const out: ReturnType<FlatDrawn['outlines']> = [];
        for (const id of ids) {
          const r = rectOf(id);
          if (r) { out.push({ kind: 'poly', id, points: [[r.l, r.t], [r.r, r.t], [r.r, r.b], [r.l, r.b]] }); continue; }
          const d = svg.querySelector(`path.conn[data-id="${CSS.escape(id)}"]`)?.getAttribute('d');
          if (d) out.push({ kind: 'route', d });
        }
        return out;
      },
      hits(g, touch) {
        return [...L.cards, ...L.panels].filter(it => {
          const r = it.rect;
          return touch ? r.l < g.r && r.r > g.l && r.t < g.b && r.b > g.t : r.l >= g.l && r.t >= g.t && r.r <= g.r && r.b <= g.b;
        }).map(it => it.id);
      },
      panelsAt(x, y) {
        return [...L.panels].sort((p, q) => q.depth - p.depth).filter(p => x >= p.rect.l && x <= p.rect.r && y >= p.rect.t && y <= p.rect.b).map(p => p.id);
      },
    };
    return drawn;
  },
  // 0.7.5: the switch's morph, dualView's: the 3D drawing's connectors marked with their ends first, as the 2D ones are
  morph(root, scene, from, to, o) {
    const svg3 = from.mode === '3d' ? from.svg : to;
    markConnectors(svg3, scene, boardOf(scene));
    return morphSvgs(root, from.svg, to, from.mode, o);
  },
};
