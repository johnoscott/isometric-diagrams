// YAML text → plain data, keeping a way back from any JSON path to its line and column.

import { parseDocument, LineCounter, isMap, isSeq, isPair, isScalar, type Document, type Node as YNode } from 'yaml';
import type { Diag } from './errors.ts';

export interface Parsed {
  data: unknown;
  /** line/col (1-based) of the value at a JSON path; `key: true` gives the key's place in its map instead */
  locate(path: string, opts?: { key?: boolean }): { line: number; col: number };
  /** the lines (1-based, inclusive) the value at a JSON path spans in the source; undefined if not found */
  span(path: string): { start: number; end: number } | undefined;
  diags: Diag[];
}

function splitPath(path: string): (string | number)[] {
  return path.split('/').slice(1).map(s => {
    const u = s.replace(/~1/g, '/').replace(/~0/g, '~');
    return /^\d+$/.test(u) ? Number(u) : u;
  });
}

export function parse(source: string): Parsed {
  const lc = new LineCounter();
  const doc: Document = parseDocument(source, { lineCounter: lc, prettyErrors: false, uniqueKeys: true });
  const diags: Diag[] = [];
  const pos = (offset: number) => { const p = lc.linePos(offset); return { line: p.line, col: p.col }; };

  for (const e of doc.errors) {
    const p = pos(e.pos[0]);
    const msg = e.message.split('\n')[0];
    const hint = /Nested mappings|Implicit keys|mapping values/i.test(msg) ? 'text that contains ": " (a colon followed by a blank) must be in quotes, e.g. command: \'send "a: b"\''
      : /Map keys must be unique/i.test(msg) ? 'a key is written twice in the same map' : undefined;
    diags.push({ severity: 'error', message: `YAML: ${msg}`, line: p.line, col: p.col, path: '', hint });
  }
  for (const w of doc.warnings) {
    const p = pos(w.pos[0]);
    diags.push({ severity: 'warning', message: `YAML: ${w.message.split('\n')[0]}`, line: p.line, col: p.col, path: '' });
  }

  function locate(path: string, opts: { key?: boolean } = {}) {
    const parts = splitPath(path);
    let node: unknown = doc.contents;
    let last: { line: number; col: number } = { line: 1, col: 1 };
    const here = (n: unknown) => {
      const r = (n as YNode | undefined)?.range;
      if (r) last = pos(r[0]);
    };
    here(node);
    for (let i = 0; i < parts.length; i++) {
      const k = parts[i];
      if (isMap(node)) {
        const pair = node.items.find(p => isPair(p) && isScalar(p.key) && String(p.key.value) === String(k));
        if (!pair) break;
        if (opts.key && i === parts.length - 1) { here(pair.key); return last; }
        here(pair.key);
        node = pair.value;
        if (node) here(node);
      } else if (isSeq(node) && typeof k === 'number') {
        node = node.items[k];
        if (!node) break;
        here(node);
      } else break;
    }
    return last;
  }

  function span(path: string) {
    let node: unknown = doc.contents;
    for (const k of splitPath(path)) {
      if (isMap(node)) {
        const pair = node.items.find(p => isPair(p) && isScalar(p.key) && String(p.key.value) === String(k));
        if (!pair) return undefined;
        node = pair.value;
      } else if (isSeq(node) && typeof k === 'number') node = node.items[k];
      else return undefined;
      if (!node) return undefined;
    }
    const r = (node as YNode).range;
    if (!r) return undefined;
    // a sequence item starts at its "- " (one column before the node); its end is where its value ends
    let end = lc.linePos(Math.max(r[0], r[1] - 1)).line;
    // trailing blank or comment-only lines are not part of the item
    const lines = source.split(/\r?\n/);
    while (end > lc.linePos(r[0]).line && /^\s*(#.*)?$/.test(lines[end - 1] ?? '')) end--;
    return { start: lc.linePos(r[0]).line, end };
  }

  let data: unknown = null;
  if (!doc.errors.length) data = doc.toJS({ maxAliasCount: 100 });
  return { data, locate, span, diags };
}
