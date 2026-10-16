// OSC 7 — current working directory reporting.
// Format: `\e]7;file://hostname/path\e\\` (path is URL-encoded).
// Emitted by fish natively, and by the hooks shell-discovery.ts installs:
// zsh, bash, POSIX sh/dash/ksh, cmd, Git Bash, WSL bash, and PowerShell via
// shell-init/pwsh-cwd-hook.ps1.

import type { Terminal } from '@xterm/headless';

type CwdCallback = (cwd: string) => void;

/**
 * Parse the body of an OSC 7 sequence (the part after `7;`).
 * Returns the absolute path, or null if malformed.
 * On Windows, only Windows paths are accepted and returned native:
 * `/C:/foo` or `/C:\foo` (cmd's `$P`) → `C:\foo`, `//server/share` → `\\server\share`.
 * Anything else (e.g. `/home/me` from fish inside WSL) is not a path the
 * server can use, so it is rejected rather than misread as `<drive>:\home\me`.
 */
export function parseOsc7(data: string, platform: NodeJS.Platform = process.platform): string | null {
  if (!data.startsWith('file://')) return null;
  const afterScheme = data.substring('file://'.length);
  const slash = afterScheme.indexOf('/');
  if (slash === -1) return null;
  const encodedPath = afterScheme.substring(slash);
  let decoded: string;
  try {
    decoded = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/')) return null;
  if (platform === 'win32') {
    if (/^\/[A-Za-z]:([\\/]|$)/.test(decoded)) {
      const native = decoded.slice(1).replace(/\//g, '\\');
      return native.length === 2 ? native + '\\' : native;
    }
    if (/^\/\/[^/]/.test(decoded)) return decoded.replace(/\//g, '\\');
    return null;
  }
  return decoded;
}

/**
 * Register an OSC 7 handler on a headless terminal.
 * The callback fires with the decoded absolute path each time the shell reports cwd.
 * Returns false from the handler so other OSC 7 listeners can chain.
 */
export function registerCwdHandler(terminal: Terminal, onCwd: CwdCallback): void {
  terminal.parser.registerOscHandler(7, (data: string) => {
    const path = parseOsc7(data);
    if (path) onCwd(path);
    return false;
  });
}
