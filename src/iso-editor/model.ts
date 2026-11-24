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
}

/** The selection changed, and which view changed it (a view doesn't react to its own). */
export interface SelectionChange { paths: Path[]; origin: Origin }

interface Entry {
  id: number;
  label: string;
  origin: Origin;
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
  private emit(c: Change) { for (const fn of this.listeners) fn(c); }

  /** A new file: the text, an empty history, clean. */
  load(text: string, origin: Origin = 'file') {
    const old = this._text;
    this.undoStack = []; this.redoStack = [];
    this.selection = [];
    this._good = undefined;
    this.set(text);
    this.cleanId = 0;
    this.emit({ kind: 'load', origin, label: 'Open', steps: [[{ start: 0, end: old.length, text }]], version: this._version });
  }

  private set(text: string) { this._text = text; this._doc = undefined; this._version++; }

  // ---------- doing ----------

  /** Run a command: build it against the text, apply its steps, push it. Returns false if it changed nothing. `joins`
   *  (0.12.5): the id of an undo step it is part of, when that is the last one, nothing was undone since and the file
   *  wasn't saved at it (the saved text must stay a step of its own to come back to). */
  apply(cmd: Command, origin: Origin = 'api', joins?: number): boolean {
    this.seal();
    const splice = cmd.build(this._text);
    if (!splice.steps.some(s => s.length)) return false;
    const before = { paths: this.selection, text: this.textSel };
    const { inverse } = this.run(splice.steps);
    const remap = cmd.remap ?? ((p: Path) => p);
    this.selection = cmd.select ?? this.selection.map(remap).filter((p): p is Path => p !== null);
    if (splice.fallback) this.fallbacks++;
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && joins !== undefined && top.id === joins && !this.redoStack.length && top.id !== this.cleanId) {
      top.label = cmd.joined?.(top.label) ?? top.label;
      top.steps.push(...splice.steps);
      top.inverse.unshift(...inverse);
      top.after = { paths: this.selection, text: this.textSel };
      top.time = this.now();
      top.fallback ||= !!splice.fallback;
    } else this.push({ id: this.nextId++, label: cmd.label, origin, steps: splice.steps, inverse, before, after: { paths: this.selection, text: this.textSel }, time: this.now(), fallback: !!splice.fallback, open: false });
    this.emit({ kind: 'do', origin, label: cmd.label, steps: splice.steps, version: this._version, remap: cmd.remap });
    for (const fn of this.selListeners) fn({ paths: this.selection, origin });
    return true;
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
    this.emit({ kind: 'do', origin: 'text', label: 'Typing', steps: [step], version: this._version, source });
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
    this.run(e.inverse);
    this.redoStack.push(e);
    this.selection = e.before.paths;
    this.textSel = e.before.text;
    this.emit({ kind: 'undo', origin: 'history', label: e.label, steps: e.inverse, version: this._version, textSel: e.before.text });
    for (const fn of this.selListeners) fn({ paths: this.selection, origin: 'history' });
    return true;
  }

  redo(): boolean {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.run(e.steps);
    this.undoStack.push(e);
    this.selection = e.after.paths;
    this.textSel = e.after.text;
    this.emit({ kind: 'redo', origin: 'history', label: e.label, steps: e.steps, version: this._version, textSel: e.after.text });
    for (const fn of this.selListeners) fn({ paths: this.selection, origin: 'history' });
    return true;
  }

  // ---------- saving ----------

  /** The text was saved: this is the clean point. */
  markClean() { this.seal(); this.cleanId = this.undoStack[this.undoStack.length - 1]?.id ?? 0; }
  get dirty() { return (this.undoStack[this.undoStack.length - 1]?.id ?? 0) !== this.cleanId; }
  /** the labels on the stack, oldest first (for tests and a history list) */
  get history() { return this.undoStack.map(e => e.label); }
}
