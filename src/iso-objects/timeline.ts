// A motion document bound to a drawing: a Timeline. at(ms) is what the drawing looks like then, as a SceneState (plain JSON,
// drawn by motion.ts's svgAt and paint); cues(ms) is the commentary. Pure: no clock, no DOM, no state kept between calls, so
// any moment can be asked in any order. Two clocks (docs/design/MOTION.md, 3.4): T, the timeline's, and A, the ambient one, for ants
// and for looping tokens and pulses: T says which are there, A where they are in their loop. at(T) is at(T, { ambient: T }).

import { didYouMean } from '../iso-core/errors.ts';
import type { CompiledScene } from './compile.ts';
import { ANT_SPEED, antDash, antsOf } from './ants.ts';
import { silhouette, type Rect } from './labels.ts';
import { motionModel, planOf, type ItemState, type MotionModel, type LabelState, type MotionPlan, type RouteState, type SceneState } from './motion.ts';
import { focusView } from './focus.ts';
import { checkMotion, curveAt, easeOf, msOf, readMs, springAt, type Focus, type MotionDiag, type MotionDoc, type MotionNode, type Say, type Sequence, type SeriesItem, type Transition } from './motion-doc.ts';

export interface BeatInfo { name: string; index: number; start: number; end: number; say?: Say }
export interface Cue { beat: string; chapter?: string; index: number; of: number; progress: number; say?: Say; color?: string }
export interface Timeline {
  readonly ok: boolean; readonly diags: MotionDiag[];
  /** ms */
  readonly duration: number;
  readonly beats: BeatInfo[];
  readonly markers: Record<string, number>;
  /** the document's own `ambient`: what at(ms) does with none given */
  readonly ambient: 'on' | 'off';
  /** whether anything in it runs on the ambient clock (ants, looping tokens and pulses): a host with none needs no frames while paused */
  readonly loops: boolean;
  /** what the drawing looks like at ms. `ambient`: the ambient clock's time (default: the same; a host that stopped it passes the time it
   *  stopped at, and what loops stands where it was), or 'off': it never ran, and each loop stands at its start */
  at(ms: number, o?: { ambient?: number | 'off' }): SceneState;
  cues(ms: number): Cue | undefined;
  beatAt(ms: number): BeatInfo | undefined;
  startOf(name: string): number | undefined;
}
export interface BindOptions {
  /** the connectors' dashes, by kind: the theme's `kinds` (a dashed kind marches with its own dash) */
  kinds?: Record<string, { dash?: 'solid' | 'dashed' | 'dotted'; ants?: [number, number] }>;
  /** kinds whose connectors stand still (default: blocked, planned) */
  still?: string[];
}

const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const r4 = (v: number) => Math.round(v * 10000) / 10000 || 0;
const clamp = (f: number) => Math.max(0, Math.min(1, f));
const mix = (a: number, b: number, f: number) => a + (b - a) * f;
const FADE = 250;

/** what a moment adds up to: opacities multiply, offsets add, the rest is the last said */
class Sum {
  items = new Map<string, ItemState>();
  labels = new Map<string, LabelState>();
  routes = new Map<string, RouteState>();
  tokens: NonNullable<SceneState['tokens']> = [];
  pulses: NonNullable<SceneState['pulses']> = [];
  outlines: NonNullable<SceneState['outlines']> = [];
  variants: Record<string, Record<string, number>> = {};
  marks = 1;
  private at<T extends object>(m: Map<string, T>, id: string): T { let v = m.get(id); if (!v) m.set(id, (v = {} as T)); return v; }
  item(id: string, s: ItemState) { const v = this.at(this.items, id); if (s.opacity !== undefined) v.opacity = (v.opacity ?? 1) * s.opacity; if (s.dx) v.dx = (v.dx ?? 0) + s.dx; if (s.dy) v.dy = (v.dy ?? 0) + s.dy; if (s.scale !== undefined) { v.scale = (v.scale ?? 1) * s.scale; v.about = s.about ?? v.about; } if (s.clip) v.clip = s.clip; }
  label(id: string, s: LabelState) { const v = this.at(this.labels, id); if (s.opacity !== undefined) v.opacity = (v.opacity ?? 1) * s.opacity; if (s.dx) v.dx = (v.dx ?? 0) + s.dx; if (s.dy) v.dy = (v.dy ?? 0) + s.dy; if (s.typed !== undefined) v.typed = Math.min(v.typed ?? 1, s.typed); }
  route(id: string, s: RouteState) { const v = this.at(this.routes, id); if (s.opacity !== undefined) v.opacity = (v.opacity ?? 1) * s.opacity; if (s.drawn !== undefined && s.drawn < (v.drawn ?? 1)) { v.drawn = s.drawn; v.by = s.by; } if (s.ants) v.ants = s.ants; }
  add(s: SceneState) {
    for (const [id, x] of Object.entries(s.items ?? {})) this.item(id, x);
    for (const [id, x] of Object.entries(s.labels ?? {})) this.label(id, x);
    for (const [id, x] of Object.entries(s.routes ?? {})) this.route(id, x);
    if (s.marks) this.marks *= s.marks.opacity;
    this.tokens.push(...s.tokens ?? []); this.pulses.push(...s.pulses ?? []);
  }
  state(camera?: [number, number, number, number]): SceneState {
    const out: SceneState = {};
    const rec = <T extends object>(m: Map<string, T>, clean: (v: T) => T) => { const o: Record<string, T> = {}; for (const [id, v] of m) { const c = clean(v); if (Object.keys(c).length) o[id] = c; } return o; };
    const some = (o: object) => Object.keys(o).length > 0;
    const op = (v: number | undefined) => (v === undefined || r4(v) >= 1 ? {} : { opacity: r4(Math.max(0, v)) });
    const move = (v: { dx?: number; dy?: number }) => ({ ...(r2(v.dx ?? 0) ? { dx: r2(v.dx!) } : {}), ...(r2(v.dy ?? 0) ? { dy: r2(v.dy!) } : {}) });
    const items = rec(this.items, v => ({ ...op(v.opacity), ...move(v), ...(v.scale !== undefined && r4(v.scale) !== 1 ? { scale: r4(v.scale), ...(v.about ? { about: v.about } : {}) } : {}), ...(v.clip ? { clip: v.clip } : {}) }));
    const labels = rec(this.labels, v => ({ ...op(v.opacity), ...(v.typed !== undefined && v.typed < 1 ? { typed: r4(v.typed) } : {}), ...move(v) }));
    const routes = rec(this.routes, v => {
      const hidden = v.opacity !== undefined && r4(v.opacity) <= 0, part = v.drawn !== undefined && v.drawn < 1;
      return { ...op(v.opacity), ...(part ? { drawn: r4(v.drawn!), ...(v.by ? { by: v.by } : {}) } : {}), ...(v.ants && !hidden && !part ? { ants: v.ants } : {}) };
    });
    if (some(items)) out.items = items;
    if (some(labels)) out.labels = labels;
    if (some(routes)) out.routes = routes;
    if (r4(this.marks) < 1) out.marks = { opacity: r4(this.marks) };
    if (this.tokens.length) out.tokens = this.tokens;
    if (this.pulses.length) out.pulses = this.pulses;
    if (this.outlines.length) out.outlines = this.outlines;
    if (some(this.variants)) out.variants = this.variants;
    if (camera) out.camera = camera;
    return out;
  }
}

