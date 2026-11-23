// The player: runs each scene's steps in the browser. No dependencies; bundled to one small script and inlined.
// It reads the scene data from <script type="application/json" id="diagram-steps"> and the rendered SVG.
//
// Hash flags (for screenshots and links): #theme=light|dark, #still (no motion: tokens frozen mid-route),
// #scene=ID&step=N (open a scene at a step), #t=0.6 (where frozen tokens sit, 0..1), #motion (ignore reduced motion),
// #grid (show the floor grid), #assemble (play the assemble intro) and #assemble&at=MS (freeze it at that moment).

import { focusView } from '../iso-objects/focus.ts';

interface Token { route: string; kind: string; color: string }
interface Step {
  n: number; num: number; kind: string; color: string; heading: string; caption: string; command: string;
  phases: Token[][]; pulses: [number, number, number, number][]; lit: string[]; duration: number;
  focus?: [number, number, number, number];
}
interface Piece { id: string; kind: 'region' | 'node'; dx: number; dy: number; delay: number; dur: number }
interface Assembly { pieces: Piece[]; routes: { id: string; delay: number; dur: number }[]; labels: { delay: number; dur: number }; total: number }
interface SceneData {
  id: string; loop: boolean; dim: 'flows' | 'all'; steps: Step[]; vis: Record<string, boolean[]>;
  assemble: boolean; grid: boolean; assembly: Assembly;
}
interface Data { scenes: SceneData[] }

const NS = 'http://www.w3.org/2000/svg';
const TRAVEL = 1150;
const EASE_IN = 'cubic-bezier(.16,.84,.3,1)';

function svgEl(tag: string, attrs: Record<string, string | number>, parent: Element): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  parent.appendChild(e);
  return e;
}
const ease = (f: number) => (f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2);

