// Resolves the command string for invoking `mobitty-cli`.
//
// Strategy:
// 1. Look for an installed bin shim (node_modules/.bin/mobitty-cli[.cmd]).
//    This exists when the package is installed as a dependency (e.g. production).
// 2. Fall back to "<node> <source-path>" for dev mode, where the .ts source
//    file is invoked directly via Node's native TypeScript support.
//
// The returned string is set as $EDITOR / $VISUAL (with " edit" appended).
// Both shells and tools like Claude Code word-split this before exec, so
// "node /path/to/file.ts edit" works correctly.

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN_NAME = process.platform === 'win32' ? 'mobitty-cli.cmd' : 'mobitty-cli';

export function resolveCliBin(): string | null {
  const thisDir = dirname(fileURLToPath(import.meta.url));

  // 1. Look for installed shim (production / global install)
  let dir = thisDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'node_modules', '.bin', BIN_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 2. Fall back to source file invocation (dev mode)
  const sourceFile = join(thisDir, 'mobitty-cli.ts');
  if (existsSync(sourceFile)) {
    return `${process.execPath} ${sourceFile}`;
  }

  // 3. Try compiled .js (esbuild release output)
  const compiledFile = join(thisDir, 'mobitty-cli.js');
  if (existsSync(compiledFile)) {
    return `${process.execPath} ${compiledFile}`;
  }

  return null;
}
