// The domain adapter (docs/editor/LAYERS.md §4): everything the editor needs to know of a file format, so the model,
// the commands, the clipboard, completion, the outline, problems and the text pane's providers stay domain-free.
// A domain writes one; the editor's modules are given it.

import type { Path } from './path.ts';
import type { Diag } from '../iso-core/errors.ts';

/** what a file is to the domain: its main kind, a base that files extend, or something else */
export type FileRole = 'main' | 'base' | 'other';

/** one kind of thing a file holds, by name, in a map of its own (its section) */
export interface ObjectKindInfo {
  /** the kind's name (what references target) */
  kind: string;
  /** where its entries live: their map's path */
  section: Path;
  /** what one is called ("node"), and its group in the outline ("Nodes") */
  singular: string;
  group: string;
  /** what a new one starts as */
  template(): unknown;
}

/** a place in a file whose value names another thing */
export interface RefSlot {
  /** path segments; '*' is any name, '#' any list index */
  at: string[];
  /** the kinds a value here may name */
  targets: string[];
  /** words that are allowed here and aren't names */
  extra?: string[];
  /** the name inside a value, or undefined when the value names nothing */
  name?(value: string): string | undefined;
  /** the value with its name replaced */
  rename?(value: string, to: string): string;
  /** what the completion list shows for a name */
  write?(name: string): string;
  /** a value that is a path, not a name */
  pathOk?: boolean;
  /** the key itself is the reference */
  key?: boolean;
  what: string;
}
export interface Ref {
  /** the JSON pointer of the value (or of the key, for key slots) */
  path: string;
  slot: RefSlot;
  value: string;
  /** the name it refers to, if it refers to one */
  name?: string;
}

/** a thing at a pointer: its kind, its name and its own pointer */
export interface ObjectRef { kind: string; name: string; path: string }

/** (0.10.0) what a connection drawn on the canvas writes: a value added to a list (`at`), or, with `name` (a base for a
 *  fresh one), to a map */
export interface ConnectPlan { at: Path; value: unknown; name?: string; label?: string }
/** (0.10.0) the selection made into a new container: where it goes (`at`, a map), the base of its fresh name, its
 *  value, and, given the name it got, what changes in each member (each a set) */
export interface GroupPlan { at: Path; name: string; value: unknown; members(name: string): { path: Path; value: unknown }[]; label?: string }

/** what the domain's reader says of a text */
export interface ReadOutcome {
  diags: Diag[];
  /** each object's tag (the outline shows it), by name */
  tags?: Map<string, string>;
  /** the domain's own reading, for its views */
  read?: unknown;
}

/** what each part of the editor asks of an adapter (a domain may give a part only what it asks: smaller bundles) */
export type CommandsAdapter = Pick<DomainAdapter, 'kinds' | 'objectOf' | 'describe' | 'refs' | 'renameRef' | 'refDeletePath' | 'copyValue' | 'topOrder' | 'pins'>;
export type ClipboardAdapter = CommandsAdapter & Pick<DomainAdapter, 'entryGroups' | 'pasteDrops' | 'noun'>;
export type CompleteAdapter = Pick<DomainAdapter, 'snippets' | 'slotAt' | 'kinds' | 'extraDetail'>;
export type OutlineAdapter = Pick<DomainAdapter, 'outline' | 'kinds'>;
export type PlaceAdapter = Pick<DomainAdapter, 'objectOf' | 'keyMessage'>;
export type ReadAdapter = PlaceAdapter & Pick<DomainAdapter, 'read' | 'role'>;
export type ProvidersAdapter = CompleteAdapter & Pick<DomainAdapter, 'schema' | 'role' | 'refs'>;

