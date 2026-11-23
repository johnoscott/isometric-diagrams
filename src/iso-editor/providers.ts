// What the text panes ask the editor core, by offset into the text, for any editor: hover, go to definition, where a
// path is, where a problem is, and completion's snippets in each editor's syntax. Pure (no DOM, no editor), shared by
// the Monaco pane, a thin adapter. Kept editor-neutral (and Node-tested) so another editor can use them again:
// CodeMirror 6 did in E8 (tag editor-codemirror-e8), with cmSnippet below. What the file's references and schemas are
// is the domain adapter's (providersFor).

import { EditorDoc } from './doc.ts';
import { SchemaNav } from './schema-nav.ts';
import { complete, type Item } from './complete.ts';
import type { Problem } from './validate.ts';
import { toPointer, type Path } from './path.ts';
import type { ProvidersAdapter } from './adapter.ts';

/** The parsed document for a text: the last one, reused while the text is the same (each keystroke parses once). */
let last: EditorDoc | undefined;
export function docFor(text: string): EditorDoc {
  if (last?.text !== text) last = new EditorDoc(text);
  return last;
}

/** What the text panes ask, for one domain: completion, hover and go to definition, and the schema navigator for a
 *  text (the main one, or a base file's). */
export function providersFor(a: ProvidersAdapter) {
  // one navigator per schema: a domain may pick its schema by the file's text (its version line)
  const navs = new Map<object, SchemaNav>();
  const navOf = (schema: object) => { let n = navs.get(schema); if (!n) navs.set(schema, (n = new SchemaNav(schema))); return n; };
  const navFor = (text: string) => { const role = a.role(text) === 'base' ? 'base' : 'main'; return navOf(a.schema(role, text)); };
  const sectionPath = (kind: string) => a.kinds.find(k => k.kind === kind)?.section ?? [];

  /** Completion at an offset: where the replaced text starts, and the items (best first). */
  function completionAt(d: EditorDoc, offset: number): { from: number; items: Item[] } {
    const c = complete(d, offset, navFor(d.text), a);
    const items = c.items.map((it, i) => ({ it, i })).sort((a, b) => Number(!!b.it.preferred) - Number(!!a.it.preferred) || a.i - b.i).map(x => x.it);
    return { from: c.start, items };
  }

  /** A hover at an offset: the range it is about, and its parts (Markdown: **bold** and `code` only). */
  function hoverAt(d: EditorDoc, offset: number): { from: number; to: number; parts: string[] } | null {
    const a = d.at(offset);
    if (!a.path.length || a.where === 'inside') return null;
    const parts: string[] = [];
    const doc = navFor(d.text).hover(a.path);
    if (doc) parts.push(`**${a.path.join('.')}**\n\n${doc}`);
    // a reference: what it points at
    const ref = A.refs(d.data).find(r => r.path === toPointer(a.path));
    if (ref?.name) {
      const target = ref.slot.targets.map(s => [...sectionPath(s), ref.name!]).find(p => d.rangeOf(p));
      parts.push(target ? `→ \`${target.join('.')}\` (line ${d.pos(d.rangeOf(target, 'key')![0]).line}; ⌘-click to go there)` : `→ no ${ref.slot.targets.join('/')} named \`${ref.name}\``);
    }
    if (!parts.length) return null;
    const r = d.rangeOf(a.path, a.where === 'key' ? 'key' : 'value') ?? [offset, offset];
    return { from: r[0], to: r[1], parts };
  }

  /** Go to definition at an offset: the declaration a reference names, or an extends: file to open. */
  function definitionAt(d: EditorDoc, offset: number): { from: number; to: number } | { open: string } | null {
    const a = d.at(offset);
    if (a.path[0] === 'extends' && a.where !== 'key') {
      const v = d.nodeAt(a.path) as { value?: unknown } | undefined;
      if (typeof v?.value === 'string') return { open: v.value };
    }
    const ref = A.refs(d.data).find(r => r.path === toPointer(a.path));
    if (!ref?.name) return null;
    for (const s of ref.slot.targets) {
      const r = d.rangeOf([...sectionPath(s), ref.name], 'key');
      if (r) return { from: r[0], to: r[1] };
    }
    return null;
  }
  const A = a;
  return { navFor, completionAt, hoverAt, definitionAt };
}
export type Providers = ReturnType<typeof providersFor>;

/** Where a path is drawn in the text, to mark it: its whole pair, else its value. */
export function rangeOfPath(d: EditorDoc, p: Path): [number, number] | undefined {
  return d.rangeOf(p, 'pair') ?? d.rangeOf(p);
}

/** A problem's range as offsets into the text (its lines and columns are 1-based), clamped to the text. */
export function problemRange(text: string, p: Pick<Problem, 'startLine' | 'startCol' | 'endLine' | 'endCol'>): [number, number] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  const at = (line: number, col: number) => {
    const l = Math.min(Math.max(line, 1), starts.length);
    const end = l < starts.length ? starts[l] - 1 : text.length;
    return Math.min(starts[l - 1] + Math.max(col, 1) - 1, end);
  };
  const a = at(p.startLine, p.startCol);
  return [a, Math.max(a, at(p.endLine, p.endCol))];
}

/**
 * Completion's snippets are written in Monaco's syntax (${1:name}, ${2|a,b|}, ${0}). CodeMirror's has fields (${1:name},
 * ${}) but no choices: a choice becomes a field holding its first option (the others are offered as values once the
 * caret is there), and the final ${0} an empty field.
 */
export function cmSnippet(monaco: string): string {
  return monaco.replace(/\$\{(\d+)\|([^|}]*)\|\}/g, (_m, n: string, opts: string) => `\${${n}:${opts.split(',')[0]}}`).replace(/\$\{0\}/g, '${}');
}

/** The Markdown a hover or completion carries, as runs of text: plain, bold or code, in paragraphs (never markup). */
export function mdRuns(md: string): { kind: 'text' | 'bold' | 'code'; text: string }[][] {
  return md.split(/\n{2,}/).map(par => {
    const runs: { kind: 'text' | 'bold' | 'code'; text: string }[] = [];
    for (const m of par.matchAll(/\*\*([^*]+)\*\*|`([^`]+)`|([^*`]+|[*`])/g)) {
      if (m[1] !== undefined) runs.push({ kind: 'bold', text: m[1] });
      else if (m[2] !== undefined) runs.push({ kind: 'code', text: m[2] });
      else runs.push({ kind: 'text', text: m[3] });
    }
    return runs;
  });
}
