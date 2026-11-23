// A drawing in its figure, shared by the site's script and the playground's: the engine's theme, the drawing's and the
// 2D view's styles (once a page), compiled here and shown in 3D with the switch; its problems, if any, in its place.
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

// the theme's tokens, the drawing's and the 2D view's styles, once a page (both scripts may run on one)
if (!document.getElementById('site-drawing-css')) {
  const style = document.createElement('style');
  style.id = 'site-drawing-css';
  style.textContent = [themeCss(loadTheme(String(THEME))), DRAWING_CSS, MARKS_CSS, flatCss(STYLES), DUAL_VIEW_CSS].join('\n');
  document.head.prepend(style);
}

export interface Shown { view?: DualView; problems: { line: number; col: number; message: string; severity: string }[] }
/** a drawing in its figure: compiled here, shown in 3D with the switch; its problems, if any, in place of it */
export function show(stage: HTMLElement, text: string, scene?: string): Shown {
  const c = compile(text, String(THEME));
  const problems = c.diags.map(d => ({ line: d.line, col: d.col, message: d.message, severity: d.severity }));
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

