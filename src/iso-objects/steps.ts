// Steps: resolve the YAML's step references (routes, nodes, step ids) into the data the player runs on.

import { iso, type P3 } from '../iso-core/kernel.ts';
import { nodeKind } from './kinds.ts';
import { didYouMean, type Diag } from '../iso-core/errors.ts';
import type { Layout, Located } from './place.ts';
import type { Routed } from './route.ts';
import type { RawScene, StepRef, Theme } from './types.ts';
import { colorRef } from '../iso-core/theme.ts';

export interface RawStep {
  id?: string; number?: number; kind?: string; heading: string; caption?: string; command?: string;
  animate?: (string | Record<string, string> | (string | Record<string, string>)[])[];
  pulse?: string[]; highlight?: string[]; show?: string[]; hide?: string[]; focus?: string[];
  say?: { at: string | number[]; text: string; kind?: string; dx?: number; dy?: number; anchor?: 'start' | 'middle' | 'end' }[];
  mark?: { on?: string; at?: number[] }[];
  badge?: boolean | string | number[]; duration?: 'auto' | number;
}

export interface Token { route: string; kind: string; color: string }
export interface StepData {
  n: number;                 // 1-based position
  num: number;               // the number shown
  kind: string; color: string;
  heading: string; caption: string; command: string;
  phases: Token[][];
  pulses: [number, number, number, number][];   // screen x, y, rx, ry
  lit: string[];
  duration: number;
  /** screen box [x0, y0, x1, y1] to zoom to, from `focus:` */
  focus?: [number, number, number, number];
}
/** A callout: (x, y) is where the author asked for it; (ax, ay) is the point it belongs to, for placement. */
export interface Say { step: number; x: number; y: number; ax: number; ay: number; text: string; kind: string; anchor: 'start' | 'middle' | 'end' }
export interface Mark { step: number; p: P3; on?: string }
export interface Badge { step: number; num: number; kind: string; p: P3 }

export interface Steps {
  steps: StepData[];
  says: Say[]; marks: Mark[]; badges: Badge[];
  /** id → visibility at each step (index 0 = step 1); only for ids whose visibility ever changes */
  vis: Record<string, boolean[]>;
  /** ids of route-bound notes: note index → route id */
  diags: Diag[];
  kindsUsed: string[];
}

export function durationFor(caption: string): number {
  return Math.max(5600, Math.min(12500, 2600 + caption.length * 40));
}

