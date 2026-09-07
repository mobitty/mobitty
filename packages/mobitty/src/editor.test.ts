import { describe, it, beforeEach, afterEach, mock } from 'node:test';
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
    const fn = (_editId: number, _filePath: string, _content: string, _contentType?: string) => true;
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
    const sender = () => true;
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
    const liveSender = (_editId: number, filePath: string) => { opened.push(filePath); return true; };

    registry.setEditorSender(sessionId, staleSender);  // old connection attaches
    registry.setEditorSender(sessionId, liveSender);   // replacement attaches
    registry.clearEditorSender(sessionId, staleSender); // old socket's close lands late

    const pending = registry.requestEdit(sessionId, '/tmp/f.txt', 'hello', () => {});
    assert.deepEqual(opened, ['/tmp/f.txt']);
    registry.completeEdit(sessionId, 'saved', false);
    assert.deepEqual(await pending, { content: 'saved', cancelled: false });
  });

  // Regression: a sender registered by a socket that is no longer writable used
  // to swallow EDITOR_OPEN. The client showed no panel, so no EDITOR_DONE ever
  // came back and `mobitty-cli-edit` blocked forever on a live-looking session.
  it('a sender that cannot send fails the edit instead of leaving it pending', async () => {
    const sessionId = newSession();
    registry.setEditorSender(sessionId, () => false);

    await assert.rejects(
      () => registry.requestEdit(sessionId, '/tmp/f.txt', 'hello', () => {}),
      { message: 'No client connected' },
    );
    assert.equal(registry.getEditorPending(sessionId), undefined);

    // The failed attempt must not leave a 409 behind for the next one
    registry.setEditorSender(sessionId, () => true);
    const next = registry.requestEdit(sessionId, '/tmp/f.txt', 'hello', () => {});
    registry.completeEdit(sessionId, 'saved', false);
    assert.deepEqual(await next, { content: 'saved', cancelled: false });
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
    registry.setEditorSender(sessionId, () => true);

    let abort: (() => void) | undefined;
    const aborted = registry.requestEdit(sessionId, '/tmp/f.txt', 'hello', (cleanup) => { abort = cleanup; });
    assert.partialDeepStrictEqual(registry.getEditorPending(sessionId), { filePath: '/tmp/f.txt', content: 'hello' });

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
    registry.setEditorSender(sessionId, () => true);

    let firstAbort: (() => void) | undefined;
    const first = registry.requestEdit(sessionId, '/tmp/a.txt', 'a', (cleanup) => { firstAbort = cleanup; });
    registry.completeEdit(sessionId, 'a-saved', false);
    assert.deepEqual(await first, { content: 'a-saved', cancelled: false });

    const second = registry.requestEdit(sessionId, '/tmp/b.txt', 'b', () => {});
    firstAbort?.(); // the first response's 'close' fires only now
    assert.partialDeepStrictEqual(registry.getEditorPending(sessionId), { filePath: '/tmp/b.txt', content: 'b' });

    registry.completeEdit(sessionId, 'b-saved', false);
    assert.deepEqual(await second, { content: 'b-saved', cancelled: false });
  });

  // ── Edit id + panel ack ───────────────────────────────────────────────────
  // A successful ws.send() only proves the bytes left the server. The ack is
  // the client saying "the overlay is on screen"; the edit id keeps a stale
  // panel from answering for a newer edit.

  const captureSender = () => {
    const sent: number[] = [];
    const fn = (editId: number) => { sent.push(editId); return true; };
    return { sent, fn };
  };

  it('EDITOR_OPEN carries an edit id that the ack must match', async () => {
    const sessionId = newSession();
    const { sent, fn } = captureSender();
    registry.setEditorSender(sessionId, fn);

    const pending = registry.requestEdit(sessionId, '/tmp/f.txt', 'hello', () => {});
    const editId = sent[0]!;
    assert.equal(registry.getEditorPending(sessionId)?.editId, editId);

    assert.equal(registry.ackEdit(sessionId, editId + 999), false); // wrong id
    assert.equal(registry.ackEdit(sessionId, editId), true);
    assert.equal(registry.ackEdit(sessionId, editId), true);        // idempotent

    registry.completeEdit(sessionId, 'saved', false, editId);
    assert.deepEqual(await pending, { content: 'saved', cancelled: false });
  });

  it('ack for a session with no pending edit is refused', () => {
    const sessionId = newSession();
    assert.equal(registry.ackEdit(sessionId, 1), false);
    assert.equal(registry.ackEdit('nonexistent', 1), false);
  });

  // Regression: an EDITOR_DONE queued through a reconnect (or sent by a panel
  // the user left open) used to resolve whatever edit was pending at the time,
  // handing a *newer* edit the older panel's content.
  it('a stale edit id does not complete a newer edit', async () => {
    const sessionId = newSession();
    const { sent, fn } = captureSender();
    registry.setEditorSender(sessionId, fn);

    const first = registry.requestEdit(sessionId, '/tmp/a.txt', 'a', () => {});
    const firstId = sent[0]!;
    registry.completeEdit(sessionId, 'a-saved', false, firstId);
    assert.deepEqual(await first, { content: 'a-saved', cancelled: false });

    const second = registry.requestEdit(sessionId, '/tmp/b.txt', 'b', () => {});
    // The first panel's Cancel arrives late — it must not resolve the second edit
    assert.equal(registry.completeEdit(sessionId, 'stale', true, firstId), false);
    assert.partialDeepStrictEqual(registry.getEditorPending(sessionId), { filePath: '/tmp/b.txt' });

    registry.completeEdit(sessionId, 'b-saved', false, sent[1]!);
    assert.deepEqual(await second, { content: 'b-saved', cancelled: false });
  });

  // A client that predates the edit id still completes its edit rather than
  // hanging the CLI forever.
  it('an EDITOR_DONE without an edit id still completes the pending edit', async () => {
    const sessionId = newSession();
    registry.setEditorSender(sessionId, () => true);

    const pending = registry.requestEdit(sessionId, '/tmp/f.txt', 'hello', () => {});
    assert.equal(registry.completeEdit(sessionId, 'saved', false), true);
    assert.deepEqual(await pending, { content: 'saved', cancelled: false });
  });

  it('an unacked EDITOR_OPEN is re-sent once, and not again after that', async () => {
    const sessionId = newSession();
    const { sent, fn } = captureSender();
    registry.setEditorSender(sessionId, fn);

    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pending = registry.requestEdit(sessionId, '/tmp/f.txt', 'hello', () => {});
      assert.equal(sent.length, 1);

      mock.timers.tick(2000);
      assert.deepEqual(sent, [sent[0], sent[0]]);   // re-sent, same edit id

      mock.timers.tick(2000);
      assert.equal(sent.length, 2);                 // gives up chasing the ack

      // The edit is still pending — a missing ack is not a reason to fail it
      assert.equal(registry.getEditorPending(sessionId)?.editId, sent[0]);
      registry.completeEdit(sessionId, 'saved', false, sent[0]!);
      assert.deepEqual(await pending, { content: 'saved', cancelled: false });
    } finally {
      mock.timers.reset();
    }
  });

  it('an acked EDITOR_OPEN is never re-sent', async () => {
    const sessionId = newSession();
    const { sent, fn } = captureSender();
    registry.setEditorSender(sessionId, fn);

    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pending = registry.requestEdit(sessionId, '/tmp/f.txt', 'hello', () => {});
      registry.ackEdit(sessionId, sent[0]!);

      mock.timers.tick(10_000);
      assert.equal(sent.length, 1);

      registry.completeEdit(sessionId, 'saved', false, sent[0]!);
      assert.deepEqual(await pending, { content: 'saved', cancelled: false });
    } finally {
      mock.timers.reset();
    }
  });
});
