// The Monaco text pane: completion, hover, go to definition and problems from the editor core's providers (each
// pane's services: src/iso-editor/providers.ts given the domain's adapter). No language server: the same schema,
// reader and Document as the tests. This module is the Monaco adapter only.

// @ts-ignore Monaco's full editor entry, trimmed to the editor itself by the build (no d.ts for this path)
import * as monacoMain from 'monaco-editor/editor/editor.main.js';
// @ts-ignore registers the YAML grammar
import 'monaco-editor/languages/definitions/yaml/register.js';
import type { EditorModel } from '../model.ts';
import type { Problem } from '../validate.ts';
import type { Path } from '../path.ts';
import type { TextPane, TextSel, PaneOpts } from './pane.ts';

export type Monaco = typeof import('monaco-editor/editor/editor.api.js');
export const monaco = monacoMain as unknown as Monaco;
type IModel = import('monaco-editor/editor/editor.api.js').editor.ITextModel;
type Pos = import('monaco-editor/editor/editor.api.js').Position;
type Sel = import('monaco-editor/editor/editor.api.js').Selection;

// Monaco's editor thread (a Worker): a plain file beside the module that holds this code (the build says where:
// __SE_EDITOR_THREAD__), never a blob: URL. The pane turns off the features that need it (links, colour decorators,
// occurrence and unicode highlights, word-based suggestions), so it is normally never started; any thread made is
// ended at dispose.
declare const __SE_EDITOR_THREAD__: string | undefined;
const THREAD_URL = typeof __SE_EDITOR_THREAD__ === 'string' ? __SE_EDITOR_THREAD__ : 'editor.worker.js';
const threads = new Set<Worker>();
(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: () => { const w = new Worker(new URL(THREAD_URL, import.meta.url)); threads.add(w); return w; },
};
/** P3: in the portable build Monaco's styles come with the text feature: the pane links them (the file beside Monaco,
 *  by a static relative URL), once per page. The standalone page has them in its own stylesheet. */
declare const __SE_MONACO_CSS__: string | undefined;
function monacoStyles() {
  if (typeof __SE_MONACO_CSS__ !== 'string') return;
  const href = new URL(__SE_MONACO_CSS__, import.meta.url).href;
  if ([...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].some(l => l.href === href)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href; l.dataset.editor = 'monaco';
  document.head.append(l);
}
/** threads Monaco has made and not been given back (for the tests) */
export const liveThreads = () => threads.size;

export type MonacoPane = TextPane & { editor: import('monaco-editor/editor/editor.api.js').editor.IStandaloneCodeEditor; model: IModel; monaco: Monaco; setReadOnly(ro: boolean): void; dispose(): void };

// ---------- the providers: registered once for YAML, answering for the pane that owns the model ----------
interface Owner { doc: EditorModel; opts: PaneOpts }
const owners = new Map<IModel, Owner>();
let providers: { dispose(): void }[] = [];
const rangeIn = (m: IModel, a: number, b: number) => { const s = m.getPositionAt(a), e = m.getPositionAt(b); return new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column); };
function registerProviders() {
  if (providers.length) return;
  const K = monaco.languages.CompletionItemKind;
  providers = [monaco.languages.registerCompletionItemProvider('yaml', {
    triggerCharacters: [' ', ':', '-', '[', ',', '{'],
    provideCompletionItems(m: IModel, position: Pos) {
      if (!owners.has(m)) return { suggestions: [] };
      const s = owners.get(m)!.opts.services, c = s.completionAt(s.docFor(m.getValue()), m.getOffsetAt(position));
      const r = rangeIn(m, c.from, m.getOffsetAt(position));
      return {
        suggestions: c.items.map((it, i) => ({
          label: it.label,
          kind: it.kind === 'key' ? K.Property : it.kind === 'ref' ? K.Reference : it.kind === 'snippet' ? K.Snippet : K.EnumMember,
          insertText: it.insert,
          insertTextRules: it.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          detail: it.detail, documentation: it.doc ? { value: it.doc } : undefined,
          sortText: String(i).padStart(3, '0'), range: r,
        })),
      };
    },
  }), monaco.languages.registerHoverProvider('yaml', {
    provideHover(m: IModel, position: Pos) {
      const s = owners.get(m)?.opts.services, h = s ? s.hoverAt(s.docFor(m.getValue()), m.getOffsetAt(position)) : null;
      return h ? { range: rangeIn(m, h.from, h.to), contents: h.parts.map(value => ({ value })) } : null;
    },
  }), monaco.languages.registerDefinitionProvider('yaml', {
    provideDefinition(m: IModel, position: Pos) {
      const s = owners.get(m)?.opts.services, d = s ? s.definitionAt(s.docFor(m.getValue()), m.getOffsetAt(position)) : null;
      if (!d) return null;
      if ('open' in d) { owners.get(m)!.opts.onOpen?.(d.open); return null; }
      return [{ uri: m.uri, range: rangeIn(m, d.from, d.to) }];
    },
  })];
}

