import { mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { discoverShells } from './shell-discovery.ts';
import type { DiscoveredShell } from './shell-discovery.ts';
import { isRecord } from './types.ts';

export const SHELL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export interface Shell {
  name: string;
  argv: string[];
  command?: string;
  env?: Record<string, string>;
}

/**
 * Wrap a raw command string in the platform's default shell so that
 * operators (`&&`, `|`, `;`), builtins (`cd`), tilde expansion, etc.
 * are interpreted correctly by node-pty.
 */
function commandToArgv(command: string): string[] {
  if (process.platform === 'win32') {
    const comspec = process.env['COMSPEC'] || 'cmd.exe';
    return [comspec, '/c', command];
  }
  const shell = process.env['SHELL'] || '/bin/sh';
  return [shell, '-c', command];
}

export interface ShellInfo extends Shell {
  source: 'saved' | 'discovered';
}

/** Read a saved shell file's parsed JSON. `undefined` when it is not an
 *  object or yields no command to run; unknown fields and non-string argv
 *  entries or env values are dropped. */
export function parseSavedShell(name: string, data: unknown): Shell | undefined {
  if (!isRecord(data)) return undefined;
  const rawCommand = data['command'];
  const command = typeof rawCommand === 'string' && rawCommand.trim() ? rawCommand.trim() : undefined;
  const rawArgv = data['argv'];
  let argv = Array.isArray(rawArgv) ? rawArgv.filter((a): a is string => typeof a === 'string') : [];
  if (argv.length === 0 && command) argv = commandToArgv(command);
  if (argv.length === 0) return undefined;
  const shell: Shell = { name, argv };
  if (command) shell.command = command;
  const rawEnv = data['env'];
  if (isRecord(rawEnv)) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawEnv)) {
      if (typeof v === 'string') env[k] = v;
    }
    if (Object.keys(env).length > 0) shell.env = env;
  }
  return shell;
}

export class ShellStore {
  private shellsDir: string;
  private dataFolder: string;
  private discovered: DiscoveredShell[] = [];

  constructor(dataFolder: string) {
    this.dataFolder = dataFolder;
    this.shellsDir = join(dataFolder, 'shells');
  }

  ensureDefaults(): void {
    mkdirSync(this.shellsDir, { recursive: true });
  }

  rediscover(): void {
    this.discovered = discoverShells(this.dataFolder);
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
          const shell = parseSavedShell(name, JSON.parse(raw));
          if (!shell) continue;
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
      result.push({ name: d.name, argv: d.argv, ...(d.env ? { env: d.env } : {}), source: 'discovered' });
    }

    return result;
  }

  get(name: string): ShellInfo | undefined {
    if (!SHELL_NAME_RE.test(name)) return undefined;

    // Check saved first
    try {
      const raw = readFileSync(join(this.shellsDir, `${name}.json`), 'utf-8');
      const shell = parseSavedShell(name, JSON.parse(raw));
      if (shell) {
        const info: ShellInfo = { name, argv: shell.argv, source: 'saved' };
        if (shell.command) info.command = shell.command;
        if (shell.env) info.env = shell.env;
        return info;
      }
    } catch {
      // not saved
    }

    // Check discovered
    const found = this.discovered.find(d => d.name === name);
    if (found) return { name: found.name, argv: found.argv, ...(found.env ? { env: found.env } : {}), source: 'discovered' };

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
