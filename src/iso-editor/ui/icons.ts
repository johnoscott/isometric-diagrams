// Icons, by name, from a sprite of <symbol id="se-i-NAME"> the host's build puts in the editor's root at mount (the
// names it holds are the domain's list): an icon is <svg class="icon"><use href="#se-i-NAME"></svg>, hidden from
// assistive tech (every button keeps its text or aria-label). Provenance: docs/editor/INTEGRATION.md, its table of what is copied.

/** an icon's name in the sprite */
export type IconName = string;


const NS = 'http://www.w3.org/2000/svg';
export function icon(name: IconName, cls = ''): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', `icon${cls ? ' ' + cls : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#se-i-${name}`);
  svg.append(use);
  return svg;
}

/** h(): the DOM, built as text only (never HTML), from the viewer (src/iso-viewer/dom.ts) */
export { h } from '../../iso-viewer/dom.ts';
