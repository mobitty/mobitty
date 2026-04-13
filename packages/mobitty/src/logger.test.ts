import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, readdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLogger } from './logger.ts';
import type { LoggerConfig } from './logger.ts';
import type { LogEntry } from './types.ts';

function readJsonl(filePath: string): LogEntry[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf-8').trim();
  if (content === '') return [];
  return content.split('\n').map(line => JSON.parse(line) as LogEntry);
}

function logFiles(logsDir: string): string[] {
  return readdirSync(logsDir).filter(f => f.endsWith('.jsonl')).sort();
}

function makeConfig(tmpDir: string, overrides?: Partial<LoggerConfig>): LoggerConfig {
  return {
    consoleLevel: 'error',
    fileLevel: 'debug',
    dataFolder: tmpDir,
    rotationMs: 86400000,
    retentionMs: 604800000,
    ...overrides,
  };
}

describe('Logger', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-logger-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates logs directory and a rotating JSONL file', () => {
    const logger = createLogger(makeConfig(tmpDir));
    logger.info('test message');
    logger.close();

    const logsDir = join(tmpDir, 'logs');
    assert.ok(existsSync(logsDir));
    const files = logFiles(logsDir);
    assert.equal(files.length, 1);
    assert.ok(files[0]!.endsWith('.jsonl'));
  });

  it('writes JSONL entries with correct structure', () => {
    const logger = createLogger(makeConfig(tmpDir));
    logger.info('hello', { key: 'value' });
    logger.warn('warning');
    logger.close();

    const logsDir = join(tmpDir, 'logs');
    const files = logFiles(logsDir);
    const entries = readJsonl(join(logsDir, files[0]!));
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
  });

  it('respects file log level', () => {
    const logger = createLogger(makeConfig(tmpDir, { fileLevel: 'warn' }));
    logger.debug('skipped');
    logger.info('also skipped');
    logger.warn('kept');
    logger.error('also kept');
    logger.close();

    const logsDir = join(tmpDir, 'logs');
    const files = logFiles(logsDir);
    const entries = readJsonl(join(logsDir, files[0]!));
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.level, 'warn');
    assert.equal(entries[1]!.level, 'error');
  });

  it('increments seq monotonically across all loggers', () => {
    const logger = createLogger(makeConfig(tmpDir));
    logger.debug('a');
    const child = logger.child({ address: '1.2.3.4' });
    child.info('b');
    logger.warn('c');
    logger.close();

    const logsDir = join(tmpDir, 'logs');
    const files = logFiles(logsDir);
    const entries = readJsonl(join(logsDir, files[0]!));
    assert.deepEqual(entries.map(e => e.seq), [1, 2, 3]);
  });
});

describe('Logger.child()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-logger-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('inherits context and merges into data', () => {
    const logger = createLogger(makeConfig(tmpDir));
    const child = logger.child({ address: '1.2.3.4' });
    child.info('test', { extra: true });
    logger.close();

    const logsDir = join(tmpDir, 'logs');
    const files = logFiles(logsDir);
    const entries = readJsonl(join(logsDir, files[0]!));
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0]!.data, { address: '1.2.3.4', extra: true });
  });

  it('promotes session from context to top-level field', () => {
    const logger = createLogger(makeConfig(tmpDir));
    const child = logger.child({ address: '1.2.3.4' });
    child.set('session', 'test-session-id');
    child.info('test');
    logger.close();

    const logsDir = join(tmpDir, 'logs');
    const files = logFiles(logsDir);
    const entries = readJsonl(join(logsDir, files[0]!));
    assert.equal(entries[0]!.session, 'test-session-id');
    // address should be in data, session should NOT be in data
    assert.equal(entries[0]!.data?.['address'], '1.2.3.4');
    assert.equal(entries[0]!.data?.['session'], undefined);
  });

  it('shares seq counter with parent', () => {
    const logger = createLogger(makeConfig(tmpDir));
    const c1 = logger.child({});
    const c2 = logger.child({});
    logger.info('a');
    c1.info('b');
    c2.info('c');
    logger.close();

    const logsDir = join(tmpDir, 'logs');
    const files = logFiles(logsDir);
    const entries = readJsonl(join(logsDir, files[0]!));
    assert.deepEqual(entries.map(e => e.seq), [1, 2, 3]);
  });
});

