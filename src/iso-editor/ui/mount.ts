// The editor as a component: mountEditor(el, options, setup) puts the whole editor (the text, the tree, the canvas,
// the properties, the problems, the menus) inside `el` and returns a handle. It does no I/O of its own:
//   - the text comes in as options.text (and setText); saving goes out through options.onSave(text);
//   - problems, and a host's deeper check shown beside them, come from the kit's check(text) (setup.kit);
//   - preferences (panel sizes, the view) are kept only if options.storage is given.
// Everything it makes lives under one root element inside `el` (its class the setup's words name): its styles are
// scoped to that class, menus and dialogs open inside it, and keys are bound on it (none while the focus is elsewhere).
// dispose() removes the root, its listeners, timers, Monaco's editor and model, and any Worker it started. The domain gives the
// rest (EditorSetup): the kits, the shell's words, the features, its canvas options and its part.

import { problemRange } from '../providers.ts';
import { later, isTyping } from './later.ts';
import type { MonacoPane } from './text.ts';
import type { PaneOpts } from './pane.ts';
import type { Clip } from './clip.ts';
import { treeView, type TreeKit } from './tree.ts';
import { keySheet, keymapWith, type KeyGroup } from './keys.ts';
import { closeMenu } from './menu.ts';
import { setLayer } from './layer.ts';
import type { Path } from '../path.ts';
import { fromPointer, toPointer } from '../path.ts';
import { h } from './icons.ts';
import { EditorModel } from '../model.ts';
import type { Problem } from '../validate.ts';
import type { MountKit } from './mount-kit.ts';
import type { PartCtx, EditorPart } from './part.ts';
import { PREF } from '../storage-keys.ts';

export type Theme = 'light' | 'dark' | 'system';
export type SaveResult = { ok: true } | { conflict: true };
/** what a host adds to the shell */
export interface HostHooks {
  titleStart?: HTMLElement[];
  sideTabs?: { id: string; label: string; icon: string; panel: HTMLElement }[];
  keys?(e: KeyboardEvent): boolean;
  keymap?: [string, string][];
  themeControls?: boolean;
  onOpen?(rel: string): void;
  onSaveAs?(): void;
  onConflict?(): void;
  /** the setup's brand mark in the title bar */
  brand?: boolean;
}
export interface EditorOptions {
  text?: string;
  readOnly?: boolean;
  theme?: Theme;
  storage?: { get(k: string): string | null; set(k: string, v: string | null): void };
  watch?: boolean;
  onSave?(text: string): Promise<SaveResult>;
  onDirtyChange?(dirty: boolean): void;
  host?: HostHooks;
}
/** the shell's words (markup is the setup's constant, never the file's) */
export interface ShellWords {
  rootClass: string;
  /** the brand mark's markup */
  brand: string;
  sideLabel: string; canvasLabel: string; problemsLabel: string; bottomTabsLabel: string; extraTab: string;
  /** more panels' slots under the work area (markup) */
  slots: string;
}
/** the views' features, as the shell uses them (a feature not given is never loaded) */
export interface ShellFeatures {
  text?: { textPane(el: HTMLElement, doc: EditorModel, o: Omit<PaneOpts, 'services'>): MonacoPane };
  canvas?: { canvasView(host: HTMLElement, doc: EditorModel, o: never): ShellCanvas };
  edit?: { propsPanel(body: HTMLElement, doc: EditorModel, o: never): { paint(): void; dispose(): void }; clipboard(doc: EditorModel, note: (t: string, tone?: 'info' | 'warn' | 'bad') => void): Clip };
  /** the host's deeper check, as a panel beside Problems */
  plan?: { planPanel(el: HTMLElement, o: { has(name: string): boolean; select(name: string): boolean }): { paint(extra: unknown, has: boolean): void } };
}
/** what the shell calls on a canvas */
export interface ShellCanvas { render(model: unknown, data: unknown): Promise<void>; setTheme(t: 'light' | 'dark'): void; fit(): void; focus(): void; dispose(): void }
/** what the domain gives the mounted editor */
export interface EditorSetup<R, X, A extends object> {
  kit: MountKit<R, X>;
  tree: TreeKit;
  words: ShellWords;
  features: ShellFeatures & Record<string, unknown>;
  /** every feature's name, and those that can be added to a mounted editor */
  names: readonly string[];
  late: readonly string[];
  load?: (names: readonly string[]) => Promise<{ name: string }[]>;
  /** the host's deeper check is given (its panel paints "none" otherwise) */
  hasExtra: boolean;
  /** the domain's own canvas options (its layer's), given its part's calls */
  canvasOpts?(part: () => A): Record<string, unknown>;
  part?(ctx: PartCtx, deps: { canvas: () => ShellCanvas; objectPath(name: string): string | undefined }): EditorPart<A>;
  /** what an absent canvas answers, beyond nothing */
  noCanvas?: Record<string, unknown>;
  /** more of the internal handle */
  internal?: Record<string, unknown>;
  /** the icons the views use (<svg> markup of <symbol id="se-i-NAME">s; the build makes it from the domain's icon names) */
  sprite?: string;
}

