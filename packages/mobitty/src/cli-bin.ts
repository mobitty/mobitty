// Resolves the command string for invoking a mobitty CLI bin.
//
// Strategy:
// 1. Look for an installed bin shim by walking up from this file:
//    a. node_modules/.bin/<binName>[.cmd] — local/npx installs
//    b. (Windows) <binName>.cmd directly in parent — global installs
//       where npm places shims in the prefix dir, not node_modules/.bin/
// 2. Fall back to "<node> <source-path>" for dev mode.
//
// For `mobitty-cli-edit`, the returned string is set as $EDITOR / $VISUAL
// directly. It MUST be a single path with no arguments — some consumers
// (e.g. GitHub Copilot's terminal) don't word-split the env var and exec
// the whole value as one binary path.
//
// When the fallback path contains spaces (e.g. "C:\Program Files\..."),
// use ensureCliBinShim() to create a wrapper script that resolves to a
// single token without embedded spaces.

import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_WIN32 = process.platform === 'win32';

export function resolveCliBin(binName: string): string | null {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const shimName = IS_WIN32 ? `${binName}.cmd` : binName;

  // 1. Look for installed shim
  let dir = thisDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'node_modules', '.bin', shimName);
    if (existsSync(candidate)) return candidate;
    // Windows global installs: npm places shims directly in the prefix
    // dir (e.g. C:\.npm-global\mobitty-cli.cmd), not node_modules/.bin/.
    if (IS_WIN32) {
      const globalCandidate = join(dir, shimName);
      if (existsSync(globalCandidate)) return globalCandidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 2. Fall back to source file invocation (dev mode)
  const sourceFile = join(thisDir, `${binName}.ts`);
  if (existsSync(sourceFile)) {
    return `${process.execPath} ${sourceFile}`;
  }

  // 3. Try compiled .js (release output)
  const compiledFile = join(thisDir, `${binName}.js`);
  if (existsSync(compiledFile)) {
    return `${process.execPath} ${compiledFile}`;
  }

  return null;
}

/** If cliBinPath contains spaces (e.g. fallback with "C:\Program Files\..."
 *  in process.execPath), create a wrapper shim in dataFolder/bin/ and return
 *  the wrapper path. Otherwise return cliBinPath unchanged. */
export function ensureCliBinShim(cliBinPath: string, dataFolder: string, binName: string): string {
  if (!cliBinPath.includes(' ')) return cliBinPath;

  const binDir = join(dataFolder, 'bin');
  const shimName = IS_WIN32 ? `${binName}.cmd` : binName;
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
