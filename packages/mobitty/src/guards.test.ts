import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isRecord } from './types.ts';
import { parseSavedShell } from './shells.ts';

describe('isRecord', () => {
  it('accepts plain objects', () => {
    assert.equal(isRecord({}), true);
    assert.equal(isRecord({ a: 1 }), true);
    assert.equal(isRecord(JSON.parse('{"name":"x"}')), true);
  });

  it('rejects null, arrays and primitives', () => {
    for (const v of [null, undefined, [], [1], 0, 'x', true]) {
      assert.equal(isRecord(v), false, String(v));
    }
  });
});

describe('parseSavedShell', () => {
  it('reads argv, command and string env values', () => {
    assert.deepEqual(
      parseSavedShell('z', { argv: ['/bin/zsh', 5, '-l'], command: ' zsh ', env: { A: '1', B: 2 } }),
      { name: 'z', argv: ['/bin/zsh', '-l'], command: 'zsh', env: { A: '1' } },
    );
  });

  it('wraps a bare command when argv is absent', () => {
    const shell = parseSavedShell('c', { command: 'echo hi' });
    assert.equal(shell?.command, 'echo hi');
    assert.equal(shell?.argv.at(-1), 'echo hi');
  });

  it('ignores an env that is not an object', () => {
    assert.deepEqual(parseSavedShell('z', { argv: ['/bin/sh'], env: ['A=1'] }), { name: 'z', argv: ['/bin/sh'] });
  });

  it('rejects non-objects and files with nothing to run', () => {
    for (const v of [null, 5, 'sh', ['/bin/sh'], {}, { argv: [1] }, { command: '  ' }]) {
      assert.equal(parseSavedShell('z', v), undefined, JSON.stringify(v));
    }
  });
});
