import { mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { discoverShells } from './shell-discovery.ts';
import type { DiscoveredShell } from './shell-discovery.ts';

export const SHELL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export interface Shell {
  name: string;
  argv: string[];
  env?: Record<string, string>;
}

export interface ShellInfo extends Shell {
  source: 'saved' | 'discovered';
}

export class ShellStore {
  private shellsDir: string;
  private discovered: DiscoveredShell[] = [];

  constructor(dataFolder: string) {
    this.shellsDir = join(dataFolder, 'shells');
  }

  ensureDefaults(): void {
    mkdirSync(this.shellsDir, { recursive: true });
  }

  rediscover(): void {
    this.discovered = discoverShells();
  }

  private loadSaved(): Shell[] {
    try {
      const files = readdirSync(this.shellsDir);
      const shells: Shell[] = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const name = f.slice(0, -5);
        if (!SHELL_NAME_RE.test(name)) continue;
        try {
          const raw = readFileSync(join(this.shellsDir, f), 'utf-8');
          const data = JSON.parse(raw) as Record<string, unknown>;
          if (!Array.isArray(data['argv']) || data['argv'].length === 0) continue;
          const argv = (data['argv'] as unknown[]).filter((a): a is string => typeof a === 'string');
          if (argv.length === 0) continue;
          const shell: Shell = { name, argv };
          if (typeof data['env'] === 'object' && data['env'] !== null && !Array.isArray(data['env'])) {
            const env: Record<string, string> = {};
            for (const [k, v] of Object.entries(data['env'] as Record<string, unknown>)) {
              if (typeof v === 'string') env[k] = v;
            }
            if (Object.keys(env).length > 0) shell.env = env;
          }
          shells.push(shell);
        } catch {
          // skip malformed files
        }
      }
      return shells;
    } catch {
      return [];
    }
  }

  list(): ShellInfo[] {
    const saved = this.loadSaved();
    const savedNames = new Set(saved.map(s => s.name));

    const result: ShellInfo[] = saved.map(s => ({ ...s, source: 'saved' as const }));

    for (const d of this.discovered) {
      if (savedNames.has(d.name)) continue;
      result.push({ name: d.name, argv: d.argv, source: 'discovered' });
    }

    return result;
  }

  get(name: string): ShellInfo | undefined {
    if (!SHELL_NAME_RE.test(name)) return undefined;

    // Check saved first
    try {
      const raw = readFileSync(join(this.shellsDir, `${name}.json`), 'utf-8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (Array.isArray(data['argv']) && data['argv'].length > 0) {
        const argv = (data['argv'] as unknown[]).filter((a): a is string => typeof a === 'string');
        if (argv.length > 0) {
          const shell: ShellInfo = { name, argv, source: 'saved' };
          if (typeof data['env'] === 'object' && data['env'] !== null && !Array.isArray(data['env'])) {
            const env: Record<string, string> = {};
            for (const [k, v] of Object.entries(data['env'] as Record<string, unknown>)) {
              if (typeof v === 'string') env[k] = v;
            }
            if (Object.keys(env).length > 0) shell.env = env;
          }
          return shell;
        }
      }
    } catch {
      // not saved
    }

    // Check discovered
    const found = this.discovered.find(d => d.name === name);
    if (found) return { name: found.name, argv: found.argv, source: 'discovered' };

    return undefined;
  }

  save(name: string, data: unknown): void {
    if (!SHELL_NAME_RE.test(name)) throw new Error('Invalid shell name');
    writeFileSync(
      join(this.shellsDir, `${name}.json`),
      JSON.stringify(data, null, 2),
    );
  }

  delete(name: string): boolean {
    if (!SHELL_NAME_RE.test(name)) return false;
    try {
      unlinkSync(join(this.shellsDir, `${name}.json`));
      return true;
    } catch {
      return false;
    }
  }

  resolve(name?: string): ShellInfo | undefined {
    if (name) return this.get(name);
    // Return first available shell
    const all = this.list();
    return all[0];
  }
}