const shellHtml = (W: ShellWords) => `
<header class="titlebar">
  <button id="se-tree" class="btn sm quiet icon-only" type="button" aria-expanded="false" aria-controls="se-side" aria-label="Show the outline" title="The outline"><svg class="icon" aria-hidden="true"><use href="#se-i-list-tree"></use></svg></button>
  <span class="brand" data-se="brand" hidden>${W.brand}</span>
  <span data-se="title-start" class="title-start"></span>
  <span class="pill ro" id="se-ro" hidden>Read-only</span>
  <button id="se-save" class="btn sm primary" type="button" disabled title="Save (⌘S)">Save</button>
  <div class="btn-group" role="group" aria-label="History">
    <button id="se-undo" class="btn sm" type="button" disabled title="Nothing to undo"><svg class="icon" aria-hidden="true"><use href="#se-i-rotate-ccw"></use></svg>Undo</button>
    <button id="se-redo" class="btn sm" type="button" disabled title="Nothing to redo"><svg class="icon flip" aria-hidden="true"><use href="#se-i-rotate-ccw"></use></svg>Redo</button>
  </div>
  <span class="spacer"></span>
  <div id="se-views" class="segmented" role="group" aria-label="Show">
    <button class="seg" type="button" data-v="canvas">Canvas</button>
    <button class="seg" type="button" data-v="both">Both</button>
    <button class="seg" type="button" data-v="text">Text</button>
  </div>
  <div id="se-theme" class="segmented" role="group" aria-label="Theme" hidden>
    <button class="seg" type="button" data-v="system">System</button>
    <button class="seg" type="button" data-v="light">Light</button>
    <button class="seg" type="button" data-v="dark">Dark</button>
  </div>
  <button id="se-density" class="btn sm quiet" type="button" aria-pressed="false" title="Compact density" hidden>Compact</button>
  <button id="se-keys" class="btn sm quiet" type="button" title="Keyboard (?)" aria-haspopup="dialog">Keys</button>
  <button id="se-panel" class="btn sm quiet icon-only" type="button" aria-pressed="true" aria-label="Show the properties panel" title="The properties panel"><svg class="icon" aria-hidden="true"><use href="#se-i-panel-right"></use></svg></button>
</header>
<div class="body">
  <div id="se-scrim" class="scrim" hidden></div>
  <nav class="side" id="se-side" aria-label="${W.sideLabel}">
    <div class="side-tabs segmented" role="tablist" aria-label="Sidebar" hidden>
      <button class="seg" type="button" role="tab" id="se-tab-outline" aria-controls="se-outline" aria-selected="true"><svg class="icon" aria-hidden="true"><use href="#se-i-list-tree"></use></svg>Outline</button>
    </div>
    <div id="se-outline" role="tabpanel" aria-labelledby="se-tab-outline"></div>
  </nav>
  <div id="se-side-grip" class="vgrip" role="separator" aria-orientation="vertical" aria-label="Resize the sidebar" tabindex="0"></div>
  <main class="center">
    <div id="se-filebar" class="callout warn banner filebar" role="alert" hidden><svg class="icon" aria-hidden="true"><use href="#se-i-triangle-alert"></use></svg><div class="c-body"></div><div class="c-acts"></div></div>
    <div class="work">
      <div id="se-canvas" aria-label="${W.canvasLabel}"></div>
      <div id="se-work-grip" class="vgrip" role="separator" aria-orientation="vertical" aria-label="Resize the canvas and the text" tabindex="0"></div>
      <div id="se-code" aria-label="The file, as text"></div>
    </div>
${W.slots}    <div id="se-grip" role="separator" aria-orientation="horizontal" aria-label="Resize the problems list" tabindex="0"></div>
    <section id="se-problems" aria-label="${W.problemsLabel}">
      <div id="se-problems-head" class="problems-head">
        <button id="se-problems-toggle" type="button" class="problems-toggle" aria-expanded="false" aria-controls="se-problems-list"><svg class="icon" aria-hidden="true"><use href="#se-i-chevron-right"></use></svg><span id="se-problems-label">No problems</span></button>
        <span class="spacer"></span>
        <span id="se-plan-label" class="plan-label"></span>
        <div class="segmented bottom-tabs" role="tablist" aria-label="${W.bottomTabsLabel}">
          <button class="seg" type="button" role="tab" id="se-tab-problems" aria-selected="true" aria-controls="se-problems-list">Problems</button>
          <button class="seg" type="button" role="tab" id="se-tab-plan" aria-selected="false" aria-controls="se-plan">${W.extraTab}</button>
        </div>
      </div>
      <div id="se-problems-list" role="tabpanel" aria-labelledby="se-tab-problems"></div>
      <div id="se-plan" class="plan" role="tabpanel" aria-labelledby="se-tab-plan" hidden></div>
    </section>
    <div id="se-note" class="callout compact" role="status" hidden><span class="c-body"></span></div>
  </main>
  <div id="se-right-grip" class="vgrip" role="separator" aria-orientation="vertical" aria-label="Resize the selection panel" tabindex="0"></div>
  <aside id="se-right" class="right" aria-label="Properties">
    <div class="side-head">Properties</div>
    <div id="se-sel-body" class="sel-body"></div>
  </aside>
</div>
<footer class="status">
  <span id="se-st-problems" class="ok">0 ✕  0 ⚠</span>
  <span id="se-st-path" class="path"></span>
  <span class="spacer"></span>
  <span id="se-st-sel"></span>
  <span id="se-st-hint" class="hint-mode" title="The canvas's navigation: change it in the canvas's toolbar"></span>
  <span id="se-st-zoom" title="The canvas's zoom"></span>
  <span id="se-st-pos"></span>
  <span id="se-st-kind"></span>
  <span id="se-announce" class="sr-only" aria-live="polite"></span>
</footer>`;

