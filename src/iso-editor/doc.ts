// The editor's document: the text (the truth) and a yaml Document parsed from it, with the way between a caret offset
// and a path. E2 adds the command layer on top; here it is read-only. Pure (no DOM).

import { parseDocument, isMap, isSeq, isPair, isScalar, isCollection, LineCounter, type Document, type Node as YNode, type Pair } from 'yaml';
import type { Path } from './path.ts';

export type Where = 'key' | 'value' | 'inside';
export interface At { path: Path; where: Where; node?: YNode }

export class EditorDoc {
  readonly text: string;
  readonly doc: Document.Parsed;
  readonly lines: LineCounter;
  constructor(text: string) {
    this.text = text;
    this.lines = new LineCounter();
    this.doc = parseDocument(text, { keepSourceTokens: true, lineCounter: this.lines, prettyErrors: false, uniqueKeys: false });
  }
  get ok() { return this.doc.errors.length === 0; }
  get data(): unknown { try { return this.doc.toJS(); } catch { return undefined; } }

  /** 1-based line and column of an offset */
  pos(offset: number) { return this.lines.linePos(offset); }
  /** offset of a 1-based line and column */
  offset(line: number, col: number) { return (this.lines.lineStarts[line - 1] ?? this.text.length) + col - 1; }

  /** The source range of the node (or its key, or the whole pair) at a path. */
  rangeOf(path: Path, part: 'value' | 'key' | 'pair' = 'value'): [number, number] | undefined {
    let node: unknown = this.doc.contents;
    let pair: Pair | undefined;
    for (const seg of path) {
      pair = undefined;
      if (isMap(node)) {
        const p = node.items.find(x => isPair(x) && isScalar(x.key) && String(x.key.value) === String(seg));
        if (!p) return undefined;
        pair = p as Pair;
        node = p.value;
      } else if (isSeq(node) && typeof seg === 'number') node = node.items[seg];
      else return undefined;
    }
    if (part === 'key' && pair && isScalar(pair.key) && pair.key.range) return [pair.key.range[0], pair.key.range[1]];
    const v = (node as YNode | null)?.range;
    if (part === 'pair' && pair && isScalar(pair.key) && pair.key.range) return [pair.key.range[0], v ? v[1] : pair.key.range[1]];
    if (v) return [v[0], v[1]];
    if (pair && isScalar(pair.key) && pair.key.range) return [pair.key.range[0], pair.key.range[1]];
    return undefined;
  }

  /** What is at a caret: the innermost key, value or collection whose source contains the offset. */
  at(offset: number): At {
    const walk = (node: unknown, path: Path): At | undefined => {
      if (isMap(node)) {
        for (const p of node.items) {
          const k = p.key as YNode | null;
          if (k?.range && offset >= k.range[0] && offset <= k.range[1]) return { path: [...path, keyOf(p)], where: 'key', node: k };
          const v = p.value as YNode | null;
          if (v?.range && offset >= v.range[0] && (isScalar(v) ? offset <= v.range[1] : offset < v.range[1])) {
            return walk(v, [...path, keyOf(p)]) ?? { path: [...path, keyOf(p)], where: 'value', node: v };
          }
          // an empty value: "key: |" on the key's line
          if (k?.range && (!v || !v.range || isScalar(v) && v.value === null) && offset > k.range[1] && !this.text.slice(k.range[1], offset).includes('\n')) {
            return { path: [...path, keyOf(p)], where: 'value', node: v ?? undefined };
          }
        }
        return node.range && offset >= node.range[0] && offset <= node.range[1] ? { path, where: 'inside', node } : undefined;
      }
      if (isSeq(node)) {
        for (const [i, it] of node.items.entries()) {
          const r = (it as YNode | null)?.range;
          if (r && offset >= r[0] && (isScalar(it) ? offset <= r[1] : offset < r[1])) return walk(it, [...path, i]) ?? { path: [...path, i], where: 'value', node: it as YNode };
        }
        return node.range && offset >= node.range[0] && offset <= node.range[1] ? { path, where: 'inside', node } : undefined;
      }
      if (isScalar(node) && node.range && offset >= node.range[0] && offset <= node.range[1]) return { path, where: 'value', node };
      return undefined;
    };
    return walk(this.doc.contents, []) ?? { path: [], where: 'inside' };
  }

  /** The node at a path. */
  nodeAt(path: Path): YNode | undefined {
    let node: unknown = this.doc.contents;
    for (const seg of path) {
      if (isMap(node)) node = node.items.find(x => isScalar(x.key) && String(x.key.value) === String(seg))?.value;
      else if (isSeq(node) && typeof seg === 'number') node = node.items[seg];
      else return undefined;
    }
    return (node ?? undefined) as YNode | undefined;
  }

  /** Every path in the document, with its range: for tests (rangeOf ∘ at is the identity) and the tree (E3). */
  paths(): { path: Path; range: [number, number] }[] {
    const out: { path: Path; range: [number, number] }[] = [];
    const walk = (node: unknown, path: Path) => {
      const r = (node as YNode | null)?.range;
      if (r && path.length) out.push({ path, range: [r[0], r[1]] });
      if (isMap(node)) for (const p of node.items) walk(p.value, [...path, keyOf(p)]);
      else if (isSeq(node)) node.items.forEach((x, i) => walk(x, [...path, i]));
    };
    walk(this.doc.contents, []);
    return out;
  }
}

