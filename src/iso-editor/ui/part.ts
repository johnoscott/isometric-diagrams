// An editor part: what a domain adds to the mounted editor beside its views (a host's state drawn over them, a
// simulator, what waits for a person). It is given what the editor has (PartCtx), and gives what is true now about an
// object (the properties panel's Now), rows before the problems (and how many, and whether they open the list), a
// start once the editor is up, a dispose, and its own calls. The editor carries none of a part's code.

import type { EditorModel } from '../model.ts';

/** what the editor gives a part */
export interface PartCtx {
  root: HTMLElement;
  /** one of the shell's elements, by its id (without the prefix) */
  byId<T extends HTMLElement = HTMLElement>(id: string): T;
  doc: EditorModel;
  store: { get(k: string): string | null; set(k: string, v: string | null): void };
  note(t: string, tone?: 'info' | 'warn' | 'bad'): void;
  /** the editor shows the file for this mount only (nothing it shows is kept) */
  watch: boolean;
  /** a listener, removed when the editor is disposed */
  on(t: EventTarget, ev: string, fn: (e: never) => void): void;
  disposed(): boolean;
  paintProblems(): void;
  paintProps(): void;
}

/** what waits for a person: rows put before the file's problems */
export interface Attention {
  /** how many (they count as problems seen) */
  count: number;
  /** how many open the list when they appear */
  opens: number;
  /** the list keeps still (neither opens nor closes for these) */
  still: boolean;
  rows: Node[];
  /** their words in the list's label */
  label: string;
}

/** what a part gives the editor; A: its calls */
export interface EditorPart<A extends object> {
  now?(ptr: string): unknown;
  attention?(): Attention | undefined;
  start?(): void;
  dispose?(): void;
  api: A;
}
