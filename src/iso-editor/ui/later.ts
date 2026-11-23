// Work that waits for a pause in typing. Typing in a text pane is synchronous to the model and the other pane (the
// text never lags); the structural views (the tree, the properties, the path at the caret, the problems and canvas)
// repaint once typing pauses, so a keystroke never waits on a parse of the whole file.

import type { Change } from '../model.ts';

export const TYPING_PAUSE_MS = 150;

/** Is this change typing (from a text pane)? Then the structural views can wait. */
export const isTyping = (c: Change) => c.kind === 'do' && c.origin === 'text';

/** A function that runs `fn` once, `ms` after the last call; `now()` runs it at once (and cancels the wait); `cancel()`
 *  drops a pending run (when the editor is disposed). */
export function later(fn: () => void, ms = TYPING_PAUSE_MS): { (): void; now(): void; pending(): boolean; cancel(): void } {
  let t = 0;
  const run = () => { t = 0; fn(); };
  const f = () => { clearTimeout(t); t = window.setTimeout(run, ms); };
  f.now = () => { clearTimeout(t); run(); };
  f.pending = () => t !== 0;
  f.cancel = () => { clearTimeout(t); t = 0; };
  return f;
}
