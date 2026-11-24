// A Timeline's transport (docs/design/MOTION.md, 6.3): play, pause, seek, rate, loop, the ambient switch, beats, and rebinding to a
// changed document. Headless: no DOM. It is the only place in the motion code that owns a clock, and the clock can be given (tests,
// and hosts with a clock of their own). A Timeline stays a pure function; this says which two times to ask it for.
//
// Two clocks (3.4): T, the timeline's, and A, the ambient one. Playing moves both; paused with the ambient on, A goes on alone (so ants
// march while the story waits); a seek moves both by the same; a restart, or a loop coming round, makes A equal T again. With the
// ambient off A stands through all of it, and on again it carries on from where it stood.

import type { BeatInfo, Cue, Timeline } from '../iso-objects/timeline.ts';
import type { SceneState } from '../iso-objects/motion.ts';

export interface TransportClock {
  /** ms, going only forward */
  now(): number;
  /** call f soon, once: the next frame; returns what cancel takes */
  next(f: () => void): unknown;
  cancel(id: unknown): void;
}
export interface TransportOptions {
  /** start again at the end (default false) */
  loop?: boolean;
  /** how fast (default 1) */
  rate?: number;
  /** default: the document's own */
  ambient?: 'on' | 'off';
  clock?: TransportClock;
}
export interface TransportEvents {
  /** the drawing is to be painted again: T (ms), and why */
  time: (ms: number, why: 'play' | 'ambient' | 'seek' | 'rebind') => void;
  play: () => void;
  pause: () => void;
  /** it came to its end and stopped (not at each turn of a loop: that is 'loop') */
  end: () => void;
  loop: () => void;
  /** a beat begins: each one passed, in order, while playing; the one landed in, after a seek or a rebind. `at`: where in the timeline it starts, ms */
  beat: (beat: BeatInfo, how: 'play' | 'seek' | 'rebind') => void;
  ambient: (on: boolean) => void;
  rate: (rate: number) => void;
}
export interface Transport {
  readonly timeline: Timeline;
  readonly duration: number;
  /** T, ms */
  readonly time: number;
  /** A, ms, or 'off' when it never ran: what at()'s `ambient` takes */
  readonly ambientTime: number | 'off';
  readonly playing: boolean;
  readonly beat: BeatInfo | undefined;
  readonly cue: Cue | undefined;
  rate: number;
  loop: boolean;
  ambient: boolean;
  /** whether the host shows it now (default true): while false neither clock moves, playing or not */
  active: boolean;
  /** what the drawing looks like now */
  state(): SceneState;
  /** until: pause there (a time still ahead) */
  play(o?: { until?: number }): void;
  pause(): void;
  toggle(): void;
  /** join: the ambient clock at that time too (a step taken: what loops starts with it), where the ambient is on */
  seek(ms: number, o?: { join?: boolean }): void;
  /** to a beat's start, by its name or its index; whether there is one */
  seekBeat(beat: string | number): boolean;
  /** to the next beat's start, or the end; to this beat's start, or the one before when nearly there */
  next(): void;
  prev(): void;
  restart(): void;
  /** the document or the drawing changed: the place is kept by beat and how far in it. A Timeline with faults (ok: false) is refused, and the last good one goes on */
  rebind(tl: Timeline): boolean;
  /** returns how to stop listening */
  on<K extends keyof TransportEvents>(event: K, f: TransportEvents[K]): () => void;
  dispose(): void;
}

/** the page's clock: frames, and a timer behind them, so it also goes on where no frames are drawn (a page not shown) */
export function pageClock(): TransportClock {
  const g = globalThis as unknown as { requestAnimationFrame?: (f: () => void) => number; cancelAnimationFrame?: (id: number) => void };
  return {
    now: () => performance.now(),
    next(f) {
      const id: { raf?: number; timer?: ReturnType<typeof setTimeout> } = {};
      const once = () => { if (id.raf !== undefined) g.cancelAnimationFrame?.(id.raf); clearTimeout(id.timer); f(); };
      id.raf = g.requestAnimationFrame?.(once);
      id.timer = setTimeout(once, id.raf === undefined ? 16 : 100);
      return id;
    },
    cancel(id) { const x = id as { raf?: number; timer?: ReturnType<typeof setTimeout> }; if (x.raf !== undefined) g.cancelAnimationFrame?.(x.raf); clearTimeout(x.timer); },
  };
}

