// Problems for the editor: the domain's reader (schema + rules), turned into ranges in this file. A problem in another
// file (a base file the chain inherits) is shown at this file's extends:, naming the file and line. Pure; the caller
// supplies the base files (a server resolves extends: under its root).

import { EditorDoc } from './doc.ts';
import { fromPointer } from './path.ts';
import type { Diag } from '../iso-core/errors.ts';
import type { PlaceAdapter, ReadAdapter } from './adapter.ts';

export interface Problem {
  severity: 'error' | 'warning';
  message: string;
  hint?: string;
  path: string;
  /** 1-based, end exclusive */
  startLine: number; startCol: number; endLine: number; endCol: number;
  /** the other file it is in, when it isn't this one */
  file?: string;
}

export interface ValidateOpts {
  fileName?: string;
  defaults?: { name: string; text: string }[];
  /** problems resolving extends: (loops, missing files), from the server */
  extendsDiags?: Diag[];
  profiles?: string[];
}

/** The problems, and what the reader resolved: each object's tag (with the base files merged), and its own reading. */
export function analyse(a: ReadAdapter, text: string, opts: ValidateOpts & { fileName: string }): { problems: Problem[]; tags: Map<string, string>; read?: unknown } {
  const d = new EditorDoc(text);
  const r = a.read(text, { fileName: opts.fileName, defaults: opts.defaults, profiles: opts.profiles, role: a.role(text) });
  const all = [...(opts.extendsDiags ?? []), ...r.diags];
  return { problems: all.map(x => place(a, d, x, opts.fileName)), tags: r.tags ?? new Map(), read: r.read };
}

/** A diagnostic as a range in the text (a host's plan problem too: its pointer and line, made a Diag). */
export function place(a: PlaceAdapter, d: EditorDoc, x: Diag, fileName: string): Problem {
  const base = { severity: x.severity, message: x.message, hint: x.hint, path: x.path };
  if (x.file && x.file !== fileName) {
    // in another file: at this file's extends:
    const r = d.rangeOf(['extends']) ?? [0, 0];
    const a = d.pos(r[0]), b = d.pos(r[1]);
    return { ...base, message: `${x.file}:${x.line}: ${x.message}`, file: x.file, startLine: a.line, startCol: a.col, endLine: b.line, endCol: b.col };
  }
  const path = fromPointer(x.path);
  // a message about a whole object is placed on its name
  const whole = a.objectOf(x.path)?.path === x.path;
  const r = path.length ? d.rangeOf(path, whole || a.keyMessage.test(x.message) ? 'key' : 'value') : undefined;
  if (r && r[1] > r[0]) {
    // a block value spans lines: mark its first line only
    const nl = d.text.indexOf('\n', r[0]);
    const end = nl >= 0 && nl < r[1] ? nl : r[1];
    const a = d.pos(r[0]), b = d.pos(Math.max(end, r[0] + 1));
    return { ...base, startLine: a.line, startCol: a.col, endLine: b.line, endCol: b.col };
  }
  // the word at the reported place
  const line = Math.max(1, x.line), col = Math.max(1, x.col);
  const off = d.offset(line, col);
  const m = /^[^\s,:{}[\]]+/.exec(d.text.slice(off));
  return { ...base, startLine: line, startCol: col, endLine: line, endCol: col + Math.max(1, m ? m[0].length : 1) };
}
