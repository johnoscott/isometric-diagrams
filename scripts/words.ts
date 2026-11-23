// Names given by their sha256, as patterns for String.prototype.match: a gate can deny a word without writing it.
import { createHash } from 'node:crypto';

/** A name, given by the sha256 of its text (lower case, unless `exact`), as a pattern for String.prototype.match:
 *  it finds the name as a whole word: a run of letters and digits, or two or three such runs joined by '-', ' ' or nothing. */
export function word(...shas: string[]): RegExp {
  const want = new Set(shas);
  const sha = (t: string) => createHash('sha256').update(t).digest('hex');
  const m = {
    [Symbol.match](text: string): string[] | null {
      const out: string[] = [];
      const runs = [...text.matchAll(/[A-Za-z0-9]+/g)];
      const check = (t: string) => { if (want.has(sha(t)) || want.has(sha(t.toLowerCase()))) out.push(t); };
      for (let i = 0; i < runs.length; i++) {
        check(runs[i][0]);
        for (let j = i + 1; j < Math.min(i + 3, runs.length); j++) {
          const end = runs[j - 1].index! + runs[j - 1][0].length;
          if (runs[j].index! - end > 1 || !/^[- ]?$/.test(text.slice(end, runs[j].index))) break;
          check(text.slice(runs[i].index!, runs[j].index! + runs[j][0].length));
        }
      }
      return out.length ? out : null;
    },
  };
  return m as unknown as RegExp;
}