/** pressing back this soon after a beat began goes to the one before, ms */
const BACK_WITHIN = 400;

export function transport(tl0: Timeline, o: TransportOptions = {}): Transport {
  const clock = o.clock ?? pageClock();
  let tl = tl0, T = 0, rate = good(o.rate ?? 1), loop = o.loop ?? false, playing = false, active = true, gone = false;
  let on = (o.ambient ?? tl.ambient) === 'on';
  /** A; 'off': never ran */
  let A: number | 'off' = on ? 0 : 'off';
  // turn: counts what a listener may do inside an event (seek, pause, rebind, …), after which that tick's own news is old
  let pending: unknown, last = 0, beat = tl.beatAt(0), told = false, turn = 0, until: number | undefined;
  const subs: { [K in keyof TransportEvents]?: Set<TransportEvents[K]> } = {};

  function good(r: number) { if (!(Number.isFinite(r) && r > 0)) throw new Error('rate is a number over 0'); return r; }
  const clamp = (ms: number) => Math.max(0, Math.min(tl.duration, ms));
  function emit<K extends keyof TransportEvents>(k: K, ...a: Parameters<TransportEvents[K]>) {
    for (const f of [...(subs[k] ?? [])]) (f as (...x: Parameters<TransportEvents[K]>) => void)(...a);
  }
  const moves = () => active && !gone && (playing || (on && tl.loops));
  /** ask for a frame while something moves */
  function arm() {
    if (moves()) { if (pending === undefined) { last = clock.now(); pending = clock.next(tick); } }
    else if (pending !== undefined) { clock.cancel(pending); pending = undefined; }
  }
  /** the beats that begin after `from`, up to `to`: each said once */
  function passed(from: number, to: number) {
    const mine = turn;
    for (const b of tl.beats) {
      if (b.start <= from || b.start > to || b.index === beat?.index) continue;
      beat = b; told = true; emit('beat', b, 'play');
      if (turn !== mine) return false;
    }
    return true;
  }
  function play1(dt: number) {
    if (!playing) { emit('time', T, 'ambient'); return; }
    const was = T, to = T + dt, mine = turn;
    if (until !== undefined && to >= until) {
      T = until;
      if (!passed(was, T)) return;
      until = undefined; playing = false;
      emit('time', T, 'play');
      if (turn === mine) emit('pause');
      return;
    }
    if (to < tl.duration) {
      T = to;
      if (passed(was, T)) emit('time', T, 'play');
      return;
    }
    if (loop) {
      // (the beats left in this turn; whole turns missed while no frames came are not played one by one)
      if (!passed(was, tl.duration)) return;
      T = to % tl.duration;
      if (on) A = T;
      beat = undefined;
      emit('loop');
      if (turn !== mine) return;
      const first = tl.beatAt(0);
      if (first) { beat = first; emit('beat', first, 'play'); if (turn !== mine || !passed(first.start, T)) return; }
      emit('time', T, 'play');
      return;
    }
    T = tl.duration;
    if (!passed(was, T)) return;
    playing = false;
    emit('time', T, 'play');
    if (turn !== mine) return;
    emit('pause');
    if (turn !== mine) return;
    emit('end');
  }
  function tick() {
    pending = undefined;
    const now = clock.now(), dt = Math.max(0, now - last) * rate;
    last = now;
    if (on && A !== 'off') A += dt;
    play1(dt);
    if (pending === undefined) { if (moves()) pending = clock.next(tick); }
  }
  function land(how: 'seek' | 'rebind', again = false) {
    const b = tl.beatAt(T);
    turn++;
    const mine = turn, other = b?.name !== beat?.name || b?.index !== beat?.index;
    beat = b;
    if (b && (other || again)) { told = true; emit('beat', b, how); if (turn !== mine) return; }
    emit('time', T, how);
  }
  function seek(ms: number, o: { join?: boolean } = {}) {
    if (gone || !Number.isFinite(ms)) return;
    const to = clamp(ms);
    if (on && A !== 'off') A = o.join ? to : A + to - T;
    T = to; last = clock.now();
    if (until !== undefined && T >= until) until = undefined;
    land('seek');
    arm();
  }
  function restart() {
    if (gone) return;
    T = 0; if (on) A = 0;
    until = undefined;
    last = clock.now();
    land('seek', true);
    arm();
  }
  const api: Transport = {
    get timeline() { return tl; },
    get duration() { return tl.duration; },
    get time() { return T; },
    get ambientTime() { return A; },
    get playing() { return playing; },
    get beat() { return beat; },
    get cue() { return tl.cues(T); },
    get rate() { return rate; },
    set rate(r) { const v = good(r); if (v === rate) return; rate = v; emit('rate', v); },
    get loop() { return loop; },
    set loop(v) { loop = v; },
    get ambient() { return on; },
    set ambient(v) {
      if (gone || v === on) return;
      on = v;
      // never ran: it starts where this beat's loops stand, at their start
      if (on && A === 'off') A = beat?.start ?? 0;
      arm();
      emit('ambient', on);
      emit('time', T, 'ambient');
    },
    get active() { return active; },
    set active(v) { if (v === active) return; active = v; arm(); },
    state: () => tl.at(T, { ambient: A }),
    play(p = {}) {
      if (gone || playing || tl.duration <= 0) return;
      if (T >= tl.duration && p.until === undefined) restart();
      until = p.until !== undefined && p.until > T && p.until <= tl.duration ? p.until : undefined;
      if (p.until !== undefined && until === undefined) return;
      playing = true; last = clock.now();
      arm();
      emit('play');
      // the beat it starts in, if nobody has been told of it
      if (playing && !told && beat) { told = true; emit('beat', beat, 'play'); }
    },
    pause() { if (!playing) return; playing = false; until = undefined; turn++; arm(); emit('pause'); },
    toggle() { if (playing) api.pause(); else api.play(); },
    seek,
    seekBeat(b) {
      const ms = typeof b === 'number' ? tl.beats[b]?.start : tl.beats.find(x => x.name === b)?.start;
      if (ms === undefined) return false;
      seek(ms);
      return true;
    },
    next() { const n = tl.beats.find(b => b.start > T); seek(n ? n.start : tl.duration); },
    prev() { const back = [...tl.beats].reverse().find(b => b.start < T - BACK_WITHIN); seek(back ? back.start : 0); },
    restart,
    rebind(next) {
      if (gone || !next.ok) return false;
      until = undefined;
      const was = tl.beatAt(T), frac = was ? (T - was.start) / Math.max(1, was.end - was.start) : 0, d = A === 'off' ? 0 : A - T, before = tl;
      tl = next;
      if (was) {
        const same = next.beats.find(b => b.name === was.name);
        if (same) T = same.start + frac * (same.end - same.start);
        else {
          // it went away: the nearest before it that is still there, at its end
          const near = before.beats.filter(b => b.index < was.index).reverse().map(b => next.beats.find(x => x.name === b.name)).find(Boolean);
          T = near ? near.start : 0;
        }
      }
      T = clamp(T);
      if (on && A !== 'off') A = T + d;
      last = clock.now();
      land('rebind');
      arm();
      return true;
    },
    on(k, f) { const set = (subs[k] ??= new Set() as never) as Set<typeof f>; set.add(f); return () => { set.delete(f); }; },
    dispose() { gone = true; turn++; playing = false; if (pending !== undefined) clock.cancel(pending); pending = undefined; for (const k of Object.keys(subs) as (keyof TransportEvents)[]) subs[k]!.clear(); },
  };
  arm();
  return api;
}
