// The drawing's and a page's stylesheets with the systems pack's kinds in them, as one string each: what a host page
// and the editor's canvas embed.

import { drawingCss, baseCss } from '../iso-objects/css.ts';
import { systems } from './catalog.ts';

/** without any marks a host registers: for those, drawingCss(systems) / baseCss(systems) after registering */
export const DRAWING_CSS = drawingCss(systems);
export const BASE_CSS = baseCss(systems);
