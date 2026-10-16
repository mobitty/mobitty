import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { discoverShells } from './shell-discovery.ts';

// On Windows, `bash` on PATH may be WSL's launcher; use Git Bash directly.
const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash';

describe('bash --rcfile shim', { skip: !existsSync(bash) && 'bash not installed' }, () => {
  let dir: string;
  let home: string;
  let rc: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mobitty-shell-init-test-'));
    home = join(dir, 'home');
    discoverShells(dir);
    rc = join(dir, 'shell-init', 'bashrc');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Returns the elements of PROMPT_COMMAND (one for a scalar, none if unset),
  // read back as values: `declare -p` quotes them differently across bash
  // versions (3.2 on macOS embeds a literal newline, 5 uses $'...\n').
  function promptCommandAfterStartup(bashProfile: string): string[] {
    rmSync(home, { recursive: true, force: true });
    spawnSync(bash, ['-c', `mkdir -p "$1"`, '_', home]);
    writeFileSync(join(home, '.bash_profile'), bashProfile);
    const result = spawnSync(bash, ['--rcfile', rc.replace(/\\/g, '/'), '-i'], {
      input: `printf 'PC<%s>\\0' "\${PROMPT_COMMAND[@]}"\nexit\n`,
      // As discovery launches Git Bash.
      env: { ...process.env, HOME: home, ...(process.platform === 'win32' && { MOBITTY_CWD_STYLE: 'msys' }) },
      encoding: 'utf-8',
    });
    return [...result.stdout.matchAll(/PC<([^\0]*)>\0/g)].map((m) => m[1]!);
  }

  it('appends the hook after a scalar PROMPT_COMMAND the user assigns', () => {
    const out = promptCommandAfterStartup("PROMPT_COMMAND='user_hook;'\n");
    assert.deepEqual(out, ['user_hook;\n__mobitty_report_cwd']);
  });

  it('appends the hook to an array PROMPT_COMMAND', () => {
    const out = promptCommandAfterStartup('PROMPT_COMMAND=(first second)\n');
    assert.deepEqual(out, ['first', 'second', '__mobitty_report_cwd']);
  });

  it('installs the hook when the user sets none', () => {
    const out = promptCommandAfterStartup('');
    assert.deepEqual(out, ['__mobitty_report_cwd']);
  });
});
