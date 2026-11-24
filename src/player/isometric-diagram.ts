// <isometric-diagram> (docs/design/MOTION.md, 6.2): a drawing's text in a page, drawn and played, as Mermaid does it. An app on the
// layers: the compiler (the systems pack), the Timeline, the player. One script, nothing fetched, nothing stored, no style element.
//
//   <script type="module" src="isometric-diagram.js"></script>
//   <isometric-diagram controls autoplay="visible" loop>
//     <script type="text/yaml"> isodiag: 1 … </script>          (or the text itself, with & and < escaped)
//   </isometric-diagram>

import { compile, type Compiled, type CompiledScene } from '../iso-systems/compile.ts';
import { bindMotion, motionOfSteps, type BeatInfo, type Timeline } from '../iso-objects/timeline.ts';
import type { MotionDoc } from '../iso-objects/motion-doc.ts';
import { mountPlayer, PLAY_CSS, type Player } from '../iso-viewer/play.ts';
import type { Transport } from '../iso-viewer/transport.ts';
import THEME from '../../themes/default.yaml';

const HOST_CSS = ':host{display:block}:host([hidden]){display:none}.iso-play-problem{margin:0;padding:10px 12px;border:1px solid #c9463d;border-radius:8px;color:#c9463d;font:13px/1.5 system-ui,sans-serif;white-space:pre-wrap}';
let sheet: CSSStyleSheet | undefined;

/** a page with no DOM (a server that imports this) has no elements: the class is there, and does nothing */
const Base = (typeof HTMLElement === 'function' ? HTMLElement : class {}) as typeof HTMLElement;

export class IsometricDiagram extends Base {
  static readonly observedAttributes = ['ambient', 'autoplay', 'controls', 'label', 'loop', 'mode', 'rate', 'reduced-motion', 'scene', 'treatment'];
  #source: string | undefined;
  #theme: string | undefined;
  #motion: MotionDoc | undefined;
  #player: Player | undefined;
  #shadow: ShadowRoot | undefined;
  #due = false;
  #steps = false;
  #media: MediaQueryList | undefined;

