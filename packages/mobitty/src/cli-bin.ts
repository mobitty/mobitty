// Resolves the command string for invoking `mobitty-cli`.
//
// Strategy:
// 1. Look for an installed bin shim by walking up from this file:
//    a. node_modules/.bin/mobitty-cli[.cmd] — local/npx installs
//    b. (Windows) mobitty-cli.cmd directly in parent — global installs
//       where npm places shims in the prefix dir, not node_modules/.bin/
// 2. Fall back to "<node> <source-path>" for dev mode.
//
// The returned string is set as $EDITOR / $VISUAL (with " edit" appended).
// Both shells and tools like Claude Code word-split this before exec, so
// the value MUST be a single token or space-free multi-token string.
// When the fallback path contains spaces (e.g. "C:\Program Files\..."),
// use ensureCliBinShim() to create a wrapper script.

import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_WIN32 = process.platform === 'win32';
const BIN_NAME = IS_WIN32 ? 'mobitty-cli.cmd' : 'mobitty-cli';

export function resolveCliBin(): string | null {
  const thisDir = dirname(fileURLToPath(import.meta.url));

  // 1. Look for installed shim
  let dir = thisDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'node_modules', '.bin', BIN_NAME);
    if (existsSync(candidate)) return candidate;
    // Windows global installs: npm places shims directly in the prefix
    // dir (e.g. C:\.npm-global\mobitty-cli.cmd), not node_modules/.bin/.
    if (IS_WIN32) {
      const globalCandidate = join(dir, BIN_NAME);
      if (existsSync(globalCandidate)) return globalCandidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 2. Fall back to source file invocation (dev mode)
  const sourceFile = join(thisDir, 'mobitty-cli.ts');
  if (existsSync(sourceFile)) {
    return `${process.execPath} ${sourceFile}`;
  }

  // 3. Try compiled .js (release output)
  const compiledFile = join(thisDir, 'mobitty-cli.js');
  if (existsSync(compiledFile)) {
    return `${process.execPath} ${compiledFile}`;
  }

  return null;
}

/** If cliBinPath contains spaces (e.g. fallback with "C:\Program Files\..."
 *  in process.execPath), create a wrapper shim in dataFolder/bin/ and return
 *  the wrapper path. Otherwise return cliBinPath unchanged. */
export function ensureCliBinShim(cliBinPath: string, dataFolder: string): string {
  if (!cliBinPath.includes(' ')) return cliBinPath;

  const binDir = join(dataFolder, 'bin');
  const shimName = IS_WIN32 ? 'mobitty-cli.cmd' : 'mobitty-cli';
  const shimPath = join(binDir, shimName);
  if (existsSync(shimPath)) return shimPath;

  // The fallback format is "<node> <script>" — split into components.
  // process.execPath is the first token; the rest is the script path.
  const spaceIdx = cliBinPath.indexOf(' ');
  const nodePath = cliBinPath.slice(0, spaceIdx);
  const scriptPath = cliBinPath.slice(spaceIdx + 1);

  mkdirSync(binDir, { recursive: true });
  if (IS_WIN32) {
    writeFileSync(shimPath, `@"${nodePath}" "${scriptPath}" %*\r\n`);
  } else {
    writeFileSync(shimPath, `#!/bin/sh\nexec "${nodePath}" "${scriptPath}" "$@"\n`);
    chmodSync(shimPath, 0o755);
  }
  return shimPath;
}
