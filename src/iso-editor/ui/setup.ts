// An editor set up from a domain adapter alone (R1 S8): the kits every view takes (the tree's, the panel's, the
// canvas's, the mount's), made from the adapter with plain words, and the three views' features (text, canvas, edit).
// A domain gives its adapter, how a reading is drawn, its catalogue and theme; anything it says more (its words, its
// icons, a layer over the canvas, a part beside the views) replaces the plain default. A domain with its own words for
// every view sets its kits up by hand instead; this is for a domain that wants the editor as it comes.
//
// The text pane is given, not imported: Monaco is a big dependency, and a host without it still gets the canvas, the
// tree and the panel.

import { paletteLooks } from './palette-look.ts';
import type { DomainAdapter, FileRole, ObjectRef } from '../adapter.ts';
import type { Path } from '../path.ts';
import { toPointer } from '../path.ts';
import { outline } from '../outline.ts';
import { commandsFor } from '../commands.ts';
import { clipboardFor } from '../clipboard.ts';
import { providersFor, docFor, rangeOfPath } from '../providers.ts';
import { analyse } from '../validate.ts';
import type { KindCatalog } from '../../iso-objects/kinds.ts';
import { actionsFor } from './actions.ts';
import { clipboard } from './clip.ts';
import { propsPanel, type PropsKit } from './props.ts';
import type { TreeKit } from './tree.ts';
import { canvasView, type CanvasKit, type CanvasDrawing, type CanvasUi } from './canvas.ts';
import type { CanvasCtx, CanvasLayer } from './canvas-layer.ts';
import type { MountKit } from './mount-kit.ts';
import type { EditorSetup, ShellWords, ShellFeatures } from './mount.ts';
import type { PaneOpts, TextServices } from './pane.ts';
import type { MonacoPane } from './text.ts';
import type { IconName } from './icons.ts';
import { PLAIN_ICON_SVG, iconSymbols, spriteOf } from './plain-icons.ts';
import type { KeyGroup } from './keys.ts';
import type { EditorModel } from '../model.ts';
import type { PartCtx, EditorPart } from './part.ts';

type Raw = Record<string, unknown>;

/** what a domain gives besides its adapter */
export interface DomainView<R, D extends CanvasDrawing> {
  /** a reading, drawn (the adapter's read() gives the reading) */
  draw(read: R, data: unknown, theme: string): D;
  catalog: KindCatalog;
  theme: string;
  /** the file's name when the host gives none */
  fileName: string;
  /** what a name must be, and the rule in words */
  nameRule?: RegExp; nameHint?: string;
  /** a kind's icon (default: box) */
  icon?(kind: string): IconName;
  /** the domain's own icons, as 24 × 24 SVG bodies by name (stroke in currentColor, as Lucide's), added to L3's */
  icons?: Record<string, string>;
  words?: Partial<ShellWords>;
  keymap?: KeyGroup[];
  /** (0.10.0) the palette's entries: presets of a kind, each with its label, icon, what a new one starts as (a copy of
   *  `value`; default: the kind's template) and the base of its fresh name. None: one entry per kind, as before */
  palette?: { kind: string; label: string; icon?: string; value?: unknown; name?: string; section?: string }[];
  /** (0.12.0) the palette 'floating' over the canvas (the default) or 'docked': a pane of its own at the canvas's left,
   *  searchable by label and section, resizable and collapsible */
  paletteLayout?: 'floating' | 'docked';
  /** (0.12.5) what a double click on an object of the canvas does: shows it in the text (the default), or renames it */
  doubleClick?: 'text' | 'rename';
  /** (0.14.0) the palette's entries with their icon (the default), or with the thing itself, drawn small in the current theme */
  paletteLook?: 'icon' | 'object';
  /** (0.14.0) what is in a drag's way jiggles before it gives way, and glides: 'always' (the default), or 'respect': not where
   *  the viewer prefers reduced motion */
  dragMotion?: 'always' | 'respect';
  /** the canvas's 2D view (0.6.0): a 3D | 2D switch; its link kinds' styles (the host's canvas CSS adds flatCss) */
  flat?: CanvasKit<R, D>['flat'];
  /** a layer over the canvas, and a part beside the views (A: their calls) */
  layer?(ctx: CanvasCtx<D>): CanvasLayer<object>;
  part?(ctx: PartCtx): EditorPart<object>;
}

