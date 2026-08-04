// Resolves the command for invoking a mobitty CLI bin.
//
// Strategy:
// 1. Look for an installed bin shim by walking up from this file:
//    a. node_modules/.bin/<binName>[.cmd] — local/npx installs
//    b. (Windows) <binName>.cmd directly in parent — global installs
//       where npm places shims in the prefix dir, not node_modules/.bin/
// 2. Fall back to invoking the source (dev) or compiled (release) entry
//    under process.execPath.
//
// These two outcomes are different *shapes*, not one string: an installed
// shim is a single executable path, while the fallback is a (node, script)
// pair. CliBin keeps them apart so no consumer has to recover the boundary
// by splitting on whitespace — process.execPath is itself multi-token on
// Windows ("C:\Program Files\nodejs\node.exe"), so any such split is wrong.
//
// For `mobitty-cli-edit`, the value ultimately handed to $EDITOR / $VISUAL
// MUST be a single path with no arguments — some consumers (e.g. GitHub
// Copilot's terminal) don't word-split the env var and exec the whole value
// as one binary path. ensureCliBinShim() collapses either shape down to one
// such path.

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_WIN32 = process.platform === 'win32';

/** How a CLI bin should be invoked. Either an installed shim that is directly
 *  executable, or a script that must be run under a specific node binary. */
export type CliBin =
  | { kind: 'shim'; shimPath: string }
  | { kind: 'node'; nodePath: string; scriptPath: string };

export function resolveCliBin(binName: string): CliBin | null {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const shimName = IS_WIN32 ? `${binName}.cmd` : binName;

  // 1. Look for installed shim
  let dir = thisDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'node_modules', '.bin', shimName);
    if (existsSync(candidate)) return { kind: 'shim', shimPath: candidate };
    // Windows global installs: npm places shims directly in the prefix
    // dir (e.g. C:\.npm-global\mobitty-cli.cmd), not node_modules/.bin/.
    if (IS_WIN32) {
      const globalCandidate = join(dir, shimName);
      if (existsSync(globalCandidate)) return { kind: 'shim', shimPath: globalCandidate };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 2. Fall back to source file invocation (dev mode)
  const sourceFile = join(thisDir, `${binName}.ts`);
  if (existsSync(sourceFile)) {
    return { kind: 'node', nodePath: process.execPath, scriptPath: sourceFile };
  }

  // 3. Try compiled .js (release output)
  const compiledFile = join(thisDir, `${binName}.js`);
  if (existsSync(compiledFile)) {
    return { kind: 'node', nodePath: process.execPath, scriptPath: compiledFile };
  }

  return null;
}

/** Render the wrapper script that forwards to `bin` verbatim. */
function shimContents(bin: CliBin): string {
  const argv = bin.kind === 'shim' ? [bin.shimPath] : [bin.nodePath, bin.scriptPath];
  const quoted = argv.map((a) => `"${a}"`).join(' ');
  return IS_WIN32 ? `@${quoted} %*\r\n` : `#!/bin/sh\nexec ${quoted} "$@"\n`;
}

/** Collapse `bin` to a single executable path with no arguments and no
 *  embedded spaces, suitable for $EDITOR / $VISUAL.
 *
 *  An installed shim whose path has no spaces is returned as-is. Anything
 *  else gets a wrapper script in dataFolder/bin/ — a `kind: 'node'` bin is
 *  two tokens by construction, and a shim path containing a space would be
 *  word-split by consumers that do split.
 *
 *  The wrapper is rewritten whenever its contents drift (node upgraded,
 *  checkout moved, or a wrapper left behind by an older buggy version), so
 *  stale shims self-heal instead of persisting until manually deleted. */
export function ensureCliBinShim(bin: CliBin, dataFolder: string, binName: string): string {
  if (bin.kind === 'shim' && !bin.shimPath.includes(' ')) return bin.shimPath;

  const binDir = join(dataFolder, 'bin');
  const shimName = IS_WIN32 ? `${binName}.cmd` : binName;
  const shimPath = join(binDir, shimName);
  const contents = shimContents(bin);

  let existing: string | null = null;
  try {
    existing = readFileSync(shimPath, 'utf-8');
  } catch {
    // Missing or unreadable — fall through and write it.
  }
  if (existing === contents) return shimPath;

  mkdirSync(binDir, { recursive: true });
  writeFileSync(shimPath, contents);
  if (!IS_WIN32) chmodSync(shimPath, 0o755);
  return shimPath;
}
