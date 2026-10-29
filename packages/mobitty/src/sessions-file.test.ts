import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionRegistry, parseSessionsFile } from './sessions.ts';

const validEntry = {
  sessionId: 'a1b2c3', name: 'quiet-otter', pid: 12345,
  createdAt: '2026-10-01T00:00:00.000Z', command: '/bin/sh', shell: 'sh',
};

describe('parseSessionsFile', () => {
  it('returns valid entries unchanged', () => {
    const result = parseSessionsFile({ sessions: [validEntry] });
    assert.deepEqual(result, { sessions: [validEntry], skipped: 0 });
  });

  it('rejects a file that is not an object with a sessions array', () => {
    for (const data of [null, 42, 'x', [validEntry], {}, { sessions: 'nope' }, { sessions: {} }]) {
      assert.equal(parseSessionsFile(data), undefined, JSON.stringify(data));
    }
  });

  it('drops malformed entries and counts them', () => {
    const result = parseSessionsFile({
      sessions: [
        validEntry,
        null,
        'x',
        { ...validEntry, sessionId: 7 },
        { ...validEntry, pid: '12345' },
        { sessionId: 'old', name: 'n' },
      ],
    });
    assert.deepEqual(result, { sessions: [validEntry], skipped: 5 });
  });
});

describe('SessionRegistry loading sessions.json', () => {
  let tmpDir: string;
  let registry: SessionRegistry | undefined;
  let warnings: string[];
  const logger = {
    debug() {},
    info() {},
    warn(msg: string) { warnings.push(msg); },
    error() {},
    isEnabled() { return false; },
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-sessions-file-test-'));
    warnings = [];
    registry = undefined;
  });

  afterEach(() => {
    registry?.destroyAll();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function load(content: string): SessionRegistry {
    writeFileSync(join(tmpDir, 'sessions.json'), content);
    registry = new SessionRegistry(tmpDir, logger);
    registry.init();
    return registry;
  }

  it('loads a valid file as dead sessions with the saved fields', () => {
    const list = load(JSON.stringify({ sessions: [validEntry] })).listSessions();
    assert.equal(list.length, 1);
    const s = list[0];
    assert.ok(s);
    assert.equal(s.sessionId, validEntry.sessionId);
    assert.equal(s.name, validEntry.name);
    assert.equal(s.pid, validEntry.pid);
    assert.equal(s.createdAt, validEntry.createdAt);
    assert.equal(s.command, validEntry.command);
    assert.equal(s.shell, validEntry.shell);
    assert.equal(s.alive, false);
    assert.deepEqual(warnings, []);
  });

  it('starts with no sessions and no warning when the file is missing', () => {
    registry = new SessionRegistry(tmpDir, logger);
    registry.init();
    assert.equal(registry.listSessions().length, 0);
    assert.deepEqual(warnings, []);
  });

  it('rejects and logs a file that is not JSON', () => {
    assert.equal(load('{ not json').listSessions().length, 0);
    assert.equal(warnings.length, 1);
  });

  it('rejects and logs a file in the wrong shape', () => {
    assert.equal(load(JSON.stringify([validEntry])).listSessions().length, 0);
    assert.equal(warnings.length, 1);
  });

  it('keeps the good entries and logs the malformed ones', () => {
    const r = load(JSON.stringify({ sessions: [validEntry, { sessionId: 'x', pid: 'nope' }] }));
    assert.deepEqual(r.listSessions().map(s => s.sessionId), [validEntry.sessionId]);
    assert.equal(warnings.length, 1);
  });

  it('does not overwrite a rejected file on load', () => {
    load('{ not json');
    assert.equal(readFileSync(join(tmpDir, 'sessions.json'), 'utf-8'), '{ not json');
  });
});
