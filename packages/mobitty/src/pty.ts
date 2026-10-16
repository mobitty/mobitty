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

  const handle: PtyHandle = {
    pid: shell.pid,
    pty: shell,
    paused: false,
    columns: options.columns,
    rows: options.rows,
    exited: false,
    killed: false,
    killTimer: null,
  };

  shell.onData(callbacks.onData);
  shell.onExit(({ exitCode, signal }) => {
    handle.exited = true;
    if (handle.killTimer) {
      clearTimeout(handle.killTimer);
      handle.killTimer = null;
    }
    callbacks.onExit(exitCode, signal);
  });

  return handle;
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

/**
 * Grace period between the polite SIGHUP and the SIGKILL that guarantees the
 * child is gone. POSIX only — see `killPty`.
 */
export const KILL_ESCALATION_MS = 2000;

/**
 * Terminate a session's child process.
 *
 * SIGHUP alone is not a guarantee. A shell can ignore it outright (`trap "" HUP`),
 * and node-pty's `kill()` is fire-and-forget against a pid that may still be
 * mid-exec, so under load the signal is occasionally lost entirely. A survivor
 * keeps node-pty's master-fd read stream open, which keeps the host's event loop
 * alive forever — that is what wedges `node --test` with no output. So escalate:
 * SIGHUP first so the shell can run its exit traps, SIGKILL after a grace period
 * if it is still there. The timer is unref'd so it never by itself delays exit,
 * and it is gated on `exited` so a recycled pid can never be hit.
 *
 * Windows has no signals and needs no escalation. node-pty's Windows `kill()`
 * is already a hard kill — `TerminateProcess` on the shell (conpty.dll), or
 * `ClosePseudoConsole` plus `TerminateProcess` on every process attached to the
 * console (in-box ConPTY) — and it throws if handed a signal at all. Calling it
 * a second time is not a retry either: it re-closes the pseudoconsole and
 * re-disposes the conout worker. So on Windows the one `kill()` is the whole job.
 *
 * Either way the pty is killed at most once per handle (`killed`).
 */
export function killPty(
  handle: PtyHandle,
  escalationMs = KILL_ESCALATION_MS,
  platform: NodeJS.Platform = process.platform,
): void {
  if (handle.exited || handle.killed) return;
  handle.killed = true;
  handle.pty.kill();
  if (platform === 'win32') return;
  handle.killTimer = setTimeout(() => {
    handle.killTimer = null;
    if (handle.exited) return;
    // An exception here is uncaught and takes the whole server down, and there
    // is no caller left to report it to. The escalation is best-effort: a child
    // that cannot be signalled has either already died (its exit event still in
    // flight) or is beyond anything a second attempt could do.
    try {
      handle.pty.kill('SIGKILL');
    } catch {
      /* best-effort; see above */
    }
  }, escalationMs);
  handle.killTimer.unref();
}
