// What the page asks of its text pane (Monaco: text.ts). A pane binds to the one EditorModel: typing goes to the model
// once, tagged with the pane; every other change (the tree, the canvas, undo) comes back from the model, and never
// returns to it. The interface outlived a second pane (CodeMirror 6, tried in E8: tag editor-codemirror-e8).

import type { Problem } from '../validate.ts';
import type { Path } from '../path.ts';
import type { EditorDoc } from '../doc.ts';
import type { Item } from '../complete.ts';

/** A text selection as offsets into the text, the form the model keeps for undo (any pane can put it back). */
export type TextSel = { anchor: number; head: number }[];

export interface TextPane {
  id: 'monaco';
  el: HTMLElement;
  setProblems(ps: Problem[]): void;
  /** the path at the caret, for the status bar */
  pathAtCaret(): Path;
  /** mark paths in the text (and move the caret to the first, unless this pane has the focus) */
  showSelection(paths: Path[], move: boolean): void;
  /** put the caret at a path, scroll to it, and focus the pane */
  goTo(path: Path): void;
  /** put the caret at an offset, scroll to it, and focus the pane */
  goToOffset(offset: number): void;
  /** the caret, 1-based, for the status bar */
  caret(): { line: number; col: number } | undefined;
  /** the caret moved (in this pane) */
  onCaret(fn: () => void): void;
  hasFocus(): boolean;
  focus(): void;
  setTheme(dark: boolean): void;
  /** times the pane and the model disagreed and the pane was put right (should stay 0: the tests check) */
  resyncs(): number;
}

/** what a pane asks of the domain, by offset into the text (the editor core's providers, given an adapter) */
export interface TextServices {
  docFor(text: string): EditorDoc;
  completionAt(d: EditorDoc, offset: number): { from: number; items: Item[] };
  hoverAt(d: EditorDoc, offset: number): { from: number; to: number; parts: string[] } | null;
  definitionAt(d: EditorDoc, offset: number): { from: number; to: number } | { open: string } | null;
  rangeOfPath(d: EditorDoc, p: Path): [number, number] | undefined;
}

export interface PaneOpts { services: TextServices; onOpen?(file: string): void; onSave?(): void; onSaveAs?(): void }