export interface DomainAdapter {
  /** the format it reads ("boxes/1") */
  id: string;
  role(text: string): FileRole;
  /** the JSON Schema for a role (completion, hover, the properties panel); `text` (0.8.0) is the file's, for a format whose
   *  version line picks its schema (the same object for the same schema: the editor keeps one navigator per object) */
  schema(role: FileRole, text?: string): object;
  /** the problems in a text, from the domain's reader (with the files it extends, as the host resolved them) */
  read(text: string, o: { fileName: string; defaults?: { name: string; text: string }[]; profiles?: string[]; role: FileRole }): ReadOutcome;
  /** a reader's message that is about a key (placed on the key, not its value) */
  keyMessage: RegExp;

  /** the kinds, in the order the clipboard keeps them; names are unique across every kind */
  kinds: ObjectKindInfo[];
  /** what the domain calls an object, in words ("resource") */
  noun: string;
  /** the object a pointer is inside, if any */
  objectOf(ptr: string): ObjectRef | undefined;
  /** a path in words: "node web"; anything else its dotted path */
  describe(p: Path): string;
  /** named maps that aren't kinds (their names a pool of their own): copied, pasted and renamed like objects */
  entryGroups: Path[];

  /** every reference in the data, and the slot at a pointer */
  refs(data: unknown): Ref[];
  slotAt(ptr: string): RefSlot | undefined;
  /** a reference's new text when what it names is renamed to `to`; undefined: it stays as written */
  renameRef(ref: Ref, to: string): string | undefined;
  /** what deleting a reference (with the thing it names) removes: the reference, or the entry holding it */
  refDeletePath(p: Path): Path;
  /** a copy of an object's value (duplicate): what it can't keep (a flag only one may have) dropped */
  copyValue(kind: string, value: unknown): unknown;
  /** a paste into this data: keys a pasted object drops (the path), and why, in words */
  pasteDrops?(target: unknown, pasted: { kind: string; path: Path; value: unknown }): { path: Path; why: string } | undefined;
  /** what a completion list says of an extra word in a slot */
  extraDetail?(word: string, data: unknown): string | undefined;

  /** (0.10.0) a connection drawn from one object to another: what to add, or undefined (these two don't connect). None:
   *  the canvas offers no connect gesture */
  connect?(from: ObjectRef, to: ObjectRef, data: unknown): ConnectPlan | undefined;
  /** (0.10.0) the selected objects grouped into a new container, as one step; undefined: these can't be. None: the
   *  canvas offers no Group */
  group?(members: ObjectRef[], data: unknown): GroupPlan | undefined;

  /** (0.10.1) a new object of `kind` (its value as the palette made it) dropped onto `target`: its value put inside the
   *  target, and the words for it ("in subnet app"), or undefined (the target doesn't hold it). The canvas asks what is
   *  under the drop, innermost first; none: a drop is pinned where it lands */
  dropInto?(target: ObjectRef, value: unknown, kind: string, data: unknown): { value: unknown; label?: string } | undefined;

  /** the top-level key order: where a new section goes */
  topOrder: readonly string[];
  /** the layout pins: the key they live under, a legacy key read too, and whether a file has only the legacy one */
  pins: { key: string; legacyKey?: string; legacyOnly(data: unknown): boolean };
  /** new-entry snippets (Monaco syntax), by the pointer of the map they go in ('#…' tells several apart) */
  snippets: Record<string, { label: string; body: string; doc: string }>;
  /** the outline: the settings shown first, the setting groups after the kinds, and the root's label */
  outline: {
    /** the kinds' groups, in this order */
    kinds: readonly string[];
    first: readonly string[];
    /** the setting groups; `when` (0.8.0): whether a missing one is offered, by the file's data (a version's own keys) */
    groups: readonly { key: string; label: string; when?(data: Record<string, unknown>): boolean }[];
    rootLabel(data: Record<string, unknown>, role: FileRole): string;
    /** an object's tag from this file alone (when the reader's isn't known) */
    tag?(kind: string, name: string, value: unknown, data: Record<string, unknown>): string | undefined;
  };
}
