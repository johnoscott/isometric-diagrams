// The editor's model: the text (the truth), the Document parsed from it, the selection, and one undo stack for every
// view. Nothing changes the text except through here: a command (a structural edit from the tree, canvas or
// properties, built in commands.ts) or typing (text edits from Monaco, coalesced). Every change is a list of steps of
// text edits; undo applies their exact inverses. Pure (no DOM): the views listen for changes.

import { EditorDoc } from './doc.ts';
import { applyStep, invertStep, type Splice, type Step } from './splice.ts';
import type { Path } from './path.ts';

export type Origin = 'text' | 'tree' | 'canvas' | 'props' | 'menu' | 'api' | 'history' | 'file';

export interface Command {
  /** for the menu and the undo button's tooltip: "Delete node web" */
  label: string;
  /** the change, worked out against the text it will apply to */
  build(text: string): Splice;
  /** the paths it touched (for the views to refresh and reveal) */
  touched?: Path[];
  /** (0.12.5) the label of the step it joined (apply's `joins`), given the step's own */
  joined?(label: string): string;
  /** where a path is after the change (a rename moves paths); null when it no longer exists */
  remap?(p: Path): Path | null;
  /** the selection afterwards (default: the old one, remapped) */
  select?: Path[];
}

/** What a host says of a step, kept with it through undo and redo. The model reads none of it. */
export type StepMeta = Readonly<Record<string, string>>;
/** A step of the history, as a host sees it: made anew at each reading (compare ids, not objects). Its id is never another step's, and is kept
 *  by undo and redo. */
export interface HistoryEntry {
  readonly id: number; readonly label: string; readonly origin: Origin; readonly meta?: StepMeta;
  /** (0.22.1) the paths its command said it touched, each once (a joined step: all of them); none for typing, nor for a whole text put in */
  readonly touched?: readonly (readonly (string | number)[])[];
}
export interface ApplyOptions {
  /** the id of an undo step it is part of, where it can be (see apply) */
  joins?: number;
  /** what the host says of the step. One that is joined keeps its own only where this says the same: otherwise it is the step of two */
  meta?: StepMeta;
}

/** What a view needs to know about a change. */
export interface Change {
  kind: 'do' | 'undo' | 'redo' | 'load';
  origin: Origin;
  label: string;
  /** the steps, in order, each against the text the one before produced */
  steps: Step[];
  version: number;
  /** the text selection to put back (undo/redo of typing), opaque to the model */
  textSel?: unknown;
  /** typing: which text pane typed it (each pane skips only its own; another pane takes it like any change) */
  source?: string;
  /** where paths moved (a rename), so views can carry their own state (expanded rows) along */
  remap?(p: Path): Path | null;
  /** the step it made, joined, undid or redid (none: load) */
  entry?: HistoryEntry;
  /** the text before it */
  before: { readonly length: number };
  /** it put one whole text in place of another (a file opened, a replacement, a paste over everything); not into an empty one */
  whole: boolean;
}

/** The selection changed, and which view changed it (a view doesn't react to its own). */
export interface SelectionChange { paths: Path[]; origin: Origin }

/** @internal a step as the model keeps it */
export interface Entry {
  id: number;
  label: string;
  origin: Origin;
  meta?: StepMeta;
  touched?: Path[];
  steps: Step[];
  /** the inverse of each step, in the order they undo (last step first) */
  inverse: Step[];
  before: { paths: Path[]; text?: unknown };
  after: { paths: Path[]; text?: unknown };
  time: number;
  fallback: boolean;
  /** typing still being added to */
  open: boolean;
  /** for coalescing: where the last typed edit ended, and whether it inserted or deleted */
  caret?: number;
  typing?: 'insert' | 'delete';
  /** typing: the pane it came from (typing joins only typing from the same pane) */
  source?: string;
}