function init() {
  const dataEl = document.getElementById('diagram-steps');
  if (!dataEl) return;
  const data = JSON.parse(dataEl.textContent || '{}') as Data;
  const hash = location.hash;
  const still = /still/.test(hash);
  const reduceMedia = matchMedia('(prefers-reduced-motion: reduce)').matches && !/motion/.test(hash);
  const reduce = still || reduceMedia;
  const frozenT = Math.max(0, Math.min(1, Number((/[#&]t=([\d.]+)/.exec(hash) || [])[1] ?? 0.6)));
  const wantScene = (/[#&]scene=([\w-]+)/.exec(hash) || [])[1];
  const wantStep = Number((/[#&]step=?(\d+)/.exec(hash) || [])[1] || 0);
  const wantGrid = /[#&]grid\b/.test(hash);
  const wantAssemble = /[#&]assemble\b/.test(hash);
  const assembleAt = (/[#&]at=(\d+)/.exec(hash) || [])[1];
  if (still) document.documentElement.classList.add('still');

  // #scene=ID opens the page at that scene (screenshots use #still, which keeps the page at the top)
  if (wantScene && !still) document.getElementById('scene-' + wantScene)?.scrollIntoView({ block: 'start' });

  const runners: { fig: Element; setActive(on: boolean): void }[] = [];
  for (const sd of data.scenes) {
    const sec = document.getElementById('scene-' + sd.id);
    if (sec) runners.push(makeRunner(sec, sd));
  }

  function makeRunner(sec: HTMLElement, sd: SceneData) {
    const STEPS = sd.steps, N = STEPS.length;
    const svg = sec.querySelector('svg')!, fig = sec.querySelector('.figure')!;
    const anim = svg.querySelector('.g-anim')!;
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
    const flowPath = (id: string) => svg.querySelector<SVGPathElement>(`[data-hl="${CSS.escape(id)}"] path.flow`);
    if (sd.dim === 'all') svg.classList.add('dim-all');

    let cur = 0, playing = false, userPaused = false, active = false, timer = 0, raf = 0, groups = 0, t0 = 0;
    let assembling = false, assembled = false, animations: Animation[] = [];
    let tokens: { path: SVGPathElement; len: number; gi: number; stop: boolean; c: SVGElement }[] = [];

    // ---- grid ----
    const setGrid = (on: boolean) => { svg.classList.toggle('show-grid', on); gridBtn?.setAttribute('aria-pressed', String(on)); };
    setGrid(sd.grid || wantGrid);
    gridBtn?.addEventListener('click', () => setGrid(!svg.classList.contains('show-grid')));

    STEPS.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'dot'; b.type = 'button'; b.setAttribute('aria-label', `Step ${s.num}: ${s.heading}`);
      b.addEventListener('click', () => { userPause(); finishAssemble(); show(i); });
      dots?.appendChild(b);
    });

    function clearAnim() { anim.textContent = ''; tokens = []; if (raf) cancelAnimationFrame(raf); raf = 0; }
    function tick(now: number) {
      const per = TRAVEL * groups + 700, tt = (now - t0) % per;
      for (const tk of tokens) {
        // frozen: every phase's token sits at the same point, so one picture shows them all
        const f = reduce ? frozenT : Math.max(0, Math.min(1, (tt - tk.gi * TRAVEL) / TRAVEL));
        let e = ease(f);
        if (tk.stop) e = f < 0.7 ? f / 0.7 : 1 - ((f - 0.7) / 0.3) * 0.25;   // a blocked token stalls and falls back
        const p = tk.path.getPointAtLength(Math.max(0, Math.min(1, e)) * tk.len);
        tk.c.setAttribute('cx', String(p.x)); tk.c.setAttribute('cy', String(p.y));
        tk.c.style.opacity = reduce ? '1' : f <= 0 || f >= 1 ? '0' : '1';
      }
      if (!reduce && active) raf = requestAnimationFrame(tick);
    }
    // ---- focus: ease the viewBox to a step's focus box (keeping the drawing's proportions), and back ----
    const FULL = svg.getAttribute('viewBox')!.split(/\s+/).map(Number);
    let view = FULL.slice(), zoomTimer = 0;
    const viewFor = (s: Step) => focusView(FULL, s.focus);
    function zoomTo(target: number[]) {
      clearTimeout(zoomTimer);
      if (target.every((v, k) => Math.abs(v - view[k]) < 0.5)) return;
      const from = view.slice(), t0z = performance.now(), D = reduce ? 0 : 900;
      // a timer, not a frame callback, so it also finishes where no frames are drawn
      const step = () => {
        const f = D ? Math.min(1, (performance.now() - t0z) / D) : 1, e = ease(f);
        view = from.map((v, k) => v + (target[k] - v) * e);
        svg.setAttribute('viewBox', view.map(v => v.toFixed(1)).join(' '));
        if (f < 1) zoomTimer = window.setTimeout(step, 16);
      };
      step();
    }

    function show(i: number) {
      if (!N) return;
      clearAnim();
      cur = i;
      const s = STEPS[i], n = s.n;
      zoomTo(svg.classList.contains("all") ? FULL : viewFor(s));
      const lit = new Set(s.lit);
      svg.classList.add('focus');
      for (const e of hlEls) e.classList.toggle('hl', e.dataset.hl!.split(' ').some(x => lit.has(x)));
      if (sd.dim === 'all') for (const e of idEls) if (e.hasAttribute('data-dim')) e.classList.toggle('hl', lit.has(e.dataset.id!));
      for (const e of stepEls) e.classList.toggle('on', e.dataset.step === String(n));
      svg.querySelectorAll<SVGElement>('[data-badge]').forEach(b => b.classList.toggle('on', b.dataset.badge === String(n)));
      for (const [id, els] of visEls) { const v = sd.vis[id][i]; for (const e of els) e.classList.toggle('pre', !v); }
      for (const [x, y, rx, ry] of s.pulses) svgEl('ellipse', { cx: x, cy: y, rx, ry, class: 'pulse', style: `stroke:${s.color}` }, anim);
      groups = s.phases.length;
      s.phases.forEach((ph, gi) => ph.forEach(tk => {
        const path = flowPath(tk.route);
        if (!path) return;
        tokens.push({ path, len: path.getTotalLength(), gi, stop: tk.kind === 'blocked', c: svgEl('circle', { r: 7, class: 'tok', style: `fill:${tk.color}` }, anim) });
      }));
      t0 = performance.now(); tick(t0);
      if (!reduce && active && !raf) raf = requestAnimationFrame(tick);
      num!.textContent = String(s.num); num!.style.background = s.color;
      hEl!.textContent = s.heading; cnt!.textContent = `${i + 1} / ${N}`;
      capT!.innerHTML = s.caption; capC!.textContent = s.command;
      prog!.style.setProperty('--c', s.color);
      [...dots!.children].forEach((d, j) => { d.classList.toggle('on', j === i); d.classList.toggle('done', j < i); });
      restartProg();
    }
    function restartProg() {
      if (!prog) return;
      prog.style.transition = 'none';
      prog.style.width = playing ? '0%' : ((cur + 1) / N * 100) + '%';
      if (playing) { void prog.offsetWidth; prog.style.transition = `width ${STEPS[cur].duration}ms linear`; prog.style.width = '100%'; }
    }
    function schedule() {
      clearTimeout(timer);
      if (!playing) return;
      timer = window.setTimeout(() => {
        if (cur === N - 1 && !sd.loop) { stop(); return; }
        show((cur + 1) % N); schedule();
      }, STEPS[cur].duration);
    }
    function setBtn() {
      if (!playBtn) return;
      playBtn.textContent = playing ? '❚❚ Pause' : '▶ Play';
      playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      capBox?.setAttribute('aria-live', playing ? 'off' : 'polite');
    }
    function play() { if (reduce || !N || assembling) return; playing = true; setBtn(); restartProg(); schedule(); }
    function stop() { playing = false; clearTimeout(timer); setBtn(); restartProg(); }
    function userPause() { userPaused = true; stop(); }

    // ---- assemble: regions and nodes fly in from the nearest edge, routes draw in, labels fade in ----
    const A = sd.assembly;
    const layer = (name: string) => svg.querySelector(`.g-${name}`);
    function finishAssemble() {
      if (!assembling) return;
      for (const a of animations) a.finish();
    }
    function assemble(freezeAt?: number) {
      for (const a of animations) a.cancel();
      animations = [];
      stop();
      if (N) show(cur);          // set what is visible at this step; focus comes back at the end
      clearAnim();
      svg.classList.remove('focus', 'pre-assemble', 'all');
      assembling = true;
      const run = (el: Element, frames: Keyframe[], delay: number, dur: number, easing = EASE_IN) =>
        animations.push(el.animate(frames, { delay, duration: dur, easing, fill: 'backwards' }));
      const solid = ['base', 'blocks', 'air'].map(layer).filter(Boolean) as Element[];
      for (const p of A.pieces) {
        const from = `translate(${p.dx}px, ${p.dy}px)`;
        for (const L of solid) L.querySelectorAll(`[data-id="${CSS.escape(p.id)}"]`).forEach(el =>
          run(el, [{ transform: from }, { transform: 'translate(0px, 0px)' }], p.delay, p.dur));
      }
      for (const r of A.routes) {
        const g = layer('flows')?.querySelector(`[data-hl="${CSS.escape(r.id)}"]`);
        const path = g?.querySelector<SVGPathElement>('path.flow');
        if (!g || !path) continue;
        const len = path.getTotalLength();
        run(g, [{ opacity: 0 }, { opacity: 1 }], r.delay, 80, 'linear');
        run(path, [{ strokeDasharray: `${len} ${len}`, strokeDashoffset: len }, { strokeDasharray: `${len} ${len}`, strokeDashoffset: 0 }], r.delay, r.dur, 'ease-out');
      }
      for (const name of ['floor', 'labels', 'badges']) {
        const L = layer(name);
        if (L) run(L, [{ opacity: 0 }, { opacity: 1 }], A.labels.delay, A.labels.dur, 'ease-out');
      }
      if (freezeAt !== undefined) {
        for (const a of animations) { a.pause(); a.currentTime = freezeAt; }
        return;
      }
      Promise.all(animations.map(a => a.finished)).then(() => {
        assembling = false; assembled = true; animations = [];
        if (N) show(cur);
        if (active && !userPaused) play();
      }, () => { /* replaced by a newer run */ });
    }
    asmBtn?.addEventListener('click', () => { userPaused = false; assemble(); });

    function setActive(on: boolean) {
      if (on === active) return;
      active = on;
      if (on) {
        if (!reduce) { t0 = performance.now(); raf = requestAnimationFrame(tick); }
        if (!userPaused) play();
      } else { stop(); if (raf) cancelAnimationFrame(raf); raf = 0; }
    }
    playBtn?.addEventListener('click', () => {
      if (playing) userPause();
      else { userPaused = false; finishAssemble(); if (cur === N - 1) show(0); play(); }
    });
    q('[data-a=next]')?.addEventListener('click', () => { userPause(); finishAssemble(); show(Math.min(N - 1, cur + 1)); });
    q('[data-a=prev]')?.addEventListener('click', () => { userPause(); finishAssemble(); show(Math.max(0, cur - 1)); });
    fig.addEventListener('keydown', e => {
      const k = (e as KeyboardEvent).key;
      if (!N) return;
      if (k === 'ArrowRight') { e.preventDefault(); userPause(); finishAssemble(); show(Math.min(N - 1, cur + 1)); }
      if (k === 'ArrowLeft') { e.preventDefault(); userPause(); finishAssemble(); show(Math.max(0, cur - 1)); }
    });
    svg.querySelectorAll<SVGElement>('.badge').forEach(b => {
      const go = () => { userPause(); finishAssemble(); show(Number(b.dataset.go) - 1); };
      b.addEventListener('click', go);
      b.addEventListener('keydown', e => { const k = (e as KeyboardEvent).key; if (k === 'Enter' || k === ' ') { e.preventDefault(); go(); } });
    });

    const forced = wantStep && (!wantScene || wantScene === sd.id) ? Math.min(N, wantStep) - 1 : -1;
    const frozenAssemble = wantAssemble && assembleAt !== undefined && (!wantScene || wantScene === sd.id);
    if (reduce && forced < 0 && !still && !frozenAssemble) {
      // reduced motion: the whole diagram, everything lit, the step list open, no assembly
      if (N) { svg.classList.add('all'); show(N - 1); }
      if (playBtn) { playBtn.disabled = true; playBtn.textContent = 'Motion off'; }
      if (asmBtn) asmBtn.disabled = true;
      sec.querySelector('details.steps')?.setAttribute('open', '');
    } else {
      if (N) show(forced >= 0 ? forced : 0);
      if (reduce && playBtn) { playBtn.disabled = true; playBtn.textContent = 'Motion off'; }
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
    return { fig, setActive };
  }

  // only the most visible scene animates
  if (!reduce) {
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
