// The motion document, written in code: motion() and its methods make plain data (toJSON() is the document) and nothing else is
// kept. Every word here is one of the document's; `over` is its duration. What a document can't say has no method.

import type { Curve, Focus, MotionDoc, MotionEase, MotionNode, MotionTime, ReadTime, Say, Sequence, SeriesItem, Transition } from './motion-doc.ts';
import type { AssembleOptions, DisassembleOptions } from './motion.ts';

export interface Timing { from?: MotionTime; over?: MotionTime; easing?: MotionEase }
/** a sequence's own keys; `read`: as long as its words take (true, or how) */
export type SequenceOptions = Omit<Sequence, 'name' | 'children' | 'layers' | 'series' | 'duration'> & { duration?: MotionTime; read?: ReadTime['read'] };
export type Ids = string | string[];
const list = (v: Ids): string[] => (typeof v === 'string' ? [v] : [...v]);
/** what was given, as plain data of its own (no undefined, nothing shared with the caller) */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const timing = (o: Timing = {}) => ({ ...(o.from === undefined ? {} : { from: o.from }), ...(o.over === undefined ? {} : { duration: o.over }), ...(o.easing === undefined ? {} : { easing: o.easing }) });

export interface CameraVerbs<B> { focus(on: Ids | [number, number, number, number], o?: Timing & { zoom?: number; margin?: number }): B; fit(o?: Timing): B }
/** what is in a sequence (or in a document's layers), in the order it is said */
export class NodesBuilder {
  /** @internal */
  readonly nodes: MotionNode[] = [];
  private add(n: MotionNode): this { this.nodes.push(plain(n)); return this; }
  assemble(o: Omit<AssembleOptions, 'duration'> = {}, t: Timing = {}): this { return this.add({ assemble: o, ...timing(t) }); }
  disassemble(o: Omit<DisassembleOptions, 'duration'> = {}, t: Timing = {}): this { return this.add({ disassemble: o, ...timing(t) } as MotionNode); }
  /** tokens along connectors, one after another; a nested list at once; "id:kind" */
  travel(routes: (string | string[])[], o: Timing & { each?: MotionTime; hold?: MotionTime; loop?: boolean } = {}): this { const { each, hold, loop } = o; return this.add({ travel: routes, ...timing(o), each, hold, loop }); }
  pulse(ids: Ids, o: Timing & { loop?: boolean } = {}): this { return this.add({ pulse: list(ids), ...timing(o), loop: o.loop }); }
  ants(ids: Ids | true = true, o: Timing & { speed?: number; dash?: [number, number] } = {}): this { return this.add({ ants: ids === true ? true : list(ids), ...timing(o), speed: o.speed, dash: o.dash }); }
  draw(routes: Ids, o: Timing & { by?: 'stroke' | 'grow'; stagger?: MotionTime } = {}): this { return this.add({ draw: list(routes), ...timing(o), by: o.by, stagger: o.stagger }); }
  type(ids: Ids, o: Timing = {}): this { return this.add({ type: list(ids), ...timing(o) }); }
  move(id: string, o: { from?: MotionTime; x?: Curve; y?: Curve; scale?: Curve; opacity?: Curve }): this { return this.add({ move: id, ...o }); }
  lift(ids: Ids, by: number, o: Timing & { stagger?: MotionTime; to?: 'up' | 'down'; opacity?: Curve } = {}): this { return this.add({ lift: list(ids), by, ...timing(o), stagger: o.stagger, to: o.to, opacity: o.opacity }); }
  focus(lit: Ids, o: Timing & Omit<Focus, 'lit'> & { fade?: MotionTime } = {}): this { const { scope, level, always } = o; return this.add({ focus: { lit: list(lit), scope, level, always }, ...timing(o), fade: o.fade }); }
  highlight(ids: Ids, o: Timing & { fade?: MotionTime } = {}): this { return this.add({ highlight: list(ids), ...timing(o), fade: o.fade }); }
  /** the view: on a thing, some things or a box; or the whole drawing again */
  get camera(): CameraVerbs<this> {
    return {
      focus: (on, o = {}) => this.add({ camera: { focus: on as string, zoom: o.zoom, margin: o.margin }, ...timing(o) }),
      fit: (o = {}) => this.add({ camera: 'fit', ...timing(o) }),
    };
  }
  /** a sequence in this one: a clock of its own, from `from` */
  sequence(name: string | undefined, o: SequenceOptions = {}, fill?: (b: NodesBuilder) => unknown): this { return this.add({ sequence: sequenceOf(name, o, fill) }); }
  /** sequences one after another */
  series(fill: (s: SeriesBuilder) => unknown): this { const s = new SeriesBuilder(); fill(s); return this.add({ series: s.items }); }
  /** nodes over one another */
  layers(fill: (b: NodesBuilder) => unknown): this { const b = new NodesBuilder(); fill(b); return this.add({ layers: b.nodes }); }
}
function sequenceOf(name: string | undefined, o: SequenceOptions, fill?: (b: NodesBuilder) => unknown): Sequence {
  const { read, duration, ...rest } = o, b = new NodesBuilder();
  fill?.(b);
  return plain({ ...(name === undefined ? {} : { name }), ...rest, ...(read !== undefined ? { duration: { read } } : duration !== undefined ? { duration } : {}), ...(b.nodes.length ? { children: b.nodes } : {}) });
}
export class SeriesBuilder {
  /** @internal */
  readonly items: SeriesItem[] = [];
  sequence(name: string | undefined, o: SequenceOptions = {}, fill?: (b: NodesBuilder) => unknown): this { this.items.push({ sequence: sequenceOf(name, o, fill) }); return this; }
  transition(t: Transition): this { this.items.push({ transition: plain(t) }); return this; }
}
export class MotionBuilder extends SeriesBuilder {
  private over: MotionNode[] = [];
  private marks: Record<string, MotionTime> = {};
  private head: { fps?: number; seed?: number; ambient?: 'on' | 'off' };
  constructor(head: { fps?: number; seed?: number; ambient?: 'on' | 'off' } = {}) { super(); this.head = head; }
  /** a beat: a sequence with commentary */
  beat(name: string, say: Say, o: SequenceOptions = {}, fill?: (b: NodesBuilder) => unknown): this { return this.sequence(name, { ...o, say }, fill); }
  /** the whole drawing arrives (a sequence as long as that takes) */
  assemble(o: Omit<AssembleOptions, 'duration'> = {}, t: Timing = {}): this { return this.sequence(undefined, {}, b => b.assemble(o, t)); }
  /** the whole drawing leaves */
  disassemble(o: Omit<DisassembleOptions, 'duration'> = {}, t: Timing = {}): this { return this.sequence(undefined, {}, b => b.disassemble(o, t)); }
  /** a name for a moment: ms, or "beat+1200" */
  mark(name: string, at: MotionTime): this { this.marks[name] = at; return this; }
  /** nodes over the whole document, on its own clock */
  layers(fill: (b: NodesBuilder) => unknown): this { const b = new NodesBuilder(); fill(b); this.over.push(...b.nodes); return this; }
  toJSON(): MotionDoc {
    return plain({ isomotion: 1 as const, ...this.head, ...(this.items.length ? { series: this.items } : {}), ...(this.over.length ? { layers: this.over } : {}), ...(Object.keys(this.marks).length ? { markers: this.marks } : {}) });
  }
}
/** Start a motion document. */
export const motion = (head: { fps?: number; seed?: number; ambient?: 'on' | 'off' } = {}): MotionBuilder => new MotionBuilder(head);
