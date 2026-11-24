// isodiag CLI: check, build, dev.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../iso-systems/compile.ts';
import { formatDiags } from '../iso-core/errors.ts';
import { renderPage } from '../iso-viewer/page.ts';
import { stillsIn } from './stills.ts';
import { playerScript } from '../iso-viewer/bundle.ts';
import { renderProof } from '../proof/proof.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function themeText(name: string | undefined, file: string): string {
  if (!name || name === 'default') return readFileSync(resolve(ROOT, 'themes/default.yaml'), 'utf8');
  return readFileSync(resolve(dirname(file), name), 'utf8');
}

export function compileFile(file: string) {
  const src = readFileSync(file, 'utf8');
  const theme = /^theme:\s*(\S+)/m.exec(src)?.[1]?.replace(/^["']|["']$/g, '');
  const c = compile(src, themeText(theme, file));
  return { c, src };
}

function usage(): never {
  console.error(`usage:
  isodiag check FILE.yaml [--strict]       validate and lay out; warnings fail with --strict
  isodiag build FILE.yaml [-o OUT.html]    write a standalone HTML page
  isodiag build PAGE.html [-o OUT.html]    write the page with a still inside each <isometric-diagram>, for readers without its script
  isodiag proof FILE.yaml [-o OUT.html] [--with-intro]
                                           a proof sheet: every object and its copy, every step as a still with its YAML
  isodiag dev FILE.yaml [--port 4173]      serve it on 127.0.0.1 and reload on save
`);
  process.exit(2);
}

function main(argv: string[]) {
  const [cmd, file, ...rest] = argv;
  if (!cmd || !file) usage();
  if (cmd === 'dev') {
    const pi = rest.indexOf('--port');
    import('./dev.ts').then(m => m.dev(file, pi >= 0 ? Number(rest[pi + 1]) : undefined));
    return;
  }
  if (cmd === 'build' && /\.html?$/i.test(file)) {
    const oi = rest.indexOf('-o'), out = oi >= 0 ? rest[oi + 1] : file.replace(/\.html?$/i, '') + '.built.html';
    const r = stillsIn(readFileSync(file, 'utf8'), themeText(undefined, file));
    for (const p of r.problems) console.error(`${basename(file)}: ${p}`);
    if (r.problems.length) { console.error(`${basename(file)}: not written, ${r.problems.length} of its diagrams can't be drawn`); process.exit(1); }
    writeFileSync(out, r.html);
    console.error(`wrote ${out}: ${r.drawn} still${r.drawn === 1 ? '' : 's'}`);
    return;
  }
  const strict = rest.includes('--strict');
  const { c, src } = compileFile(file);
  const errors = c.diags.filter(d => d.severity === 'error').length, warnings = c.diags.length - errors;
  if (c.diags.length) console.error(formatDiags(c.diags, basename(file), src) + '\n');
  if (cmd === 'check') {
    console.error(`${basename(file)}: ${errors} error(s), ${warnings} warning(s), ${c.scenes.length} scene(s)`);
    process.exit(errors || (strict && warnings) ? 1 : 0);
  }
  if (cmd === 'build') {
    if (!c.ok) { console.error(`${basename(file)}: not built, ${errors} error(s)`); process.exit(1); }
    const oi = rest.indexOf('-o');
    const out = oi >= 0 ? rest[oi + 1] : file.replace(/\.ya?ml$/, '') + '.html';
    writeFileSync(out, renderPage(c, { runtime: playerScript() }));
    console.error(`wrote ${out}`);
    return;
  }
  if (cmd === 'proof') {
    if (!c.ok) { console.error(`${basename(file)}: no proof sheet, ${errors} error(s)`); process.exit(1); }
    const oi = rest.indexOf('-o');
    const out = oi >= 0 ? rest[oi + 1] : file.replace(/\.ya?ml$/, '') + '.proof.html';
    // the live page the frames link to, beside the sheet
    const live = out.replace(/(\.proof)?\.html$/, '') + '.live.html';
    writeFileSync(live, renderPage(c, { runtime: playerScript() }));
    writeFileSync(out, renderProof(c, { liveHref: basename(live), withIntro: rest.includes('--with-intro'), fileName: basename(file) }));
    console.error(`wrote ${out} (and ${live})`);
    return;
  }
  usage();
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
