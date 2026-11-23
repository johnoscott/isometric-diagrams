// A small virtual document for the render-only entry (a still render): just what the overlay's painters use
// (createElementNS, setAttribute, getAttribute, append, textContent, style.*), so the same painters that draw into the
// editor's DOM can draw into a tree that is written out as text, with no DOM at all (Node, a background thread, a server).

export interface VNode { name: string; attrs: [string, string][]; children: (VNode | string)[] }

const kebab = (k: string) => k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);

export class VEl implements VNode {
  name: string;
  attrs: [string, string][] = [];
  children: (VNode | string)[] = [];
  /** style properties as set (fontSize, transformOrigin…), written out as one style attribute */
  style: Record<string, string> = {};
  constructor(name: string) { this.name = name; }
  setAttribute(k: string, v: string) { const i = this.attrs.findIndex(a => a[0] === k); if (i >= 0) this.attrs[i][1] = String(v); else this.attrs.push([k, String(v)]); }
  getAttribute(k: string) { return this.attrs.find(a => a[0] === k)?.[1] ?? null; }
  append(...ns: (VEl | string)[]) { for (const n of ns) if (n !== null && n !== undefined) this.children.push(n); }
  set textContent(t: string) { this.children = [String(t)]; }
  get textContent() { return this.children.map(c => (typeof c === 'string' ? c : (c as VEl).textContent)).join(''); }
  /** as a plain node, its style folded into a style attribute */
  toNode(): VNode {
    const st = Object.entries(this.style).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => `${kebab(k)}:${v}`).join(';');
    return { name: this.name, attrs: st ? [...this.attrs, ['style', st]] : [...this.attrs], children: this.children.map(c => (c instanceof VEl ? c.toNode() : c)) };
  }
}

/** a stand-in for document, as far as the painters go */
export const vdoc = { createElementNS: (_ns: string, name: string) => new VEl(name) };

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;');

/** a tree as SVG text (every value escaped; raw text only where the caller says, for its own <style>) */
export function serialize(n: VNode | string, raw = new Set<string>(['style'])): string {
  if (typeof n === 'string') return escText(n);
  const a = n.attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  if (!n.children.length) return `<${n.name}${a}/>`;
  const inner = raw.has(n.name) ? n.children.map(c => (typeof c === 'string' ? c.replace(/<\//g, '<\\/') : serialize(c, raw))).join('') : n.children.map(c => serialize(c, raw)).join('');
  return `<${n.name}${a}>${inner}</${n.name}>`;
}
