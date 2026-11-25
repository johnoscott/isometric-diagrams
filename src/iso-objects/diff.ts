// What changed between two compiled scenes: added, removed, moved or edited things, routes and notes, as plain JSON.

import type { Box, P3 } from '../iso-core/kernel.ts';
import type { CompiledScene } from './compile.ts';
import { polyBounds, silhouette } from './labels.ts';
import { parseEnd, type RawRoute, type Routed } from './route.ts';
import type { Placed, RawNote } from './types.ts';

export interface DiffOptions { /** ids renamed: the old one to the new one */ as?: Record<string, string> }
export type ThingField = 'label' | 'sub' | 'role' | 'look' | 'parent' | 'size';
export type RouteField = 'ends' | 'label' | 'kind' | 'arrow' | 'path';
export interface ThingChange { /** its id in the second drawing */ id: string; /** in the first, where it was renamed */ was?: string; type: 'region' | 'node';
  /** the drawing's units, at turn 0: from where it is in the first to where it is in the second (of the picture's box's middle) */
  by?: [number, number]; fields: ThingField[] }
export interface RouteChange { id: string; was?: string; fields: RouteField[] }
export interface SceneDiff {
  added: { things: string[]; routes: string[]; notes: string[] };
  removed: { things: string[]; routes: string[]; notes: string[] };
  /** in both, and not the same: moved (`by`), or other fields changed, or both */
  things: ThingChange[]; routes: RouteChange[];
  /** in both, and the same: the second's ids */
  same: { things: string[]; routes: string[]; notes: string[] };
  /** nothing differs */
  empty: boolean;
  diags: { severity: 'error' | 'warning'; message: string }[];
}

type DiffDiag = { severity: 'error' | 'warning'; message: string };
type EntryKind = 'thing' | 'route';

const MOVE_EPS = 0.5;
const GRID_EPS = 0.001;
const r2 = (v: number) => Math.round(v * 100) / 100 || 0;   // (never -0)

/** deterministic JSON for deep value comparison (sorted object keys, undefined keys skipped, -0 normalized) */
function canon(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === 0 ? 0 : v) ?? 'undefined';
  if (Array.isArray(v)) return '[' + v.map(x => (x === undefined ? 'null' : canon(x))).join(',') + ']';
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canon(obj[k])).join(',') + '}';
}

function boxMid(b: Box): [number, number] {
  const r = polyBounds(silhouette(b));
  return [r.x + r.w / 2, r.y + r.h / 2];
}

function lookOf(p: Placed): string {
  if (p.type === 'node') {
    const n = p.node;
    return canon({ ghost: n?.ghost, deco: n?.deco, face: n?.face, facing: n?.facing, asset: n?.asset, labelAt: n?.['label-at'] });
  }
  const r = p.region;
  return canon({ ghost: r?.ghost, kind: r?.kind, labelStyle: r?.['label-style'], gate: r?.gate });
}

function sizeDiffers(a: Box, b: Box): boolean {
  return Math.abs((b.x1 - b.x0) - (a.x1 - a.x0)) > GRID_EPS
    || Math.abs((b.y1 - b.y0) - (a.y1 - a.y0)) > GRID_EPS
    || Math.abs((b.z1 - b.z0) - (a.z1 - a.z0)) > GRID_EPS;
}

function pointsDiffer(a: P3[], b: P3[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = b[i];
    if (Math.abs(p[0] - q[0]) > GRID_EPS || Math.abs(p[1] - q[1]) > GRID_EPS || Math.abs(p[2] - q[2]) > GRID_EPS) return true;
  }
  return false;
}

function routeLabelOf(l: RawRoute['label']): string {
  return l === undefined ? 'undefined' : canon(typeof l === 'string' ? { text: l } : l);
}

function noteOf(n: RawNote, mapId: (id: string | undefined) => string | undefined): string {
  return canon({
    floor: n.floor, face: n.face, label: n.label, sub: n.sub, at: n.at,
    on: mapId(n.on), kind: n.kind, dir: n.dir, anchor: n.anchor, dx: n.dx, dy: n.dy,
  });
}

