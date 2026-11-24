// The motion document (docs/design/MOTION.md, 3.2): an animation as plain data, with the names and the model of Remotion's
// own primitives (Sequence, Series, interpolate, spring; from its documentation, no code of it). Here: its types, its JSON
// Schema, its times, easings and curves, and the checks of its shape. What it looks like on a drawing is timeline.ts.
// Pure: no clock, no DOM, no randomness that isn't seeded.

import { didYouMean } from '../iso-core/errors.ts';
import { ASSEMBLE_STYLES, DISASSEMBLE_STYLES, MOTION_ORDERS, type PlanOptions } from './motion.ts';

/** ms, or "1.2s", "450ms", "30f" (frames, at the document's fps) */
export type MotionTime = number | string;
export const EASING_NAMES = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'settle', 'bounce'] as const;
export type EasingName = typeof EASING_NAMES[number];
export interface SpringConfig { mass?: number; damping?: number; stiffness?: number; overshootClamping?: boolean }
export type MotionEase = EasingName | { bezier: [number, number, number, number] } | { spring: SpringConfig };
export const EXTRAPOLATE = ['extend', 'clamp', 'wrap', 'identity'] as const;
export type Extrapolate = typeof EXTRAPOLATE[number];
/** a value over time: Remotion's interpolate, with ms for frames */
export interface Curve { times: MotionTime[]; values: number[]; easing?: MotionEase; extrapolateLeft?: Extrapolate; extrapolateRight?: Extrapolate }
/** the commentary of a beat */
export interface Say { chapter?: string; title?: string; text?: string; code?: string; facts?: [string, string][]; color?: string }
/** what a beat's focus dims: everything else, or the connectors and notes only */
export interface Focus { lit: string[]; scope?: 'all' | 'links'; level?: number; always?: string[] }
/** as long as it takes to read it: base + perChar × the text's length, between min and max */
export interface ReadTime { read: true | { base?: number; perChar?: number; min?: number; max?: number } }

interface ChildTiming { from?: MotionTime; duration?: MotionTime; easing?: MotionEase }
export interface Sequence {
  name?: string; from?: MotionTime; duration?: MotionTime | ReadTime; loop?: boolean | number; playbackRate?: number; trimBefore?: MotionTime;
  /** in a series: later (or, negative, earlier) than the end of the one before; those after it move too */
  offset?: MotionTime;
  say?: Say;
  /** cumulative: what is there is the fold of every beat to here */
  show?: string[]; hide?: string[];
  focus?: Focus;
  /** things ringed while the beat lasts */
  highlight?: string[];
  /** how much of a thing or a connector is there in this beat (0 to 1), as a phase has it; with `*`, every one not named */
  levels?: Record<string, number>;
  /** which of its looks a thing has from this beat on (cumulative, as show is); "" is its own */
  variants?: Record<string, string>;
  /** the ramp from the beat before (what a CSS transition would do) */
  enter?: { fade: MotionTime; easing?: MotionEase };
  /** marching dashes: every connector shown, or these; a beat's own */
  ants?: boolean | string[];
  children?: MotionNode[]; layers?: MotionNode[]; series?: SeriesItem[];
}
export interface Transition { presentation: 'fade' | 'none'; timing: { linear: MotionTime } | { spring: SpringConfig & { duration?: MotionTime } } }
export type SeriesItem = { sequence: Sequence } | { transition: Transition };
export type MotionNode =
  | { sequence: Sequence }
  | { series: SeriesItem[] }
  | { layers: MotionNode[] }
  | ({ assemble: Omit<PlanOptions, 'duration'> } & ChildTiming)
  | ({ disassemble: Omit<PlanOptions, 'duration'> } & ChildTiming)
  /** tokens along connectors: in sequence; a nested array is in parallel; "id:kind" colours one by a kind */
  | ({ travel: (string | string[])[]; each?: MotionTime; hold?: MotionTime; loop?: boolean } & ChildTiming)
  | ({ pulse: string[]; loop?: boolean } & ChildTiming)
  | ({ ants: true | string[]; speed?: number; dash?: [number, number] } & ChildTiming)
  | ({ draw: string[]; by?: 'stroke' | 'grow'; stagger?: MotionTime } & ChildTiming)
  | ({ type: string[] } & ChildTiming)
  | ({ move: string; x?: Curve; y?: Curve; scale?: Curve; opacity?: Curve } & { from?: MotionTime })
  /** `opacity`: over each thing's own time, from its own start (a slab that appears as it rises) */
  | ({ lift: string[]; by: number; stagger?: MotionTime; to?: 'up' | 'down'; opacity?: Curve } & ChildTiming)
  /** `fade`: how long it comes in and goes out over (250) */
  | ({ focus: Focus; fade?: MotionTime } & ChildTiming)
  | ({ highlight: string[]; fade?: MotionTime } & ChildTiming)
  | ({ camera: { focus: string | string[] | [number, number, number, number]; zoom?: number; margin?: number } | 'fit' } & ChildTiming);
