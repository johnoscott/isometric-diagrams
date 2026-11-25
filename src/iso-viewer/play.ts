// The player (docs/design/MOTION.md, 6.2): a skin over a transport. The drawing, play and pause, back and next, the beats as dots by
// chapter, a scrubber, the commentary with its facts, the ambient switch, a text list of the beats. It owns no clock (transport.ts does)
// and draws nothing of its own: what shows is paint(svg, timeline.at(…)). Built as DOM (no HTML text but the commentary's own small
// Markdown, escaped), no style attributes, no storage, nothing fetched, so it runs under a strict CSP; its stylesheet is the host's to add
// (PLAY_CSS, in a page or a shadow root). The drawing is a self-contained one (compile's resolveVars), so no theme's CSS is needed.

import { paint, type SceneState } from '../iso-objects/motion.ts';
import type { CompiledScene } from '../iso-objects/compile.ts';
import type { BeatInfo, Timeline } from '../iso-objects/timeline.ts';
import { h } from './dom.ts';
import { md } from './page.ts';
import { FITTED, MAX_TIMES, readerOn, readerPan, readerView, readerZoom, type Reader } from './zoom.ts';
import { transport, type Transport, type TransportClock } from './transport.ts';

/** what is played: a drawing, painted as the timeline says; or one that paints itself, at each time asked (in any order), as two drawings
 *  being compared do. What it changes is its own to put back */
export type Played = Pick<CompiledScene, 'rendered' | 'id'> & { paint?(svg: SVGSVGElement, ms: number): void };
export interface PlayerOptions {
  scene: Played;
  /** none: the drawing alone, with nothing to play */
  timeline?: Timeline;
  /** what a screen reader calls it */
  label?: string;
  /** the controls and the commentary (default true): without them, the drawing alone */
  controls?: boolean;
  /** start at once, or each time most of it is in view (default: neither) */
  autoplay?: boolean | 'visible';
  loop?: boolean;
  rate?: number;
  ambient?: 'on' | 'off';
  /** a reader who asked for less motion (default 'ignore': motion plays, and they get a Motion off button). 'respect': the last state, everything lit, the ambient off, until they press Play */
  reducedMotion?: 'ignore' | 'respect';
  mode?: 'light' | 'dark';
  /** the timeline is the drawing's own steps (motionOfSteps): its callouts and marks show at their step, and the other steps' numbers dim */
  steps?: boolean;
  /** a reader may zoom and pan (default false): the wheel with ⌘ or Ctrl (in a dialog: the wheel), two fingers, a drag once it is closer, + − 0, and three buttons */
  zoom?: boolean;
  clock?: TransportClock;
}
export interface Player {
  readonly root: HTMLElement;
  readonly transport: Transport;
  /** another drawing, or another document: the place is kept (transport's rebind). Faults are refused, and what plays goes on */
  set(scene: Played, timeline?: Timeline, mode?: 'light' | 'dark'): boolean;
  /** show one moment, still: no clock, no controls (a screenshot, a link) */
  freeze(ms: number): void;
  /** to a beat and through it, stopping before the next */
  step(beat: number): void;
  dispose(): void;
}

/** which of the page's players plays: the one most in view (an autoplaying one that is not stops) */
const mounted = new Map<HTMLElement, { seen: number; auto(on: boolean): void; wants: boolean }>();
function pick() {
  let best: HTMLElement | undefined, most = 0.35;
  // one in an open dialog covers the rest: it, and nothing behind it
  for (const el of mounted.keys()) if (el.closest('dialog[open]')) best = el;
  if (best) { for (const [el, m] of mounted) if (m.wants) m.auto(el === best); return; }
  for (const [el, m] of mounted) if (m.wants && m.seen >= most && (m.seen > most || !best)) { best = el; most = m.seen; }
  for (const [el, m] of mounted) if (m.wants) m.auto(el === best);
}

/** the hint, once a page */
let hinted = false;

/** a player was put somewhere else on the page: which plays may be another */
export const playersMoved = (): void => pick();

