// Arimo (OFL 1.1; the font file is not here, nor in the package), measured: a second table beside the default's, for a drawing whose host
// loads that font. Its widths are Arial's, so Arial stands in for it. It has no monospace beside it: that text stays the system's.
import type { FontTable } from './kernel.ts';
import widths from './arimo.json' with { type: 'json' };

export const ARIMO: FontTable = { name: 'arimo', sans: 'Arimo, Arial, Helvetica, sans-serif', widths };
