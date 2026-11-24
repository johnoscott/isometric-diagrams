// The player: runs each scene's steps in the browser. No dependencies; bundled to one small script and inlined.
// It reads the scene data from <script type="application/json" id="diagram-steps"> and the rendered SVG.
//
// Hash flags (for screenshots and links): #theme=light|dark, #still (no motion: tokens frozen mid-route),
// #scene=ID&step=N (open a scene at a step), #t=0.6 (where frozen tokens sit, 0..1), #motion (no Motion off button),
// #grid (show the floor grid), #assemble (play the assemble intro) and #assemble&at=MS (freeze it at that moment).

//
// Motion plays, also for a reader who asked their machine for less (docs/design/MOTION.md, 6.2): they get a Motion off button in each figure.
//
// One clock: a transport (transport.ts) over the scene's Timeline, for the steps, their tokens, pulses and camera, and another over the
// assemble intro's plan. What a step dims, hides and lights is the page's stylesheet's, by classes, when its beat begins.

import { paint, planOf, type SceneState } from '../iso-objects/motion.ts';
import { bindMotion, type MotionSource, type Timeline } from '../iso-objects/timeline.ts';
import type { MotionDoc } from '../iso-objects/motion-doc.ts';
import { transport } from './transport.ts';

interface Token { route: string; kind: string; color: string }
interface Step {
  n: number; num: number; kind: string; color: string; heading: string; caption: string; command: string;
  phases: Token[][]; pulses: [number, number, number, number][]; lit: string[]; duration: number;
}
interface SceneData {
  id: string; loop: boolean; dim: 'flows' | 'all'; steps: Step[]; vis: Record<string, boolean[]>;
  assemble: boolean; grid: boolean; source: MotionSource;
  /** the steps as a motion document, or the scene's own */
  doc?: MotionDoc;
  /** the scene's own motion: everything is the Timeline's, what is dimmed and hidden too */
  own?: boolean;
}
interface Data { scenes: SceneData[] }

const ease = (f: number) => (f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2);
const none: Timeline = { ok: true, diags: [], duration: 0, beats: [], markers: {}, ambient: 'on', loops: false, at: () => ({}), cues: () => undefined, beatAt: () => undefined, startOf: () => undefined };

