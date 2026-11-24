// The properties panel: a form, generated from the schema, for what is selected. One object (or a key inside one):
// each key the schema allows there, written or not. Several objects of one kind: their common keys, where an edit
// applies to all of them as one command. Enums and references are pickers; lists of references are chips; a long text
// is a text area; anything more structured is edited as YAML. Keys an object inherits (the kit says which, and from
// where) show greyed with where they come from: "Override" writes them here, "Reset" removes this file's own value so
// the inherited one applies again.

import { later, isTyping } from './later.ts';
import { parse as parseYaml } from 'yaml';
import { h, icon } from './icons.ts';
import type { EditorModel, Command } from '../model.ts';
import type { SchemaNav, KeyInfo } from '../schema-nav.ts';
import type { Problem } from '../validate.ts';
import type { Commands } from '../commands.ts';
import type { ObjectKindInfo, ObjectRef, RefSlot } from '../adapter.ts';
import { composite, run, type Actions } from './actions.ts';
import { flowText } from '../splice.ts';
import { fromPointer, toPointer, type Path } from '../path.ts';

/** what the panel shows of the domain */
export interface PropsUi {
  /** keys worth showing even when unset */
  important(kind: string, value: Record<string, unknown>, external: boolean): string[];
  /** an object that exists elsewhere (only its reference keys apply) */
  isExternal(value: unknown): boolean;
  /** a key one object inherits (its value, and where from), given the domain's reading; and every key it inherits */
  inherited?(path: Path, key: string, read: unknown): { value: unknown; from?: string } | undefined;
  inheritedKeys?(path: Path, read: unknown): string[];
  /** where inherited values come from, when the reading doesn't say */
  inheritedFrom: string;
  /** what is true now about an object, as rows (undefined: not shown; empty: not known) */
  facts?(now: unknown): { term: string; def: string; cls?: string }[] | undefined;
  /** an x- key's words */
  extensionDoc: string;
  /** the root's title, and its words in a list */
  rootTitle: string; rootItem: string;
}
/** what the panel is given of the domain */
export interface PropsKit {
  commands: Pick<Commands, 'setCmd' | 'deleteCmd' | 'insertItemCmd' | 'referencesTo' | 'describe'>;
  actions: Pick<Actions, 'deletePaths' | 'rename'>;
  slotAt(ptr: string): RefSlot | undefined;
  objectOf(ptr: string): ObjectRef | undefined;
  kinds: ObjectKindInfo[];
  ui: PropsUi;
}

type Raw = Record<string, unknown>;
const getIn = (o: unknown, p: Path) => p.reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Raw)[k as string] : undefined), o);
const isMap = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const MIXED = Symbol('mixed');

export interface PropsOpts {
  kit: PropsKit;
  nav(): SchemaNav;
  problems(): Problem[];
  /** the domain's reading of the file (the kit's inherited() reads it) */
  read(): unknown;
  note(t: string, tone?: 'info' | 'warn' | 'bad'): void;
  showInText(p: Path): void;
  /** while the host's state is shown, what is true now about an object (the kit's facts() reads it); undefined while not */
  now?(ptr: string): unknown;
}

