#!/usr/bin/env node
// Runs the TypeScript CLI with Node's built-in type stripping (Node 22.6+), so there is no build step.
// Signals sent to this wrapper (Ctrl-C, SIGTERM, SIGHUP) are passed on to the CLI, and if the CLI is stopped by a
// signal, the wrapper says which one and exits with 128 + its number, as a shell would, instead of a bare 1.
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli/isodiag.ts', import.meta.url));
const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', cli, ...process.argv.slice(2)], { stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { child.kill(sig); });
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`isodiag: stopped by ${signal}`);
    process.exit(128 + (constants.signals[signal] ?? 0));
  }
  process.exit(code ?? 1);
});
