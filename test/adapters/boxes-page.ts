// The boxes/1 page (R1 S8): the editor mounted on a boxes/1 file with setupFor(boxesAdapter), L3's plain skin, the
// drawing's stylesheet made from its own catalogue, and its Live layer. No text pane (no Monaco): the tree, the
// panel and the canvas. test/boxes.test.ts bundles it and drives it in Chrome; window.__boxes is its handle.

import { loadTheme, themeCss } from '../../src/iso-core/theme.ts';
import { drawingCss, MARKS_CSS, GRID_CSS } from '../../src/iso-objects/css.ts';
import { isoVars, scope } from '../../src/iso-viewer/view-css.ts';
import { flatCss } from '../../src/iso-viewer/flat-view.ts';
import { mountEditor } from '../../src/iso-editor/ui/mount.ts';
import { setupFor, PLAIN_WORDS } from '../../src/iso-editor/ui/setup.ts';
import { scopeCss } from '../../src/iso-editor/ui/scope-css.ts';
import { boxesAdapter, boxesView, BOXES_CATALOG } from './boxes.ts';
// @ts-ignore text, by the bundler's loader
import THEME from '../../themes/default.yaml';
// @ts-ignore text, by the bundler's loader
import SKIN from '../../src/iso-editor/ui/skin.css';
// @ts-ignore text, by the bundler's loader
import APP from '../../src/iso-editor/ui/app.css';
// @ts-ignore text, by the bundler's loader
import TEXT from '../fixtures/boxes/two-trays.yaml';

const violations: string[] = [], errors: string[] = [];
addEventListener('securitypolicyviolation', e => violations.push(`${e.violatedDirective} ${e.blockedURI}`));
addEventListener('error', e => errors.push(String(e.message)));
const CANVAS = 'iso-canvas';
const css = [
  '@layer tokens, base, components, views;',
  scopeCss(SKIN + '\n' + APP, PLAIN_WORDS.rootClass),
  scope(isoVars(themeCss(loadTheme(THEME))), `.${CANVAS}`, `.${PLAIN_WORDS.rootClass}`),
  scope(isoVars(drawingCss(BOXES_CATALOG) + MARKS_CSS + GRID_CSS), `.${CANVAS}`, `.${PLAIN_WORDS.rootClass}`),
  scope(isoVars(flatCss({ send: { color: 'send' } })), `.${CANVAS}`, `.${PLAIN_WORDS.rootClass}`),
  `.${CANVAS} .boxes-live .live-badge circle { fill: var(--iso-accent, #2f6fd6); }`,
].join('\n');
const style = document.createElement('style');
style.textContent = css;
document.head.append(style);

const el = document.getElementById('app')!;
const saved: string[] = [];
const editor = mountEditor(el, { text: String(TEXT), onSave: async t => { saved.push(t); return { ok: true }; } }, setupFor(boxesAdapter, boxesView(String(THEME))));
(window as unknown as { __boxes: unknown }).__boxes = { editor, saved, css: css.length, violations, errors };
document.title = 'ready';
