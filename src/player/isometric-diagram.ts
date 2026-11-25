// <isometric-diagram> (docs/design/MOTION.md, 6.2): a drawing's text in a page, drawn and played, as Mermaid does it. An app on the
// layers: the compiler (the systems pack), the Timeline, the player. One script, nothing fetched, nothing stored, no style element.
//
//   <script type="module" src="isometric-diagram.js"></script>
//   <isometric-diagram controls autoplay="visible" loop>
//     <script type="text/yaml"> isodiag: 1 … </script>          (or the text itself, with & and < escaped)
//   </isometric-diagram>
//
// Two drawings, before and after (compare): two scripts of text in it, in that order. See src/iso-viewer/compare.ts.
//
// A host's own marks (registerMarks) are registered with this script's copy of the engine: each bundle has its own. The elements on the
// page are drawn again with them. Enlarged (expand()), the player itself is in a modal dialog of the element's own, and back after:
// it is the same player, so nothing about it changes but its size.

import { compile, type Compiled, type CompiledScene } from '../iso-systems/compile.ts';
import { bindAnts } from '../iso-objects/bind-ants.ts';
import { bindMotion, motionOfSteps, type BeatInfo, type Timeline } from '../iso-objects/timeline.ts';
import type { MotionDoc } from '../iso-objects/motion-doc.ts';
import { registerMarks as register } from '../iso-objects/assets.ts';
import { h } from '../iso-viewer/dom.ts';
import { compareScenes } from '../iso-objects/diff-compare.ts';
import { COMPARE_CSS, mountCompare, type ComparePlayer } from '../iso-viewer/compare.ts';
import { mountPlayer, playersMoved, PLAY_CSS, type Player } from '../iso-viewer/play.ts';
import type { Transport } from '../iso-viewer/transport.ts';
import THEME from '../../themes/default.yaml';

const HOST_CSS = ':host{display:block}:host([hidden]){display:none}.iso-play-problem{margin:0;padding:10px 12px;border:1px solid #c9463d;border-radius:8px;color:#c9463d;font:13px/1.5 system-ui,sans-serif;white-space:pre-wrap}'
  + '.iso-frame{position:relative}'
  + '.iso-enlarge{position:absolute;top:10px;right:10px;box-sizing:border-box;width:36px;height:36px;display:grid;place-items:center;padding:0;border:1px solid #000;border-radius:10px;background:#fff;color:#000;box-shadow:0 2px 0 #000;cursor:pointer;opacity:0}'
  + '.iso-enlarge[hidden]{display:none}:host(:hover) .iso-enlarge,.iso-enlarge:focus-visible{opacity:1}@media (hover:none){.iso-enlarge{opacity:1}}@media print{.iso-enlarge{display:none}}'
  + '.iso-enlarge:focus-visible,.iso-full-close:focus-visible{outline:2px solid #2a64d6;outline-offset:2px}'
  + '.iso-full{position:fixed;inset:0;box-sizing:border-box;width:100%;height:100%;max-width:none;max-height:none;margin:0;border:0;padding:72px 16px 16px;background:rgba(12,12,14,.95);overflow:hidden;overscroll-behavior:contain}'
  + '.iso-full[open]{display:flex}.iso-full::backdrop{background:none}'
  + '.iso-full-close{position:absolute;top:16px;right:16px;width:44px;height:44px;padding:0;border:1px solid #000;border-radius:50%;background:#fff;color:#000;font:20px/1 system-ui,sans-serif;cursor:pointer}'
  + ':host([expand="off"]) .iso-zoom,.iso-full .iso-zoom{right:10px}'
  + '.iso-full>.iso-play{flex:1 1 0;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:auto}.iso-full>.iso-play>*{flex:none}'
  + '.iso-full>.iso-play>.iso-play-stage{flex:1 1 0;min-height:45%;position:relative}.iso-full>.iso-play>.iso-play-stage svg{position:absolute;inset:0;width:100%;height:100%}';
let sheet: CSSStyleSheet | undefined;

/** a page with no DOM (a server that imports this) has no elements: the class is there, and does nothing */
const Base = (typeof HTMLElement === 'function' ? HTMLElement : class {}) as typeof HTMLElement;

