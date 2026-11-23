// Placement: regions and nodes → absolute boxes in grid units.
//
// Every container (the scene, a region, a node with nodes on top) lays out its children in its own frame, whose
// origin is the container's top-left corner (smallest x and y) on the floor its children stand on. A child is put
// at `at`, or next to a sibling (`right-of` +x, `left-of` −x, `below` +y, `behind` −y), or, with neither, after the
// previous sibling in the container's flow. A region without a `size` grows to fit its children plus its padding.

import type { Box } from '../iso-core/kernel.ts';
import { type KindCatalog, regionKind, nodeKind, nodeKindOr, wallHeight } from './kinds.ts';
import { didYouMean, type Diag } from '../iso-core/errors.ts';
import type { Placed, RawNode, RawRegion, RawScene, Theme } from './types.ts';

export interface Located { locate(path: string, opts?: { key?: boolean }): { line: number; col: number } }

/** a walled region's wall thickness */
export const WALL_T = 0.16;

const REL = ['right-of', 'left-of', 'below', 'behind'] as const;
type Rel = typeof REL[number];

interface Local { x: number; y: number; w: number; d: number; h: number; z: number }

export interface Layout {
  items: Placed[];
  byId: Map<string, Placed>;
  roots: Placed[];
  diags: Diag[];
  /** the kinds it was laid out with: drawing and routing ask them too */
  catalog: KindCatalog;
}

