// Motion for the overlay's cards, with effects to choose from. The overlay draws each card still; this moves the drawn
// cards and never changes what is drawn: an effect ends with the card exactly as the still drawing.
//   - appear / disappear: scale (from and to nothing), spin (expand or shrink while turning about the card's own
//     vertical axis, in 3D), dissolve (a fade with a slight blur), inflate (a spring past full size; disappear deflates);
//   - idle while showing: none, jiggle, pirouette (a windup, a hop, one full 3D turn, a landing), glow (the amber edge on
//     a slow period), breathe (a slow scale in and out); a card open ten minutes or more (still) keeps still.
// Spins are real 3D: the card's corners turned about its vertical axis and projected again each frame (the canvas's
// spin()); the tail stays on what the card is anchored to. Everything else is the Web Animations API on the card's
// group, its origin at the tail's tip, so a card grows out of its anchor. Idle effects are staggered by the card's key,
// on the document's clock, so a card redrawn (its text changed) keeps its phase. Off: nothing moves, at all.
// The cards' class and attribute names are the domain's (CardNames): this module names none.

export type Appear = 'scale' | 'spin' | 'dissolve' | 'inflate';
export type Idle = 'none' | 'jiggle' | 'pirouette' | 'glow' | 'breathe';
export interface MotionSettings { enabled: boolean; appear: Appear; idle: Idle }
export const APPEARS: [Appear, string][] = [['scale', 'Scale'], ['spin', 'Spin'], ['dissolve', 'Dissolve'], ['inflate', 'Inflate']];
export const IDLES: [Idle, string][] = [['none', 'None'], ['jiggle', 'Jiggle'], ['pirouette', 'Pirouette'], ['glow', 'Glow'], ['breathe', 'Breathe']];

/** the domain's cards: their class prefix, as the overlay draws them (PREFIX-float, a card that has gone PREFIX-leaving,
 *  in the PREFIX-leaving-layer), and the attributes a card's key is read from: key, else alt (removed when it goes) */
export interface CardNames { prefix: string; key: string; alt: string }

export interface MotionHost {
  /** turn a card about its vertical axis (radians), lifted (cells): its faces drawn again */
  spin(card: SVGGElement, theta: number, lift: number): void;
  /** the card as drawn still again */
  restore(card: SVGGElement): void;
  /** where a card that has gone may finish going (outside the state layer, which is reconciled) */
  leavingLayer(): SVGGElement | undefined;
  /** the amber of the cards' edge */
  amber(): string;
}

/** a stable offset in [0, 1) from an id: cards don't move in unison */
function phaseOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}
const ease = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : 1 - Math.pow(1 - t, 3));
const easeIn = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t * t * t);
const TAU = Math.PI * 2;

/** the timings, in ms (divided by speed, for the tests) */
const T = { appear: { scale: 420, spin: 760, dissolve: 520, inflate: 640 }, disappear: { scale: 320, spin: 600, dissolve: 420, inflate: 420 },
  period: { jiggle: 4200, pirouette: 6400, glow: 3200, breathe: 4400 } };
/** pirouette: windup, then hop and one turn, then landing (ms into its period) */
const PIR = { windup: 220, turn: 980, land: 260 };

interface Job { card: SVGGElement; start: number; dur: number; frame(t: number): { theta: number; lift: number; scale: number }; done?(): void; repeat?: number; offset?: number }