function validateAs(
  rawAs: Record<string, string> | undefined,
  aThings: Map<string, Placed>, bThings: Map<string, Placed>,
  aRoutes: Map<string, Routed>, bRoutes: Map<string, Routed>,
): { thingMap: Map<string, string>; routeMap: Map<string, string>; diags: DiffDiag[] } {
  const thingMap = new Map<string, string>(), routeMap = new Map<string, string>();
  const diags: DiffDiag[] = [];
  if (!rawAs || typeof rawAs !== 'object') return { thingMap, routeMap, diags };

  const entries = Object.entries(rawAs);
  const errors = new Map<string, string>();
  const kindIn = (id: string, things: Map<string, Placed>, routes: Map<string, Routed>): EntryKind | undefined =>
    things.has(id) ? 'thing' : routes.has(id) ? 'route' : undefined;

  const pending = new Map<string, { to: string; kind: EntryKind }>();
  const targetToFrom = new Map<string, string>();

  // pass 1: both ids exist (with matching kind) and target id is unique
  for (const [from, to] of entries) {
    if (typeof to !== 'string') { errors.set(from, `as: invalid target for id "${from}"`); continue; }
    const ak = kindIn(from, aThings, aRoutes);
    if (!ak) { errors.set(from, `as: unknown id "${from}" in first drawing`); continue; }
    const bk = kindIn(to, bThings, bRoutes);
    if (!bk) { errors.set(from, `as: unknown id "${to}" in second drawing`); continue; }
    if (ak !== bk) { errors.set(from, `as: cannot rename ${ak} "${from}" to ${bk} "${to}"`); continue; }
    if (from === to) continue;   // identity rename: no-op, not renamed away
    const prev = targetToFrom.get(to);
    if (prev !== undefined) {
      errors.set(from, `as: duplicate target id "${to}" (already mapped from "${prev}", ignoring "${from}")`);
      continue;
    }
    targetToFrom.set(to, from);
    pending.set(from, { to, kind: ak });
  }

  // pass 2: target id must not exist in first drawing unless it is itself renamed away (propagate along broken chains)
  const queue: string[] = [];
  for (const [from, { to, kind }] of pending) {
    const existsInA = kind === 'thing' ? aThings.has(to) : aRoutes.has(to);
    if (existsInA && !pending.has(to)) queue.push(from);
  }
  while (queue.length) {
    const from = queue.shift()!;
    const entry = pending.get(from);
    if (!entry) continue;
    pending.delete(from);
    errors.set(from, `as: "${from}" cannot rename to "${entry.to}" because "${entry.to}" already exists in first drawing`);
    const upstream = targetToFrom.get(from);
    if (upstream !== undefined && pending.has(upstream)) queue.push(upstream);
  }

  // emit diagnostics in the caller's entry order
  for (const [from] of entries) {
    const message = errors.get(from);
    if (message !== undefined) diags.push({ severity: 'error', message });
  }
  for (const [from, { to, kind }] of pending) {
    if (kind === 'thing') thingMap.set(from, to);
    else routeMap.set(from, to);
  }
  return { thingMap, routeMap, diags };
}

