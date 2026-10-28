import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { installLifecycleLogging, SHUTDOWN_SIGNALS } from './lifecycle.ts';
import type { ShutdownSignal } from './lifecycle.ts';
import type { LogEntry } from './types.ts';

interface Recorded { level: 'info' | 'error'; msg: string; data?: Record<string, unknown> }

function fakeLogger() {
  const entries: Recorded[] = [];
  let closed = false;
  return {
    entries,
    get closed() { return closed; },
    info(msg: string, data?: Record<string, unknown>) { entries.push({ level: 'info', msg, data }); },
    error(msg: string, data?: Record<string, unknown>) { entries.push({ level: 'error', msg, data }); },
    close() { closed = true; },
  };
}

describe('installLifecycleLogging', () => {
  it('logs uncaught exceptions with origin and stack', () => {
    const proc = new EventEmitter();
    const logger = fakeLogger();
    installLifecycleLogging(logger, () => {}, proc);

    proc.emit('uncaughtExceptionMonitor', new Error('boom'), 'uncaughtException');

    assert.equal(logger.entries.length, 1);
    const [entry] = logger.entries;
    assert.equal(entry!.level, 'error');
    assert.equal(entry!.msg, 'uncaught exception');
    assert.equal(entry!.data?.['origin'], 'uncaughtException');
    assert.match(String(entry!.data?.['error']), /Error: boom/);
  });

  it('logs a clean exit at info and closes the logger', () => {
    const proc = new EventEmitter();
    const logger = fakeLogger();
    installLifecycleLogging(logger, () => {}, proc);

    proc.emit('exit', 0);

    assert.deepEqual(logger.entries, [{ level: 'info', msg: 'process exit', data: { code: 0 } }]);
    assert.ok(logger.closed);
  });

  it('logs a non-zero exit at error', () => {
    const proc = new EventEmitter();
    const logger = fakeLogger();
    installLifecycleLogging(logger, () => {}, proc);

    proc.emit('exit', 7);

    assert.deepEqual(logger.entries, [{ level: 'error', msg: 'process exit', data: { code: 7 } }]);
  });

  it('routes every shutdown signal to shutdown with its name', () => {
    const proc = new EventEmitter();
    const received: ShutdownSignal[] = [];
    installLifecycleLogging(fakeLogger(), (signal) => received.push(signal), proc);

    for (const signal of SHUTDOWN_SIGNALS) proc.emit(signal);

    assert.deepEqual(received, [...SHUTDOWN_SIGNALS]);
  });
});

// End-to-end: a real process with a real file logger, so the records are
// proven to land on disk before the process is gone.
describe('lifecycle logging in a child process', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-lifecycle-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeScript(body: string): string {
    const here = (name: string) => JSON.stringify(pathToFileURL(join(import.meta.dirname, name)).href);
    const script = join(tmpDir, 'child.ts');
    writeFileSync(script, `
import { createLogger } from ${here('logger.ts')};
import { installLifecycleLogging } from ${here('lifecycle.ts')};
const logger = createLogger({
  consoleLevel: 'error', fileLevel: 'debug', dataFolder: ${JSON.stringify(tmpDir)},
  rotationMs: 86400000, retentionMs: 604800000,
});
installLifecycleLogging(logger, (signal) => { logger.info('shutting down...', { signal }); process.exit(0); });
${body}
`);
    return script;
  }

  function readLog(): LogEntry[] {
    const logsDir = join(tmpDir, 'logs');
    return readdirSync(logsDir)
      .filter(f => f.endsWith('.jsonl'))
      .flatMap(f => readFileSync(join(logsDir, f), 'utf-8').trim().split('\n'))
      .filter(line => line !== '')
      .map(line => JSON.parse(line) as LogEntry);
  }

  it('records the stack and exit code of an uncaught exception', () => {
    const script = writeScript(`setTimeout(() => { throw new Error('child boom'); }, 0);`);
    const result = spawnSync(process.execPath, [script], { encoding: 'utf-8' });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /child boom/, 'default stderr report must be preserved');
    const log = readLog();
    const uncaught = log.find(e => e.msg === 'uncaught exception');
    assert.ok(uncaught, `no uncaught exception record: ${JSON.stringify(log)}`);
    assert.match(String(uncaught.data?.['error']), /child boom/);
    assert.deepEqual(log.at(-1)?.data, { code: 1 });
    assert.equal(log.at(-1)?.msg, 'process exit');
  });

  it('records an unhandled rejection', () => {
    const script = writeScript(`void Promise.reject(new Error('child reject'));`);
    const result = spawnSync(process.execPath, [script], { encoding: 'utf-8' });

    assert.equal(result.status, 1);
    const uncaught = readLog().find(e => e.msg === 'uncaught exception');
    assert.equal(uncaught?.data?.['origin'], 'unhandledRejection');
    assert.match(String(uncaught?.data?.['error']), /child reject/);
  });

  it('records the code of an explicit process.exit()', () => {
    const script = writeScript(`process.exit(3);`);
    const result = spawnSync(process.execPath, [script], { encoding: 'utf-8' });

    assert.equal(result.status, 3);
    const last = readLog().at(-1);
    assert.equal(last?.msg, 'process exit');
    assert.deepEqual(last?.data, { code: 3 });
  });

  // Windows cannot deliver a catchable signal to another process: kill()
  // terminates it outright. The signal routing is covered by the unit test.
  it('records SIGHUP as a graceful shutdown', { skip: process.platform === 'win32' }, async () => {
    const script = writeScript(`console.log('ready'); setInterval(() => {}, 1000);`);
    const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()));
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
    child.kill('SIGHUP');

    assert.equal(await exited, 0);
    const log = readLog();
    assert.ok(log.some(e => e.msg === 'shutting down...' && e.data?.['signal'] === 'SIGHUP'), JSON.stringify(log));
    assert.deepEqual(log.at(-1)?.data, { code: 0 });
  });
});