function keyOf(p: Pair): string { return isScalar(p.key) ? String(p.key.value) : String(p.key); }

export interface CompletionContext {
  /** the path of the map a key is being typed in, or of the value being typed */
  path: Path;
  kind: 'key' | 'value' | 'item';
  /** the word typed so far, and where it starts */
  prefix: string;
  start: number;
  /** a flow collection ({ … } or [ … ]): keys are written inline */
  flow: boolean;
}

/**
 * What the caret is completing. In a block map the parent is found by indentation (an empty line has no node);
 * after "key: " it is that key's value; in a "- " item or a [ … ] list, an item of that list; inside { … } a key of
 * that map.
 */
export function completionContext(d: EditorDoc, offset: number): CompletionContext {
  const text = d.text;
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const before = text.slice(lineStart, offset);
  const word = /[A-Za-z0-9_.:\/{}*~$-]*$/.exec(before)![0].replace(/^[{[,]/, '');
  const start = offset - word.length;
  // inside a flow collection: use the collection at the caret
  const flowNode = enclosingFlow(d, start);
  if (flowNode) {
    const inner = text.slice(flowNode.range[0], start);
    // after "key: " inside the flow map: a value
    const m = /([A-Za-z0-9_-]+)\s*:\s*$/.exec(inner.slice(Math.max(inner.lastIndexOf(','), inner.lastIndexOf('{')) + 1));
    if (flowNode.kind === 'map' && m) return { path: [...flowNode.path, m[1]], kind: 'value', prefix: word, start, flow: true };
    return { path: flowNode.path, kind: flowNode.kind === 'map' ? 'key' : 'item', prefix: word, start, flow: true };
  }
  // "key: |": a value
  const kv = /^(\s*)(?:- )?([^\s:#][^:#]*?)\s*:\s+$/.exec(before.slice(0, before.length - word.length));
  if (kv) {
    const keyOffset = lineStart + before.indexOf(kv[2], kv[1].length);
    const a = d.at(keyOffset);
    if (a.where === 'key') return { path: a.path, kind: 'value', prefix: word, start, flow: false };
    // a key the parser couldn't place yet: its parent by indentation
    return { path: [...parentByIndent(d, lineStart, kv[1].length), kv[2]], kind: 'value', prefix: word, start, flow: false };
  }
  // "- |": an item of the list above
  const item = /^(\s*)- $/.exec(before.slice(0, before.length - word.length));
  if (item) {
    const owner = parentByIndent(d, lineStart, item[1].length, true);
    return { path: owner, kind: 'item', prefix: word, start, flow: false };
  }
  // a key on its own line: the map is the parent by indentation
  const indent = /^\s*/.exec(before)![0].length;
  return { path: parentByIndent(d, lineStart, indent), kind: 'key', prefix: word, start, flow: false };
}

/** The path of the block map (or list) that a line indented by `indent` belongs to. */
function parentByIndent(d: EditorDoc, lineStart: number, indent: number, forList = false): Path {
  const text = d.text;
  let end = lineStart - 1;
  while (end > 0) {
    const s = text.lastIndexOf('\n', end - 1) + 1;
    const line = text.slice(s, end);
    end = s - 1;
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const ind = /^\s*/.exec(line)![0].length;
    // a sibling key at the same indent: its parent is ours (for a list item, a "- " at the same indent is a sibling)
    if (ind === indent && !forList) {
      const keyAt = s + ind + (line.slice(ind).startsWith('- ') ? 2 : 0);
      const a = d.at(keyAt);
      if (a.where === 'key') return a.path.slice(0, -1);
      if (line.slice(ind).startsWith('- ')) return a.path.slice(0, -1);
    }
    if (ind < indent || (forList && ind <= indent && /:\s*$/.test(line))) {
      const m = /^(\s*)(- )?([^\s:#][^:#]*?)\s*:/.exec(line);
      if (m) {
        const a = d.at(s + m[1].length + (m[2] ? 2 : 0));
        if (a.where === 'key') return a.path;
      }
      if (/^\s*- /.test(line)) {
        const a = d.at(s + ind + 2);
        // the item that holds us: its index is the last number in the path to its first key
        let i = a.path.length - 1;
        while (i >= 0 && typeof a.path[i] !== 'number') i--;
        return i >= 0 ? a.path.slice(0, i + 1) : a.path;
      }
      if (ind < indent) return [];
    }
    if (ind === 0 && indent === 0) return [];
  }
  return [];
}

function enclosingFlow(d: EditorDoc, offset: number): { path: Path; kind: 'map' | 'list'; range: [number, number] } | undefined {
  let best: { path: Path; kind: 'map' | 'list'; range: [number, number] } | undefined;
  const walk = (node: unknown, path: Path) => {
    if (!isCollection(node)) return;
    const r = node.range;
    const flow = (node as { flow?: boolean }).flow;
    if (flow && r && offset > r[0] && offset < r[1]) best = { path, kind: isMap(node) ? 'map' : 'list', range: [r[0], r[1]] };
    if (isMap(node)) for (const p of node.items) walk(p.value, [...path, keyOf(p)]);
    else if (isSeq(node)) node.items.forEach((x, i) => walk(x, [...path, i]));
  };
  walk(d.doc.contents, []);
  return best;
}
