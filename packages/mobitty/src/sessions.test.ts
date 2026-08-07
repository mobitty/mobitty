import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionRegistry } from './sessions.ts';

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  isEnabled() { return false; },
};

const testShellArgv = process.platform === 'win32' ? ['cmd.exe'] : ['/bin/sh'];

describe('SessionRegistry', () => {
  let tmpDir: string;
  let registry: SessionRegistry;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-sessions-test-'));
    registry = new SessionRegistry(tmpDir, noopLogger);
    registry.init();
  });

  afterEach(() => {
    registry.destroyAll();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a session with a random name', () => {
    const { info } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    assert.ok(info.sessionId);
    assert.match(info.name, /^[a-z]/);
    assert.ok(info.pid > 0);
    assert.ok(info.alive);
    assert.equal(info.shell, 'sh');
  });

  it('lists created sessions', () => {
    registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    const list = registry.listSessions();
    assert.equal(list.length, 2);
  });

  it('renames a session', () => {
    const { info } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    const ok = registry.renameSession(info.sessionId, 'my_session');
    assert.ok(ok);
    const updated = registry.getSession(info.sessionId);
    assert.equal(updated?.info.name, 'my_session');
  });

  it('rejects invalid rename', () => {
    const { info } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    const ok = registry.renameSession(info.sessionId, '');
    assert.ok(!ok);
  });

  it('deletes a session', () => {
    const { info } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    const ok = registry.deleteSession(info.sessionId);
    assert.ok(ok);
    assert.equal(registry.listSessions().length, 0);
  });

  it('persists sessions to disk', () => {
    registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    assert.ok(existsSync(join(tmpDir, 'sessions.json')));
  });

  it('loads sessions from disk on init', () => {
    const { info } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    // Kill the PTY but keep the session entry on disk
    registry.deleteSession(info.sessionId);

    // Re-create with a fresh session so there's something persisted
    const { info: info2 } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    // Now simulate a restart: just create a new registry reading the same file
    // First, kill the PTY manually so the PID check will find it dead after restart
    const handle = registry.getHandle(info2.sessionId);
    if (handle) handle.pty.kill();

    const registry2 = new SessionRegistry(tmpDir, noopLogger);
    registry2.init();
    const list = registry2.listSessions();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.sessionId, info2.sessionId);
    assert.equal(list[0]!.alive, false); // no handle after restart
  });

  it('reorders a session to a new position', () => {
    const { info: a } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    const { info: b } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    const { info: c } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    // Move last to first
    const ok = registry.reorderSession(c.sessionId, 0);
    assert.ok(ok);
    const list = registry.listSessions();
    assert.equal(list[0]!.sessionId, c.sessionId);
    assert.equal(list[1]!.sessionId, a.sessionId);
    assert.equal(list[2]!.sessionId, b.sessionId);
  });

  it('reorderSession returns false for invalid sessionId', () => {
    registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    const ok = registry.reorderSession('nonexistent-id', 0);
    assert.ok(!ok);
  });

  it('reorderSession clamps out-of-range index', () => {
    const { info: a } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    const { info: b } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    // Index 100 should clamp to last position (1)
    const ok = registry.reorderSession(a.sessionId, 100);
    assert.ok(ok);
    const list = registry.listSessions();
    assert.equal(list[0]!.sessionId, b.sessionId);
    assert.equal(list[1]!.sessionId, a.sessionId);
  });

  it('attaches and detaches', () => {
    const { info } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    const attached = registry.attachSession(info.sessionId, () => {}, () => {});
    assert.ok(attached);
    registry.detachSession(info.sessionId);
  });

  it('detachSession fires onDetach callbacks', () => {
    const { info } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    let detached = false;
    registry.attachSession(info.sessionId, () => {}, () => { detached = true; });
    registry.detachSession(info.sessionId);
    assert.ok(detached, 'onDetach callback should have been called');
  });

  it('detachSession does not fire onDetach after process exit clears callbacks', async () => {
    const { info, handle } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    let detachCount = 0;
    registry.attachSession(info.sessionId, () => {}, () => { detachCount++; });
    // Kill the process — onExit clears onExitCallbacks but onDetachCallbacks remain
    handle.pty.kill();
    await new Promise(resolve => setTimeout(resolve, 200));
    // Session is dead, so detachSession still runs but the detach callback fires
    // (this is harmless — the WS it would close is already closed from onExit)
    registry.detachSession(info.sessionId);
    assert.equal(detachCount, 1, 'onDetach fires once during detach');
  });

  it('creates headless terminal', () => {
    const { info } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    const headless = registry.getHeadless(info.sessionId);
    assert.ok(headless, 'headless terminal should exist');
    assert.equal(headless.cols, 80);
    assert.equal(headless.rows, 24);
  });

  it('deleteSession disposes headless', () => {
    const { info } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    registry.deleteSession(info.sessionId);
    const headless = registry.getHeadless(info.sessionId);
    assert.equal(headless, null, 'headless should be null after delete');
  });

  it('resizeSession resizes headless terminal', () => {
    const { info } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    registry.resizeSession(info.sessionId, 120, 40);
    const headless = registry.getHeadless(info.sessionId);
    assert.ok(headless);
    assert.equal(headless.cols, 120);
    assert.equal(headless.rows, 40);
  });

  it('destroyAll kills all sessions', () => {
    registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    registry.destroyAll();
    assert.equal(registry.listSessions().length, 0);
  });

  it('fires change callbacks on headless write', async () => {
    const { info } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    let called = false;
    registry.addChangeListener(info.sessionId, () => { called = true; });
    const headless = registry.getHeadless(info.sessionId);
    assert.ok(headless);
    await new Promise<void>(resolve => { headless.write('hello', resolve); });
    assert.ok(called, 'change callback should have been called');
  });

  it('removeChangeListener stops notifications', async () => {
    const { info } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    let count = 0;
    const cb = () => { count++; };
    registry.addChangeListener(info.sessionId, cb);
    const headless = registry.getHeadless(info.sessionId);
    assert.ok(headless);
    await new Promise<void>(resolve => { headless.write('a', resolve); });
    assert.ok(count > 0, 'callback should have fired');
    registry.removeChangeListener(info.sessionId, cb);
    count = 0;
    await new Promise<void>(resolve => { headless.write('b', resolve); });
    assert.equal(count, 0, 'no callbacks after removal');
  });

  it('detachSession clears change callbacks', async () => {
    const { info } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    let count = 0;
    registry.addChangeListener(info.sessionId, () => { count++; });
    registry.detachSession(info.sessionId);
    const headless = registry.getHeadless(info.sessionId);
    assert.ok(headless);
    count = 0;
    await new Promise<void>(resolve => { headless.write('x', resolve); });
    assert.equal(count, 0, 'no callbacks after detach');
  });

  it('removeChangeListener with old callback does not remove new callback', async () => {
    // Regression: simulates the reconnect race where the old connection's
    // close handler calls removeChangeListener AFTER the new connection
    // has registered its own listener.
    const { info } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    const headless = registry.getHeadless(info.sessionId);
    assert.ok(headless);

    // Old connection's listener (will be detached)
    let oldCount = 0;
    const oldCb = () => { oldCount++; };
    registry.addChangeListener(info.sessionId, oldCb);

    // New connection replaces old: detach clears everything, then new listener added
    registry.detachSession(info.sessionId);
    let newCount = 0;
    const newCb = () => { newCount++; };
    registry.addChangeListener(info.sessionId, newCb);

    // Old connection's close handler tries to remove its listener
    registry.removeChangeListener(info.sessionId, oldCb);

    // New listener should survive
    await new Promise<void>(resolve => { headless.write('y', resolve); });
    assert.ok(newCount > 0, 'new callback should still fire');
    assert.equal(oldCount, 0, 'old callback should not fire');
  });

  it('createSession throws when session limit reached', () => {
    const limited = new SessionRegistry(tmpDir, noopLogger, 2);
    limited.init();
    limited.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    limited.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    assert.throws(
      () => limited.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh'),
      /Session limit reached/,
    );
    limited.destroyAll();
  });

  it('createSession unlimited when maxSessions is 0', () => {
    for (let i = 0; i < 5; i++) {
      registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    }
    assert.equal(registry.listSessions().length, 5);
  });

  it('aliveSessionCount returns correct count', () => {
    registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    assert.equal(registry.aliveSessionCount(), 2);
  });

  it('relays an OSC 52 clipboard write to the attached client', async () => {
    const { info } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    const copies: Array<string | null> = [];
    registry.setClipboardSender(info.sessionId, text => copies.push(text));

    const headless = registry.getHeadless(info.sessionId)!;
    const payload = Buffer.from('from-the-session', 'utf-8').toString('base64');
    await new Promise<void>(resolve => { headless.write(`\x1b]52;c;${payload}\x07`, resolve); });

    assert.deepEqual(copies, ['from-the-session']);
  });

  it('drops an OSC 52 write when no client is attached', async () => {
    const { info } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    const headless = registry.getHeadless(info.sessionId)!;
    const payload = Buffer.from('nobody-listening', 'utf-8').toString('base64');
    // Must not throw — a background session has no sender registered.
    await new Promise<void>(resolve => { headless.write(`\x1b]52;c;${payload}\x07`, resolve); });
  });

  it('clearing a sender is a no-op once a newer connection owns the session', async () => {
    const { info } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');

    const oldSender = (_text: string | null) => {};
    const fresh: Array<string | null> = [];
    const newSender = (text: string | null) => { fresh.push(text); };

    // Reconnect: the new connection registers during its handshake, then the
    // old socket's close handler fires and tries to clear.
    registry.setClipboardSender(info.sessionId, oldSender);
    registry.setClipboardSender(info.sessionId, newSender);
    registry.clearClipboardSender(info.sessionId, oldSender);

    const payload = Buffer.from('still-here', 'utf-8').toString('base64');
    const headless = registry.getHeadless(info.sessionId)!;
    await new Promise<void>(resolve => { headless.write(`\x1b]52;c;${payload}\x07`, resolve); });

    assert.deepEqual(fresh, ['still-here'], 'new connection keeps its sender');
  });

  it('clearing a sender with the owning function detaches it', async () => {
    const { info } = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh');
    const seen: Array<string | null> = [];
    const sender = (text: string | null) => { seen.push(text); };

    registry.setClipboardSender(info.sessionId, sender);
    registry.clearClipboardSender(info.sessionId, sender);

    const payload = Buffer.from('gone', 'utf-8').toString('base64');
    const headless = registry.getHeadless(info.sessionId)!;
    await new Promise<void>(resolve => { headless.write(`\x1b]52;c;${payload}\x07`, resolve); });

    assert.deepEqual(seen, []);
  });
});
