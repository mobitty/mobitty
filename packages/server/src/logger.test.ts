import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLogger, Logger } from './logger.ts';
import type { LogEntry } from './types.ts';

function readJsonl(filePath: string): LogEntry[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf-8').trim();
  if (content === '') return [];
  return content.split('\n').map(line => JSON.parse(line) as LogEntry);
}

describe('Logger', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-logger-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates logs directory and server.jsonl', () => {
    const logger = createLogger('info', 'debug', tmpDir);
    logger.info('test message');
    logger.close();

    assert.ok(existsSync(join(tmpDir, 'logs', 'server.jsonl')));
  });

  it('writes JSONL entries to server.jsonl', () => {
    const logger = createLogger('info', 'debug', tmpDir);
    logger.info('hello', { key: 'value' });
    logger.warn('warning');
    logger.close();

    const entries = readJsonl(join(tmpDir, 'logs', 'server.jsonl'));
    assert.equal(entries.length, 2);

    const first = entries[0]!;
    assert.equal(first.seq, 1);
    assert.equal(first.level, 'info');
    assert.equal(first.source, 'server');
    assert.equal(first.msg, 'hello');
    assert.deepEqual(first.data, { key: 'value' });
    assert.ok(!('session' in first));
    assert.ok(first.ts);

    const second = entries[1]!;
    assert.equal(second.seq, 2);
    assert.equal(second.level, 'warn');
    assert.equal(second.msg, 'warning');
    assert.equal(second.data, undefined);
  });

  it('respects file log level', () => {
    const logger = createLogger('debug', 'warn', tmpDir);
    logger.debug('skipped');
    logger.info('also skipped');
    logger.warn('kept');
    logger.error('also kept');
    logger.close();

    const entries = readJsonl(join(tmpDir, 'logs', 'server.jsonl'));
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.level, 'warn');
    assert.equal(entries[1]!.level, 'error');
  });

  it('increments seq monotonically', () => {
    const logger = createLogger('error', 'debug', tmpDir);
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.close();

    const entries = readJsonl(join(tmpDir, 'logs', 'server.jsonl'));
    assert.deepEqual(entries.map(e => e.seq), [1, 2, 3]);
  });
});

describe('SessionLogger', () => {
  let tmpDir: string;
  let logger: Logger;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-logger-test-'));
    logger = createLogger('error', 'debug', tmpDir);
  });

  afterEach(() => {
    logger.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates per-session JSONL file', () => {
    const sessionLogger = logger.createSessionLogger('test-session-id');
    sessionLogger.info('session started');
    sessionLogger.close();

    const filePath = join(tmpDir, 'logs', 'test-session-id.jsonl');
    assert.ok(existsSync(filePath));

    const entries = readJsonl(filePath);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.session, 'test-session-id');
    assert.equal(entries[0]!.source, 'server');
    assert.equal(entries[0]!.msg, 'session started');
  });

  it('writes client logs with clientSeq', () => {
    const sessionLogger = logger.createSessionLogger('sess-abc');
    sessionLogger.info('server log');
    sessionLogger.clientLog('warn', 'client warning', 5, { detail: 'x' });
    sessionLogger.close();

    const entries = readJsonl(join(tmpDir, 'logs', 'sess-abc.jsonl'));
    assert.equal(entries.length, 2);

    const serverEntry = entries[0]!;
    assert.equal(serverEntry.seq, 1);
    assert.equal(serverEntry.source, 'server');
    assert.equal(serverEntry.clientSeq, undefined);

    const clientEntry = entries[1]!;
    assert.equal(clientEntry.seq, 2);
    assert.equal(clientEntry.source, 'client');
    assert.equal(clientEntry.clientSeq, 5);
    assert.equal(clientEntry.level, 'warn');
    assert.equal(clientEntry.msg, 'client warning');
    assert.deepEqual(clientEntry.data, { detail: 'x' });
  });

  it('respects file log level for session logs', () => {
    const restrictedLogger = createLogger('error', 'warn', tmpDir);
    const sessionLogger = restrictedLogger.createSessionLogger('sess-filtered');
    sessionLogger.debug('skip');
    sessionLogger.info('skip');
    sessionLogger.warn('keep');
    sessionLogger.error('keep');
    sessionLogger.close();
    restrictedLogger.close();

    const entries = readJsonl(join(tmpDir, 'logs', 'sess-filtered.jsonl'));
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.level, 'warn');
    assert.equal(entries[1]!.level, 'error');
  });

  it('maintains independent seq per session', () => {
    const s1 = logger.createSessionLogger('sess-1');
    const s2 = logger.createSessionLogger('sess-2');
    s1.info('a');
    s2.info('b');
    s1.info('c');
    s2.info('d');
    s1.close();
    s2.close();

    const e1 = readJsonl(join(tmpDir, 'logs', 'sess-1.jsonl'));
    const e2 = readJsonl(join(tmpDir, 'logs', 'sess-2.jsonl'));
    assert.deepEqual(e1.map(e => e.seq), [1, 2]);
    assert.deepEqual(e2.map(e => e.seq), [1, 2]);
  });

  it('close is safe to call multiple times', () => {
    const sessionLogger = logger.createSessionLogger('sess-safe');
    sessionLogger.info('test');
    sessionLogger.close();
    sessionLogger.close();
  });
});

