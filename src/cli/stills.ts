// A still inside each <isometric-diagram> of a page (docs/design/MOTION.md, 6.2): what a reader without its script, a feed or a search
// engine sees. Text in, text out; run again, it replaces the stills it wrote. The page is otherwise kept byte for byte.

import { renderSvg } from '../iso-systems/render.ts';

export interface StillsResult { html: string; drawn: number; problems: string[] }

const attr = (attrs: string, name: string) => new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs)?.slice(1).find(x => x !== undefined);
/** the text without the indentation it has in the page */
function dedent(t: string): string {
  const lines = t.replace(/^[ \t]*\r?\n/, '').replace(/\s+$/, '').split(/\r?\n/), by = Math.min(...lines.filter(l => l.trim()).map(l => /^ */.exec(l)![0].length));
  return Number.isFinite(by) ? lines.map(l => l.slice(by)).join('\n') + '\n' : '';
}
/** an SVG's ids, so that two in one page don't meet */
const prefixed = (svg: string, p: string) => svg.replace(/(\sid=")([^"]+)"/g, `$1${p}$2"`).replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`).replace(/(\shref="#)([^"]+)"/g, `$1${p}$2"`);

export function stillsIn(html: string, theme: string): StillsResult {
  const problems: string[] = [];
  let drawn = 0, n = 0;
  // comments, and what scripts and styles hold, are not the page's elements: a diagram shown as an example in one stays as it is
  const out = html.replace(/<!--[\s\S]*?-->|<(script|style|textarea|template)\b[^>]*>[\s\S]*?<\/\1\s*>|<isometric-diagram\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/isometric-diagram\s*>/gi, (all, _tag: string | undefined, attrs: string | undefined, inside: string | undefined) => {
    if (attrs === undefined || inside === undefined) return all;
    n++;
    const line = html.slice(0, html.indexOf(all)).split('\n').length, say = (m: string) => { problems.push(`the diagram at line ${line}: ${m}`); return all; };
    const script = /<script\b[^>]*\btype\s*=\s*["']?(?:text|application)\/yaml["']?[^>]*>([\s\S]*?)<\/script\s*>/i.exec(inside);
    if (!script) return say('its text is not in a <script type="text/yaml">, so it is left as it is');
    const mode = attr(attrs, 'mode'), treatment = attr(attrs, 'treatment');
    if (treatment !== undefined && treatment !== 'mono' && treatment !== 'none') return say(`no treatment "${treatment}" (there is mono, and none)`);
    let svg: string;
    try {
      const text = dedent(script[1]);
      if (!text.trim()) return say('no drawing in it');
      svg = renderSvg(text, { theme, mode: mode === 'dark' ? 'dark' : 'light', ...(attr(attrs, 'scene') !== undefined ? { scene: attr(attrs, 'scene') } : {}), ...(treatment ? { treatment } : {}), ants: false });
    } catch (e) { return say((e as Error).message); }
    drawn++;
    const rest = inside.replace(/\s*<svg\b[^>]*\bdata-isometric-still\b[\s\S]*?<\/svg>/, ''), still = prefixed(svg, `still${n}-`).replace('<svg ', '<svg data-isometric-still="" ');
    const head = all.slice(0, all.indexOf('>' + inside) + 1);
    return `${head}${rest.replace(/\s*$/, '')}\n${still}\n${all.slice(all.lastIndexOf('</'))}`;
  });
  return { html: out, drawn, problems };
}
