// `mobitty install-skill` / `mobitty uninstall-skill` — deploy the agent skill
// that ships with this build into ~/.claude/skills/mobitty.
//
// The skill teaches `mobitty-cli`'s contract, and a session's `mobitty-cli`
// always runs the code of the server that owns it (cli-shared.ts
// delegateToSessionCli). So the source is resolved from *this module's own
// location*: whichever `mobitty` you ran, its skill is the one deployed, and
// the prose describes the commands that install actually serves.
//
// ~/.claude is shared with every other skill on the machine and is often a
// symlink into a dotfiles checkout; nothing this command did not write is
// ever removed.

import { cpSync, existsSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `<pkg>/skills/mobitty` from source and `<install>/skills/mobitty` from a
// build: the release copies skills/ beside the compiled src/.
const SKILL_SOURCE = fileURLToPath(new URL('../skills/mobitty/', import.meta.url));

// Ownership token, present only in a directory this command wrote. Also
// records which release the deployed prose came from.
const SKILL_MARKER = '.mobitty-release';

export interface SkillResult {
  /** Resolved path — when ~/.claude/skills links into a dotfiles repo, that
   *  is where the bytes landed and may need committing. */
  skill?: string;
  notes: string[];
}

export interface SkillOptions {
  /** ~/.claude; a parameter so tests can use a throwaway one. */
  claudeHome: string;
  /** Recorded in the marker — the package version. */
  release: string;
  /** Override for tests. */
  source?: string;
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
}

// `existsSync` follows links, so it is false for a dangling one.
function lstatSafe(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

function resolveRoot(path: string): string {
  if (!existsSync(path)) {
    if (lstatSafe(path)?.isSymbolicLink()) throw new Error(`${path} is a symlink to a missing directory`);
    mkdirSync(path, { recursive: true });
  }
  return realpathSync(path);
}

export function installSkill(options: SkillOptions): SkillResult {
  const source = options.source ?? SKILL_SOURCE;
  if (!existsSync(join(source, 'SKILL.md'))) {
    throw new Error(`this build ships no skill (looked in ${source})`);
  }
  const notes: string[] = [];
  const skillDir = join(resolveRoot(join(options.claudeHome, 'skills')), 'mobitty');
  const staging = `${skillDir}.new`;
  const previous = `${skillDir}.old`;
  rmSync(staging, { recursive: true, force: true });
  rmSync(previous, { recursive: true, force: true });

  const existing = lstatSafe(skillDir);
  if (existing?.isSymbolicLink()) {
    // A hand-made link at a checkout; replace it with a real copy.
    unlinkSync(skillDir);
    notes.push(`replaced a symlink at ${skillDir}`);
  } else if (existing && !existsSync(join(skillDir, SKILL_MARKER))) {
    const backup = `${skillDir}.bak.${stamp()}`;
    renameSync(skillDir, backup);
    notes.push(`${skillDir} was not installed by mobitty; moved it aside to ${backup}`);
  }

  cpSync(source, staging, { recursive: true });
  writeFileSync(join(staging, SKILL_MARKER), `${options.release}\n`, 'utf-8');
  // Stage then swap, so a session reading the skill mid-install sees one
  // generation or the other, never a half-copied directory.
  if (existsSync(skillDir)) renameSync(skillDir, previous);
  renameSync(staging, skillDir);
  rmSync(previous, { recursive: true, force: true });

  return { skill: skillDir, notes };
}

export function uninstallSkill(options: SkillOptions): SkillResult {
  const notes: string[] = [];
  const skillRoot = join(options.claudeHome, 'skills');
  if (!existsSync(skillRoot)) return { notes };

  const skillDir = join(realpathSync(skillRoot), 'mobitty');
  rmSync(`${skillDir}.new`, { recursive: true, force: true });
  rmSync(`${skillDir}.old`, { recursive: true, force: true });
  if (existsSync(join(skillDir, SKILL_MARKER))) {
    rmSync(skillDir, { recursive: true, force: true });
    return { skill: skillDir, notes };
  }
  if (lstatSafe(skillDir)) notes.push(`${skillDir} was not installed by mobitty; left it alone`);
  return { notes };
}