export function propsPanel(body: HTMLElement, doc: EditorModel, opts: PropsOpts) {
  let pendingFocus: string | undefined;
  let focusInput = false;
  const K = opts.kit, ui = K.ui;
  const { setCmd, deleteCmd, insertItemCmd, referencesTo, describe } = K.commands;
  const { deletePaths, rename } = K.actions;
  const kindOf = (k: string) => K.kinds.find(x => x.kind === k);
  const singular = (k: string) => kindOf(k)?.singular ?? 'item';

  const names = (s: string) => Object.keys((getIn(doc.goodDoc.data, kindOf(s)?.section ?? []) ?? {}) as Raw).filter(k => !k.startsWith('x-'));
  const apply = (c: Command) => run(doc, c, 'props', opts.note);

  function paint() {
    // never repaint under a field being typed in; it repaints when the field is left
    if (body.contains(document.activeElement) && (document.activeElement as HTMLElement).matches('input, textarea')) return;
    body.replaceChildren();
    const sel = doc.selection;
    if (!sel.length) { body.append(h('p', { class: 'hint' }, 'Select something in the canvas, the tree or the text.')); return; }
    const res = sel.map(p => K.objectOf(toPointer(p)));
    // several: their common keys, if they are all resources of one kind
    if (sel.length > 1) {
      const kinds = new Set(res.map(r => r?.kind));
      if (kinds.size === 1 && res.every(r => r && r.path === toPointer(fromPointer(r.path)))) {
        const paths = [...new Set(res.map(r => r!.path))].map(fromPointer);
        body.append(h('div', { class: 'sel-title' }, `${paths.length} ${singular(res[0]!.kind)}s`), h('div', { class: 'sel-path' }, paths.map(p => p[p.length - 1]).join(', ')));
        form(paths, res[0]!.kind);
      } else {
        body.append(h('div', { class: 'sel-title' }, `${sel.length} items`), h('ul', { class: 'plain' }, ...sel.map(p => h('li', null, h('code', null, p.join('.') || ui.rootItem)))));
      }
      deleteButton();
      return;
    }
    const p = sel[0];
    const r = res[0];
    const target = r ? fromPointer(r.path) : p.length ? p : [];
    // the root, a section, or a setting outside objects: its own keys
    if (!r) { settings(p); return; }
    const head = h('div', { class: 'sel-headrow' }, h('div', { class: 'sel-title' }, describe(target)));
    const rn = h('button', { type: 'button', class: 'btn sm quiet icon-only', 'aria-label': `Rename ${describe(target)}`, title: 'Rename (F2)' }, icon('pencil'));
    rn.addEventListener('click', () => void rename(doc, target, 'props', opts.note, { over: true, place: () => (head.isConnected ? head.firstElementChild!.getBoundingClientRect() : undefined) }));
    head.append(rn);
    body.append(head);
    if (toPointer(p) !== r.path) pendingFocus = toPointer(p);
    form([target], r.kind);
    uses(r.kind, r.name);
    problemsFor(r.path);
    deleteButton();
  }

  /** the form for one or more objects of a kind */
  function form(paths: Path[], section: string) {
    const nav = opts.nav();
    const data = doc.goodDoc.data;
    const values = paths.map(p => (getIn(data, p) ?? {}) as Raw);
    const present = values[0] && isMap(values[0]) ? values[0] : {};
    const ext = values.some(v => ui.isExternal(v));
    // the keys: the schema's for this kind (only what fits beside external:, or not), written ones first
    const keys = nav.keys(paths[0], ext ? { external: true } : present);
    // written keys in the file's order (of the first selected), then the rest in the schema's
    const order = Object.keys(present);
    const written = keys.filter(k => values.some(v => isMap(v) && k.name in v)).sort((a, b) => (order.indexOf(a.name) + 1 || 999) - (order.indexOf(b.name) + 1 || 999));
    const read = opts.read();
    // shown: what is written, what matters even when unset, and what it inherits; the rest is one click away
    const shown = new Set([...written.map(k => k.name), ...ui.important(section, values[0] ?? {}, ext), ...(paths.length === 1 && read !== undefined && ui.inheritedKeys ? ui.inheritedKeys(paths[0], read) : [])]);
    const rest = keys.filter(k => !written.includes(k) && shown.has(k.name));
    const more = keys.filter(k => !shown.has(k.name));
    const sec = h('div', { class: 'props' });
    for (const k of [...written, ...rest]) sec.append(field(paths, section, k, values, read));
    if (more.length && doc.doc.ok) {
      const add = h('select', { class: 'padd', 'aria-label': 'Add a property' }, h('option', { value: '' }, '+ Add property'), ...more.map(k => h('option', { value: k.name, title: (k.doc ?? '').replace(/`/g, '') }, k.name)));
      add.addEventListener('change', () => {
        const name = add.value;
        if (!name) return;
        const v = nav.defaultFor([...paths[0], name]);
        pendingFocus = toPointer([...paths[0], name]);
        focusInput = true;
        apply(paths.length === 1 ? setCmd([...paths[0], name], v, `Add ${describe([...paths[0], name])}`) : composite(`Add ${name} to ${paths.length} ${singular(section)}s`, paths.map(p => setCmd([...p, name], v))));
      });
      sec.append(add);
    }
    // keys written that the schema doesn't know (x-*, typos): shown, editable as YAML
    const known = new Set(keys.map(k => k.name));
    for (const name of new Set(values.flatMap(v => (isMap(v) ? Object.keys(v) : [])))) {
      if (!known.has(name)) sec.append(field(paths, section, { name, shape: 'scalar', enumValues: [], examples: [], doc: name.startsWith('x-') ? ui.extensionDoc : 'Not a key the schema knows.' }, values, read));
    }
    body.append(sec);
    if (pendingFocus) {
      const f = sec.querySelector<HTMLElement>(`[data-path="${CSS.escape(pendingFocus)}"]`);
      f?.classList.add('focus-row');
      f?.scrollIntoView({ block: 'nearest' });
      // the field takes the focus only after an add or an override here, never because something else selected it
      if (focusInput) (f?.querySelector('input, select, textarea') as HTMLElement | null)?.focus({ preventScroll: true });
      pendingFocus = undefined;
      focusInput = false;
    }
  }

  function field(paths: Path[], section: string, k: KeyInfo, values: Raw[], read: unknown): HTMLElement {
    const nav = opts.nav();
    const own = values.map(v => (isMap(v) ? v[k.name] : undefined));
    const same = own.every(x => JSON.stringify(x) === JSON.stringify(own[0]));
    const value: unknown = same ? own[0] : MIXED;
    const isWritten = own.some(x => x !== undefined);
    // inherited (the kit says), with where it comes from
    const inherited = section && paths.length === 1 && read !== undefined ? ui.inherited?.(paths[0], k.name, read) : undefined;
    const ptrs = paths.map(p => toPointer([...p, k.name]));
    const row = h('div', { class: `prow${isWritten ? '' : ' unset'}`, 'data-path': ptrs[0] });
    const label = h('label', { class: 'plabel', title: k.doc?.replace(/`/g, '') ?? '' }, k.name);
    const id = `pf-${Math.random().toString(36).slice(2, 8)}`;
    label.setAttribute('for', id);
    row.append(label);
    const set = (v: unknown, lbl?: string) => apply(paths.length === 1 ? setCmd([...paths[0], k.name], v, lbl) : composite(lbl ?? `Set ${k.name} on ${paths.length} ${singular(section)}s`, paths.map(p => setCmd([...p, k.name], v))));
    const unset = () => {
      const ps = paths.filter((_, i) => own[i] !== undefined);
      apply(ps.length === 1 ? { ...deleteCmd([...ps[0], k.name]), label: `Remove ${describe([...ps[0], k.name])}` } : composite(`Remove ${k.name} from ${ps.length} ${singular(section)}s`, ps.map(p => deleteCmd([...p, k.name]))));
    };
    const slot = K.slotAt(toPointer([...paths[0], k.name]));
    const itemSlot = K.slotAt(toPointer([...paths[0], k.name, 0]));
    const vals = nav.values([...paths[0], k.name]);
    const types = nav.types([...paths[0], k.name]);
    let control: HTMLElement;
    const placeholder = value === MIXED ? '(mixed)' : '';

    if (slot || vals.length) {
      // a picker: the allowed values, or the declared names
      const choices = [...new Set([...vals, ...(slot ? slot.targets.flatMap(s => names(s).map(n => (slot.write ? slot.write(n) : n))).concat(slot.extra ?? []) : [])])];
      const sel = h('select', { id, class: 'pinput' });
      sel.append(h('option', { value: '\u0000' }, placeholder || '—'));
      for (const c of choices) sel.append(h('option', { value: c }, c));
      if (value !== MIXED && value !== undefined && !choices.includes(String(value))) sel.append(h('option', { value: String(value) }, String(value)));
      sel.value = value === MIXED || value === undefined ? '\u0000' : String(value);
      sel.addEventListener('change', () => {
        if (sel.value === '\u0000') { if (isWritten) unset(); return; }
        set(vals.includes('true') && (sel.value === 'true' || sel.value === 'false') ? sel.value === 'true' : sel.value);
      });
      control = sel;
    } else if (itemSlot && paths.length === 1) {
      // a list of names: chips, and a picker to add one
      const list = Array.isArray(value) ? (value as string[]) : [];
      const wrap = h('div', { class: 'chips' });
      list.forEach((v, i) => {
        const x = h('button', { type: 'button', class: 'chip-x', 'aria-label': `Remove ${v}` }, '×');
        x.addEventListener('click', () => apply({ ...deleteCmd([...paths[0], k.name, i]), label: `Remove ${v} from ${describe([...paths[0], k.name])}` }));
        wrap.append(h('span', { class: 'chip' }, String(v), x));
      });
      const can = [...new Set(itemSlot.targets.flatMap(s => names(s)).concat(itemSlot.extra ?? []))].filter(n => !list.includes(n));
      if (can.length) {
        const add = h('select', { id, class: 'pinput chip-add', 'aria-label': `Add to ${k.name}` }, h('option', { value: '' }, '+ add'), ...can.map(n => h('option', { value: n }, n)));
        add.addEventListener('change', () => { if (add.value) apply(insertItemCmd([...paths[0], k.name], add.value, undefined, `Add ${add.value} to ${describe([...paths[0], k.name])}`)); });
        wrap.append(add);
      }
      control = wrap;
    } else if (k.name === 'prompt' || (typeof value === 'string' && value.includes('\n'))) {
      const ta = h('textarea', { id, class: 'pinput', rows: '5', spellcheck: 'false', placeholder });
      ta.value = typeof value === 'string' ? value : '';
      ta.addEventListener('change', () => { const v = ta.value; if (v === '' && isWritten) unset(); else if (v !== value) set(v.endsWith('\n') || !v.includes('\n') ? v : v + '\n'); });
      control = ta;
    } else if (k.shape === 'scalar' && (value === undefined || value === MIXED || typeof value !== 'object')) {
      const inp = h('input', { id, class: 'pinput', type: types.has('integer') || types.has('number') ? 'number' : 'text', spellcheck: 'false', autocomplete: 'off', placeholder });
      inp.value = value === undefined || value === MIXED ? '' : String(value);
      inp.addEventListener('change', () => {
        const raw = inp.value;
        if (raw === '') { if (isWritten) unset(); return; }
        const v = (types.has('integer') || types.has('number')) && /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
        if (v !== value) set(v);
      });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
      control = inp;
    } else {
      // a map or a list: as YAML, in flow style
      const inp = h('input', { id, class: 'pinput mono', spellcheck: 'false', autocomplete: 'off', placeholder: placeholder || (k.shape === 'list' ? '[a, b]' : '{ key: value }') });
      inp.value = value === undefined || value === MIXED ? '' : flowText(value);
      inp.addEventListener('change', () => {
        if (inp.value.trim() === '') { if (isWritten) unset(); return; }
        let v: unknown;
        try { v = parseYaml(inp.value); } catch (e) { inp.setAttribute('aria-invalid', 'true'); inp.title = `Not YAML: ${(e as Error).message}`; return; }
        inp.removeAttribute('aria-invalid');
        if (JSON.stringify(v) !== JSON.stringify(value)) set(v);
      });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
      control = inp;
    }
    // the full value as a tooltip (a field can be narrower than its value)
    const full = value === undefined || value === MIXED ? '' : display(value);
    if (full) control.title = full;
    if (inherited && !isWritten) {
      // inherited and not written here: the value in full, greyed, where it comes from, and Override on its own line
      row.classList.add('inherited');
      row.append(h('div', { class: 'pinherit', title: display(inherited.value) }, display(inherited.value)));
      const line = h('div', { class: 'pfrom' }, `inherited from ${inherited.from ?? ui.inheritedFrom}`);
      const o = h('button', { type: 'button', class: 'btn sm quiet poverride', title: `Write ${k.name}: ${display(inherited.value)} in this file, to change it here` }, 'Override');
      o.addEventListener('click', () => { pendingFocus = ptrs[0]; focusInput = true; set(inherited!.value, `Override ${describe([...paths[0], k.name])}`); });
      row.append(line, o);
      const probs0 = opts.problems().filter(pr => ptrs.some(ptr => pr.path === ptr || pr.path.startsWith(ptr + '/')));
      for (const pr of probs0) row.append(h('div', { class: `pprob ${pr.severity}` }, icon(pr.severity === 'error' ? 'circle-x' : 'triangle-alert'), pr.message));
      return row;
    }
    row.append(control);
    const acts = h('span', { class: 'pacts' });
    if (inherited && isWritten) {
      const o = h('button', { type: 'button', class: 'btn sm quiet', title: `Remove this file's value: ${display(inherited.value)} applies again` }, 'Reset');
      o.addEventListener('click', unset);
      acts.append(o);
    } else if (isWritten && control.tagName !== 'SELECT') {
      const o = h('button', { type: 'button', class: 'btn sm quiet icon-only', 'aria-label': `Remove ${k.name}`, title: `Remove ${k.name}` }, icon('x'));
      o.addEventListener('click', unset);
      acts.append(o);
    }
    row.append(acts);
    if (inherited) row.append(h('div', { class: 'pfrom' }, `overrides ${display(inherited.value)} from ${inherited.from ?? ui.inheritedFrom}`));
    const probs = opts.problems().filter(pr => ptrs.some(ptr => pr.path === ptr || pr.path.startsWith(ptr + '/')));
    for (const pr of probs) row.append(h('div', { class: `pprob ${pr.severity}` }, icon(pr.severity === 'error' ? 'circle-x' : 'triangle-alert'), pr.message));
    return row;
  }
  const display = (v: unknown) => (v === null || typeof v !== 'object' ? String(v) : flowText(v));

  /** Now, read-only: what the host says is true about it (its state shown) */
  function nowSection(ptr: string) {
    const rows = opts.now && ui.facts ? ui.facts(opts.now(ptr)) : undefined;
    if (!rows) return;
    body.append(h('div', { class: 'sel-head' }, 'Now'));
    if (!rows.length) { body.append(h('p', { class: 'hint now-unknown' }, 'Not known: the host has said nothing about it.')); return; }
    const dl = h('dl', { class: 'now' });
    for (const r of rows) dl.append(h('dt', null, r.term), h('dd', r.cls ? { class: r.cls } : null, r.def));
    body.append(dl);
  }

  function uses(section: string, name: string) {
    nowSection(toPointer([...(kindOf(section)?.section ?? []), name]));
    const refs = referencesTo(doc.text, section, name);
    body.append(h('div', { class: 'sel-head' }, refs.length ? `Used in ${refs.length} place${refs.length > 1 ? 's' : ''}` : 'Not referenced'));
    if (!refs.length) return;
    const ul = h('ul', { class: 'plain sel-refs' });
    for (const r of refs) {
      const b = h('button', { type: 'button', class: 'linkish' }, r.path.slice(1).replace(/\//g, '.'));
      b.addEventListener('click', () => doc.select([fromPointer(r.path)], 'props'));
      ul.append(h('li', null, b, h('span', { class: 'hint' }, ` ${r.slot.what}`)));
    }
    body.append(ul);
  }
  function problemsFor(ptr: string) {
    const mine = opts.problems().filter(x => x.path === ptr && !x.file);
    if (mine.length) body.append(h('div', { class: 'sel-head' }, 'Problems'), ...mine.map(x => h('div', { class: `sel-prob ${x.severity}` }, icon(x.severity === 'error' ? 'circle-x' : 'triangle-alert'), h('span', null, x.message))));
  }
  function deleteButton() {
    if (!doc.doc.ok || !doc.selection.some(p => p.length)) return;
    const b = h('button', { type: 'button', class: 'btn sm danger props-delete' }, icon('trash-2'), doc.selection.length > 1 ? `Delete ${doc.selection.length} items` : 'Delete');
    b.addEventListener('click', () => deletePaths(doc, doc.selection, 'props', opts.note));
    body.append(b);
  }

  /** a setting of the file (or a section): its value, its words, and its own keys as a form */
  function settings(p: Path) {
    const nav = opts.nav();
    body.append(h('div', { class: 'sel-title' }, p.length ? describe(p) : ui.rootTitle), h('code', { class: 'sel-path' }, p.join('.') || '(the whole file)'));
    const words = nav.hover(p);
    if (words && p.length) body.append(h('p', { class: 'sel-doc' }, words.split('\n\n')[0].replace(/`/g, '')));
    const v = getIn(doc.goodDoc.data, p);
    const isSection = K.kinds.some(k => toPointer(k.section) === toPointer(p));
    if (isSection) {
      const n = isMap(v) ? Object.keys(v).length : 0;
      body.append(h('p', null, `${n} ${n === 1 ? 'entry' : 'entries'}. Add one from the tree's +, or the canvas's menu.`));
      return;
    }
    // the file's own settings, or a top-level map: its keys
    const holder = !p.length ? [] : isMap(v) ? p : p.slice(0, -1);
    const val = getIn(doc.goodDoc.data, holder);
    if (!isMap(val) && holder.length) return;
    const sectionTops = new Set(K.kinds.map(k => String(k.section[0])));
    const keys = nav.keys(holder, (val ?? {}) as Raw).filter(k => !sectionTops.has(k.name) || holder.length);
    const sec = h('div', { class: 'props' });
    for (const k of keys) sec.append(field([holder], '', k, [(val ?? {}) as Raw], undefined));
    body.append(sec);
    if (p.length && toPointer(p) !== toPointer(holder)) { const f = sec.querySelector(`[data-path="${CSS.escape(toPointer(p))}"]`); f?.classList.add('focus-row'); f?.scrollIntoView({ block: 'nearest' }); }
  }

  body.addEventListener('focusout', () => setTimeout(() => { if (!body.contains(document.activeElement)) paint(); }, 0));
  doc.onSelect(() => paint());
  // typing: once it pauses; everything else at once
  const paintLater = later(() => paint());
  doc.on(c => { if (isTyping(c)) paintLater(); else paintLater.now(); });
  return { paint, dispose: () => paintLater.cancel() };
}
