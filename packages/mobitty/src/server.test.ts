import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LogEntry } from './types.ts';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

describe('server startup output', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-server-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prints the listen URL and shells untagged at default levels, logged at info', { skip: process.platform === 'win32' }, async () => {
    const port = await freePort();
    const child = spawn(process.execPath, [join(import.meta.dirname, 'main.ts'), '--port', String(port), '--interface', '127.0.0.1', '--no-tls'], {
      env: { ...process.env, MOBITTY_DATA_FOLDER: tmpDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => { out += chunk; });
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', (chunk: string) => {
        out += chunk;
        if (out.includes('shells:')) resolve();
      });
      child.once('exit', (code) => reject(new Error(`server exited (${code}): ${out}`)));
    });
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    await exited;

    assert.match(out, new RegExp(`^\\[mobitty\\] Listening on http://127\\.0\\.0\\.1:${port}$`, 'm'));
    assert.match(out, /^\[mobitty\] shells: /m);
    assert.doesNotMatch(out, /WARN/);

    const logsDir = join(tmpDir, 'logs');
    const log = readdirSync(logsDir)
      .filter(f => f.endsWith('.jsonl'))
      .flatMap(f => readFileSync(join(logsDir, f), 'utf-8').trim().split('\n'))
      .filter(line => line !== '')
      .map(line => JSON.parse(line) as LogEntry);
    const listening = log.find(e => e.msg.startsWith('Listening on'));
    assert.equal(listening?.level, 'info');
    assert.equal(listening?.seq, 1);
    assert.ok(!log.some(e => e.level === 'warn'), JSON.stringify(log));
  });
});