export function textPane(el: HTMLElement, doc: EditorModel, opts: PaneOpts): MonacoPane {
  monacoStyles();
  const editor = monaco.editor.create(el, {
    // v0.4.1: the file as it is (a pane added after mount)
    // two columns a level, never tabs (the default), whatever the file's own indentation (it is never detected)
    value: doc.text, language: 'yaml', automaticLayout: true, minimap: { enabled: false }, fontSize: 12.5, tabSize: 2, detectIndentation: false,
    scrollBeyondLastLine: false, renderWhitespace: 'none', fixedOverflowWidgets: true,
    // nothing that needs Monaco's thread: no link detection, colour decorators, occurrence or unicode highlights
    links: false, colorDecorators: false, occurrencesHighlight: 'off', selectionHighlight: false,
    unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false, nonBasicASCII: false },
    quickSuggestions: { other: true, comments: false, strings: true }, suggestOnTriggerCharacters: true, wordBasedSuggestions: 'off',
    suggest: { showWords: false, snippetsPreventQuickSuggestions: false }, hover: { delay: 250 },
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  });
  const model = editor.getModel()!;
  model.updateOptions({ tabSize: 2 });
  const range = rangeIn;
  owners.set(model, { doc, opts });
  registerProviders();

  // ---------- the binding: Monaco and the model, every edit crossing once ----------
  // Typing: Monaco has the change already; the model takes it (coalesced, tagged 'monaco') and doesn't send it back.
  // Everything else (tree, canvas, properties, undo, the other pane, a file): the model's steps go into Monaco with
  // applyEdits, muted, so they don't come back as typing, and don't land on Monaco's own undo stack (never used).
  const toSel = (ss: Sel[] | null): TextSel => (ss ?? []).map(s => ({ anchor: model.getOffsetAt(s.getSelectionStart()), head: model.getOffsetAt(s.getPosition()) }));
  const fromSel = (ts: TextSel) => ts.map(s => { const a = model.getPositionAt(s.anchor), h = model.getPositionAt(s.head); return new monaco.Selection(a.lineNumber, a.column, h.lineNumber, h.column); });
  let muted = false;
  let lastSel: TextSel = [];
  let resyncs = 0;
  const resync = () => {
    if (model.getValue() === doc.text) return;
    resyncs++;
    console.warn('editor: the Monaco pane and the model disagreed; the pane was put right');
    const sel = editor.getSelections();
    muted = true; model.setValue(doc.text); muted = false;
    if (sel) editor.setSelections(sel);
  };
  model.onDidChangeContent(e => {
    if (muted) return;
    if (e.isUndoing || e.isRedoing) {
      // Monaco's own undo (it shouldn't be reachable): put the text back, then undo the model's way
      muted = true; model.setValue(doc.text); muted = false;
      if (e.isUndoing) doc.undo(); else doc.redo();
      return;
    }
    const step = e.changes.map(c => ({ start: c.rangeOffset, end: c.rangeOffset + c.rangeLength, text: c.text }));
    const after = toSel(editor.getSelections());
    doc.typed(step, { before: lastSel, after }, 'monaco');
    lastSel = after;
    resync();
  });
  editor.onDidChangeCursorSelection(e => {
    if (muted) return;
    lastSel = toSel(editor.getSelections());
    if (editor.hasTextFocus()) doc.textSel = lastSel;
    // a jump (a click, the arrows, a search) ends the typing being coalesced
    if (e.reason === monaco.editor.CursorChangeReason.Explicit) doc.seal();
  });
  editor.onDidBlurEditorText(() => doc.seal());
  doc.on(c => {
    if (c.origin === 'text' && c.kind === 'do' && c.source === 'monaco') return;
    muted = true;
    try {
      if (c.kind === 'load') model.setValue(doc.text);
      else for (const step of c.steps) model.applyEdits([...step].sort((a, b) => a.start - b.start).map(x => ({ range: range(model, x.start, x.end), text: x.text })));
      if (Array.isArray(c.textSel) && (c.kind === 'undo' || c.kind === 'redo')) editor.setSelections(fromSel(c.textSel as TextSel));
      else if (c.kind !== 'load' && c.origin !== 'text' && c.steps[0]?.[0]) editor.revealLineInCenterIfOutsideViewport(model.getPositionAt(c.steps[0][0].start).lineNumber);
    } finally { muted = false; }
    lastSel = toSel(editor.getSelections());
    resync();
  });

  // ---------- the selection: shown here when another view chose it; the caret's path chosen when it moves here ----------
  let selDecos = editor.createDecorationsCollection([]);
  const showSelection = (paths: Path[], move: boolean) => {
    const ranges = paths.map(p => opts.services.rangeOfPath(doc.doc, p)).filter((r): r is [number, number] => !!r).map(([a, b]) => range(model, a, b));
    selDecos.clear();
    selDecos = editor.createDecorationsCollection(ranges.map(r => ({ range: r, options: { className: 'sel-range', isWholeLine: false, overviewRuler: { color: '#7f9cf580', position: monaco.editor.OverviewRulerLane.Center } } })));
    if (move && ranges[0] && !editor.hasTextFocus()) {
      muted = true;
      editor.setPosition({ lineNumber: ranges[0].startLineNumber, column: ranges[0].startColumn });
      muted = false;
      editor.revealRangeInCenterIfOutsideViewport(ranges[0]);
    }
  };
  doc.onSelect(c => { if (c.origin !== 'text' || !editor.hasTextFocus()) showSelection(c.paths, c.origin !== 'text'); else selDecos.clear(); });
  let caretTimer = 0;
  editor.onDidChangeCursorPosition(() => {
    if (muted || !editor.hasTextFocus()) return;
    clearTimeout(caretTimer);
    caretTimer = window.setTimeout(() => {
      const p = editor.getPosition();
      if (!p) return;
      const a = doc.doc.at(model.getOffsetAt(p));
      doc.select(a.path.length ? [a.path] : [], 'text');
    }, 120);
  });

  // one undo stack: ⌘Z / ⇧⌘Z / ⌘Y go to the model; ⌘S / ⇧⌘S to the page
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => doc.undo());
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ, () => doc.redo());
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => doc.redo());
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => opts.onSave?.());
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, () => opts.onSaveAs?.());

  return {
    id: 'monaco', el, editor, model, monaco, resyncs: () => resyncs, showSelection,
    hasFocus: () => editor.hasTextFocus(), focus: () => editor.focus(),
    goToOffset(off) { const p = model.getPositionAt(off); editor.setPosition(p); editor.revealPositionInCenter(p); editor.focus(); },
    caret() { const p = editor.getPosition(); return p ? { line: p.lineNumber, col: p.column } : undefined; },
    onCaret(fn) { editor.onDidChangeCursorPosition(fn); },
    setTheme: dark => monaco.editor.setTheme(paneTheme(dark, el)),
    setReadOnly: ro => editor.updateOptions({ readOnly: ro, readOnlyMessage: { value: 'Read-only' } }),
    dispose() {
      clearTimeout(caretTimer);
      owners.delete(model);
      editor.dispose();
      model.dispose();
      // the last pane gone: the providers and any thread go too
      if (!owners.size) { for (const p of providers) p.dispose(); providers = []; for (const w of threads) w.terminate(); threads.clear(); }
    },
    goTo(path) {
      showSelection([path], true);
      const r = opts.services.rangeOfPath(doc.doc, path);
      if (r) { const p = model.getPositionAt(r[0]); editor.setPosition(p); editor.revealPositionInCenter(p); }
      editor.focus();
    },
    setProblems(ps: Problem[]) {
      monaco.editor.setModelMarkers(model, 'problems', ps.map(p => ({
        severity: p.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
        message: p.message + (p.hint ? `\n${p.hint}` : ''),
        startLineNumber: p.startLine, startColumn: p.startCol, endLineNumber: p.endLine, endColumn: p.endCol,
        source: p.file ?? undefined,
      })));
    },
    pathAtCaret() {
      const p = editor.getPosition();
      return p ? doc.doc.at(model.getOffsetAt(p)).path : [];
    },
  };
}