  /** the drawing's text: the property when set, else what is written in the element */
  get source(): string { return this.#source ?? dedent(this.querySelector('script[type="text/yaml"],script[type="application/yaml"]')?.textContent ?? this.textContent ?? ''); }
  set source(v: string) { this.#source = v; this.#later(); }
  /** the theme's text (default: the engine's) */
  get theme(): string { return this.#theme ?? THEME; }
  set theme(v: string | undefined) { this.#theme = v; this.#later(); }
  /** the motion (default: the scene's own in the file, or its steps) */
  get motion(): MotionDoc | undefined { return this.#motion; }
  set motion(v: MotionDoc | undefined) { this.#motion = v; this.#later(); }
  /** once drawn: play, pause, seek, beats, the ambient switch */
  get transport(): Transport | undefined { return this.#player?.transport; }

  connectedCallback() {
    this.#shadow ??= this.attachShadow({ mode: 'open' });
    sheet ??= (() => { const s = new CSSStyleSheet(); s.replaceSync(PLAY_CSS + HOST_CSS); return s; })();
    this.#shadow.adoptedStyleSheets = [sheet];
    this.#media = matchMedia('(prefers-color-scheme: dark)');
    this.#media.addEventListener('change', this.#later);
    // (while the page is still being read, what is in the element may not all be there yet)
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', this.#later, { once: true }); else this.#later();
  }
  disconnectedCallback() {
    this.#media?.removeEventListener('change', this.#later);
    document.removeEventListener('DOMContentLoaded', this.#later);
    this.#player?.dispose(); this.#player = undefined;
  }
  attributeChangedCallback(name: string, was: string | null, now: string | null) {
    const tr = this.#player?.transport;
    if (was === now) return;
    if (!tr) { this.#later(); return; }
    // what the transport takes as it plays; the rest is drawn again
    if (name === 'loop') tr.loop = now !== null;
    else if (name === 'rate') tr.rate = rateOf(now);
    else if (name === 'ambient') tr.ambient = now === null ? tr.timeline.ambient === 'on' : now !== 'off';
    else { if (name !== 'mode' && name !== 'scene' && name !== 'treatment') { this.#player!.dispose(); this.#player = undefined; } this.#later(); }
  }
  /** once, after everything set together */
  readonly #later = () => {
    if (this.#due || !this.isConnected) return;
    this.#due = true;
    queueMicrotask(() => { this.#due = false; if (this.isConnected) this.#draw(); });
  };

  #draw() {
    const root = this.#shadow!, mode = this.#mode();
    let drawn: { c: Compiled; s: CompiledScene; tl?: Timeline; steps: boolean };
    try { drawn = read(this.source, this.theme, mode, this.getAttribute('scene'), this.#motion, this.getAttribute('treatment')); } catch (e) {
      this.#player?.dispose(); this.#player = undefined;
      const p = document.createElement('p');
      p.className = 'iso-play-problem'; p.setAttribute('role', 'alert'); p.textContent = (e as Error).message;
      root.replaceChildren(p);
      this.dispatchEvent(new CustomEvent('isometric-error', { detail: (e as Error).message }));
      return;
    }
    // (the drawing's own steps have marks of their own, which another document hasn't)
    if (this.#player && this.#steps !== drawn.steps) { this.#player.dispose(); this.#player = undefined; }
    this.#steps = drawn.steps;
    if (this.#player) { this.#player.set(drawn.s, drawn.tl, mode); return; }
    root.replaceChildren();
    const at = this.getAttribute('autoplay'), link = linkOf(this.hasAttribute('links') ? location.hash : '', drawn.tl);
    this.#player = mountPlayer(root, {
      scene: drawn.s, timeline: drawn.tl, mode, steps: drawn.steps, label: this.getAttribute('label') ?? drawn.s.raw.title ?? drawn.c.doc?.title,
      controls: this.hasAttribute('controls'), loop: this.hasAttribute('loop'), rate: rateOf(this.getAttribute('rate')),
      autoplay: link ? false : at === 'visible' ? 'visible' : at !== null,
      ...(this.getAttribute('ambient') === null ? {} : { ambient: this.getAttribute('ambient') === 'off' ? 'off' as const : 'on' as const }),
      reducedMotion: this.getAttribute('reduced-motion') === 'respect' ? 'respect' : 'ignore',
    });
    const tr = this.#player.transport, tell = (type: string, detail?: unknown) => this.dispatchEvent(new CustomEvent(type, { detail }));
    tr.on('beat', (beat: BeatInfo, how) => tell('beat', { beat, how }));
    for (const k of ['play', 'pause', 'end', 'loop'] as const) tr.on(k, () => tell(k));
    if (link) { if (link.still) this.#player.freeze(link.at); else tr.seek(link.at); }
    tell('isometric-ready');
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
function read(source: string, theme: string, mode: 'light' | 'dark', scene: string | null, motion: MotionDoc | undefined, treatment: string | null) {
  if (!source.trim()) throw new Error('no drawing: its text goes in the element, or in its source');
  if (treatment !== null && treatment !== 'mono' && treatment !== 'none') throw new Error(`no treatment "${treatment}" (there is mono, and none)`);
  const c = compile(source, theme, { mode, resolveVars: true, strict: 'throw', ...(treatment ? { treatment } : {}) });
  const s = scene === null ? c.scenes[0] : c.scenes.find(x => x.id === scene);
  if (!s) throw new Error(scene === null ? 'no scene in it' : `no scene "${scene}" (there ${c.scenes.length === 1 ? 'is' : 'are'} ${c.scenes.map(x => x.id).join(', ')})`);
  const doc = motion ?? s.motion ?? (s.steps.steps.length ? motionOfSteps(s) : undefined);
  const tl = doc && bindMotion(s, doc, { kinds: c.theme!.kinds });
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
export { mountPlayer, PLAY_CSS } from '../iso-viewer/play.ts';
export type { Player, PlayerOptions } from '../iso-viewer/play.ts';