/** The editor's state, for the standalone page and the tests (not part of the component's API). */
export interface EditorState<R = unknown, X = unknown> {
  problems: Problem[];
  lifetimes: Map<string, string>;
  read: R | undefined;
  plan: X | undefined;
  view: 'canvas' | 'both' | 'text';
  theme: Theme;
  density: 'comfortable' | 'compact';
  readOnly: boolean;
  problemsOpen: boolean;
  problemsSeen: number;
  checks: number;
}
export interface Editor {
  getText(): string; setText(text: string): void; setReadOnly(ro: boolean): void; setTheme(t: Theme): void;
  addFeatures(names: readonly string[]): Promise<void>; fit(): void; dispose(): void;
}

/** P3: the editor with the features given (the core alone: the shell, the model, the reader and the tree; read-only
 *  unless edit is given). */
export function mountEditor<R, X, A extends object = object>(el: HTMLElement, opts: EditorOptions, S: EditorSetup<R, X, A>): Editor & { internal: Record<string, unknown> } {
  // v0.4.1: features can be added after mount (addFeatures): F grows, never shrinks
  const F = S.features;
  const K = S.kit, W = S.words, load = S.load;
  // v0.4.1: watch: the canvas and Live, for this mount only (storage is read for the rest, but view and live aren't written)
  const watch = !!opts.watch;
  const hooks = opts.host ?? {};
  const store = {
    get: (k: string) => { try { return opts.storage?.get(k) ?? null; } catch { return null; } },
    set: (k: string, v: string | null) => { try { opts.storage?.set(k, v); } catch { /* not kept */ } },
  };
  // ---------- the root: everything the editor makes is inside it ----------
  const root = h('div', { class: W.rootClass, 'data-view': 'both' });
  const sprite = document.createElement('template');
  sprite.innerHTML = S.sprite ?? '';                              // the setup's icon sprite: constant, no file data
  const shell = document.createElement('template');
  shell.innerHTML = shellHtml(W);                                 // constant markup; every value goes in as text later
  root.append(sprite.content, shell.content);
  el.append(root);
  setLayer(root);
  const $ = <T extends HTMLElement>(id: string) => root.querySelector(`#se-${id}`) as T;
  const cleanups: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(t: HTMLElement | Window | MediaQueryList, ev: K | 'change', fn: (e: never) => void, o?: AddEventListenerOptions) => {
    t.addEventListener(ev, fn as EventListener, o);
    cleanups.push(() => t.removeEventListener(ev, fn as EventListener, o));
  };
  on(root, 'focusin', () => setLayer(root));
  on(root, 'pointerdown', () => setLayer(root));

  const state: EditorState<R, X> = {
    problems: [], lifetimes: new Map(), read: undefined, plan: undefined,
    view: watch ? 'canvas' : (store.get(PREF.view) ?? 'both') as EditorState['view'],
    theme: opts.theme ?? (hooks.themeControls ? (store.get('theme') as Theme | null) ?? 'system' : 'system'),
    density: hooks.themeControls ? ((store.get('density') ?? 'comfortable') as EditorState['density']) : 'comfortable',
    readOnly: !!opts.readOnly || !F.edit, problemsOpen: false, problemsSeen: 0, checks: 0,
  };
  if (hooks.brand) (root.querySelector('[data-se="brand"]') as HTMLElement).hidden = false;
  for (const x of hooks.titleStart ?? []) root.querySelector('[data-se="title-start"]')!.append(x);
  $('save').hidden = !opts.onSave;
  $('theme').hidden = $('density').hidden = !hooks.themeControls;

  // ---------- the one model: the text, its Document, the selection and the undo stack ----------
  const doc = new EditorModel();
  // read-only: nothing changes the text (Monaco is read-only too); a view that tries says so
  for (const m of ['apply', 'undo', 'redo'] as const) {
    const f = (doc[m] as (...a: unknown[]) => boolean).bind(doc);
    (doc as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => { if (state.readOnly) { note('This file is read-only here', 'warn'); return false; } return f(...a); };
  }

  // ---------- the text: Monaco, bound to the one model ----------
  const makePane = (): MonacoPane => (F.text ? F.text.textPane($('code'), doc, { onOpen: rel => hooks.onOpen?.(rel), onSave: () => { void save(); }, onSaveAs: () => hooks.onSaveAs?.() }) : noText());
  let pane: MonacoPane = makePane();
  const isTextTarget = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('.monaco-editor, #se-code');

  // ---------- the clipboard, the tree, the properties and the canvas ----------
  const clip = F.edit ? F.edit.clipboard(doc, (t, tone) => note(t, tone)) : { items: () => [], attach: () => () => undefined };
  const tree = treeView($('outline'), doc, {
    kit: S.tree, clipItems: () => clip.items(), nav: () => K.nav(doc.text), problems: () => state.problems, role: () => K.role(doc.text),
    lifetimes: () => state.lifetimes, showInText: path => showInText(path), note: (t, tone) => note(t, tone),
  });
  const props = !F.edit ? { paint: () => undefined, dispose: () => undefined } : F.edit.propsPanel($('sel-body'), doc, {
    nav: () => K.nav(doc.text), problems: () => state.problems, read: () => state.read, note: (t: string, tone?: 'info' | 'warn' | 'bad') => note(t, tone), showInText: (p: Path) => showInText(p),
    now: (ptr: string) => part?.now?.(ptr),
  } as never);
  const paintSelection = () => { $('st-sel').textContent = doc.selection.length > 1 ? `${doc.selection.length} selected` : ''; props.paint(); };
  doc.onSelect(paintSelection);
  const canvas: ShellCanvas = !F.canvas ? noCanvas(S.noCanvas) : F.canvas.canvasView($('canvas'), doc, {
    problems: () => state.problems, note: (t: string, tone?: 'info' | 'warn' | 'bad') => note(t, tone), showInText: (p: Path) => showInText(p),
    showInTree: (p: Path) => { $('tab-outline').click(); doc.select([p], 'menu'); tree.focus(); },
    onZoom: (pct: number) => { $('st-zoom').textContent = `${pct}%`; }, onHint: (t: string) => { $('st-hint').textContent = t; },
    clipItems: () => clip.items(), store,
    ...S.canvasOpts?.(() => part!.api),
  } as never);
  cleanups.push(clip.attach(root, t => !!(t as HTMLElement | null)?.closest?.('#se-outline, .canvas, #se-sel-body')));
  function showInText(path: Path) { if (state.view === 'canvas') setView('both', true); pane.goTo(path); }

  // ---------- the sidebar's tabs (the standalone page adds Files) ----------
  const tabs = root.querySelector('.side-tabs') as HTMLElement;
  for (const t of hooks.sideTabs ?? []) {
    const b = h('button', { class: 'seg', type: 'button', role: 'tab', id: `se-tab-${t.id}`, 'aria-controls': t.panel.id, 'aria-selected': 'false' });
    const ic = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); ic.setAttribute('class', 'icon'); ic.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `#se-i-${t.icon}`); ic.append(use);
    b.append(ic, t.label);
    tabs.append(b);
    t.panel.setAttribute('role', 'tabpanel'); t.panel.setAttribute('aria-labelledby', b.id); t.panel.hidden = true;
    root.querySelector('nav.side')!.append(t.panel);
  }
  tabs.hidden = !(hooks.sideTabs ?? []).length;
  for (const b of tabs.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
    on(b, 'click', () => {
      for (const x of tabs.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
        const isOn = x === b;
        x.setAttribute('aria-selected', String(isOn)); x.classList.toggle('active', isOn);
        (root.querySelector(`#${x.getAttribute('aria-controls')}`) as HTMLElement).hidden = !isOn;
      }
      store.set('tab', b.id);
    });
  }
  if (store.get('tab') && store.get('tab') !== 'se-tab-outline' && root.querySelector(`#${store.get('tab')}`)) (root.querySelector(`#${store.get('tab')}`) as HTMLElement).click();
  else $('tab-outline').classList.add('active');

  // ---------- canvas, text, or both ----------
  // the view asked for (the viewer's, kept in storage as PREF.view), and the one shown: only the views whose features
  // are here (P3). A view forced by a missing feature isn't kept, so adding the feature later shows the one asked for.
  let wanted: EditorState['view'] = state.view;
  function setView(v: EditorState['view'], chosen = false) {
    if (chosen) { wanted = v; if (!watch) store.set(PREF.view, v); }
    if (!F.text) v = 'canvas'; else if (!F.canvas) v = 'text';
    state.view = v;
    root.dataset.view = v;
    for (const b of root.querySelectorAll<HTMLButtonElement>('#se-views .seg')) b.setAttribute('aria-pressed', String(b.dataset.v === v));
    pane.editor.layout();
  }
  for (const b of root.querySelectorAll<HTMLButtonElement>('#se-views .seg')) on(b, 'click', () => setView(b.dataset.v as EditorState['view'], true));

  // ---------- v0.4.1: narrow (the root ≤ 760 px wide): the outline is a drawer over the canvas, opened by its button ----------
  const setTree = (open: boolean) => {
    root.classList.toggle('side-open', open);
    $('tree').setAttribute('aria-expanded', String(open));
    $('tree').setAttribute('aria-label', open ? 'Hide the outline' : 'Show the outline');
    $('scrim').hidden = !open;
  };
  on($('tree'), 'click', () => setTree(!root.classList.contains('side-open')));
  on($('scrim'), 'click', () => setTree(false));
  on(root, 'keydown', (e: KeyboardEvent) => { if (e.key === 'Escape' && root.classList.contains('side-open') && !(e.target as HTMLElement).closest?.('dialog, .menu')) { setTree(false); $('tree').focus(); } });
  {
    // the drawer is for narrow roots only: widening closes it
    const ro = new ResizeObserver(() => { if (root.classList.contains('side-open') && root.clientWidth > 760) setTree(false); });
    ro.observe(root); cleanups.push(() => ro.disconnect());
  }

  // ---------- panels: resizable sidebar, canvas and properties; the properties can be hidden ----------
  function grip(id: string, varName: string, side: 'left' | 'right', min: number, max: number) {
    const g = $(id);
    const saved = store.get(varName);
    if (saved) root.style.setProperty(varName, `${saved}px`);
    const size = () => parseFloat(getComputedStyle(root).getPropertyValue(varName)) || (side === 'left' ? 260 : 280);
    const set = (w: number) => { const v = Math.round(Math.min(max, Math.max(min, w))); root.style.setProperty(varName, `${v}px`); store.set(varName, String(v)); };
    on(g, 'pointerdown', (e: PointerEvent) => {
      g.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = size();
      const mv = (ev: PointerEvent) => set(side === 'left' ? w0 + ev.clientX - x0 : w0 - (ev.clientX - x0));
      const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); };
      g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up);
    });
    on(g, 'keydown', (e: KeyboardEvent) => {
      const d = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
      if (d) { set(size() + (side === 'left' ? d : -d)); e.preventDefault(); }
    });
  }
  grip('side-grip', '--side-w', 'left', 180, 520);
  grip('right-grip', '--right-w', 'right', 200, 520);
  grip('work-grip', '--canvas-w', 'left', 240, 1600);
  const setPanel = (isOn: boolean) => { root.classList.toggle('no-right', !isOn); $('panel').setAttribute('aria-pressed', String(isOn)); store.set('panel', isOn ? '1' : '0'); };
  setPanel(store.get('panel') !== '0');
  on($('panel'), 'click', () => setPanel(root.classList.contains('no-right')));

  // ---------- theme: the host's tokens, on the light or dark side (color-scheme on the root) ----------
  const media = matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => state.theme === 'dark' || (state.theme === 'system' && media.matches);
  function applyTheme() {
    root.style.colorScheme = state.theme === 'system' ? 'light dark' : state.theme;
    if (state.theme === 'system') delete root.dataset.theme; else root.dataset.theme = state.theme;
    if (state.density === 'compact') root.dataset.density = 'compact'; else delete root.dataset.density;
    pane.setTheme(isDark());
    canvas.setTheme(isDark() ? 'dark' : 'light');
    for (const b of root.querySelectorAll<HTMLButtonElement>('#se-theme .seg')) b.setAttribute('aria-pressed', String(b.dataset.v === state.theme));
    $('density').setAttribute('aria-pressed', String(state.density === 'compact'));
  }
  on(media, 'change', () => { if (state.theme === 'system') applyTheme(); });
  const setTheme = (t: Theme) => { state.theme = t; if (hooks.themeControls) store.set('theme', t); applyTheme(); };
  const setDensity = (d: EditorState['density']) => { state.density = d; store.set('density', d); applyTheme(); };
  for (const b of root.querySelectorAll<HTMLButtonElement>('#se-theme .seg')) on(b, 'click', () => setTheme(b.dataset.v as Theme));
  on($('density'), 'click', () => setDensity(state.density === 'compact' ? 'comfortable' : 'compact'));

  // ---------- a note, and the banner (changed elsewhere; the standalone page's file bar) ----------
  let noteTimer = 0;
  function note(text: string, tone: 'info' | 'warn' | 'bad' = 'info') {
    const n = $('note');
    n.className = `callout compact ${tone === 'info' ? '' : tone}`;
    n.querySelector('.c-body')!.textContent = text;
    n.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => { n.hidden = true; }, 6000);
  }
  function showBanner(body: Node[], actions: { label: string; primary?: boolean; run(): void }[]) {
    const bar = $('filebar');
    bar.querySelector('.c-body')!.replaceChildren(...body);
    const acts = bar.querySelector('.c-acts')!;
    acts.replaceChildren(...actions.map(a => { const b = h('button', { type: 'button', class: `btn sm${a.primary ? ' primary' : ''}` }, a.label); b.addEventListener('click', a.run); return b; }));
    bar.hidden = false;
  }
  const hideBanner = () => { $('filebar').hidden = true; };

  // ---------- saving: the host's onSave; a conflict is shown, never resolved here ----------
  const dirty = () => doc.dirty;
  let wasDirty = false;
  function paintTitle() {
    ($('save') as HTMLButtonElement).disabled = !dirty() || state.readOnly;
    if (dirty() !== wasDirty) { wasDirty = dirty(); opts.onDirtyChange?.(wasDirty); }
  }
  async function save(): Promise<boolean> {
    if (!opts.onSave || state.readOnly) return false;
    if (!dirty()) return true;
    const text = doc.text;
    doc.seal();
    let r: SaveResult;
    try { r = await opts.onSave(text); } catch (e) { note(`Not saved: ${(e as Error).message ?? e}`, 'bad'); return false; }
    if ('conflict' in r) {
      if (hooks.onConflict) { hooks.onConflict(); return false; }
      showBanner([h('span', { class: 'c-title' }, 'Changed elsewhere.'), h('span', null, ' This file changed outside the editor since it was loaded, so it wasn\'t saved.')],
        [{ label: 'Dismiss', run: hideBanner }]);
      return false;
    }
    if (doc.text === text) doc.markClean();       // an edit made while saving stays unsaved
    hideBanner();
    paintTitle();
    return true;
  }
  on($('save'), 'click', () => { void save(); });

  // ---------- the keys: bound on the root, so nothing answers while the focus is outside the editor ----------
  const keymap: KeyGroup[] = hooks.keymap ? keymapWith(K.keymap, hooks.keymap) : K.keymap;
  const sheet = () => keySheet(keymap);
  on($('keys'), 'click', () => sheet());
  on(root, 'keydown', (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (t.closest?.('input, textarea, select, .monaco-editor, #se-code, [contenteditable], dialog')) return;
      e.preventDefault(); sheet(); return;
    }
    if (hooks.keys?.(e)) return;
    if (!(e.metaKey || e.ctrlKey) || e.altKey || isTextTarget(e.target)) return;   // the text has its own bindings
    const k = e.key.toLowerCase();
    if (k === 's' && !e.shiftKey) { e.preventDefault(); void save(); }
    else if (k === 'z' && !e.shiftKey) { doc.undo(); e.preventDefault(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { doc.redo(); e.preventDefault(); }
  });

  // ---------- E10: the plan panel, beside Problems (the same plan, rendered) ----------
  const resourcePath = (name: string) => K.objectPath(name, state.read);
  const makePlan = () => (!F.plan ? { paint: () => undefined } : F.plan.planPanel($('plan'), {
    has: name => !!resourcePath(name),
    select: name => { const p = resourcePath(name); if (!p) return false; doc.select([fromPointer(p)], 'menu'); return true; },
  }));
  let planUI: { paint(extra: unknown, has: boolean): void } = makePlan();
  let bottomTab: 'problems' | 'plan' = (store.get('bottom-tab') as 'problems' | 'plan' | null) ?? 'problems';
  function setBottomTab(t: 'problems' | 'plan') {
    bottomTab = t; store.set('bottom-tab', t);
    for (const b of root.querySelectorAll<HTMLButtonElement>('.bottom-tabs [role="tab"]')) { const isOn = b.id === `se-tab-${t}`; b.setAttribute('aria-selected', String(isOn)); b.classList.toggle('active', isOn); }
    $('problems-list').hidden = t !== 'problems';
    $('plan').hidden = t !== 'plan';
    $('problems-toggle').setAttribute('aria-controls', t === 'plan' ? 'se-plan' : 'se-problems-list');
  }
  for (const b of root.querySelectorAll<HTMLButtonElement>('.bottom-tabs [role="tab"]')) on(b, 'click', () => { setBottomTab(b.id === 'se-tab-plan' ? 'plan' : 'problems'); setProblemsOpen(true, false); });
  function paintPlan() {
    planUI.paint(state.plan, S.hasExtra);
    const L = K.extraLabel(state.plan);
    $('plan-label').textContent = L.text;
    $('plan-label').className = `plan-label ${L.cls}`;
  }

  // ---------- problems and the plan: from the host's plan(text); the reader only draws ----------
  let timer = 0;
  let disposed = false;
  async function check() {
    clearTimeout(timer);
    const text = doc.text, version = doc.version;
    const r = await K.check(text, state.plan, note);
    if (disposed || doc.version !== version) return;
    state.plan = r.extra;
    state.problems = r.problems;
    state.read = r.read;
    state.lifetimes = r.tags as EditorState['lifetimes'];
    state.checks++;
    pane.setProblems(state.problems.filter(p => !p.file));
    paintProblems();
    paintPlan();
    tree.paint();
    paintSelection();
    void canvas.render(r.model, r.data);
  }
  cleanups.push(doc.on(() => { paintTitle(); paintHistory(); clearTimeout(timer); timer = window.setTimeout(() => { void check(); }, 150); }));

  // ---------- undo and redo: one stack for every view ----------
  function paintHistory() {
    const u = $('undo') as HTMLButtonElement, r = $('redo') as HTMLButtonElement;
    u.disabled = !doc.canUndo || state.readOnly; r.disabled = !doc.canRedo || state.readOnly;
    u.title = doc.canUndo ? `Undo ${doc.undoLabel} (⌘Z)` : 'Nothing to undo';
    r.title = doc.canRedo ? `Redo ${doc.redoLabel} (⇧⌘Z)` : 'Nothing to redo';
    u.setAttribute('aria-label', u.title); r.setAttribute('aria-label', r.title);
  }
  on($('undo'), 'click', () => { doc.undo(); pane.focus(); });
  on($('redo'), 'click', () => { doc.redo(); pane.focus(); });

  function setProblemsOpen(open: boolean, byHand: boolean) {
    if (byHand && !state.problems.length && !part?.attention?.()?.count && bottomTab === 'problems') open = false;
    state.problemsOpen = open;
    $('problems').classList.toggle('collapsed', !open);
    $('problems-toggle').setAttribute('aria-expanded', String(open));
    pane.editor.layout();
  }
  on($('problems-toggle'), 'click', () => setProblemsOpen(!state.problemsOpen, true));
  /** the live part (Live, Simulation, the runs, what waits for a person): read by paintProblems, which can run before
   *  the part is set up */
  let part: EditorPart<A> | undefined;
  function paintProblems() {
    const list = $('problems-list');
    list.replaceChildren();
    const errs = state.problems.filter(p => p.severity === 'error').length;
    const warns = state.problems.length - errs;
    $('problems-label').textContent = state.problems.length ? `Problems · ${errs} error${errs === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}` : 'No problems';
    const had = state.problemsSeen;
    const A = part?.attention?.();
    state.problemsSeen = state.problems.length + (A?.count ?? 0);
    // (in Simulation, made-up attention doesn't open or close the list: the layout keeps still while it plays or scrubs)
    const attn = A?.opens ?? 0;
    if (A?.still && !state.problems.length) setProblemsOpen(state.problemsOpen, false);
    else if (!state.problems.length && !attn && bottomTab === 'problems') setProblemsOpen(false, false);
    else if ((state.problems.length || attn) && !had) setProblemsOpen(true, false);
    else setProblemsOpen(state.problemsOpen, false);
    $('st-problems').textContent = `${errs} ✕  ${warns} ⚠`;
    $('st-problems').className = errs ? 'bad' : warns ? 'warn' : 'ok';
    // what waits for a person (the part's), under its own heading, before the file's problems
    if (A?.rows.length) {
      list.append(...A.rows);
      if (state.problems.length) list.append(h('div', { class: 'prob-head' }, 'In the file'));
    }
    $('problems-label').textContent = (state.problems.length ? $('problems-label').textContent : A?.count ? '' : 'No problems') + (A?.count ? `${state.problems.length ? ' · ' : ''}${A.label}` : '');
    for (const p of state.problems) {
      const b = h('button', { type: 'button', class: `prob ${p.severity}${p.file ? ' other-file' : ''}` },
        h('span', { class: 'where' }, p.file ? `${p.file} · line ${p.startLine}` : `${p.startLine}:${p.startCol}`), h('span', { class: 'msg' }, p.message),
        p.hint ? h('span', { class: 'hint' }, p.hint) : null);
      // a problem in another file (a defaults file) is named, not placed in this text
      if (p.file) b.title = `In ${p.file}, line ${p.startLine}: not in this file`;
      else b.addEventListener('click', () => pane.goToOffset(problemRange(doc.text, p)[0]));
      list.append(b);
    }
  }

  // ---------- the status bar ----------
  let caretFrame = 0;
  const paintCaret = () => {
    if (caretFrame) return;
    caretFrame = requestAnimationFrame(() => { caretFrame = 0; const p = pane.caret(); $('st-pos').textContent = p ? `Ln ${p.line}, Col ${p.col}` : ''; });
  };
  const paintPathLater = later(() => paintPath());
  function paintPath() {
    const path = pane.pathAtCaret();
    $('st-path').textContent = path.length ? path.join(' › ') : '';
    $('st-path').title = toPointer(path);
    $('st-kind').textContent = K.kindLabel(doc.text);
  }
  const wireCaret = () => pane.onCaret(() => { paintCaret(); paintPathLater(); });
  wireCaret();
  cleanups.push(doc.on(c => { paintCaret(); if (isTyping(c)) paintPathLater(); else paintPathLater.now(); }));

  // ---------- resizing the problems panel ----------
  {
    const g = $('grip');
    const move = (dy: number) => {
      const hh = Math.min(Math.max($('problems').getBoundingClientRect().height - dy, 48), innerHeight * 0.6);
      root.style.setProperty('--problems-h', `${hh}px`);
      store.set('problems-h', String(Math.round(hh)));
    };
    const saved = store.get('problems-h');
    if (saved) root.style.setProperty('--problems-h', `${saved}px`);
    on(g, 'pointerdown', (e: PointerEvent) => {
      g.setPointerCapture(e.pointerId);
      let y = e.clientY;
      const mv = (ev: PointerEvent) => { move(ev.clientY - y); y = ev.clientY; };
      const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); };
      g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up);
    });
    on(g, 'keydown', (e: KeyboardEvent) => { if (e.key === 'ArrowUp') { move(-16); e.preventDefault(); } if (e.key === 'ArrowDown') { move(16); e.preventDefault(); } });
  }

  // ---------- the domain's part (what it adds beside the views) ----------
  part = S.part?.({
    root, byId: $, doc, store, note, watch, on: (t, ev, fn) => on(t as HTMLElement, ev as 'change', fn), disposed: () => disposed,
    paintProblems: () => paintProblems(), paintProps: () => props.paint(),
  }, { canvas: () => canvas, objectPath: resourcePath });

  // ---------- read-only ----------
  function setReadOnly(ro: boolean) {
    ro = ro || !F.edit;                       // without the edit feature, nothing edits
    state.readOnly = ro;
    root.classList.toggle('read-only', ro);
    $('ro').hidden = !ro;
    pane.setReadOnly(ro);
    paintTitle(); paintHistory();
  }

  // ---------- start ----------
  // P3: the controls of features not given are not shown
  function paintFeatures() {
    $('views').hidden = !(F.text && F.canvas);
    $('right').hidden = $('right-grip').hidden = !F.edit;
    ($('tab-plan') as HTMLElement).hidden = !F.plan;
    root.dataset.features = Object.keys(F).sort().join(' ');
  }
  if (!F.plan && bottomTab === 'plan') bottomTab = 'problems';
  setBottomTab(bottomTab);
  paintFeatures();
  setView(state.view);
  applyTheme();
  setReadOnly(state.readOnly);
  doc.load(opts.text ?? '');
  part?.start?.();
  paintTitle(); paintHistory();

  // ---------- v0.4.1: features added to the mounted editor: the file, its undo history and the selection are kept ----------
  // text and plan attach here; the others are drawn into the canvas when it is made, so they come with a new mount.
  const LATE = S.late;
  let adding: Promise<void> = Promise.resolve();
  async function addFeatures(names: readonly string[]): Promise<void> {
    const bad = names.filter(n => !S.names.includes(n));
    if (bad.length) throw new Error(`unknown feature ${bad.join(', ')}: the features are ${S.names.join(', ')}`);
    const run = adding.then(async () => {
      if (disposed) throw new Error('the editor was disposed');
      const want = [...new Set(names)].filter(n => !F[n]);
      if (!want.length) return;
      const late = want.filter(n => !LATE.includes(n));
      if (late.length) throw new Error(`${late.join(', ')} can't be added to a mounted editor (only ${LATE.join(' and ')} can): mount with ${late.length > 1 ? 'them' : 'it'}`);
      if (!load) throw new Error(`this build has no loader for ${want.join(', ')}: mount with ${want.length > 1 ? 'them' : 'it'}`);
      const got = await load(want);
      if (disposed) throw new Error('the editor was disposed');
      const sel = doc.selection.slice();
      for (const f of got) (F as Record<string, unknown>)[f.name] = f;
      if (want.includes('text')) {
        pane.dispose();
        pane = makePane();                          // its model takes the file as it is now (doc.text)
        wireCaret();
        pane.setReadOnly(state.readOnly);
        pane.setProblems(state.problems.filter(p => !p.file));
        applyTheme();
        if (sel.length) doc.select(sel, 'menu');
      }
      if (want.includes('plan')) { planUI = makePlan(); paintPlan(); }
      paintFeatures();
      setView(wanted);
      paintPath();
    });
    adding = run.catch(() => undefined);
    return run;
  }

  const internal: Record<string, unknown> = {
    root, doc, get pane() { return pane; }, tree, canvas, props, clip, state, check, save, note, setView, showBanner, hideBanner,
    keySheet: sheet, setTheme, setDensity, setBottomTab,
    markers: () => {
      const M = pane.monaco;
      return M.editor.getModelMarkers({ resource: pane.model.uri }).map(m => ({ severity: m.severity, message: m.message, line: m.startLineNumber, col: m.startColumn, endCol: m.endColumn }));
    },
  };
  // the domain's handles, and its part's calls (their getters stay getters)
  if (S.internal) Object.defineProperties(internal, Object.getOwnPropertyDescriptors(S.internal));
  if (part) Object.defineProperties(internal, Object.getOwnPropertyDescriptors(part.api));
  return {
    internal,
    getText: () => doc.text,
    setText(text: string) { hideBanner(); doc.load(text); doc.markClean(); paintTitle(); paintHistory(); },
    setReadOnly,
    setTheme,
    addFeatures,
    fit() { if (!disposed) canvas.fit(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer); clearTimeout(noteTimer); part?.dispose?.(); cancelAnimationFrame(caretFrame); paintPathLater.cancel();
      closeMenu();
      for (const c of cleanups.splice(0)) c();
      tree.dispose(); props.dispose(); canvas.dispose();
      pane.dispose();
      root.remove();
      setLayer(null);
    },
  };
}

/** P3: no text feature: a pane that shows nothing (the canvas is the view); no Monaco is loaded */
function noText(): MonacoPane {
  const none = () => undefined;
  return { setTheme: none, setReadOnly: none, setProblems: none, goTo: none, goToOffset: none, focus: none, dispose: none,
    onCaret: none, caret: () => undefined, pathAtCaret: () => [], editor: { layout: none, focus: none }, model: undefined, monaco: undefined,
    resyncs: () => 0 } as unknown as MonacoPane;
}
/** P3: no canvas feature: nothing drawn (the text and the tree are the views); every call answers nothing */
function noCanvas(more: Record<string, unknown> = {}): ShellCanvas {
  const fixed: Record<string, unknown> = { palette: undefined, doc: undefined, stage: undefined, ...more };
  return new Proxy({}, { get: (_t, k: string) => (k in fixed ? fixed[k] : () => undefined) }) as unknown as ShellCanvas;
}
