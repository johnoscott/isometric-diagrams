// Completion: keys the schema allows where the caret is, values (enums, true/false), references (the names the file
// declares, by the adapter's table), and the adapter's snippets for a new object. Pure: a text pane's provider turns
// these into its items.

import { EditorDoc, completionContext } from './doc.ts';
import { SchemaNav } from './schema-nav.ts';
import { toPointer, type Path } from './path.ts';
import type { CompleteAdapter, ObjectKindInfo } from './adapter.ts';

export interface Item {
  label: string;
  /** text to insert (a Monaco snippet when `snippet`) */
  insert: string;
  kind: 'key' | 'value' | 'ref' | 'snippet';
  detail?: string;
  /** Markdown */
  doc?: string;
  snippet?: boolean;
  /** sorts before the rest */
  preferred?: boolean;
}
export interface Completion { items: Item[]; start: number; path: Path; context: 'key' | 'value' | 'item' }

type J = Record<string, unknown>;

const data = (d: EditorDoc): J => { const v = d.data; return v && typeof v === 'object' && !Array.isArray(v) ? v as J : {}; };
const get = (o: unknown, path: Path): unknown => path.reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as J)[k as string] : undefined), o);

/** the names declared in a kind's section */
export function namesIn(d: EditorDoc, k: ObjectKindInfo): string[] {
  const m = get(data(d), k.section);
  return m && typeof m === 'object' && !Array.isArray(m) ? Object.keys(m as J).filter(k => !k.startsWith('x-')) : [];
}

export function complete(d: EditorDoc, offset: number, nav: SchemaNav, a: CompleteAdapter): Completion {
  const c = completionContext(d, offset);
  const items: Item[] = [];
  const root = data(d);

  if (c.kind === 'key') {
    const here = get(root, c.path);
    const present = here && typeof here === 'object' && !Array.isArray(here) ? here as J : {};
    if (nav.isNameMap(c.path)) {
      const ptr = toPointer(c.path);
      for (const [k, s] of Object.entries(a.snippets)) if (k.split('#')[0] === ptr) items.push({ label: s.label, insert: s.body, kind: 'snippet', snippet: true, doc: s.doc, preferred: true });
    } else {
      // a map with some keys written offers only what fits
      const indent = ' '.repeat(Math.max(0, c.start - (d.text.lastIndexOf('\n', c.start - 1) + 1)));
      for (const k of nav.keys(c.path, present)) {
        if (k.name in present) continue;
        const after = c.flow || k.shape === 'scalar' ? ': ' : k.shape === 'list' ? ':\n' + indent + '  - ' : ':\n' + indent + '  ';
        const insert = k.enumValues.length > 1 && k.shape === 'scalar' ? `${k.name}: \${1|${k.enumValues.join(',')}|}` : k.name + after;
        items.push({ label: k.name, insert, snippet: insert.includes('${'), kind: 'key', doc: k.doc, detail: k.enumValues.length ? k.enumValues.join(' | ') : k.shape === 'map' ? 'map' : k.shape === 'list' ? 'list' : undefined });
      }
    }
  } else {
    const valuePath = c.kind === 'item' ? [...c.path, 0] : c.path;
    const ptr = toPointer(valuePath);
    const slot = a.slotAt(ptr);
    if (slot) {
      for (const s of slot.targets) { const k = a.kinds.find(x => x.kind === s); if (k) for (const n of namesIn(d, k)) {
        items.push({ label: slot.write ? slot.write(n) : n, insert: slot.write ? slot.write(n) : n, kind: 'ref', detail: `${k.singular} · declared`, preferred: true });
      } }
      for (const e of slot.extra ?? []) items.push({ label: e, insert: /[{*]/.test(e) ? JSON.stringify(e) : e, kind: 'value', detail: a.extraDetail?.(e, root) });
    }
    for (const v of nav.values(valuePath)) if (!items.some(i => i.label === v)) items.push({ label: v, insert: v, kind: 'value' });
    if (!items.length) {
      const k = nav.keys(c.path.slice(0, -1)).find(x => x.name === String(c.path[c.path.length - 1]));
      for (const e of k?.examples ?? []) if (typeof e === 'string') items.push({ label: e, insert: e, kind: 'value', detail: 'example' });
    }
  }
  return { items, start: c.start, path: c.path, context: c.kind };
}
