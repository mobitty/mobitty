import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { execFileSync } from 'node:child_process';

export interface DiscoveredShell {
  name: string;
  argv: string[];
}

const UNIX_FALLBACK_PATHS = [
  '/bin/bash',
  '/usr/bin/bash',
  '/bin/zsh',
  '/usr/bin/zsh',
  '/bin/sh',
  '/usr/bin/sh',
  '/usr/bin/fish',
  '/usr/local/bin/fish',
  '/bin/dash',
  '/usr/bin/dash',
  '/bin/ksh',
  '/usr/bin/ksh',
  '/bin/tcsh',
  '/usr/bin/tcsh',
];

const UNIX_LOGIN_SHELLS = new Set(['bash', 'zsh', 'fish', 'ksh', 'tcsh', 'dash']);

function parseEtcShells(): string[] {
  try {
    const content = readFileSync('/etc/shells', 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));
  } catch {
    return [];
  }
}

function shellArgsForUnix(name: string, path: string): string[] {
  if (UNIX_LOGIN_SHELLS.has(name)) {
    return [path, '-i', '-l'];
  }
  return [path];
}

function discoverUnix(): DiscoveredShell[] {
  const seen = new Set<string>();
  const shells: DiscoveredShell[] = [];

  const paths = parseEtcShells();
  const candidates = paths.length > 0 ? paths : UNIX_FALLBACK_PATHS;

  for (const shellPath of candidates) {
    if (!existsSync(shellPath)) continue;
    const name = basename(shellPath);
    if (seen.has(name)) continue;
    seen.add(name);
    shells.push({ name, argv: shellArgsForUnix(name, shellPath) });
  }

  return shells;
}

function existsOnPath(cmd: string): boolean {
  try {
    execFileSync('where', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

interface WindowsCandidate {
  name: string;
  cmd: string;
  absolutePaths: string[];
  args: string[];
}

const WINDOWS_CANDIDATES: WindowsCandidate[] = [
  { name: 'powershell', cmd: 'powershell.exe', absolutePaths: [], args: [] },
  {
    name: 'pwsh',
    cmd: 'pwsh.exe',
    absolutePaths: ['C:\\Program Files\\PowerShell\\7\\pwsh.exe'],
    args: [],
  },
  { name: 'cmd', cmd: 'cmd.exe', absolutePaths: [], args: [] },
  {
    name: 'git-bash',
    cmd: '',
    absolutePaths: [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ],
    args: ['-i', '-l'],
  },
  { name: 'wsl', cmd: 'wsl.exe', absolutePaths: [], args: [] },
];

function discoverWindows(): DiscoveredShell[] {
  const shells: DiscoveredShell[] = [];

  for (const candidate of WINDOWS_CANDIDATES) {
    // Check absolute paths first
    let found = false;
    for (const absPath of candidate.absolutePaths) {
      if (existsSync(absPath)) {
        shells.push({ name: candidate.name, argv: [absPath, ...candidate.args] });
        found = true;
        break;
      }
    }
    if (found) continue;

    // Check PATH
    if (candidate.cmd && existsOnPath(candidate.cmd)) {
      shells.push({ name: candidate.name, argv: [candidate.cmd, ...candidate.args] });
    }
  }

  return shells;
}

export function discoverShells(): DiscoveredShell[] {
  if (process.platform === 'win32') {
    return discoverWindows();
  }
  return discoverUnix();
}
