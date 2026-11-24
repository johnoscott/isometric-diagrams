// The commands every view uses to change a file: each is a label, the splice it makes (worked out against the text it
// will apply to), and how paths move. Renaming an object renames every reference to it in the same command; deleting
// one can take its references with it. What is an object, what references it and how, are the adapter's. Pure.

import { parseDocument } from 'yaml';
import { setValue, insertKey, deleteAt, insertItem, renameKey, moveKey, applyStep, scalarText, type Splice, type Step } from './splice.ts';
import { EditorDoc } from './doc.ts';
import { isPrefix, toPointer, type Path } from './path.ts';
import type { Command } from './model.ts';
import type { CommandsAdapter, Ref } from './adapter.ts';

const dataOf = (t: string) => parseDocument(t, { uniqueKeys: false }).toJS() as unknown;

/** Run several splices one after the other, each against the text the previous one left. */
export function chain(text: string, parts: ((t: string) => Splice)[]): Splice {
  const steps: Step[] = [];
  let t = text;
  let fallback = false;
  for (const f of parts) {
    const s = f(t);
    for (const st of s.steps) { steps.push(st); t = applyStep(t, st); }
    fallback ||= !!s.fallback;
  }
  return { steps, fallback };
}

/** Several commands as one: each built against the text the one before left; one undo step. */
export function seqCmd(label: string, cmds: Command[]): Command {
  return { label, touched: cmds.flatMap(c => c.touched ?? []), select: cmds.find(c => c.select)?.select, build: t => chain(t, cmds.map(c => (u: string) => c.build(u))) };
}
const hasKey = (t: string, p: Path) => { const d = dataOf(t); const parent = p.slice(0, -1).reduce<unknown>((x, k) => (x as Record<string, unknown>)?.[k as string], d); return !!parent && typeof parent === 'object' && String(p[p.length - 1]) in (parent as object); };
const parsePath = (ptr: string): Path => ptr.split('/').slice(1).map(s => { const u = s.replace(/~1/g, '/').replace(/~0/g, '~'); return /^\d+$/.test(u) ? Number(u) : u; });