/** Monaco themes made from the page's tokens (--surface, --ink…), as the page resolves them now (light or dark). */
export function paneTheme(dark: boolean, within: HTMLElement = document.body): string {
  // read inside the editor's root: its color-scheme decides which side of each light-dark() token applies
  const probe = document.createElement('div');
  probe.style.display = 'none';
  within.append(probe);
  const tok = (v: string, prop: 'color' | 'backgroundColor' = 'color') => { probe.style[prop] = `var(${v})`; const c = getComputedStyle(probe)[prop]; return hex(c); };
  const t = {
    bg: tok('--surface', 'backgroundColor'), ink: tok('--ink'), ink2: tok('--ink-2'), ink3: tok('--ink-3'), line: tok('--line', 'backgroundColor'),
    accent: tok('--accent'), tint: tok('--accent-tint', 'backgroundColor'), hover: tok('--surface-2', 'backgroundColor'),
  };
  probe.remove();
  const name = dark ? 'iso-dark' : 'iso-light';
  monaco.editor.defineTheme(name, {
    base: dark ? 'vs-dark' : 'vs', inherit: true, rules: [],
    colors: {
      'editor.background': t.bg, 'editor.foreground': t.ink, 'editorLineNumber.foreground': t.ink3, 'editorLineNumber.activeForeground': t.ink2,
      'editorCursor.foreground': t.accent, 'editor.selectionBackground': t.tint, 'editor.lineHighlightBackground': t.hover,
      'editorWidget.background': t.bg, 'editorWidget.border': t.line, 'editorSuggestWidget.background': t.bg, 'editorSuggestWidget.border': t.line,
      'editorSuggestWidget.selectedBackground': t.tint, 'editorHoverWidget.background': t.bg, 'editorHoverWidget.border': t.line, 'focusBorder': t.accent,
      'editorIndentGuide.background1': t.line,
      // the selected row of a list (suggestions, hover actions): the ink on the accent tint
      'editorSuggestWidget.selectedForeground': t.ink, 'editorSuggestWidget.foreground': t.ink, 'editorSuggestWidget.highlightForeground': t.accent,
      'editorSuggestWidget.focusHighlightForeground': t.accent, 'list.activeSelectionForeground': t.ink, 'list.activeSelectionBackground': t.tint,
      'list.focusForeground': t.ink, 'list.focusBackground': t.tint, 'list.hoverBackground': t.hover, 'quickInputList.focusForeground': t.ink,
      'list.activeSelectionIconForeground': t.ink2, 'editorSuggestWidget.selectedIconForeground': t.ink2,
    },
  });
  return name;
}
function hex(c: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  if (!m) return '#000000';
  return '#' + [m[1], m[2], m[3]].map(x => Number(x).toString(16).padStart(2, '0')).join('');
}