export interface MotionDoc {
  isomotion: 1; fps?: number; seed?: number; ambient?: 'on' | 'off';
  series?: SeriesItem[]; layers?: MotionNode[];
  /** named moments: ms, or "beat+1200" */
  markers?: Record<string, MotionTime>;
}

export interface MotionDiag { severity: 'error' | 'warning'; path: string; message: string; hint?: string }

// ---------- times ----------

/** a time in ms, or undefined when it isn't one */
export function msOf(t: unknown, fps?: number): number | undefined {
  if (typeof t === 'number') return Number.isFinite(t) ? t : undefined;
  if (typeof t !== 'string') return undefined;
  const m = /^(-?\d+(?:\.\d+)?)(ms|s|f)?$/.exec(t.trim());
  if (!m) return undefined;
  const v = Number(m[1]);
  return m[2] === 's' ? v * 1000 : m[2] === 'f' ? (fps ? (v / fps) * 1000 : undefined) : v;
}
/** how long a beat's words take to read */
export function readMs(say: Say | undefined, r: ReadTime['read']): number {
  const o = r === true ? {} : r, base = o.base ?? 2600, per = o.perChar ?? 40, min = o.min ?? 5600, max = o.max ?? 12500;
  return Math.max(min, Math.min(max, base + (say?.text ?? '').length * per));
}

// ---------- easings and curves ----------

export const bezier = (x1: number, y1: number, x2: number, y2: number) => (x: number): number => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (at(x1, x2, m) < x) lo = m; else hi = m; }
  return at(y1, y2, (lo + hi) / 2);
};
const bounce = (f: number) => {
  if (f <= 0) return 0;
  if (f >= 1) return 1;
  const n = 7.5625, d = 2.75;
  if (f < 1 / d) return n * f * f;
  if (f < 2 / d) return n * (f - 1.5 / d) ** 2 + 0.75;
  if (f < 2.5 / d) return n * (f - 2.25 / d) ** 2 + 0.9375;
  return n * (f - 2.625 / d) ** 2 + 0.984375;
};
const NAMED: Record<EasingName, (f: number) => number> = {
  linear: f => f, ease: bezier(0.25, 0.1, 0.25, 1), 'ease-in': bezier(0.42, 0, 1, 1), 'ease-out': bezier(0, 0, 0.58, 1), 'ease-in-out': bezier(0.42, 0, 0.58, 1),
  settle: bezier(0.16, 0.84, 0.3, 1), bounce,
};
/** A damped spring from 0 to 1, t ms after it is let go: the closed form, no steps. */
export function springAt(t: number, c: SpringConfig = {}): number {
  const m = c.mass ?? 1, k = c.stiffness ?? 100, d = c.damping ?? 10, s = Math.max(0, t) / 1000;
  const w0 = Math.sqrt(k / m), z = d / (2 * Math.sqrt(k * m));
  let x: number;
  if (z < 1) { const w = w0 * Math.sqrt(1 - z * z); x = 1 - Math.exp(-z * w0 * s) * (Math.cos(w * s) + ((z * w0) / w) * Math.sin(w * s)); }
  else x = 1 - Math.exp(-w0 * s) * (1 + w0 * s);      // critically damped, and (as the documentation's) the most it is
  return c.overshootClamping ? Math.min(1, x) : x;
}
/** An easing as a function of the share of its time done; a spring is given the time's length too. */
export function easeOf(e: MotionEase | undefined, duration: number, otherwise: EasingName = 'ease-in-out'): (f: number) => number {
  const v = e ?? otherwise;
  if (typeof v === 'string') return NAMED[v];
  if ('bezier' in v) return bezier(...v.bezier);
  return f => (f <= 0 ? 0 : f >= 1 ? 1 : springAt(f * duration, v.spring));
}
/** Remotion's interpolate, for a checked curve: piecewise, the easing in each piece, the ends as asked (extend by default). */
export function curveAt(c: Curve, t: number, fps?: number): number {
  const ts = c.times.map(x => msOf(x, fps)!), vs = c.values, n = ts.length;
  if (n === 1) return vs[0];
  const edge = (how: Extrapolate, low: boolean): number | undefined => {
    if (how === 'clamp') return low ? vs[0] : vs[n - 1];
    if (how === 'identity') return t;
    if (how === 'wrap') { const span = ts[n - 1] - ts[0]; return curveAt({ ...c, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }, ts[0] + ((((t - ts[0]) % span) + span) % span), fps); }
    return undefined;
  };
  if (t < ts[0]) { const v = edge(c.extrapolateLeft ?? 'extend', true); if (v !== undefined) return v; }
  if (t > ts[n - 1]) { const v = edge(c.extrapolateRight ?? 'extend', false); if (v !== undefined) return v; }
  let i = 0;
  while (i < n - 2 && t >= ts[i + 1]) i++;
  const span = ts[i + 1] - ts[i], f = (t - ts[i]) / span;
  // past an end it goes on as a line, whatever the easing
  const g = f < 0 || f > 1 ? f : easeOf(c.easing, span, 'linear')(f);
  return vs[i] + (vs[i + 1] - vs[i]) * g;
}

