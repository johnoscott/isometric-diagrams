// isodiag/1's text services for the playground's editor: completion and hover from the format's schema, by the editor
// core's providers. No DOM: the site's tests ask them in Node as the page's Monaco pane does.
import SCHEMA from '../src/iso-systems/schema.json' with { type: 'json' };
import { docFor, providersFor, rangeOfPath } from '../src/iso-editor/providers.ts';
import type { ProvidersAdapter } from '../src/iso-editor/adapter.ts';
import type { TextServices } from '../src/iso-editor/ui/pane.ts';

/** isodiag/1 for the providers: its schema; no named objects to complete or refer to */
const isodiag: ProvidersAdapter = { schema: () => SCHEMA, role: () => 'main', refs: () => [], slotAt: () => undefined, kinds: [], snippets: {} };
const P = providersFor(isodiag);
export const ISODIAG_SERVICES: TextServices = { docFor, completionAt: P.completionAt, hoverAt: P.hoverAt, definitionAt: P.definitionAt, rangeOfPath };
