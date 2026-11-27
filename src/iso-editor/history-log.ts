// (0.27.0) The editor's history kept beside its text: revisionLog(model) is the undo and redo history as data (JSON), and
// restoreLog(model, log) gives it back after a reload, only for the text it was kept with and only when every step undoes and redoes
// to it exactly. A module of its own, so an editor that keeps no history bundles none of it.
import type { EditorModel, Entry, Origin, StepMeta } from './model.ts';
import { applyStep, type Step, type TextEdit } from './splice.ts';
import type { Path } from './path.ts';

/** A step of the history as data a host can keep (JSON): what undo and redo need, and what a host sees of it. */
export interface LoggedStep {
  readonly id: number; readonly label: string; readonly origin: Origin; readonly meta?: StepMeta;
  readonly touched?: readonly (readonly (string | number)[])[];
  /** its steps, each against the text the one before produced; and their inverses, in the order they undo */
  readonly steps: readonly Step[]; readonly inverse: readonly Step[];
  /** when it was made or last joined (the model's clock, ms) */
  readonly time: number;
  /** the selected paths before and after it (the text pane's own selection is not kept: it is the pane's) */
  readonly before: readonly Path[]; readonly after: readonly Path[];
}
/** The history of a text, to keep beside it and give back after a reload. */
export interface RevisionLog {
  readonly format: 'iso-editor-history/1';
  /** a hash of the text it belongs to (53 bits and the length, as hex): restoreLog takes it only for that text */
  readonly hash: string;
  /** what undo goes back through, oldest first; what redo goes forward through, the next one last */
  readonly undo: readonly LoggedStep[]; readonly redo: readonly LoggedStep[];
}

/** a text's hash for a history (cyrb53, and the length): says whether a text is the one a history was kept with. Not for secrets:
 *  restoreLog also proves every step against the text */
export function textHash(t: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0') + ':' + t.length.toString(16);
}

const copySteps = (ss: readonly Step[]): Step[] => ss.map(s => s.map(x => ({ ...x })));
const copyPaths = (ps: readonly (readonly (string | number)[])[]): Path[] => ps.map(p => [...p]);
const logged = (e: Entry): LoggedStep => ({
  id: e.id, label: e.label, origin: e.origin, ...(e.meta ? { meta: { ...e.meta } } : {}), ...(e.touched ? { touched: copyPaths(e.touched) } : {}),
  steps: copySteps(e.steps), inverse: copySteps(e.inverse), time: e.time, before: copyPaths(e.before.paths), after: copyPaths(e.after.paths),
});

/** The model's history as data to keep beside its text (JSON), for restoreLog after a reload. The text pane's selections are not in it. */
export function revisionLog(m: EditorModel): RevisionLog {
  const { undo, redo } = m._stacks();
  return { format: 'iso-editor-history/1', hash: textHash(m.text), undo: undo.map(logged), redo: redo.map(logged) };
}

const ORIGINS: readonly Origin[] = ['text', 'tree', 'canvas', 'props', 'menu', 'api', 'history', 'file'];
const isEdit = (x: unknown): x is TextEdit => {
  const e = x as TextEdit;
  return !!e && typeof e === 'object' && Number.isInteger(e.start) && Number.isInteger(e.end) && e.start >= 0 && e.end >= e.start && typeof e.text === 'string';
};
const isSteps = (x: unknown): x is Step[] => Array.isArray(x) && x.every(s => Array.isArray(s) && s.every(isEdit));
const isPaths = (x: unknown): x is Path[] => Array.isArray(x) && x.every(p => Array.isArray(p) && p.every(k => typeof k === 'string' || typeof k === 'number'));
const isStep = (e: LoggedStep): boolean => !!e && Number.isInteger(e.id) && e.id > 0 && typeof e.label === 'string' && ORIGINS.includes(e.origin)
  && isSteps(e.steps) && isSteps(e.inverse) && e.steps.length > 0 && e.steps.length === e.inverse.length && typeof e.time === 'number'
  && isPaths(e.before) && isPaths(e.after) && (e.touched === undefined || isPaths(e.touched))
  && (e.meta === undefined || (typeof e.meta === 'object' && Object.values(e.meta).every(v => typeof v === 'string')));
/** a text after some steps, each within the text it is applied to; undefined where one doesn't fit */
const walk = (t: string | undefined, steps: readonly Step[]): string | undefined => {
  for (const s of steps) { if (t === undefined || !s.every(e => e.end <= t!.length)) return undefined; t = applyStep(t, s); }
  return t;
};

/** Give a kept history back to the model's text: only when the text's hash is the log's, and only when every step, undone and redone
 *  on a copy, gives the text back exactly; else nothing changes and it says why. The text is clean after it (a host restores what it
 *  has just read), steps beyond the model's depth are left out, oldest first, and new steps' ids follow the log's. */
export function restoreLog(m: EditorModel, log: unknown): { ok: true; steps: number } | { ok: false; why: string } {
  const no = (why: string) => ({ ok: false as const, why });
  const l = log as Partial<RevisionLog> | null;
  if (!l || typeof l !== 'object' || l.format !== 'iso-editor-history/1') return no('not a history this editor keeps (format iso-editor-history/1)');
  if (l.hash !== textHash(m.text)) return no('the history belongs to another text: the file changed since it was kept');
  if (!Array.isArray(l.undo) || !Array.isArray(l.redo)) return no('the history has no undo and redo lists');
  const all = [...l.undo, ...l.redo] as LoggedStep[];
  const bad = all.find(e => !isStep(e));
  if (bad !== undefined) return no(`a step of the history is not one this editor made (${typeof bad?.label === 'string' ? `"${bad.label}"` : 'unnamed'})`);
  if (new Set(all.map(e => e.id)).size !== all.length) return no('two steps of the history have one id');
  // every undo, from the text now back to the first, then each redone; then every redo forward and back: each must give the text back
  let t: string | undefined = m.text;
  const texts: string[] = [];
  for (const e of [...l.undo].reverse()) { texts.push(t!); t = walk(t, e.inverse); if (t === undefined) return no(`undoing "${e.label}" doesn't fit the text`); }
  for (const e of l.undo) { t = walk(t, e.steps); if (t !== texts.pop()) return no(`"${e.label}" doesn't redo to the text it undid from`); }
  for (const e of [...l.redo].reverse()) {
    const fwd = walk(t, e.steps);
    if (fwd === undefined) return no(`redoing "${e.label}" doesn't fit the text`);
    if (walk(fwd, e.inverse) !== t) return no(`"${e.label}" doesn't undo to the text it was redone from`);
    t = fwd;
  }
  const entry = (e: LoggedStep): Entry => ({
    id: e.id, label: e.label, origin: e.origin, ...(e.meta ? { meta: Object.freeze({ ...e.meta }) } : {}), ...(e.touched?.length ? { touched: copyPaths(e.touched) } : {}),
    steps: copySteps(e.steps), inverse: copySteps(e.inverse), time: e.time, before: { paths: copyPaths(e.before) }, after: { paths: copyPaths(e.after) },
    fallback: false, open: false,
  });
  m._put(l.undo.map(entry), l.redo.map(entry));
  const { undo, redo } = m._stacks();
  return { ok: true, steps: undo.length + redo.length };
}
