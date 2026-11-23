// The site's script on every page: live drawings (3D | 2D, with the morph) where a page has them, copy buttons, the
// gallery's filter, the API's filter, and the theme (Light, Dark, System). The playground's editor is a module of its
// own (playground.ts, Monaco), loaded by that page only. The engine comes from its sources, the schema precompiled
// (scripts/build-site.ts), so nothing is evaluated from a string.
import { show } from './draw.ts';

// the theme: Light, Dark or System (the default), chosen with the labelled control in the header; the choice kept in
// this browser (guarded: a private window or blocked storage only forgets it). Other scripts hear 'site-theme'.
const root = document.documentElement;
const media = matchMedia('(prefers-color-scheme: dark)');
type Choice = 'light' | 'dark' | 'system';
const stored = (() => { try { return localStorage.getItem('site-theme'); } catch { return null; } })();
let choice: Choice = stored === 'light' || stored === 'dark' ? stored : 'system';
const isDark = () => (choice === 'system' ? media.matches : choice === 'dark');
const themeButtons = [...document.querySelectorAll<HTMLButtonElement>('.theme-pick button[data-theme]')];
function paintTheme() {
  if (choice === 'system') delete root.dataset.theme; else root.dataset.theme = choice;
  for (const b of themeButtons) b.setAttribute('aria-pressed', String(b.dataset.theme === choice));
  document.dispatchEvent(new CustomEvent('site-theme', { detail: { dark: isDark() } }));
}
paintTheme();
media.addEventListener('change', () => { if (choice === 'system') paintTheme(); });
for (const b of themeButtons) b.addEventListener('click', () => {
  choice = b.dataset.theme as Choice;
  try { if (choice === 'system') localStorage.removeItem('site-theme'); else localStorage.setItem('site-theme', choice); } catch { /* not kept */ }
  paintTheme();
});

// copy buttons: the code beside them
document.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button.copy');
  if (!b) return;
  const code = b.parentElement?.querySelector('code')?.textContent ?? '';
  navigator.clipboard?.writeText(code).then(() => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1200); }, () => { b.textContent = 'Select and copy'; });
});

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

document.documentElement.dataset.ready = 'true';
