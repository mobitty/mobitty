// Resolves the path to the `download` bin shim.
//
// Used by protocol.ts to determine the directory to prepend to PATH
// so that `download <path>` is callable from the shell.

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN_NAME = process.platform === 'win32' ? 'download.cmd' : 'download';

export function resolveDownloadBin(): string | null {
  const thisDir = dirname(fileURLToPath(import.meta.url));

  // Look for installed shim (node_modules/.bin/download)
  let dir = thisDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'node_modules', '.bin', BIN_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}
