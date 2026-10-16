import { describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { IPty } from 'node-pty';
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

/** A handle whose pty never exits and, like node-pty's Windows backend, throws
 *  when `kill()` is given a signal. Records every `kill()` call. */
function fakeHandle(): { handle: PtyHandle; kills: Array<string | undefined> } {
  const kills: Array<string | undefined> = [];
  const pty = {
    kill(signal?: string) {
      kills.push(signal);
      if (signal) throw new Error('Signals not supported on windows.');
    },
  } as unknown as IPty;
  const handle: PtyHandle = {
    pid: 0, pty, paused: false, columns: 80, rows: 24,
    exited: false, killed: false, killTimer: null,
  };
  return { handle, kills };
}

// Runs on every platform: the fakes stand in for node-pty's backends. An
// exception thrown from the escalation timer is uncaught, so it fails this
// file — on a real server it would take the whole process down.
describe('killPty escalation safety', () => {
  it('does not escalate on Windows, where kill() with a signal throws', async () => {
    const { handle, kills } = fakeHandle();
    killPty(handle, 10, 'win32');
    assert.equal(handle.killTimer, null, 'no escalation should be armed on Windows');
    await delay(50);
    assert.deepEqual(kills, [undefined], 'only the signal-less kill() should be sent');
  });

  it('is idempotent on Windows — a second call does not kill() again', () => {
    const { handle, kills } = fakeHandle();
    killPty(handle, 10, 'win32');
    killPty(handle, 10, 'win32');
    assert.deepEqual(kills, [undefined]);
  });

  it('a throwing SIGKILL escalation does not raise an uncaught exception', async () => {
    const { handle, kills } = fakeHandle();
    killPty(handle, 10, 'linux');
    assert.notEqual(handle.killTimer, null, 'escalation should be armed on POSIX');
    await delay(50);
    assert.deepEqual(kills, [undefined, 'SIGKILL']);
    assert.equal(handle.killTimer, null);
  });
});
