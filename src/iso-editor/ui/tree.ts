// The tree: the file's outline (src/iso-editor/outline.ts) with CRUD on every node, in the Files-tree look (.frow,
// --tree-indent). What the domain's objects are called, their icons, what "New …" offers and the tags' pills are the
// kit's (TreeKit: the domain's outline, commands and words). Every change is a command on the one model, so the text, the tree and (E4) the canvas
// stay one document with one undo stack.
//   Keyboard: ↑ ↓ (⇧ extends), → ← (open, close, child, parent), Home End, Enter (edit a value, or open), F2 rename,
//   Delete, ⌘D duplicate, ⌘↑ select parent, + add, Shift-F10 or the menu key for the menu, letters to jump.
//   Mouse: click, ⇧-click a range, ⌘-click to add or remove, double-click to edit, drag to reorder, right-click.

import { later, isTyping } from './later.ts';
import { h, icon, type IconName } from './icons.ts';
import { openMenu, type MenuItem } from './menu.ts';
import { ask } from './dialog.ts';
import { flatten, type OutlineNode } from '../outline.ts';
import type { EditorModel, Command } from '../model.ts';
import type { EditorDoc } from '../doc.ts';
import type { SchemaNav } from '../schema-nav.ts';
import type { Problem } from '../validate.ts';
import type { Commands } from '../commands.ts';
import type { FileRole, ObjectKindInfo, RefSlot } from '../adapter.ts';
import { applyStep } from '../splice.ts';
import { toPointer, fromPointer, isPrefix, type Path } from '../path.ts';

/** a "New …" entry for a kind's group: its words, its icon, and what it starts as (default: the kind's) */
export interface NewItem { label: string; icon: IconName; desc?: string; template?: () => unknown; stem?: string }
/** an entry an entry group offers: its words, its icon, its key (made unique) and its value */
export interface EntryItem { label: string; icon: IconName; entry: string; value: unknown; cmdLabel?: string; when?: (data: Record<string, unknown>) => boolean }

/** what the tree shows of the domain, in its words */
export interface TreeUi {
  /** the tree's aria-label */
  label: string;
  rootIcon: IconName;
  kindIcon(kind: string): IconName;
  /** a top-level key's icon, if it has one */
  keyIcon(key: string): IconName | undefined;
  /** an entry group's entries' icon */
  entryIcon(group: string): IconName;
  /** a kind's group's "New …" entries, in order */
  newItems(kind: string): NewItem[];
  /** an entry group's own add items (its entries made from the file: owned, not yet entered) */
  entryItems?(group: Path, data: Record<string, unknown>, owned: (kind: string) => string[]): EntryItem[];
  /** a tag's pill (none: no pill) */
  tagPill(tag: string): { title: string } | undefined;
  /** the name rule, in words */
  nameHint: string;
  text: { root: string; rootAdd: string; renameWhy: string; deleteWhy: string; duplicateNote: string; duplicateWhy: string };
}

/** what the tree is given of the domain */
export interface TreeKit {
  outline(d: EditorDoc, role: FileRole, tags: Map<string, string>): OutlineNode;
  commands: Pick<Commands, 'setCmd' | 'insertCmd' | 'insertItemCmd' | 'deleteCmd' | 'renameCmd' | 'renameKeyCmd' | 'duplicateCmd' | 'moveCmd' | 'moveItemCmd' | 'referencesTo' | 'describe' | 'freshName'>;
  slotAt(ptr: string): RefSlot | undefined;
  /** the kinds, in the outline's order */
  kinds: ObjectKindInfo[];
  /** named maps that aren't kinds (their names a pool of their own) */
  entryGroups: Path[];
  /** what a name must be */
  nameRule: RegExp;
  ui: TreeUi;
}

export interface TreeOpts {
  kit: TreeKit;
  nav(): SchemaNav;
  problems(): Problem[];
  role(): FileRole;
  /** each object's tag as the reader resolved it, with the base files merged */
  lifetimes(): Map<string, string>;
  /** show a path in the text pane and give it the focus */
  showInText(path: Path): void;
  /** Copy, Cut and Paste for the menu */
  clipItems?(): import('./menu.ts').MenuItem[];
  /** a message for the person (an edit that can't be made) */
  note(text: string, tone?: 'info' | 'warn' | 'bad'): void;
}

type Editing = { id: string; mode: 'rename' | 'value' } | { id: string; mode: 'new'; section?: string; mapPath: Path; template: () => unknown; value?: unknown };

