// A modal dialog (the <dialog class="dlg"> structure: head, body and foot; provenance: docs/editor/INTEGRATION.md, its table of what is copied), as
// a promise: it resolves with the chosen button's value, or null when cancelled.

import { h } from './icons.ts';
import { layer } from './layer.ts';

export interface DialogButton { label: string; value: string; primary?: boolean; danger?: boolean }

export function ask(title: string, body: (Node | string)[], buttons: DialogButton[]): Promise<string | null> {
  return new Promise(resolve => {
    const d = h('dialog', { class: 'dlg', 'aria-label': title });
    const form = h('form', { method: 'dialog' });
    const foot = h('div', { class: 'dlg-foot' });
    for (const b of buttons) {
      const btn = h('button', { type: 'submit', value: b.value, class: `btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}` }, b.label);
      foot.append(btn);
    }
    form.append(h('div', { class: 'dlg-head' }, h('h2', { class: 'h-title' }, title)), h('div', { class: 'dlg-body' }, ...body), foot);
    d.append(form);
    layer().append(d);
    d.addEventListener('close', () => { const v = d.returnValue; d.remove(); resolve(v && v !== 'cancel' ? v : null); });
    d.showModal();
    (foot.querySelector('.primary') as HTMLElement | null)?.focus();
  });
}