export function place(scene: RawScene, scenePath: string, src: Located, theme: Theme, catalog: KindCatalog, fileRoles: Record<string, unknown> = {}, snap?: number): Layout {
  const diags: Diag[] = [];
  const err = (path: string, message: string, hint?: string, key = false, severity: 'error' | 'warning' = 'error') => {
    const p = src.locate(path, { key });
    diags.push({ severity, message, line: p.line, col: p.col, path, hint });
  };
  const items: Placed[] = [];
  const byId = new Map<string, Placed>();
  const roots: Placed[] = [];
  const local = new Map<Placed, Local>();
  const roles = new Set([...Object.keys(theme.roles), ...Object.keys(fileRoles)]);

  // ---- 1. collect ----
  function add(p: Placed, parent: Placed | undefined) {
    const prev = byId.get(p.id);
    if (prev) {
      const at = src.locate(prev.path + '/id');
      err(p.path + '/id', `duplicate id "${p.id}" (first used on line ${at.line})`);
      return false;
    }
    byId.set(p.id, p); items.push(p);
    p.parent = parent;
    if (parent) parent.children.push(p); else roots.push(p);
    return true;
  }
  const blank = (): Box => ({ x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0 });
  function addNode(n: RawNode, path: string, parent: Placed | undefined) {
    const p: Placed = { id: n.id, type: 'node', path, children: [], box: blank(), floor: 0, node: n, appears: n.appears, disappears: n.disappears };
    if (!add(p, parent)) return;
    (n.nodes ?? []).forEach((c, i) => addNode(c, `${path}/nodes/${i}`, p));
  }
  function addRegion(r: RawRegion, path: string, parent: Placed | undefined) {
    const p: Placed = { id: r.id, type: 'region', path, children: [], box: blank(), floor: 0, region: r, appears: r.appears, disappears: r.disappears };
    if (!add(p, parent)) return;
    // nodes first: an item with no placement follows the item written before it
    (r.nodes ?? []).forEach((c, i) => addNode(c, `${path}/nodes/${i}`, p));
    (r.regions ?? []).forEach((c, i) => addRegion(c, `${path}/regions/${i}`, p));
  }
  (scene.regions ?? []).forEach((r, i) => addRegion(r, `${scenePath}/regions/${i}`, undefined));
  (scene.nodes ?? []).forEach((n, i) => addNode(n, `${scenePath}/nodes/${i}`, undefined));
  // (at scene level regions come first: the big slabs usually lead, and people and pads follow them)

  const ids = () => byId.keys();
  const regionIds = () => items.filter(i => i.type === 'region').map(i => i.id);

  // ---- 2. `in:` moves a scene-level item into a region; check names ----
  for (const p of [...items]) {
    const raw = p.node ?? p.region!;
    if (raw.in !== undefined) {
      const target = byId.get(raw.in);
      if (!target) { err(p.path + '/in', `unknown region "${raw.in}"` + hintFor(raw.in, regionIds())); continue; }
      if (target.type !== 'region') { err(p.path + '/in', `"${raw.in}" is a node, not a region; put nodes on a node with its own "nodes:" list`); continue; }
      if (p.parent && p.parent !== target) { err(p.path + '/in', `"${p.id}" is written inside "${p.parent.id}" but says in: ${raw.in}; use one or the other`); continue; }
      for (let a: Placed | undefined = target; a; a = a.parent) if (a === p) { err(p.path + '/in', `"${p.id}" cannot be inside itself`); continue; }
      if (!p.parent) { roots.splice(roots.indexOf(p), 1); p.parent = target; target.children.push(p); }
    }
    if (p.node) {
      const a = p.node.asset;
      if (a !== undefined && !nodeKind(catalog, a)) err(p.path + '/asset', `unknown asset "${a}"` + hintFor(a, Object.keys(catalog.nodes)), `assets: ${Object.keys(catalog.nodes).join(', ')}`);
    }
    const role = (p.node ?? p.region)!.role;
    if (role !== undefined && !roles.has(role)) err(p.path + '/role', `unknown colour role "${role}"` + hintFor(role, roles), `add it under "roles:" at the top of the file, or use one of: ${[...roles].join(', ')}`);
  }
  // a walled region's gate decides its node's box
  for (const p of items) {
    const g = p.region?.gate;
    if (!g?.node) continue;
    const gn = byId.get(g.node);
    if (!gn) { err(p.path + '/gate/node', `unknown node "${g.node}"` + hintFor(g.node, ids())); continue; }
    if (gn.type !== 'node') { err(p.path + '/gate/node', `"${g.node}" is a region; a gate is a node`); continue; }
    gn.placedBy = p.id;
    const n = gn.node!;
    if (n.at || REL.some(r => n[r])) err(gn.path, `"${gn.id}" is the gate of "${p.id}", which places it; its own placement is ignored`, undefined, false, 'warning');
  }

  // ---- 3. sizes and local placement, bottom-up ----
  const gapOf = (raw: { gap?: number }) => raw.gap ?? scene.gap ?? 2;

  function nodeSize(p: Placed): [number, number, number] {
    const n = p.node!, a = nodeKindOr(catalog, n.asset);
    const s = n.size;
    let w = a.size[0], d = a.size[1], h = a.size[2];
    if (s) { w = s[0]; d = s[1]; if (s.length > 2) h = s[2]; }
    if (p.placedBy) {
      const walled = byId.get(p.placedBy)!.region!, g = walled.gate!;
      const span = g.width ?? 2, thick = s ? Math.min(w, d) : 0.3;
      h = s && s.length > 2 ? h : g.height ?? (walled.height ?? wallHeight(catalog)) + 0.3;
      if (g.side === 'e' || g.side === 'w') { w = thick; d = span; } else { w = span; d = thick; }
    }
    return [w, d, h];
  }

  function layoutContainer(c: Placed | undefined, kids: Placed[], padding: number, flow: 'row' | 'column', fixed: boolean): { w: number; d: number } {
    // children first, so their sizes are known
    for (const k of kids) layoutItem(k);
    const placed = kids.filter(k => !k.placedBy);
    const sib = new Set(placed);
    const done = new Set<Placed>();
    const order: Placed[] = [];
    const visiting = new Set<Placed>();
    const deps = (k: Placed): Placed[] => {
      const raw = (k.node ?? k.region)!, out: Placed[] = [];
      for (const r of REL) {
        const t = raw[r];
        if (t === undefined) continue;
        const tp = byId.get(t);
        if (!tp) { err(`${k.path}/${r}`, `unknown id "${t}"` + hintFor(t, ids())); continue; }
        if (tp === k) { err(`${k.path}/${r}`, `"${k.id}" cannot be placed ${r} itself`); continue; }
        if (!sib.has(tp)) {
          const where = (x: Placed) => x.parent ? `"${x.parent.id}"` : 'the scene';
          err(`${k.path}/${r}`, `"${t}" is in ${where(tp)} but "${k.id}" is in ${where(k)}; relative placement works between items in the same region`,
            tp.placedBy ? `"${t}" is a gate, placed by its ${byId.get(tp.placedBy)?.region?.kind ?? 'region'}` : `place "${k.id}" relative to something in ${where(k)}, or use "at:"`);
          continue;
        }
        out.push(tp);
      }
      if (!out.length && !raw.at) { const i = placed.indexOf(k); if (i > 0) out.push(placed[i - 1]); }
      return out;
    };
    const visit = (k: Placed) => {
      if (done.has(k)) return;
      if (visiting.has(k)) { err(k.path, `placement loop: "${k.id}" is placed relative to something placed relative to it`); return; }
      visiting.add(k);
      deps(k).forEach(visit);
      visiting.delete(k);
      done.add(k); order.push(k);
    };
    // keep the written order where nothing forces otherwise
    placed.forEach(visit);

    for (const k of order) {
      const raw = (k.node ?? k.region)!, L = local.get(k)!;
      const rel = REL.find(r => raw[r] !== undefined && byId.get(raw[r]!) && sib.has(byId.get(raw[r]!)!));
      if (raw.at && rel) err(`${k.path}/at`, `"${k.id}" has both "at" and "${rel}"; "at" wins`, undefined, true, 'warning');
      if (raw.at) { L.x = raw.at[0]; L.y = raw.at[1]; }
      else if (rel) relTo(L, local.get(byId.get(raw[rel]!)!)!, rel, gapOf(raw), raw.align ?? 'center');
      else {
        // flow after the item written before it
        const i = placed.indexOf(k);
        if (i > 0) relTo(L, local.get(placed[i - 1])!, flow === 'row' ? 'right-of' : 'below', gapOf(raw), 'center');
        else { L.x = padding; L.y = padding; }
      }
      if (raw.shift) { L.x += raw.shift[0]; L.y += raw.shift[1]; }
    }

    // fit
    if (fixed || !placed.length) return { w: 0, d: 0 };
    let mx = Infinity, my = Infinity, Mx = -Infinity, My = -Infinity;
    for (const k of placed) { const L = local.get(k)!; mx = Math.min(mx, L.x); my = Math.min(my, L.y); Mx = Math.max(Mx, L.x + L.w); My = Math.max(My, L.y + L.d); }
    const sx = Math.min(0, mx - padding), sy = Math.min(0, my - padding);
    if (sx || sy) for (const k of placed) { const L = local.get(k)!; L.x -= sx; L.y -= sy; }
    void c;
    return { w: Mx - sx + padding, d: My - sy + padding };
  }

  function relTo(L: Local, T: Local, r: Rel, gap: number, align: 'start' | 'center' | 'end') {
    const alignY = () => { L.y = align === 'start' ? T.y : align === 'end' ? T.y + T.d - L.d : T.y + (T.d - L.d) / 2; };
    const alignX = () => { L.x = align === 'start' ? T.x : align === 'end' ? T.x + T.w - L.w : T.x + (T.w - L.w) / 2; };
    if (r === 'right-of') { L.x = T.x + T.w + gap; alignY(); }
    else if (r === 'left-of') { L.x = T.x - gap - L.w; alignY(); }
    else if (r === 'below') { L.y = T.y + T.d + gap; alignX(); }
    else { L.y = T.y - gap - L.d; alignX(); }
  }

  function layoutItem(p: Placed) {
    if (p.type === 'node') {
      const [w, d, h] = nodeSize(p);
      local.set(p, { x: 0, y: 0, w, d, h, z: p.node!.z ?? 0 });
      if (p.children.length) layoutContainer(p, p.children, 0, 'row', true);
      return;
    }
    const r = p.region!;
    const pad = r.padding ?? regionKind(catalog, r.kind)?.pad!;
    const fixed = !!r.size;
    const fit = layoutContainer(p, p.children, pad, r.flow ?? 'row', fixed);
    let w = r.size ? r.size[0] : Math.max(fit.w, pad * 2 + 0.5);
    let d = r.size ? r.size[1] : Math.max(fit.d, pad * 2 + 0.5);
    if (!r.size && r.gate) {
      // make way for the gate in its wall
      const need = (r.gate.width ?? 2) + 1;
      if (r.gate.side === 'e' || r.gate.side === 'w') d = Math.max(d, need); else w = Math.max(w, need);
    }
    const h = r.size && r.size.length > 2 ? r.size[2] : r.height ?? regionKind(catalog, r.kind)!.z[1];
    local.set(p, { x: 0, y: 0, w, d, h, z: 0 });
  }

  layoutContainer(undefined, roots, 0, scene.flow ?? 'row', true);

  // ---- 4. absolute boxes, top-down ----
  function absolute(p: Placed, ox: number, oy: number, floor: number) {
    const L = local.get(p)!;
    const x0 = ox + L.x, y0 = oy + L.y;
    if (p.type === 'region') {
      const rk = regionKind(catalog, p.region!.kind)!, [dz0] = rk.z, onTop = rk.floor;
      // a slab standing on another slab sits on it: no skirt below its floor
      const dz = rk.shape === 'slab' && regionKind(catalog, p.parent?.region?.kind)?.shape === 'slab' ? 0 : dz0;
      const lift = p.region!.z ?? 0;
      const z0 = floor + dz + lift, z1 = floor + L.h + lift;
      p.box = { x0, y0, z0, x1: x0 + L.w, y1: y0 + L.d, z1 };
      p.floor = onTop ? z1 : floor;
    } else {
      const z0 = floor + L.z;
      p.box = { x0, y0, z0, x1: x0 + L.w, y1: y0 + L.d, z1: z0 + L.h };
      p.floor = p.box.z1;
    }
    for (const k of p.children) if (!k.placedBy) absolute(k, x0, y0, p.floor);
  }
  for (const r of roots) if (!r.placedBy) absolute(r, 0, 0, 0);

  // ---- snapping: round every edge to the grid. Rounding keeps order, so what was inside stays inside and what
  // did not overlap still does not. Heights are left alone. ----
  if (snap) {
    const q = (v: number) => Math.round(v / snap) * snap;
    const fix = (v: number) => Math.round(v * 1e9) / 1e9;
    for (const p of items) {
      if (p.placedBy) continue;
      const b = p.box;
      let x0 = q(b.x0), x1 = q(b.x1), y0 = q(b.y0), y1 = q(b.y1);
      if (x1 - x0 < snap) x1 = x0 + snap;
      if (y1 - y0 < snap) y1 = y0 + snap;
      p.box = { ...b, x0: fix(x0), x1: fix(x1), y0: fix(y0), y1: fix(y1) };
      const raw = (p.node ?? p.region)!;
      if (raw.at) raw.at.forEach((v, i) => {
        const r = v / snap;
        if (Math.abs(r - Math.round(r)) > 1e-6) err(`${p.path}/at/${i}`, `${v} is not on the ${snap} grid; it is drawn at ${fix(q(v))}`, undefined, false, 'warning');
      });
    }
  }

  // gates
  for (const f of items) {
    const g = f.region?.gate;
    if (!g?.node) continue;
    const gn = byId.get(g.node);
    if (!gn || gn.placedBy !== f.id) continue;
    gn.box = gateBox(f, local.get(gn)!.h, local.get(gn)!.w, local.get(gn)!.d);
    gn.floor = gn.box.z1;
  }

  // ---- 5. checks ----
  for (const p of items) {
    const kids = p.children.filter(k => !k.placedBy);
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i], b = kids[j];
      if (passive(a, catalog) || passive(b, catalog)) continue;
      if (overlap2(a.box, b.box)) err(b.path, `"${b.id}" overlaps "${a.id}"`, `move one with "at", a relative placement, "gap" or "shift"`, false, 'warning');
    }
    if (p.parent && p.parent.type === 'region' && !p.placedBy) {
      const r = p.parent.box, b = p.box, e = 1e-6;
      if (b.x0 < r.x0 - e || b.y0 < r.y0 - e || b.x1 > r.x1 + e || b.y1 > r.y1 + e) err(p.path, `"${p.id}" sticks out of region "${p.parent.id}"`, `make "${p.parent.id}" bigger, or leave out its "size" so it fits its contents`, false, 'warning');
    }
  }
  {
    const top = roots.filter(x => !x.placedBy);
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
      const a = top[i], b = top[j];
      if (overlap2(a.box, b.box) && !passive(a, catalog) && !passive(b, catalog))
        err(b.path, `"${b.id}" overlaps "${a.id}"`, `move one with "at", a relative placement, "gap" or "shift"`, false, 'warning');
    }
  }
  const seen = new Set<string>();
  const out = diags.filter(d => { const k = d.path + d.message; if (seen.has(k)) return false; seen.add(k); return true; });
  return { items, byId, roots, diags: out, catalog };
}