/** The commands, for one domain. */
export function commandsFor(a: CommandsAdapter) {
  const describe = (p: Path) => a.describe(p);
  const order = a.topOrder;
  /** every name an object has, across every kind (one namespace) */
  const allNames = (data: unknown) => {
    const all = new Set<string>();
    for (const k of a.kinds) {
      const m = k.section.reduce<unknown>((x, s) => (x as Record<string, unknown>)?.[s as string], data);
      if (m && typeof m === 'object') for (const n of Object.keys(m)) all.add(n);
    }
    return all;
  };

  function setCmd(path: Path, value: unknown, label = `Set ${describe(path)}`): Command {
    return {
      label, touched: [path],
      build: t => {
        const d = new EditorDoc(t);
        if (d.rangeOf(path) || d.nodeAt(path) !== undefined || hasKey(t, path)) return setValue(t, path, value);
        return insertKey(t, path.slice(0, -1), String(path[path.length - 1]), value, { order });
      },
    };
  }
  /** Pins, one command: PINS.layout.NAME = { at: [x, y] } for each (a drag that keeps its neighbours in place). */
  function pinsCmd(pins: [string, [number, number]][], label: string): Command {
    const paths = pins.map(([n]) => [a.pins.key, 'layout', n] as Path);
    return withPinsMoved({ label, touched: paths, build: t => chain(t, pins.map(([, at], i) => (u: string) => setCmd(paths[i], { at }).build(u))) });
  }
  /** A pin edit that first moves pins kept under the legacy key to the current one (renaming the key in place), in the
   *  same command: one undo step puts both back. */
  function withPinsMoved(cmd: Command): Command {
    return { ...cmd, build: t => (a.pins.legacyOnly(dataOf(t)) ? chain(t, [u => renameKey(u, [a.pins.legacyKey!], a.pins.key), u => cmd.build(u)]) : cmd.build(t)) };
  }

  function insertCmd(mapPath: Path, key: string, value: unknown, opts: { after?: string; before?: string; label?: string } = {}): Command {
    return { label: opts.label ?? `Add ${describe([...mapPath, key])}`, touched: [[...mapPath, key]], select: [[...mapPath, key]], build: t => insertKey(t, mapPath, key, value, { ...opts, order }) };
  }

  function insertItemCmd(listPath: Path, value: unknown, index?: number, label = `Add to ${describe(listPath)}`): Command {
    return { label, touched: [listPath], build: t => insertItem(t, listPath, value, index, order) };
  }

  function moveCmd(path: Path, before?: string): Command {
    return { label: `Move ${describe(path)}`, touched: [path], build: t => moveKey(t, path, before, order) };
  }

  /** The references to an object, from the adapter's one table. */
  function referencesTo(text: string, kind: string, name: string): Ref[] {
    return a.refs(dataOf(text)).filter(r => (r.slot.key ? r.value === name : r.name === name) && r.slot.targets.includes(kind));
  }

  function deleteCmd(path: Path, opts: { withRefs?: boolean } = {}): Command {
    const res = a.objectOf(toPointer(path));
    const whole = res && res.path === toPointer(path);
    return {
      label: `Delete ${describe(path)}`, touched: [path],
      remap: p => (isPrefix(path, p) ? null : p),
      build: t => {
        if (!whole || !opts.withRefs) return deleteAt(t, path);
        // its references go too: list items (last first, so the indices stay right), and the keys that hold the others
        const refs = referencesTo(t, res!.kind, res!.name);
        // the adapter says what a reference's deletion takes (a reference, or the entry that holds it); a reference
        // that is itself a list item goes as it is
        const taken = refs.map(r => { const p = parsePath(r.path); return typeof p.at(-1) === 'number' ? p : a.refDeletePath(p); });
        // once each (a link naming it at both ends is one entry), and every list entry last first, whether a reference
        // was one or the adapter mapped it to one, so the indices still to go stay right (0.7.1)
        const once = [...new Map(taken.map(p => [toPointer(p), p])).values()];
        const items = once.filter(p => typeof p.at(-1) === 'number').sort((a, b) => (b.at(-1) as number) - (a.at(-1) as number));
        const keys = once.filter(p => typeof p.at(-1) !== 'number');
        const all = [...items, ...keys, path];
        // a path inside another being deleted needs no step of its own
        const kept = all.filter((p, i) => !all.some((q, j) => j !== i && q.length < p.length && isPrefix(q, p)));
        return chain(t, kept.map(p => (x: string) => deleteAt(x, p)));
      },
    };
  }

  /** Rename an object and every reference to it, as one command. */
  function renameCmd(path: Path, to: string): Command {
    const res = a.objectOf(toPointer(path));
    const from = String(path[path.length - 1]);
    const base = path.slice(0, -1);
    return {
      label: `Rename ${describe(path)} to ${to}`, touched: [[...base, to]],
      remap: p => (isPrefix(path, p) ? [...base, to, ...p.slice(path.length)] : p),
      build: t => {
        const key = renameKey(t, path, to);
        if (!res || res.path !== toPointer(path)) return key;
        const d = new EditorDoc(t);
        const edits: Step = [...key.steps[0]];
        for (const r of referencesTo(t, res.kind, from)) {
          const p = parsePath(r.path);
          const v = a.renameRef(r, to);
          if (v === undefined) continue;
          const range = d.rangeOf(p, r.slot.key ? 'key' : 'value');
          if (!range) continue;
          const now = t.slice(range[0], range[1]);
          const quote = now[0] === '"' || now[0] === "'" ? now[0] : undefined;
          edits.push({ start: range[0], end: range[1], text: quote === '"' ? JSON.stringify(v) : quote === "'" ? `'${v}'` : scalarText(v, { flow: true, indent: 0 }) });
        }
        // (0.12.5) its pin is keyed by its name: it follows (a domain whose references include the pins has done it), so the
        // thing stays where it was put. Not over a pin there already.
        const data = dataOf(t) as Record<string, { layout?: Record<string, unknown> } | null> | undefined;
        for (const k of [a.pins.key, a.pins.legacyKey]) {
          const layout = k === undefined ? undefined : data?.[k]?.layout;
          if (!layout || typeof layout !== 'object' || !Object.hasOwn(layout, from) || Object.hasOwn(layout, to)) continue;
          const range = d.rangeOf([k!, 'layout', from], 'key');
          if (range && !edits.some(e => e.start < range[1] && range[0] < e.end)) edits.push({ start: range[0], end: range[1], text: scalarText(to, { flow: true, indent: 0 }) });
        }
        return { steps: [edits] };
      },
    };
  }

  /** A copy of an object under a new name (name-2, name-3…), right after it. */
  function duplicateCmd(path: Path): Command {
    const name = String(path[path.length - 1]);
    const base = path.slice(0, -1);
    let made = '';
    return {
      label: `Duplicate ${describe(path)}`,
      get select() { return made ? [[...base, made]] : undefined; },
      build: t => {
        const data = dataOf(t);
        const all = allNames(data);
        const stem = name.replace(/-\d+$/, '');
        let n = 2;
        while (all.has(`${stem}-${n}`)) n++;
        made = `${stem}-${n}`;
        const kind = a.objectOf(toPointer(path))?.kind ?? '';
        const value = a.copyValue(kind, path.reduce<unknown>((x, k) => (x as Record<string, unknown>)?.[k as string], data));
        return insertKey(t, base, made, value, { after: name, order });
      },
    } as Command;
  }

  /** Rename a key that isn't an object (an entry, a label): no references follow it. */
  function renameKeyCmd(path: Path, to: string): Command {
    const base = path.slice(0, -1);
    return { label: `Rename ${describe(path)} to ${to}`, touched: [[...base, to]], remap: p => (isPrefix(path, p) ? [...base, to, ...p.slice(path.length)] : p), build: t => renameKey(t, path, to) };
  }

  /** Move a list item to another index (its value moves; a comment on its line stays behind). */
  function moveItemCmd(listPath: Path, from: number, to: number): Command {
    return {
      label: `Move ${describe([...listPath, from])}`, touched: [listPath],
      remap: p => (isPrefix(listPath, p) && p.length > listPath.length && p[listPath.length] === from ? [...listPath, to, ...p.slice(listPath.length + 1)] : p),
      build: t => {
        if (from === to) return { steps: [] };
        const value = [...listPath, from].reduce<unknown>((x, k) => (x as Record<string, unknown>)?.[k as string], dataOf(t));
        return chain(t, [x => deleteAt(x, [...listPath, from]), x => insertItem(x, listPath, value, to, order)]);
      },
    };
  }

  /** A name no object has yet: stem-1, stem-2… */
  function freshName(text: string, stem: string): string {
    const all = allNames(dataOf(text));
    let n = 1;
    while (all.has(`${stem}-${n}`)) n++;
    return `${stem}-${n}`;
  }

  return { describe, setCmd, pinsCmd, withPinsMoved, insertCmd, insertItemCmd, moveCmd, referencesTo, deleteCmd, renameCmd, duplicateCmd, renameKeyCmd, moveItemCmd, freshName };
}
export type Commands = ReturnType<typeof commandsFor>;
