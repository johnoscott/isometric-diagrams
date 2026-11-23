// The clipboard in the page: ⌘C, ⌘X and ⌘V in the tree and on the canvas go through the system clipboard as plain
// text, so a copy pastes into the text pane, another file or another program, and back. The menus' Copy, Cut and
// Paste use the async clipboard API, with the last copy kept here as a fallback where reading is refused. In the text
// pane (and any field) the browser's own clipboard applies. The YAML and the commands are src/iso-editor/clipboard.ts.

import type { Clipboard } from '../clipboard.ts';
import type { EditorModel } from '../model.ts';
import type { MenuItem } from './menu.ts';

export interface Clip {
  /** the menu items for what is selected */
  items(): MenuItem[];
  /** handle the clipboard events of a document (the page, or the canvas's frame) */
  attach(d: EventTarget, owns: (target: EventTarget | null) => boolean): () => void;
  copy(): Promise<boolean>;
  cut(): Promise<boolean>;
  paste(text?: string): Promise<boolean>;
}

/** the page's clipboard over the domain's (its copyText, cutCmd and pasteCmd: src/iso-editor/clipboard.ts) */
export function clipboard(doc: EditorModel, note: (t: string, tone?: 'info' | 'warn' | 'bad') => void, services: Clipboard): Clip {
  const { copyText, cutCmd, pasteCmd } = services;
  let last = '';
  const ro = () => !doc.doc.ok;
  const editable = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, .monaco-editor, [contenteditable]');

  const doCopy = (): string | undefined => {
    const c = copyText(doc.text, doc.selection);
    if (!c) { note('Select something to copy'); return undefined; }
    last = c.text;
    note(`Copied ${c.what}`);
    return c.text;
  };
  const doCut = (): string | undefined => {
    if (ro()) { note('Fix the YAML first', 'warn'); return undefined; }
    const c = cutCmd(doc.text, doc.selection);
    if (!c) { note('Select something to cut'); return undefined; }
    last = c.text;
    doc.apply(c.cmd, 'menu');
    doc.select([], 'menu');
    return c.text;
  };
  const doPaste = (text: string): boolean => {
    if (ro()) { note('Fix the YAML first', 'warn'); return false; }
    const p = pasteCmd(doc.text, text, doc.selection);
    if (!p.cmd) { note(`Can't paste: ${p.error}`, 'warn'); return false; }
    try {
      if (!doc.apply(p.cmd, 'menu')) return false;
    } catch (e) { note(`Can't paste: ${(e as Error).message}`, 'bad'); return false; }
    if (p.cmd.select) doc.select(p.cmd.select, 'menu');
    const renamed = p.names ? [...p.names].filter(([a, b]) => a !== b) : [];
    note(renamed.length ? `${p.what}: ${renamed.map(([a, b]) => `${a} → ${b}`).join(', ')}` : p.what);
    return true;
  };

  return {
    items() {
      const has = doc.selection.length > 0;
      return [
        { label: 'Cut', icon: 'clipboard', keys: '⌘X', disabled: !has || ro(), why: has ? 'Fix the YAML first' : 'Nothing selected', onSelect: () => void this.cut() },
        { label: 'Copy', icon: 'copy', keys: '⌘C', disabled: !has, why: 'Nothing selected', onSelect: () => void this.copy() },
        { label: 'Paste', icon: 'clipboard-paste', keys: '⌘V', disabled: ro(), why: 'Fix the YAML first', onSelect: () => void this.paste() },
      ];
    },
    attach(d, owns) {
      const copy = (ev: Event) => {
        const e = ev as ClipboardEvent;
        if (editable(e.target) || !owns(e.target)) return;
        const t = doCopy();
        if (t !== undefined) { e.clipboardData?.setData('text/plain', t); e.preventDefault(); }
      };
      const cut = (ev: Event) => {
        const e = ev as ClipboardEvent;
        if (editable(e.target) || !owns(e.target)) return;
        const t = doCut();
        if (t !== undefined) { e.clipboardData?.setData('text/plain', t); e.preventDefault(); }
      };
      const paste = (ev: Event) => {
        const e = ev as ClipboardEvent;
        if (editable(e.target) || !owns(e.target)) return;
        const t = e.clipboardData?.getData('text/plain') ?? '';
        e.preventDefault();
        doPaste(t || last);
      };
      d.addEventListener('copy', copy); d.addEventListener('cut', cut); d.addEventListener('paste', paste);
      return () => { d.removeEventListener('copy', copy); d.removeEventListener('cut', cut); d.removeEventListener('paste', paste); };
    },
    async copy() { const t = doCopy(); if (t === undefined) return false; try { await navigator.clipboard.writeText(t); } catch { /* kept here */ } return true; },
    async cut() { const t = doCut(); if (t === undefined) return false; try { await navigator.clipboard.writeText(t); } catch { /* kept here */ } return true; },
    async paste(text?: string) {
      let t = text;
      if (t === undefined) { try { t = await navigator.clipboard.readText(); } catch { t = last; } }
      if (!t) { note('The clipboard is empty'); return false; }
      return doPaste(t);
    },
  };
}
