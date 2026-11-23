// The site's one script: live drawings (3D | 2D, with the morph) where a page has them, the playground, copy buttons,
// the gallery's filter, the API's filter, and the light | dark switch. The engine comes from its sources, the schema
// precompiled (scripts/build-site.ts), so nothing is evaluated from a string.
import THEME from '../themes/default.yaml';
import { compile } from '../src/iso-systems/compile.ts';
import { DRAWING_CSS } from '../src/iso-systems/css.ts';
import { MARKS_CSS } from '../src/iso-objects/css.ts';
import { loadTheme, themeCss } from '../src/iso-core/theme.ts';
import { dualView, viewToggle, DUAL_VIEW_CSS, type DualView } from '../src/iso-viewer/dual-view.ts';
import { flatCss, type FlatStyle } from '../src/iso-viewer/flat-view.ts';

const STYLES: Record<string, FlatStyle> = {
  user: { color: 'user' }, send: { color: 'send' }, reply: { color: 'reply' }, event: { color: 'event' }, control: { color: 'control' },
  token: { color: 'token', dash: '5 4' }, blocked: { color: 'blocked', dash: '2 3' }, planned: { color: 'token', dash: '5 4' },
};

// the theme's tokens, the drawing's and the 2D view's styles, once
const style = document.createElement('style');
style.textContent = [themeCss(loadTheme(String(THEME))), DRAWING_CSS, MARKS_CSS, flatCss(STYLES), DUAL_VIEW_CSS].join('\n');
document.head.prepend(style);

// light | dark: the system's, unless chosen here
const root = document.documentElement;
const stored = (() => { try { return localStorage.getItem('site-theme'); } catch { return null; } })();
if (stored === 'light' || stored === 'dark') root.dataset.theme = stored;
const themeBtn = document.querySelector<HTMLButtonElement>('.theme');
const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
const paintTheme = () => themeBtn?.setAttribute('aria-pressed', String(isDark()));
paintTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme);
themeBtn?.addEventListener('click', () => {
  root.dataset.theme = isDark() ? 'light' : 'dark';
  try { localStorage.setItem('site-theme', root.dataset.theme); } catch { /* private mode */ }
  paintTheme();
});

// copy buttons: the code beside them
document.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button.copy');
  if (!b) return;
  const code = b.parentElement?.querySelector('code')?.textContent ?? '';
  navigator.clipboard?.writeText(code).then(() => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1200); }, () => { b.textContent = 'Select and copy'; });
});

/** a drawing in its figure: compiled here, shown in 3D with the switch; its problems, if any, in place of it */
function show(stage: HTMLElement, text: string, scene?: string): { view?: DualView; problems: { line: number; message: string; severity: string }[] } {
  const c = compile(text, String(THEME));
  const problems = c.diags.map(d => ({ line: d.line, message: d.message, severity: d.severity }));
  stage.replaceChildren();
  const s = c.scenes.find(x => x.id === scene) ?? c.scenes[0];
  if (!s || problems.some(p => p.severity === 'error')) return { problems };
  const fig = document.createElement('div');
  fig.className = 'view';
  fig.setAttribute('role', 'img');
  fig.setAttribute('aria-label', `${String(s.raw.title ?? 'A drawing')}: an isometric drawing, in 3D or 2D`);
  stage.append(fig);
  const view = dualView(fig, s, { mode: '3d', styles: STYLES, flat: { wrap: { aspect: 4 / 3 } }, title: String(s.raw.title ?? 'A drawing') });
  const bar = document.createElement('div');
  bar.className = 'bar';
  viewToggle(bar, [view], { storageKey: 'site-view' });
  stage.append(bar);
  stage.removeAttribute('aria-busy');
  return { view, problems };
}

// the page's drawings, each when it comes near the screen, one at a time (a phone stays responsive: the rest wait)
const queue: HTMLElement[] = [];
let drawing = false;
const drawNext = () => {
  if (drawing) return;
  const fig = queue.shift();
  if (!fig) return;
  drawing = true;
  requestAnimationFrame(() => {
    const scene = fig.closest('.item')?.querySelector<HTMLSelectElement>('select.scene')?.value ?? fig.dataset.scene;
    show(fig.querySelector<HTMLElement>('.stage')!, fig.querySelector<HTMLTextAreaElement>('textarea.src')!.value, scene);
    drawing = false;
    setTimeout(drawNext, 30);
  });
};
const pending = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) { pending.unobserve(e.target); queue.push(e.target as HTMLElement); }
  drawNext();
}, { rootMargin: '150px' });
document.querySelectorAll('[data-drawing]').forEach(f => pending.observe(f));
// a multi-scene drawing: its scene picker
document.querySelectorAll<HTMLSelectElement>('select.scene').forEach(sel => sel.addEventListener('change', () => {
  const fig = sel.closest<HTMLElement>('.item')!.querySelector<HTMLElement>('[data-drawing]')!;
  show(fig.querySelector<HTMLElement>('.stage')!, fig.querySelector<HTMLTextAreaElement>('textarea.src')!.value, sel.value);
}));

// the gallery's filter
const chips = [...document.querySelectorAll<HTMLButtonElement>('.chip')];
for (const c of chips) c.addEventListener('click', () => {
  for (const x of chips) x.setAttribute('aria-pressed', String(x === c));
  const f = c.dataset.feature;
  document.querySelectorAll<HTMLElement>('.gallery .item').forEach(it => { it.hidden = !!f && !it.dataset.features!.split(' ').includes(f); });
});

// the API's filter
document.querySelector<HTMLInputElement>('.api .filter, nav .filter')?.addEventListener('input', e => {
  const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
  document.querySelectorAll<HTMLElement>('.api-entry').forEach(x => { x.hidden = !!q && !x.dataset.name!.includes(q); });
});

// the playground: the drawing follows the text
const pg = document.querySelector<HTMLElement>('[data-playground]');
const ta = document.querySelector<HTMLTextAreaElement>('#yaml');
if (pg && ta) {
  const list = document.querySelector<HTMLUListElement>('.diags')!;
  let timer = 0;
  const run = () => {
    const { problems } = show(pg.querySelector<HTMLElement>('.stage')!, ta.value);
    list.replaceChildren(...problems.map(p => Object.assign(document.createElement('li'), { className: p.severity, textContent: `line ${p.line}: ${p.message}` })));
  };
  ta.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(run, 250); });
  run();
}
document.documentElement.dataset.ready = 'true';