const NAME = /^[a-z][a-z0-9-]*$/;
/** the plain shell's words */
export const PLAIN_WORDS: ShellWords = {
  rootClass: 'iso-editor', brand: 'iso <b>editor</b>', sideLabel: 'The file', canvasLabel: 'The file, drawn',
  problemsLabel: 'Problems', bottomTabsLabel: 'Problems', extraTab: 'Check', slots: '',
};
/** the plain keymap: the shell's own keys */
export const PLAIN_KEYMAP: KeyGroup[] = [
  { where: 'Anywhere in the editor', keys: [['⌘S', 'Save'], ['⌘Z', 'Undo'], ['⇧⌘Z or ⌘Y', 'Redo'], ['?', 'This sheet'], ['Esc', 'Close a menu or dialog']] },
  { where: 'The tree and the canvas', keys: [['F2', 'Rename'], ['⌫', 'Delete'], ['⌘D', 'Duplicate'], ['⌘↑', 'Select the parent']] },
  { where: 'The canvas', keys: [['+ −', 'Zoom'], ['0', 'Fit'], ['1', '100%'], ['⇧2', 'Zoom to the selection']] },
];

/** The kits and features for an adapter (R: its reading; D: its drawing), with the text pane if the host has one. */
export function setupFor<R, D extends CanvasDrawing>(a: DomainAdapter, v: DomainView<R, D>, textPane?: (el: HTMLElement, doc: EditorModel, o: PaneOpts) => MonacoPane): EditorSetup<R, undefined, object> {
  const commands = commandsFor(a);
  const nameRule = v.nameRule ?? NAME, nameHint = v.nameHint ?? 'a lower-case letter, then lower-case letters, digits and -';
  const icon = v.icon ?? (() => 'box' as IconName);
  const actions = actionsFor({ commands, objectOf: a.objectOf, kinds: a.kinds, nameRule, nameHint });
  const P = providersFor(a);
  const services: TextServices = { docFor, completionAt: P.completionAt, hoverAt: P.hoverAt, definitionAt: P.definitionAt, rangeOfPath };
  const getIn = (o: unknown, p: Path) => p.reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Raw)[k as string] : undefined), o);
  const layoutUnder = (data: unknown, key: string) => getIn(data, [key, 'layout']) as Raw | undefined;
  const pins = {
    key: a.pins.key, legacyKey: a.pins.legacyKey, legacyOnly: a.pins.legacyOnly,
    of: (data: unknown) => layoutUnder(data, a.pins.key) ?? (a.pins.legacyKey ? layoutUnder(data, a.pins.legacyKey) : undefined),
    keyOf: (data: unknown) => (a.pins.legacyOnly(data) && a.pins.legacyKey ? a.pins.legacyKey : a.pins.key),
  };
  const read = (text: string, fileName = v.fileName) => a.read(text, { fileName, role: a.role(text) });

  const tree: TreeKit = {
    outline: (d, role, tags) => outline(d, a, role, tags), commands, slotAt: a.slotAt, kinds: a.kinds, entryGroups: a.entryGroups, nameRule,
    ui: {
      label: 'The file, as a tree', rootIcon: 'layers', kindIcon: icon, keyIcon: () => undefined, entryIcon: () => 'list-tree' as IconName,
      newItems: k => { const x = a.kinds.find(y => y.kind === k)!; return [{ label: `New ${x.singular}`, icon: icon(k) }]; },
      tagPill: tag => ({ title: tag }), nameHint,
      text: { root: 'File', rootAdd: 'the file', renameWhy: 'Groups and the file itself have fixed names', deleteWhy: 'The file itself stays', duplicateNote: 'Duplicate works on objects', duplicateWhy: 'Only objects can be duplicated' },
    },
  };
  const props: PropsKit = {
    commands, actions, slotAt: a.slotAt, objectOf: a.objectOf, kinds: a.kinds,
    ui: { important: () => [], isExternal: () => false, inheritedFrom: 'the base file', extensionDoc: 'An extension: ignored by the reader.', rootTitle: 'The file', rootItem: '(the file)' },
  };
  const canvasUi: CanvasUi = {
    rootClass: 'iso-canvas', panKeyClass: 'pan-key', newOrder: a.kinds.map(k => k.kind),
    palette: v.palette
      ? v.palette.map(e => ({ kind: e.kind, label: e.label, icon: (e.icon ?? icon(e.kind)) as IconName, name: e.name, ...(e.section === undefined ? {} : { section: e.section }), ...(e.value === undefined ? {} : { value: () => structuredClone(e.value) }) }))
      : a.kinds.map(k => ({ kind: k.kind, icon: icon(k.kind), label: k.singular[0].toUpperCase() + k.singular.slice(1) })),
    ...(v.paletteLayout === undefined ? {} : { paletteLayout: v.paletteLayout }),
    ...(v.doubleClick === undefined ? {} : { doubleClick: v.doubleClick }),
    ...(v.dragMotion === undefined ? {} : { dragMotion: v.dragMotion }),
    text: {
      stage: 'The file, drawn: arrow keys and Tab move through what is drawn; + and − zoom, 0 fits', dragGroup: 'A drag on nothing',
      dragSelectTip: 'Drag draws a selection; hold the space key to pan', unreadable: 'The canvas draws a file that reads cleanly; fix the problems listed to see it.',
      palette: 'Add to the file: click, or drag onto the canvas', cantMove: "This can't be moved: the layout places it", pinHint: '', renameWhy: 'Only objects are renamed here', duplicateWhy: 'Only objects are duplicated',
    },
  };
  const canvas: CanvasKit<R, D> = {
    draw: v.draw, catalog: v.catalog, objectOf: a.objectOf, kinds: a.kinds, commands, actions, objectItems: () => [], pins, ui: canvasUi, flat: v.flat,
    ...(a.connect ? { connect: (f: ObjectRef, t: ObjectRef, d: unknown) => a.connect!(f, t, d) } : {}),
    ...(a.group ? { group: (m: ObjectRef[], d: unknown) => a.group!(m, d) } : {}),
    ...(a.dropInto ? { dropOnto: (t: ObjectRef, v: unknown, k: string, d: unknown) => a.dropInto!(t, v, k, d) } : {}),
    trial: (text, theme) => { const r = read(text); return r.read === undefined || r.diags.some(d => d.severity === 'error') ? undefined : v.draw(r.read as R, (r.read as { data?: unknown }).data, theme); },
  };
  if (v.paletteLook === 'object') canvas.looks = paletteLooks(canvas);
  const kit: MountKit<R, undefined> = {
    async check(text) {
      const r = analyse(a, text, { fileName: v.fileName });
      const ok = !r.problems.some(p => p.severity === 'error') && r.read !== undefined;
      return { problems: r.problems, read: r.read as R | undefined, tags: r.tags, model: ok ? r.read : undefined, data: (r.read as { data?: unknown } | undefined)?.data, extra: undefined };
    },
    role: (text): FileRole => a.role(text),
    kindLabel: () => a.id,
    nav: P.navFor,
    objectPath(name, r) {
      const data = (r as { data?: unknown } | undefined)?.data;
      for (const k of a.kinds) if (getIn(data, [...k.section, name]) !== undefined) return toPointer([...k.section, name]);
      return undefined;
    },
    extraLabel: () => ({ text: '', cls: '' }),
    // (0.10.0) the plain keymap says ⌘G where the domain groups
    keymap: v.keymap ?? (a.group ? PLAIN_KEYMAP.map(g => (g.where === 'The tree and the canvas' ? { ...g, keys: [...g.keys, ['⌘G', 'Group the selection'] as [string, string]] } : g)) : PLAIN_KEYMAP),
  };
  const features: ShellFeatures & Record<string, unknown> = {
    canvas: { canvasView: (host: HTMLElement, doc: EditorModel, o: never) => canvasView<R, D, object>(host, doc, { ...(o as object), theme: v.theme, kit: canvas, layer: v.layer } as never) },
    edit: { propsPanel: (body: HTMLElement, doc: EditorModel, o: never) => propsPanel(body, doc, { ...(o as object), kit: props } as never), clipboard: (doc: EditorModel, note: (t: string, tone?: 'info' | 'warn' | 'bad') => void) => clipboard(doc, note, clipboardFor(a)) },
    ...(textPane ? { text: { textPane: (el: HTMLElement, doc: EditorModel, o: Omit<PaneOpts, 'services'>) => textPane(el, doc, { ...o, services }) } } : {}),
  };
  return {
    kit, tree, words: { ...PLAIN_WORDS, ...v.words }, features,
    names: ['text', 'canvas', 'edit'], late: ['text'], hasExtra: false,
    part: v.part ? ctx => v.part!(ctx) as EditorPart<object> : undefined,
    sprite: spriteOf(iconSymbols({ ...PLAIN_ICON_SVG, ...v.icons })),
  };
}
