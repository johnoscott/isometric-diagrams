// Two drawings compared, in the player (docs/design/MOTION.md, 5c): Before | After, a slider between, what each mark means, and what changed as
// text. What shows is compareScenes' (pure, from a number); the player (play.ts) has the clock, the zoom and Motion off. The second drawing is
// added to the first (plus-lighter), which is an exact crossfade on any ground; where a browser can't, it fades plainly. Styles are set through
// the CSSOM, so it runs under the player's CSP; its stylesheet is the host's to add (COMPARE_CSS), beside PLAY_CSS.

import { paint } from '../iso-objects/motion.ts';
import { easeOf } from '../iso-objects/motion-doc.ts';
import type { Comparison, ChangeSaid } from '../iso-objects/diff-compare.ts';
import type { Timeline } from '../iso-objects/timeline.ts';
import { h } from './dom.ts';
import { mountPlayer, type Played, type Player, type PlayerOptions } from './play.ts';

export interface ComparePlayerOptions extends Pick<PlayerOptions, 'label' | 'controls' | 'autoplay' | 'rate' | 'reducedMotion' | 'mode' | 'zoom' | 'clock'> { comparison: Comparison }
export interface ComparePlayer extends Player {
  /** how far it is, 0 (the first drawing) to 1 (the second) */
  readonly between: number;
  /** to one of them, the way there played */
  show(which: 'before' | 'after'): void;
  /** straight to a place between */
  seek(f: number): void;
  /** other drawings, where it was */
  compare(c: Comparison, mode?: 'light' | 'dark'): void;
}

const WORDS: Record<ChangeSaid['kind'], string> = { added: 'Added', changed: 'Changed', moved: 'Moved', removed: 'Removed' };
const said = (c: ChangeSaid) => `${c.what === 'thing' ? '' : `${c.what} `}${c.name}${c.was ? ` (was ${c.was})` : ''}`;
const line = (c: Comparison): Timeline => ({ ok: true, diags: [], duration: c.duration, beats: [], markers: {}, ambient: 'off', loops: false, at: () => ({}), cues: () => undefined, beatAt: () => undefined, startOf: () => undefined });

