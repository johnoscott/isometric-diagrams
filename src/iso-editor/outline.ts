// The outline of a file, for the tree: its own settings, then a group per kind in the adapter's order (a missing
// section is still shown, so something can be added to it), each object with its keys, the setting groups, and every
// map, list and value under them. Pure: the tree view renders it.

import { isMap, isSeq, isScalar, isPair, type Node as YNode, type Pair } from 'yaml';
import type { EditorDoc } from './doc.ts';
import { toPointer, type Path } from './path.ts';
import type { OutlineAdapter, FileRole } from './adapter.ts';

export type NodeKind = 'root' | 'group' | 'resource' | 'key' | 'item';
export interface OutlineNode {
  /** the JSON Pointer of the node's path (unique) */
  id: string;
  path: Path;
  kind: NodeKind;
  label: string;
  /** a scalar's text, as written */
  value?: string;
  shape: 'map' | 'list' | 'scalar' | 'missing';
  /** for an object and its group: its kind */
  section?: string;
  /** for an object: its tag (the reader's, else the adapter's from this file) */
  lifetime?: string;
  /** the key is an x-* extension */
  ext?: boolean;
  children: OutlineNode[];
}

const keyOf = (p: Pair) => (isScalar(p.key) ? String(p.key.value) : String(p.key));

/**
 * @param tags the reader's tags by object name (with the base files merged), when known; without them an object's
 *   tag is the adapter's, from this file alone
 */
export function outline(d: EditorDoc, a: OutlineAdapter, role: FileRole = 'main', tags?: Map<string, string>): OutlineNode {
  const text = d.text;
  const data = (d.data ?? {}) as Record<string, unknown>;

  const scalarText = (n: YNode | null | undefined): string => {
    if (!n) return '';
    const r = n.range;
    if (r && r[1] > r[0]) {
      const t = text.slice(r[0], r[1]).replace(/\s+$/, '');
      // a block scalar: its first line of content
      if (/^[|>]/.test(t)) return (String((n as { value?: unknown }).value ?? '').split('\n')[0] ?? '') + ' …';
      return t;
    }
    return isScalar(n) ? String(n.value ?? '') : '';
  };

  /** a node for any YAML value, at a path */
  const node = (n: YNode | null | undefined, path: Path, label: string, kind: NodeKind, section?: string): OutlineNode => {
    const id = toPointer(path);
    const ext = typeof path[path.length - 1] === 'string' && String(path[path.length - 1]).startsWith('x-');
    if (isMap(n)) {
      return { id, path, kind, label, shape: 'map', section, ext, children: (n.items as Pair[]).map(p => node(p.value as YNode | null, [...path, keyOf(p)], keyOf(p), 'key')) };
    }
    if (isSeq(n)) {
      return { id, path, kind, label, shape: 'list', section, ext, value: n.items.length ? undefined : '[]',
        children: n.items.map((x, i) => node(x as YNode, [...path, i], isScalar(x) ? scalarText(x as YNode) : `${i + 1}`, 'item')) };
    }
    const out: OutlineNode = { id, path, kind, label, shape: 'scalar', value: scalarText(n), section, ext, children: [] };
    if (kind === 'item') { out.label = out.value ?? ''; delete out.value; }
    return out;
  };

  const root = d.doc.contents;
  const pairs = isMap(root) ? (root.items as Pair[]) : [];
  const get = (k: string) => pairs.find(p => keyOf(p) === k);
  const children: OutlineNode[] = [];
  const used = new Set<string>();

  // the file's own settings first
  for (const k of a.outline.first) { const p = get(k); if (p) { children.push(node(p.value as YNode, [k], k, 'key')); used.add(k); } }
  const nested = new Set<string>();
  if (role === 'main') {
    for (const name of a.outline.kinds) {
      const g = a.kinds.find(k => k.kind === name)!;
      const path = g.section.map(String);
      const top = get(path[0]);
      if (path.length === 1) used.add(path[0]); else nested.add(path[0]);
      let mapNode: YNode | null | undefined = top?.value as YNode | null | undefined;
      if (path.length > 1) mapNode = isMap(mapNode) ? ((mapNode.items as Pair[]).find(p => keyOf(p) === path[1])?.value as YNode | undefined) : undefined;
      const group: OutlineNode = { id: toPointer(path), path, kind: 'group', label: g.group, section: g.kind, shape: isMap(mapNode) ? 'map' : 'missing', children: [] };
      if (isMap(mapNode)) {
        for (const p of mapNode.items as Pair[]) {
          const name = keyOf(p);
          if (name.startsWith('x-')) { group.children.push(node(p.value as YNode, [...path, name], name, 'key')); continue; }
          const r = node(p.value as YNode, [...path, name], name, 'resource', g.kind);
          const tag = tags?.get(name) ?? a.outline.tag?.(g.kind, name, getIn(data, [...path, name]), data);
          if (tag !== undefined) r.lifetime = tag;
          group.children.push(r);
        }
      }
      children.push(group);
    }
    // a map that holds a section (a section nested in it): its other keys, if any
    for (const top of nested) {
      const holder = get(top);
      const inner = new Set(a.kinds.filter(k => String(k.section[0]) === top).map(k => String(k.section[1])));
      if (holder && isMap(holder.value)) {
        used.add(top);
        for (const p of (holder.value as { items: Pair[] }).items) if (!inner.has(keyOf(p))) children.push(node(p.value as YNode, [top, keyOf(p)], `${top}.${keyOf(p)}`, 'key'));
      } else if (holder) used.add(top);
    }
  }
  for (const { key: k, label, when } of a.outline.groups) {
    const p = get(k);
    used.add(k);
    if (p) children.push({ ...node(p.value as YNode, [k], label, 'group'), kind: 'group' });
    else if (role !== 'other' && (!when || when(data))) children.push({ id: '/' + k, path: [k], kind: 'group', label, shape: 'missing', children: [] });
  }
  // anything else, as written (x-* keys, unknown keys)
  for (const p of pairs) { const k = keyOf(p); if (!used.has(k) && isPair(p)) children.push(node(p.value as YNode, [k], k, 'key')); }

  return { id: '', path: [], kind: 'root', label: a.outline.rootLabel(data, role), shape: 'map', children };
}
const getIn = (o: unknown, p: Path) => p.reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k as string] : undefined), o);

/** Every node, depth first (for search and keyboard). */
export function flatten(n: OutlineNode, out: OutlineNode[] = []): OutlineNode[] {
  out.push(n);
  for (const c of n.children) flatten(c, out);
  return out;
}