/** a step, as a host sees it */
const seen = (e: Entry): HistoryEntry => Object.freeze({ id: e.id, label: e.label, origin: e.origin, ...(e.meta ? { meta: e.meta } : {}), ...(e.touched ? { touched: Object.freeze(e.touched.map(p => Object.freeze([...p]))) } : {}) });
/** paths, each once, in their order */
const onceEach = (ps: readonly Path[]): Path[] => { const k = new Set<string>(); return ps.filter(p => { const j = JSON.stringify(p); return !k.has(j) && !!k.add(j); }).map(p => [...p]); };
const sameMeta = (a: StepMeta | undefined, b: StepMeta | undefined): boolean => {
  const x = Object.entries(a ?? {}), y = b ?? {};
  return x.length === Object.keys(y).length && x.every(([k, v]) => y[k] === v);
};

export const HISTORY_DEPTH = 500;
const COALESCE_MS = 1000;

export class EditorModel {
  private _text = '';
  private _doc: EditorDoc | undefined;
  private _version = 0;
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private nextId = 1;
  private cleanId = 0;
  private listeners = new Set<(c: Change) => void>();
  private selListeners = new Set<(c: SelectionChange) => void>();
  private _good: EditorDoc | undefined;
  /** the selected paths (tree, canvas, properties) */
  selection: Path[] = [];
  /** the text pane's selection, as it last reported it (opaque) */
  textSel: unknown;
  /** how many commands needed a fallback (re-serialising a collection): for the tests */
  fallbacks = 0;
  depth = HISTORY_DEPTH;
  now: () => number = () => Date.now();

  constructor(text = '') { this._text = text; }
  get text() { return this._text; }
  get version() { return this._version; }
  get doc(): EditorDoc { return (this._doc ??= new EditorDoc(this._text)); }
  /** the document as last parsed without a YAML error: what the tree and canvas show while the text is broken */
  get goodDoc(): EditorDoc {
    if (this.doc.ok) this._good = this.doc;
    return this._good ?? this.doc;
  }

  /** Select paths (from a view). Every other view shows it. */
  select(paths: Path[], origin: Origin) {
    this.selection = paths;
    for (const fn of this.selListeners) fn({ paths, origin });
  }
  onSelect(fn: (c: SelectionChange) => void): () => void { this.selListeners.add(fn); return () => this.selListeners.delete(fn); }

  on(fn: (c: Change) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(c: Omit<Change, 'before' | 'whole' | 'entry'>, length: number, e?: Entry) {
    const first = c.steps.length === 1 ? c.steps[0][0] : undefined;
    const change: Change = { ...c, before: { length }, whole: c.kind === 'load' || (!!first && length > 0 && first.start === 0 && first.end === length), ...(e ? { entry: seen(e) } : {}) };
    for (const fn of this.listeners) fn(change);
  }
  /** what can be undone, oldest first; and what can be redone, the next one last. Already changed when a listener hears of a change */
  get undoEntries(): readonly HistoryEntry[] { return this.undoStack.map(seen); }
  get redoEntries(): readonly HistoryEntry[] { return this.redoStack.map(seen); }

  /** A new file: the text, an empty history, clean. */
  load(text: string, origin: Origin = 'file') {
    const old = this._text;
    this.undoStack = []; this.redoStack = [];
    this.selection = [];
    this._good = undefined;
    this.set(text);
    this.cleanId = 0;
    this.emit({ kind: 'load', origin, label: 'Open', steps: [[{ start: 0, end: old.length, text }]], version: this._version }, old.length);
  }

  private set(text: string) { this._text = text; this._doc = undefined; this._version++; }

  // ---------- doing ----------

  /** Run a command: build it against the text, apply its steps, push it. Returns false, with no step, if the text is as it was. `joins`
   *  (0.12.5): the id of an undo step it is part of, when that is the last one, nothing was undone since and the file
   *  wasn't saved at it (the saved text must stay a step of its own to come back to). */
  apply(cmd: Command, origin: Origin = 'api', options?: number | ApplyOptions): boolean {
    const { joins, meta } = typeof options === 'number' ? { joins: options, meta: undefined } : options ?? {};
    this.seal();
    const splice = cmd.build(this._text), length = this._text.length;
    if (!splice.steps.some(s => s.length) || splice.steps.reduce((t, s) => applyStep(t, s), this._text) === this._text) return false;
    const before = { paths: this.selection, text: this.textSel };
    const { inverse } = this.run(splice.steps);
    const remap = cmd.remap ?? ((p: Path) => p);
    this.selection = cmd.select ?? this.selection.map(remap).filter((p): p is Path => p !== null);
    if (splice.fallback) this.fallbacks++;
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && joins !== undefined && top.id === joins && !this.redoStack.length && top.id !== this.cleanId) {
      top.label = cmd.joined?.(top.label) ?? top.label;
      if (cmd.touched?.length) top.touched = onceEach([...(top.touched ?? []), ...cmd.touched]);
      if (!sameMeta(top.meta, meta)) top.meta = undefined;
      top.steps.push(...splice.steps);
      top.inverse.unshift(...inverse);
      top.after = { paths: this.selection, text: this.textSel };
      top.time = this.now();
      top.fallback ||= !!splice.fallback;
    } else this.push({ id: this.nextId++, label: cmd.label, origin, ...(meta ? { meta: Object.freeze({ ...meta }) } : {}), ...(cmd.touched?.length ? { touched: onceEach(cmd.touched) } : {}), steps: splice.steps, inverse, before, after: { paths: this.selection, text: this.textSel }, time: this.now(), fallback: !!splice.fallback, open: false });
    this.emit({ kind: 'do', origin, label: cmd.label, steps: splice.steps, version: this._version, remap: cmd.remap }, length, this.undoStack[this.undoStack.length - 1]);
    for (const fn of this.selListeners) fn({ paths: this.selection, origin });
    return true;
  }

