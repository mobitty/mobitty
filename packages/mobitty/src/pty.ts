import * as pty from 'node-pty';
import type { PtyHandle } from './types.ts';

interface SpawnOptions {
  argv: string[];
  terminalType: string;
  columns: number;
  rows: number;
  env?: Record<string, string>;
  cwd?: string;
}

interface PtyCallbacks {
  onData: (data: string) => void;
  onExit: (exitCode: number, signal: number | undefined) => void;
}

export function spawnPty(options: SpawnOptions, callbacks: PtyCallbacks): PtyHandle {
  const command = options.argv[0];
  if (!command) throw new Error('No command specified');
  const args = options.argv.slice(1);

  // Strip terminal-multiplexer vars that cause programs (e.g. Claude Code) to
  // misdetect the terminal, wrap OSC in DCS passthrough, or cap color support.
  // See docs/done-design-terminal-env.md for rationale.
  const parentEnv = { ...process.env };
  delete parentEnv['TMUX'];
  delete parentEnv['TMUX_PANE'];
  delete parentEnv['STY'];
  delete parentEnv['TERM_PROGRAM'];
  delete parentEnv['TERM_PROGRAM_VERSION'];
  const env: Record<string, string> = {
    ...parentEnv,
    TERM: options.terminalType,
    TERM_PROGRAM: 'mobitty',
    COLORTERM: 'truecolor',
    ...options.env,
  };

  const shell = pty.spawn(command, args, {
    name: options.terminalType,
    cols: options.columns,
    rows: options.rows,
    cwd: options.cwd ?? process.cwd(),
    env,
  });

  shell.onData(callbacks.onData);
  shell.onExit(({ exitCode, signal }) => {
    callbacks.onExit(exitCode, signal);
  });

  return {
    pid: shell.pid,
    pty: shell,
    paused: false,
    columns: options.columns,
    rows: options.rows,
  };
}

export function writePty(handle: PtyHandle, data: string): void {
  handle.pty.write(data);
}

/** A resize that lost the race with the child's death: node-pty knows the pty
 *  is gone but has not told us yet. ConPTY throws on the exit code it already
 *  recorded; POSIX fails the ioctl because the master fd is closed. */
function isExitedPtyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return message.includes('already exited')     // Windows (ConPTY)
    || message.includes('ioctl(2) failed');     // POSIX (closed master fd)
}

/** Resize the pty. Returns false if the child had already exited.
 *
 *  node-pty learns of the exit before it emits `exit` — on Windows the event
 *  waits for the conpty data pipe to drain and close, which lags the exit and
 *  for some shells never happens at all. Resizing inside that window throws
 *  synchronously in whichever socket handler asked for the resize, which is an
 *  uncaught exception that kills the server. Checking liveness first cannot
 *  close the race (the child can exit between the check and the syscall), so
 *  the failure is reported to the caller instead: it means the session is
 *  dead, which is news the caller is expected to act on. */
export function resizePty(handle: PtyHandle, columns: number, rows: number): boolean {
  handle.columns = columns;
  handle.rows = rows;
  try {
    handle.pty.resize(columns, rows);
    return true;
  } catch (error) {
    if (isExitedPtyError(error)) return false;
    throw error;
  }
}

export function pausePty(handle: PtyHandle): void {
  if (handle.paused) return;
  handle.paused = true;
  handle.pty.pause();
}

export function resumePty(handle: PtyHandle): void {
  if (!handle.paused) return;
  handle.paused = false;
  handle.pty.resume();
}

export function killPty(handle: PtyHandle): void {
  handle.pty.kill();
}