export function cardMotion(host: MotionHost, initial: MotionSettings, { prefix, key, alt }: CardNames) {
  let s = { ...initial };
  let speed = 1;
  const jobs = new Map<SVGGElement, Job>();
  const turned = new WeakSet<SVGGElement>();
  let raf = 0, frames = 0;
  const idleAnims = new WeakMap<SVGGElement, Animation>();
  /** each turning card's last frame (for the tests: the model the drawing must equal) */
  const last = new WeakMap<SVGGElement, { theta: number; lift: number; scale: number }>();

  // ---------- the spin loop (rAF): only while a job wants it ----------
  function tick(now: number) {
    raf = 0;
    for (const [card, j] of jobs) {
      if (!card.isConnected) { jobs.delete(card); continue; }
      let t: number;
      if (j.repeat) {
        // a repeating idle job (pirouette): where it is in its period, on the document's clock
        const p = ((now + (j.offset ?? 0)) % j.repeat);
        t = p / j.dur;
        if (t > 1) { if (turned.has(card)) { host.restore(card); turned.delete(card); card.style.removeProperty('transform'); } continue; }
      } else {
        t = (now - j.start) / j.dur;
        if (t >= 1) { finish(card, j); continue; }
      }
      const f = j.frame(Math.max(0, t));
      host.spin(card, f.theta, f.lift); turned.add(card); last.set(card, f);
      if (f.scale !== 1) card.style.transform = `scale(${f.scale.toFixed(4)})`; else card.style.removeProperty('transform');
      frames++;
    }
    if (jobs.size) raf = requestAnimationFrame(tick);
  }
  function finish(card: SVGGElement, j: Job) {
    jobs.delete(card);
    if (turned.has(card)) { host.restore(card); turned.delete(card); }
    card.style.removeProperty('transform');
    j.done?.();
  }
  function run(j: Job) {
    const old = jobs.get(j.card);
    if (old) finish(j.card, old);
    jobs.set(j.card, j);
    if (!raf) raf = requestAnimationFrame(tick);
  }

  // ---------- appear and disappear ----------
  /** at most this many appear or disappear effects at once (Monkey at 10×): past it, a card comes or goes at once */
  const MAX_EFFECTS = 8;
  let effects = 0;
  const counted = <T>(p: Promise<T>) => { effects++; return p.finally(() => { effects--; }); };
  function appear(card: SVGGElement): Promise<void> {
    if (!s.enabled || effects >= MAX_EFFECTS) return Promise.resolve();
    return counted(appearNow(card));
  }
  function disappear(card: SVGGElement): Promise<void> {
    if (!s.enabled || effects >= MAX_EFFECTS) return Promise.resolve();
    return counted(disappearNow(card));
  }
  function appearNow(card: SVGGElement): Promise<void> {
    const d = T.appear[s.appear] / speed;
    if (s.appear === 'spin') {
      return new Promise(res => run({ card, start: performance.now(), dur: d, frame: t => ({ theta: (1 - ease(t)) * TAU, lift: 0, scale: Math.max(0.001, ease(t)) }), done: res }));
    }
    const kf: Keyframe[] = s.appear === 'scale' ? [{ transform: 'scale(0)' }, { transform: 'scale(1)' }]
      : s.appear === 'dissolve' ? [{ opacity: 0, filter: 'blur(4px)' }, { opacity: 1, filter: 'blur(0px)' }]
        : [{ transform: 'scale(0)', easing: 'cubic-bezier(.3,0,.4,1)' }, { transform: 'scale(1.16)', offset: 0.55, easing: 'ease-in-out' }, { transform: 'scale(.95)', offset: 0.78, easing: 'ease-in-out' }, { transform: 'scale(1)' }];
    const a = card.animate(kf, { duration: d, easing: s.appear === 'inflate' ? 'linear' : 'ease-out' });
    return a.finished.then(() => undefined, () => undefined);
  }
  function disappearNow(card: SVGGElement): Promise<void> {
    const d = T.disappear[s.appear] / speed;
    if (s.appear === 'spin') {
      return new Promise(res => run({ card, start: performance.now(), dur: d, frame: t => ({ theta: easeIn(t) * TAU, lift: 0, scale: Math.max(0.001, 1 - easeIn(t)) }), done: () => { card.style.transform = 'scale(0)'; res(); } }));
    }
    const kf: Keyframe[] = s.appear === 'scale' ? [{ transform: 'scale(1)' }, { transform: 'scale(0)' }]
      : s.appear === 'dissolve' ? [{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(4px)' }]
        : [{ transform: 'scale(1)' }, { transform: 'scale(1.08)', offset: 0.3 }, { transform: 'scale(0)' }];
    const a = card.animate(kf, { duration: d, easing: 'ease-in', fill: 'forwards' });
    return a.finished.then(() => undefined, () => undefined);
  }

  // ---------- idle ----------
  function stopIdle(card: SVGGElement) {
    idleAnims.get(card)?.cancel(); idleAnims.delete(card);
    const j = jobs.get(card);
    if (j?.repeat) finish(card, j);
  }
  /** start the idle effect, at the card's own phase (period: a shorter one for Preview) */
  function startIdle(card: SVGGElement, period?: number) {
    stopIdle(card);
    if (!s.enabled || s.idle === 'none' || card.classList.contains('still')) return;
    const id = card.getAttribute(key) ?? card.getAttribute(alt) ?? '';
    const P = (period ?? T.period[s.idle]) / speed, off = phaseOf(id) * P;
    if (s.idle === 'pirouette') {
      const dur = (PIR.windup + PIR.turn + PIR.land) / speed;
      const w = PIR.windup / (PIR.windup + PIR.turn + PIR.land), l = (PIR.windup + PIR.turn) / (PIR.windup + PIR.turn + PIR.land);
      run({ card, start: 0, dur, repeat: P, offset: off, frame: t => {
        if (t < w) return { theta: -0.35 * Math.sin((t / w) * Math.PI / 2), lift: 0, scale: 1 };
        if (t < l) { const u = (t - w) / (l - w); return { theta: -0.35 * (1 - u) + ease(u) * TAU, lift: 0.9 * Math.sin(u * Math.PI), scale: 1 }; }
        const u = (t - l) / (1 - l); return { theta: 0, lift: 0, scale: 1 - 0.04 * Math.sin(u * Math.PI) };
      } });
      return;
    }
    const float = card.querySelector<SVGGElement>(`.${prefix}-float`) ?? card;
    const amber = host.amber();
    const kf: Keyframe[] = s.idle === 'jiggle'
      ? [{ transform: 'scale(1)', offset: 0 }, { transform: 'scale(1.07)', offset: 0.04 }, { transform: 'scale(.97)', offset: 0.08 }, { transform: 'scale(1.02)', offset: 0.11 }, { transform: 'scale(1)', offset: 0.14 }, { transform: 'scale(1)', offset: 1 }]
      : s.idle === 'glow' ? [{ filter: `drop-shadow(0 0 0px ${amber})` }, { filter: `drop-shadow(0 0 7px ${amber})` }, { filter: `drop-shadow(0 0 0px ${amber})` }]
        : [{ transform: 'scale(1)' }, { transform: 'scale(1.035)' }, { transform: 'scale(1)' }];
    const a = float.animate(kf, { duration: P, iterations: Infinity, easing: s.idle === 'jiggle' ? 'linear' : 'ease-in-out' });
    // on the document's clock: the same card (or its redrawing) is always at the same point of its cycle
    a.startTime = (document.timeline.currentTime as number ?? 0) - (((document.timeline.currentTime as number ?? 0) + off) % P);
    idleAnims.set(card, a);
  }

  // ---------- after each repaint of the state layer ----------
  /** prev and cur: the cards by key before and after; gone: the keys whose cards went, and whether each expired */
  function update(prev: Map<string, SVGGElement>, cur: Map<string, SVGGElement>, gone: Map<string, boolean>, animateOut: boolean, still = false) {
    // still (O8b: a scrub, a step back): what appears or goes does so at once
    if (still) animateOut = false;
    for (const [from, card] of cur) {
      if (!prev.has(from) && !still) void appear(card);
      if (!idleAnims.has(card) && !jobs.get(card)?.repeat) startIdle(card);
    }
    if (!s.enabled || !animateOut) return;
    const layer = host.leavingLayer();
    if (!layer) return;
    for (const [from, expired] of gone) {
      const old = prev.get(from);
      if (!old || cur.has(from)) continue;
      // the drawn card, kept a moment where it was, then gone by the chosen effect
      stopIdle(old);
      old.setAttribute('class', `${prefix}-leaving${expired ? ' expired' : ''}`);
      old.removeAttribute(alt);
      layer.append(old);
      void disappear(old).then(() => old.remove());
    }
  }

  /** stop everything now: off, or the layer cleared */
  function stopAll(root: ParentNode | undefined) {
    for (const [card, j] of [...jobs]) finish(card, j);
    if (raf) cancelAnimationFrame(raf); raf = 0;
    for (const a of document.getAnimations()) {
      const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
      if (t?.closest?.(`.live-layer, .${prefix}-leaving-layer`)) a.cancel();
    }
    host.leavingLayer()?.replaceChildren();
    void root;
  }

  return {
    get settings() { return { ...s }; },
    set(next: Partial<MotionSettings>, cards: Iterable<SVGGElement>) {
      const was = s; s = { ...s, ...next };
      if (!s.enabled || was.idle !== s.idle || was.enabled !== s.enabled) {
        stopAll(undefined);
        if (s.enabled) for (const c of cards) startIdle(c);
      }
    },
    update, appear, disappear, startIdle, stopIdle, stopAll,
    /** Preview: on each card, appear, then a few idle cycles, then disappear, then back as it was (still) and idling */
    async preview(cards: SVGGElement[]) {
      if (!s.enabled) return;
      await Promise.all(cards.map(async c => {
        stopIdle(c);
        await appear(c);
        if (s.idle !== 'none' && !c.classList.contains('still')) {
          const P = s.idle === 'pirouette' ? 1800 : 1400;
          startIdle(c, P);
          await new Promise(r => setTimeout(r, (P * 2.2) / speed));
          stopIdle(c);
        } else await new Promise(r => setTimeout(r, 700 / speed));
        await disappear(c);
        for (const a of c.getAnimations()) a.cancel();
        c.style.removeProperty('transform');
        startIdle(c);
      }));
    },
    /** for the tests */
    get stats() { return { jobs: jobs.size, raf: !!raf, frames, effects }; },
    setSpeed(n: number) { speed = n; },
    lastFrame: (card: SVGGElement) => last.get(card),
  };
}
export type CardMotion = ReturnType<typeof cardMotion>;
