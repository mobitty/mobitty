import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SessionRegistry } from './sessions.ts';

// Minimal logger for tests
const noop = () => {};
const logger = { debug: noop, info: noop, warn: noop, error: noop, isEnabled: () => false };

// We can't easily create real sessions (requires node-pty), so we test
// the editor methods by constructing a registry and manually verifying
// the public interface via the methods that don't require a live PTY.
// For integration, the stop-hook's `pnpm run check` covers type correctness.

describe('SessionRegistry editor methods', () => {
  let registry: SessionRegistry;
  const tmpDir = '/tmp/mobitty-cli-test-' + process.pid;

  beforeEach(() => {
    registry = new SessionRegistry(tmpDir, logger);
  });

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
    registry.setEditorSender('nonexistent', (_filePath: string, _content: string, _contentType?: string) => {});
    registry.clearEditorSender('nonexistent');
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
    registry.setDownloadSender('nonexistent', (_fileName: string, _fileSize: number, _token: string) => {});
    registry.clearDownloadSender('nonexistent');
  });
});
