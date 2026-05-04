#!/usr/bin/env node

// mobitty-cli — unified CLI for mobitty PTY sessions.
//
// Subcommands:
//   edit <path>      Open file in browser editor
//   view <path>      View image in browser (read-only)
//   download <path>  Download file to browser
//
// For use as $EDITOR/$VISUAL, the dedicated `mobitty-cli-edit` bin is set
// instead of `mobitty-cli edit` so consumers that don't word-split the env
// var (e.g. GitHub Copilot) can exec it as a single binary path.

import { resolve } from 'node:path';
import { fail, readCliEnv, runEdit, runView, runDownload } from './cli-shared.ts';

const PREFIX = 'mobitty-cli';

const subcommand = process.argv[2] ?? '';
const rawPath = process.argv[3];
if (!subcommand || !rawPath) {
  fail(PREFIX, 'usage: mobitty-cli <edit|view|download> <path>');
}
const filePath = resolve(rawPath);
const env = readCliEnv(PREFIX);

async function main(): Promise<void> {
  switch (subcommand) {
    case 'edit':
      await runEdit(env, PREFIX, filePath);
      break;
    case 'view':
      await runView(env, PREFIX, filePath);
      break;
    case 'download':
      await runDownload(env, PREFIX, filePath);
      break;
    default:
      fail(PREFIX, `unknown subcommand: ${subcommand}\nusage: mobitty-cli <edit|view|download> <path>`);
  }
}

main().then(() => process.exit(0)).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  fail(PREFIX, `connection error: ${msg}`);
});
