// What the mounted editor is given of its domain (beside the views' own kits): how a text is checked (the reader's
// problems, or a host's deeper check, and what the canvas draws), what role a file has and what its kind is called,
// the schema's navigation, where an object is by its name, the words of the host's check beside Problems, and the
// keys. (The drawing's theme is the canvas feature's: an editor without a canvas carries none.) Types only: the domain's module gives the values.

import type { Problem } from '../validate.ts';
import type { SchemaNav } from '../schema-nav.ts';
import type { FileRole } from '../adapter.ts';
import type { KeyGroup } from './keys.ts';

/** a text, checked (R: the domain's reading; X: a host's deeper check, shown beside Problems) */
export interface Checked<R, X> {
  problems: Problem[];
  read: R | undefined;
  /** each object's tag (the tree's pills) */
  tags: Map<string, string>;
  /** what the canvas draws (undefined: nothing), and the data it is drawn from */
  model: unknown;
  data: unknown;
  extra: X | undefined;
}

export interface MountKit<R, X> {
  /** check a text (prev: the last check's extra); a failure of the host's check is a note, not a throw */
  check(text: string, prev: X | undefined, note: (t: string, tone?: 'info' | 'warn' | 'bad') => void): Promise<Checked<R, X>>;
  role(text: string): FileRole;
  /** the status bar's word for the file's kind */
  kindLabel(text: string): string;
  nav(text: string): SchemaNav;
  /** an object's pointer, by its name, in the reading */
  objectPath(name: string, read: R | undefined): string | undefined;
  /** the host's check beside Problems, in a word (none: '' and '') */
  extraLabel(extra: X | undefined): { text: string; cls: string };
  keymap: KeyGroup[];
}