const svgOf = (text: string): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.documentElement.localName !== 'svg') throw new Error('the drawing is not SVG');
  return document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
};
const clockText = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** a drawing with nothing to play */
const NOTHING: Timeline = { ok: true, diags: [], duration: 0, beats: [], markers: {}, ambient: 'on', loops: false, at: () => ({}), cues: () => undefined, beatAt: () => undefined, startOf: () => undefined };
/** everything still hidden stays hidden; what is only dimmed is lit */
function lit(S: SceneState): SceneState {
  const out: SceneState = { ...(S.camera ? { camera: S.camera } : {}), ...(S.variants ? { variants: S.variants } : {}) };
  for (const k of ['items', 'labels', 'routes'] as const) {
    const gone = Object.entries(S[k] ?? {}).filter(([, v]) => v.opacity === 0).map(([id]) => [id, { opacity: 0 }]);
    if (gone.length) out[k] = Object.fromEntries(gone);
  }
  return out;
}

export function mountPlayer(host: HTMLElement | ShadowRoot, o: PlayerOptions): Player {
  if (o.timeline && !o.timeline.ok) throw new Error(`the motion has faults: ${o.timeline.diags.map(d => `${d.path}: ${d.message}`).join('; ')}`);
  let scene = o.scene, svg = svgOf(scene.rendered.svg), frozen: number | undefined, stepTo: number | undefined, userPaused = false, gone = false;
  const tr = transport(o.timeline ?? NOTHING, { loop: o.loop, rate: o.rate, ambient: o.ambient, clock: o.clock });
  // off means off, whoever asks: the host's play() and toggle() too, which leave it as it is
  const go = tr.play;
  tr.play = p => { if (!off) go(p); };
  const controls = o.controls ?? true;
  const asked = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, calm = asked && o.reducedMotion === 'respect';
  /** off: the reader pressed Motion off, and nothing moves, whoever asks it to */
  let resting = calm, off = false, inView = true;

  // ---- the parts ----
  const btn = (cls: string, label: string, text: string, f: () => void) => h('button', { type: 'button', class: `iso-play-btn ${cls}`, 'aria-label': label, title: label, on: { click: f as EventListener } }, text);
  const stage = h('div', { class: 'iso-play-stage' }, svg as unknown as Node);
  const back = btn('back', 'Back', '‹', () => byHand(() => step(Math.max(0, at() - 1))));
  const play = btn('play', 'Play', '▶', () => toggle());
  const next = btn('next', 'Next', '›', () => byHand(() => step(Math.min(tr.timeline.beats.length - 1, at() + 1))));
  const again = btn('again', 'Reset', '↺', () => byHand(() => { stop(); if (off) tr.seek(0); else tr.restart(); }));
  const amb = btn('ambient', 'Ambient motion', '∿', () => { wake(); tr.ambient = !tr.ambient; show(); });
  // a reader who asked their machine for less motion: it plays, as for anybody, and they get this (docs/design/MOTION.md, 6.2)
  const still = btn('still', 'Motion off', 'Motion off', () => setOff(!off));
  still.title = 'Draw everything in place, with nothing moving';
  const bar = h('input', { type: 'range', class: 'iso-play-bar', min: 0, step: 1, 'aria-label': 'Time', on: { input: (() => byHand(() => { stop(); tr.seek(Number(bar.value)); })) as EventListener } });
  const time = h('span', { class: 'iso-play-time' });
  const dots = h('div', { class: 'iso-play-dots' });
  const num = h('span', { class: 'iso-play-num' }), title = h('span', { class: 'iso-play-title' }), chapter = h('span', { class: 'iso-play-chapter' }), count = h('span', { class: 'iso-play-count' });
  const text = h('div', { class: 'iso-play-text' }), code = h('pre', { class: 'iso-play-code' }), facts = h('dl', { class: 'iso-play-facts' });
  const say = h('div', { class: 'iso-play-say', 'aria-live': 'polite' }, h('div', { class: 'iso-play-head' }, num, title, chapter, count), text, code, facts);
  const list = h('details', { class: 'iso-play-list' });
  const row = h('div', { class: 'iso-play-row' }, back, play, next, again, amb, still, bar, time), alone = h('div', { class: 'iso-play-row' });
  const root = h('div', { class: 'iso-play', role: 'group', 'aria-roledescription': 'animated diagram', 'aria-label': o.label ?? 'Diagram', tabindex: controls || o.zoom ? 0 : undefined, 'data-mode': o.mode ?? 'light' },
    stage, controls ? row : alone, controls && dots, controls && say, controls && list);
  host.append(root);

  // ---- the reader's own zoom: on top of what the drawing shows ----
  let close: Reader = FITTED, aimed = false, own = svg.getAttribute('viewBox') ?? '', under = scene.rendered.viewBox as [number, number, number, number];
  const zoomOut = btn('z-out', 'Zoom out', '−', () => zoomBy(0.8)), zoomIn = btn('z-in', 'Zoom in', '+', () => zoomBy(1.25)), zoomFit = btn('z-fit', 'Fit', 'Fit', () => setClose(FITTED));
  const zooms = h('div', { class: 'iso-zoom', role: 'group', 'aria-label': 'Zoom' }, zoomOut, zoomIn, zoomFit), hint = h('div', { class: 'iso-zoom-hint', 'aria-hidden': 'true' });
  const size = () => { const r = svg.getBoundingClientRect(); return { w: Math.max(1, r.width), h: Math.max(1, r.height) }; };
  const inDialog = () => !!root.closest('dialog[open]');
  /** after a paint: the view, closer */
  function aim(S: SceneState) {
    under = S.camera ?? (scene.rendered.viewBox as [number, number, number, number]);
    if (close.times > 1) { close = readerOn(under, size(), close); svg.setAttribute('viewBox', readerView(under, size(), close).map(v => String(Math.round(v * 100) / 100)).join(' ')); aimed = true; }
    zoomFit.hidden = close.times <= 1; zoomOut.disabled = close.times <= 1; zoomIn.disabled = close.times >= MAX_TIMES;
    root.classList.toggle('closer', close.times > 1);
  }
  function setClose(r: Reader) {
    if (!o.zoom || gone || frozen !== undefined) return;
    const on = [zoomOut, zoomIn, zoomFit].find(b => b === (root.getRootNode() as Document | ShadowRoot).activeElement);
    close = r; show();
    // (Fit has gone, or − or + can do no more: the focus is the drawing's)
    if (on && (on.hidden || on.disabled)) root.focus({ preventScroll: true });
  }
  function zoomBy(f: number, x?: number, y?: number) {
    const r = svg.getBoundingClientRect();
    setClose(readerZoom(under, size(), close, f, x === undefined ? undefined : x - r.left, y === undefined ? undefined : y - r.top));
  }
  const panFor = (dx: number, dy: number) => setClose(readerPan(under, size(), close, dx, dy));
  if (o.zoom) {
    stage.append(zooms, hint);
    root.classList.add('zooms');
    let off: ReturnType<typeof setTimeout> | undefined, fingers = false;
    stage.addEventListener('wheel', e => {
      if (frozen !== undefined) return;
      if (!(e.ctrlKey || e.metaKey || inDialog())) {
        // the page scrolls, as anywhere; once, how to zoom
        if (hinted || close.times > 1) return;
        hinted = true;
        hint.textContent = `${/Mac|iP/.test(navigator.platform) ? '⌘' : 'Ctrl'} + scroll to zoom`;
        hint.classList.add('on');
        off = setTimeout(() => hint.classList.remove('on'), 1800);
        return;
      }
      e.preventDefault();
      clearTimeout(off); hint.classList.remove('on');
      // (a trackpad's pinch comes as a Ctrl wheel of small steps, a mouse wheel's as one of about 100)
      const d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1), by = e.ctrlKey && !e.metaKey ? 0.01 : 0.0025, most = 0.25 / by;
      zoomBy(Math.exp(-Math.max(-most, Math.min(most, d)) * by), e.clientX, e.clientY);
    }, { passive: false });
    // a mouse or a pen: a drag once it is closer, after a few px, so that a click is still one
    let drag: { id: number; x: number; y: number; on: boolean } | undefined;
    const isButton = (t: EventTarget | null) => !!(t as Element).closest?.('.iso-zoom');
    stage.addEventListener('pointerdown', e => { if (e.pointerType !== 'touch' && e.button === 0 && close.times > 1 && !isButton(e.target)) drag = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false }; });
    stage.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.on) { if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return; drag.on = true; stage.setPointerCapture(e.pointerId); root.classList.add('dragging'); }
      panFor(e.clientX - drag.x, e.clientY - drag.y);
      drag.x = e.clientX; drag.y = e.clientY;
    });
    let dragged = false;
    const drop = () => { dragged = !!drag?.on; drag = undefined; root.classList.remove('dragging'); if (dragged) setTimeout(() => { dragged = false; }, 0); };
    stage.addEventListener('pointerup', drop); stage.addEventListener('pointercancel', drop);
    // the click a drag ends with isn't one on what is under it
    stage.addEventListener('click', e => { if (dragged) { dragged = false; e.stopPropagation(); e.preventDefault(); } }, true);
    stage.addEventListener('dblclick', e => { if (close.times > 1 && !isButton(e.target)) { e.preventDefault(); setClose(FITTED); } });
    // fingers: one scrolls the page, or in a dialog moves what is closer; two zoom and move
    let was: { x: number; y: number; d: number } | undefined;
    const read = (t: TouchList) => { const a = t[0], b = t[1] ?? t[0]; return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) }; };
    const mine = (t: TouchList) => frozen === undefined && (t.length === 2 || (t.length === 1 && inDialog() && close.times > 1));
    const begin = (e: TouchEvent) => { fingers = e.touches.length > 0; was = mine(e.touches) && !isButton(e.target) ? read(e.touches) : undefined; if (was && e.touches.length === 2 && e.cancelable) e.preventDefault(); };
    stage.addEventListener('touchstart', begin, { passive: false });
    stage.addEventListener('touchmove', e => {
      if (!was || !mine(e.touches)) return;
      if (e.cancelable) e.preventDefault();
      const now = read(e.touches);
      panFor(now.x - was.x, now.y - was.y);
      if (e.touches.length === 2 && was.d > 0 && now.d > 0) zoomBy(now.d / was.d, now.x, now.y);
      was = now;
    }, { passive: false });
    stage.addEventListener('touchend', begin); stage.addEventListener('touchcancel', begin);
    // Safari's trackpad pinch is an event of its own (on a touch screen it comes beside the fingers', which have it already)
    let pinch = 1;
    stage.addEventListener('gesturestart', e => { e.preventDefault(); pinch = 1; });
    stage.addEventListener('gesturechange', e => { e.preventDefault(); const g = e as Event & { scale: number; clientX: number; clientY: number }; if (!fingers && g.scale > 0) { zoomBy(g.scale / pinch, g.clientX, g.clientY); pinch = g.scale; } });
  }
  // (after its turn, not in it: what it draws may change its own size, which a page hears as an error)
  const sized = o.zoom && typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (close.times > 1) setTimeout(() => { if (close.times > 1 && !gone) show(); }, 0); }) : undefined;
  sized?.observe(stage);

  // ---- what there is to show: the beats ----
  let dotOf: HTMLButtonElement[] = [];
  function beats() {
    const all = tr.timeline.beats, some = all.length > 0, said = all.some(b => b.say);
    dotOf = [];
    dots.replaceChildren();
    let group: HTMLElement | undefined, last: string | undefined;
    for (const b of all) {
      if (!group || b.say?.chapter !== last) { group = h('span', { class: 'iso-play-group', role: 'group', 'aria-label': b.say?.chapter, title: b.say?.chapter }); dots.append(group); last = b.say?.chapter; }
      const d = h('button', { type: 'button', class: 'iso-play-dot', 'aria-label': `Step ${b.index + 1}: ${b.say?.title ?? b.name}`, title: b.say?.title ?? b.name, on: { click: (() => byHand(() => step(b.index))) as EventListener } });
      group.append(d); dotOf.push(d);
    }
    list.replaceChildren(h('summary', null, `All ${all.length} steps as text`), h('ol', null, ...all.map(b => h('li', null, ...words(b)))));
    for (const el of [back, next, dots]) el.hidden = !some;
    say.hidden = !said; list.hidden = !said;
    amb.hidden = !tr.timeline.loops;
    still.hidden = !asked || calm || (tr.duration <= 0 && !tr.timeline.loops) || (!controls && !o.autoplay && !tr.timeline.loops && !scene.paint);
    alone.hidden = still.hidden;
    if (!controls && !still.hidden) alone.append(still);
    bar.max = String(Math.round(tr.duration));
    for (const el of [play, again, bar, time]) el.hidden = tr.duration <= 0;
    told = undefined;
  }
  function words(b: BeatInfo): Node[] {
    const s = b.say, out: Node[] = [h('b', null, s?.title ?? b.name)];
    if (s?.text) { const p = h('div', null); p.innerHTML = md(s.text); out.push(p); }
    if (s?.code) out.push(h('code', null, s.code));
    if (s?.facts?.length) out.push(h('span', null, s.facts.map(([k, v]) => `${k}: ${v}`).join(' · ')));
    return out;
  }
  let told: BeatInfo | undefined;
  /** what is drawn for one step alone: the rest of it is the Timeline's */
  function marks(b: BeatInfo | undefined) {
    const n = String((b?.index ?? -1) + 1);
    for (const e of svg.querySelectorAll('[data-badge]')) {
      e.classList.toggle('on', e.getAttribute('data-badge') === n);
      if (o.steps) { if (e.getAttribute('data-badge') === n || resting) e.removeAttribute('opacity'); else e.setAttribute('opacity', '0.14'); }
    }
    if (o.steps) for (const e of svg.querySelectorAll('[data-step]')) e.setAttribute('visibility', e.getAttribute('data-step') === n && !resting ? 'visible' : 'hidden');
  }
  function caption() {
    const b = tr.beat;
    if (b === told) return;
    told = b;
    marks(b);
    if (!controls) return;
    const s = b?.say;
    num.textContent = b ? String(b.index + 1) : '';
    num.style.backgroundColor = s?.color ?? '';
    title.textContent = s?.title ?? b?.name ?? '';
    chapter.textContent = s?.chapter ?? '';
    count.textContent = b ? `${b.index + 1} / ${tr.timeline.beats.length}` : '';
    text.innerHTML = md(s?.text);
    code.textContent = s?.code ?? '';
    facts.replaceChildren(...(s?.facts ?? []).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
    code.hidden = !s?.code; facts.hidden = !s?.facts?.length;
    dotOf.forEach((d, i) => { d.classList.toggle('on', i === b?.index); d.classList.toggle('done', b !== undefined && i < b.index); if (i === b?.index) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current'); });
  }
  function show() {
    const S = frozen !== undefined ? tr.timeline.at(frozen, { ambient: frozen }) : resting ? lit(tr.timeline.at(tr.duration, { ambient: 'off' })) : off ? tr.timeline.at(tr.time, { ambient: 'off' }) : tr.state();
    if (aimed) { svg.setAttribute('viewBox', own); aimed = false; }
    if (scene.paint) scene.paint(svg, frozen ?? (resting ? tr.duration : tr.time)); else paint(svg, S, scene.rendered, { styles: 'cssom' });
    aim(S);
    root.dataset.time = String(Math.round(frozen ?? tr.time));
    if (frozen !== undefined) marks(tr.timeline.beatAt(frozen)); else caption();
    if (!controls) return;
    bar.value = String(Math.round(tr.time));
    bar.setAttribute('aria-valuetext', `${clockText(tr.time)} of ${clockText(tr.duration)}${tr.beat ? `, ${tr.beat.say?.title ?? tr.beat.name}` : ''}`);
    time.textContent = `${clockText(tr.time)} / ${clockText(tr.duration)}`;
  }
  function buttons() {
    const on = going();
    play.textContent = on ? '❚❚' : '▶';
    play.setAttribute('aria-label', on ? 'Pause' : 'Play'); play.title = on ? 'Pause' : 'Play';
    amb.setAttribute('aria-pressed', String(tr.ambient));
    say.setAttribute('aria-live', on ? 'off' : 'polite');
    root.dataset.playing = String(on);
    still.setAttribute('aria-pressed', String(off));
    play.disabled = off; amb.disabled = off;
  }

  // ---- playing ----
  /** playing on and on, not only through one step */
  const going = () => tr.playing && stepTo === undefined;
  const at = () => tr.beat?.index ?? 0;
  /** a reader who asked for less motion has asked for some */
  function wake() { if (resting) { resting = false; told = undefined; } }
  /** the reader did it: an autoplay doesn't start again by itself */
  function byHand(f: () => void) { wake(); userPaused = true; f(); buttons(); show(); }
  function stop() { stepTo = undefined; tr.pause(); }
  /** off: everything in place and lit, nothing moving, the steps open as text; on again: it plays from the first step, unless the reader had paused it (or stepped it) by hand */
  function setOff(v: boolean) {
    if (gone || v === off) return;
    off = v; resting = v; told = undefined;
    stop();
    tr.active = inView && !off;
    tr.seek(off ? tr.duration : 0);
    if (off) list.open = true;
    marks(tr.beat);
    buttons(); show();
    if (!off && !userPaused && o.autoplay !== 'visible') tr.play();
    pick();
  }
  function step(i: number) {
    const b = tr.timeline.beats[i];
    if (!b || gone) return;
    tr.pause();
    tr.seek(b.start, { join: true });
    const nextStart = tr.timeline.beats[i + 1]?.start ?? Infinity;
    // through the beat, and to a stop within it (its end is the next one's start)
    stepTo = Math.max(b.start, Math.min(b.end, nextStart, tr.duration) - 1);
    // off: the step as it is when it is over, and no way there
    if (off) { const to = stepTo; stepTo = undefined; tr.seek(to); return; }
    tr.play({ until: stepTo });
  }
  function toggle() {
    if (off) return;
    wake();
    if (going()) { userPaused = true; stop(); } else { userPaused = false; stepTo = undefined; tr.pause(); tr.play(); }
    buttons(); show();
  }
  tr.on('time', show);
  tr.on('play', buttons); tr.on('ambient', buttons);
  tr.on('pause', () => { stepTo = undefined; buttons(); });
  root.addEventListener('keydown', e => {
    const k = e.key, t = e.target as Element;
    if (e.altKey || e.ctrlKey || e.metaKey || t === bar) return;
    if (o.zoom && frozen === undefined) {
      const arrow = ({ ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] } as Record<string, [number, number]>)[k];
      if (k === '+' || k === '=' || k === '-' || k === '_' || k === '0') { e.preventDefault(); if (k === '0') setClose(FITTED); else zoomBy(k === '+' || k === '=' ? 1.25 : 0.8); return; }
      // the arrows step through the beats; with Shift, or where there are none, they move what is closer
      if (arrow && (e.shiftKey || !tr.timeline.beats.length)) { if (close.times > 1) { e.preventDefault(); const s = size(); panFor(arrow[0] * s.w * 0.15, arrow[1] * s.h * 0.15); } if (e.shiftKey || close.times > 1) return; }
    }
    if (k === 'ArrowRight' || k === 'ArrowLeft') { e.preventDefault(); (k === 'ArrowRight' ? next : back).click(); }
    else if (k === 'Home') { e.preventDefault(); again.click(); }
    else if ((k === ' ' || k === 'k') && t === root) { e.preventDefault(); toggle(); }
  });
  const onBadge = (e: Event) => {
    const b = (e.target as Element).closest?.('[data-go]'), key = (e as KeyboardEvent).key;
    if (!b || (e.type === 'keydown' && key !== 'Enter' && key !== ' ')) return;
    e.preventDefault(); e.stopPropagation();
    byHand(() => step(Number(b.getAttribute('data-go')) - 1));
  };
  stage.addEventListener('click', onBadge); stage.addEventListener('keydown', onBadge);

  // ---- in view: neither clock moves for a player nobody can see; one that autoplays in view is one at a time ----
  const me = {
    seen: 0, wants: o.autoplay === 'visible' && !calm,
    // (one that has ended doesn't begin again by itself)
    auto(on: boolean) { if (on) { if (!off && !userPaused && !going() && tr.time < tr.duration) { stepTo = undefined; tr.play(); } } else if (going()) { stepTo = undefined; tr.pause(); } },
  };
  mounted.set(root, me);
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(es => { for (const e of es) { me.seen = e.isIntersecting ? e.intersectionRatio : 0; inView = e.isIntersecting; if (frozen === undefined) tr.active = inView && !off; } pick(); }, { threshold: [0, 0.2, 0.35, 0.5, 0.7, 0.9, 1] }) : undefined;
  io?.observe(root);

  beats(); buttons(); show();
  if (o.autoplay === true && !calm) tr.play();
  return {
    root, transport: tr, step: i => byHand(() => step(i)),
    set(s, tl = NOTHING, mode) {
      if (gone || !tl.ok) return false;
      const fresh = svgOf(s.rendered.svg);
      // another drawing: from its own view; the same one drawn again: where they were
      if (s.rendered.viewBox.join() !== scene.rendered.viewBox.join() || s.id !== scene.id) close = FITTED;
      scene = s; svg.replaceWith(fresh); svg = fresh; own = svg.getAttribute('viewBox') ?? ''; aimed = false;
      if (mode) root.dataset.mode = mode;
      if (stepTo !== undefined) stop();
      tr.rebind(tl);
      beats(); buttons(); show();
      return true;
    },
    freeze(ms) { close = FITTED; frozen = ms; tr.pause(); tr.active = false; root.classList.add('frozen'); show(); },
    dispose() { gone = true; io?.disconnect(); sized?.disconnect(); mounted.delete(root); tr.dispose(); root.remove(); pick(); },
  };
}

/** The player's stylesheet: its own, under one class; the colours are custom properties a host may set. */
export const PLAY_CSS = `
.iso-play{--ip-ink:#1c2026;--ip-muted:#68707c;--ip-line:#dfe3e8;--ip-bg:#fff;--ip-code:#f2f4f7;--ip-focus:#2a64d6;container:iso-play/inline-size;display:block;color:var(--ip-ink);background:var(--ip-bg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;border-radius:10px}
.iso-play[data-mode="dark"]{--ip-ink:#e6e9ee;--ip-muted:#98a1ae;--ip-line:#333a44;--ip-bg:#15181d;--ip-code:#1f242b;--ip-focus:#7aa7ff;color-scheme:dark}
.iso-play:focus-visible,.iso-play button:focus-visible,.iso-play input:focus-visible,.iso-play summary:focus-visible{outline:2px solid var(--ip-focus);outline-offset:2px}
.iso-play [hidden]{display:none}
.iso-play-stage svg{display:block;width:100%;height:auto}
.iso-play-stage{position:relative}
.iso-play-stage [data-go]{cursor:pointer}
.iso-play.closer .iso-play-stage svg{cursor:grab;user-select:none;-webkit-user-select:none}
.iso-play.dragging .iso-play-stage svg{cursor:grabbing}
.iso-zoom{position:absolute;top:10px;right:54px;display:flex;gap:6px;opacity:0}
.iso-play:hover .iso-zoom,.iso-zoom:focus-within,dialog .iso-zoom{opacity:1}
@media (hover:none){.iso-zoom{opacity:1}.iso-zoom .z-in,.iso-zoom .z-out{display:none}dialog .iso-zoom .z-in,dialog .iso-zoom .z-out{display:block}}
.iso-zoom .iso-play-btn{box-sizing:border-box;height:36px;min-width:36px;border:1px solid #000;border-radius:10px;background:#fff;color:#000;box-shadow:0 2px 0 #000}
.iso-zoom .iso-play-btn:disabled{opacity:.55}
.iso-zoom-hint{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:8px 14px;border-radius:10px;background:rgba(12,12,14,.82);color:#fff;font-size:14px;pointer-events:none;visibility:hidden}
.iso-zoom-hint.on{visibility:visible}
.iso-play.frozen .iso-zoom,.iso-play.frozen .iso-zoom-hint{display:none}
@media print{.iso-zoom,.iso-zoom-hint{display:none}}
.iso-play-row{display:flex;align-items:center;gap:6px;padding:8px 12px 4px}
.iso-play-btn{font:inherit;min-width:32px;height:32px;padding:0 8px;border:1px solid var(--ip-line);border-radius:8px;background:none;color:inherit;cursor:pointer}
.iso-play-btn:hover{border-color:var(--ip-muted)}
.iso-play-btn.play{background:var(--ip-ink);color:var(--ip-bg);border-color:var(--ip-ink);min-width:44px}
.iso-play-btn.ambient[aria-pressed="false"]{color:var(--ip-muted);text-decoration:line-through}
.iso-play-btn.still{font-size:12px;white-space:nowrap}
.iso-play-btn.still[aria-pressed="true"]{background:var(--ip-ink);color:var(--ip-bg)}
.iso-play-btn:disabled{opacity:.4;cursor:default}
.iso-play-bar{flex:1 1 60px;min-width:0;accent-color:var(--ip-ink)}
.iso-play-time{color:var(--ip-muted);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.iso-play-dots{display:flex;flex-wrap:wrap;gap:4px 12px;padding:2px 12px}
.iso-play-group{display:inline-flex;gap:0}
.iso-play-dot{width:24px;height:24px;padding:0;border:0;background:none;cursor:pointer;display:grid;place-items:center}
.iso-play-dot::before{content:"";width:9px;height:9px;border-radius:50%;background:var(--ip-line)}
.iso-play-dot.done::before{background:var(--ip-muted)}
.iso-play-dot.on::before{background:var(--ip-ink);width:11px;height:11px}
.iso-play-say{padding:4px 12px 10px;min-height:5.2em}
.iso-play-head{display:flex;align-items:baseline;gap:8px;font-weight:700}
.iso-play-num{flex:none;display:inline-grid;place-items:center;min-width:22px;height:22px;border-radius:11px;background:var(--ip-ink);color:var(--ip-bg);font-size:11px;align-self:center}
.iso-play-chapter,.iso-play-count{color:var(--ip-muted);font-size:12px;font-weight:500}
.iso-play-count{margin-left:auto;white-space:nowrap}
.iso-play-text{max-width:80ch}
.iso-play-text a{color:inherit}
.iso-play-code{margin:6px 0 0;padding:6px 10px;border-radius:8px;background:var(--ip-code);font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.iso-play-facts{display:flex;flex-wrap:wrap;gap:2px 16px;margin:6px 0 0;font-size:12px}
.iso-play-facts dt{color:var(--ip-muted)}
.iso-play-facts dd{margin:0 8px 0 -10px;font-weight:600}
.iso-play-list{padding:0 12px 10px;font-size:13px}
.iso-play-list summary{color:var(--ip-muted);cursor:pointer}
.iso-play.frozen>:not(.iso-play-stage){display:none}
@container iso-play (max-width:420px){.iso-play-time{display:none}.iso-play-row{flex-wrap:wrap}.iso-play-bar{flex-basis:100%;order:9}}
`;
