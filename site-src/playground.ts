// The playground's editor: the engine's own Monaco text pane (src/iso-editor/ui/text.ts) over one EditorModel, with
// isodiag/1's completion and hover from its schema (the editor core's providers) and the drawing's problems as markers
// on their lines (and listed under the editor). The examples' drop-down loads a gallery drawing. A module of its own,
// loaded by playground.html only: Monaco, its worker and its styles are files of the site (scripts/build-site.ts),
// so the page's CSP allows them as 'self' (no eval, no blob:).
import { EditorModel } from '../src/iso-editor/model.ts';
import type { Problem } from '../src/iso-editor/validate.ts';
import { textPane } from '../src/iso-editor/ui/text.ts';
import { ISODIAG_SERVICES as services } from './isodiag-services.ts';
import { show } from './draw.ts';

const out = document.querySelector<HTMLElement>('[data-playground]');
const host = document.querySelector<HTMLElement>('#yaml-editor');
const plain = document.querySelector<HTMLTextAreaElement>('#yaml');
const pick = document.querySelector<HTMLSelectElement>('#example');
const list = document.querySelector<HTMLUListElement>('.diags');
if (out && host && plain && pick && list) {
  const examples = new Map([...document.querySelectorAll<HTMLTextAreaElement>('#examples textarea[data-example]')].map(t => [t.dataset.example!, t.value]));
  const doc = new EditorModel();
  doc.load(plain.value);
  // the plain textarea is the page without its module; the editor replaces it
  plain.hidden = true;
  host.hidden = false;
  const pane = textPane(host, doc, { services });
  const dark = () => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  pane.setTheme(dark());
  document.addEventListener('site-theme', () => pane.setTheme(dark()));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => pane.setTheme(dark()));

  const stage = out.querySelector<HTMLElement>('.stage')!;
  let timer = 0;
  const run = () => {
    const { problems } = show(stage, doc.text);
    const lines = doc.text.split('\n');
    // a problem's place: its line from its column (the line's start when the column is unknown) to the line's end
    const marks: Problem[] = problems.map(p => {
      const line = Math.min(Math.max(p.line, 1), lines.length), text = lines[line - 1] ?? '';
      const start = p.col > 0 ? Math.min(p.col, text.length + 1) : (text.length - text.trimStart().length) + 1;
      return { severity: p.severity === 'error' ? 'error' : 'warning', message: p.message, path: '', startLine: line, startCol: start, endLine: line, endCol: Math.max(start + 1, text.length + 1) };
    });
    pane.setProblems(marks);
    list.replaceChildren(...problems.map(p => Object.assign(document.createElement('li'), { className: p.severity, textContent: `line ${p.line}: ${p.message}` })));
  };
  doc.on(() => { clearTimeout(timer); timer = window.setTimeout(run, 250); });
  pick.addEventListener('change', () => {
    const t = examples.get(pick.value);
    if (t === undefined) return;
    doc.load(t);
    clearTimeout(timer);
    run();
  });
  run();
  (window as unknown as { __playground: unknown }).__playground = { doc, pane, services };
  out.dataset.editor = 'monaco';
}