function init() {
  const dataEl = document.getElementById('diagram-steps');
  if (!dataEl) return;
  const data = JSON.parse(dataEl.textContent || '{}') as Data;
  const hash = location.hash;
  const still = /still/.test(hash);
  const asked = matchMedia('(prefers-reduced-motion: reduce)').matches && !still && !/motion/.test(hash);
  /** nothing moves: a still page, or Motion off pressed */
  let reduce = still;
  const frozenT = Math.max(0, Math.min(1, Number((/[#&]t=([\d.]+)/.exec(hash) || [])[1] ?? 0.6)));
  const wantScene = (/[#&]scene=([\w-]+)/.exec(hash) || [])[1];
  const wantStep = Number((/[#&]step=?(\d+)/.exec(hash) || [])[1] || 0);
  const wantGrid = /[#&]grid\b/.test(hash);
  const wantAssemble = /[#&]assemble\b/.test(hash);
  const assembleAt = (/[#&]at=(\d+)/.exec(hash) || [])[1];
  if (still) document.documentElement.classList.add('still');

  // #scene=ID opens the page at that scene (screenshots use #still, which keeps the page at the top)
  if (wantScene && !still) document.getElementById('scene-' + wantScene)?.scrollIntoView({ block: 'start' });

  const runners: { fig: Element; setActive(on: boolean): void; setMotion(): void }[] = [];
  const offBtns: HTMLButtonElement[] = [];
  for (const sd of data.scenes) {
    const sec = document.getElementById('scene-' + sd.id);
    if (sec) runners.push(makeRunner(sec, sd));
  }

  function makeRunner(sec: HTMLElement, sd: SceneData) {
    const STEPS = sd.steps, N = STEPS.length;
    const svg = sec.querySelector('svg')!, fig = sec.querySelector('.figure')!;
    const q = <T extends Element>(s: string) => sec.querySelector(s) as T | null;
    const num = q<HTMLElement>('.cap-h .num'), hEl = q<HTMLElement>('.cap-h .h'), cnt = q<HTMLElement>('.cap-h .cnt');
    const capT = q<HTMLElement>('.cap-t'), capC = q<HTMLElement>('.cap-c'), prog = q<HTMLElement>('.prog i'), dots = q<HTMLElement>('.dots');
    const capBox = q<HTMLElement>('.cap'), playBtn = q<HTMLButtonElement>('[data-a=play]');
    const gridBtn = q<HTMLButtonElement>('[data-a=grid]'), asmBtn = q<HTMLButtonElement>('[data-a=assemble]');
    const hlEls = [...svg.querySelectorAll<SVGElement>('[data-hl]')];
    const stepEls = [...svg.querySelectorAll<SVGElement>('[data-step]')];
    const idEls = [...svg.querySelectorAll<SVGElement>('[data-id]')];
    const visEls = new Map<string, SVGElement[]>();
    for (const e of idEls) if (sd.vis[e.dataset.id!]) { const l = visEls.get(e.dataset.id!) ?? []; l.push(e); visEls.set(e.dataset.id!, l); }
    for (const e of hlEls) { const id = e.dataset.hl!; if (sd.vis[id] && !e.dataset.id) { const l = visEls.get(id) ?? []; l.push(e); visEls.set(id, l); } }
    if (sd.dim === 'all') svg.classList.add('dim-all');

    const bound = sd.doc ? bindMotion(sd.source, sd.doc) : none, tl = bound.ok ? bound : none;
    const tr = transport(tl, { loop: sd.loop });
    tr.active = false;
    let cur = 0, userPaused = false, active = false, stepping = false;
    let assembling = false, assembled = false;

    // ---- grid ----
    const setGrid = (on: boolean) => { svg.classList.toggle('show-grid', on); gridBtn?.setAttribute('aria-pressed', String(on)); };
    setGrid(sd.grid || wantGrid);
    gridBtn?.addEventListener('click', () => setGrid(!svg.classList.contains('show-grid')));

    STEPS.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'dot'; b.type = 'button'; b.setAttribute('aria-label', `Step ${s.num}: ${s.heading}`);
      b.addEventListener('click', () => { userPause(); finishAssemble(); show(i, true); });
      dots?.appendChild(b);
    });

    // ---- what is drawn now ----
    const inkOf = new Map(STEPS.flatMap(s => s.phases.flat().map(t => [t.kind, t.color] as const)));
    /** the Timeline's state as the page draws it: its tokens and pulses in the step's colours; the rest is its classes' */
    function drawn(): SceneState {
      const S: SceneState = reduce ? frozen() : tr.state(), s = STEPS[cur];
      if (sd.own || !s) return S;
      const out: SceneState = {};
      if (S.camera && !svg.classList.contains('all')) out.camera = S.camera;
      if (S.tokens) out.tokens = S.tokens.map(k => ({ ...k, color: k.color ?? (k.kind === undefined ? undefined : inkOf.get(k.kind)) }));
      // (each ring grows from a third of its size to half as much again, and fades)
      if (reduce) { if (s.pulses.length) out.pulses = s.pulses.map(([x, y, rx, ry]) => ({ x, y, rx, ry, opacity: 0.85, color: s.color })); }
      else if (S.pulses) out.pulses = s.pulses.flatMap(([x, y, rx, ry], k) => { const p = S.pulses![k]; if (!p) return []; const f = 1 - Math.pow(p.opacity ?? 1, 2), z = 0.35 + 1.15 * f; return [{ x, y, rx: rx * z, ry: ry * z, opacity: 0.95 * (1 - f), color: s.color }]; });
      return out;
    }
    /** frozen: every phase's token at the same point, so one picture shows them all; the camera where the step leaves it */
    function frozen(): SceneState {
      const s = STEPS[cur], b = tl.beats[cur];
      if (!s || !b) return {};
      const S = tl.at(Math.max(b.start, b.end - 1), { ambient: 'off' });
      if (sd.own) return S;
      const at = (kind: string) => (kind === 'blocked' ? (frozenT < 0.7 ? frozenT / 0.7 : 1 - ((frozenT - 0.7) / 0.3) * 0.25) : ease(frozenT));
      return { ...(S.camera ? { camera: S.camera } : {}), tokens: s.phases.flat().map(t => ({ route: t.route, at: at(t.kind), kind: t.kind })) };
    }
    const draw = () => {
      if (assembling) return;
      paint(svg, drawn());
      if (prog && N) prog.style.width = (going() ? (tl.cues(tr.time)?.progress ?? 0) * 100 : ((cur + 1) / N) * 100) + '%';
    };
    const going = () => tr.playing && !stepping;

    /** the page at a step: what is lit, dimmed and hidden, the words; nothing moves by this */
    function look(i: number) {
      const s = STEPS[i], n = s.n;
      cur = i;
      const lit = new Set(s.lit);
      if (!sd.own) {
        svg.classList.add('focus');
        for (const e of hlEls) e.classList.toggle('hl', e.dataset.hl!.split(' ').some(x => lit.has(x)));
        if (sd.dim === 'all') for (const e of idEls) if (e.hasAttribute('data-dim')) e.classList.toggle('hl', lit.has(e.dataset.id!));
        for (const [id, els] of visEls) { const v = sd.vis[id][i]; for (const e of els) e.classList.toggle('pre', !v); }
      }
      for (const e of stepEls) e.classList.toggle('on', e.dataset.step === String(n));
      svg.querySelectorAll<SVGElement>('[data-badge]').forEach(b => b.classList.toggle('on', b.dataset.badge === String(n)));
      num!.textContent = String(s.num); num!.style.background = s.color;
      hEl!.textContent = s.heading; cnt!.textContent = `${i + 1} / ${N}`;
      capT!.innerHTML = s.caption; capC!.textContent = s.command;
      prog!.style.setProperty('--c', s.color);
      [...dots!.children].forEach((d, j) => { d.classList.toggle('on', j === i); d.classList.toggle('done', j < i); });
    }
    /** to a step's start; `through`: and through it, to a stop in it */
    function show(i: number, through = false) {
      const b = tl.beats[i];
      if (!N || !b) return;
      tr.pause();
      look(i);
      tr.seek(b.start, { join: true });
      if (through && !reduce && active) { stepping = true; tr.play({ until: Math.max(b.start + 1, b.end - 1) }); setBtn(); }
      draw();
    }
    function setBtn() {
      if (!playBtn) return;
      playBtn.disabled = reduce;
      if (reduce) { playBtn.textContent = 'Motion off'; return; }
      const on = going();
      playBtn.textContent = on ? '❚❚ Pause' : '▶ Play';
      playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
      capBox?.setAttribute('aria-live', on ? 'off' : 'polite');
    }
    function play() { if (reduce || !N || assembling) return; if (stepping) tr.pause(); stepping = false; tr.play(); setBtn(); draw(); }
    function stop() { tr.pause(); }
    function userPause() { userPaused = true; stop(); }
    tr.on('time', draw);
    tr.on('beat', b => { if (b.index !== cur) look(b.index); });
    tr.on('pause', () => { stepping = false; setBtn(); draw(); });

    // ---- assemble: the motion core's plan (the same a video is made from), on a transport of its own ----
    const plan = planOf(sd.source.model, 'assemble');
    let intro: ReturnType<typeof transport> | undefined;
    function finishAssemble() {
      if (!assembling || !intro) return;
      intro.dispose(); intro = undefined;
      assembling = false; assembled = true;
      paint(svg, {});
      if (N) show(cur);
      if (active && !userPaused) play();
    }
    function assemble(freezeAt?: number) {
      intro?.dispose(); intro = undefined;
      stop();
      if (N) show(cur);          // set what is visible at this step; focus comes back at the end
      svg.classList.remove('focus', 'pre-assemble', 'all');
      assembling = true;
      if (freezeAt !== undefined) { paint(svg, plan.at(freezeAt)); return; }
      const run = intro = transport({ ...none, duration: plan.duration, at: t => plan.at(t) });
      run.on('time', t => paint(svg, plan.at(t)));
      run.on('end', finishAssemble);
      paint(svg, plan.at(0));
      run.play();
    }
    asmBtn?.addEventListener('click', () => { userPaused = false; assemble(); });

    function setActive(on: boolean) {
      if (on === active) return;
      active = on;
      tr.active = on && !reduce;
      if (on) { if (!userPaused) play(); } else stop();
    }
    playBtn?.addEventListener('click', () => {
      if (going()) userPause();
      else { userPaused = false; finishAssemble(); if (cur === N - 1 && !going()) show(0); play(); }
    });
    q('[data-a=next]')?.addEventListener('click', () => { userPause(); finishAssemble(); show(Math.min(N - 1, cur + 1), true); });
    q('[data-a=prev]')?.addEventListener('click', () => { userPause(); finishAssemble(); show(Math.max(0, cur - 1), true); });
    fig.addEventListener('keydown', e => {
      const k = (e as KeyboardEvent).key;
      if (!N) return;
      if (k === 'ArrowRight') { e.preventDefault(); userPause(); finishAssemble(); show(Math.min(N - 1, cur + 1), true); }
      if (k === 'ArrowLeft') { e.preventDefault(); userPause(); finishAssemble(); show(Math.max(0, cur - 1), true); }
    });
    svg.querySelectorAll<SVGElement>('.badge').forEach(b => {
      const go = () => { userPause(); finishAssemble(); show(Number(b.dataset.go) - 1, true); };
      b.addEventListener('click', go);
      b.addEventListener('keydown', e => { const k = (e as KeyboardEvent).key; if (k === 'Enter' || k === ' ') { e.preventDefault(); go(); } });
    });

    const forced = wantStep && (!wantScene || wantScene === sd.id) ? Math.min(N, wantStep) - 1 : -1;
    const frozenAssemble = wantAssemble && assembleAt !== undefined && (!wantScene || wantScene === sd.id);
    if (N) show(forced >= 0 ? forced : 0);
    setBtn();
    /** off: the whole diagram, everything lit, the step list open, no intro; on again: from the first step */
    function setMotion() {
      svg.classList.remove('pre-assemble');
      if (reduce) { assembled = true; finishAssemble(); stop(); }
      svg.classList.toggle('all', reduce && N > 0);
      tr.active = active && !reduce;
      if (asmBtn) asmBtn.disabled = reduce;
      if (reduce) sec.querySelector('details.steps')?.setAttribute('open', '');
      if (N) show(reduce ? N - 1 : 0);
      setBtn();
      if (!reduce && active && !userPaused) play();
    }
    const tools = q<HTMLElement>('.tools');
    if (asked && tools) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pbtn small'; b.dataset.a = 'motion'; b.textContent = 'Motion off'; b.title = 'Draw everything in place, with nothing moving';
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => { reduce = !reduce; for (const x of offBtns) x.setAttribute('aria-pressed', String(reduce)); for (const r of runners) r.setMotion(); });
      offBtns.push(b); tools.appendChild(b);
    }
    if (frozenAssemble) assemble(Number(assembleAt));
    else if ((sd.assemble || wantAssemble) && !reduce && !(window as unknown as { __diagramNoIntro?: boolean }).__diagramNoIntro) {
      // hidden until it comes into view, then drawn piece by piece. The trigger is its own, so a figure taller
      // than the window still starts once as much of it shows as can.
      svg.classList.add('pre-assemble');
      let io: IntersectionObserver | undefined;
      const start = () => { io?.disconnect(); removeEventListener('scroll', check); if (!assembled && !assembling) assemble(); };
      const enough = (r: DOMRect) => {
        const seen = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / Math.max(1, r.height);
        return seen > 0 && seen >= Math.min(0.3, (innerHeight / Math.max(1, r.height)) * 0.8);
      };
      // An observer for scrolling into view, and a plain check as well: some browsers and webviews are slow to
      // deliver the observer's first callback, and the figure must not stay hidden.
      function check() { if (enough(fig.getBoundingClientRect())) start(); }
      if ('IntersectionObserver' in window) {
        io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting && enough(e.boundingClientRect)) start(); },
          { threshold: [0, 0.05, 0.1, 0.2, 0.3, 0.5] });
        io.observe(fig);
      }
      addEventListener('scroll', check, { passive: true });
      setTimeout(check, 60);
    }
    return { fig, setActive, setMotion };
  }

  // only the most visible scene animates
  if (!still) {
    const ratio = new Map<Element, number>();
    const pick = () => {
      let best: typeof runners[number] | undefined, br = 0;
      for (const r of runners) { const v = ratio.get(r.fig) || 0; if (v > br) { br = v; best = r; } }
      for (const r of runners) r.setActive(r === best && br >= 0.35);
    };
    // the observer, plus a plain measurement on load and on scroll, for browsers slow to deliver the observer
    const measure = () => {
      for (const r of runners) {
        const b = r.fig.getBoundingClientRect();
        ratio.set(r.fig, Math.max(0, Math.min(b.bottom, innerHeight) - Math.max(b.top, 0)) / Math.max(1, b.height));
      }
      pick();
    };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(entries => {
        for (const e of entries) ratio.set(e.target, e.isIntersecting ? e.intersectionRatio : 0);
        pick();
      }, { threshold: [0, 0.2, 0.35, 0.5, 0.7, 0.9, 1] });
      for (const r of runners) io.observe(r.fig);
    }
    let pending = 0;
    addEventListener('scroll', () => { if (!pending) pending = window.setTimeout(() => { pending = 0; measure(); }, 120); }, { passive: true });
    setTimeout(measure, 80);
  } else {
    for (const r of runners) r.setActive(true);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
