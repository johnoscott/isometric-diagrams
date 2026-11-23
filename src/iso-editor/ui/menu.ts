// A menu opened at the pointer (the right-click menu) or under a button (provenance: docs/editor/INTEGRATION.md, its table of what is copied; its DOM
// and classes, rewritten for a position rather than a trigger). Arrow keys, Home and End move;
// Enter or the Space key chooses; Escape or Tab closes and gives the focus back; a click outside closes. A disabled item stays
// visible and says why.

import { h, icon, type IconName } from './icons.ts';
import { layer } from './layer.ts';

export type MenuItem =
  | { label: string; icon?: IconName; desc?: string; keys?: string; danger?: boolean; disabled?: boolean; why?: string; onSelect(): void }
  | { sep: true } | { heading: string };

let open: { el: HTMLElement; close(focusBack: boolean): void } | undefined;
export const menuOpen = () => !!open;

export function openMenu(items: MenuItem[], at: { x: number; y: number } | HTMLElement, label = 'Actions'): HTMLElement {
  open?.close(false);
  const back = document.activeElement as HTMLElement | null;
  const el = h('div', { class: 'menu', role: 'menu', 'aria-label': label, tabindex: '-1' });
  const buttons: HTMLButtonElement[] = [];
  for (const it of items) {
    if ('sep' in it) { el.append(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
    if ('heading' in it) { el.append(h('div', { class: 'menu-label' }, it.heading)); continue; }
    const desc = (it.disabled ? it.why : undefined) ?? it.desc;
    const b = h('button', { type: 'button', role: 'menuitem', tabindex: '-1', class: 'menu-item' + (it.danger ? ' danger' : ''), 'data-desc': desc, 'aria-description': desc },
      it.icon ? icon(it.icon) : h('span'), h('span', { class: 'mi-label' }, it.label), it.keys ? h('span', { class: 'menu-trail' }, it.keys) : null);
    if (it.disabled) b.disabled = true;
    b.addEventListener('click', e => { e.stopPropagation(); if (b.disabled) return; close(true); it.onSelect(); });
    buttons.push(b);
    el.append(b);
  }
  layer().append(el);
  // placed at the point (or under the element), kept on screen
  const r = el.getBoundingClientRect();
  let x: number, y: number;
  if (at instanceof HTMLElement) { const a = at.getBoundingClientRect(); x = a.left; y = a.bottom + 4; if (y + r.height > innerHeight - 8) y = a.top - r.height - 4; }
  else { x = at.x; y = at.y; if (y + r.height > innerHeight - 8) y = Math.max(8, at.y - r.height); }
  el.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
  el.style.top = `${Math.max(8, y)}px`;
  const live = () => buttons.filter(b => !b.disabled);
  const focus = (i: number) => { const l = live(); if (l.length) l[(i + l.length) % l.length].focus(); };
  focus(0);
  el.addEventListener('keydown', e => {
    const l = live();
    const i = l.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { focus(i + 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { focus(i - 1); e.preventDefault(); }
    else if (e.key === 'Home') { focus(0); e.preventDefault(); }
    else if (e.key === 'End') { focus(-1); e.preventDefault(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { close(true); e.preventDefault(); }
    e.stopPropagation();
  });
  const outside = (e: Event) => { if (!el.contains(e.target as Node)) close(false); };
  setTimeout(() => { addEventListener('pointerdown', outside, true); addEventListener('blur', blur); }, 0);
  const blur = () => close(false);
  function close(focusBack: boolean) {
    if (!el.isConnected) return;
    el.remove();
    removeEventListener('pointerdown', outside, true);
    removeEventListener('blur', blur);
    open = undefined;
    if (focusBack) back?.focus();
  }
  open = { el, close };
  return el;
}
export function closeMenu() { open?.close(false); }