/** zones and tunnels overlay other things on purpose */
const passive = (p: Placed, cat: KindCatalog) => p.type === 'region' && ['zone', 'tunnel'].includes(regionKind(cat, p.region!.kind)?.shape ?? '');

export function gateBox(f: Placed, h: number, w: number, d: number): Box {
  const g = f.region!.gate!, b = f.box, base = f.box.z0;
  const at = g.at ?? 0.5, span = g.width ?? 2;
  if (g.side === 'w' || g.side === 'e') {
    const x = g.side === 'w' ? b.x0 + WALL_T / 2 : b.x1 - WALL_T / 2, cy = b.y0 + (b.y1 - b.y0) * at;
    return { x0: x - w / 2, x1: x + w / 2, y0: cy - span / 2, y1: cy + span / 2, z0: base, z1: base + h };
  }
  const y = g.side === 'n' ? b.y0 + WALL_T / 2 : b.y1 - WALL_T / 2, cx = b.x0 + (b.x1 - b.x0) * at;
  return { x0: cx - span / 2, x1: cx + span / 2, y0: y - d / 2, y1: y + d / 2, z0: base, z1: base + h };
}

export function overlap2(a: Box, b: Box, e = 1e-6): boolean {
  return a.x0 < b.x1 - e && b.x0 < a.x1 - e && a.y0 < b.y1 - e && b.y0 < a.y1 - e;
}

function hintFor(word: string, candidates: Iterable<string>): string {
  const d = didYouMean(word, candidates);
  return d ? ` (did you mean "${d}"?)` : '';
}
