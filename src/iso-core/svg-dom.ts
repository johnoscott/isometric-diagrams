// The canvas's drawing, built with DOM calls: never innerHTML, srcdoc or a parser of the browser's. The renderer writes
// SVG as text (the same text a standalone page embeds), escaping every value through one function (tag() in
// src/iso-core/kernel.ts). Here that text is read by a small parser that knows only the renderer's own output, and each
// element is made with createElementNS, each attribute set with setAttribute, each text as a text node.
//
// Even if a name, prompt or label in a source file got past the escaping, nothing it says can run: only the SVG
// elements and attributes on these lists are made (no script, foreignObject, style, image, a or iframe; no on…
// attributes; references only to #ids in the drawing), and anything else is dropped with its contents. The diagram's
// custom properties are renamed --iso-* on the way (see canvas-css.ts).
// parseSvg is pure (tested in Node); buildSvg makes the DOM.

export interface SvgNode { name: string; attrs: [string, string][]; children: (SvgNode | string)[] }

const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'marker', 'symbol', 'title', 'desc',
  'path', 'polygon', 'polyline', 'line', 'rect', 'circle', 'ellipse', 'text', 'tspan',
  'linearGradient', 'radialGradient', 'stop', 'clipPath',
]);
const ATTRIBUTES = new Set([
  'id', 'class', 'role', 'transform', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'fx', 'fy', 'd', 'points', 'offset', 'gradientUnits', 'gradientTransform', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient',
  'markerUnits', 'text-anchor', 'dominant-baseline', 'font-size', 'font-weight', 'letter-spacing', 'fill', 'stroke', 'stroke-width',
  'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'stop-color', 'stop-opacity',
  'marker-start', 'marker-mid', 'marker-end', 'clip-path', 'preserveAspectRatio', 'vector-effect', 'paint-order', 'style',
]);
/** attributes whose value may name a reference: only url(#id) is kept */
const REFERENCES = new Set(['fill', 'stroke', 'marker-start', 'marker-mid', 'marker-end', 'clip-path', 'style']);

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
const unescape = (s: string) => s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_m, e: string) => ENTITY[e]);

/** may this attribute be set, with this value? */
export function allowed(name: string, value: string): boolean {
  if (name.startsWith('data-') || name.startsWith('aria-')) return /^[a-z][\w-]*$/.test(name);
  if (!ATTRIBUTES.has(name)) return false;
  // a reference to anything but an id in the drawing (or a script: url, javascript:, expression()…) is dropped
  if (REFERENCES.has(name) && /url\(\s*(?!['"]?#)|javascript:|expression\(|@import/i.test(value)) return false;
  return true;
}

/**
 * Read the renderer's SVG text into a tree of allowed elements (their attributes filtered, their texts unescaped).
 * A disallowed element is dropped with everything inside it; comments are dropped; anything that isn't the renderer's
 * well-formed output (an unclosed tag, a stray close) throws, so a broken drawing is never half-built.
 */
export function parseSvg(markup: string): SvgNode {
  const root: SvgNode = { name: '#root', attrs: [], children: [] };
  const stack: { node: SvgNode; dropped: boolean }[] = [{ node: root, dropped: false }];
  // (a comment as <(?:!--): a bundle inlined in an HTML page must hold no "<!--", which switches the page's parser
  // out of the script; the same pattern, and no minifier folds it back)
  const re = /<(?:!--)[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null, at = 0;
  while ((m = re.exec(markup))) {
    if (m.index !== at) throw new Error(`not the renderer's SVG at ${at}: ${JSON.stringify(markup.slice(at, at + 40))}`);
    at = re.lastIndex;
    const top = stack[stack.length - 1];
    if (m[0].charAt(1) === '!') continue;              // a comment (the only match starting <!)
    if (m[1]) {
      if (stack.length < 2 || top.node.name !== m[1]) throw new Error(`a stray </${m[1]}>`);
      stack.pop();
      continue;
    }
    if (m[2]) {
      const name = m[2];
      const attrs: [string, string][] = [];
      for (const a of m[3].matchAll(/([\w:-]+)="([^"]*)"/g)) {
        const k = a[1], v = unescape(a[2]);
        if (k === 'xmlns' || k.startsWith('xmlns:')) continue;          // createElementNS gives the namespace
        if (allowed(k, v)) attrs.push([k, v]);
      }
      const node: SvgNode = { name, attrs, children: [] };
      const dropped = top.dropped || !ELEMENTS.has(name);
      if (!dropped) top.node.children.push(node);
      if (!m[4]) stack.push({ node, dropped });
      continue;
    }
    if (!top.dropped && m[5].trim()) top.node.children.push(unescape(m[5]));
  }
  if (at !== markup.length) throw new Error(`not the renderer's SVG at ${at}`);
  if (stack.length !== 1) throw new Error(`<${stack[stack.length - 1].node.name}> is never closed`);
  return root;
}

const SVGNS = 'http://www.w3.org/2000/svg';
/** the diagram's custom properties, --iso-* in the page (as canvas.css names them) */
const isoVars = (v: string) => v.replace(/var\(--([a-zA-Z][\w-]*)/g, 'var(--iso-$1');

/** Make the drawing: the tree's first element (an <svg>), as DOM. */
export function buildSvg(markup: string, d: Document = document): SVGSVGElement {
  const make = (n: SvgNode): Element => {
    const el = d.createElementNS(SVGNS, n.name);
    for (const [k, v] of n.attrs) {
      // a style is set through the CSSOM, not as an attribute (the page could forbid inline style attributes)
      if (k === 'style') (el as SVGElement).style.cssText = isoVars(v);
      else el.setAttribute(k, /var\(--/.test(v) ? isoVars(v) : v);
    }
    for (const c of n.children) el.append(typeof c === 'string' ? d.createTextNode(c) : make(c));
    return el;
  };
  const top = parseSvg(markup).children.find((c): c is SvgNode => typeof c !== 'string' && c.name === 'svg');
  if (!top) throw new Error('the drawing has no <svg>');
  return make(top) as SVGSVGElement;
}
