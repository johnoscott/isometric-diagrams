// The clipboard: what is copied is plain YAML, so it pastes into the text pane, another file or another program.
//   - Objects (and the entries of an entry group) are copied from their source text, comments and all, wrapped in
//     their sections (a section nested in a map is wrapped in both).
//   - Anything else (a key inside an object, a setting) is copied as its own "key: value" lines.
// Pasting objects: a name already used gets -2, -3…; references inside the pasted set are rewritten to the new names
// (the adapter's one table); references to things outside it are kept, and the problems list shows any the target
// doesn't have. Pasting plain keys sets them on the selected object(s). Each paste is one command. Pure.

import { parseDocument } from 'yaml';
import { pairText, insertRawPair, insertKey, setValue, renameKey, deleteAt, applyStep, type Splice, type Step } from './splice.ts';
import { toPointer, fromPointer, isPrefix, type Path } from './path.ts';
import type { Command } from './model.ts';
import { commandsFor, chain } from './commands.ts';
import type { ClipboardAdapter } from './adapter.ts';

type Raw = Record<string, unknown>;
const isMap = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);

/** What a paste would do, described (for the menu), or why it can't. */
export interface PastePlan { cmd?: Command; what: string; names?: Map<string, string>; error?: string }

/** The clipboard, for one domain. */
export function clipboardFor(a: ClipboardAdapter) {
  const { deleteCmd, describe, setCmd } = commandsFor(a);
  const order = a.topOrder;
  const sectionPtrs = a.kinds.map(k => toPointer(k.section));
  const kindOfSection = new Map(a.kinds.map(k => [toPointer(k.section), k]));
  const groupPtrs = a.entryGroups.map(g => toPointer(g));

  /** the top-level path a copied thing lives under: an object's section, or its entry group */
  function holderOf(p: Path): Path | undefined {
    const r = a.objectOf(toPointer(p));
    if (r && r.path === toPointer(p)) return a.kinds.find(k => k.kind === r.kind)!.section;
    const g = a.entryGroups.find(g => p.length === g.length + 1 && isPrefix(g, p));
    if (g) return g;
    return undefined;
  }

  /** What is copied for these paths, as YAML text (and a short description of it). */
  function copyText(text: string, paths: Path[]): { text: string; what: string } | undefined {
    const top = paths.filter(p => p.length && !paths.some(o => o !== p && o.length < p.length && isPrefix(o, p)));
    if (!top.length) return undefined;
    const whole = top.filter(p => holderOf(p));
    if (whole.length === top.length) {
      // grouped by where they live, in the spec's order; each pair's own source text, indented under its section
      const groups = new Map<string, Path[]>();
      for (const p of whole) { const k = toPointer(holderOf(p)!); groups.set(k, [...(groups.get(k) ?? []), p]); }
      const out: string[] = [];
      const holders = [...sectionPtrs, ...groupPtrs];
      for (const g of [...groups.keys()].sort((x, y) => holders.indexOf(x) - holders.indexOf(y))) {
        const h = fromPointer(g);
        const pairs = groups.get(g)!.map(p => pairText(text, p)).filter((x): x is string => !!x);
        const indent = '  '.repeat(h.length);
        out.push(h.map((k, i) => `${'  '.repeat(i)}${k}:`).join('\n') + '\n' + pairs.map(t => t.replace(/\n$/, '').split('\n').map(l => (l ? indent + l : l)).join('\n')).join('\n') + '\n');
      }
      const n = whole.length;
      return { text: out.join(''), what: n === 1 ? describe(whole[0]) : `${n} items` };
    }
    // keys inside something: their own lines, at indent 0
    const lines = top.map(p => (typeof p[p.length - 1] === 'string' ? pairText(text, p) : undefined)).filter((x): x is string => !!x);
    if (!lines.length) return undefined;
    return { text: lines.join(''), what: top.length === 1 ? describe(top[0]) : `${top.length} keys` };
  }

  /** Paste YAML into the file: objects into their sections, or keys onto the selected objects. */
  function pasteCmd(text: string, clip: string, selection: Path[] = []): PastePlan {
    const parsed = parseDocument(clip);
    if (parsed.errors.length) return { what: 'nothing', error: `the clipboard isn't YAML: ${parsed.errors[0].message.split('\n')[0]}` };
    const data = parsed.toJS() as unknown;
    if (!isMap(data) || !Object.keys(data).length) return { what: 'nothing', error: 'the clipboard holds no YAML map' };
    const tops = new Set([...a.kinds.map(k => String(k.section[0])), ...a.entryGroups.map(g => String(g[0]))]);
    const resourcesPaste = Object.keys(data).every(k => tops.has(k));
    if (resourcesPaste) return pasteResources(text, clip, data);
    // keys onto the selected resources
    const targets = [...new Map(selection.map(p => a.objectOf(toPointer(p))).filter((r): r is NonNullable<typeof r> => !!r).map(r => [r.path, fromPointer(r.path)])).values()];
    if (!targets.length) return { what: 'nothing', error: `select a ${a.noun} to paste these keys onto` };
    const keys = Object.entries(data);
    const label = `Paste ${keys.map(([k]) => k).join(', ')} onto ${targets.length === 1 ? describe(targets[0]) : `${targets.length} items`}`;
    return {
      what: label,
      cmd: {
        label, touched: targets,
        build: t => chain(t, targets.flatMap(p => keys.map(([k, v]) => (x: string) => setCmd([...p, k], v).build(x)))),
      },
    };
  }

  function pasteResources(text: string, clip: string, data: Raw): PastePlan {
    const target = parseDocument(text).toJS() as Raw | null;
    // the names in the target, across every kind: a pasted name that clashes gets -2, -3… (an entry group's names are a
    // pool of their own)
    const taken = new Set<string>();
    for (const k of a.kinds) { const m = getIn(target, k.section); if (isMap(m)) for (const n of Object.keys(m)) taken.add(n); }
    const pools = new Map(a.entryGroups.map(g => { const m = getIn(target, g); return [toPointer(g), new Set(Object.keys(isMap(m) ? m : {}))] as const; }));
    const items: { holder: Path; name: string; to: string }[] = [];
    for (const p of [...sectionPtrs, ...groupPtrs]) {
      const m = getIn(data, fromPointer(p));
      if (!isMap(m)) continue;
      for (const name of Object.keys(m)) {
        const pool = pools.get(p) ?? taken;
        let to = name;
        if (pool.has(to)) { const stem = name.replace(/-\d+$/, ''); let i = 2; while (pool.has(`${stem}-${i}`)) i++; to = `${stem}-${i}`; }
        pool.add(to);
        items.push({ holder: fromPointer(p), name, to });
      }
    }
    if (!items.length) return { what: 'nothing', error: 'nothing to paste' };
    const renamed = new Map(items.filter(i => !pools.has(toPointer(i.holder)) && i.name !== i.to).map(i => [i.name, i.to]));
    // the clipboard text, with its pasted things renamed and the references among them following (its own splices)
    let frag = clip;
    const step = (s: Splice) => { for (const st of s.steps) frag = applyStep(frag, st); };
    const sectionOf = (kind: string) => a.kinds.find(k => k.kind === kind)?.section ?? [];
    for (const r of a.refs(data)) {
      if (r.slot.key) continue;
      const to = r.name !== undefined ? renamed.get(r.name) : undefined;
      if (!to || !(r.slot.targets.some(s => isMap(getIn(data, sectionOf(s))) && r.name! in (getIn(data, sectionOf(s)) as Raw)))) continue;
      step(setValue(frag, fromPointer(r.path), r.slot.rename ? r.slot.rename(r.value, to) : to));
    }
    // what a pasted object can't keep in this target (the adapter says: a flag only one may have)
    const dropped: string[] = [];
    let dropWhy = '';
    for (const i of items) {
      const k = kindOfSection.get(toPointer(i.holder));
      const drop = k && a.pasteDrops?.(target, { kind: k.kind, path: [...i.holder, i.name], value: getIn(data, [...i.holder, i.name]) });
      if (drop) { step(deleteAt(frag, drop.path)); dropped.push(i.to); dropWhy = drop.why; }
    }
    for (const i of items) if (i.name !== i.to) step(renameKey(frag, [...i.holder, i.name], i.to));
    const fragDoc = parseDocument(frag).toJS() as Raw;
    const n = items.length;
    const label = n === 1 ? `Paste ${kindOfSection.get(toPointer(items[0].holder))?.singular ?? a.kinds[0]?.singular ?? 'entry'} ${items[0].to}` : `Paste ${n} items`;
    return {
      what: label + (dropped.length ? ` (${dropped.join(', ')}: ${dropWhy})` : ''), names: new Map(items.map(i => [i.name, i.to])),
      cmd: {
        label: pools.has(toPointer(items[0].holder)) && n === 1 ? `Paste ${items[0].holder.join('.')} entry ${items[0].to}` : label,
        select: items.map(i => [...i.holder, i.to]),
        build: t => chain(t, items.map(i => (x: string) => {
          const holder = i.holder;
          const exists = isMap(getIn(parseDocument(x).toJS(), holder));
          if (!exists) return insertKey(x, holder.slice(0, -1), String(holder[holder.length - 1]), { [i.to]: getIn(fragDoc, [...holder, i.to]) }, { order });
          const raw = pairText(frag, [...holder, i.to]);
          return raw ? insertRawPair(x, holder, i.to, raw, order) : insertKey(x, holder, i.to, getIn(fragDoc, [...holder, i.to]), { order });
        })),
      },
    };
  }

  /** Cut: copy, then delete, as one command (the references to what is cut stay, for a paste to satisfy). */
  function cutCmd(text: string, paths: Path[]): { text: string; cmd: Command } | undefined {
    const c = copyText(text, paths);
    if (!c) return undefined;
    const top = paths.filter(p => p.length && !paths.some(o => o !== p && o.length < p.length && isPrefix(o, p)));
    const order = [...top].sort((a, b) => (typeof a.at(-1) === 'number' && typeof b.at(-1) === 'number' ? (b.at(-1) as number) - (a.at(-1) as number) : 0));
    return {
      text: c.text,
      cmd: { label: `Cut ${c.what}`, remap: p => (top.some(t => isPrefix(t, p)) ? null : p), build: t => chain(t, order.map(p => (x: string) => deleteCmd(p).build(x))) },
    };
  }

  return { copyText, pasteCmd, cutCmd };
}
export type Clipboard = ReturnType<typeof clipboardFor>;

const getIn = (o: unknown, p: Path) => p.reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Raw)[k as string] : undefined), o);
