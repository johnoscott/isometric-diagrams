// The motion page: a drawing's still and what paints a state on it, for test/motion.test.ts to drive in Chrome.
import { paint, type SceneState } from '../../src/iso-objects/motion.ts';
(window as unknown as { __motion: unknown }).__motion = {
  errors: [] as string[],
  paint: (svg: SVGSVGElement, s: SceneState, rendered?: Parameters<typeof paint>[2]) => paint(svg, s, rendered),
  /** an SVG's text as a live element */
  live: (text: string) => document.importNode(new DOMParser().parseFromString(text, 'image/svg+xml').documentElement, true) as unknown as SVGSVGElement,
};
document.title = 'ready';
