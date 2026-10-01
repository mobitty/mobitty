import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const CLI = join(import.meta.dirname, 'mobitty-cli.ts');

/** Run this checkout's mobitty-cli with only the given MOBITTY_* vars. */
function runCli(args: string[], env: Record<string, string>) {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('MOBITTY_')),
  );
  return spawnSync(process.execPath, [CLI, ...args], {
    env: { ...base, ...env },
    encoding: 'utf-8',
  });
}

describe('mobitty-cli delegation to the session CLI', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-cli-delegate-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('re-runs the session-named CLI with the same arguments and exit status', () => {
    const other = join(tmpDir, 'other-cli.mjs');
    writeFileSync(other, 'process.stdout.write(JSON.stringify(process.argv.slice(2))); process.exit(7);\n');
    const result = runCli(['view', 'some dir'], { MOBITTY_CLI_SCRIPT: other });
    assert.equal(result.status, 7);
    assert.deepEqual(JSON.parse(result.stdout), ['view', 'some dir']);
  });

  it('runs itself when the session names this same CLI', () => {
    const result = runCli(['view', '.'], { MOBITTY_CLI_SCRIPT: CLI });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing MOBITTY_SESSION_ID/);
  });

  it('runs itself when the named CLI no longer exists', () => {
    const result = runCli(['view', '.'], { MOBITTY_CLI_SCRIPT: join(tmpDir, 'gone.ts') });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing MOBITTY_SESSION_ID/);
  });
});
