import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveCliBin, ensureCliBinShim } from './cli-bin.ts';
import type { CliBin } from './cli-bin.ts';

// Windows' default Node install path — the case that broke the original
// first-space split, since process.execPath is itself multi-token there.
const NODE_WITH_SPACE = 'C:\\Program Files\\nodejs\\node.exe';
const SCRIPT = 'D:\\checkout\\mobitty\\dist\\src\\mobitty-cli-edit.js';

describe('ensureCliBinShim', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-cli-bin-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('quotes node and script as separate tokens when the node path has a space', () => {
    const bin: CliBin = { kind: 'node', nodePath: NODE_WITH_SPACE, scriptPath: SCRIPT };
    const shimPath = ensureCliBinShim(bin, tmpDir, 'mobitty-cli-edit');
    const body = readFileSync(shimPath, 'utf-8');

    assert.ok(body.includes(`"${NODE_WITH_SPACE}"`), `node path not one token: ${body}`);
    assert.ok(body.includes(`"${SCRIPT}"`), `script path not one token: ${body}`);
    // The historical bug split at the first space, emitting `"C:\Program"`.
    assert.ok(!body.includes('"C:\\Program"'), `wrapper mis-split: ${body}`);
  });

  it('rewrites a stale wrapper rather than trusting whatever is on disk', () => {
    const bin: CliBin = { kind: 'node', nodePath: NODE_WITH_SPACE, scriptPath: SCRIPT };
    const shimPath = ensureCliBinShim(bin, tmpDir, 'mobitty-cli-edit');

    // Simulate the malformed wrapper left behind by the pre-fix version.
    writeFileSync(shimPath, '@"C:\\Program" "Files\\nodejs\\node.exe junk" %*\r\n');

    const again = ensureCliBinShim(bin, tmpDir, 'mobitty-cli-edit');
    assert.equal(again, shimPath);
    const body = readFileSync(shimPath, 'utf-8');
    assert.ok(body.includes(`"${NODE_WITH_SPACE}"`), `stale wrapper not healed: ${body}`);
    assert.ok(!body.includes('"C:\\Program"'), `stale wrapper not healed: ${body}`);
  });

  it('returns a space-free installed shim unchanged and writes nothing', () => {
    const shimPath = join('/opt/npm-global/bin', 'mobitty-cli-edit');
    const result = ensureCliBinShim({ kind: 'shim', shimPath }, tmpDir, 'mobitty-cli-edit');

    assert.equal(result, shimPath);
    assert.ok(!existsSync(join(tmpDir, 'bin')), 'should not create a wrapper dir');
  });

  it('wraps an installed shim whose own path contains a space', () => {
    const shimPath = 'C:\\Program Files\\nodejs\\mobitty-cli-edit.cmd';
    const result = ensureCliBinShim({ kind: 'shim', shimPath }, tmpDir, 'mobitty-cli-edit');

    assert.notEqual(result, shimPath);
    const body = readFileSync(result, 'utf-8');
    assert.ok(body.includes(`"${shimPath}"`), `shim path not one token: ${body}`);
  });

  it('keeps the wrapper path free of the spaces it was created to remove', () => {
    const bin: CliBin = { kind: 'node', nodePath: NODE_WITH_SPACE, scriptPath: SCRIPT };
    const shimPath = ensureCliBinShim(bin, tmpDir, 'mobitty-cli-edit');
    // Only guaranteed when dataFolder itself is space-free; see the known
    // limitation in done-bug-cli-bin-shim-spaces.md.
    assert.ok(!shimPath.slice(tmpDir.length).includes(' '));
  });
});

describe('resolveCliBin', () => {
  it('returns a discriminated shape, never a flat command string', () => {
    const bin = resolveCliBin('mobitty-cli-edit');
    if (bin === null) return; // not resolvable in this tree; nothing to assert
    if (bin.kind === 'shim') {
      assert.ok(bin.shimPath.length > 0);
    } else {
      assert.equal(bin.kind, 'node');
      assert.equal(bin.nodePath, process.execPath);
      assert.ok(bin.scriptPath.length > 0);
    }
  });
});
