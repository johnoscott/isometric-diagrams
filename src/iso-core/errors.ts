// Diagnostics: a message tied to a place in the YAML source, printed with a caret excerpt.

export type Severity = 'error' | 'warning';

export interface Diag {
  severity: Severity;
  message: string;
  /** 1-based; 0 when the place is unknown */
  line: number;
  col: number;
  /** the JSON path in the document, for tools and tests, e.g. /scenes/0/nodes/2/asset */
  path: string;
  hint?: string;
  /** another file the place is in (a defaults or override file), with its text for the excerpt */
  file?: string;
  source?: string;
}

export class DiagError extends Error {
  diags: Diag[];
  constructor(diags: Diag[]) {
    super(diags.map(d => `${d.line}:${d.col} ${d.message}`).join('\n'));
    this.diags = diags;
  }
}

/** Edit distance where swapping two neighbouring letters counts as one edit (optimal string alignment). */
export function distance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

/** The closest candidate, if it is close enough to be a likely typo. */
export function didYouMean(word: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined, bd = Infinity;
  const w = word.toLowerCase();
  for (const c of candidates) {
    const d = distance(w, c.toLowerCase());
    if (d < bd) { bd = d; best = c; }
  }
  if (best === undefined) return undefined;
  const limit = Math.max(1, Math.min(3, Math.floor(Math.max(word.length, best.length) / 3)));
  return bd <= limit ? best : undefined;
}

export function formatDiag(d: Diag, file: string, source?: string): string {
  if (d.file) { file = d.file; source = d.source; }
  const where = d.line ? `${file}:${d.line}:${d.col}` : file;
  let out = `${where}  ${d.severity}: ${d.message}`;
  if (d.hint) out += `\n    ${d.hint}`;
  if (source && d.line) {
    const lines = source.split(/\r?\n/);
    const text = lines[d.line - 1] ?? '';
    const gutter = String(d.line).padStart(4);
    out += `\n${gutter} | ${text}\n${' '.repeat(gutter.length)} | ${' '.repeat(Math.max(0, d.col - 1))}^`;
  }
  return out;
}

export function formatDiags(diags: Diag[], file: string, source?: string): string {
  return diags.map(d => formatDiag(d, file, source)).join('\n\n');
}
