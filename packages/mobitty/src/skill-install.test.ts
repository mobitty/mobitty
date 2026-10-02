import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installSkill, uninstallSkill } from './skill-install.ts';

describe('skill install', () => {
  let tmpDir: string;
  let claudeHome: string;

  beforeEach(() => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), 'mobitty-skill-test-')));
    claudeHome = join(tmpDir, '.claude');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deploys the shipped SKILL.md with a release marker', () => {
    const result = installSkill({ claudeHome, release: '1.2.3' });
    const skillDir = join(claudeHome, 'skills', 'mobitty');
    assert.equal(result.skill, skillDir);
    assert.match(readFileSync(join(skillDir, 'SKILL.md'), 'utf-8'), /^name: mobitty$/m);
    assert.equal(readFileSync(join(skillDir, '.mobitty-release'), 'utf-8'), '1.2.3\n');
    assert.deepEqual(result.notes, []);
  });

  it('replaces its own previous install without leaving staging dirs', () => {
    installSkill({ claudeHome, release: '1.0.0' });
    installSkill({ claudeHome, release: '2.0.0' });
    const skills = join(claudeHome, 'skills');
    assert.deepEqual(readdirSync(skills), ['mobitty']);
    assert.equal(readFileSync(join(skills, 'mobitty', '.mobitty-release'), 'utf-8'), '2.0.0\n');
  });

  it('moves aside a skill it did not install', () => {
    const foreign = join(claudeHome, 'skills', 'mobitty');
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, 'SKILL.md'), 'mine');
    const result = installSkill({ claudeHome, release: '1.0.0' });
    const backups = readdirSync(join(claudeHome, 'skills')).filter((n) => n.startsWith('mobitty.bak.'));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(claudeHome, 'skills', backups[0]!, 'SKILL.md'), 'utf-8'), 'mine');
    assert.match(result.notes[0]!, /moved it aside/);
  });

  it('reports the resolved path when ~/.claude/skills is a symlink', () => {
    const dotfiles = join(tmpDir, 'dotfiles-skills');
    mkdirSync(dotfiles);
    mkdirSync(claudeHome);
    symlinkSync(dotfiles, join(claudeHome, 'skills'));
    const result = installSkill({ claudeHome, release: '1.0.0' });
    assert.equal(result.skill, join(dotfiles, 'mobitty'));
  });

  it('fails when the build ships no skill', () => {
    assert.throws(
      () => installSkill({ claudeHome, release: '1.0.0', source: join(tmpDir, 'nothing') }),
      /ships no skill/,
    );
  });

  it('uninstalls only what it installed', () => {
    installSkill({ claudeHome, release: '1.0.0' });
    const removed = uninstallSkill({ claudeHome, release: '1.0.0' });
    assert.equal(removed.skill, join(claudeHome, 'skills', 'mobitty'));
    assert.equal(existsSync(join(claudeHome, 'skills', 'mobitty')), false);

    const foreign = join(claudeHome, 'skills', 'mobitty');
    mkdirSync(foreign);
    const kept = uninstallSkill({ claudeHome, release: '1.0.0' });
    assert.equal(kept.skill, undefined);
    assert.equal(existsSync(foreign), true);
    assert.match(kept.notes[0]!, /left it alone/);
  });
});
