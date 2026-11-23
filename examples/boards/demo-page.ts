// The 2D view and the morph, on two drawings (0.6.0): a data model given as a board (drawn in 3D with boardDiagram),
// and a network in the engine's own format (its 2D view derived with boardOf). One 3D | 2D switch at the top right
// switches both, remembered in localStorage "iso-view". scripts/dual-demo.ts builds it; test/dual-view.test.ts drives
// it in Chrome; window.__dual is its handle.

import { themeCss } from '../../src/iso-core/theme.ts';
import { compileRaw } from '../../src/iso-objects/compile.ts';
import { kindsCss } from '../../src/iso-objects/kinds.ts';
import { boardCatalog, boardDiagram, BOARD_CSS } from '../../src/iso-objects/board.ts';
import type { Board } from '../../src/iso-objects/flat.ts';
import { flatCss, type FlatStyle } from '../../src/iso-viewer/flat-view.ts';
import { dualView, viewToggle, storedMode, DUAL_VIEW_CSS, type DualView } from '../../src/iso-viewer/dual-view.ts';
import { compile } from '../../src/iso-systems/compile.ts';
import { DRAWING_CSS } from '../../src/iso-systems/css.ts';
// @ts-ignore text, by the bundler's loader
import THEME from '../../themes/default.yaml';
// @ts-ignore text, by the bundler's loader
import NETWORK from './network.yaml';
// @ts-ignore text, by the bundler's loader
import ARCH from '../../test/fixtures/flat/arch.yaml';
import MODEL from './model.json';

const violations: string[] = [], errors: string[] = [];
const handle: Record<string, unknown> = { violations, errors };
(window as unknown as { __dual: unknown }).__dual = handle;
addEventListener('securitypolicyviolation', e => violations.push(`${e.violatedDirective} ${e.blockedURI}`));
addEventListener('error', e => errors.push(String(e.message)));

// the model's link kinds: owns (a diamond at the owner), references, derived from
const STYLES: Record<string, FlatStyle> = {
  own: { start: 'diamond', end: 'none', color: 'ink' },
  ref: { end: 'open', dash: '5 4', color: 'send' },
  derived: { end: 'arrow', dash: '2 3', color: 'reply', width: 1.8 },
  user: { color: 'user' }, send: { color: 'send' }, reply: { color: 'reply' }, event: { color: 'event' }, control: { color: 'control' },
};
const ROLES = { orange: { h: 24, s: 78 }, tan: { h: 28, s: 58 }, yellow: { h: 46, s: 74 } };
const KINDS = { own: { color: 'control', dash: 'solid' as const }, ref: { color: 'send', dash: 'dashed' as const }, derived: { color: 'reply', dash: 'dotted' as const } };

const theme = String(THEME);
const board = MODEL as unknown as Board;
const modelCat = boardCatalog(board);
const model = compileRaw(boardDiagram(board, { title: 'A data model', roles: ROLES, kinds: KINDS }), theme, modelCat);
const net = compile(String(NETWORK), theme);
const arch = compile(String(ARCH), theme);

const style = document.createElement('style');
style.textContent = [
  // the model's theme: the default one with the model's own roles and link kinds (a superset of the network's)
  themeCss(model.theme!).replace(':root{', ':root{--accent:#2f6fd6;'),
  DRAWING_CSS, kindsCss(modelCat), BOARD_CSS,
  flatCss(STYLES), DUAL_VIEW_CSS,
  `body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
   main{max-width:1240px;margin:0 auto;padding:24px 16px 48px}
   h1{font-size:24px;margin:0 0 4px} p{color:var(--muted);margin:0 0 12px}
   figure{margin:16px 0 28px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px;overflow:hidden}
   figcaption{font-size:13px;color:var(--muted);margin:0 0 8px}
   .view-switch{position:fixed;top:10px;right:12px;z-index:50}`,
].join('\n');
document.head.append(style);

const main = document.createElement('main');
main.innerHTML = '<h1>One drawing, two views</h1><p>The 3D drawing and its own 2D layout. Switch with 3D | 2D at the top right; a click selects in either view.</p>';
// a host page may give a mount point (#app); otherwise the body
const app = document.getElementById('app');
if (app) { app.style.height = ''; app.append(main); } else document.body.append(main);
const figure = (caption: string) => {
  const f = document.createElement('figure');
  f.innerHTML = `<figcaption>${caption}</figcaption>`;
  main.append(f);
  return f;
};
const mode = storedMode() ?? '3d';
/** the views' options (a test slows the morph down through them) */
const opts = { model: { duration: 600 }, net: { duration: 600 }, arch: { duration: 600 }, archWrap: { duration: 600 } };
const views: Record<string, DualView> = {};
const picked: string[] = [];
views.model = dualView(figure('A data model: entities, stores and references (given as a board)'), model.scenes[0], Object.assign(opts.model, { mode, board, styles: STYLES, title: 'A data model', onSelect: (id: string | undefined) => picked.push(`model:${id}`) }));
views.net = dualView(figure('A web service across two zones (a drawing in the engine\'s own format)'), net.scenes[0], Object.assign(opts.net, { mode, styles: STYLES, title: 'A web service across two zones', onSelect: (id: string | undefined) => picked.push(`net:${id}`) }));
views.arch = dualView(figure('A project on one host: four levels of nesting (a drawing in the engine\'s own format)'), arch.scenes[0], Object.assign(opts.arch, { mode, styles: STYLES, title: 'A project on one host', onSelect: (id: string | undefined) => picked.push(`arch:${id}`) }));
views.archWrap = dualView(figure('The same, its 2D view wrapped for a 4:3 frame (flat: { wrap: { aspect: 4 / 3 } })'), arch.scenes[0], Object.assign(opts.archWrap, { mode, styles: STYLES, title: 'A project on one host, wrapped', flat: { wrap: { aspect: 4 / 3 } }, onSelect: (id: string | undefined) => picked.push(`archWrap:${id}`) }));
const toggle = viewToggle(document.body, Object.values(views));
Object.assign(handle, { opts, views, toggle, picked, diags: [...model.diags, ...net.diags, ...arch.diags].filter(d => d.severity === 'error') });
document.title = 'ready';