export class IsometricDiagram extends Base {
  static readonly observedAttributes = ['ambient', 'autoplay', 'compare', 'controls', 'expand', 'label', 'loop', 'mode', 'rate', 'reduced-motion', 'scene', 'treatment', 'zoom'];
  #source: string | undefined;
  #theme: string | undefined;
  #motion: MotionDoc | undefined;
  #player: Player | undefined;
  /** the same, where it compares two */
  #compare: ComparePlayer | undefined;
  #before: string | undefined;
  #as: Record<string, string> | undefined;
  #ghosts = true;
  #shadow: ShadowRoot | undefined;
  #due = false;
  #steps = false;
  #media: MediaQueryList | undefined;
  /** what it is drawn in, the button over it, and the dialog it is in while it is enlarged */
  #frame: HTMLElement | undefined;
  #enlarge: HTMLButtonElement | undefined;
  #full: HTMLDialogElement | undefined;
  #back: HTMLElement | undefined;
  #still = false;
  static readonly #live = new Set<IsometricDiagram>();
  /** every one on the page, drawn again (its place in its motion kept) */
  static redraw(): void { for (const el of IsometricDiagram.#live) el.#later(); }

  /** the drawing's text: the property when set, else what is written in the element */
  get source(): string {
    if (this.#source !== undefined) return this.#source;
    const all = this.#scripts();
    // (compared, the second is the drawing and the first what it was)
    return dedent((this.hasAttribute('compare') ? all[1]?.textContent : all[0]?.textContent ?? this.textContent) ?? '');
  }
  set source(v: string) { this.#source = v; this.#later(); }
  #scripts(): HTMLElement[] { return [...this.querySelectorAll<HTMLElement>('script[type="text/yaml"],script[type="application/yaml"]')]; }
  /** (compare) the text of the drawing before: the property when set, else the first script in the element */
  get sourceBefore(): string { return this.#before ?? dedent(this.#scripts()[0]?.textContent ?? ''); }
  set sourceBefore(v: string) { this.#before = v; this.#later(); }
  /** (compare) ids renamed: the old one to the new */
  get as(): Record<string, string> | undefined { return this.#as; }
  set as(v: Record<string, string> | undefined) { this.#as = v; this.#later(); }
  /** (compare) whether what was removed stays as a ghost (default: it does) */
  get ghosts(): boolean { return this.#ghosts; }
  set ghosts(v: boolean) { this.#ghosts = v; this.#later(); }
  /** the theme's text (default: the engine's) */
  get theme(): string { return this.#theme ?? THEME; }
  set theme(v: string | undefined) { this.#theme = v; this.#later(); }
  /** the motion (default: the scene's own in the file, or its steps) */
  get motion(): MotionDoc | undefined { return this.#motion; }
  set motion(v: MotionDoc | undefined) { this.#motion = v; this.#later(); }
  /** once drawn: play, pause, seek, beats, the ambient switch */
  get transport(): Transport | undefined { return this.#player?.transport; }

  connectedCallback() {
    IsometricDiagram.#live.add(this);
    this.#shadow ??= this.attachShadow({ mode: 'open' });
    sheet ??= (() => { const s = new CSSStyleSheet(); s.replaceSync(PLAY_CSS + COMPARE_CSS + HOST_CSS); return s; })();
    this.#shadow.adoptedStyleSheets = [sheet];
    this.#media = matchMedia('(prefers-color-scheme: dark)');
    this.#media.addEventListener('change', this.#later);
    // (while the page is still being read, what is in the element may not all be there yet)
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', this.#later, { once: true }); else this.#later();
  }
  disconnectedCallback() {
    IsometricDiagram.#live.delete(this);
    this.#restore(false);
    this.#media?.removeEventListener('change', this.#later);
    document.removeEventListener('DOMContentLoaded', this.#later);
    this.#end();
  }
  #end() { this.#player?.dispose(); this.#player = undefined; this.#compare = undefined; }
  attributeChangedCallback(name: string, was: string | null, now: string | null) {
    const tr = this.#player?.transport;
    if (was === now) return;
    if (name === 'expand') { if (!this.#may()) this.collapse(); this.#corner(); return; }
    if (!tr) { this.#later(); return; }
    // what the transport takes as it plays; the rest is drawn again
    if ((name === 'loop' || name === 'ambient') && this.#compare) return;
    if (name === 'loop') tr.loop = now !== null;
    else if (name === 'rate') tr.rate = rateOf(now);
    else if (name === 'ambient') tr.ambient = now === null ? tr.timeline.ambient === 'on' : now !== 'off';
    else { if (name !== 'mode' && name !== 'scene' && name !== 'treatment') this.#end(); this.#later(); }
  }
  /** once, after everything set together */
  readonly #later = () => {
    if (this.#due || !this.isConnected) return;
    this.#due = true;
    queueMicrotask(() => { this.#due = false; if (this.isConnected) this.#draw(); });
  };

  #draw() {
    const root = this.#shadow!, mode = this.#mode();
    if (this.hasAttribute('compare')) { this.#drawCompare(mode); return; }
    let drawn: { c: Compiled; s: CompiledScene; tl?: Timeline; steps: boolean };
    try { drawn = read(this.source, this.theme, mode, this.getAttribute('scene'), this.#motion, this.getAttribute('treatment')); } catch (e) {
      this.#problem(e as Error);
      return;
    }
    // (the drawing's own steps have marks of their own, which another document hasn't)
    if (this.#player && this.#steps !== drawn.steps) this.#end();
    this.#steps = drawn.steps;
    if (this.#player) { this.#player.set(drawn.s, drawn.tl, mode); return; }
    // (while it is enlarged, what is mounted anew goes there)
    if (!this.#full?.open) { this.#frame = h('div', { class: 'iso-frame' }); root.replaceChildren(this.#frame); this.#enlarge = undefined; }
    const at = this.getAttribute('autoplay'), link = linkOf(this.hasAttribute('links') ? location.hash : '', drawn.tl);
    this.#still = !!link?.still;
    this.#name = this.getAttribute('label') ?? drawn.s.raw.title ?? drawn.c.doc?.title ?? 'Diagram';
    this.#player = mountPlayer(this.#full?.open ? this.#full : this.#frame!, {
      scene: drawn.s, timeline: drawn.tl, mode, steps: drawn.steps, label: this.#name,
      zoom: this.getAttribute('zoom') !== 'off', controls: this.hasAttribute('controls'), loop: this.hasAttribute('loop'), rate: rateOf(this.getAttribute('rate')),
      autoplay: link ? false : at === 'visible' ? 'visible' : at !== null,
      ...(this.getAttribute('ambient') === null ? {} : { ambient: this.getAttribute('ambient') === 'off' ? 'off' as const : 'on' as const }),
      reducedMotion: this.getAttribute('reduced-motion') === 'respect' ? 'respect' : 'ignore',
    });
    const tr = this.#player.transport, tell = (type: string, detail?: unknown) => this.dispatchEvent(new CustomEvent(type, { detail }));
    tr.on('beat', (beat: BeatInfo, how) => tell('beat', { beat, how }));
    for (const k of ['play', 'pause', 'end', 'loop'] as const) tr.on(k, () => tell(k));
    if (link) { if (link.still) this.#player.freeze(link.at); else tr.seek(link.at); }
    this.#corner();
    tell('isometric-ready');
  }

  /** a fault, in words in its place */
  #problem(e: Error) {
    this.#restore(true);
    this.#end();
    const p = document.createElement('p');
    p.className = 'iso-play-problem'; p.setAttribute('role', 'alert'); p.textContent = e.message;
    this.#shadow!.replaceChildren(p);
    this.dispatchEvent(new CustomEvent('isometric-error', { detail: e.message }));
  }
  /** two drawings, before and after: neither's own motion, steps or ants play */
  #drawCompare(mode: 'light' | 'dark') {
    const root = this.#shadow!, part = (which: string, text: string) => { try { return compiled(text, this.theme, mode, this.getAttribute('scene'), this.getAttribute('treatment')); } catch (e) { throw new Error(`${which}: ${(e as Error).message}`); } };
    let c: ReturnType<typeof compareScenes>, title: string;
    try {
      const a = part('before', this.sourceBefore), b = part('after', this.source);
      c = compareScenes(a.s, b.s, { ...(this.#as ? { as: this.#as } : {}), ...(this.#ghosts ? {} : { ghosts: false }) });
      const bad = c.diff.diags.find(d => d.severity === 'error');
      if (bad) throw new Error(bad.message);
      title = b.s.raw.title ?? b.c.doc?.title ?? 'Diagram';
    } catch (e) { this.#problem(e as Error); return; }
    if (this.#compare) { this.#compare.compare(c, mode); return; }
    if (!this.#full?.open) { this.#frame = h('div', { class: 'iso-frame' }); root.replaceChildren(this.#frame); this.#enlarge = undefined; }
    const at = this.getAttribute('autoplay');
    this.#still = this.hasAttribute('links') && /[#&]still\b/.test(location.hash);
    this.#name = this.getAttribute('label') ?? title;
    this.#compare = mountCompare(this.#full?.open ? this.#full : this.#frame!, {
      comparison: c, mode, label: this.#name, zoom: this.getAttribute('zoom') !== 'off', controls: this.hasAttribute('controls'), rate: rateOf(this.getAttribute('rate')),
      autoplay: this.#still ? false : at === 'visible' ? 'visible' : at !== null, reducedMotion: this.getAttribute('reduced-motion') === 'respect' ? 'respect' : 'ignore',
    });
    this.#player = this.#compare;
    const tr = this.#player.transport, tell = (type: string) => this.dispatchEvent(new CustomEvent(type));
    for (const k of ['play', 'pause', 'end'] as const) tr.on(k, () => tell(k));
    if (this.#still) this.#player.freeze(tr.duration);
    this.#corner();
    tell('isometric-ready');
  }

  // ---- enlarged ----
  #name = 'Diagram';
  #may(): boolean { return this.getAttribute('expand') !== 'off' && !this.#still && typeof HTMLDialogElement === 'function'; }
  /** the button over the drawing's corner */
  #corner() {
    if (!this.#frame) return;
    if (!this.#enlarge) {
      this.#enlarge = h('button', { type: 'button', class: 'iso-enlarge', on: { click: (() => this.expand()) as EventListener } });
      const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
      for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
      path.setAttribute('d', 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7');
      svg.append(path); this.#enlarge.append(svg);
      this.#frame.append(this.#enlarge);
    }
    this.#enlarge.hidden = !this.#may() || !this.#player;
    this.#enlarge.setAttribute('aria-label', `Enlarge: ${this.#name}`); this.#enlarge.title = 'Enlarge';
    this.#full?.setAttribute('aria-label', this.#name);
  }
  /** whether it is enlarged */
  get expanded(): boolean { return !!this.#full?.open; }
  /** nearly all of the window, until Esc, the ✕ or collapse(); whether it is */
  expand(): boolean {
    if (this.expanded) return true;
    const root = this.#player?.root, frame = this.#frame;
    if (!root || !frame || !this.isConnected || !this.#may()) return false;
    let was = document.activeElement as HTMLElement | null;
    while (was?.shadowRoot?.activeElement) was = was.shadowRoot.activeElement as HTMLElement;
    this.#back = was ?? undefined;
    if (!this.#full) {
      const close = h('button', { type: 'button', class: 'iso-full-close', 'aria-label': 'Close', title: 'Close', on: { click: (() => this.collapse()) as EventListener } }, '✕');
      const full = this.#full = document.createElement('dialog');
      full.className = 'iso-full'; full.append(close);
      // Esc: at once, as collapse() is ('close' comes a moment after, and whatever way it closed)
      full.addEventListener('cancel', e => { e.preventDefault(); this.collapse(); });
      full.addEventListener('close', () => { if (full === this.#full && !full.open && this.#player && full.contains(this.#player.root)) this.#restore(true); });
    }
    this.#full.setAttribute('aria-label', this.#name);
    this.#shadow!.append(this.#full);
    // its place on the page is kept
    frame.style.height = `${frame.getBoundingClientRect().height}px`;
    this.#full.append(root);
    this.#full.showModal();
    if (root.tabIndex >= 0) root.focus();
    playersMoved();
    this.dispatchEvent(new CustomEvent('expand'));
    return true;
  }
  collapse(): void { if (this.expanded) this.#restore(true); }
  /** back where it was on the page. tell: the page is told, and the focus goes back */
  #restore(tell: boolean) {
    const full = this.#full, root = this.#player?.root;
    if (!full || (!full.open && !(root && full.contains(root)))) return;
    if (root && this.#frame) this.#frame.prepend(root);
    if (full.open) full.close();
    full.remove();
    if (this.#frame) this.#frame.style.height = '';
    const back = this.#back;
    this.#back = undefined;
    playersMoved();
    if (!tell) return;
    if (back?.isConnected && back !== document.body) back.focus({ preventScroll: true });
    this.dispatchEvent(new CustomEvent('collapse'));
  }
  #mode(): 'light' | 'dark' {
    const m = this.getAttribute('mode');
    return m === 'light' || m === 'dark' ? m : this.#media?.matches ? 'dark' : 'light';
  }
}

const rateOf = (v: string | null) => { const n = Number(v ?? 1); return Number.isFinite(n) && n > 0 ? n : 1; };
/** the text without the indentation it has in the page */
function dedent(t: string): string {
  const lines = t.replace(/^[ \t]*\r?\n/, '').replace(/\s+$/, '').split(/\r?\n/);
  const by = Math.min(...lines.filter(l => l.trim()).map(l => /^ */.exec(l)![0].length));
  return Number.isFinite(by) ? lines.map(l => l.slice(by)).join('\n') + '\n' : '';
}
/** a text's scene, self-contained */
function compiled(source: string, theme: string, mode: 'light' | 'dark', scene: string | null, treatment: string | null) {
  if (!source.trim()) throw new Error('no drawing: its text goes in the element, or in its source');
  if (treatment !== null && treatment !== 'mono' && treatment !== 'none') throw new Error(`no treatment "${treatment}" (there is mono, and none)`);
  const c = compile(source, theme, { mode, resolveVars: true, strict: 'throw', ...(treatment ? { treatment } : {}) });
  const s = scene === null ? c.scenes[0] : c.scenes.find(x => x.id === scene);
  if (!s) throw new Error(scene === null ? 'no scene in it' : `no scene "${scene}" (there ${c.scenes.length === 1 ? 'is' : 'are'} ${c.scenes.map(x => x.id).join(', ')})`);
  return { c, s };
}
function read(source: string, theme: string, mode: 'light' | 'dark', scene: string | null, motion: MotionDoc | undefined, treatment: string | null) {
  const { c, s } = compiled(source, theme, mode, scene, treatment);
  const doc = motion ?? s.motion ?? (s.steps.steps.length ? motionOfSteps(s) : undefined);
  // (with nothing to play, the file's own ants march all the same)
  const tl = doc ? bindMotion(s, doc, { kinds: c.theme!.kinds }) : bindAnts(s, { kinds: c.theme!.kinds });
  if (tl && !tl.ok) throw new Error(tl.diags.map(d => `${d.path}: ${d.message}${d.hint ? ` (${d.hint})` : ''}`).join('\n'));
  return { c, s, tl, steps: !motion && !s.motion };
}
/** #step=N (from 1), #t= (how far into it, 0 to 1), #still (one picture, no controls) */
function linkOf(hash: string, tl: Timeline | undefined): { at: number; still: boolean } | undefined {
  const step = Number(/[#&]step=(\d+)/.exec(hash)?.[1] ?? 0), still = /[#&]still\b/.test(hash), t = /[#&]t=([\d.]+)/.exec(hash)?.[1];
  if (!tl || (!step && !still && t === undefined)) return undefined;
  const b = tl.beats[Math.min(tl.beats.length, Math.max(1, step)) - 1], f = Math.max(0, Math.min(1, t === undefined ? (still ? 0.6 : 0) : Number(t) || 0));
  const from = b?.start ?? 0, to = b?.end ?? tl.duration;
  return { at: from + Math.max(0, Math.min(to - from - (to < tl.duration ? 1 : 0), (to - from) * f)), still };
}

if (typeof customElements !== 'undefined' && !customElements.get('isometric-diagram')) customElements.define('isometric-diagram', IsometricDiagram);
/** A host's icons and screen faces, by the names its drawings use, and their styles: for every <isometric-diagram>, now and from now on. The
 *  engine has no one's marks of its own. Called again, the names it has before are replaced */
export function registerMarks(marks: Parameters<typeof register>[0]): void { register(marks); IsometricDiagram.redraw(); }
export { mountPlayer, PLAY_CSS } from '../iso-viewer/play.ts';
export type { Player, PlayerOptions } from '../iso-viewer/play.ts';
