#!/usr/bin/env node

// mobitty-cli-edit — dedicated bin for use as $EDITOR / $VISUAL.
//
// Equivalent to `mobitty-cli edit <path>` but exposed as a standalone
// executable so consumers that don't word-split $EDITOR (e.g. GitHub
// Copilot's terminal) can resolve and exec it as a single binary path.

import { resolve } from 'node:path';
import { fail, readCliEnv, runEdit } from './cli-shared.ts';

const PREFIX = 'mobitty-cli-edit';

const rawPath = process.argv[2];
if (!rawPath) {
  fail(PREFIX, 'usage: mobitty-cli-edit <path>');
}
const filePath = resolve(rawPath);
const env = readCliEnv(PREFIX);

runEdit(env, PREFIX, filePath).then(() => process.exit(0)).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  fail(PREFIX, `connection error: ${msg}`);
});
