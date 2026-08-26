import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionRegistry } from './sessions.ts';

// Minimal logger for tests
const noop = () => {};
const logger = { debug: noop, info: noop, warn: noop, error: noop, isEnabled: () => false };

const testShellArgv = process.platform === 'win32' ? ['cmd.exe'] : ['/bin/sh'];

describe('SessionRegistry editor methods', () => {
  let registry: SessionRegistry;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-cli-test-'));
    registry = new SessionRegistry(tmpDir, logger);
    registry.init();
  });

  afterEach(() => {
    registry.destroyAll();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const newSession = () =>
    registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh').info.sessionId;

  it('getEditorPending returns undefined for unknown session', () => {
    assert.equal(registry.getEditorPending('nonexistent'), undefined);
  });

  it('requestEdit rejects for unknown session', async () => {
    const noopAbort = (_cleanup: () => void) => {};
    await assert.rejects(
      () => registry.requestEdit('nonexistent', '/tmp/f.txt', 'hello', noopAbort),
      { message: 'Session not found' },
    );
  });

  it('completeEdit returns false for unknown session', () => {
    assert.equal(registry.completeEdit('nonexistent', 'x', false), false);
  });

  it('setEditorSender / clearEditorSender are no-ops for unknown session', () => {
    // Should not throw
    const fn = (_filePath: string, _content: string, _contentType?: string) => {};
    registry.setEditorSender('nonexistent', fn);
    registry.clearEditorSender('nonexistent', fn);
  });

  it('requestEdit rejects for unknown session with contentType', async () => {
    const noopAbort = (_cleanup: () => void) => {};
    await assert.rejects(
      () => registry.requestEdit('nonexistent', '/tmp/img.png', 'base64data', noopAbort, 'image/png'),
      { message: 'Session not found' },
    );
  });

  it('getDownloadSender returns null for unknown session', () => {
    assert.equal(registry.getDownloadSender('nonexistent'), null);
  });

  it('setDownloadSender / clearDownloadSender are no-ops for unknown session', () => {
    // Should not throw
    const fn = (_fileName: string, _fileSize: number, _token: string) => {};
    registry.setDownloadSender('nonexistent', fn);
    registry.clearDownloadSender('nonexistent', fn);
  });

  it('clearEditorSender clears the sender when it is still the registered one', async () => {
    const sessionId = newSession();
    const sender = () => {};
    registry.setEditorSender(sessionId, sender);
    registry.clearEditorSender(sessionId, sender);

    await assert.rejects(
      () => registry.requestEdit(sessionId, '/tmp/f.txt', 'hello', () => {}),
      { message: 'No client connected' },
    );
  });

  // Regression: a replaced connection's late `close` used to wipe the sender
  // its replacement had already registered, leaving a live client stranded and
  // every later $EDITOR invocation failing with 503. sessions.test.ts covers
  // the same hazard for the clipboard sender.
  it('a stale connection clearing its sender does not wipe the replacement', async () => {
    const sessionId = newSession();
    const staleSender = () => assert.fail('stale sender must not be used');
    const opened: string[] = [];
    const liveSender = (filePath: string) => { opened.push(filePath); };

    registry.setEditorSender(sessionId, staleSender);  // old connection attaches
    registry.setEditorSender(sessionId, liveSender);   // replacement attaches
    registry.clearEditorSender(sessionId, staleSender); // old socket's close lands late

    const pending = registry.requestEdit(sessionId, '/tmp/f.txt', 'hello', () => {});
    assert.deepEqual(opened, ['/tmp/f.txt']);
    registry.completeEdit(sessionId, 'saved', false);
    assert.deepEqual(await pending, { content: 'saved', cancelled: false });
  });

  it('a stale connection clearing its download sender does not wipe the replacement', () => {
    const sessionId = newSession();
    const staleSender = () => {};
    const liveSender = () => {};

    registry.setDownloadSender(sessionId, staleSender);
    registry.setDownloadSender(sessionId, liveSender);
    registry.clearDownloadSender(sessionId, staleSender);

    assert.equal(registry.getDownloadSender(sessionId), liveSender);
  });

  // Regression: the abort hook was registered on the request, which Node had
  // already closed, so a dead CLI leaked `editorPending` and the next edit in
  // that session failed with 409 until a client cancelled the stale panel.
  it('abort clears editorPending, settles the promise, and unblocks the next edit', async () => {
    const sessionId = newSession();
    registry.setEditorSender(sessionId, () => {});

    let abort: (() => void) | undefined;
    const aborted = registry.requestEdit(sessionId, '/tmp/f.txt', 'hello', (cleanup) => { abort = cleanup; });
    assert.deepEqual(registry.getEditorPending(sessionId), { filePath: '/tmp/f.txt', content: 'hello' });

    abort?.();
    assert.equal(registry.getEditorPending(sessionId), undefined);
    assert.deepEqual(await aborted, { content: 'hello', cancelled: true });

    // No lingering 'Edit already in progress'
    const next = registry.requestEdit(sessionId, '/tmp/f.txt', 'again', () => {});
    registry.completeEdit(sessionId, 'saved', false);
    assert.deepEqual(await next, { content: 'saved', cancelled: false });
  });

  it('abort after completion does not clobber a newer pending edit', async () => {
    const sessionId = newSession();
    registry.setEditorSender(sessionId, () => {});

    let firstAbort: (() => void) | undefined;
    const first = registry.requestEdit(sessionId, '/tmp/a.txt', 'a', (cleanup) => { firstAbort = cleanup; });
    registry.completeEdit(sessionId, 'a-saved', false);
    assert.deepEqual(await first, { content: 'a-saved', cancelled: false });

    const second = registry.requestEdit(sessionId, '/tmp/b.txt', 'b', () => {});
    firstAbort?.(); // the first response's 'close' fires only now
    assert.deepEqual(registry.getEditorPending(sessionId), { filePath: '/tmp/b.txt', content: 'b' });

    registry.completeEdit(sessionId, 'b-saved', false);
    assert.deepEqual(await second, { content: 'b-saved', cancelled: false });
  });
});