/** What binding needs to know of a drawing, as plain JSON: for a page that has the drawing and no compiler. */
export interface MotionSource {
  model: MotionModel;
  /** each connector's kind */
  kinds: Record<string, string>;
  /** each thing's outline */
  outlines: Record<string, [number, number][]>;
  /** the looks each thing declares */
  looks?: Record<string, string[]>;
  ants?: ReturnType<typeof antsOf>;
  /** the notes on nothing (JSON keeps no undefined) */
  free?: string[];
}
export function motionSource(scene: CompiledScene): MotionSource {
  const ants = antsOf(scene.raw), looks = scene.rendered.looks, model = motionModel(scene), free = Object.keys(model.notes).filter(n => model.notes[n] === undefined);
  return {
    model, kinds: Object.fromEntries(scene.routes.map(r => [r.id, r.kind])),
    outlines: Object.fromEntries(scene.layout.items.map(p => [p.id, silhouette(p.box).map(q => [r2(q[0]), r2(q[1])] as [number, number])])),
    ...(looks && Object.keys(looks).length ? { looks } : {}), ...(ants ? { ants } : {}), ...(free.length ? { free } : {}),
  };
}

export function bindMotion(drawing: CompiledScene | MotionSource, doc: MotionDoc, opts: BindOptions = {}): Timeline {
  const src = 'model' in drawing ? drawing : motionSource(drawing);
  const m: MotionModel = src.free ? { ...src.model, notes: { ...src.model.notes, ...Object.fromEntries(src.free.map(n => [n, undefined])) } } : src.model;
  const diags = checkMotion(doc), fps = doc.fps, fileAnts = src.ants;
  const none = (): Timeline => ({ ok: false, diags, duration: 0, beats: [], markers: {}, ambient: 'on', loops: false, at: () => ({}), cues: () => undefined, beatAt: () => undefined, startOf: () => undefined });
  if (diags.length) return none();
  const err = (path: string, message: string, hint?: string) => { diags.push({ severity: 'error', path, message, ...(hint ? { hint } : {}) }); };
  const ms = (t: unknown, otherwise: number) => (t === undefined ? otherwise : msOf(t, fps)!);

  // ---------- what is in the drawing ----------
  const pieces = new Map(m.pieces.map(p => [p.id, p])), routes = new Set(m.routes.map(r => r.id)), notes = new Set(Object.keys(m.notes));
  const kindOf = new Map(Object.entries(src.kinds));
  const all = [...pieces.keys(), ...routes, ...notes];
  const known = new Set(all);
  /** what moves and fades with a thing or a connector: its own label, and the notes on it */
  const notesOn = new Map<string, string[]>();
  for (const [n, on] of Object.entries(m.notes)) if (on !== undefined) notesOn.set(on, [...(notesOn.get(on) ?? []), n]);
  const what = { any: known, thing: new Set(pieces.keys()), route: routes };
  const words = { any: 'thing, connector or note', thing: 'thing', route: 'connector' };
  const need = (id: string, path: string, kind: keyof typeof what = 'any') => { if (!what[kind].has(id)) { const d = didYouMean(id, what[kind]); err(path, `no ${words[kind]} "${id}" in this drawing`, d ? `did you mean "${d}"?` : undefined); } };
  const needAll = (v: string[] | undefined, path: string, kind: keyof typeof what = 'any') => v?.forEach((id, i) => need(id, `${path}/${i}`, kind));
  const outline = new Map(Object.entries(src.outlines));

  // ---------- how long things are ----------
  const plans = new Map<object, MotionPlan>();
  function nodeEnd(n: MotionNode, path: string): number {
    const from = 'from' in n ? ms(n.from, 0) : 0, dur = 'duration' in n ? ms(n.duration, NaN) : NaN, given = Number.isFinite(dur);
    if ('sequence' in n) { const s = n.sequence; return ms(s.from, 0) + seqLength(s, `${path}/sequence`); }
    if ('series' in n) return layoutSeries(n.series, `${path}/series`).end;
    if ('layers' in n) return Math.max(0, ...n.layers.map((x, i) => nodeEnd(x, `${path}/layers/${i}`)));
    if ('assemble' in n || 'disassemble' in n) {
      const kind = 'assemble' in n ? 'assemble' : 'disassemble', o = ('assemble' in n ? n.assemble : n.disassemble) as object;
      let p = plans.get(n);
      if (!p) plans.set(n, (p = planOf(m, kind, { seed: doc.seed ?? 1, ...o, ...(given ? { duration: dur } : {}) })));
      return from + p.duration;
    }
    // draw's and lift's duration is each thing's, one after another by the stagger
    if ('draw' in n) return from + (given ? dur : 400) + Math.max(0, n.draw.length - 1) * ms(n.stagger, 0);
    if ('lift' in n) return from + Math.max(given ? dur : 750, ...(n.opacity?.times.map(t => msOf(t, fps)!) ?? [])) + Math.max(0, n.lift.length - 1) * ms(n.stagger, 0);
    if (given) return from + dur;
    if ('travel' in n) return n.loop ? from : from + n.travel.length * ms(n.each, 1150);
    if ('pulse' in n) return n.loop ? from : from + 1500;
    if ('type' in n) return from + 400;
    if ('camera' in n) return from + 900;
    if ('move' in n) return from + Math.max(0, ...[n.x, n.y, n.scale, n.opacity].flatMap(c => c?.times.map(t => msOf(t, fps)!) ?? []));
    return from;   // (ants, focus, highlight, a loop: as long as what it is in)
  }
  const contents = (s: Sequence, path: string) => Math.max(0, ...(s.children ?? []).map((n, i) => nodeEnd(n, `${path}/children/${i}`)), ...(s.layers ?? []).map((n, i) => nodeEnd(n, `${path}/layers/${i}`)), s.series ? layoutSeries(s.series, `${path}/series`).end : 0);
  /** one run of what is in it, on its own clock */
  const runOf = new Map<Sequence, number>();
  function inner(s: Sequence, path: string): number {
    const have = runOf.get(s); if (have !== undefined) return have;
    let d: number;
    if (s.duration !== undefined && typeof s.duration === 'object') d = readMs(s.say, s.duration.read);
    else d = s.duration !== undefined ? ms(s.duration, 0) : contents(s, path);
    if (s.duration === undefined && d <= 0 && s.say) d = readMs(s.say, true);
    if (d <= 0) err(`${path}/duration`, 'how long is it? (nothing in it says)');
    runOf.set(s, d);
    return d;
  }
  /** how long it is where it stands */
  const seqLength = (s: Sequence, path: string): number => {
    const d = inner(s, path), rate = s.playbackRate ?? 1;
    if (s.loop === true) return d / rate;        // (an endless loop is as long as what it is in lets it be; alone, one run)
    return (typeof s.loop === 'number' ? d * s.loop : d) / rate;
  };
  interface Placed { s: Sequence; path: string; start: number; end: number; into?: { t: Transition; length: number } }
  function layoutSeries(items: SeriesItem[], path: string): { list: Placed[]; end: number } {
    const list: Placed[] = [];
    let at = 0, into: Placed['into'];
    items.forEach((it, i) => {
      if ('transition' in it) {
        const t = it.transition, g = t.timing;
        const length = t.presentation === 'none' ? 0 : transitionMs(g, fps);
        into = { t, length };
        return;
      }
      const s = it.sequence, p = `${path}/${i}/sequence`, len = seqLength(s, p);
      const start = Math.max(0, at + ms(s.offset, 0) - (into?.length ?? 0));
      if (into && list.length && into.length > Math.min(list[list.length - 1].end - list[list.length - 1].start, len)) err(`${path}/${i - 1}/transition/timing`, 'a transition is no longer than either side of it');
      list.push({ s, path: p, start, end: start + len, ...(into ? { into } : {}) });
      at = start + len; into = undefined;
    });
    return { list, end: Math.max(0, ...list.map(x => x.end)) };
  }

  const top = layoutSeries(doc.series ?? [], '/series');
  const extra = Math.max(0, ...(doc.layers ?? []).map((n, i) => nodeEnd(n, `/layers/${i}`)));
  const duration = Math.max(top.end, extra);
  if (duration <= 0 && !diags.length) err('', 'a motion document has a series, or layers, that last');

  // ---------- its ids, and what is only a top beat's ----------
  const starts = new Map<string, number>();
  interface CamCue { at: number; over: number; ease: (f: number) => number; to: [number, number, number, number] }
  const cams: CamCue[] = [];
  const fit = m.viewBox;
  const framed = (b: Rect, margin: number, zoom?: number): [number, number, number, number] => {
    const k = zoom !== undefined ? 1 / zoom : Math.max((b.w + margin * 2) / fit[2], (b.h + margin * 2) / fit[3]);
    return [b.x + b.w / 2 - (fit[2] * k) / 2, b.y + b.h / 2 - (fit[3] * k) / 2, fit[2] * k, fit[3] * k];
  };
  /** abs: the document's time of a local 0, and how fast local time runs; undefined: inside a loop */
  function visit(n: MotionNode, path: string, abs: { at: number; rate: number } | undefined) {
    const at = (t: number) => (abs ? { at: abs.at + t / abs.rate, rate: abs.rate } : undefined);
    if ('sequence' in n) { seq(n.sequence, `${path}/sequence`, at(ms(n.sequence.from, 0)), false); return; }
    if ('series' in n) { for (const p of layoutSeries(n.series, `${path}/series`).list) seq(p.s, p.path, at(p.start), false); return; }
    if ('layers' in n) { n.layers.forEach((x, i) => visit(x, `${path}/layers/${i}`, abs)); return; }
    if ('travel' in n) n.travel.forEach((x, i) => (Array.isArray(x) ? x : [x]).forEach((id, j) => need(id.split(':')[0], `${path}/travel/${i}${Array.isArray(x) ? `/${j}` : ''}`, 'route')));
    else if ('pulse' in n) needAll(n.pulse, `${path}/pulse`, 'thing');
    else if ('ants' in n) { if (n.ants !== true) needAll(n.ants, `${path}/ants`, 'route'); }
    else if ('draw' in n) needAll(n.draw, `${path}/draw`, 'route');
    else if ('type' in n) needAll(n.type, `${path}/type`);
    else if ('move' in n) need(n.move, `${path}/move`, 'thing');
    else if ('lift' in n) needAll(n.lift, `${path}/lift`, 'thing');
    else if ('focus' in n) focusIds(n.focus, `${path}/focus`);
    else if ('highlight' in n) needAll(n.highlight, `${path}/highlight`, 'thing');
    else if ('camera' in n) {
      const c = n.camera, over = ms(n.duration, 900);
      if (!abs) { err(`${path}/camera`, 'a camera can\'t be in a loop'); return; }
      let to: [number, number, number, number] = fit;
      if (c !== 'fit') {
        const f = c.focus;
        if (Array.isArray(f) && typeof f[0] === 'number') to = framed({ x: f[0] as number, y: f[1] as number, w: f[2] as number, h: f[3] as number }, c.margin ?? 0, c.zoom);
        else {
          const ids = (typeof f === 'string' ? [f] : f) as string[];
          ids.forEach((id, i) => need(id, `${path}/camera/focus${typeof f === 'string' ? '' : `/${i}`}`, 'thing'));
          const bs = ids.map(id => pieces.get(id)?.bbox).filter((b): b is Rect => !!b);
          if (bs.length) { const x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y)); to = framed({ x, y, w: Math.max(...bs.map(b => b.x + b.w)) - x, h: Math.max(...bs.map(b => b.y + b.h)) - y }, c.margin ?? 40, c.zoom); }
        }
      }
      cams.push({ at: abs.at + ms(n.from, 0) / abs.rate, over: over / abs.rate, ease: easeOf(n.easing, over, 'settle'), to });
    }
  }
  const focusIds = (f: Focus | undefined, path: string) => { if (f) { needAll(f.lit, `${path}/lit`); needAll(f.always, `${path}/always`); } };
  function seq(s: Sequence, path: string, abs: { at: number; rate: number } | undefined, isTop: boolean) {
    if (s.name !== undefined && abs) starts.set(s.name, abs.at);
    if (!isTop) for (const k of ['show', 'hide', 'say', 'enter', 'focus', 'highlight', 'levels', 'variants', 'ants'] as const) if (s[k] !== undefined) err(`${path}/${k}`, `${k} is for a sequence of the document's own series`, k === 'focus' || k === 'highlight' || k === 'ants' ? `here, a child: { ${k}: … }` : undefined);
    needAll(s.show, `${path}/show`); needAll(s.hide, `${path}/hide`); needAll(s.highlight, `${path}/highlight`, 'thing'); focusIds(s.focus, `${path}/focus`);
    for (const id of Object.keys(s.levels ?? {})) if (id !== '*') need(id, `${path}/levels/${id}`);
    for (const [id, name] of Object.entries(s.variants ?? {})) {
      need(id, `${path}/variants/${id}`, 'thing');
      const have = src.looks?.[id] ?? [];
      if (pieces.has(id) && name !== '' && !have.includes(name)) { const d = didYouMean(name, have); err(`${path}/variants/${id}`, have.length ? `${id} has no look "${name}" (it has ${have.join(', ')})` : `${id} declares no looks (variants: in the diagram)`, d ? `did you mean "${d}"?` : undefined); }
    }
    if (Array.isArray(s.ants)) needAll(s.ants, `${path}/ants`, 'route');
    const rate = s.playbackRate ?? 1;
    const local = abs && !s.loop ? { at: abs.at - ms(s.trimBefore, 0) / (abs.rate * rate), rate: abs.rate * rate } : undefined;
    (s.children ?? []).forEach((n, i) => visit(n, `${path}/children/${i}`, local));
    (s.layers ?? []).forEach((n, i) => visit(n, `${path}/layers/${i}`, local));
    if (s.series) for (const p of layoutSeries(s.series, `${path}/series`).list) seq(p.s, p.path, local && { at: local.at + p.start / local.rate, rate: local.rate }, false);
  }
  for (const p of top.list) seq(p.s, p.path, { at: p.start, rate: 1 }, true);
  (doc.layers ?? []).forEach((n, i) => visit(n, `/layers/${i}`, { at: 0, rate: 1 }));
  cams.sort((a, b) => a.at - b.at);
  const markers: Record<string, number> = {};
  for (const [k, v] of Object.entries(doc.markers ?? {})) {
    const t = msOf(v, fps);
    if (t !== undefined) { markers[k] = t; continue; }
    const s = String(v), hit = [...starts.keys()].filter(x => s === x || s.startsWith(x + '+') || s.startsWith(x + '-')).sort((a, b) => b.length - a.length)[0];
    if (hit === undefined) { err(`/markers/${k}`, `"${s}" isn't a moment of this document`); continue; }
    const rest = s.slice(hit.length), off = rest ? msOf(rest.slice(1), fps) : 0;
    if (off === undefined) { err(`/markers/${k}`, `"${rest}" isn't a time`); continue; }
    markers[k] = starts.get(hit)! + (rest[0] === '-' ? -off : off);
  }
  if (diags.length) return none();

  // ---------- the beats: what is there, what is lit, as the fold of every beat to each ----------
  const beats: BeatInfo[] = top.list.map((p, i) => ({ name: p.s.name ?? `beat-${i + 1}`, index: i, start: p.start, end: p.end, ...(p.s.say ? { say: p.s.say } : {}) }));
  const managed = new Map<string, boolean>();          // id → whether it is there before the first beat
  for (const p of top.list) { for (const id of p.s.show ?? []) if (!managed.has(id)) managed.set(id, false); for (const id of p.s.hide ?? []) if (!managed.has(id)) managed.set(id, true); }
  const folds: Map<string, boolean>[] = [new Map(managed)];
  for (const p of top.list) { const v = new Map(folds[folds.length - 1]); for (const id of p.s.show ?? []) v.set(id, true); for (const id of p.s.hide ?? []) v.set(id, false); folds.push(v); }
  /** the look each thing has in beat k (folds' own, from before the first) */
  const looked: Map<string, string>[] = [new Map()];
  for (const p of top.list) { const v = new Map(looked[looked.length - 1]); for (const [id, n] of Object.entries(p.s.variants ?? {})) v.set(id, n); looked.push(v); }
  /** how much a focus leaves of an id */
  const left = (f: Focus | undefined, id: string) => (!f || f.lit.includes(id) || f.always?.includes(id) || (f.scope === 'links' && pieces.has(id)) ? 1 : f.level ?? 0.12);
  /** an id's share in beat k (-1: before the first) */
  const level = (k: number, id: string) => { const v = k < 0 ? undefined : top.list[k].s.levels; return v ? v[id] ?? v['*'] ?? 1 : 1; };
  const share = (k: number, id: string) => (folds[k + 1].get(id) === false ? 0 : 1) * (k < 0 ? 1 : left(top.list[k].s.focus, id)) * level(k, id);
  /** a note goes with what it is on; what the document says of the note itself is on top of that */
  const noteShare = (k: number, n: string): number => {
    const on = m.notes[n];
    if (on === undefined) return share(k, n);
    const v = k < 0 ? undefined : top.list[k].s.levels?.[n];
    return share(k, on) * (folds[k + 1].get(n) === false ? 0 : 1) * (v ?? 1);
  };
  const beatIndex = (T: number) => { let k = -1; for (let i = 0; i < top.list.length; i++) if (top.list[i].start <= T) k = i; return k; };
  /** how much of beat k has come in at T (1: all of it) */
  const entered = (k: number, T: number) => {
    const p = top.list[k], lt = T - p.start;
    if (p.into && p.into.length > 0) return transitionAt(p.into.t.timing, lt, p.into.length);
    const e = p.s.enter; if (!e) return 1;
    const over = ms(e.fade, 0);
    return over <= 0 ? 1 : easeOf(e.easing, over, 'ease')(clamp(lt / over));
  };

  // ---------- a moment ----------
  type Ctx = { sum: Sum; shown: (id: string) => boolean; off: boolean; A: number };
  function each(n: MotionNode, t: number, a: number, end: number, c: Ctx): void {
    if ('sequence' in n) { const s = n.sequence, from = ms(s.from, 0); run(s, t - from, a - from, runLength(s, end - from), c); return; }
    if ('series' in n) { for (const p of layoutSeries(n.series, '').list) run(p.s, t - p.start, a - p.start, p.end - p.start, c); return; }
    if ('layers' in n) { for (const x of n.layers) each(x, t, a, end, c); return; }
    const from = ms('from' in n ? n.from : undefined, 0), lt = t - from;
    if ('assemble' in n || 'disassemble' in n) { c.sum.add(plans.get(n)!.at(lt)); return; }
    if ('draw' in n) {
      const one = Math.max(1, ms(n.duration, 400)), gap = ms(n.stagger, 0), e = easeOf(n.easing, one, 'ease-out');
      n.draw.forEach((id, i) => { const f = e(clamp((lt - i * gap) / one)); if (f <= 0) { c.sum.route(id, { opacity: 0, drawn: 0 }); c.sum.label(id, { opacity: 0 }); } else if (f < 1) { c.sum.route(id, { drawn: f, ...(n.by ? { by: n.by } : {}) }); c.sum.label(id, { opacity: f }); } });
      return;
    }
    if ('type' in n) { const d = ms(n.duration, 400), f = easeOf(n.easing, d, 'linear')(clamp(lt / Math.max(1, d))); if (f < 1) for (const id of n.type) c.sum.label(id, f <= 0 ? { opacity: 0 } : { typed: f }); return; }
    if ('move' in n) {
      const g = (q: typeof n.x) => (q ? curveAt(q, lt, fps) : undefined), dx = g(n.x) ?? 0, dy = g(n.y) ?? 0, sc = g(n.scale), op = g(n.opacity);
      c.sum.item(n.move, { dx, dy, ...(sc === undefined ? {} : { scale: sc, about: pieces.get(n.move)!.foot }), ...(op === undefined ? {} : { opacity: clamp(op) }) });
      for (const id of [n.move, ...notesOn.get(n.move) ?? []]) c.sum.label(id, { dx, dy, ...(op === undefined ? {} : { opacity: clamp(op) }) });
      return;
    }
    if ('lift' in n) {
      const gap = ms(n.stagger, 0), one = Math.max(1, ms(n.duration, 750)), e = easeOf(n.easing, one, 'ease-out'), down = n.to === 'down', N = n.lift.length;
      n.lift.forEach((id, i) => {
        const own = lt - (down ? N - 1 - i : i) * gap, f = e(clamp(own / one)), dy = (i + 1) * n.by * (down ? f : -f), o = n.opacity ? clamp(curveAt(n.opacity, own, fps)) : 1;
        if (!dy && o >= 1) return;
        c.sum.item(id, { dy, opacity: o });
        for (const x of [id, ...notesOn.get(id) ?? []]) c.sum.label(x, { dy, opacity: o });
      });
      return;
    }
    if ('camera' in n) return;
    // what lasts: from its start to its duration's end, or to the end of what it is in
    const lasts = n.duration === undefined ? Math.max(0, end - from) : ms(n.duration, 0);
    if (lt < 0 || lt > lasts) return;
    if ('focus' in n || 'highlight' in n) {
      const fade = Math.max(1, ms(n.fade, FADE)), amount = clamp(Math.min(lt / fade, n.duration === undefined ? 1 : (lasts - lt) / fade));
      const e = easeOf(n.easing, fade, 'linear')(amount);
      if ('focus' in n) dim(n.focus, e, c.sum); else for (const id of n.highlight) if (c.shown(id)) ring(id, e, c.sum);
      return;
    }
    if ('ants' in n) { march(n.ants === true ? [...routes] : n.ants, c, n.speed, n.dash); return; }
    if ('pulse' in n) {
      const d = 1500, p = n.loop ? turned(a - from, d, c) / d : lt / Math.max(1, n.duration === undefined ? d : lasts);
      if (p < 0 || p >= 1) return;
      for (const id of n.pulse) if (c.shown(id)) { const b = pieces.get(id)!, rx = b.bbox.w * 0.5 * (0.7 + p * 0.6); c.sum.pulses.push({ x: r2(b.foot[0]), y: r2(b.foot[1]), rx: r2(rx), ry: r2(rx * 0.58), opacity: r4(1 - p) }); }
      return;
    }
    if ('travel' in n) {
      const one = ms(n.each, 1150), hold = ms(n.hold, n.loop ? 700 : 0), period = n.travel.length * one + hold;
      const q = n.loop ? turned(a - from, period, c) : lt, i = Math.floor(q / one);
      if (i >= n.travel.length) return;
      const part = (q - i * one) / one, f = easeOf(n.easing, one, 'ease-in-out')(part), group = n.travel[i];
      for (const x of Array.isArray(group) ? group : [group]) { const [id, kind] = x.split(':'); if (c.shown(id)) c.sum.tokens.push({ route: id, at: r4((kind ?? kindOf.get(id)) === 'blocked' ? stalled(part) : f), ...(kind ? { kind } : {}) }); }
    }
  }
  /** a blocked token gets most of the way, stalls and falls back a little, as the page's steps have it */
  const stalled = (f: number) => (f < 0.7 ? f / 0.7 : 1 - ((f - 0.7) / 0.3) * 0.25);
  /** where in its turn a loop is: with the ambient off, at its start */
  const turned = (x: number, period: number, c: Ctx) => (c.off ? 0 : ((x % period) + period) % period);
  const ring = (id: string, amount: number, sum: Sum) => { if (r4(amount) > 0 && outline.has(id)) sum.outlines.push({ id, points: outline.get(id)!, ...(r4(amount) < 1 ? { opacity: r4(amount) } : {}) }); };
  const dim = (f: Focus, amount: number, sum: Sum) => { for (const id of all) { const on = notes.has(id) && !f.lit.includes(id) && !f.always?.includes(id) ? m.notes[id] : undefined, o = mix(1, left(f, on ?? id), amount); if (o >= 1) continue; if (pieces.has(id)) { sum.item(id, { opacity: o }); sum.label(id, { opacity: o }); } else if (routes.has(id)) { sum.route(id, { opacity: o }); sum.label(id, { opacity: o }); } else sum.label(id, { opacity: o }); } };
  const march = (ids: string[], c: Ctx, speed = ANT_SPEED, dash?: [number, number]) => {
    for (const id of ids) {
      const d = antDash(kindOf.get(id) ?? '', { dash, kinds: opts.kinds, still: opts.still });
      if (!d) continue;
      const period = d[0] + d[1], o = turned((speed * c.A) / 1000, period, c);
      c.sum.route(id, { ants: { dash: d, offset: r2(o) } });
    }
  };
  const runLength = (s: Sequence, rest: number) => (s.loop === true ? Math.max(0, rest) : seqLength(s, ''));
  /** what a sequence shows at its own time t (a: the ambient time, from its start) */
  function run(s: Sequence, t: number, a: number, length: number, c: Ctx): void {
    if (t < 0 || t > length || (t === length && length < duration && length > 0 && s.loop)) return;
    const rate = s.playbackRate ?? 1, one = inner(s, ''), trim = ms(s.trimBefore, 0);
    const turn = s.loop && one > 0 ? (t * rate) % one : t * rate, lt = turn + trim, la = a * rate + trim;
    for (const n of s.children ?? []) each(n, lt, la, one + trim, c);
    for (const n of s.layers ?? []) each(n, lt, la, one + trim, c);
    if (s.series) for (const p of layoutSeries(s.series, '').list) run(p.s, lt - p.start, la - p.start, p.end - p.start, c);
  }

  function at(ms0: number, o: { ambient?: number | 'off' } = {}): SceneState {
    const T = Math.max(0, Math.min(duration, Number.isFinite(ms0) ? ms0 : 0));
    const off = o.ambient === 'off' || (doc.ambient === 'off' && o.ambient === undefined), A = typeof o.ambient === 'number' ? o.ambient : T;
    const sum = new Sum(), k = beatIndex(T), f = k < 0 ? 1 : entered(k, T);
    const of = (id: string, g: (k: number, id: string) => number) => (k < 0 ? g(-1, id) : f >= 1 ? g(k, id) : mix(g(k - 1, id), g(k, id), f));
    const shown = (id: string) => (k < 0 ? folds[0] : folds[k + 1]).get(id) !== false;
    if (managed.size || top.list.some(p => p.s.focus || p.s.levels)) for (const id of all) {
      const v = of(id, notes.has(id) ? noteShare : share);
      if (v >= 1) continue;
      if (pieces.has(id)) sum.item(id, { opacity: v });
      if (routes.has(id)) sum.route(id, { opacity: v });
      sum.label(id, { opacity: v });
    }
    // looks: the one before gives way to this beat's as the beat comes in
    if (k >= 0) for (const id of looked[looked.length - 1].keys()) {
      const was = looked[k].get(id) ?? '', now = looked[k + 1].get(id) ?? '', v: Record<string, number> = {};
      if (was && f < 1) v[was] = r4(1 - f);
      if (now) v[now] = r4((v[now] ?? 0) + f);
      for (const n of Object.keys(v)) if (v[n] <= 0) delete v[n];
      if (Object.keys(v).length) sum.variants[id] = v;
    }
    // highlights: the beat's come in with it, the one before's go out
    if (k >= 0) {
      const now = new Set(top.list[k].s.highlight ?? []), was = new Set(k > 0 && f < 1 ? top.list[k - 1].s.highlight ?? [] : []);
      for (const id of new Set([...was, ...now])) ring(id, mix(was.has(id) ? 1 : 0, now.has(id) ? 1 : 0, f), sum);
    }
    const c: Ctx = { sum, shown, off, A };
    // a beat's own ants, else the file's
    const ants = k >= 0 ? top.list[k].s.ants : undefined, file = ants === undefined ? fileAnts : undefined;
    if (ants) march(ants === true ? [...routes] : ants, c);
    else if (file) march(file.ids ?? [...routes], c, file.speed, file.dash);
    top.list.forEach((p, i) => { if (T >= p.start && (T < p.end || (i === k && T <= p.end))) run(p.s, T - p.start, A - p.start, p.end - p.start, c); });
    for (const n of doc.layers ?? []) each(n, T, A, duration, c);
    // the camera: each cue from where the one before had got it
    let view: [number, number, number, number] | undefined;
    for (const q of cams) {
      if (q.at > T) break;
      const u = q.over <= 0 ? 1 : q.ease(clamp((T - q.at) / q.over)), was = view ?? fit;
      if (u >= 1) { view = q.to; continue; }
      // even in log-zoom; the middle goes with the zoom, so that a point's path is straight on the screen
      const z0 = was[2], z1 = q.to[2], z = Math.exp(mix(Math.log(z0), Math.log(z1), u)), g = Math.abs(z1 - z0) < 1e-6 ? u : (z - z0) / (z1 - z0);
      const cx = mix(was[0] + was[2] / 2, q.to[0] + q.to[2] / 2, g), cy = mix(was[1] + was[3] / 2, q.to[1] + q.to[3] / 2, g), h = (z * fit[3]) / fit[2];
      view = [cx - z / 2, cy - h / 2, z, h];
    }
    const cam = view?.map(r2) as [number, number, number, number] | undefined;
    return sum.state(cam && cam.some((v, i) => Math.abs(v - fit[i]) > 0.005) ? cam : undefined);
  }

  // whether anything anywhere is the ambient clock's
  const moving = (n: unknown): boolean => {
    if (!n || typeof n !== 'object') return false;
    if (Array.isArray(n)) return n.some(moving);
    const o = n as Record<string, unknown>;
    if (o.ants !== undefined && o.ants !== false) return true;
    if (o.loop === true && ('travel' in o || 'pulse' in o)) return true;
    return Object.values(o).some(moving);
  };
  const loops = fileAnts !== undefined || moving(doc.series) || moving(doc.layers);
  const beatAt = (t: number) => { const k = beatIndex(Math.max(0, Math.min(duration, t))); return k < 0 ? undefined : beats[k]; };
  return {
    ok: true, diags, duration, beats, markers, ambient: doc.ambient ?? 'on', loops, at, beatAt,
    startOf: n => starts.get(n) ?? beats.find(b => b.name === n)?.start,
    cues(t) {
      const b = beatAt(t);
      if (!b) return undefined;
      const T = Math.max(0, Math.min(duration, t));
      return { beat: b.name, index: b.index, of: beats.length, progress: r4(clamp((T - b.start) / Math.max(1, b.end - b.start))), ...(b.say ? { say: b.say, ...(b.say.chapter !== undefined ? { chapter: b.say.chapter } : {}), ...(b.say.color !== undefined ? { color: b.say.color } : {}) } : {}) };
    },
  };
}
/** how long a transition is, ms, and how far it is in at t of them */
export const transitionMs = (g: Transition['timing'], fps?: number): number => ('linear' in g ? msOf(g.linear, fps) ?? 0 : msOf(g.spring.duration, fps) ?? settleMs(g.spring));
export function transitionAt(g: Transition['timing'], t: number, length: number): number {
  if (length <= 0 || t >= length) return 1;
  return 'spring' in g ? clamp(springAt(t, { ...g.spring, overshootClamping: true }) / springAt(length, { ...g.spring, overshootClamping: true })) : clamp(t / length);
}
/** how long a spring takes to come to rest, ms: its envelope under half a percent */
function settleMs(c: { mass?: number; damping?: number; stiffness?: number }): number {
  const m = c.mass ?? 1, k = c.stiffness ?? 100, d = c.damping ?? 10, w0 = Math.sqrt(k / m), z = Math.min(1, d / (2 * Math.sqrt(k * m)));
  return Math.ceil((Math.log(200) / (z * w0)) * 1000 * (z >= 1 ? 1.6 : 1));
}

