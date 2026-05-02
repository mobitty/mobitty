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

export function resizePty(handle: PtyHandle, columns: number, rows: number): void {
  handle.columns = columns;
  handle.rows = rows;
  handle.pty.resize(columns, rows);
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
