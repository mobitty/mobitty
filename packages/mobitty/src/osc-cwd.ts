// OSC 7 — current working directory reporting.
// Format: `\e]7;file://hostname/path\e\\` (path is URL-encoded).
// Emitted by fish, macOS Terminal.app's zsh, and bash with PROMPT_COMMAND.

import type { Terminal } from '@xterm/headless';

type CwdCallback = (cwd: string) => void;

/**
 * Parse the body of an OSC 7 sequence (the part after `7;`).
 * Returns the absolute path, or null if malformed.
 */
export function parseOsc7(data: string): string | null {
  if (!data.startsWith('file://')) return null;
  const afterScheme = data.substring('file://'.length);
  const slash = afterScheme.indexOf('/');
  if (slash === -1) return null;
  const encodedPath = afterScheme.substring(slash);
  try {
    const decoded = decodeURIComponent(encodedPath);
    if (!decoded.startsWith('/')) return null;
    return decoded;
  } catch {
    return null;
  }
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