/** A drawing's own steps as a motion document, so that every drawing with steps has a timeline. */
export function motionOfSteps(scene: CompiledScene): MotionDoc {
  const { steps, vis } = scene.steps, full = scene.rendered.viewBox;
  let zoomed = false;
  const m = motionModel(scene), ids = new Set([...m.pieces.map(p => p.id), ...m.routes.map(r => r.id), ...Object.keys(m.notes)]), has = (id: string) => ids.has(id);
  // (a note on nothing is no connector's)
  const free = Object.keys(m.notes).filter(n => m.notes[n] === undefined);
  const series: SeriesItem[] = steps.map((st, i) => {
    const show: string[] = [], hide: string[] = [];
    // (an id first shown is hidden until then, and one first hidden is there until then: so only the changes are said)
    for (const [id, v] of Object.entries(vis)) { if (i === 0 ? !v.includes(true) : v[i - 1] && !v[i]) hide.push(id); else if (i > 0 ? v[i] && !v[i - 1] : false) show.push(id); }
    const children: MotionNode[] = [];
    const token = (t: { route: string; kind: string }) => `${t.route}:${t.kind}`;
    if (st.phases.length) children.push({ travel: st.phases.map(g => (g.length === 1 ? token(g[0]) : g.map(token))), each: 1150, hold: 700, loop: true });
    const pulse = ((scene.raw.steps ?? [])[i] as { pulse?: string[] } | undefined)?.pulse?.filter(id => scene.layout.byId.has(id)) ?? [];
    if (pulse.length) children.push({ pulse, loop: true });
    // a step's focus is where the camera goes, and back out with the first step that has none
    if (st.focus) { const [x, y, w, h] = focusView(full, st.focus).map(r2); children.push({ camera: { focus: [x, y, w, h] }, duration: 900, easing: 'ease-in-out' }); zoomed = true; } else if (zoomed) { children.push({ camera: 'fit', duration: 900, easing: 'ease-in-out' }); zoomed = false; }
    const s: Sequence = { name: `step-${st.n}`, duration: st.duration, say: { title: st.heading, ...(st.caption ? { text: st.caption } : {}), ...(st.command ? { code: st.command } : {}) } };
    if (show.length) s.show = show;
    if (hide.length) s.hide = hide;
    // what a step doesn't touch dims, as on its page: the connectors and notes, or everything (the scene's `dim`)
    s.focus = scene.raw.dim === 'all' ? { lit: st.lit.filter(has), scope: 'all', level: 0.14 } : { lit: st.lit.filter(has), scope: 'links', level: 0.12, ...(free.length ? { always: free } : {}) };
    if (children.length) s.children = children;
    return { sequence: s };
  });
  return { isomotion: 1, ...(series.length ? { series } : {}) };
}