export function resolveSteps(scene: RawScene, scenePath: string, layout: Layout, routes: Routed[], src: Located, theme: Theme): Steps {
  const diags: Diag[] = [];
  const err = (path: string, message: string, hint?: string, severity: 'error' | 'warning' = 'error') => {
    const p = src.locate(path); diags.push({ severity, message, line: p.line, col: p.col, path, hint });
  };
  const raws = (scene.steps ?? []) as RawStep[];
  const kinds = new Set(Object.keys(theme.kinds));
  const routeById = new Map(routes.map(r => [r.id, r]));
  const allIds = () => [...layout.byId.keys(), ...routeById.keys()];
  const stepIds = new Map<string, number>();
  raws.forEach((s, i) => {
    if (s.id) {
      if (stepIds.has(s.id)) err(`${scenePath}/steps/${i}/id`, `duplicate step id "${s.id}"`);
      stepIds.set(s.id, i + 1);
    }
  });
  const N = raws.length;
  const stepOf = (ref: StepRef, path: string): number | undefined => {
    if (typeof ref === 'number') {
      if (ref < 1 || ref > N) { err(path, `there is no step ${ref}; this scene has ${N} step(s)`); return undefined; }
      return ref;
    }
    const n = stepIds.get(ref);
    if (n === undefined) err(path, `unknown step "${ref}"` + dym(ref, stepIds.keys()));
    return n;
  };
  const color = (k: string) => colorRef(theme, theme.kinds[k]?.color ?? 'control');
  const kindsUsed: string[] = [];
  const use = (k: string) => { if (!kindsUsed.includes(k)) kindsUsed.push(k); };
  for (const r of routes) use(r.kind);

  // visibility from appears/disappears on items and routes, then show/hide in steps
  const vis: Record<string, boolean[]> = {};
  const initial = (id: string, appears: StepRef | undefined, disappears: StepRef | undefined, path: string) => {
    if (appears === undefined && disappears === undefined) return;
    const a = appears !== undefined ? stepOf(appears, path + '/appears') : 1;
    const d = disappears !== undefined ? stepOf(disappears, path + '/disappears') : N + 1;
    vis[id] = Array.from({ length: N }, (_, i) => i + 1 >= (a ?? 1) && i + 1 < (d ?? N + 1));
  };
  for (const p of layout.items) initial(p.id, p.appears, p.disappears, p.path);
  for (const r of routes) initial(r.id, r.raw.appears, r.raw.disappears, r.path);

  const steps: StepData[] = [];
  const says: Say[] = [], marks: Mark[] = [], badges: Badge[] = [];
  const routeEnds = () => {
    // a route is visible only while both its ends are (unless it says otherwise itself)
    for (const r of routes) {
      if (r.raw.appears !== undefined || r.raw.disappears !== undefined) continue;
      const ends = [r.from, r.to].map(p => p && (vis[p.id] ?? ancestorVis(p)));
      if (!ends.some(Boolean)) continue;
      vis[r.id] = Array.from({ length: N }, (_, i) => ends.every(v => !v || v[i]));
    }
  };
  const ancestorVis = (p: { parent?: { id: string; parent?: unknown } }): boolean[] | undefined => {
    for (let a = p.parent as { id: string; parent?: unknown } | undefined; a; a = a.parent as typeof a) if (vis[a.id]) return vis[a.id];
    return undefined;
  };
  raws.forEach((s, i) => {
    const n = i + 1, path = `${scenePath}/steps/${i}`;
    const kind = s.kind ?? 'control';
    if (!kinds.has(kind)) err(path + '/kind', `unknown flow kind "${kind}"` + dym(kind, kinds));
    use(kind);
    const lit = new Set<string>();
    const phases: Token[][] = [];
    (s.animate ?? []).forEach((ph, pi) => {
      const list = Array.isArray(ph) ? ph : [ph];
      const toks: Token[] = [];
      list.forEach((ref, ri) => {
        const rp = Array.isArray(ph) ? `${path}/animate/${pi}/${ri}` : `${path}/animate/${pi}`;
        let id: string, k: string | undefined;
        if (typeof ref === 'string') { const m = /^([^:\s]+)\s*(?::\s*(\S+))?$/.exec(ref.trim()); id = m ? m[1] : ref; k = m?.[2]; }
        else { const e = Object.entries(ref)[0]; id = e[0]; k = e[1]; }
        const r = routeById.get(id);
        if (!r) { err(rp, `unknown route "${id}"` + dym(id, routeById.keys())); return; }
        if (k && !kinds.has(k)) { err(rp, `unknown flow kind "${k}"` + dym(k, kinds)); return; }
        const tk = k ?? r.kind;
        use(tk);
        toks.push({ route: id, kind: tk, color: color(tk) });
        lit.add(id);
        if (r.from) lit.add(r.from.id);
        if (r.to) lit.add(r.to.id);
      });
      if (toks.length) phases.push(toks);
    });
    const pulses: StepData['pulses'] = [];
    (s.pulse ?? []).forEach((id, pi) => {
      const p = layout.byId.get(id);
      if (!p) { err(`${path}/pulse/${pi}`, `unknown node "${id}"` + dym(id, layout.byId.keys())); return; }
      let x: number, y: number, z: number, r: number;
      const a = p.node ? nodeKind(layout.catalog, p.node.asset) : undefined;
      if (a?.pulse) [x, y, z, r] = a.pulse(p.box);
      else { const b = p.box; x = (b.x0 + b.x1) / 2; y = (b.y0 + b.y1) / 2; z = b.z1; r = Math.max(22, Math.min(60, (b.x1 - b.x0 + b.y1 - b.y0) * 8.5)); }
      const [X, Y] = iso(x, y, z);
      pulses.push([X, Y, r * 1.7, r * 0.98]);
      lit.add(id);
    });
    (s.highlight ?? []).forEach((id, hi) => {
      if (!layout.byId.has(id) && !routeById.has(id)) err(`${path}/highlight/${hi}`, `unknown id "${id}"` + dym(id, allIds()));
      lit.add(id);
    });
    for (const [key, val] of [['show', true], ['hide', false]] as const) {
      (s[key] ?? []).forEach((id, hi) => {
        if (!layout.byId.has(id) && !routeById.has(id)) { err(`${path}/${key}/${hi}`, `unknown id "${id}"` + dym(id, allIds())); return; }
        const v = vis[id] ?? (vis[id] = Array(N).fill(!val));
        for (let j = i; j < N; j++) v[j] = val;
      });
    }
    (s.say ?? []).forEach((c, ci) => {
      let X: number, Y: number;
      if (Array.isArray(c.at)) [X, Y] = iso(c.at[0], c.at[1], c.at[2] ?? 0.36);
      else {
        const p = layout.byId.get(c.at);
        if (!p) { err(`${path}/say/${ci}/at`, `unknown node "${c.at}"` + dym(c.at, layout.byId.keys())); return; }
        const b = p.box;
        [X, Y] = iso((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z1 + 0.75);
      }
      const k = c.kind ?? kind;
      if (!kinds.has(k)) err(`${path}/say/${ci}/kind`, `unknown flow kind "${k}"` + dym(k, kinds));
      says.push({ step: n, x: X + (c.dx ?? 0), y: Y + (c.dy ?? (Array.isArray(c.at) ? 0 : -46)), ax: X, ay: Y, text: c.text, kind: k, anchor: c.anchor ?? 'middle' });
    });
    (s.mark ?? []).forEach((m, mi) => {
      if (m.at) { marks.push({ step: n, p: [m.at[0], m.at[1], m.at[2] ?? 0.36] }); return; }
      const r = m.on ? routeById.get(m.on) : undefined;
      if (!r) { err(`${path}/mark/${mi}`, m.on ? `unknown route "${m.on}"` + dym(m.on, routeById.keys()) : 'a mark needs "on: ROUTE" or "at: [x, y]"'); return; }
      const end = r.points[r.points.length - 1];
      marks.push({ step: n, p: [end[0], end[1], end[2] + 0.6], on: r.id });
      lit.add(r.id);
    });
    if (scene.badges && s.badge !== false) {
      let p: P3 | undefined = Array.isArray(s.badge) ? [s.badge[0], s.badge[1], s.badge[2] ?? 0.36] : undefined;
      const target = typeof s.badge === 'string' ? s.badge : phases[0]?.[0]?.route;
      const r = target ? routeById.get(target) : undefined;
      if (p) { /* explicit point */ }
      else if (r) p = midpoint(r.points);
      else if (target && layout.byId.get(target)) { const b = layout.byId.get(target)!.box; p = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z1 + 0.3]; }
      else if (typeof s.badge === 'string') err(`${path}/badge`, `unknown id "${s.badge}"` + dym(s.badge, allIds()));
      if (p) badges.push({ step: n, num: s.number ?? n, kind, p });
    }
    // a lit thing lights the regions it stands in; a tunnel lights with the routes it wraps
    for (const id of [...lit]) for (let a = layout.byId.get(id)?.parent; a; a = a.parent) lit.add(a.id);
    for (const t of layout.items) if (t.region?.kind === 'tunnel' && (t.region.around ?? []).some(r => lit.has(r))) lit.add(t.id);
    // focus: the screen box around the named parts (their outlines, plus a margin for labels above)
    let focus: StepData['focus'];
    if (s.focus?.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      s.focus.forEach((id, fi) => {
        const p = layout.byId.get(id);
        if (!p) { err(`${path}/focus/${fi}`, `unknown node or region "${id}"` + dym(id, layout.byId.keys())); return; }
        const b = p.box;
        for (const [x, y, z] of [[b.x0, b.y0, b.z1], [b.x1, b.y0, b.z0], [b.x0, b.y1, b.z0], [b.x1, b.y1, b.z0], [b.x1, b.y0, b.z1], [b.x0, b.y1, b.z1]] as P3[]) {
          const [X, Y] = iso(x, y, z);
          x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
        }
        lit.add(id);
      });
      if (x0 < Infinity) focus = [Math.round(x0 - 60), Math.round(y0 - 70), Math.round(x1 + 60), Math.round(y1 + 40)];
    }
    const caption = s.caption ?? '';
    steps.push({
      n, num: s.number ?? n, kind, color: color(kind), heading: s.heading, caption, command: s.command ?? '',
      phases, pulses, lit: [...lit], duration: s.duration === undefined || s.duration === 'auto' ? durationFor(caption) : s.duration,
      ...(focus ? { focus } : {}),
    });
  });
  routeEnds();
  return { steps, says, marks, badges, vis, diags, kindsUsed };
}

/** The point halfway along a polyline. */
export function midpoint(pts: P3[]): P3 {
  const seg = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1], q[2] - pts[i][2]));
  let half = seg.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < seg.length; i++) {
    if (half <= seg[i] && seg[i] > 0) { const t = half / seg[i], a = pts[i], b = pts[i + 1]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
    half -= seg[i];
  }
  return pts[0];
}

function dym(w: string, c: Iterable<string>): string {
  const d = didYouMean(w, c);
  return d ? ` (did you mean "${d}"?)` : '';
}
