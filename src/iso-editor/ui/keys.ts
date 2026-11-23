// The keyboard sheet: every key the editor answers, by where it applies (the domain's map), opened with ? (outside a
// text field) or the title bar's Keys button.

import { h } from './icons.ts';
import { layer } from './layer.ts';

export type KeyGroup = { where: string; keys: [string, string][] };

/** The map with a host's own keys added to the first group (the standalone page: ⇧⌘S Save as, ⌘O Open). */
export function keymapWith(map: KeyGroup[], extra: [string, string][]): KeyGroup[] {
  return map.map((g, i) => (i === 0 ? { ...g, keys: [...g.keys.slice(0, 1), ...extra, ...g.keys.slice(1)] } : g));
}

export function keySheet(map: KeyGroup[]): HTMLDialogElement {
  const d = h('dialog', { class: 'dlg keys-dlg', 'aria-label': 'Keyboard' });
  const form = h('form', { method: 'dialog' });
  const body = h('div', { class: 'dlg-body keys' });
  for (const g of map) {
    body.append(h('h3', { class: 'keys-h' }, g.where));
    const dl = h('dl', { class: 'keys-list' });
    for (const [k, what] of g.keys) dl.append(h('dt', null, ...k.split(/(\s+or\s+|,\s*)/).map(p => (/^\s+or\s+$|^,\s*$/.test(p) ? p : h('kbd', null, p)))), h('dd', null, what));
    body.append(dl);
  }
  form.append(h('div', { class: 'dlg-head' }, h('h2', { class: 'h-title' }, 'Keyboard')), body, h('div', { class: 'dlg-foot' }, h('button', { type: 'submit', class: 'btn primary', value: 'close' }, 'Close')));
  d.append(form);
  d.addEventListener('close', () => d.remove());
  layer().append(d);
  d.showModal();
  return d;
}