// ---------- the JSON Schema: for editors (completion, hover) and for tools; checkMotion says the same, with places ----------

const TIME = { anyOf: [{ type: 'number' }, { type: 'string', pattern: '^-?\\d+(\\.\\d+)?(ms|s|f)?$' }] } as const;
const IDS = { type: 'array', items: { type: 'string' } } as const;
const EASE = { anyOf: [{ enum: EASING_NAMES }, { type: 'object', required: ['bezier'], additionalProperties: false, properties: { bezier: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 } } }, { type: 'object', required: ['spring'], additionalProperties: false, properties: { spring: { $ref: '#/$defs/spring' } } }] } as const;
const timing = { from: { $ref: '#/$defs/time' }, duration: { $ref: '#/$defs/time' }, easing: { $ref: '#/$defs/ease' } };
const node = (key: string, value: object, more: object = {}, withTiming = true) => ({ type: 'object', required: [key], additionalProperties: false, properties: { [key]: value, ...(withTiming ? timing : {}), ...more } });
export const MOTION_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'isomotion/1',
  type: 'object', required: ['isomotion'], additionalProperties: false,
  properties: {
    isomotion: { const: 1 }, fps: { type: 'number', exclusiveMinimum: 0, description: 'Frames a second, for lengths written "30f".' }, seed: { type: 'integer' },
    ambient: { enum: ['on', 'off'], description: 'Off: the ants and the looping tokens and pulses stand still, each at its start.' },
    series: { $ref: '#/$defs/series' }, layers: { $ref: '#/$defs/nodes' },
    markers: { type: 'object', additionalProperties: { anyOf: [{ type: 'number' }, { type: 'string' }] } },
  },
  $defs: {
    time: TIME, ids: IDS, ease: EASE,
    spring: { type: 'object', additionalProperties: false, properties: { mass: { type: 'number', exclusiveMinimum: 0 }, damping: { type: 'number', exclusiveMinimum: 0 }, stiffness: { type: 'number', exclusiveMinimum: 0 }, overshootClamping: { type: 'boolean' } } },
    curve: { type: 'object', required: ['times', 'values'], additionalProperties: false, properties: { times: { type: 'array', items: { $ref: '#/$defs/time' }, minItems: 1 }, values: { type: 'array', items: { type: 'number' }, minItems: 1 }, easing: { $ref: '#/$defs/ease' }, extrapolateLeft: { enum: EXTRAPOLATE }, extrapolateRight: { enum: EXTRAPOLATE } } },
    say: { type: 'object', additionalProperties: false, properties: { chapter: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' }, code: { type: 'string' }, color: { type: 'string' }, facts: { type: 'array', items: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 } } } },
    focus: { type: 'object', required: ['lit'], additionalProperties: false, properties: { lit: { $ref: '#/$defs/ids' }, scope: { enum: ['all', 'links'] }, level: { type: 'number', minimum: 0, maximum: 1 }, always: { $ref: '#/$defs/ids' } } },
    sequence: {
      type: 'object', additionalProperties: false, properties: {
        name: { type: 'string', pattern: '^[A-Za-z][\\w-]*$' }, from: { $ref: '#/$defs/time' }, offset: { $ref: '#/$defs/time' }, trimBefore: { $ref: '#/$defs/time' },
        duration: { anyOf: [{ $ref: '#/$defs/time' }, { type: 'object', required: ['read'], additionalProperties: false, properties: { read: { anyOf: [{ const: true }, { type: 'object', additionalProperties: false, properties: { base: { type: 'number' }, perChar: { type: 'number' }, min: { type: 'number' }, max: { type: 'number' } } }] } } }] },
        loop: { anyOf: [{ type: 'boolean' }, { type: 'integer', minimum: 1 }] }, playbackRate: { type: 'number', exclusiveMinimum: 0 },
        say: { $ref: '#/$defs/say' }, show: { $ref: '#/$defs/ids' }, hide: { $ref: '#/$defs/ids' }, focus: { $ref: '#/$defs/focus' }, highlight: { $ref: '#/$defs/ids' }, levels: { type: 'object', additionalProperties: { type: 'number', minimum: 0, maximum: 1 } }, variants: { type: 'object', additionalProperties: { type: 'string' } },
        enter: { type: 'object', required: ['fade'], additionalProperties: false, properties: { fade: { $ref: '#/$defs/time' }, easing: { $ref: '#/$defs/ease' } } },
        ants: { anyOf: [{ type: 'boolean' }, { $ref: '#/$defs/ids' }] }, children: { $ref: '#/$defs/nodes' }, layers: { $ref: '#/$defs/nodes' }, series: { $ref: '#/$defs/series' },
      },
    },
    series: { type: 'array', items: { anyOf: [{ $ref: '#/$defs/seq' }, node('transition', { type: 'object', required: ['presentation', 'timing'], additionalProperties: false, properties: { presentation: { enum: ['fade', 'none'] }, timing: { anyOf: [{ type: 'object', required: ['linear'], additionalProperties: false, properties: { linear: { $ref: '#/$defs/time' } } }, { type: 'object', required: ['spring'], additionalProperties: false, properties: { spring: { type: 'object', additionalProperties: false, properties: { mass: { type: 'number', exclusiveMinimum: 0 }, damping: { type: 'number', exclusiveMinimum: 0 }, stiffness: { type: 'number', exclusiveMinimum: 0 }, overshootClamping: { type: 'boolean' }, duration: { $ref: '#/$defs/time' } } } } }] } } }, {}, false)] } },
    seq: node('sequence', { $ref: '#/$defs/sequence' }, {}, false),
    plan: { type: 'object' },
    nodes: {
      type: 'array', items: { anyOf: [
        { $ref: '#/$defs/seq' }, node('series', { $ref: '#/$defs/series' }, {}, false), node('layers', { $ref: '#/$defs/nodes' }, {}, false),
        node('assemble', { type: 'object', properties: { style: { enum: ASSEMBLE_STYLES }, order: { enum: MOTION_ORDERS } } }), node('disassemble', { type: 'object', properties: { style: { enum: DISASSEMBLE_STYLES }, order: { enum: MOTION_ORDERS } } }),
        node('travel', { type: 'array', items: { anyOf: [{ type: 'string' }, { $ref: '#/$defs/ids' }] }, minItems: 1 }, { each: { $ref: '#/$defs/time' }, hold: { $ref: '#/$defs/time' }, loop: { type: 'boolean' } }),
        node('pulse', { $ref: '#/$defs/ids' }, { loop: { type: 'boolean' } }),
        node('ants', { anyOf: [{ const: true }, { $ref: '#/$defs/ids' }] }, { speed: { type: 'number' }, dash: { type: 'array', items: { type: 'number', exclusiveMinimum: 0 }, minItems: 2, maxItems: 2 } }),
        node('draw', { $ref: '#/$defs/ids' }, { by: { enum: ['stroke', 'grow'] }, stagger: { $ref: '#/$defs/time' } }), node('type', { $ref: '#/$defs/ids' }),
        { type: 'object', required: ['move'], additionalProperties: false, properties: { move: { type: 'string' }, from: { $ref: '#/$defs/time' }, x: { $ref: '#/$defs/curve' }, y: { $ref: '#/$defs/curve' }, scale: { $ref: '#/$defs/curve' }, opacity: { $ref: '#/$defs/curve' } } },
        { type: 'object', required: ['lift', 'by'], additionalProperties: false, properties: { lift: { $ref: '#/$defs/ids' }, by: { type: 'number' }, stagger: { $ref: '#/$defs/time' }, to: { enum: ['up', 'down'] }, opacity: { $ref: '#/$defs/curve' }, ...timing } },
        node('focus', { $ref: '#/$defs/focus' }, { fade: { $ref: '#/$defs/time' } }), node('highlight', { $ref: '#/$defs/ids' }, { fade: { $ref: '#/$defs/time' } }),
        node('camera', { anyOf: [{ const: 'fit' }, { type: 'object', required: ['focus'], additionalProperties: false, properties: { focus: { anyOf: [{ type: 'string' }, { $ref: '#/$defs/ids' }, { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 }] }, zoom: { type: 'number', exclusiveMinimum: 0 }, margin: { type: 'number' } } }] }),
      ] },
    },
  },
} as const;

// ---------- the checks ----------

const KINDS = ['sequence', 'series', 'layers', 'assemble', 'disassemble', 'travel', 'pulse', 'ants', 'draw', 'type', 'move', 'lift', 'focus', 'highlight', 'camera'] as const;
const LATER: Record<string, string> = { morph: 'the 2D morph is a later version\'s', diff: 'diffs are a later version\'s', switch: 'a look is a beat\'s: its variants' };
const TIMING = ['from', 'duration', 'easing'];
const KEYS: Record<string, string[]> = {
  sequence: [], series: [], layers: [], assemble: TIMING, disassemble: TIMING, travel: [...TIMING, 'each', 'hold', 'loop'], pulse: [...TIMING, 'loop'], ants: [...TIMING, 'speed', 'dash'],
  draw: [...TIMING, 'by', 'stagger'], type: TIMING, move: ['from', 'x', 'y', 'scale', 'opacity'], lift: [...TIMING, 'by', 'stagger', 'to', 'opacity'], focus: [...TIMING, 'fade'], highlight: [...TIMING, 'fade'], camera: TIMING,
};
const SEQ_KEYS = ['name', 'from', 'offset', 'duration', 'loop', 'playbackRate', 'trimBefore', 'say', 'show', 'hide', 'focus', 'highlight', 'levels', 'variants', 'enter', 'ants', 'children', 'layers', 'series'];
const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** What is wrong with a document's shape, each with its place (a JSON pointer). Its ids are bindMotion's to check. */
export function checkMotion(doc: unknown): MotionDiag[] {
  const out: MotionDiag[] = [];
  const err = (path: string, message: string, hint?: string) => { out.push({ severity: 'error', path, message, ...(hint ? { hint } : {}) }); };
  const keys = (v: Record<string, unknown>, allowed: readonly string[], path: string) => { for (const k of Object.keys(v)) if (!allowed.includes(k)) { const d = didYouMean(k, allowed); err(`${path}/${k}`, `unknown key "${k}"`, d ? `did you mean "${d}"?` : undefined); } };
  if (!isMap(doc)) { err('', 'a motion document is a map'); return out; }
  keys(doc, ['isomotion', 'fps', 'seed', 'ambient', 'series', 'layers', 'markers'], '');
  if (doc.isomotion !== 1) err('/isomotion', 'isomotion is 1');
  const fps = typeof doc.fps === 'number' && doc.fps > 0 ? doc.fps : undefined;
  if (doc.fps !== undefined && fps === undefined) err('/fps', 'fps is a number over 0');
  if (doc.seed !== undefined && !Number.isInteger(doc.seed)) err('/seed', 'seed is a whole number');
  if (doc.ambient !== undefined && doc.ambient !== 'on' && doc.ambient !== 'off') err('/ambient', 'ambient is "on" or "off"');
  const time = (v: unknown, path: string, o: { negative?: boolean } = {}) => {
    if (v === undefined) return;
    if (typeof v === 'string' && /f$/.test(v) && fps === undefined) { err(path, `"${v}" is in frames: the document needs its fps`); return; }
    const t = msOf(v, fps);
    if (t === undefined) err(path, `${JSON.stringify(v)} isn't a time (ms, "1.2s", "450ms", "30f")`);
    else if (t < 0 && !o.negative) err(path, 'a time can\'t be negative');
  };
  const oneOf = (v: unknown, list: readonly unknown[], path: string) => { if (v !== undefined && !list.includes(v)) { const d = typeof v === 'string' ? didYouMean(v, list as string[]) : undefined; err(path, `${JSON.stringify(v)} isn't one of ${list.join(', ')}`, d ? `did you mean "${d}"?` : undefined); } };
  const num = (v: unknown, path: string, o: { min?: number; max?: number; over?: number } = {}) => { if (v === undefined) return; if (typeof v !== 'number' || !Number.isFinite(v) || (o.min !== undefined && v < o.min) || (o.max !== undefined && v > o.max) || (o.over !== undefined && v <= o.over)) err(path, `${JSON.stringify(v)} isn't a number${o.over !== undefined ? ` over ${o.over}` : o.min !== undefined ? ` from ${o.min}${o.max !== undefined ? ` to ${o.max}` : ''}` : ''}`); };
  const ids = (v: unknown, path: string) => { if (v === undefined) return; if (!Array.isArray(v)) { err(path, 'a list of ids'); return; } v.forEach((x, i) => { if (typeof x !== 'string') err(`${path}/${i}`, 'an id'); }); };
  const spring = (v: unknown, path: string, more: string[] = []) => { if (!isMap(v)) { err(path, 'a spring is a map'); return; } keys(v, ['mass', 'damping', 'stiffness', 'overshootClamping', ...more], path); for (const k of ['mass', 'damping', 'stiffness']) num(v[k], `${path}/${k}`, { over: 0 }); if (v.overshootClamping !== undefined && typeof v.overshootClamping !== 'boolean') err(`${path}/overshootClamping`, 'true or false'); };
  const ease = (v: unknown, path: string) => {
    if (v === undefined) return;
    if (typeof v === 'string') { oneOf(v, EASING_NAMES, path); return; }
    if (isMap(v) && 'bezier' in v) { keys(v, ['bezier'], path); if (!Array.isArray(v.bezier) || v.bezier.length !== 4 || v.bezier.some(x => typeof x !== 'number')) err(`${path}/bezier`, 'four numbers'); return; }
    if (isMap(v) && 'spring' in v) { keys(v, ['spring'], path); spring(v.spring, `${path}/spring`); return; }
    err(path, 'an easing is a name, { bezier: [a, b, c, d] } or { spring: { … } }');
  };
  const curve = (v: unknown, path: string) => {
    if (v === undefined) return;
    if (!isMap(v)) { err(path, 'a curve is { times, values }'); return; }
    keys(v, ['times', 'values', 'easing', 'extrapolateLeft', 'extrapolateRight'], path);
    const ts = v.times, vs = v.values;
    if (!Array.isArray(ts) || !ts.length) err(`${path}/times`, 'a list of times'); else {
      ts.forEach((t, i) => time(t, `${path}/times/${i}`, { negative: true }));
      const n = ts.map(t => msOf(t, fps)); for (let i = 1; i < n.length; i++) if (n[i] !== undefined && n[i - 1] !== undefined && n[i]! <= n[i - 1]!) err(`${path}/times/${i}`, 'times go up');
    }
    if (!Array.isArray(vs) || vs.some(x => typeof x !== 'number')) err(`${path}/values`, 'a list of numbers'); else if (Array.isArray(ts) && vs.length !== ts.length) err(`${path}/values`, `${vs.length} values for ${ts.length} times`);
    ease(v.easing, `${path}/easing`); oneOf(v.extrapolateLeft, EXTRAPOLATE, `${path}/extrapolateLeft`); oneOf(v.extrapolateRight, EXTRAPOLATE, `${path}/extrapolateRight`);
  };
  const focus = (v: unknown, path: string) => { if (v === undefined) return; if (!isMap(v)) { err(path, 'focus is { lit: [ids] }'); return; } keys(v, ['lit', 'scope', 'level', 'always'], path); if (v.lit === undefined) err(`${path}/lit`, 'what is lit'); ids(v.lit, `${path}/lit`); ids(v.always, `${path}/always`); oneOf(v.scope, ['all', 'links'], `${path}/scope`); num(v.level, `${path}/level`, { min: 0, max: 1 }); };
  const text = (v: unknown, path: string) => { if (v !== undefined && typeof v !== 'string') err(path, 'text'); };
  const names = new Map<string, string>();
  function sequence(v: unknown, path: string, inSeries: boolean) {
    if (!isMap(v)) { err(path, 'a sequence is a map'); return; }
    keys(v, SEQ_KEYS, path);
    if (v.name !== undefined) {
      if (typeof v.name !== 'string' || !/^[A-Za-z][\w-]*$/.test(v.name)) err(`${path}/name`, 'a name is letters, digits, - and _, from a letter');
      else if (names.has(v.name)) err(`${path}/name`, `"${v.name}" is already a name (${names.get(v.name)})`); else names.set(v.name, path);
    }
    if (inSeries && v.from !== undefined) err(`${path}/from`, 'in a series a sequence follows the one before', 'offset moves it');
    if (!inSeries && v.offset !== undefined) err(`${path}/offset`, 'offset is for a series', 'use from');
    time(v.from, `${path}/from`); time(v.offset, `${path}/offset`, { negative: true }); time(v.trimBefore, `${path}/trimBefore`);
    if (isMap(v.duration)) {
      keys(v.duration, ['read'], `${path}/duration`);
      const r = v.duration.read;
      if (r !== true && !isMap(r)) err(`${path}/duration/read`, 'true, or { base, perChar, min, max }');
      else if (isMap(r)) { keys(r, ['base', 'perChar', 'min', 'max'], `${path}/duration/read`); for (const k of ['base', 'perChar', 'min', 'max']) num(r[k], `${path}/duration/read/${k}`, { min: 0 }); }
    } else time(v.duration, `${path}/duration`);
    if (v.loop !== undefined && typeof v.loop !== 'boolean' && !(Number.isInteger(v.loop) && (v.loop as number) >= 1)) err(`${path}/loop`, 'true, false, or how many times');
    num(v.playbackRate, `${path}/playbackRate`, { over: 0 });
    if (v.say !== undefined) {
      if (!isMap(v.say)) err(`${path}/say`, 'say is a map'); else {
        const s = v.say; keys(s, ['chapter', 'title', 'text', 'code', 'facts', 'color'], `${path}/say`);
        for (const k of ['chapter', 'title', 'text', 'code', 'color']) text(s[k], `${path}/say/${k}`);
        if (s.facts !== undefined && (!Array.isArray(s.facts) || s.facts.some(f => !Array.isArray(f) || f.length !== 2 || f.some(x => typeof x !== 'string')))) err(`${path}/say/facts`, 'a list of [name, value]');
      }
    }
    for (const k of ['show', 'hide', 'highlight']) ids(v[k], `${path}/${k}`);
    focus(v.focus, `${path}/focus`);
    if (v.levels !== undefined) { if (!isMap(v.levels)) err(`${path}/levels`, 'levels is a map: an id, and how much of it'); else for (const [k, x] of Object.entries(v.levels)) num(x, `${path}/levels/${k}`, { min: 0, max: 1 }); }
    if (v.variants !== undefined) { if (!isMap(v.variants)) err(`${path}/variants`, 'variants is a map: an id, and the name of its look'); else for (const [k, x] of Object.entries(v.variants)) if (typeof x !== 'string') err(`${path}/variants/${k}`, 'a look\'s name, or "" for its own'); }
    if (v.enter !== undefined) { if (!isMap(v.enter)) err(`${path}/enter`, 'enter is { fade }'); else { keys(v.enter, ['fade', 'easing'], `${path}/enter`); if (v.enter.fade === undefined) err(`${path}/enter/fade`, 'how long the fade is'); time(v.enter.fade, `${path}/enter/fade`); ease(v.enter.easing, `${path}/enter/easing`); } }
    if (v.ants !== undefined && typeof v.ants !== 'boolean') ids(v.ants, `${path}/ants`);
    for (const k of ['children', 'layers']) if (v[k] !== undefined) nodes(v[k], `${path}/${k}`);
    if (v.series !== undefined) series(v.series, `${path}/series`);
  }
  function series(v: unknown, path: string) {
    if (!Array.isArray(v)) { err(path, 'a series is a list'); return; }
    v.forEach((it, i) => {
      const p = `${path}/${i}`;
      if (!isMap(it) || Object.keys(it).length !== 1 || !('sequence' in it || 'transition' in it)) { err(p, 'a series holds sequences and transitions'); return; }
      if ('sequence' in it) { sequence(it.sequence, `${p}/sequence`, true); return; }
      const t = it.transition, q = `${p}/transition`, seqAt = (k: number) => isMap(v[k]) && 'sequence' in (v[k] as object);
      if (!seqAt(i - 1) || !seqAt(i + 1)) err(q, 'a transition is between two sequences');
      if (!isMap(t)) { err(q, 'a transition is { presentation, timing }'); return; }
      keys(t, ['presentation', 'timing'], q);
      if (t.presentation === undefined) err(`${q}/presentation`, 'a presentation'); else oneOf(t.presentation, ['fade', 'none'], `${q}/presentation`);
      if (!isMap(t.timing)) err(`${q}/timing`, 'a timing is { linear } or { spring }');
      else if ('linear' in t.timing) { keys(t.timing, ['linear'], `${q}/timing`); time(t.timing.linear, `${q}/timing/linear`); }
      else if ('spring' in t.timing) { keys(t.timing, ['spring'], `${q}/timing`); spring(t.timing.spring, `${q}/timing/spring`, ['duration']); if (isMap(t.timing.spring)) time(t.timing.spring.duration, `${q}/timing/spring/duration`); }
      else err(`${q}/timing`, 'a timing is { linear } or { spring }');
    });
  }
  function nodes(v: unknown, path: string) {
    if (!Array.isArray(v)) { err(path, 'a list'); return; }
    v.forEach((n, i) => {
      const p = `${path}/${i}`;
      if (!isMap(n)) { err(p, 'a map'); return; }
      const kinds = KINDS.filter(k => k in n);
      // (focus and highlight are kinds of their own, and no other kind has a key of that name)
      if (kinds.length !== 1) {
        const late = Object.keys(n).find(k => k in LATER), k0 = Object.keys(n)[0], d = k0 ? didYouMean(k0, KINDS) : undefined;
        err(p, late ? `${late}: ${LATER[late]}` : kinds.length ? `one of ${kinds.join(', ')}, not several` : `one of ${KINDS.join(', ')}`, !late && !kinds.length && d ? `did you mean "${d}"?` : undefined);
        return;
      }
      const k = kinds[0], c = n[k], q = `${p}/${k}`;
      keys(n, [k, ...KEYS[k]], p);
      if (KEYS[k].includes('from')) time(n.from, `${p}/from`);
      if (KEYS[k].includes('duration')) { time(n.duration, `${p}/duration`); ease(n.easing, `${p}/easing`); }
      for (const t of ['each', 'hold', 'stagger', 'fade']) if (KEYS[k].includes(t)) time(n[t], `${p}/${t}`);
      if (KEYS[k].includes('loop') && n.loop !== undefined && typeof n.loop !== 'boolean') err(`${p}/loop`, 'true or false');
      if (k === 'sequence') sequence(c, q, false);
      else if (k === 'series') series(c, q);
      else if (k === 'layers') nodes(c, q);
      else if (k === 'assemble' || k === 'disassemble') { if (!isMap(c)) err(q, `${k} is a map (its options)`); else { oneOf(c.style, k === 'assemble' ? ASSEMBLE_STYLES : DISASSEMBLE_STYLES, `${q}/style`); oneOf(c.order, MOTION_ORDERS, `${q}/order`); if (c.duration !== undefined) err(`${q}/duration`, 'its length is beside it', 'duration is the node\'s'); } }
      else if (k === 'travel') { if (!Array.isArray(c) || !c.length) err(q, 'a list of connectors'); else c.forEach((x, j) => { if (Array.isArray(x)) ids(x, `${q}/${j}`); else if (typeof x !== 'string') err(`${q}/${j}`, 'a connector, or a list of them at once'); }); }
      else if (k === 'ants') { if (c !== true) ids(c, q); num(n.speed, `${p}/speed`); if (n.dash !== undefined && (!Array.isArray(n.dash) || n.dash.length !== 2 || n.dash.some(x => typeof x !== 'number' || x <= 0))) err(`${p}/dash`, 'two numbers over 0: on, off'); }
      else if (k === 'move') { if (typeof c !== 'string') err(q, 'an id'); for (const a of ['x', 'y', 'scale', 'opacity']) curve(n[a], `${p}/${a}`); }
      else if (k === 'focus') focus(c, q);
      else if (k === 'camera') {
        if (c !== 'fit') {
          if (!isMap(c)) err(q, '"fit", or { focus, zoom, margin }'); else {
            keys(c, ['focus', 'zoom', 'margin'], q); num(c.zoom, `${q}/zoom`, { over: 0 }); num(c.margin, `${q}/margin`);
            const f = c.focus; if (!(typeof f === 'string' || (Array.isArray(f) && (f.every(x => typeof x === 'string') || (f.length === 4 && f.every(x => typeof x === 'number')))))) err(`${q}/focus`, 'an id, some ids, or a box [x, y, w, h]');
          }
        }
      } else ids(c, q);
      if (k === 'draw') oneOf(n.by, ['stroke', 'grow'], `${p}/by`);
      if (k === 'lift') { if (n.by === undefined) err(`${p}/by`, 'how far apart'); num(n.by, `${p}/by`); oneOf(n.to, ['up', 'down'], `${p}/to`); curve(n.opacity, `${p}/opacity`); }
    });
  }
  if (doc.series !== undefined) series(doc.series, '/series');
  if (doc.layers !== undefined) nodes(doc.layers, '/layers');
  if (doc.markers !== undefined) {
    if (!isMap(doc.markers)) err('/markers', 'markers is a map');
    else for (const [k, v] of Object.entries(doc.markers)) {
      if (typeof v === 'string' && /^[A-Za-z][\w-]*([+-].+)?$/.test(v)) { const m = /^([A-Za-z][\w-]*?)(?:([+-])(\d.*))?$/.exec(v); const at = m && (names.has(m[1]) ? m[1] : undefined); if (!at) { const whole = names.has(v); if (!whole) { const d = didYouMean(m?.[1] ?? v, names.keys()); err(`/markers/${k}`, `no sequence is named "${m?.[1] ?? v}"`, d ? `did you mean "${d}"?` : undefined); } } else if (m![3] !== undefined) time(m![3], `/markers/${k}`); }
      else time(v, `/markers/${k}`);
    }
  }
  return out;
}