  /** Put one whole text in place of another, as one step (its undo is byte for byte): the step (always truthy: `if (replace(…))` says whether it did), or false, with none, where it is the same. This is the
   *  model's own, for a host that has one; an editor's setText(text, { undoable: true }) is this and what the editor does around it (the view). */
  replace(text: string, o: { label?: string; origin?: Origin; meta?: StepMeta } = {}): HistoryEntry | false {
    return this.apply({ label: o.label ?? 'Replace everything', build: t => ({ steps: [[{ start: 0, end: t.length, text }]] }), select: [] }, o.origin ?? 'api', { meta: o.meta }) && seen(this.undoStack[this.undoStack.length - 1]);
  }

  /**
   * Text the user typed (one change from the text pane: edits against the text before it). The view has already
   * made the change; the model takes it, and coalesces typing into one command per word or pause.
   */
  typed(step: Step, sel: { before?: unknown; after?: unknown } = {}, source?: string): void {
    if (!step.length) return;
    const time = this.now();
    const top = this.undoStack[this.undoStack.length - 1];
    const one = step.length === 1 ? step[0] : undefined;
    const kind: 'insert' | 'delete' | undefined = one ? (one.text && one.start === one.end ? 'insert' : !one.text && one.end > one.start ? 'delete' : undefined) : undefined;
    let joins = !!(top && top.open && top.origin === 'text' && top.source === source && this.redoStack.length === 0 && time - top.time < COALESCE_MS && one && kind && kind === top.typing);
    if (joins && kind === 'insert') {
      // a word ends where whitespace or punctuation follows a word character: that starts the next command
      const prevChar = this._text[one!.start - 1] ?? '';
      joins = one!.start === top!.caret && !one!.text.includes('\n') && !(/[\w-]/.test(prevChar) && /^[^\w-]/.test(one!.text));
    }
    if (joins && kind === 'delete') joins = one!.end === top!.caret;
    const length = this._text.length;
    const { inverse } = this.run([step]);
    if (joins) {
      top!.steps.push(step);
      top!.inverse.unshift(...inverse);
      top!.time = time;
      top!.after = { paths: this.selection, text: sel.after };
      top!.caret = kind === 'insert' ? one!.start + one!.text.length : one!.start;
    } else {
      this.seal();
      this.push({
        id: this.nextId++, label: 'Typing', origin: 'text', steps: [step], inverse, before: { paths: this.selection, text: sel.before ?? this.textSel },
        after: { paths: this.selection, text: sel.after }, time, fallback: false, open: !!kind,
        caret: one ? (kind === 'insert' ? one.start + one.text.length : one.start) : undefined, typing: kind, source,
      });
    }
    if (sel.after !== undefined) this.textSel = sel.after;
    this.emit({ kind: 'do', origin: 'text', label: 'Typing', steps: [step], version: this._version, source }, length, this.undoStack[this.undoStack.length - 1]);
  }

