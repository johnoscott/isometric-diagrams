// The inline name field (0.12.5): a small text field just above a thing (on the canvas it follows the thing through pan and
// zoom), the name selected, so typing replaces it. Nothing modal: no backdrop, and what is under it stays live. Enter commits, and so
// does a press anywhere else or the focus going elsewhere, when the name is a good one (a bad one is dropped, the name as
// it was); Esc dismisses. What is wrong with a name shows under the field, and Enter then does nothing.

import { h } from './icons.ts';
import { layer } from './layer.ts';

export interface RenameAt {
  /** where the thing is on the page now (asked each frame while the field is open); undefined: not drawn */
  place(): { left: number; top: number; width: number; height: number } | undefined;
  /** over the thing's own words, from their left edge (a heading), not above it */
  over?: boolean;
  /** what the field stays inside, on the page (default: the window) */
  bounds?(): { left: number; top: number; right: number; bottom: number };
  /** where it is until the thing is drawn */
  at?: { x: number; y: number };
  /** a press in here saves the name once it is released (the press may be on the thing itself, or drag it: it goes by the
   *  name it has); anywhere else at once, before what was pressed acts (Save, Undo) */
  late?: HTMLElement;
  /** what such a press started (a drag of the thing) isn't over yet: the name waits for it */
  busy?(): boolean;
  /** what has the focus after Enter or Esc (default: what had it) */
  back?: HTMLElement;
}
export interface RenameField {
  label: string;
  value: string;
  /** what is wrong with a name ('' : nothing) */
  wrong(v: string): string;
  /** Enter on a good name that isn't the one there */
  commit(v: string): void;
  /** false: the thing is gone, and the field with it */
  alive?(): boolean;
}

let open: { close(): void } | undefined;
export const renameOpen = () => !!open;

/** Open the field; resolves with the name committed, or undefined when dismissed. */
export function renameField(f: RenameField, at: RenameAt): Promise<string | undefined> {
  open?.close();
  return new Promise(resolve => {
    const back = at.back ?? (document.activeElement as HTMLElement | null);
    const id = `rename-${Math.random().toString(36).slice(2, 8)}`;
    const input = h('input', { type: 'text', class: 'rename-input', 'aria-label': f.label, 'aria-describedby': id, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' });
    const why = h('p', { class: 'rename-error', role: 'alert', id });
    const box = h('div', { class: `rename-field${at.over ? ' over' : ''}` }, input, why);
    input.value = f.value;
    const fitWidth = () => { input.size = Math.max(8, Math.min(40, input.value.length + 1)); };
    fitWidth();
    layer().append(box);
    let done = false, frame = 0, seen = at.at ? { left: at.at.x, top: at.at.y, width: 0, height: 0 } : undefined;
    const put = () => {
      const p = at.place();
      if (p) seen = p;
      const b = at.bounds?.() ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight }, r = input.getBoundingClientRect();
      const t = seen ?? { left: (b.left + b.right) / 2, top: b.top + 48, width: 0, height: 0 };
      const within = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
      box.style.left = `${within(at.over ? t.left - 8 : t.left + t.width / 2 - r.width / 2, b.left + 4, b.right - r.width - 4)}px`;
      box.style.top = `${within(at.over ? t.top + t.height / 2 - r.height / 2 : t.top - r.height - 8, b.top + 4, b.bottom - r.height - 4)}px`;
    };
    const follow = () => { if (done) return; if (f.alive && !f.alive()) { end(undefined, false); return; } put(); frame = requestAnimationFrame(follow); };
    const check = () => {
      const bad = f.wrong(input.value.trim());
      why.textContent = bad;
      input.setAttribute('aria-invalid', String(!!bad));
      return bad;
    };
    /** the name to save: a good one that isn't the one there */
    const good = () => { const v = input.value.trim(); return v !== f.value && !f.wrong(v) ? v : undefined; };
    function end(v: string | undefined, focusBack: boolean, late = false) {
      if (done) return;
      done = true;
      cancelAnimationFrame(frame);
      removeEventListener('pointerdown', outside, true);
      box.remove();
      open = undefined;
      if (focusBack && back?.isConnected) back.focus({ preventScroll: true });
      const save = () => { if (v !== undefined && (!f.alive || f.alive())) f.commit(v); resolve(v); };
      if (!late || v === undefined) { save(); return; }
      const up = () => { removeEventListener('pointerup', up, true); removeEventListener('pointercancel', up, true); setTimeout(wait, 0); };
      const wait = () => { if (at.busy?.()) setTimeout(wait, 20); else save(); };
      addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
    }
    const outside = (e: Event) => { if (!box.contains(e.target as Node)) end(good(), false, !!at.late?.contains(e.target as Node)); };
    addEventListener('pointerdown', outside, true);
    input.addEventListener('input', () => { fitWidth(); check(); });
    input.addEventListener('keydown', e => {
      // ⌘S saves the file, with the name
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { end(good(), true); return; }
      e.stopPropagation();          // the keys are the field's: ⌘Z, Delete and the arrows never reach the canvas
      if (e.isComposing) return;
      if (e.key === 'Escape') { e.preventDefault(); end(undefined, true); }
      if (e.key === 'Enter') { e.preventDefault(); const v = input.value.trim(); if (!check()) end(v === f.value ? undefined : v, true); }
    });
    input.addEventListener('keyup', e => e.stopPropagation());
    // the focus gone elsewhere in the page (not with the window: coming back, the field is as it was)
    input.addEventListener('blur', () => setTimeout(() => { if (!done && document.hasFocus() && document.activeElement !== input && document.activeElement !== document.body) end(good(), false); }, 0));
    open = { close: () => end(undefined, false) };
    follow();
    input.focus({ preventScroll: true });
    input.select();
  });
}
