// Actions the canvas and the properties panel share (the tree has its own inline forms of the same commands): delete
// with a references dialog, rename in the inline field, duplicate, select connected. What an object is and how it is named
// are the kit's (the domain's commands, objectOf, kinds and name rule); what each kind offers in its own menu is the
// domain's too.

import { h } from './icons.ts';
import { ask } from './dialog.ts';
import { renameField, type RenameAt } from './rename.ts';
import type { EditorModel, Command } from '../model.ts';
import type { Commands } from '../commands.ts';
import type { ObjectKindInfo, ObjectRef } from '../adapter.ts';
import { applyStep } from '../splice.ts';
import { fromPointer, isPrefix, toPointer, type Path } from '../path.ts';

type Raw = Record<string, unknown>;
const getIn = (o: unknown, p: Path) => p.reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Raw)[k as string] : undefined), o);

/** what the shared actions are given of the domain */
export interface ActionsKit {
  commands: Pick<Commands, 'deleteCmd' | 'renameCmd' | 'renameKeyCmd' | 'referencesTo' | 'describe' | 'duplicateCmd'>;
  objectOf(ptr: string): ObjectRef | undefined;
  kinds: ObjectKindInfo[];
  nameRule: RegExp;
  nameHint: string;
}

export function run(doc: EditorModel, c: Command, origin: 'canvas' | 'props' | 'menu', note?: (t: string, tone?: 'bad') => void, joins?: number): boolean {
  try { return doc.apply(c, origin, joins); } catch (e) { note?.(String((e as Error).message), 'bad'); return false; }
}

/** Several commands as one undo step. */
export function composite(label: string, cmds: Command[]): Command {
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

/** The shared actions, for one domain. */
export function actionsFor(kit: ActionsKit) {
  const { deleteCmd, renameCmd, renameKeyCmd, referencesTo, describe, duplicateCmd } = kit.commands;
  const isRes = (p: Path) => { const r = kit.objectOf(toPointer(p)); return !!r && r.path === toPointer(p); };

/** Delete paths; when something refers to an object being deleted, ask whether its references go too. */
async function deletePaths(doc: EditorModel, paths: Path[], origin: 'canvas' | 'props' | 'menu', note?: (t: string, tone?: 'bad') => void): Promise<boolean> {
  const top = paths.filter(p => p.length && !paths.some(o => o !== p && o.length < p.length && isPrefix(o, p)));
  if (!top.length) return false;
  const refs = top.filter(isRes).flatMap(p => { const r = kit.objectOf(toPointer(p))!; return referencesTo(doc.text, r.kind, r.name).filter(x => !top.some(o => isPrefix(o, fromPointer(x.path)))).map(x => ({ p, x })); });
  let withRefs = false;
  if (refs.length) {
    const choice = await ask(`Delete ${top.length === 1 ? describe(top[0]) : `${top.length} items`}?`, [
      h('p', { class: 'sub' }, `${refs.length === 1 ? 'One place refers' : `${refs.length} places refer`} to ${top.length === 1 ? 'it' : 'them'}:`),
      h('ul', { class: 'ref-list' }, ...refs.map(({ x }) => h('li', null, h('code', null, x.path.slice(1).replace(/\//g, '.')), ` — ${x.slot.what}`))),
      h('p', { class: 'sub' }, 'Delete the references too, or leave them (the problems list will show them). Either way, Undo brings everything back.'),
    ], [{ label: 'Cancel', value: 'cancel' }, { label: 'Delete only', value: 'only', danger: true }, { label: 'Delete with references', value: 'with', danger: true, primary: true }]);
    if (!choice) return false;
    withRefs = choice === 'with';
  }
  const order = [...top].sort((a, b) => (typeof a.at(-1) === 'number' && typeof b.at(-1) === 'number' ? (b.at(-1) as number) - (a.at(-1) as number) : 0));
  const cmds = order.map(p => deleteCmd(p, { withRefs: withRefs && isRes(p) }));
  const ok = run(doc, cmds.length === 1 ? cmds[0] : composite(`Delete ${top.length} items`, cmds), origin, note);
  if (ok) doc.select([], origin);
  return ok;
}

/** Rename, in the inline field (rename.ts). `joins`: the undo step it becomes part of (an add's, so a drop and its name
 *  are one), when that is still the last one. */
async function rename(doc: EditorModel, path: Path, origin: 'canvas' | 'props' | 'menu', note: ((t: string, tone?: 'bad') => void) | undefined, at: RenameAt & { joins?: number }): Promise<boolean> {
  const now = String(path[path.length - 1]), res = isRes(path);
  let here: Path | null = path;
  const off = doc.on(c => { if (here && c.remap) here = c.remap(here); });
  const used = () => kit.kinds.flatMap(k => Object.keys((getIn(doc.goodDoc.data, k.section) ?? {}) as Raw));
  let ok = false;
  await renameField({
    label: `Rename ${describe(path)}`, value: now,
    wrong: v => (!v ? 'A name is needed' : v === now ? '' : res && !kit.nameRule.test(v) ? kit.nameHint : used().includes(v) ? `"${v}" is already used` : ''),
    alive: () => !!here && getIn(doc.goodDoc.data, here) !== undefined,
    commit: v => { if (here) ok = run(doc, { ...(res ? renameCmd(here, v) : renameKeyCmd(here, v)), joined: l => l.replace(` ${now}`, ` ${v}`) }, origin, note, at.joins); },
  }, at);
  off();
  return ok;
}

const duplicate = (doc: EditorModel, path: Path, origin: 'canvas' | 'menu', note?: (t: string, tone?: 'bad') => void) => {
  const c = duplicateCmd(path);
  if (run(doc, c, origin, note) && c.select) doc.select(c.select, origin);
};

/** Paths linked to these by references, both ways (select connected). */
function connected(doc: EditorModel, paths: Path[]): Path[] {
  const out = new Map<string, Path>();
  for (const p of paths) {
    const r = kit.objectOf(toPointer(p));
    if (!r) continue;
    out.set(r.path, fromPointer(r.path));
    // what refers to it
    for (const x of referencesTo(doc.text, r.kind, r.name)) { const q = kit.objectOf(x.path); out.set(q ? q.path : x.path, fromPointer(q ? q.path : x.path)); }
    // what it refers to
    const v = getIn(doc.goodDoc.data, fromPointer(r.path)) as Raw | undefined;
    const names: string[] = JSON.stringify(v ?? {}).match(/[a-z][a-z0-9-]*/g) ?? [];
    for (const k of kit.kinds) for (const n of Object.keys((getIn(doc.goodDoc.data, k.section) ?? {}) as Raw)) {
      if (names.includes(n) && n !== r.name) { const q = toPointer([...k.section, n]); out.set(q, fromPointer(q)); }
    }
  }
  return [...out.values()];
}

  return { deletePaths, rename, duplicate, connected };
}
export type Actions = ReturnType<typeof actionsFor>;
