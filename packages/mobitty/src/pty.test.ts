import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnPty, killPty } from './pty.ts';
import type { PtyHandle } from './types.ts';

const posix = process.platform !== 'win32';

interface Spawned {
  handle: PtyHandle;
  /** Resolves with the signal that killed the child, or undefined if it exited normally. */
  exited: Promise<number | undefined>;
  /** Resolves once the child has written `marker`, so kills don't race its startup. */
  ready: (marker: string) => Promise<void>;
}

function spawnWithExit(argv: string[]): Spawned {
  let resolveExit: (signal: number | undefined) => void;
  const exited = new Promise<number | undefined>(resolve => { resolveExit = resolve; });
  let output = '';
  const waiters: Array<() => void> = [];
  const handle = spawnPty(
    { argv, terminalType: 'xterm-256color', columns: 80, rows: 24 },
    {
      onData: data => { output += data; for (const w of waiters.splice(0)) w(); },
      onExit: (_code, signal) => resolveExit(signal),
    },
  );
  const ready = (marker: string) => new Promise<void>(resolve => {
    const check = () => {
      if (output.includes(marker)) resolve();
      else waiters.push(check);
    };
    check();
  });
  return { handle, exited, ready };
}

describe('killPty', { skip: !posix }, () => {
  it('kills a well-behaved shell with SIGHUP', async () => {
    const { handle, exited } = spawnWithExit(['/bin/sh']);
    killPty(handle, 5000);
    assert.equal(await exited, 1, 'shell should exit on SIGHUP, not the escalation');
    assert.ok(handle.exited);
    assert.equal(handle.killTimer, null, 'escalation timer should be cleared on exit');
  });

  // A survivor keeps node-pty's master-fd read stream open, which keeps the host
  // process's event loop alive forever. Under `node --test` that wedges the whole
  // run with no output — see docs/done-bug-server-test-suite-hangs.md.
  it('escalates to SIGKILL when the child ignores SIGHUP', async () => {
    const { handle, exited, ready } = spawnWithExit([
      '/bin/sh', '-c', 'trap "" HUP; echo trapped; while :; do sleep 0.2; done',
    ]);
    await ready('trapped');
    killPty(handle, 100);
    assert.equal(await exited, 9, 'child should have been SIGKILLed');
    assert.ok(handle.exited);
  });

  it('is idempotent — a second call does not re-arm the escalation', async () => {
    const { handle, exited } = spawnWithExit(['/bin/sh']);
    killPty(handle, 5000);
    const armed = handle.killTimer;
    killPty(handle, 5000);
    assert.equal(handle.killTimer, armed, 'second call should reuse the pending escalation');
    await exited;
  });
});