describe('Logger.set()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-logger-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('mutates context reflected in subsequent writes', () => {
    const logger = createLogger(makeConfig(tmpDir));
    const child = logger.child({ address: '1.2.3.4' });
    child.info('before');
    child.set('session', 'sess-abc');
    child.info('after');
    logger.close();

    const logsDir = join(tmpDir, 'logs');
    const files = logFiles(logsDir);
    const entries = readJsonl(join(logsDir, files[0]!));
    assert.equal(entries[0]!.session, undefined);
    assert.equal(entries[1]!.session, 'sess-abc');
  });
});

describe('Logger.clientLog()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-logger-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes client-sourced entries with clientSeq', () => {
    const logger = createLogger(makeConfig(tmpDir));
    const child = logger.child({});
    child.set('session', 'sess-abc');
    child.info('server log');
    child.clientLog('warn', 'client warning', 5, { detail: 'x' });
    logger.close();

    const logsDir = join(tmpDir, 'logs');
    const files = logFiles(logsDir);
    const entries = readJsonl(join(logsDir, files[0]!));
    assert.equal(entries.length, 2);

    const serverEntry = entries[0]!;
    assert.equal(serverEntry.source, 'server');
    assert.equal(serverEntry.clientSeq, undefined);

    const clientEntry = entries[1]!;
    assert.equal(clientEntry.source, 'client');
    assert.equal(clientEntry.clientSeq, 5);
    assert.equal(clientEntry.level, 'warn');
    assert.equal(clientEntry.msg, 'client warning');
  });

  it('uses client-provided timestamp when given', () => {
    const logger = createLogger(makeConfig(tmpDir));
    const child = logger.child({});
    const clientTs = '2026-01-01T00:00:00.000Z';
    child.clientLog('info', 'buffered log', 1, undefined, clientTs);
    logger.close();

    const logsDir = join(tmpDir, 'logs');
    const files = logFiles(logsDir);
    const entries = readJsonl(join(logsDir, files[0]!));
    assert.equal(entries[0]!.ts, clientTs);
  });
});

describe('Logger.close()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-logger-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stops writing after close', () => {
    const logger = createLogger(makeConfig(tmpDir));
    logger.info('before');
    logger.close();
    logger.info('after');

    const logsDir = join(tmpDir, 'logs');
    const files = logFiles(logsDir);
    const entries = readJsonl(join(logsDir, files[0]!));
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.msg, 'before');
  });
});

describe('LogWriter rotation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-logger-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates files based on rotation interval', () => {
    // Use a very short rotation to verify file naming
    const logger = createLogger(makeConfig(tmpDir, { rotationMs: 86400000 }));
    logger.info('test');
    logger.close();

    const logsDir = join(tmpDir, 'logs');
    const files = logFiles(logsDir);
    assert.equal(files.length, 1);
    // File should match YYYY-MM-DDTHH-MM.jsonl pattern
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}\.jsonl$/.test(files[0]!), `unexpected filename: ${files[0]}`);
  });
});

describe('LogWriter cleanup', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-logger-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deletes old log files on startup', () => {
    const logsDir = join(tmpDir, 'logs');
    mkdirSync(logsDir, { recursive: true });
    const oldFile = join(logsDir, '2020-01-01T00-00.jsonl');
    writeFileSync(oldFile, '{"seq":1}\n');
    // Set mtime to the past
    const past = new Date('2020-01-01T00:00:00Z');
    utimesSync(oldFile, past, past);

    assert.ok(existsSync(oldFile));

    // Create logger with 7d retention — old file should be cleaned up
    const logger = createLogger(makeConfig(tmpDir, { retentionMs: 604800000 }));
    logger.info('current');
    logger.close();

    assert.ok(!existsSync(oldFile), 'old file should have been deleted');
    // Current file should still exist
    const files = logFiles(logsDir);
    assert.ok(files.length >= 1);
  });
});
