// A feature window's protocol (version 1), as any domain's editor speaks it: a host page runs the editor in a window
// of its own (or an <iframe>), and the two talk over postMessage. Every message is { v: 1, type, … }; a request carries
// an id and its answer re: that id; each side checks the other's origin, and ignores a type it doesn't know (never an
// error). These are the messages every editor has (hello, save, dirty, close; init, text, read-only, theme, saved);
// a domain adds its own (types only here: the domain's client and page script are its own, and stay small).

import type { Theme, SaveResult } from '../ui/mount.ts';

export const PROTOCOL = 1;
export type Refused = { refused: string };

/** what a window can do: a newer window tells an older host what it lacks, and the reverse */
export interface Capabilities { protocol: number; features: string[]; messages: string[] }

/** the window's messages every editor sends */
export type BaseToHost =
  | { v: 1; type: 'hello'; capabilities: Capabilities }
  | { v: 1; type: 'save'; id: number; text: string }
  | { v: 1; type: 'dirty'; dirty: boolean }
  | { v: 1; type: 'close' };

/** the host's messages every editor takes (I: the domain's own fields in init) */
export type BaseToWindow<I extends object = object> =
  | ({ v: 1; type: 'init'; text: string; fileName?: string; readOnly?: boolean; theme?: Theme; features?: string[] } & I)
  | { v: 1; type: 'text'; text: string }
  | { v: 1; type: 'read-only'; readOnly: boolean }
  | { v: 1; type: 'theme'; theme: Theme }
  | { v: 1; type: 'saved'; re: number; result: SaveResult | Refused };

/** a message of this protocol, of a type the receiver knows (anything else is ignored, never an error) */
export function isMessage<T extends { type: string }>(d: unknown, types: readonly string[]): d is T {
  return !!d && typeof d === 'object' && (d as { v?: unknown }).v === PROTOCOL && types.includes((d as { type?: unknown }).type as string);
}
