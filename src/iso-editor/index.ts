// iso-editor (L3): the text-is-truth editor's core (docs/editor/LAYERS.md §2, §4): the document and its paths, one
// undo stack of text splices, the commands, the clipboard, completion, the outline, problems and the text panes'
// providers, all driven by a domain adapter (adapter.ts); and the views' pieces (ui/): the layer menus and dialogs
// open in, menus, dialogs, icons, the keyboard sheet. (ui/monaco-entry.ts is the text pane's Monaco bundle: a build
// entry of its own, not part of this API.)
//
// The layer's public API. Importers name the module a name comes from (with code splitting, a barrel puts every file
// it reaches into each bundle that imports it); the Node tests may import this index.

export type { FileRole, ObjectKindInfo, RefSlot, Ref, ObjectRef, ReadOutcome, DomainAdapter, ConnectPlan, GroupPlan } from './adapter.ts';
export { toPointer, fromPointer, parentOf, isPrefix, samePath } from './path.ts';
export type { Seg, Path } from './path.ts';
export { EditorDoc, completionContext } from './doc.ts';
export type { Where, At, CompletionContext } from './doc.ts';
export { HISTORY_DEPTH, EditorModel } from './model.ts';
export { readPins } from './pins.ts';
export type { Origin, Command, Change, SelectionChange, StepMeta, HistoryEntry, ApplyOptions } from './model.ts';
export { revisionLog, restoreLog, textHash, type LoggedStep, type RevisionLog, type RestoreOptions } from './history-log.ts';
export { SpliceError, applyStep, invertStep, scalarText, flowText, setValue, insertKey, deleteAt, insertItem, renameKey, moveKey, insertRawPair, pairText } from './splice.ts';
export type { TextEdit, Step, Splice } from './splice.ts';
export { SchemaNav } from './schema-nav.ts';
export type { KeyInfo } from './schema-nav.ts';
export { PREF, VIEWS } from './storage-keys.ts';
export { chain, seqCmd, commandsFor } from './commands.ts';
export type { Commands } from './commands.ts';
export { clipboardFor } from './clipboard.ts';
export type { PastePlan, Clipboard } from './clipboard.ts';
export { namesIn, complete } from './complete.ts';
export type { Item, Completion } from './complete.ts';
export { outline, flatten } from './outline.ts';
export type { NodeKind, OutlineNode } from './outline.ts';
export { analyse, place } from './validate.ts';
export type { Problem, ValidateOpts } from './validate.ts';
export { docFor, providersFor, rangeOfPath, problemRange, cmSnippet, mdRuns } from './providers.ts';
export type { Providers } from './providers.ts';
export { setLayer, layer } from './ui/layer.ts';
export { icon } from './ui/icons.ts';
export type { IconName } from './ui/icons.ts';
export { ask } from './ui/dialog.ts';
export type { DialogButton } from './ui/dialog.ts';
export { menuOpen, openMenu, closeMenu } from './ui/menu.ts';
export type { MenuItem } from './ui/menu.ts';
export { TYPING_PAUSE_MS, isTyping, later } from './ui/later.ts';
export { keymapWith, keySheet } from './ui/keys.ts';
export type { KeyGroup } from './ui/keys.ts';
export type { TextSel, TextPane, TextServices, PaneOpts } from './ui/pane.ts';
export { clipboard } from './ui/clip.ts';
export type { Clip } from './ui/clip.ts';
export { treeView } from './ui/tree.ts';
export type { NewItem, EntryItem, TreeUi, TreeKit, TreeOpts } from './ui/tree.ts';
export { run, composite, actionsFor } from './ui/actions.ts';
export type { ActionsKit, Actions } from './ui/actions.ts';
export { propsPanel } from './ui/props.ts';
export type { PropsUi, PropsKit, PropsOpts } from './ui/props.ts';
export type { Box as CanvasBox, Outline, CanvasCtx, CanvasLayer } from './ui/canvas-layer.ts';
export { canvasView } from './ui/canvas.ts';
export type { CanvasDrawing, DropInto, CanvasUi, CanvasKit, CanvasOpts, FlatCanvas, FlatDrawn, PaletteItem } from './ui/canvas.ts';
// the canvas's 2D view (0.6.4): a host hands it to the canvas (DomainView.flat.load); the canvas never imports it
export { flatCanvas } from './ui/flat-canvas.ts';
export type { PartCtx, Attention, EditorPart } from './ui/part.ts';
export type { Checked, MountKit } from './ui/mount-kit.ts';
export { mountEditor } from './ui/mount.ts';
export type { Theme, SaveResult, HostHooks, EditorOptions, ShellWords, ShellFeatures, ShellCanvas, EditorSetup, EditorState, Editor, EditorBusy, EditorCanvas, DrawnBox } from './ui/mount.ts';
export { PROTOCOL, isMessage } from './window/protocol.ts';
export type { Refused, Capabilities, BaseToHost, BaseToWindow } from './window/protocol.ts';
export { setupFor, PLAIN_WORDS, PLAIN_KEYMAP } from './ui/setup.ts';
export type { DomainView } from './ui/setup.ts';
export { scopeCss, scopeOne } from './ui/scope-css.ts';
export { PLAIN_ICON_SVG, PLAIN_ICONS, PLAIN_SPRITE, iconSymbols, spriteOf } from './ui/plain-icons.ts';
