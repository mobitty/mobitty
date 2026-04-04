import { mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const PROFILE_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
export const DEFAULT_PROFILE_NAMES = new Set(['default-desktop', 'default-mobile']);

export class ProfileStore {
  private profilesDir: string;

  constructor(dataFolder: string) {
    this.profilesDir = join(dataFolder, 'profiles');
  }

  ensureDefaults(): void {
    mkdirSync(this.profilesDir, { recursive: true });
  }

  list(): string[] {
    try {
      const files = readdirSync(this.profilesDir);
      const names = files
        .filter(f => f.endsWith('.json'))
        .map(f => f.slice(0, -5))
        .filter(name => PROFILE_NAME_RE.test(name) && !DEFAULT_PROFILE_NAMES.has(name));
      return [...DEFAULT_PROFILE_NAMES, ...names];
    } catch {
      return [...DEFAULT_PROFILE_NAMES];
    }
  }

  get(name: string): unknown {
    if (DEFAULT_PROFILE_NAMES.has(name)) return undefined;
    if (!PROFILE_NAME_RE.test(name)) return undefined;
    try {
      const raw = readFileSync(join(this.profilesDir, `${name}.json`), 'utf-8');
      return JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  }

  save(name: string, data: unknown): void {
    if (DEFAULT_PROFILE_NAMES.has(name)) throw new Error('Cannot overwrite default profile');
    if (!PROFILE_NAME_RE.test(name)) throw new Error('Invalid profile name');
    writeFileSync(
      join(this.profilesDir, `${name}.json`),
      JSON.stringify(data, null, 2),
    );
  }

  delete(name: string): boolean {
    if (DEFAULT_PROFILE_NAMES.has(name)) return false;
    if (!PROFILE_NAME_RE.test(name)) return false;
    try {
      unlinkSync(join(this.profilesDir, `${name}.json`));
      return true;
    } catch {
      return false;
    }
  }
}