  /** End the typing group being added to (a caret jump, a pause, leaving the text pane, a save). */
  seal() { const top = this.undoStack[this.undoStack.length - 1]; if (top) top.open = false; }

  private run(steps: Step[]): { inverse: Step[] } {
    const inverse: Step[] = [];
    let t = this._text;
    for (const s of steps) { const next = applyStep(t, s); inverse.unshift(invertStep(t, s)); t = next; }
    this.set(t);
    return { inverse };
  }

  private push(e: Entry) {
    this.undoStack.push(e);
    this.redoStack = [];
    if (this.undoStack.length > this.depth) {
      const dropped = this.undoStack.shift()!;
      // the clean point fell off the bottom: the file can no longer be reached by undo, so it stays dirty
      if (dropped.id === this.cleanId) this.cleanId = -1;
    }
  }

  // ---------- undoing ----------

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  /** the last undo step's id (what `apply` may join) */
  get undoId() { return this.undoStack[this.undoStack.length - 1]?.id; }
  get undoLabel() { return this.undoStack[this.undoStack.length - 1]?.label; }
  get redoLabel() { return this.redoStack[this.redoStack.length - 1]?.label; }

  undo(): boolean {
    this.seal();
    const e = this.undoStack.pop();
    if (!e) return false;
    const length = this._text.length;
    this.run(e.inverse);
    this.redoStack.push(e);
    this.selection = e.before.paths;
    this.textSel = e.before.text;
    this.emit({ kind: 'undo', origin: 'history', label: e.label, steps: e.inverse, version: this._version, textSel: e.before.text }, length, e);
    for (const fn of this.selListeners) fn({ paths: this.selection, origin: 'history' });
    return true;
  }

  redo(): boolean {
    const e = this.redoStack.pop();
    if (!e) return false;
    const length = this._text.length;
    this.run(e.steps);
    this.undoStack.push(e);
    this.selection = e.after.paths;
    this.textSel = e.after.text;
    this.emit({ kind: 'redo', origin: 'history', label: e.label, steps: e.steps, version: this._version, textSel: e.after.text }, length, e);
    for (const fn of this.selListeners) fn({ paths: this.selection, origin: 'history' });
    return true;
  }

  // ---------- saving ----------

  /** The text was saved: this is the clean point. */
  markClean() { this.seal(); this.cleanId = this.undoStack[this.undoStack.length - 1]?.id ?? 0; }
  get dirty() { return (this.undoStack[this.undoStack.length - 1]?.id ?? 0) !== this.cleanId; }
  /** the labels on the stack, oldest first (for tests and a history list) */
  get history() { return this.undoStack.map(e => e.label); }

  // ---------- keeping the history (0.27.0: src/iso-editor/history-log.ts) ----------

  /** @internal the stacks as they are, for history-log.ts (read only there). (0.27.1) Reading them doesn't seal the typing group being
   *  added to: a host may take the log after every keystroke and typing still joins into one step */
  _stacks(): { undo: readonly Entry[]; redo: readonly Entry[] } { return { undo: this.undoStack, redo: this.redoStack }; }
  /** @internal put a history in place (history-log.ts's restore, after it has proven it): the text is clean at its last step */
  _put(undo: Entry[], redo: Entry[]) {
    this.undoStack = undo.slice(-this.depth); this.redoStack = redo.slice(-this.depth);
    this.nextId = Math.max(this.nextId, ...[...undo, ...redo].map(e => e.id + 1));
    this.cleanId = this.undoStack[this.undoStack.length - 1]?.id ?? 0;
  }
}