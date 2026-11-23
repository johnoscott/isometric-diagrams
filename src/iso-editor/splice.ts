// Structural edits as text splices. Each operation reads the parsed Document's source ranges and returns the few
// TextEdits that make the change, so every byte outside them stays as the user wrote it (comments, key order,
// quoting, blank lines). When a layout is too irregular to splice (a key that isn't first on its line inside a block
// map, say), the smallest enclosing collection is re-serialised instead; that result is marked `fallback` so tests
// can flag it. Pure.

import { parseDocument, stringify, isMap, isSeq, isScalar, isPair, Scalar, Document, type Node as YNode, type Pair, type YAMLMap, type YAMLSeq } from 'yaml';
import type { Path, Seg } from './path.ts';

export interface TextEdit { start: number; end: number; text: string }
/** one step: non-overlapping edits against the same text */
export type Step = TextEdit[];
export interface Splice { steps: Step[]; fallback?: boolean }

export class SpliceError extends Error {}

/** Apply one step's edits (non-overlapping) to a text. */
export function applyStep(text: string, step: Step): string {
  let out = text;
  for (const e of [...step].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
/** The step that undoes `step` on the text it produced. */
export function invertStep(text: string, step: Step): Step {
  const sorted = [...step].sort((a, b) => a.start - b.start);
  let delta = 0;
  return sorted.map(e => {
    const start = e.start + delta;
    delta += e.text.length - (e.end - e.start);
    return { start, end: start + e.text.length, text: text.slice(e.start, e.end) };
  });
}

// ---------- reading the document ----------

interface Ctx { text: string; doc: Document.Parsed }
const parse = (text: string): Ctx => ({ text, doc: parseDocument(text, { keepSourceTokens: true, uniqueKeys: false }) });

function keyOf(p: Pair): string { return isScalar(p.key) ? String(p.key.value) : String(p.key); }

/** The node at a path, the pair holding it (for map entries), and the collections on the way (for flow detection). */
function find(c: Ctx, path: Path): { node: YNode | null | undefined; pair?: Pair; parent?: YAMLMap | YAMLSeq; chain: unknown[] } {
  let node: unknown = c.doc.contents;
  let pair: Pair | undefined;
  let parent: YAMLMap | YAMLSeq | undefined;
  const chain: unknown[] = [node];
  for (const seg of path) {
    pair = undefined;
    if (isMap(node)) {
      parent = node;
      const p = node.items.find(x => isPair(x) && keyOf(x) === String(seg));
      if (!p) return { node: undefined, parent, chain };
      pair = p as Pair;
      node = p.value;
    } else if (isSeq(node) && typeof seg === 'number') {
      parent = node;
      node = node.items[seg];
      if (node === undefined) return { node: undefined, parent, chain };
    } else return { node: undefined, chain };
    chain.push(node);
  }
  return { node: node as YNode | null, pair, parent, chain };
}
const inFlow = (chain: unknown[]) => chain.some(n => (isMap(n) || isSeq(n)) && (n as { flow?: boolean }).flow);

const lineStart = (t: string, off: number) => t.lastIndexOf('\n', off - 1) + 1;
const lineEnd = (t: string, off: number) => { const i = t.indexOf('\n', off); return i < 0 ? t.length : i; };
/** the start of the line after the one holding `off` (or the end of the text) */
const nextLine = (t: string, off: number) => { const i = t.indexOf('\n', off); return i < 0 ? t.length : i + 1; };
const colOf = (t: string, off: number) => off - lineStart(t, off);

/** Where a pair's text ends: the start of the line after its last line (its value's end, with any comment after it). */
function pairEnd(c: Ctx, p: Pair): number {
  const k = p.key as YNode;
  const v = p.value as YNode | null;
  const end = v?.range ? Math.max(v.range[1], k.range![1]) : k.range![1];
  // a block value's range ends at the start of the line after it; anything else ends inside its last line
  const last = end > 0 && c.text[end - 1] === '\n' ? end - 1 : end;
  return nextLine(c.text, last);
}
/** The first line of a pair, with its own comment lines directly above it at the same indent. */
function pairStart(c: Ctx, p: Pair): number {
  const k = (p.key as YNode).range![0];
  let s = lineStart(c.text, k);
  const ind = k - s;
  if (onDash(c.text, k)) return k;
  for (;;) {
    if (s === 0) break;
    const ps = lineStart(c.text, s - 1);
    const line = c.text.slice(ps, s - 1);
    if (/^\s*#/.test(line) && line.length - line.trimStart().length === ind) s = ps; else break;
  }
  return s;
}

/** Is a key the first thing on its line (after any "- " of the list items holding its map)? */
const firstOnLine = (t: string, k: number) => /^\s*(-\s+)*$/.test(t.slice(lineStart(t, k), k));
const onDash = (t: string, k: number) => /-\s+$/.test(t.slice(lineStart(t, k), k));

// ---------- writing values ----------

type Style = string | undefined;
const SAFE_FLOW = /[,[\]{}]/;

/** A scalar as YAML text. Keeps a quoting style when one is given; multi-line text becomes a block literal. */
export function scalarText(v: unknown, opts: { flow: boolean; indent: number; style?: Style }): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v !== 'string') return String(v);
  if (opts.style === Scalar.QUOTE_DOUBLE) return JSON.stringify(v);
  if (opts.style === Scalar.QUOTE_SINGLE && !v.includes('\n')) return `'${v.replace(/'/g, "''")}'`;
  if (v.includes('\n')) {
    if (opts.flow) return JSON.stringify(v);
    const body = v.endsWith('\n') ? v.slice(0, -1) : v;
    if (/(^|\n)\s/.test(body.split('\n')[0] ?? '') || /^\s/.test(body)) return JSON.stringify(v);
    return (v.endsWith('\n') ? '|' : '|-') + '\n' + body.split('\n').map(l => (l ? ' '.repeat(opts.indent) + l : '')).join('\n');
  }
  const plain = stringify(v, { lineWidth: 0 }).replace(/\n$/, '');
  if (opts.flow && SAFE_FLOW.test(plain) && !/^["']/.test(plain)) return JSON.stringify(v);
  return plain;
}

/** A value inline, in flow style: { a: 1, b: [x, y] } */
export function flowText(v: unknown): string {
  if (Array.isArray(v)) return v.length ? `[${v.map(flowText).join(', ')}]` : '[]';
  if (v && typeof v === 'object') {
    const e = Object.entries(v as Record<string, unknown>);
    return e.length ? `{ ${e.map(([k, x]) => `${keyText(k)}: ${flowText(x)}`).join(', ')} }` : '{}';
  }
  return scalarText(v, { flow: true, indent: 0 });
}
const keyText = (k: string) => scalarText(k, { flow: true, indent: 0 });
const isObj = (v: unknown) => !!v && typeof v === 'object';

/**
 * Small values are written the way the files are written by hand: a list of scalars as [a, b], a map of at most two
 * short entries as { key: value } (a pin: { at: [3, 12] }). Anything bigger stays in block style.
 */
const flowFits = (v: unknown): boolean => {
  if (Array.isArray(v)) return v.every(x => !isObj(x) && !(typeof x === 'string' && x.includes('\n'))) && flowText(v).length <= 60;
  if (isObj(v)) { const e = Object.entries(v as Record<string, unknown>); return e.length > 0 && e.length <= 2 && e.every(([, x]) => !isObj(x) && !(typeof x === 'string' && x.includes('\n')) || (Array.isArray(x) && flowFits(x))) && flowText(v).length <= 40; }
  return false;
};
/** A value in block style at indent 0, its small parts in flow style (see flowFits). */
function yamlText(v: unknown, ind = 0): string {
  const pad = ' '.repeat(ind);
  const inline = (x: unknown): string | undefined => {
    if (!isObj(x)) return scalarText(x, { flow: false, indent: ind + 2 });
    if (Array.isArray(x) ? !x.length : !Object.keys(x as object).length) return Array.isArray(x) ? '[]' : '{}';
    return flowFits(x) ? flowText(x) : undefined;
  };
  if (Array.isArray(v)) {
    return v.map(x => {
      const one = inline(x);
      if (one !== undefined) return `${pad}- ${one}`;
      const inner = yamlText(x, ind + 2);
      return Array.isArray(x) ? `${pad}-\n${inner}` : `${pad}- ${inner.slice(ind + 2)}`;
    }).join('\n');
  }
  return Object.entries(v as Record<string, unknown>).map(([k, x]) => {
    const one = inline(x);
    return one !== undefined ? `${pad}${keyText(k)}: ${one}` : `${pad}${keyText(k)}:\n${yamlText(x, ind + 2)}`;
  }).join('\n');
}

/** The text after "key:" for a value in block style, the key being at `indent`. */
function blockValue(v: unknown, indent: number): string {
  if (!isObj(v)) return ' ' + scalarText(v, { flow: false, indent: indent + 2 });
  if (Array.isArray(v) ? !v.length : !Object.keys(v as object).length) return Array.isArray(v) ? ' []' : ' {}';
  if (flowFits(v)) return ' ' + flowText(v);
  return '\n' + reindent(yamlText(v), indent + 2);
}
const reindent = (t: string, n: number) => t.split('\n').map(l => (l ? ' '.repeat(n) + l : l)).join('\n');

// ---------- the operations ----------

/** Set the value at a path (which must exist: use insertKey for a new key). */
export function setValue(text: string, path: Path, value: unknown): Splice {
  const c = parse(text);
  const f = find(c, path);
  if (f.node === undefined) throw new SpliceError(`no value at ${path.join('.')}`);
  const flow = inFlow(f.chain.slice(0, -1));
  const n = f.node;
  const pairKey = f.pair?.key as YNode | undefined;
  const indent = pairKey?.range ? colOf(text, pairKey.range[0]) : n?.range ? colOf(text, n.range[0]) : 0;
  // a scalar replaced by a scalar: its own range, its own style
  if (isScalar(n) && n.range && !isObj(value) && n.range[1] > n.range[0]) {
    const style = n.type === Scalar.BLOCK_LITERAL || n.type === Scalar.BLOCK_FOLDED ? undefined : n.type;
    let t = scalarText(value, { flow, indent: indent + 2, style });
    let end = n.range[1];
    // a block scalar's range runs to the start of the next line; keep that line break
    if (text[end - 1] === '\n' && !t.endsWith('\n')) { end -= 1; while (end > n.range[0] && text[end - 1] === '\n') end -= 1; }
    if (t.startsWith('|') && !text.slice(n.range[0], end).includes('\n')) {
      // a one-line value becoming a block literal: a comment after it moves onto the "|" line
      const lineE = lineEnd(text, end);
      const trail = text.slice(end, lineE);
      if (/^\s*#/.test(trail)) { t = t.replace(/^(\|-?)/, `$1${trail}`); end = lineE; }
    }
    return { steps: [[{ start: n.range[0], end, text: t }]] };
  }
  if (flow || (isObj(n) && (n as { flow?: boolean }).flow) || !f.pair) {
    // inline: replace the node's text (an empty value: write after the colon)
    if (n?.range && n.range[1] > n.range[0]) {
      const t = flow || !isObj(value) || !f.pair ? (isObj(value) ? flowText(value) : scalarText(value, { flow, indent: indent + 2 })) : null;
      if (t !== null) {
        // a block node's range runs to the start of the next line: keep that line break
        let end = n.range[1];
        while (end > n.range[0] && text[end - 1] === '\n') end -= 1;
        return { steps: [[{ start: n.range[0], end, text: t }]] };
      }
    }
  }
  if (!f.pair || !pairKey?.range) return fallback(text, path.slice(0, -1), d => d.setIn(path, value));
  // block: rewrite everything after "key:" up to the value's end
  const colon = text.indexOf(':', pairKey.range[1]);
  const vEnd = n?.range ? n.range[1] : colon + 1;
  const end = text[vEnd - 1] === '\n' ? vEnd - 1 : vEnd;
  // keep a comment on the key's line when the old value started on the next line
  const lineE = lineEnd(text, colon);
  const comment = n?.range && n.range[0] > lineE ? text.slice(colon + 1, lineE) : '';
  const after = /^\s*#/.test(comment) ? comment : '';
  let t = blockValue(value, indent);
  let stop = end;
  if (after && t.startsWith('\n')) t = after + t;
  else if (after) t = t + after;
  else if (t.startsWith('\n') && end <= lineE) {
    // the old value was on the key's line with a comment after it: the comment stays on the key's line
    const trail = text.slice(end, lineE);
    if (/^\s*#/.test(trail)) { t = trail + t; stop = lineE; }
  }
  return { steps: [[{ start: colon + 1, end: stop, text: t }]] };
}

/** Add `key: value` to the map at a path (creating the map, and its parents, when missing). order: the format's
 *  top-level key order, for where a new top-level key goes (the adapter's topOrder). */
export function insertKey(text: string, mapPath: Path, key: string, value: unknown, opts: { after?: string; before?: string; order?: readonly string[] } = {}): Splice {
  const TOP_ORDER = opts.order ?? [];
  const c = parse(text);
  const f = find(c, mapPath);
  if (f.node === undefined || f.node === null || (isScalar(f.node) && f.node.value === null)) {
    // the map isn't there: write it with this one key
    if (!mapPath.length) {
      const t = `${keyText(key)}:${blockValue(value, 0)}\n`;
      return { steps: [[{ start: text.length, end: text.length, text: (text && !text.endsWith('\n') ? '\n' : '') + t }]] };
    }
    if (f.node === undefined) return insertKey(text, mapPath.slice(0, -1), String(mapPath[mapPath.length - 1]), { [key]: value }, { order: opts.order });
    return setValue(text, mapPath, { [key]: value });
  }
  const map = f.node;
  if (!isMap(map)) throw new SpliceError(`${mapPath.join('.') || 'the file'} is not a map`);
  if (map.items.some(p => keyOf(p) === key)) throw new SpliceError(`"${key}" is already in ${mapPath.join('.') || 'the file'}`);
  const flow = (map as { flow?: boolean }).flow || inFlow(f.chain.slice(0, -1));
  const items = map.items as Pair[];
  // where it goes: after a named key, before a named key, in the spec's order at the top, else at the end
  let at = items.length;
  if (opts.after !== undefined) at = items.findIndex(p => keyOf(p) === opts.after) + 1 || items.length;
  else if (opts.before !== undefined) { const i = items.findIndex(p => keyOf(p) === opts.before); if (i >= 0) at = i; }
  else if (!mapPath.length && TOP_ORDER.includes(key)) {
    const rank = TOP_ORDER.indexOf(key);
    const i = items.findIndex(p => { const r = TOP_ORDER.indexOf(keyOf(p)); return r > rank || keyOf(p).startsWith('x-'); });
    if (i >= 0) at = i;
  }
  if (flow && map.range && text[map.range[0]] !== '{') {
    // an implicit one-pair map inside a flow list ([terminal: 3]): it becomes { terminal: 3, key: v }
    const now = (c.doc.getIn(mapPath, true) as { toJSON(): Record<string, unknown> }).toJSON();
    return { steps: [[{ start: map.range[0], end: map.range[1], text: flowText({ ...now, [key]: value }) }]] };
  }
  if (flow) {
    const t = `${keyText(key)}: ${flowText(value)}`;
    if (!items.length) { const r = map.range!; return { steps: [[{ start: r[0], end: text.lastIndexOf('}', r[1]) + 1, text: `{ ${t} }` }]] }; }
    if (at < items.length) { const k = (items[at].key as YNode).range![0]; return { steps: [[{ start: k, end: k, text: `${t}, ` }]] }; }
    const last = items[items.length - 1];
    const e = (last.value as YNode | null)?.range?.[1] ?? (last.key as YNode).range![1];
    return { steps: [[{ start: e, end: e, text: `, ${t}` }]] };
  }
  // block
  const first = items[0]?.key as YNode | undefined;
  if (!first?.range) return fallback(text, mapPath, d => d.setIn([...mapPath, key], value), true);
  const indent = colOf(text, first.range[0]);
  if (items.some(p => !firstOnLine(text, (p.key as YNode).range![0]))) {
    // a key that shares its line with something else: re-serialise the map
    return fallback(text, mapPath, d => d.setIn([...mapPath, key], value), true);
  }
  const body = `${' '.repeat(indent)}${keyText(key)}:${blockValue(value, indent)}\n`;
  // a new section at the top gets a blank line before it, like the others
  const blank = !mapPath.length && isObj(value) ? '\n' : '';
  if (at === 0 && items.length && onDash(text, first.range[0])) {
    // before the key on a list item's "- " line: the new key takes that place, the old one moves down
    const k = first.range[0];
    return { steps: [[{ start: k, end: k, text: body.slice(indent) + ' '.repeat(indent) }]] };
  }
  if (at < items.length) {
    const s = pairStart(c, items[at]);
    return { steps: [[{ start: s, end: s, text: blank && at > 0 ? body + '\n' : body }]] };
  }
  const end = pairEnd(c, items[items.length - 1]);
  const pre = end === text.length && text.length && !text.endsWith('\n') ? '\n' : '';
  return { steps: [[{ start: end, end, text: pre + blank + body }]] };
}

/** Remove the entry at a path: a key and its value (with its own comment lines), or a list item. */
export function deleteAt(text: string, path: Path): Splice {
  if (!path.length) throw new SpliceError('can\'t delete the whole file');
  const c = parse(text);
  const parentPath = path.slice(0, -1);
  const pf = find(c, parentPath);
  const coll = pf.node;
  const seg = path[path.length - 1];
  if (!isMap(coll) && !isSeq(coll)) throw new SpliceError(`no entry at ${path.join('.')}`);
  const items = coll.items as unknown[];
  const i = isMap(coll) ? (items as Pair[]).findIndex(p => keyOf(p) === String(seg)) : Number(seg);
  if (i < 0 || i >= items.length) throw new SpliceError(`no entry at ${path.join('.')}`);
  const flow = (coll as { flow?: boolean }).flow;
  const startOf = (x: unknown) => (isPair(x) ? (x.key as YNode).range![0] : (x as YNode).range![0]);
  const endOf = (x: unknown) => (isPair(x) ? ((x.value as YNode | null)?.range?.[1] ?? (x.key as YNode).range![1]) : (x as YNode).range![1]);
  if (items.length === 1) {
    // the last entry: the collection becomes empty ({} or []), on its parent's line
    // the file's last key: its lines go; comments elsewhere stay (an empty document reads as nothing)
    if (!parentPath.length && isMap(coll) && !(coll as { flow?: boolean }).flow) return { steps: [[{ start: pairStart(c, items[0] as Pair), end: pairEnd(c, items[0] as Pair), text: '' }]] };
    if (!parentPath.length) return { steps: [[{ start: 0, end: text.length, text: '' }]] };
    return setValue(text, parentPath, isMap(coll) ? {} : []);
  }
  if (flow) {
    if (i < items.length - 1) return { steps: [[{ start: startOf(items[i]), end: startOf(items[i + 1]), text: '' }]] };
    return { steps: [[{ start: endOf(items[i - 1]), end: endOf(items[i]), text: '' }]] };
  }
  if (isMap(coll)) {
    const p = items[i] as Pair;
    const k = (p.key as YNode).range![0];
    if (!firstOnLine(text, k)) return fallback(text, parentPath, d => d.deleteIn(path), true);
    // the key on a list item's "- " line: the next key moves up into its place
    if (onDash(text, k)) return { steps: [[{ start: k, end: (items[i + 1] as Pair | undefined) ? ((items[i + 1] as Pair).key as YNode).range![0] : pairEnd(c, p), text: '' }]] };
    return { steps: [[{ start: pairStart(c, p), end: pairEnd(c, p), text: '' }]] };
  }
  // a block list item: its "- " line(s)
  const it = items[i] as YNode;
  const s = lineStart(text, it.range![0]);
  if (!/^\s*-/.test(text.slice(s, it.range![0]))) return fallback(text, parentPath, d => d.deleteIn(path), true);
  const e = it.range![1];
  const end = nextLine(text, text[e - 1] === '\n' ? e - 1 : e);
  return { steps: [[{ start: s, end, text: '' }]] };
}

/** Add an item to the list at a path, at an index (default: the end). */
export function insertItem(text: string, listPath: Path, value: unknown, index?: number, order?: readonly string[]): Splice {
  const c = parse(text);
  const f = find(c, listPath);
  if (f.node === undefined || f.node === null || (isScalar(f.node) && f.node.value === null)) {
    if (f.node === undefined) return insertKey(text, listPath.slice(0, -1), String(listPath[listPath.length - 1]), [value], { order });
    return setValue(text, listPath, [value]);
  }
  const list = f.node;
  if (!isSeq(list)) throw new SpliceError(`${listPath.join('.')} is not a list`);
  const items = list.items as YNode[];
  const at = index === undefined ? items.length : Math.max(0, Math.min(index, items.length));
  if ((list as { flow?: boolean }).flow || inFlow(f.chain.slice(0, -1))) {
    const t = flowText(value);
    if (!items.length) { const r = list.range!; const close = text.lastIndexOf(']', r[1]); return { steps: [[{ start: r[0], end: close + 1, text: `[${t}]` }]] }; }
    if (at < items.length) { const s = items[at].range![0]; return { steps: [[{ start: s, end: s, text: `${t}, ` }]] }; }
    const e = items[items.length - 1].range![1];
    return { steps: [[{ start: e, end: e, text: `, ${t}` }]] };
  }
  const first = items[0];
  const dash = lineStart(text, first.range![0]);
  const prefix = text.slice(dash, first.range![0]);
  if (!/^\s*- $/.test(prefix)) return fallback(text, listPath, d => { const s = d.getIn(listPath) as YAMLSeq; s.items.splice(at, 0, d.createNode(value) as never); }, true);
  const indent = prefix.indexOf('-');
  // (0.10.0) a map among maps written inline ({ … }) is written inline too
  const near = items[Math.min(at, items.length - 1)];
  const inline = isObj(value) && isMap(near) && (near as { flow?: boolean }).flow;
  const body = ' '.repeat(indent) + '- ' + (inline
    ? flowText(value)
    : isObj(value) && Object.keys(value as object).length
      ? reindent(yamlText(value), indent + 2).slice(indent + 2)
      : scalarText(value, { flow: false, indent: indent + 2 })) + '\n';
  if (at < items.length) { const s = lineStart(text, items[at].range![0]); return { steps: [[{ start: s, end: s, text: body }]] }; }
  const e = items[items.length - 1].range![1];
  const end = nextLine(text, text[e - 1] === '\n' ? e - 1 : e);
  const pre = end === text.length && !text.endsWith('\n') ? '\n' : '';
  return { steps: [[{ start: end, end, text: pre + body }]] };
}

/** Rename a key in place. */
export function renameKey(text: string, path: Path, to: string): Splice {
  const c = parse(text);
  const f = find(c, path);
  if (!f.pair) throw new SpliceError(`no key at ${path.join('.')}`);
  if ((f.parent as YAMLMap).items.some(p => keyOf(p as Pair) === to)) throw new SpliceError(`"${to}" is already there`);
  const k = f.pair.key as YNode;
  return { steps: [[{ start: k.range![0], end: k.range![1], text: keyText(to) }]] };
}

/** Move a block map's entry (with its comment lines) to before another key, or to the end. */
export function moveKey(text: string, path: Path, before?: string, order?: readonly string[]): Splice {
  const c = parse(text);
  const f = find(c, path);
  if (!f.pair || !isMap(f.parent)) throw new SpliceError(`no key at ${path.join('.')}`);
  const map = f.parent;
  const dashy = onDash(text, (f.pair.key as YNode).range![0]) || (map.items as Pair[]).some(p => onDash(text, (p.key as YNode).range![0]));
  if ((map as { flow?: boolean }).flow || dashy) {
    // a flow map, or a list item's map whose first key is on its "- " line: delete, then insert
    const v = (f.pair.value as YNode | null);
    const value = v ? (c.doc.getIn(path) as { toJSON?: () => unknown })?.toJSON?.() ?? c.doc.getIn(path) : null;
    const del = deleteAt(text, path);
    const mid = applyStep(text, del.steps[0]);
    const ins = insertKey(mid, path.slice(0, -1), String(path[path.length - 1]), value, before ? { before, order } : { order });
    return { steps: [...del.steps, ...ins.steps] };
  }
  const s = pairStart(c, f.pair), e = pairEnd(c, f.pair);
  const chunk = text.slice(s, e);
  const target = before ? (map.items as Pair[]).find(p => keyOf(p) === before) : undefined;
  if (target === f.pair) return { steps: [] };
  const at = target ? pairStart(c, target) : pairEnd(c, map.items[map.items.length - 1] as Pair);
  const body = chunk.endsWith('\n') ? chunk : chunk + '\n';
  // one step, in the old text's coordinates: remove here, insert there
  return { steps: [[{ start: s, end: e, text: '' }, { start: at, end: at, text: at === text.length && !text.endsWith('\n') ? '\n' + body : body }]] };
}

/** Re-serialise the smallest collection holding the change: the last resort, marked as such. */
function fallback(text: string, collPath: Path, mutate: (d: Document.Parsed) => void, _structural = false): Splice {
  const c = parse(text);
  const f = find(c, collPath);
  const node = f.node as YNode | undefined;
  mutate(c.doc);
  if (!collPath.length || !node?.range) return { steps: [[{ start: 0, end: text.length, text: c.doc.toString({ lineWidth: 0 }) }]], fallback: true };
  const after = c.doc.getIn(collPath, true) as YNode;
  const flow = (node as { flow?: boolean }).flow;
  const one = new Document();
  one.contents = after as never;
  let t = one.toString({ lineWidth: 0, indent: 2 }).replace(/\n$/, '');
  const r = node.range;
  if (flow) return { steps: [[{ start: r[0], end: r[1], text: t.replace(/\n\s*/g, ' ') }]], fallback: true };
  const s = lineStart(text, r[0]);
  const ind = r[0] - s;
  const e = r[1] > 0 && text[r[1] - 1] === '\n' ? r[1] - 1 : lineEnd(text, r[1]);
  t = reindent(t, ind).slice(text.slice(s, r[0]).trim() ? ind : 0);
  return { steps: [[{ start: text.slice(s, r[0]).trim() ? r[0] : s, end: e, text: t }]], fallback: true };
}

export type { Seg };

/**
 * Add a pair given as source text ("key: value", with its own comments, at indent 0) to the map at a path, re-indented
 * to the map's; the text, comments and all, is kept. A flow map (or one the splices can't place a line in) takes the
 * value's data instead. The map must exist (insertKey makes a missing one).
 */
export function insertRawPair(text: string, mapPath: Path, key: string, pairText: string, order?: readonly string[]): Splice {
  const c = parse(text);
  const f = find(c, mapPath);
  const map = f.node;
  const value = (parseDocument(pairText).toJS() as Record<string, unknown> | null)?.[key];
  if (!isMap(map) || (map as { flow?: boolean }).flow || inFlow(f.chain.slice(0, -1)) || !map.items.length) return insertKey(text, mapPath, key, value, { order });
  const items = map.items as Pair[];
  const first = items[0].key as YNode;
  if (!first.range || items.some(p => !firstOnLine(text, (p.key as YNode).range![0]) || onDash(text, (p.key as YNode).range![0]))) return insertKey(text, mapPath, key, value, { order });
  if (items.some(p => keyOf(p) === key)) throw new SpliceError(`"${key}" is already in ${mapPath.join('.') || 'the file'}`);
  const indent = colOf(text, first.range[0]);
  const body = reindent(pairText.replace(/\n+$/, ''), indent) + '\n';
  const end = pairEnd(c, items[items.length - 1]);
  const pre = end === text.length && text.length && !text.endsWith('\n') ? '\n' : '';
  return { steps: [[{ start: end, end, text: pre + body }]] };
}

/** A pair's source text (its own comment lines, the key and its value, a comment after it), at indent 0. */
export function pairText(text: string, path: Path): string | undefined {
  const c = parse(text);
  const f = find(c, path);
  if (!f.pair || !isMap(f.parent)) return undefined;
  const k = (f.pair.key as YNode).range![0];
  if ((f.parent as { flow?: boolean }).flow || inFlow(f.chain.slice(0, -1)) || !firstOnLine(text, k) || onDash(text, k)) {
    const v = c.doc.getIn(path, true) as { toJSON?: () => unknown } | null;
    const value = v && typeof v === 'object' && v.toJSON ? v.toJSON() : c.doc.getIn(path);
    return `${keyText(String(path[path.length - 1]))}:${blockValue(value, 0)}\n`;
  }
  const s = pairStart(c, f.pair), e = pairEnd(c, f.pair);
  const ind = colOf(text, k);
  return text.slice(s, e).split('\n').map(l => (l.slice(0, ind).trim() === '' ? l.slice(ind) : l.trimStart())).join('\n').replace(/\n*$/, '\n');
}
