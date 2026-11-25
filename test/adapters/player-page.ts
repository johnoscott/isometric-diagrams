// The player's page: the stepped build in a shadow root, its stylesheet adopted, on a clock moved by hand, for test/player.test.ts.
import { parse } from 'yaml';
import { compile } from '../../src/iso-systems/compile.ts';
import { bindMotion } from '../../src/iso-objects/timeline.ts';
import type { MotionDoc } from '../../src/iso-objects/motion-doc.ts';
import { svgAt, type SceneState } from '../../src/iso-objects/motion.ts';
import { mountPlayer, PLAY_CSS, type Player, type PlayerOptions } from '../../src/iso-viewer/play.ts';
import THEME from '../../themes/default.yaml';
import BUILD from '../fixtures/motion/stepped-build.yaml';
import MOTION from '../fixtures/motion/stepped-build.motion.yaml';

const errors: string[] = [];
addEventListener('error', e => errors.push(e.message));
addEventListener('securitypolicyviolation', e => errors.push(`CSP ${e.violatedDirective} ${e.blockedURI} ${e.sample} ${e.lineNumber}:${e.columnNumber}`));
let now = 0, waiting: (() => void) | undefined;
const clock = { now: () => now, next(f: () => void) { waiting = f; return f; }, cancel() { waiting = undefined; } };
const scene = (mode: 'light' | 'dark' = 'light', text: string = BUILD) => { const c = compile(text, THEME, { mode, resolveVars: true, strict: 'throw' }); return { s: c.scenes[0], kinds: c.theme!.kinds }; };
const tl = (doc: unknown, mode: 'light' | 'dark' = 'light') => { const { s, kinds } = scene(mode); return bindMotion(s, doc as MotionDoc, { kinds }); };
const host = document.getElementById('app')!, shadow = host.attachShadow({ mode: 'open' }), sheet = new CSSStyleSheet();
sheet.replaceSync(PLAY_CSS + ':host{display:block}');
shadow.adoptedStyleSheets = [sheet];
const api: { [k: string]: any; player?: Player } = {
  errors, doc: parse(MOTION) as { series: unknown[] }, shadow,
  player: undefined as Player | undefined,
  mount(o: Partial<PlayerOptions> = {}, doc: unknown = api.doc) {
    api.player?.dispose(); now = 0; waiting = undefined;
    api.player = mountPlayer(shadow, { scene: scene(o.mode).s, timeline: doc ? tl(doc, o.mode) : undefined, clock, ...o });
  },
  /** one that paints itself: the times it was asked for, in order, and whether each was on the drawing that is there. (Its Timeline has a state, which
   *  would show if it were painted too) */
  asked: [] as number[], on: [] as boolean[],
  own(o: Partial<PlayerOptions> = {}, length = 900, text?: string) {
    api.player?.dispose(); now = 0; waiting = undefined; api.asked = []; api.on = [];
    const self = (t?: string) => ({ ...scene(o.mode, t).s, paint(svg: SVGSVGElement, ms: number) { api.asked.push(ms); api.on.push(svg === shadow.querySelector('.iso-play-stage svg')); svg.setAttribute('data-ms', String(Math.round(ms))); } });
    api.self = self;
    api.player = mountPlayer(shadow, { scene: self(text), timeline: { ok: true, diags: [], duration: length, beats: [], markers: {}, ambient: 'on', loops: false, at: () => ({ items: Object.fromEntries(scene().s.layout.items.map(p => [p.id, { opacity: 0.5, dx: 9 }])) }), cues: () => undefined, beatAt: () => undefined, startOf: () => undefined }, clock, ...o });
  },
  set: (doc: unknown, mode: 'light' | 'dark' = 'light') => api.player!.set(scene(mode).s, tl(doc, mode), mode),
  go(ms: number, n = 1) { for (let i = 0; i < n; i++) { now += ms; const f = waiting; waiting = undefined; f?.(); } },
  q: (s: string) => shadow.querySelector(s) as HTMLElement,
  text: (s: string) => (shadow.querySelector(s)?.textContent ?? '').trim(),
  /** the drawing as it stands against what svgAt writes for a state (a style's text as the browser writes it) */
  same(S: SceneState, mode: 'light' | 'dark' = 'light') {
    // (as text: parsing a style's attribute is what the CSP forbids)
    const scratch = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const norm = (text: string) => text.replace(/ (?:style|data-st)="([^"]*)"/g, (_m, t: string) => { scratch.style.cssText = t; const c = scratch.style.cssText; return c ? ` style="${c}"` : ''; });
    const want = new DOMParser().parseFromString(svgAt(scene(mode).s, S).replace(/ style="/g, ' data-st="'), 'image/svg+xml').documentElement, live = shadow.querySelector('.iso-play-stage svg')!.cloneNode(true) as Element;
    for (const e of live.querySelectorAll('[data-badge]')) e.classList.remove('on');
    const a = norm(new XMLSerializer().serializeToString(live)), b = norm(new XMLSerializer().serializeToString(want));
    if (a === b) return '';
    let i = 0; while (a[i] === b[i]) i++;
    return `${a.slice(Math.max(0, i - 60), i + 80)} ≠ ${b.slice(Math.max(0, i - 60), i + 80)}`;
  },
};
(window as unknown as { __play: unknown }).__play = api;
document.title = 'ready';