export function diffScenes(a: CompiledScene, b: CompiledScene, o?: DiffOptions): SceneDiff {
  const aItems = a.layout.items, bItems = b.layout.items;
  const aThings = new Map<string, Placed>(aItems.map(p => [p.id, p]));
  const bThings = new Map<string, Placed>(bItems.map(p => [p.id, p]));
  const aRoutes = new Map<string, Routed>(a.routes.map(r => [r.id, r]));
  const bRoutes = new Map<string, Routed>(b.routes.map(r => [r.id, r]));

  const { thingMap, routeMap, diags } = validateAs(o?.as, aThings, bThings, aRoutes, bRoutes);
  const thingRev = new Map<string, string>();
  for (const [from, to] of thingMap) thingRev.set(to, from);
  const routeRev = new Map<string, string>();
  for (const [from, to] of routeMap) routeRev.set(to, from);

  const mapThingId = (id: string) => thingMap.get(id) ?? id;
  const mapAnyId = (id: string | undefined) => (id === undefined ? undefined : thingMap.get(id) ?? routeMap.get(id) ?? id);

  // ---- things ----
  const addedThings: string[] = [], removedThings: string[] = [], sameThings: string[] = [];
  const changedThings: ThingChange[] = [];
  const matchedAThings = new Set<string>();

  for (const bp of bItems) {
    const wasId = thingRev.get(bp.id);
    const aId = wasId ?? (thingMap.has(bp.id) ? undefined : bp.id);
    const ap = aId !== undefined ? aThings.get(aId) : undefined;
    if (!ap || ap.type !== bp.type) {
      addedThings.push(bp.id);
      continue;
    }
    matchedAThings.add(ap.id);

    const aMid = boxMid(ap.box), bMid = boxMid(bp.box);
    const dx = r2(bMid[0] - aMid[0]), dy = r2(bMid[1] - aMid[1]);
    const by: [number, number] | undefined = Math.abs(dx) > MOVE_EPS || Math.abs(dy) > MOVE_EPS ? [dx, dy] : undefined;

    const aRaw = ap.type === 'node' ? ap.node : ap.region;
    const bRaw = bp.type === 'node' ? bp.node : bp.region;
    const fields: ThingField[] = [];
    if (aRaw?.label !== bRaw?.label) fields.push('label');
    if (ap.type === 'node' && ap.node?.sub !== bp.node?.sub) fields.push('sub');
    if (aRaw?.role !== bRaw?.role) fields.push('role');
    if (lookOf(ap) !== lookOf(bp)) fields.push('look');
    const aParent = ap.parent ? mapThingId(ap.parent.id) : undefined;
    if (aParent !== bp.parent?.id) fields.push('parent');
    if (sizeDiffers(ap.box, bp.box)) fields.push('size');

    if (by || fields.length) {
      changedThings.push({
        id: bp.id,
        ...(wasId !== undefined ? { was: wasId } : {}),
        type: bp.type,
        ...(by !== undefined ? { by } : {}),
        fields,
      });
    } else {
      sameThings.push(bp.id);
    }
  }
  for (const ap of aItems) {
    if (!matchedAThings.has(ap.id)) removedThings.push(ap.id);
  }

  // ---- routes ----
  const addedRoutes: string[] = [], removedRoutes: string[] = [], sameRoutes: string[] = [];
  const changedRoutes: RouteChange[] = [];
  const matchedARoutes = new Set<string>();

  for (const br of b.routes) {
    const wasId = routeRev.get(br.id);
    const aId = wasId ?? (routeMap.has(br.id) ? undefined : br.id);
    const ar = aId !== undefined ? aRoutes.get(aId) : undefined;
    if (!ar) {
      addedRoutes.push(br.id);
      continue;
    }
    matchedARoutes.add(ar.id);

    const af = parseEnd(typeof ar.raw.from === 'string' ? ar.raw.from : '');
    const at = parseEnd(typeof ar.raw.to === 'string' ? ar.raw.to : '');
    const bf = parseEnd(typeof br.raw.from === 'string' ? br.raw.from : '');
    const bt = parseEnd(typeof br.raw.to === 'string' ? br.raw.to : '');
    const endsChanged = mapThingId(af.id) !== bf.id || af.side !== bf.side || mapThingId(at.id) !== bt.id || at.side !== bt.side;

    const fields: RouteField[] = [];
    if (endsChanged) fields.push('ends');
    if (routeLabelOf(ar.raw.label) !== routeLabelOf(br.raw.label)) fields.push('label');
    if (ar.kind !== br.kind) fields.push('kind');
    if ((ar.raw.arrow !== false) !== (br.raw.arrow !== false)) fields.push('arrow');
    if (!endsChanged && pointsDiffer(ar.points, br.points)) fields.push('path');

    if (fields.length) {
      changedRoutes.push({
        id: br.id,
        ...(wasId !== undefined ? { was: wasId } : {}),
        fields,
      });
    } else {
      sameRoutes.push(br.id);
    }
  }
  for (const ar of a.routes) {
    if (!matchedARoutes.has(ar.id)) removedRoutes.push(ar.id);
  }

  // ---- notes: a note has no id of its own, so it is the same where it says the same (and is put and drawn the same), whatever the
  // scenes' ids. Of several that do, the one at the same place in the list, else the first not taken. The ids are motionModel's ----
  const aNotes = (a.raw.notes ?? []).map((n, i) => ({ id: `${a.id}-note-${i}`, says: noteOf(n, mapAnyId), taken: false }));
  const bNotes = (b.raw.notes ?? []).map((n, i) => ({ id: `${b.id}-note-${i}`, says: noteOf(n, x => x), same: false }));
  bNotes.forEach((n, i) => { if (aNotes[i]?.says === n.says) aNotes[i].taken = n.same = true; });
  for (const n of bNotes) if (!n.same) { const an = aNotes.find(x => !x.taken && x.says === n.says); if (an) an.taken = n.same = true; }
  const addedNotes = bNotes.filter(n => !n.same).map(n => n.id), sameNotes = bNotes.filter(n => n.same).map(n => n.id);
  const removedNotes = aNotes.filter(n => !n.taken).map(n => n.id);

  const empty = !addedThings.length && !addedRoutes.length && !addedNotes.length
    && !removedThings.length && !removedRoutes.length && !removedNotes.length
    && !changedThings.length && !changedRoutes.length;

  return {
    added: { things: addedThings, routes: addedRoutes, notes: addedNotes },
    removed: { things: removedThings, routes: removedRoutes, notes: removedNotes },
    things: changedThings,
    routes: changedRoutes,
    same: { things: sameThings, routes: sameRoutes, notes: sameNotes },
    empty,
    diags,
  };
}