export function treeView(el: HTMLElement, doc: EditorModel, opts: TreeOpts) {
  const K = opts.kit, ui = K.ui;
  const { setCmd, insertCmd, insertItemCmd, deleteCmd, renameCmd, renameKeyCmd, duplicateCmd, moveCmd, moveItemCmd, referencesTo, describe, freshName } = K.commands;
  const kindOf = (k: string) => K.kinds.find(x => x.kind === k)!;
  const isRoot = (n: OutlineNode) => n.id === '';
  const inGroup = (p: Path) => K.entryGroups.some(g => p.length === g.length + 1 && isPrefix(g, p));
  const isGroupPath = (p: Path) => K.entryGroups.some(g => g.length === p.length && isPrefix(g, p));
  const expanded = new Set<string>(['', ...K.kinds.map(k => toPointer(k.section)), ...K.entryGroups.map(g => toPointer(g))]);
  let focused = '';
  let anchor = '';
  let editing: Editing | undefined;
  let rows: { n: OutlineNode; depth: number; parent?: OutlineNode }[] = [];
  let byId = new Map<string, { n: OutlineNode; depth: number; parent?: OutlineNode }>();
  let typeahead = '', typeaheadAt = 0;
  const selected = () => new Set(doc.selection.map(toPointer));
  const readOnly = () => !doc.doc.ok;

  el.setAttribute('role', 'tree');
  el.setAttribute('aria-label', ui.label);
  el.setAttribute('aria-multiselectable', 'true');
  el.classList.add('tree');

  // ---------- painting ----------
  function paint() {
    const root = K.outline(doc.goodDoc, opts.role(), opts.lifetimes());
    rows = [];
    const walk = (n: OutlineNode, depth: number, parent?: OutlineNode) => {
      rows.push({ n, depth, parent });
      if (expanded.has(n.id)) for (const c of n.children) walk(c, depth + 1, n);
      if (editing?.mode === 'new' && toPointer(editing.mapPath) === n.id && expanded.has(n.id)) rows.push({ n: { id: editing.id, path: [...editing.mapPath, ''], kind: 'resource', label: '', shape: 'scalar', children: [] }, depth: depth + 1, parent: n });
    };
    walk(root, 0);
    byId = new Map(rows.map(r => [r.n.id, r]));
    if (!byId.has(focused)) focused = rows[0]?.n.id ?? '';
    const sel = selected();
    const counts = problemCounts();
    const frag = document.createDocumentFragment();
    if (readOnly()) frag.append(h('div', { class: 'callout compact warn tree-note', role: 'status' }, h('span', { class: 'c-body' }, `Fix the YAML at line ${doc.doc.doc.errors[0] ? doc.doc.pos(doc.doc.doc.errors[0].pos[0]).line : '?'} to edit here; the tree shows the last version that read cleanly.`)));
    for (const { n, depth } of rows) frag.append(row(n, depth, sel.has(n.id), counts.get(n.id)));
    // (0.8.2) the rows are made anew: focus that was in the tree stays in it, on the focused row (a repaint after an
    // edit, e.g. when the reader's problems arrive, would otherwise drop it to the page, and ⌘Z would need a click)
    const hadFocus = el.contains(document.activeElement);
    el.replaceChildren(frag);
    const f = el.querySelector<HTMLElement>(`[data-id="${CSS.escape(focused)}"]`);
    if (f) f.tabIndex = 0;
    const inp = el.querySelector<HTMLInputElement | HTMLSelectElement>('.tedit');
    if (inp) { inp.focus(); if (inp instanceof HTMLInputElement) inp.select(); }
    else if (hadFocus && f && !el.contains(document.activeElement)) f.focus({ preventScroll: true });
  }

  function problemCounts(): Map<string, { e: number; w: number }> {
    const m = new Map<string, { e: number; w: number }>();
    for (const p of opts.problems()) {
      if (p.file) continue;
      // every ancestor shown counts it
      const parts = fromPointer(p.path);
      for (let i = 1; i <= parts.length; i++) {
        const id = toPointer(parts.slice(0, i));
        const c = m.get(id) ?? { e: 0, w: 0 };
        if (p.severity === 'error') c.e++; else c.w++;
        m.set(id, c);
      }
    }
    return m;
  }

  function iconFor(n: OutlineNode): IconName {
    if (isRoot(n)) return ui.rootIcon;
    if (n.section) return ui.kindIcon(n.section);
    const k = String(n.path[n.path.length - 1] ?? '');
    if (n.path.length === 1 && ui.keyIcon(k)) return ui.keyIcon(k)!;
    if (inGroup(n.path)) return ui.entryIcon(String(n.path[0]));
    return n.shape === 'list' ? 'list' : n.shape === 'map' ? 'list-tree' : 'circle-dot';
  }

  function row(n: OutlineNode, depth: number, isSel: boolean, count?: { e: number; w: number }): HTMLElement {
    const open = expanded.has(n.id);
    const hasKids = n.children.length > 0 || n.shape === 'missing' && false;
    const r = h('div', {
      class: `trow k-${n.kind}${isSel ? ' selected' : ''}${n.shape === 'missing' ? ' missing' : ''}${n.ext ? ' ext' : ''}`,
      role: 'treeitem', 'aria-level': depth + 1, 'aria-selected': String(isSel), 'aria-expanded': n.children.length ? String(open) : undefined,
      tabindex: '-1', 'data-id': n.id, draggable: canDrag(n) ? 'true' : undefined, 'aria-label': ariaLabel(n),
    });
    r.style.setProperty('--depth', String(depth));
    const tw = h('span', { class: 'twisty', 'aria-hidden': 'true' }, hasKids ? icon(open ? 'chevron-down' : 'chevron-right') : '');
    tw.addEventListener('click', e => { e.stopPropagation(); toggle(n.id); });
    r.append(tw, icon(iconFor(n), 'ticon'));
    const ed = editing && editing.id === n.id ? editing : undefined;
    if (ed && (ed.mode === 'rename' || ed.mode === 'new')) r.append(nameInput(n, ed));
    else r.append(h('span', { class: 'tlabel' }, n.label || (n.kind === 'item' ? '""' : '')));
    if (ed?.mode === 'value') r.append(valueInput(n));
    else if (n.value !== undefined && n.kind !== 'item') r.append(h('span', { class: 'tval' }, n.value));
    else if (n.shape === 'missing') r.append(h('span', { class: 'tval none' }, 'none'));
    else if (n.kind === 'group' && n.children.length) r.append(h('span', { class: 'tcount' }, String(n.children.length)));
    const pill = n.lifetime ? ui.tagPill(n.lifetime) : undefined;
    if (pill) r.append(h('span', { class: `tpill l-${n.lifetime}`, title: pill.title }, n.lifetime!));
    if (count?.e) r.append(h('span', { class: 'count bad', title: `${count.e} error${count.e > 1 ? 's' : ''}` }, String(count.e)));
    else if (count?.w) r.append(h('span', { class: 'count warn', title: `${count.w} warning${count.w > 1 ? 's' : ''}` }, String(count.w)));
    if (!readOnly() && addItems(n).length) {
      const add = h('button', { type: 'button', class: 'tadd btn sm quiet icon-only', tabindex: '-1', 'aria-label': `Add to ${n.label || ui.text.rootAdd}`, title: 'Add…' }, icon('plus'));
      add.addEventListener('click', e => { e.stopPropagation(); setFocus(n.id); openMenu(addItems(n), add, `Add to ${n.label}`); });
      r.append(add);
    }
    return r;
  }

  const ariaLabel = (n: OutlineNode) => [n.kind === 'group' ? `${n.label}, ${n.shape === 'missing' ? 'none' : n.children.length}` : n.label, n.value !== undefined && n.kind !== 'item' ? `: ${n.value}` : '', n.lifetime && n.lifetime !== 'run' ? `, ${n.lifetime}` : ''].join('');

  // ---------- expanding, focus, selection ----------
  function toggle(id: string, to?: boolean) {
    const want = to ?? !expanded.has(id);
    if (want) expanded.add(id); else expanded.delete(id);
    paint();
  }
  function setFocus(id: string) {
    focused = id;
    for (const x of el.querySelectorAll<HTMLElement>('.trow')) x.tabIndex = x.dataset.id === id ? 0 : -1;
    const r = el.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    r?.focus({ preventScroll: true });
    r?.scrollIntoView({ block: 'nearest' });
  }
  function selectIds(ids: string[], focusId = ids[ids.length - 1]) {
    // the focus moves to the tree first, so the text pane (no longer focused) moves its caret to the selection
    if (focusId !== undefined) { focused = focusId; setFocus(focused); }
    doc.select(ids.map(fromPointer), 'tree');
    paint();
    setFocus(focused);
  }
  function clickSelect(id: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) {
    if (e.shiftKey && anchor) {
      const ids = rows.map(r => r.n.id);
      const a = ids.indexOf(anchor), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) { selectIds(ids.slice(Math.min(a, b), Math.max(a, b) + 1), id); return; }
    }
    if (e.metaKey || e.ctrlKey) {
      const s = selected();
      if (s.has(id)) s.delete(id); else s.add(id);
      anchor = id;
      selectIds([...s], id);
      return;
    }
    anchor = id;
    selectIds([id]);
  }
  /** reveal a path chosen elsewhere: open its ancestors, mark it, scroll to it (without taking the focus) */
  function reveal(paths: Path[]) {
    for (const p of paths) for (let i = 0; i < p.length; i++) expanded.add(toPointer(p.slice(0, i)));
    if (paths[0]) {
      // the nearest node the outline has (a path inside a scalar shows its key)
      let id = toPointer(paths[0]);
      paint();
      while (!byId.has(id) && id) id = id.replace(/\/[^/]*$/, '');
      focused = id;
    }
    paint();
    el.querySelector<HTMLElement>(`[data-id="${CSS.escape(focused)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  // ---------- what can be done to a node ----------
  const canDrag = (n: OutlineNode) => !readOnly() && !isRoot(n) && n.kind !== 'group' && n.path.length > 1 || (n.kind === 'item');
  const isResource = (n: OutlineNode) => n.kind === 'resource' && !!n.section;
  const isNameMap = (n: OutlineNode) => n.kind === 'group' && (!!n.section || isGroupPath(n.path));

  function addItems(n: OutlineNode): MenuItem[] {
    if (readOnly()) return [];
    const nav = opts.nav();
    const items: MenuItem[] = [];
    const data = doc.goodDoc.data as Record<string, unknown> | undefined;
    if (isRoot(n)) {
      for (const k of K.kinds) {
        if (opts.role() !== 'main') break;
        items.push({ label: `New ${k.singular}`, icon: ui.kindIcon(k.kind), onSelect: () => newResource(k.kind) });
      }
      const present = new Set(n.children.filter(c => c.shape !== 'missing').map(c => String(c.path[0])));
      const sectionTops = new Set(K.kinds.map(k => String(k.section[0])));
      const keys = nav.keys([], (data ?? {}) as Record<string, unknown>).filter(k => !present.has(k.name) && !sectionTops.has(k.name) && !(data && k.name in data));
      if (keys.length) items.push({ sep: true }, { heading: 'Settings' }, ...keys.map(k => ({ label: k.name, desc: firstLine(k.doc), onSelect: () => addKey([], k.name) })));
      return items;
    }
    if (n.kind === 'group' && n.section) {
      const s = n.section;
      for (const x of ui.newItems(s)) items.push({ label: x.label, icon: x.icon, desc: x.desc, onSelect: () => newResource(s, x.template, x.stem) });
      return items;
    }
    if (isGroupPath(n.path) && ui.entryItems) return entryItems(n.path);
    if (n.shape === 'missing') return [{ label: `Add ${n.label}`, icon: 'plus', onSelect: () => addKey([], String(n.path[0]), true) }];
    if (n.shape === 'list') {
      const slot = K.slotAt(toPointer([...n.path, 0]));
      const have = new Set(n.children.map(c => c.label));
      if (slot) {
        for (const s of slot.targets) for (const name of namesIn(s)) if (!have.has(slot.write ? slot.write(name) : name)) items.push({ label: slot.write ? slot.write(name) : name, icon: ui.kindIcon(s), desc: `${kindOf(s).singular}`, onSelect: () => run(insertItemCmd(n.path, slot.write ? slot.write(name) : name, undefined, `Add ${name} to ${describe(n.path)}`)) });
        for (const e of slot.extra ?? []) if (!have.has(e)) items.push({ label: e, onSelect: () => run(insertItemCmd(n.path, e, undefined, `Add ${e} to ${describe(n.path)}`)) });
      }
      for (const v of nav.values([...n.path, 0])) if (!have.has(v)) items.push({ label: v, onSelect: () => run(insertItemCmd(n.path, v)) });
      items.push({ label: 'New item', icon: 'plus', onSelect: () => { run(insertItemCmd(n.path, '')); const p = [...n.path, n.children.length]; startEdit(toPointer(p), 'value'); } });
      return items;
    }
    if (n.shape === 'map' || n.kind === 'resource') {
      const here = getIn(data, n.path);
      const present = here && typeof here === 'object' && !Array.isArray(here) ? here as Record<string, unknown> : {};
      for (const k of nav.keys(n.path, present)) if (!(k.name in present)) items.push({ label: k.name, desc: firstLine(k.doc), onSelect: () => addKey(n.path, k.name) });
      return items;
    }
    return items;
  }

  /** an entry group's add items, as the kit says (each entry's key made unique in the group) */
  function entryItems(group: Path): MenuItem[] {
    const data = (doc.goodDoc.data ?? {}) as Record<string, unknown>;
    const here = (getIn(data, group) ?? {}) as Record<string, unknown>;
    return ui.entryItems!(group, data, ownedIn).filter(x => !x.when || x.when(data))
      .map(x => ({ label: x.label, icon: x.icon, onSelect: () => { run(insertCmd(group, uniqueKey(Object.keys(here), x.entry), x.value, x.cmdLabel ? { label: x.cmdLabel } : {})); } }));
  }

  const firstLine = (s?: string) => s?.split(/(?<=\.)\s/)[0]?.replace(/`/g, '');
  const getIn = (o: unknown, p: Path) => p.reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k as string] : undefined), o);
  const namesIn = (s: string) => { const m = getIn(doc.goodDoc.data, kindOf(s).section); return m && typeof m === 'object' ? Object.keys(m).filter(k => !k.startsWith('x-')) : []; };
  /** a kind's objects this file owns (not external) */
  const ownedIn = (s: string) => { const m = getIn(doc.goodDoc.data, kindOf(s).section) as Record<string, Record<string, unknown>> | undefined; return m ? Object.keys(m).filter(k => !k.startsWith('x-') && !(m[k] && typeof m[k] === 'object' && 'external' in m[k])) : []; };
  const uniqueKey = (have: string[], stem: string) => { if (!have.includes(stem)) return stem; let i = 2; while (have.includes(`${stem}-${i}`)) i++; return `${stem}-${i}`; };

  function run(c: Command): boolean {
    try { return doc.apply(c, 'tree'); } catch (e) { opts.note(String((e as Error).message), 'bad'); return false; }
  }

  function addKey(mapPath: Path, key: string, empty = false) {
    const nav = opts.nav();
    const value = empty ? {} : nav.defaultFor([...mapPath, key]);
    if (run(insertCmd(mapPath, key, value))) {
      expanded.add(toPointer(mapPath));
      const id = toPointer([...mapPath, key]);
      focused = id;
      if (value === '' || typeof value === 'number') startEdit(id, 'value'); else { paint(); setFocus(id); }
    }
  }

  function newResource(s: string, template = kindOf(s).template, stem = kindOf(s).singular) {
    const mapPath = kindOf(s).section;
    expanded.add(toPointer(mapPath));
    editing = { id: '#new', mode: 'new', section: s, mapPath, template, value: freshName(doc.text, stem) };
    paint();
  }

  // ---------- inline editing ----------
  function startEdit(id: string, mode: 'rename' | 'value') {
    if (readOnly()) return;
    const r = byId.get(id);
    if (!r) { paint(); return; }
    if (mode === 'rename' && (r.n.kind === 'group' || isRoot(r.n) || r.n.kind === 'item')) return;
    if (mode === 'value' && r.n.shape !== 'scalar') return;
    editing = { id, mode };
    focused = id;
    paint();
  }
  function endEdit(refocus = true) { editing = undefined; paint(); if (refocus) setFocus(focused); }

  function nameInput(n: OutlineNode, ed: Editing): HTMLElement {
    const now = ed.mode === 'new' ? String(ed.value ?? '') : String(n.path[n.path.length - 1]);
    const inp = h('input', { class: 'tedit tname', value: now, 'aria-label': ed.mode === 'new' ? `Name of the new ${ed.section ? kindOf(ed.section).singular : 'entry'}` : `Rename ${n.label}`, spellcheck: 'false', autocomplete: 'off' });
    inp.value = now;
    const check = () => {
      const v = inp.value.trim();
      const needsName = ed.mode === 'new' || isResource(n) || inGroup(n.path);
      const bad = !v ? 'a name is needed' : needsName && !K.nameRule.test(v) ? ui.nameHint : v !== now && taken(ed.mode === 'new' ? ed.mapPath : n.path.slice(0, -1), v, needsName) ? `"${v}" is already used` : '';
      inp.setAttribute('aria-invalid', String(!!bad));
      inp.title = bad;
      return bad ? undefined : v;
    };
    inp.addEventListener('input', check);
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); endEdit(); }
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
    });
    let done = false;
    const commit = () => {
      if (done) return;
      const v = check();
      if (v === undefined) { if (!inp.value.trim()) { done = true; endEdit(); } return; }
      done = true;
      editing = undefined;
      if (ed.mode === 'new') {
        const p = [...ed.mapPath, v];
        if (run(insertCmd(ed.mapPath, v, ed.template(), { label: `Add ${ed.section ? kindOf(ed.section).singular : 'entry'} ${v}` }))) { focused = toPointer(p); doc.select([p], 'tree'); expanded.add(focused); }
      } else if (v !== now) {
        const p = n.path;
        if (run(isResource(n) ? renameCmd(p, v) : renameKeyCmd(p, v))) {
          const np = [...p.slice(0, -1), v];
          if (expanded.has(n.id)) { expanded.delete(n.id); expanded.add(toPointer(np)); }
          focused = toPointer(np);
        }
      }
      paint(); setFocus(focused);
    };
    inp.addEventListener('blur', () => { if (!done) { if (inp.value.trim() && check() !== undefined) commit(); else { done = true; editing = undefined; paint(); } } });
    return inp;
  }

  function taken(mapPath: Path, v: string, oneNamespace: boolean): boolean {
    if (oneNamespace && !isGroupPath(mapPath)) return K.kinds.some(k => namesIn(k.kind).includes(v));
    const m = getIn(doc.goodDoc.data, mapPath);
    return !!m && typeof m === 'object' && v in (m as object);
  }

  function valueInput(n: OutlineNode): HTMLElement {
    const nav = opts.nav();
    const now = getIn(doc.goodDoc.data, n.path);
    const vals = nav.values(n.path);
    const slot = K.slotAt(toPointer(n.path));
    const refNames = slot ? slot.targets.flatMap(s => namesIn(s).map(x => (slot.write ? slot.write(x) : x))).concat(slot.extra ?? []) : [];
    const choices = [...new Set([...vals, ...refNames])];
    let el2: HTMLInputElement | HTMLSelectElement;
    if (choices.length && (vals.length || slot)) {
      el2 = h('select', { class: 'tedit tvalue', 'aria-label': `Value of ${n.label}` }, ...choices.map(v => h('option', { value: v }, v)));
      if (!choices.includes(String(now))) el2.prepend(h('option', { value: String(now ?? '') }, String(now ?? '')));
      el2.value = String(now ?? '');
      el2.addEventListener('change', () => commitValue(n, el2.value));
    } else {
      el2 = h('input', { class: 'tedit tvalue', 'aria-label': `Value of ${n.label}`, spellcheck: 'false', autocomplete: 'off' });
      el2.value = now === null || now === undefined ? '' : String(now);
    }
    el2.addEventListener('keydown', e => {
      e.stopPropagation();
      if ((e as KeyboardEvent).key === 'Escape') { e.preventDefault(); endEdit(); }
      if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); commitValue(n, el2.value); }
    });
    el2.addEventListener('blur', () => { if (editing?.id === n.id) commitValue(n, el2.value, false); });
    return el2;
  }
  function commitValue(n: OutlineNode, raw: string, refocus = true) {
    if (editing?.id !== n.id) return;
    editing = undefined;
    const types = opts.nav().types(n.path);
    const now = getIn(doc.goodDoc.data, n.path);
    let v: unknown = raw;
    if ((types.has('integer') || types.has('number') || typeof now === 'number') && /^-?\d+(\.\d+)?$/.test(raw.trim())) v = Number(raw);
    else if ((types.has('boolean') || typeof now === 'boolean') && /^(true|false)$/.test(raw.trim())) v = raw.trim() === 'true';
    if (v !== now) run(setCmd(n.path, v));
    paint();
    if (refocus) setFocus(focused);
  }

  // ---------- delete and duplicate ----------
  async function remove(ids: string[]) {
    if (readOnly() || !ids.length) return;
    const nodes = ids.map(id => byId.get(id)?.n).filter((n): n is OutlineNode => !!n && !isRoot(n) && n.shape !== 'missing');
    // a node inside another being deleted goes with it
    const top = nodes.filter(n => !nodes.some(o => o !== n && o.path.length < n.path.length && isPrefix(o.path, n.path)));
    if (!top.length) return;
    let withRefs = false;
    const refs = top.filter(isResource).flatMap(n => referencesTo(doc.text, n.section!, String(n.path[n.path.length - 1])).filter(r => !top.some(o => isPrefix(o.path, fromPointer(r.path)))).map(r => ({ n, r })));
    if (refs.length) {
      const list = h('ul', { class: 'ref-list' }, ...refs.map(({ n, r }) => h('li', null, h('code', null, r.path.slice(1).replace(/\//g, '.')), ` — ${r.slot.what} (${n.label})`)));
      const what = top.length === 1 ? describe(top[0].path) : `${top.length} items`;
      const choice = await ask(`Delete ${what}?`, [h('p', { class: 'sub' }, `${refs.length === 1 ? 'One place refers' : `${refs.length} places refer`} to ${top.length === 1 ? 'it' : 'them'}:`), list,
        h('p', { class: 'sub' }, 'Delete the references too, or leave them (the problems list will show them). Either way, Undo brings everything back.')],
        [{ label: 'Cancel', value: 'cancel' }, { label: 'Delete only', value: 'only', danger: true }, { label: 'Delete with references', value: 'with', danger: true, primary: true }]);
      if (!choice) { setFocus(focused); return; }
      withRefs = choice === 'with';
    }
    // list items last index first, so the paths stay right; then the rest
    const order = [...top].sort((a, b) => (typeof a.path.at(-1) === 'number' && typeof b.path.at(-1) === 'number' ? (b.path.at(-1) as number) - (a.path.at(-1) as number) : 0));
    const cmds = order.map(n => deleteCmd(n.path, { withRefs: withRefs && isResource(n) }));
    const ix = rows.findIndex(r => r.n.id === top[0].id);
    const next = rows[ix + 1]?.n.id && !top.some(t => rows[ix + 1].n.id.startsWith(t.id)) ? rows[ix + 1].n.id : rows[ix - 1]?.n.id ?? '';
    const ok = run(cmds.length === 1 ? cmds[0] : composite(`Delete ${top.length} items`, cmds));
    if (ok) { focused = next; doc.select(next ? [fromPointer(next)] : [], 'tree'); paint(); setFocus(focused); }
  }

  function composite(label: string, cmds: Command[]): Command {
    return {
      label,
      remap: p => cmds.reduce<Path | null>((x, c) => (x && c.remap ? c.remap(x) : x), p),
      build: t => {
        const steps = [];
        let fallback = false;
        for (const c of cmds) { const s = c.build(t); for (const st of s.steps) { steps.push(st); t = applyStep(t, st); } fallback ||= !!s.fallback; }
        return { steps, fallback };
      },
    };
  }

  function duplicate(id: string) {
    const n = byId.get(id)?.n;
    if (!n || readOnly()) return;
    if (!isResource(n)) { opts.note(ui.text.duplicateNote, 'info'); return; }
    const c = duplicateCmd(n.path);
    if (run(c)) { const sel = c.select?.[0]; if (sel) { focused = toPointer(sel); doc.select([sel], 'tree'); } paint(); setFocus(focused); }
  }

  // ---------- the menu ----------
  function menuFor(n: OutlineNode, at: { x: number; y: number } | HTMLElement) {
    const ids = selected().has(n.id) ? [...selected()] : [n.id];
    const many = ids.length > 1;
    const adds = addItems(n);
    const ro = readOnly();
    const items: MenuItem[] = [];
    if (adds.length && !many) items.push({ heading: 'Add' }, ...adds.slice(0, 12), ...(adds.length > 12 ? [{ label: 'More…', icon: 'plus' as IconName, onSelect: () => openMenu(adds, at, 'Add') }] : []), { sep: true });
    if (!many) {
      items.push({ label: 'Rename', icon: 'pencil', keys: 'F2', disabled: ro || n.kind === 'group' || isRoot(n) || n.kind === 'item', why: ui.text.renameWhy, onSelect: () => startEdit(n.id, 'rename') });
      if (n.shape === 'scalar') items.push({ label: 'Edit value', icon: 'pencil', keys: 'Enter', disabled: ro, onSelect: () => startEdit(n.id, 'value') });
      items.push({ label: 'Duplicate', icon: 'copy', keys: '⌘D', disabled: ro || !isResource(n), why: ui.text.duplicateWhy, onSelect: () => duplicate(n.id) });
    }
    if (n.path.length) items.push({ label: 'Select parent', icon: 'arrow-up-right', keys: '⌘↑', onSelect: () => selectParent() });
    items.push({ label: 'Show in text', icon: 'code-xml', onSelect: () => opts.showInText(n.path) });
    if (opts.clipItems) items.push({ sep: true }, ...opts.clipItems());
    items.push({ sep: true }, { label: many ? `Delete ${ids.length} items` : 'Delete', icon: 'trash-2', keys: '⌫', danger: true, disabled: ro || isRoot(n) || n.shape === 'missing', why: isRoot(n) ? ui.text.deleteWhy : 'Nothing to delete', onSelect: () => remove(ids) });
    openMenu(items, at, `${n.label || ui.text.root} actions`);
  }

  function selectParent() {
    const ps = doc.selection.length ? doc.selection : [fromPointer(focused)];
    const up = [...new Set(ps.map(p => {
      // a resource's parent is its group; anything else its nearest row
      let q = p.slice(0, -1);
      while (q.length && !byId.has(toPointer(q))) q = q.slice(0, -1);
      return toPointer(q);
    }))];
    selectIds(up);
  }

  // ---------- events ----------
  el.addEventListener('click', e => {
    const r = (e.target as HTMLElement).closest<HTMLElement>('.trow');
    if (!r || (e.target as HTMLElement).closest('.tedit')) return;
    clickSelect(r.dataset.id!, e);
  });
  el.addEventListener('dblclick', e => {
    const r = (e.target as HTMLElement).closest<HTMLElement>('.trow');
    if (!r || (e.target as HTMLElement).closest('.tedit, .twisty, .tadd')) return;
    const n = byId.get(r.dataset.id!)?.n;
    if (!n) return;
    if (n.shape === 'scalar' && (e.target as HTMLElement).closest('.tval')) startEdit(n.id, 'value');
    else if (n.kind === 'resource' || n.kind === 'key') startEdit(n.id, 'rename');
    else toggle(n.id);
  });
  el.addEventListener('contextmenu', e => {
    const r = (e.target as HTMLElement).closest<HTMLElement>('.trow');
    if (!r) return;
    e.preventDefault();
    const id = r.dataset.id!;
    if (!selected().has(id)) clickSelect(id, { shiftKey: false, metaKey: false, ctrlKey: false });
    const n = byId.get(id)?.n;
    if (n) menuFor(n, { x: e.clientX, y: e.clientY });
  });
  el.addEventListener('focusin', e => {
    const r = (e.target as HTMLElement).closest<HTMLElement>('.trow');
    if (r && !(e.target as HTMLElement).closest('.tedit')) focused = r.dataset.id!;
  });
  el.addEventListener('keydown', e => {
    if ((e.target as HTMLElement).closest('.tedit')) return;
    const ids = rows.map(r => r.n.id);
    const i = Math.max(0, ids.indexOf(focused));
    const cur = byId.get(focused);
    const n = cur?.n;
    const mod = e.metaKey || e.ctrlKey;
    const go = (j: number) => {
      const id = ids[Math.max(0, Math.min(ids.length - 1, j))];
      if (e.shiftKey) { if (!anchor) anchor = focused; clickSelect(id, { shiftKey: true, metaKey: false, ctrlKey: false }); }
      else { anchor = id; selectIds([id]); }
    };
    switch (e.key) {
      case 'ArrowDown': if (mod) return; go(i + 1); break;
      case 'ArrowUp': if (mod) { selectParent(); break; } go(i - 1); break;
      case 'Home': go(0); break;
      case 'End': go(ids.length - 1); break;
      case 'ArrowRight':
        if (n && n.children.length && !expanded.has(n.id)) toggle(n.id, true);
        else if (n && n.children.length) go(i + 1);
        break;
      case 'ArrowLeft':
        if (n && expanded.has(n.id) && n.children.length) toggle(n.id, false);
        else if (cur?.parent) { anchor = cur.parent.id; selectIds([cur.parent.id]); }
        break;
      case 'Enter':
        if (!n) return;
        if (n.shape === 'scalar' && n.kind !== 'group') {
          const now = getIn(doc.goodDoc.data, n.path);
          if (typeof now === 'boolean' && !readOnly()) run(setCmd(n.path, !now));
          else startEdit(n.id, 'value');
        } else if (n.children.length) toggle(n.id);
        break;
      case 'F2': if (n) startEdit(n.id, 'rename'); break;
      case 'Delete': case 'Backspace': remove(doc.selection.length ? doc.selection.map(toPointer) : [focused]); break;
      case 'ContextMenu': if (n) menuFor(n, el.querySelector<HTMLElement>(`[data-id="${CSS.escape(focused)}"]`)!); break;
      case 'F10': if (e.shiftKey && n) menuFor(n, el.querySelector<HTMLElement>(`[data-id="${CSS.escape(focused)}"]`)!); else return; break;
      case '+': case 'Insert': if (n && addItems(n).length) openMenu(addItems(n), el.querySelector<HTMLElement>(`[data-id="${CSS.escape(focused)}"]`)!, 'Add'); break;
      default:
        if (mod && e.key.toLowerCase() === 'd') { duplicate(focused); break; }
        if (mod && e.key.toLowerCase() === 'a') { selectIds(ids.filter(x => x), focused); break; }
        if (e.key.length === 1 && !mod && /\S/.test(e.key)) {
          // type-ahead: jump to the next row whose label starts with what was typed
          const t = Date.now();
          typeahead = t - typeaheadAt > 700 ? e.key.toLowerCase() : typeahead + e.key.toLowerCase();
          typeaheadAt = t;
          const order = [...ids.slice(i + (typeahead.length === 1 ? 1 : 0)), ...ids.slice(0, i + 1)];
          const hit = order.find(id => (byId.get(id)?.n.label ?? '').toLowerCase().startsWith(typeahead));
          if (hit !== undefined) { anchor = hit; selectIds([hit]); }
          break;
        }
        return;
    }
    e.preventDefault();
  });

  // ---------- drag to reorder (within a map, or a list) ----------
  let dragId: string | undefined;
  el.addEventListener('dragstart', e => {
    const r = (e.target as HTMLElement).closest<HTMLElement>('.trow');
    if (!r) return;
    dragId = r.dataset.id;
    e.dataTransfer?.setData('text/plain', fromPointer(dragId!).join('.'));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  const target = (e: DragEvent) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>('.trow');
    if (!r || !dragId || r.dataset.id === dragId) return undefined;
    const a = byId.get(dragId)?.n, b = byId.get(r.dataset.id!)?.n;
    if (!a || !b || toPointer(a.path.slice(0, -1)) !== toPointer(b.path.slice(0, -1))) return undefined;
    const box = r.getBoundingClientRect();
    return { r, a, b, after: e.clientY > box.top + box.height / 2 };
  };
  el.addEventListener('dragover', e => {
    for (const x of el.querySelectorAll('.drop-before, .drop-after')) x.classList.remove('drop-before', 'drop-after');
    const t = target(e);
    if (!t) return;
    e.preventDefault();
    t.r.classList.add(t.after ? 'drop-after' : 'drop-before');
  });
  el.addEventListener('dragleave', e => { if (e.target === el) for (const x of el.querySelectorAll('.drop-before, .drop-after')) x.classList.remove('drop-before', 'drop-after'); });
  el.addEventListener('drop', e => {
    const t = target(e);
    for (const x of el.querySelectorAll('.drop-before, .drop-after')) x.classList.remove('drop-before', 'drop-after');
    dragId = undefined;
    if (!t) return;
    e.preventDefault();
    const { a, b, after } = t;
    const parent = a.path.slice(0, -1);
    const last = (p: Path) => p[p.length - 1];
    if (typeof last(a.path) === 'number') {
      const from = last(a.path) as number;
      let to = (last(b.path) as number) + (after ? 1 : 0);
      if (to > from) to -= 1;
      if (run(moveItemCmd(parent, from, to))) { focused = toPointer([...parent, to]); doc.select([[...parent, to]], 'tree'); }
    } else {
      const sibs = (byId.get(toPointer(parent))?.n.children ?? []).map(c => String(last(c.path)));
      const bi = sibs.indexOf(String(last(b.path)));
      const before = after ? sibs[bi + 1] : sibs[bi];
      if (before !== String(last(a.path))) run(moveCmd(a.path, before === undefined ? undefined : before));
      focused = a.id;
    }
    paint(); setFocus(focused);
  });

  // ---------- the model ----------
  doc.on(c => {
    if (c.remap) {
      for (const id of [...expanded]) { const p = c.remap(fromPointer(id)); if (p && toPointer(p) !== id) { expanded.delete(id); expanded.add(toPointer(p)); } }
      const f = c.remap(fromPointer(focused)); if (f) focused = toPointer(f);
    }
    if (c.kind === 'load') { editing = undefined; focused = ''; }
    // typing: once it pauses (a keystroke never waits on the tree); everything else at once
    if (isTyping(c)) paintLater(); else paintLater.now();
  });
  const paintLater = later(() => paint());
  doc.onSelect(c => { if (c.origin !== 'tree') reveal(c.paths); else paint(); });

  paint();
  return {
    paint,
    dispose: () => paintLater.cancel(),
    focus: () => setFocus(focused),
    /** for the tests */
    rows: () => rows.map(r => ({ id: r.n.id, label: r.n.label, depth: r.depth, kind: r.n.kind, value: r.n.value, lifetime: r.n.lifetime })),
    startEdit, remove, duplicate, expand: (id: string) => toggle(id, true),
  };
}