export function mountCompare(host: HTMLElement | ShadowRoot, o: ComparePlayerOptions): ComparePlayer {
  let c = o.comparison;
  const ease = easeOf('settle', c.duration), adds = typeof CSS !== 'undefined' && CSS.supports('mix-blend-mode', 'plus-lighter');
  // it opens on the second drawing; one that plays by itself goes there from the first (with `respect`, the player stands at its end)
  let from = o.autoplay ? 0 : 1, to = 1, now = from;
  const drawn = (): Played => ({ id: c.id, rendered: c.after.rendered, paint: draw });
  // The first drawing lies under the player's own (the second), the two of them alone in the stage's own layer, so that they add up there and
  // only there. Nested in one SVG they come out a little otherwise on smoothed edges. Its view is the other's, which the player moves
  let under: SVGSVGElement | undefined, of: Comparison | undefined, over: SVGSVGElement | undefined;
  const follow = () => { const v = over?.getAttribute('viewBox'); if (under && v && under.getAttribute('viewBox') !== v) under.setAttribute('viewBox', v); };
  const eye = new MutationObserver(follow);
  function beneath(svg: SVGSVGElement): SVGSVGElement {
    if (!under || of !== c) {
      under?.remove(); of = c;
      under = document.importNode(new DOMParser().parseFromString(c.before.rendered.svg, 'image/svg+xml').documentElement, true) as unknown as SVGSVGElement;
      for (const k of ['role', 'aria-label']) under.removeAttribute(k);
      under.setAttribute('aria-hidden', 'true');
      under.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
    }
    if (over !== svg || under.nextSibling !== svg) {
      over = svg; svg.before(under); svg.parentElement!.style.isolation = 'isolate';
      eye.disconnect(); eye.observe(svg, { attributes: true, attributeFilter: ['viewBox'] });
    }
    return under;
  }
  function draw(svg: SVGSVGElement, ms: number) {
    if (ms >= c.duration) from = to;
    now = ms >= c.duration ? to : from + (to - from) * ease(ms / c.duration);
    const s = c.at(now), first = beneath(svg), both = !!s.before && !!s.after;
    first.style.visibility = s.before ? 'visible' : 'hidden'; first.style.opacity = both ? String(1 - s.fade) : '1';
    svg.style.opacity = s.after ? (both ? String(s.fade) : '1') : '0'; svg.style.mixBlendMode = both && adds ? 'plus-lighter' : 'normal';
    if (s.before) paint(first, s.before, c.before.rendered, { styles: 'cssom' });
    if (s.after) paint(svg, s.after, c.after.rendered, { styles: 'cssom' });
    follow();
    tell();
  }

  // ---- its own row: the two, the slider; what the marks mean; what changed ----
  const button = (which: 'before' | 'after', words: string) => h('button', { type: 'button', class: `iso-play-btn iso-compare-${which}`, 'aria-pressed': 'false', on: { click: (() => show(which)) as EventListener } }, words);
  const before = button('before', 'Before'), after = button('after', 'After');
  const bar = h('input', { type: 'range', class: 'iso-play-bar iso-compare-bar', min: 0, max: 1000, step: 1, 'aria-label': 'Between before and after', on: { input: (() => seek(Number(bar.value) / 1000)) as EventListener } });
  const legend = h('ul', { class: 'iso-compare-legend', 'aria-label': 'What the marks mean' }), list = h('details', { class: 'iso-play-list iso-compare-list' });
  const row = h('div', { class: 'iso-play-row iso-compare-row' }, h('span', { class: 'iso-compare-pair', role: 'group', 'aria-label': 'Before or after' }, before, after), bar);
  let ready = false;
  function tell() {
    if (!ready) return;
    bar.value = String(Math.round(now * 1000));
    bar.setAttribute('aria-valuetext', now <= 0 ? 'Before' : now >= 1 ? 'After' : `${Math.round(now * 100)}% of the way to after`);
    before.setAttribute('aria-pressed', String(to === 0)); after.setAttribute('aria-pressed', String(to === 1));
    player.root.dataset.between = String(Math.round(now * 1000) / 1000);
  }
  function words() {
    const ns = 'http://www.w3.org/2000/svg';
    legend.replaceChildren(...c.legend.map(l => {
      const s = document.createElementNS(ns, 'svg'), p = document.createElementNS(ns, 'path');
      for (const [k, v] of Object.entries({ viewBox: '0 0 34 10', width: '34', height: '10', 'aria-hidden': 'true' })) s.setAttribute(k, v);
      for (const [k, v] of Object.entries({ d: 'M1,5H33', fill: 'none', stroke: l.color, 'stroke-width': '3', ...(l.dash ? { 'stroke-dasharray': l.dash } : {}) })) p.setAttribute(k, v);
      s.append(p);
      const li = h('li', null); li.append(s, ` ${l.words}`);
      return li;
    }));
    const kinds = (['added', 'changed', 'moved', 'removed'] as const).map(k => [k, c.changes.filter(x => x.kind === k)] as const).filter(x => x[1].length);
    list.replaceChildren(h('summary', null, 'What changed'), c.changes.length ? h('ul', null, ...kinds.map(([k, all]) => h('li', null, h('b', null, WORDS[k]), `: ${all.map(said).join(', ')}`))) : h('p', null, 'Nothing.'));
    legend.hidden = !c.legend.length;
  }

  const player = mountPlayer(host, { ...o, scene: drawn(), timeline: line(c), controls: false, loop: false });
  const tr = player.transport, shown = o.controls ?? true;
  if (shown) { player.root.append(row, legend, list); player.root.tabIndex = 0; }
  player.root.classList.add('iso-compare'); player.root.setAttribute('aria-roledescription', 'diagram, before and after');
  ready = true; words();

  /** straight there: nothing between is drawn */
  function seek(f: number) { from = to = Math.max(0, Math.min(1, Number.isFinite(f) ? f : 1)); tr.pause(); tr.seek(c.duration); }
  function show(which: 'before' | 'after') {
    const at = which === 'before' ? 0 : 1;
    if (at === now && at === to) { tell(); return; }
    tr.pause(); from = now; to = at;
    tr.seek(0); tr.play();
    // (Motion off: there is no way there; also when a key has woken the drawing meanwhile)
    if (!tr.playing) tr.seek(c.duration);
  }
  // the slider's own keys are its own: the player's (its beats', its zoom's) would take them
  const SLIDES = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
  bar.addEventListener('keydown', e => { if (SLIDES.has(e.key)) e.stopPropagation(); });
  // the long key and k turn it over, on the player itself: before the player's own keys, which would play it from where it began, as Home would
  player.root.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target === bar) return;
    if (e.key === 'Home') { e.stopImmediatePropagation(); return; }
    if ((e.key !== ' ' && e.key !== 'k') || e.target !== player.root) return;
    e.preventDefault(); e.stopImmediatePropagation(); show(to === 1 ? 'before' : 'after');
  }, true);
  tell();
  return {
    ...player, root: player.root, dispose() { eye.disconnect(); player.dispose(); }, transport: tr, get between() { return now; }, show, seek,
    compare(next, mode) {
      // on its way: from where it is, on to where it was going
      const way = now !== to;
      from = now; tr.seek(way ? 0 : c.duration);
      c = next; player.set(drawn(), line(c), mode);
      if (!way) tr.seek(c.duration);
      words(); tell();
    },
  };
}

/** What a compare adds to the player's stylesheet. */
export const COMPARE_CSS = `
.iso-compare-pair{display:inline-flex}
.iso-compare-pair .iso-play-btn:first-child{border-radius:8px 0 0 8px;border-right-width:0}
.iso-compare-pair .iso-play-btn:last-child{border-radius:0 8px 8px 0}
.iso-compare-pair .iso-play-btn[aria-pressed="true"]{background:var(--ip-ink);color:var(--ip-bg)}
.iso-compare-legend{display:flex;flex-wrap:wrap;gap:4px 18px;margin:0;padding:4px 12px;list-style:none;font-size:13px}
.iso-compare-legend[hidden]{display:none}
.iso-compare-legend svg{display:inline-block;vertical-align:middle}
.iso-compare-list ul{margin:6px 0 0;padding-left:20px}
.iso-play.frozen .iso-compare-row,.iso-play.frozen .iso-compare-legend{display:none}
`;
